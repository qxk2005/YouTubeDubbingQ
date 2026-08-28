/**
 * YouTubeDubbingQ - TTS 配音管理模块 (v5 - 20秒黄金段落平稳朗读)
 * 
 * 核心设计：
 * - 以 20 秒左右的自然段落为单位进行广播级连贯朗读，发音自然通畅
 * - 结合 AI 预压缩字数，语速稳定在最舒适的 0.9x ~ 1.15x 区间，不频繁变速
 * - 支持男声/女声多种系统语音关键词智能精准映射与容错
 * - 完备的事件生命周期与打断控制
 */

const TTSManager = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _voicesLoaded: false,
  _cachedVoices: [],
  _selectedVoice: null,
  _currentSegmentId: -1, // 当前正在朗读的段落 ID
  _currentUtterance: null,

  init(settings) {
    this._settings = settings || {};
    this._selectedVoice = null;
    this._currentSegmentId = -1;
    this._loadVoices();
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  async enable() {
    this._enabled = true;
    this._loadVoices();
    this._selectedVoice = this._selectVoice();
    if (this._selectedVoice) {
      console.log(`[YDQ TTS] 配音已启用，选用语音: ${this._selectedVoice.name} (${this._selectedVoice.lang})`);

      // 检查是否匹配到了用户期望的性别
      const edgeVoice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';
      const wantsMale =
        edgeVoice.includes('Yunxi') ||
        edgeVoice.includes('Yunjian') ||
        edgeVoice.includes('Yunyang') ||
        edgeVoice.includes('Yunze');
      const name = this._selectedVoice.name.toLowerCase();
      const gotMale =
        name.includes('kangkang') ||
        name.includes('yunxi') ||
        name.includes('male') ||
        name.includes('yunjian') ||
        name.includes('yunyang');

      if (wantsMale && !gotMale) {
        if (typeof Toolbar !== 'undefined') {
          Toolbar.showToast('提示：系统未检测到中文男声语音，将使用默认中文语音', 'info');
        }
      }
    }
  },

  disable() {
    this._enabled = false;
    this.stop();
    this._currentSegmentId = -1;
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
      console.warn('[YDQ TTS] 未找到可用中文语音');
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

    // 1. 优先名称匹配
    for (const kw of keywords) {
      const match = zhVoices.find((v) => nameLower(v).includes(kw));
      if (match) return match;
    }

    // 2. URI 备选匹配
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
   * 朗读 20 秒段落文本
   * @param {Object} segment 段落对象
   * @returns {Promise<void>}
   */
  speakSegment(segment) {
    return new Promise((resolve) => {
      if (!this._enabled || !window.speechSynthesis || !segment) {
        resolve();
        return;
      }

      // 合并该 20 秒段落的全部中文字幕
      const text = SegmentManager.mergeSegmentText(segment);
      if (!text || !text.trim()) {
        resolve();
        return;
      }

      // 停止之前的朗读
      this.stop();

      this._currentSegmentId = segment.id;

      // 计算段落平稳语速
      const speed = this._calculateSegmentSpeed(text, segment.durationMs);

      console.log(
        `[YDQ TTS] 🎙️ 朗读段落 #${segment.id} (${(segment.durationMs / 1000).toFixed(1)}s, ${text.length}字, 语速${speed.toFixed(2)}x): "${text.slice(0, 35)}..."`
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

      this._currentUtterance = utterance;

      utterance.onend = () => {
        if (this._currentSegmentId === segment.id) {
          this._currentSegmentId = -1;
          this._currentUtterance = null;
        }
        resolve();
      };

      utterance.onerror = (e) => {
        if (this._currentSegmentId === segment.id) {
          this._currentSegmentId = -1;
          this._currentUtterance = null;
        }
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          console.warn(`[YDQ TTS] 段落 #${segment.id} 朗读异常:`, e.error);
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  },

  /**
   * 自动微调段落语速
   * 目标：让朗读时长与段落时间窗口自然贴合
   * @param {string} text 段落中文文本
   * @param {number} durationMs 段落时长毫秒
   * @returns {number} 语速倍率 (0.85 ~ 1.25)
   */
  _calculateSegmentSpeed(text, durationMs) {
    if (!text || durationMs <= 0) return 1.0;

    // 计算纯文字数（去除部分停顿标点）
    const cleanChars = text.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    // 正常中文标准播音语速：约 3.6 字/秒
    const estimatedNaturalMs = (cleanChars / 3.6) * 1000;
    const ratio = estimatedNaturalMs / durationMs;

    // 语速严格约束在舒适区间，极少出现急促感
    const speed = Math.max(0.85, Math.min(1.25, ratio));
    return parseFloat(speed.toFixed(2));
  },

  /**
   * 停止当前朗读
   */
  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._currentSegmentId = -1;
    this._currentUtterance = null;
  },

  /**
   * 获取当前正在朗读的段落 ID
   */
  getCurrentSegmentId() {
    return this._currentSegmentId;
  },

  isSpeaking() {
    return window.speechSynthesis && window.speechSynthesis.speaking;
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
