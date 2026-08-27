/**
 * YouTubeDubbingQ - TTS 配音管理模块 (v2 - 段落式)
 * 
 * 核心变更：从逐句生成改为段落式生成
 * - 将段落中所有中文字幕合并为连贯文本
 * - 一次性生成段落语音（保证句间连贯）
 * - 按段落缓存和预加载
 */

const TTSManager = {
  // 段落音频缓存 (key: segmentStartIndex, value: ArrayBuffer | '__DIRECT_PLAY__')
  _segmentCache: new Map(),

  _enabled: false,
  _subtitles: [],
  _settings: null,
  _generating: false,
  _prefetchAhead: 2,  // 预加载接下来 2 个段落

  init(settings) {
    this._settings = settings || {};
    this._segmentCache.clear();
    this._generating = false;
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  async enable() {
    this._enabled = true;
    await this._ensureOffscreen();
  },

  disable() {
    this._enabled = false;
    this._stopCurrentAudio();
    this._segmentCache.clear();
    this._generating = false;
  },

  async _ensureOffscreen() {
    try {
      await chrome.runtime.sendMessage({ type: 'YDQ_CREATE_OFFSCREEN' });
    } catch (e) {
      console.log('[YDQ TTS] Offscreen 请求:', e.message);
    }
  },

  /**
   * 计算段落的 TTS 语速
   * 使语音总时长匹配段落的时间窗口
   */
  _calculateSegmentSpeed(mergedText, durationMs) {
    if (!mergedText || durationMs <= 0) return 1.0;

    // 中文正常语速约 4 字/秒，估算自然朗读时长
    const charCount = mergedText.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    const estimatedMs = (charCount / 4) * 1000;

    const ratio = estimatedMs / durationMs;

    // 限制调速范围 0.7x - 1.6x
    return Math.max(0.7, Math.min(1.6, ratio));
  },

  /**
   * 生成段落的 TTS 音频
   * @param {Object} segment 段落对象
   * @returns {Promise<ArrayBuffer|string|null>}
   */
  async _generateSegmentAudio(segment) {
    const cacheKey = segment.startIndex;
    if (this._segmentCache.has(cacheKey)) {
      return this._segmentCache.get(cacheKey);
    }

    // 合并段落中的中文文本
    const mergedText = SegmentManager.mergeSegmentText(segment);
    if (!mergedText || mergedText.trim().length === 0) {
      console.warn('[YDQ TTS] 段落无中文文本 (startIndex:', segment.startIndex, ')');
      return null;
    }

    const speed = this._calculateSegmentSpeed(mergedText, segment.durationMs);
    console.log(`[YDQ TTS] 生成段落音频: idx=${segment.startIndex}-${segment.endIndex}, ` +
      `字数=${mergedText.length}, 时长=${(segment.durationMs/1000).toFixed(1)}s, 语速=${speed.toFixed(2)}x`);

    try {
      let audioBuffer;

      if (this._settings.ttsEngine === 'doubao') {
        audioBuffer = await this._requestTTS('doubao', mergedText, speed);
      } else {
        audioBuffer = await this._requestTTS('edge', mergedText, speed);
      }

      if (audioBuffer) {
        this._segmentCache.set(cacheKey, audioBuffer);
      }
      return audioBuffer;
    } catch (e) {
      console.error(`[YDQ TTS] 段落音频生成失败:`, e.message);
      return null;
    }
  },

  /**
   * 发送 TTS 请求到 Offscreen Document
   */
  _requestTTS(engine, text, speed) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      const handler = (message) => {
        if (message.type === 'YDQ_TTS_RESULT' && message.requestId === requestId) {
          chrome.runtime.onMessage.removeListener(handler);
          if (message.error) {
            reject(new Error(message.error));
          } else if (message.directPlay) {
            resolve('__DIRECT_PLAY__');
          } else if (message.audioBase64) {
            const binary = atob(message.audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          } else {
            reject(new Error('TTS 返回空数据'));
          }
        }
      };

      chrome.runtime.onMessage.addListener(handler);

      const msg = {
        type: 'YDQ_TTS_REQUEST',
        requestId,
        engine,
        text,
        speed,
      };

      if (engine === 'edge') {
        msg.voice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';
      } else if (engine === 'doubao') {
        msg.config = {
          apiUrl: this._settings.doubaoApiUrl,
          apiKey: this._settings.doubaoApiKey,
          model: this._settings.doubaoModel,
          voice: this._settings.doubaoVoice,
        };
      }

      chrome.runtime.sendMessage(msg);

      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error('TTS 请求超时 (30s)'));
      }, 30000);
    });
  },

  /**
   * 获取段落音频（有缓存直接返回，无缓存则生成）
   */
  async getSegmentAudio(segment) {
    if (!segment) return null;
    const cacheKey = segment.startIndex;
    if (this._segmentCache.has(cacheKey)) {
      return this._segmentCache.get(cacheKey);
    }
    return await this._generateSegmentAudio(segment);
  },

  /**
   * 预加载段落
   */
  async prefetchSegments(currentSegmentIndex) {
    if (this._generating || !this._enabled) return;
    this._generating = true;

    try {
      const segments = SegmentManager.getSegments();
      // 找到当前段落在数组中的位置
      let currentPos = segments.findIndex(s => s.startIndex === currentSegmentIndex);
      if (currentPos === -1) currentPos = 0;

      // 预加载当前 + 后续段落
      for (let i = currentPos; i < Math.min(currentPos + this._prefetchAhead + 1, segments.length); i++) {
        if (!this._enabled) break;
        const seg = segments[i];
        if (!this._segmentCache.has(seg.startIndex)) {
          await this._generateSegmentAudio(seg);
        }
      }
    } catch (e) {
      console.error('[YDQ TTS] 预加载失败:', e);
    }

    this._generating = false;
  },

  /**
   * 时间更新回调（触发预加载）
   */
  onTimeUpdate(currentTimeMs) {
    if (!this._enabled) return;
    const segment = SegmentManager.findSegmentAtTime(currentTimeMs);
    if (segment) {
      this.prefetchSegments(segment.startIndex);
    }
  },

  _stopCurrentAudio() {
    try {
      chrome.runtime.sendMessage({ type: 'YDQ_STOP_AUDIO' });
    } catch (e) {}
  },

  clearCache() {
    this._segmentCache.clear();
  },

  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
  },

  // 保持向后兼容
  trimCache() {},
};

if (typeof window !== 'undefined') {
  window.TTSManager = TTSManager;
}
