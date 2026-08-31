/**
 * YouTubeDubbingQ - TTS 配音管理模块 (自适应追赶调速 + 非破坏性排队 + Chrome 防假死守护)
 * 
 * 核心特性：
 * 1. 动态追赶调速 (1.05x ~ 1.60x)：实时依据视频落后毫秒数自动调整语速，在 1~2 句话内追平进度
 * 2. 刚性排队管理：非破坏性顺序发声，同时支持安全瞬时打断与跳帧追赶
 * 3. Chrome V8 引擎防假死守护：全局强引用 + 6 秒心跳保活
 * 4. 毫秒级音画同步：字数与时间窗口精确契合
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
   * 将字幕推入排队槽位
   */
  queueSubtitle(subtitle) {
    if (!subtitle || !subtitle.zhText || !subtitle.zhText.trim()) return;
    this._queuedSubtitle = subtitle;
  },

  /**
   * 触发单条字幕朗读 (支持正常播放排队与用户 Seek 瞬时打断两种模式)
   * @param {Object} subtitle 单条字幕对象 { index, startMs, endMs, zhText, text }
   * @param {boolean} [isSeek=false] 是否为用户主动跳转/点击或追帧跳跃
   */
  speakSubtitle(subtitle, isSeek = false) {
    if (!this._enabled || !window.speechSynthesis || !subtitle) return;

    const text = (subtitle.zhText || '').trim();
    if (!text) return;

    // 模式 1: 用户主动 Seek / 点击逐字稿单句 / 追帧跳跃 -> 立即清空队列并安全瞬时切换
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
      if (subtitle.index === this._currentSubtitleIndex) {
        return;
      }
      this._queuedSubtitle = subtitle;
      return;
    }

    // 当前未在朗读，立即执行发音
    this._executeSpeak(subtitle);
  },

  /**
   * 执行单句朗读与生命周期绑定 (带自适应追赶调速)
   */
  _executeSpeak(subtitle) {
    if (!this._enabled || !window.speechSynthesis) return;

    const text = (subtitle.zhText || '').trim();
    if (!text) return;

    this._speaking = true;
    this._currentSubtitleIndex = subtitle.index;

    // 获取当前视频播放时间点以计算追赶语速
    const video = document.querySelector('video');
    const currentTimeMs = video ? video.currentTime * 1000 : subtitle.startMs;

    // 动态自适应追赶调速 (1.05x ~ 1.60x)
    const speed = this._calculateCatchUpSpeed(text, subtitle, currentTimeMs);
    const durationMs = Math.max(600, subtitle.endMs - subtitle.startMs);

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
   * 当前句子朗读自然结束后的平滑衔接与追赶处理
   */
  _handleSentenceFinished(finishedIndex) {
    if (!this._enabled) return;

    const queued = this._queuedSubtitle;
    this._queuedSubtitle = null;

    const video = document.querySelector('video');
    if (!video || video.paused) return;

    const currentTimeMs = video.currentTime * 1000;

    // 检查排队句子是否仍然有效（未严重落后）
    if (queued && queued.zhText && queued.zhText.trim()) {
      // 若当前视频进度仍在有效容差窗口内 (落后 < 2.5 秒)，无缝衔接发声
      if (currentTimeMs <= queued.endMs + 2500) {
        this._executeSpeak(queued);
        return;
      }
      console.log(`[YDQ TTS] ⏩ 排队句子 #${queued.index} 已超时落后，交给 AudioPlayer 追赶最新帧`);
    }

    // 若无排队或排队已过期，通知 AudioPlayer 定位并朗读当前视频帧的最新句子
    if (typeof AudioPlayer !== 'undefined') {
      AudioPlayer.onSentenceEnded(finishedIndex);
    }
  },

  /**
   * 动态追赶调速算法 (Catch-Up Acceleration)
   * 依据当前落后毫秒数自动调整语速，在 1~2 句话内快速追平进度
   * @param {string} text 中文文本
   * @param {Object} subtitle 当前字幕对象
   * @param {number} currentTimeMs 当前视频播放毫秒数
   * @returns {number} 语速倍率 (1.05x ~ 1.60x)
   */
  _calculateCatchUpSpeed(text, subtitle, currentTimeMs) {
    if (!text) return 1.05;

    const cleanChars = text.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    // 标准中文播音语速：约 3.8 字/秒
    const naturalMs = (cleanChars / 3.8) * 1000;
    const nominalDurationMs = Math.max(600, subtitle.endMs - subtitle.startMs);

    let speed = naturalMs / nominalDurationMs;

    // 追赶补偿机制：若发声时刻已落后字幕起点 (> 400ms)
    if (currentTimeMs && currentTimeMs > subtitle.startMs + 400) {
      const lagMs = currentTimeMs - subtitle.startMs;
      const remainingWindowMs = Math.max(600, subtitle.endMs - currentTimeMs);
      const catchUpSpeed = naturalMs / remainingWindowMs;
      // 取基准速度与追赶速度的最大值
      speed = Math.max(speed, catchUpSpeed);
    }

    // 限制在清晰自然且具备高追赶力的黄金区间 (1.05x ~ 1.60x)
    return parseFloat(Math.max(1.05, Math.min(1.60, speed)).toFixed(2));
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
