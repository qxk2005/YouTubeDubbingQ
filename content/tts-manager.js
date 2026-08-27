/**
 * YouTubeDubbingQ - TTS 配音管理模块 (v4 - 逐句精确对齐)
 * 
 * 核心设计：
 * - 逐句朗读（每条字幕独立朗读），保证配音与当前字幕精确同步
 * - 每句根据时间窗口动态调速，使朗读在下一句之前完成
 * - 句间自然衔接，SpeechSynthesis 自动处理语气连贯
 * - 支持男/女声选择，通过多关键词匹配系统语音
 */

const TTSManager = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _voicesLoaded: false,
  _cachedVoices: [],
  _selectedVoice: null,
  _speakingSubIndex: -1, // 当前正在朗读的字幕索引

  init(settings) {
    this._settings = settings || {};
    this._selectedVoice = null;
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
      console.log(`[YDQ TTS] 已选语音: ${this._selectedVoice.name} (${this._selectedVoice.lang})`);

      // 检查是否匹配到了用户期望的性别
      const edgeVoice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';
      const wantsMale = edgeVoice.includes('Yunxi') || edgeVoice.includes('Yunjian') ||
                        edgeVoice.includes('Yunyang') || edgeVoice.includes('Yunze');
      const name = this._selectedVoice.name.toLowerCase();
      const gotMale = name.includes('kangkang') || name.includes('yunxi') ||
                      name.includes('male') || name.includes('yunjian');

      if (wantsMale && !gotMale) {
        if (typeof Toolbar !== 'undefined') {
          Toolbar.showToast('提示：系统未安装中文男声语音包，将使用默认女声', 'info');
        }
      }
    }
  },

  disable() {
    this._enabled = false;
    this.stop();
    this._speakingSubIndex = -1;
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

        // 详细日志：列出所有中文语音
        const zhVoices = this._cachedVoices.filter(v => v.lang.startsWith('zh'));
        console.log('[YDQ TTS] ===== 系统中文语音列表 =====');
        zhVoices.forEach((v, i) => {
          console.log(`  [${i}] ${v.name} | lang=${v.lang} | local=${v.localService}`);
        });
        console.log(`[YDQ TTS] 共 ${zhVoices.length} 个中文语音`);
      }
    };

    loadFn();
    if (!this._voicesLoaded) {
      window.speechSynthesis.addEventListener('voiceschanged', loadFn);
    }
  },

  /**
   * 根据用户设置选择语音
   * 多关键词匹配系统语音
   */
  _selectVoice() {
    if (!this._voicesLoaded) this._loadVoices();

    const voices = this._cachedVoices;
    const edgeVoice = this._settings.edgeVoice || 'zh-CN-XiaoxiaoNeural';

    console.log(`[YDQ TTS] 用户选择的 Edge 语音: ${edgeVoice}`);

    // 判断用户选择的是男声还是女声
    const isMale = edgeVoice.includes('Yunxi') || edgeVoice.includes('Yunjian') ||
                   edgeVoice.includes('Yunyang') || edgeVoice.includes('Yunze') ||
                   edgeVoice.includes('Yunfan') || edgeVoice.includes('Yunhao');

    console.log(`[YDQ TTS] 性别判断: ${isMale ? '男声' : '女声'}`);

    // 筛选中文语音
    const zhVoices = voices.filter(v =>
      v.lang === 'zh-CN' || v.lang === 'zh-TW' || v.lang.startsWith('zh')
    );

    if (zhVoices.length === 0) {
      console.warn('[YDQ TTS] ❌ 未找到任何中文语音！');
      return null;
    }

    // 男声关键词（覆盖多种系统语音命名）
    const maleKeywords = [
      'yunxi', 'kangkang', 'yunjian', 'yunyang', 'yunze',
      'male', '男', 'man', 'boy',
      // Microsoft 在线语音命名可能带 Online (Natural)
      'yunxi', 'yun xi',
    ];

    // 女声关键词
    const femaleKeywords = [
      'xiaoxiao', 'huihui', 'yaoyao', 'xiaoyi', 'xiaomo',
      'female', '女', 'woman', 'girl',
      'xiao xiao',
    ];

    const keywords = isMale ? maleKeywords : femaleKeywords;
    const nameLower = (v) => v.name.toLowerCase();

    // 优先精确匹配
    for (const kw of keywords) {
      const match = zhVoices.find(v => nameLower(v).includes(kw));
      if (match) {
        console.log(`[YDQ TTS] ✓ 匹配到${isMale ? '男' : '女'}声: ${match.name} (关键词: ${kw})`);
        return match;
      }
    }

    // 没有精确匹配 - 尝试通过 URI 判断
    // 有些系统语音的 voiceURI 中包含性别信息
    for (const v of zhVoices) {
      const uri = (v.voiceURI || '').toLowerCase();
      if (isMale && (uri.includes('male') || uri.includes('kangkang') || uri.includes('yunxi'))) {
        console.log(`[YDQ TTS] ✓ 通过 URI 匹配到男声: ${v.name}`);
        return v;
      }
      if (!isMale && (uri.includes('female') || uri.includes('huihui') || uri.includes('xiaoxiao'))) {
        console.log(`[YDQ TTS] ✓ 通过 URI 匹配到女声: ${v.name}`);
        return v;
      }
    }

    console.warn(`[YDQ TTS] ⚠ 未找到匹配的${isMale ? '男' : '女'}声，使用第一个中文语音: ${zhVoices[0].name}`);
    return zhVoices[0];
  },

  /**
   * 朗读单条字幕
   * @param {number} subIndex 字幕索引
   * @returns {Promise<void>}
   */
  speakSubtitle(subIndex) {
    return new Promise((resolve) => {
      if (!this._enabled || !window.speechSynthesis) {
        resolve();
        return;
      }

      const sub = this._subtitles[subIndex];
      if (!sub || !sub.zhText || !sub.zhText.trim()) {
        resolve();
        return;
      }

      // 停止当前朗读
      this.stop();

      this._speakingSubIndex = subIndex;

      const text = sub.zhText.trim();
      const durationMs = sub.endMs - sub.startMs;

      // 计算语速：使朗读在字幕结束前完成
      const speed = this._calculateSpeed(text, durationMs);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = speed;
      utterance.pitch = 1.0;
      utterance.volume = (this._settings.dubbingVolume || 100) / 100;

      if (this._selectedVoice) {
        utterance.voice = this._selectedVoice;
      }

      utterance.onend = () => {
        if (this._speakingSubIndex === subIndex) {
          this._speakingSubIndex = -1;
        }
        resolve();
      };

      utterance.onerror = (e) => {
        if (this._speakingSubIndex === subIndex) {
          this._speakingSubIndex = -1;
        }
        if (e.error !== 'canceled') {
          console.warn(`[YDQ TTS] 朗读 #${subIndex} 错误:`, e.error);
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  },

  /**
   * 计算语速使朗读时长匹配字幕时间窗口
   * 中文正常语速约 4-5 字/秒
   */
  _calculateSpeed(text, durationMs) {
    if (!text || durationMs <= 0) return 1.0;

    const charCount = text.replace(/[，。！？、；：,.!?;:\s]/g, '').length;
    // 以 4.5 字/秒为基准
    const estimatedMs = (charCount / 4.5) * 1000;
    const ratio = estimatedMs / durationMs;

    // 限制范围 0.8x - 1.5x，避免过快或过慢
    const speed = Math.max(0.8, Math.min(1.5, ratio));
    return speed;
  },

  /**
   * 停止当前朗读
   */
  stop() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this._speakingSubIndex = -1;
  },

  /**
   * 获取当前朗读的字幕索引
   */
  getSpeakingIndex() {
    return this._speakingSubIndex;
  },

  isSpeaking() {
    return window.speechSynthesis && window.speechSynthesis.speaking;
  },

  clearCache() {},
  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    // 设置变更时重新选择语音
    this._selectedVoice = this._selectVoice();
  },
  onTimeUpdate() {},
  trimCache() {},
};

if (typeof window !== 'undefined') {
  window.TTSManager = TTSManager;
}
