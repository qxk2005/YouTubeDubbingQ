/**
 * YouTubeDubbingQ - TTS 配音管理模块
 * 管理 TTS 音频的生成、缓存和同步播放调度
 */

const TTSManager = {
  // 音频缓存 (key: subtitle index, value: ArrayBuffer)
  _audioCache: new Map(),

  // 状态
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _currentIndex: -1,
  _prefetchQueue: [],
  _generating: false,
  _prefetchAhead: 5, // 预加载未来5条字幕

  /**
   * 初始化 TTS 管理器
   * @param {Object} settings 设置
   */
  init(settings) {
    this._settings = settings || {};
    this._audioCache.clear();
    this._currentIndex = -1;
  },

  /**
   * 设置字幕数据
   * @param {Array} subtitles 已翻译的字幕数组
   */
  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  /**
   * 启用配音
   */
  async enable() {
    this._enabled = true;
    await this._ensureOffscreen();
    this._startPrefetch();
  },

  /**
   * 禁用配音
   */
  disable() {
    this._enabled = false;
    this._stopCurrentAudio();
    this._audioCache.clear();
  },

  /**
   * 确保 Offscreen Document 已创建
   */
  async _ensureOffscreen() {
    try {
      await chrome.runtime.sendMessage({ type: 'YDQ_CREATE_OFFSCREEN' });
    } catch (e) {
      console.log('[YDQ] Offscreen Document 请求:', e.message);
    }
  },

  /**
   * 计算 TTS 语速
   * @param {string} zhText 中文文本
   * @param {number} availableDurationMs 可用时间窗口（毫秒）
   * @returns {number} 语速倍率
   */
  _calculateSpeed(zhText, availableDurationMs) {
    if (!zhText || availableDurationMs <= 0) return 1.0;

    // 估算中文语音时长：每个中文字符约 250ms
    const charCount = zhText.length;
    const estimatedDurationMs = charCount * 250;

    // 计算需要的语速倍率
    const ratio = estimatedDurationMs / availableDurationMs;

    // 限制调速范围 0.8x - 1.5x
    return Math.max(0.8, Math.min(1.5, ratio));
  },

  /**
   * 生成单条字幕的 TTS 音频
   * @param {Object} subtitle 字幕对象
   * @returns {Promise<ArrayBuffer>} 音频数据
   */
  async _generateAudio(subtitle) {
    const zhText = subtitle.zhText;
    if (!zhText) return null;

    // 检查缓存
    if (this._audioCache.has(subtitle.index)) {
      return this._audioCache.get(subtitle.index);
    }

    const availableDuration = subtitle.endMs - subtitle.startMs;
    const speed = this._calculateSpeed(zhText, availableDuration);

    let audioBuffer;

    try {
      if (this._settings.ttsEngine === 'doubao') {
        // 豆包 TTS
        audioBuffer = await this._generateDoubaoAudio(zhText, speed);
      } else {
        // Edge TTS（默认）
        audioBuffer = await this._generateEdgeAudio(zhText, speed);
      }

      if (audioBuffer) {
        this._audioCache.set(subtitle.index, audioBuffer);
      }

      return audioBuffer;
    } catch (e) {
      console.error(`[YDQ] TTS 生成失败 (字幕 #${subtitle.index}):`, e);
      return null;
    }
  },

  /**
   * 通过 Edge TTS 生成音频
   * @param {string} text 文本
   * @param {number} speed 语速
   * @returns {Promise<ArrayBuffer>}
   */
  async _generateEdgeAudio(text, speed) {
    // 通过消息发送到 Offscreen Document 处理
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      const handler = (message) => {
        if (message.type === 'YDQ_TTS_RESULT' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(handler);
          if (message.error) {
            reject(new Error(message.error));
          } else {
            // 将 base64 转回 ArrayBuffer
            const binary = atob(message.audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          }
        }
      };

      chrome.runtime.onMessage.addListener(handler);

      chrome.runtime.sendMessage({
        type: 'YDQ_TTS_REQUEST',
        requestId,
        engine: 'edge',
        text,
        voice: this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural',
        speed,
      });

      // 超时处理
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('TTS 请求超时'));
      }, 30000);
    });
  },

  /**
   * 通过豆包 TTS 生成音频
   * @param {string} text 文本
   * @param {number} speed 语速
   * @returns {Promise<ArrayBuffer>}
   */
  async _generateDoubaoAudio(text, speed) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      const handler = (message) => {
        if (message.type === 'YDQ_TTS_RESULT' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(handler);
          if (message.error) {
            reject(new Error(message.error));
          } else {
            const binary = atob(message.audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          }
        }
      };

      chrome.runtime.onMessage.addListener(handler);

      chrome.runtime.sendMessage({
        type: 'YDQ_TTS_REQUEST',
        requestId,
        engine: 'doubao',
        text,
        speed,
        config: {
          apiUrl: this._settings.doubaoApiUrl,
          apiKey: this._settings.doubaoApiKey,
          model: this._settings.doubaoModel,
          voice: this._settings.doubaoVoice,
        },
      });

      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('TTS 请求超时'));
      }, 30000);
    });
  },

  /**
   * 开始预加载
   */
  _startPrefetch() {
    if (!this._enabled || this._generating) return;

    const video = document.querySelector('video');
    if (!video) return;

    const currentTimeMs = video.currentTime * 1000;

    // 找到当前播放位置对应的字幕索引
    let startIndex = 0;
    for (let i = 0; i < this._subtitles.length; i++) {
      if (this._subtitles[i].startMs >= currentTimeMs) {
        startIndex = Math.max(0, i - 1);
        break;
      }
    }

    // 预加载接下来的几条字幕
    this._prefetchFrom(startIndex);
  },

  /**
   * 从指定索引开始预加载
   * @param {number} startIndex 起始索引
   */
  async _prefetchFrom(startIndex) {
    if (this._generating) return;
    this._generating = true;

    try {
      for (
        let i = startIndex;
        i < Math.min(startIndex + this._prefetchAhead, this._subtitles.length);
        i++
      ) {
        if (!this._enabled) break;
        if (this._audioCache.has(i)) continue;

        const subtitle = this._subtitles[i];
        if (subtitle && subtitle.zhText) {
          await this._generateAudio(subtitle);
        }
      }
    } catch (e) {
      console.error('[YDQ] 预加载失败:', e);
    }

    this._generating = false;
  },

  /**
   * 当播放进度变化时调用，触发新的预加载
   * @param {number} currentTimeMs 当前播放时间
   */
  onTimeUpdate(currentTimeMs) {
    if (!this._enabled) return;

    // 找到当前字幕索引
    let currentIdx = -1;
    for (let i = 0; i < this._subtitles.length; i++) {
      if (this._subtitles[i].startMs <= currentTimeMs && this._subtitles[i].endMs > currentTimeMs) {
        currentIdx = i;
        break;
      }
    }

    if (currentIdx !== this._currentIndex) {
      this._currentIndex = currentIdx;

      // 触发预加载
      if (currentIdx >= 0) {
        this._prefetchFrom(currentIdx + 1);
      }
    }
  },

  /**
   * 获取指定字幕索引的音频
   * @param {number} index 字幕索引
   * @returns {ArrayBuffer|null}
   */
  getAudio(index) {
    return this._audioCache.get(index) || null;
  },

  /**
   * 获取或等待音频
   * @param {number} index 字幕索引
   * @returns {Promise<ArrayBuffer|null>}
   */
  async getOrWaitAudio(index) {
    if (this._audioCache.has(index)) {
      return this._audioCache.get(index);
    }

    const subtitle = this._subtitles[index];
    if (!subtitle || !subtitle.zhText) return null;

    return await this._generateAudio(subtitle);
  },

  /**
   * 停止当前音频（通过消息通知 Offscreen Document）
   */
  _stopCurrentAudio() {
    try {
      chrome.runtime.sendMessage({ type: 'YDQ_STOP_AUDIO' });
    } catch (e) {
      // 忽略
    }
  },

  /**
   * 清除缓存
   */
  clearCache() {
    this._audioCache.clear();
    this._currentIndex = -1;
  },

  /**
   * 更新设置
   * @param {Object} newSettings
   */
  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
  },

  /**
   * 限制缓存大小
   * @param {number} currentIndex 当前播放的字幕索引
   */
  trimCache(currentIndex) {
    if (this._audioCache.size > 50) {
      // 删除距当前索引较远的已播放音频
      for (const [key] of this._audioCache) {
        if (key < currentIndex - 5) {
          this._audioCache.delete(key);
        }
      }
    }
  },
};

if (typeof window !== 'undefined') {
  window.TTSManager = TTSManager;
}
