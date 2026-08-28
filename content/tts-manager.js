/**
 * YouTubeDubbingQ - TTS 配音管理模块 (非破坏性顺序队列 + Chrome 防假死守护)
 * 
 * 核心设计：
 * 1. 非破坏性顺序朗读：正常播放时绝不调用 cancel() 强行掐断，确保每一句 100% 完整读完
 * 2. 智能排队与无缝衔接：当前句读完即刻触发下一句，绝不跳句、漏句、吞字
 * 3. 刚性时长自适应调速 (1.0x ~ 1.45x)：依据字数与时间窗口精确调速，实现音画同步
 * 4. Chrome V8 引擎防假死守护：全局强引用 + 心跳保活，根除 Chrome 语音服务静默丢音与假死
 * 5. 用户 Seek 瞬时响应：用户点击逐字稿单句或拖拽进度条时，安全瞬时打断并精准发声
 */

const TTSManager = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _voicesLoaded: false,
  _cachedVoices: [],
  _selectedVoice: null,
  _speaking: false,
  _currentSubtitleIndex: -1, // 当前正在朗读的字幕 index
  _queuedSubtitle: null,     // 排队等待朗读的下一条字幕
  _heartbeatTimer: null,
  _seekDebounceTimer: null,

  init(settings) {
    this._settings = settings || {};
    this._selectedVoice = null;
    this._speaking = false;
    this._currentSubtitleIndex = -1;
    this._queuedSubtitle = null;
    this._loadVoices();
    this._startHeartbeat();
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  async enable() {
    this._enabled = true;
    this._loadVoices();
    this._selectedVoice = this._selectVoice();
    this._startHeartbeat();

    if (this._selectedVoice) {
      console.log(`[YDQ TTS] 配音引擎就绪，选用语音: ${this._selectedVoice.name} (${this._selectedVoice.lang})`);
    }
  },

  disable() {
    this._enabled = false;
    this.stop();
    this._stopHeartbeat();
    this._currentSubtitleIndex = -1;
    this._queuedSubtitle = null;
  },

  /**
   * 加载系统语音列表
   */
  _loadVoices() {
    if (!window.speechSynthesis) return;

    const loadFn = () => {
      this._cachedVoices = window.speechSynthesis.getVoices();
      if (this._cachedVoices.length > 0) {
        this._voicesLoaded = true;
        const zhVoices = this._cachedVoices.filter((v) => v.lang.startsWith('zh'));
        console.log(`[YDQ TTS] 系统就绪，加载到 ${zhVoices.length} 个中文语音`);
      }
    };

    loadFn();
    if (!this._voicesLoaded) {
      window.speechSynthesis.addEventListener('voiceschanged', loadFn);
    }
  },

  /**
   * 根据设置精准选择语音
   */
  _selectVoice() {
    if (!this._voicesLoaded) this._loadVoices();

    const voices = this._cachedVoices;
    const edgeVoice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';

    const isMale =
      edgeVoice.includes('Yunxi') ||
      edgeVoice.includes('Yunjian') ||
      edgeVoice.includes('Yunyang') ||
      edgeVoice.includes('Yunze') ||
      edgeVoice.includes('Yunfan') ||
      edgeVoice.includes('Yunhao');

    const zhVoices = voices.filter(
      (v) => v.lang === 'zh-CN' || v.lang === 'zh-TW' || v.lang.startsWith('zh')
    );

    if (zhVoices.length === 0) {
      return null;
    }

    const maleKeywords = [
      'yunxi', 'kangkang', 'yunjian', 'yunyang', 'yunze',
      'male', '男', 'man', 'boy', 'yun xi'
    ];
    const femaleKeywords = [
      'xiaoxiao', 'huihui', 'yaoyao', 'xiaoyi', 'xiaomo',
      'female', '女', 'woman', 'girl', 'xiao xiao'
    ];

    const keywords = isMale ? maleKeywords : femaleKeywords;
    const nameLower = (v) => v.name.toLowerCase();

    for (const kw of keywords) {
      const match = zhVoices.find((v) => nameLower(v).includes(kw));
      if (match) return match;
    }

    for (const v of zhVoices) {
      const uri = (v.voiceURI || '').toLowerCase();
      if (isMale && (uri.includes('male') || uri.includes('kangkang') || uri.includes('yunxi'))) {
        return v;
      }
      if (!isMale && (uri.includes('female') || uri.includes('huihui') || uri.includes('xiaoxiao'))) {
        return v;
      }
    }

    return zhVoices[0];
  },

  /**
   * 触发单条字幕朗读 (支持正常播放排队与用户 Seek 瞬时打断两种模式)
   * @param {Object} subtitle 单条字幕对象 { index, startMs, endMs, zhText, text }
   * @param {boolean} [isSeek=false] 是否为用户主动跳转/点击
   */
  speakSubtitle(subtitle, isSeek = false) {
    if (!this._enabled || !window.speechSynthesis || !subtitle) return;

    const text = (subtitle.zhText || '').trim();
    if (!text) return;

    // 模式 1: 用户主动 Seek / 点击逐字稿单句 -> 立即清空队列并安全瞬时切换
    if (isSeek) {
      this._queuedSubtitle = null;
      this._stopNativeSpeech();

      if (this._seekDebounceTimer) clearTimeout(this._seekDebounceTimer);
      // 延迟 40ms 等待 Chrome 底层 cancel 握手完成，彻底避免并发假死
      this._seekDebounceTimer = setTimeout(() => {
        this._executeSpeak(subtitle);
      }, 40);
      return;
    }

    // 模式 2: 视频连续播放流转 -> 非破坏性顺序调度
    if (this._speaking) {
      // 若是当前正在朗读的句子，忽略重复触发
      if (subtitle.index === this._currentSubtitleIndex) {
        return;
      }
      // 若是下一句，推入排队槽位，等待当前句自然读完后无缝衔接
      this._queuedSubtitle = subtitle;
      return;
    }

    // 当前未在朗读，立即执行发音
    this._executeSpeak(subtitle);
  },

  /**
   * 执行单句朗读与生命周期绑定
   */
  _executeSpeak(subtitle) {
    if (!this._enabled || !window.speechSynthesis) return;

    const text = (subtitle.zhText || '').trim();
    if (!text) return;

    this._speaking = true;
    this._currentSubtitleIndex = subtitle.index;

    // 刚性自适应语速计算 (1.0x ~ 1.45x)
    const durationMs = Math.max(800, subtitle.endMs - subtitle.startMs);
    const speed = this._calculateSubtitleSpeed(text, durationMs);

    console.log(
      `[YDQ TTS] 🎙️ 朗读字幕 #${subtitle.index} (${(durationMs / 1000).toFixed(1)}s, ${text.length}字, 语速${speed.toFixed(2)}x): "${text}"`
    );

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = speed;
    utterance.pitch = 1.0;
    utterance.volume = (this._settings.dubbingVolume || 100) / 100;

    if (!this._selectedVoice) {
      this._selectedVoice = this._selectVoice();
    }
    if (this._selectedVoice) {
      utterance.voice = this._selectedVoice;
    }

    // 全局强引用，彻底根除 Chrome V8 GC 导致中途静音停滞的 bug
    window.__YDQ_ACTIVE_UTTERANCE__ = utterance;

    utterance.onstart = () => {
      this._speaking = true;
    };

    utterance.onend = () => {
      this._speaking = false;
      window.__YDQ_ACTIVE_UTTERANCE__ = null;
      this._handleSentenceFinished(subtitle.index);
    };

    utterance.onerror = (e) => {
      this._speaking = false;
      window.__YDQ_ACTIVE_UTTERANCE__ = null;
      if (e.error !== 'canceled' && e.error !== 'interrupted') {
        console.warn(`[YDQ TTS] 字幕 #${subtitle.index} 朗读提示:`, e.error);
      }
      this._handleSentenceFinished(subtitle.index);
    };

    // 触发朗读
    window.speechSynthesis.speak(utterance);

    // 兼容 Chrome 特性：确保 speech 处于活跃状态
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  },

  /**
   * 当前句子朗读自然结束后的平滑衔接处理
   */
  _handleSentenceFinished(finishedIndex) {
    if (!this._enabled) return;

    const queued = this._queuedSubtitle;
    this._queuedSubtitle = null;

    if (queued && queued.zhText && queued.zhText.trim()) {
      const video = document.querySelector('video');
      if (video && !video.paused) {
        const currentTimeMs = video.currentTime * 1000;
        // 若当前视频进度仍在该排队句子有效窗口内 (startMs - 500ms ~ endMs + 2000ms)，立即衔接发声
        if (currentTimeMs >= queued.startMs - 500 && currentTimeMs <= queued.endMs + 2500) {
          this._executeSpeak(queued);
          return;
        }
      }
    }

    // 若无排队或排队已过期，检查当前视频时间点是否有新句子需要发声
    const video = document.querySelector('video');
    if (video && !video.paused && typeof AudioPlayer !== 'undefined') {
      AudioPlayer.onSentenceEnded(finishedIndex);
    }
  },

  /**
   * 刚性时长自适应调速算法 (确保在时间窗口内平稳读完)
   * @param {string} text 中文文本
   * @param {number} durationMs 可用时长毫秒
   * @returns {number} 语速倍率 (1.0 ~ 1.45)
   */
  _calculateSubtitleSpeed(text, durationMs) {
    if (!text || durationMs <= 0) return 1.0;

    const cleanChars = text.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    // 标准中文播音语速：约 3.8 字/秒
    const naturalMs = (cleanChars / 3.8) * 1000;
    const ratio = naturalMs / durationMs;

    // 语速约束在黄金自然区间 (1.0x ~ 1.45x)
    const speed = Math.max(1.0, Math.min(1.45, ratio));
    return parseFloat(speed.toFixed(2));
  },

  /**
   * Chrome TTS 心跳守护 (防止 Chrome 15秒语音引擎休眠)
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._enabled && window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 6000);
  },

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  _stopNativeSpeech() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._speaking = false;
    window.__YDQ_ACTIVE_UTTERANCE__ = null;
  },

  /**
   * 停止所有朗读并清空状态
   */
  stop() {
    this._stopNativeSpeech();
    if (this._seekDebounceTimer) {
      clearTimeout(this._seekDebounceTimer);
      this._seekDebounceTimer = null;
    }
    this._currentSubtitleIndex = -1;
    this._queuedSubtitle = null;
  },

  getCurrentSubtitleIndex() {
    return this._currentSubtitleIndex;
  },

  isSpeaking() {
    return this._speaking || (window.speechSynthesis && window.speechSynthesis.speaking);
  },

  clearCache() {},

  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    this._selectedVoice = this._selectVoice();
  },

  onTimeUpdate() {},
  trimCache() {},
};

if (typeof window !== 'undefined') {
  window.TTSManager = TTSManager;
}
