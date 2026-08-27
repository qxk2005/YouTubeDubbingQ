/**
 * YouTubeDubbingQ - TTS 配音管理模块 (v3 - 直接朗读)
 * 
 * 核心变更：
 * - 移除 Offscreen Document 链路，直接在 Content Script 中使用 SpeechSynthesis
 * - 按段落实时朗读，不预生成音频文件
 * - 支持男/女声选择（映射到系统中文语音）
 */

const TTSManager = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _currentUtterance: null,
  _voicesLoaded: false,
  _cachedVoices: [],

  init(settings) {
    this._settings = settings || {};
    this._loadVoices();
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  async enable() {
    this._enabled = true;
    this._loadVoices();
  },

  disable() {
    this._enabled = false;
    this.stop();
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
        const zhVoices = this._cachedVoices.filter(v => v.lang.startsWith('zh'));
        console.log('[YDQ TTS] 可用中文语音:', zhVoices.map(v => `${v.name} (${v.lang})`).join(', '));
      }
    };

    loadFn();
    window.speechSynthesis.addEventListener('voiceschanged', loadFn);
  },

  /**
   * 根据用户设置选择语音
   * 将 Edge TTS 语音名映射到系统语音
   */
  _selectVoice() {
    if (!this._voicesLoaded) this._loadVoices();

    const voices = this._cachedVoices;
    const edgeVoice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';

    // 判断用户选择的是男声还是女声
    const isMale = edgeVoice.includes('Yunxi') || edgeVoice.includes('Yunjian') ||
                   edgeVoice.includes('Yunyang');

    // 在系统语音中查找匹配的中文语音
    const zhVoices = voices.filter(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'));

    if (zhVoices.length === 0) {
      console.warn('[YDQ TTS] 未找到中文语音，使用默认语音');
      return null;
    }

    // 尝试按性别匹配
    if (isMale) {
      // 优先找男声关键词
      const male = zhVoices.find(v =>
        v.name.includes('Yunxi') || v.name.includes('Kangkang') ||
        v.name.includes('Male') || v.name.includes('男')
      );
      if (male) return male;
    } else {
      // 优先找女声关键词
      const female = zhVoices.find(v =>
        v.name.includes('Xiaoxiao') || v.name.includes('Huihui') ||
        v.name.includes('Yaoyao') || v.name.includes('Female') || v.name.includes('女')
      );
      if (female) return female;
    }

    // 都没匹配到，返回第一个中文语音
    return zhVoices[0];
  },

  /**
   * 朗读段落文本
   * @param {Object} segment 段落对象
   * @returns {Promise<void>} 朗读完成时 resolve
   */
  speakSegment(segment) {
    return new Promise((resolve, reject) => {
      if (!this._enabled || !window.speechSynthesis) {
        resolve();
        return;
      }

      // 停止之前的朗读
      this.stop();

      // 合并段落文本
      const text = SegmentManager.mergeSegmentText(segment);
      if (!text || text.trim().length === 0) {
        resolve();
        return;
      }

      // 计算语速
      const speed = this._calculateSpeed(text, segment.durationMs);

      console.log(`[YDQ TTS] 朗读段落 ${segment.startIndex}-${segment.endIndex}: ` +
        `"${text.slice(0, 30)}..." (语速: ${speed.toFixed(2)}x)`);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = speed;
      utterance.pitch = 1.0;
      utterance.volume = (this._settings.dubbingVolume || 100) / 100;

      // 选择语音
      const voice = this._selectVoice();
      if (voice) {
        utterance.voice = voice;
        console.log(`[YDQ TTS] 使用语音: ${voice.name}`);
      }

      this._currentUtterance = utterance;

      utterance.onend = () => {
        this._currentUtterance = null;
        resolve();
      };

      utterance.onerror = (e) => {
        this._currentUtterance = null;
        if (e.error !== 'canceled') {
          console.warn('[YDQ TTS] 朗读错误:', e.error);
        }
        resolve(); // 不 reject，避免中断流程
      };

      window.speechSynthesis.speak(utterance);
    });
  },

  /**
   * 计算语速使朗读时长匹配段落时间窗口
   */
  _calculateSpeed(text, durationMs) {
    if (!text || durationMs <= 0) return 1.0;

    const charCount = text.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    const estimatedMs = (charCount / 4) * 1000; // 约 4 字/秒
    const ratio = estimatedMs / durationMs;

    return Math.max(0.7, Math.min(1.8, ratio));
  },

  /**
   * 停止当前朗读
   */
  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._currentUtterance = null;
  },

  /**
   * 是否正在朗读
   */
  isSpeaking() {
    return window.speechSynthesis && window.speechSynthesis.speaking;
  },

  clearCache() {},
  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
  },
  onTimeUpdate() {},
  trimCache() {},
};

if (typeof window !== 'undefined') {
  window.TTSManager = TTSManager;
}
