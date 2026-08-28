/**
 * YouTubeDubbingQ - 视频内嵌浮动工具栏与常驻状态胶囊
 * 在 YouTube 视频播放器上显示快捷操作工具栏与常驻状态指示
 * 支持：双语字幕、中文配音、逐字稿面板、双语 SRT 导出、音量控制、常驻状态胶囊与翻译进度指示
 */

const Toolbar = {
  _container: null,
  _statusPill: null,
  _settings: null,
  _callbacks: {},
  _transcriptOpen: false,
  _statusPillTimer: null,

  /**
   * 初始化工具栏
   * @param {Object} settings 当前设置
   * @param {Object} callbacks 回调函数
   * @param {Function} callbacks.onSubtitleToggle 字幕开关
   * @param {Function} callbacks.onDubbingToggle 配音开关
   * @param {Function} callbacks.onTranscriptToggle 逐字稿开关
   * @param {Function} callbacks.onExportSrt 导出 SRT
   * @param {Function} callbacks.onOriginalVolumeChange 原视频音量
   * @param {Function} callbacks.onDubbingVolumeChange 配音音量
   */
  init(settings, callbacks) {
    this._settings = settings || {};
    this._callbacks = callbacks || {};
    this._removeExisting();
    this._createToolbar();
    this._createStatusPill();
  },

  /**
   * 移除已有工具栏与状态胶囊
   */
  _removeExisting() {
    const existingToolbar = document.getElementById('ydq-toolbar');
    if (existingToolbar) existingToolbar.remove();

    const existingPill = document.getElementById('ydq-status-pill');
    if (existingPill) existingPill.remove();

    if (this._statusPillTimer) {
      clearTimeout(this._statusPillTimer);
      this._statusPillTimer = null;
    }
  },

  /**
   * 创建常驻状态胶囊 (位于播放器右上角)
   */
  _createStatusPill() {
    const playerContainer =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player');
    if (!playerContainer) return;

    const pill = document.createElement('div');
    pill.id = 'ydq-status-pill';
    pill.className = 'ydq-status-pill';
    pill.style.display = 'none';

    pill.innerHTML = `
      <div class="ydq-status-pill-icon">
        <svg class="ydq-status-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="9" stroke-dasharray="28" stroke-dashoffset="10"/>
        </svg>
      </div>
      <span class="ydq-status-pill-text" id="ydq-status-pill-text">正在准备...</span>
    `;

    playerContainer.appendChild(pill);
    this._statusPill = pill;
  },

  /**
   * 创建工具栏
   */
  _createToolbar() {
    const playerContainer =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player');
    if (!playerContainer) return;

    this._container = document.createElement('div');
    this._container.id = 'ydq-toolbar';
    this._container.innerHTML = this._getToolbarHTML();

    playerContainer.appendChild(this._container);
    this._bindEvents();
    this._updateState();
  },

  /**
   * 生成工具栏 HTML
   */
  _getToolbarHTML() {
    return `
      <div class="ydq-toolbar-inner">
        <div class="ydq-toolbar-brand" title="YouTubeDubbingQ (YDQ)">
          <span class="ydq-toolbar-logo">YDQ</span>
        </div>

        <div class="ydq-toolbar-divider"></div>

        <!-- 字幕开关 -->
        <button class="ydq-toolbar-btn" id="ydq-btn-subtitle" title="双语字幕 (快捷键 C)">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M7 12h4M13 12h4M7 16h10"/>
          </svg>
          <span class="ydq-toolbar-label">字幕</span>
        </button>

        <!-- 配音开关 -->
        <button class="ydq-toolbar-btn" id="ydq-btn-dubbing" title="实时中文配音">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span class="ydq-toolbar-label">配音</span>
        </button>

        <!-- 逐字稿面板 -->
        <button class="ydq-toolbar-btn" id="ydq-btn-transcript" title="中英对照逐字稿面板">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span class="ydq-toolbar-label">逐字稿</span>
        </button>

        <!-- 导出 SRT -->
        <button class="ydq-toolbar-btn" id="ydq-btn-export-srt" title="导出双语 SRT 字幕">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span class="ydq-toolbar-label">导出</span>
        </button>

        <div class="ydq-toolbar-divider"></div>

        <!-- 音量控制 -->
        <div class="ydq-toolbar-volume-group" id="ydq-volume-group">
          <button class="ydq-toolbar-btn ydq-toolbar-btn-sm" id="ydq-btn-volume" title="音量设置">
            <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
          </button>

          <!-- 音量面板 -->
          <div class="ydq-volume-panel" id="ydq-volume-panel">
            <div class="ydq-volume-item">
              <span class="ydq-volume-label">原视频</span>
              <input type="range" class="ydq-volume-slider" id="ydq-slider-original"
                min="0" max="100" value="20" />
              <span class="ydq-volume-value" id="ydq-val-original">20%</span>
            </div>
            <div class="ydq-volume-item">
              <span class="ydq-volume-label">配音</span>
              <input type="range" class="ydq-volume-slider" id="ydq-slider-dubbing"
                min="0" max="100" value="100" />
              <span class="ydq-volume-value" id="ydq-val-dubbing">100%</span>
            </div>
          </div>
        </div>

        <!-- 翻译进度指示器 -->
        <div class="ydq-toolbar-progress" id="ydq-progress" style="display:none;">
          <div class="ydq-progress-bar">
            <div class="ydq-progress-fill" id="ydq-progress-fill"></div>
          </div>
          <span class="ydq-progress-text" id="ydq-progress-text">翻译中...</span>
        </div>
      </div>
    `;
  },

  /**
   * 显示常驻状态胶囊
   * @param {string} text 显示文本
   * @param {string} type 'loading' | 'info' | 'success' | 'error'
   * @param {number} autoHideMs 自动隐藏毫秒数 (0 为不隐藏)
   */
  showStatusPill(text, type = 'loading', autoHideMs = 0) {
    if (!this._statusPill) {
      this._createStatusPill();
    }
    if (!this._statusPill) return;

    if (this._statusPillTimer) {
      clearTimeout(this._statusPillTimer);
      this._statusPillTimer = null;
    }

    const textEl = this._statusPill.querySelector('#ydq-status-pill-text');
    if (textEl) textEl.textContent = text;

    this._statusPill.className = `ydq-status-pill ydq-status-pill-${type} ydq-visible`;
    this._statusPill.style.display = 'inline-flex';

    if (autoHideMs > 0) {
      this._statusPillTimer = setTimeout(() => {
        this.hideStatusPill();
      }, autoHideMs);
    }
  },

  /**
   * 隐藏常驻状态胶囊
   */
  hideStatusPill() {
    if (this._statusPill) {
      this._statusPill.classList.remove('ydq-visible');
      setTimeout(() => {
        if (this._statusPill && !this._statusPill.classList.contains('ydq-visible')) {
          this._statusPill.style.display = 'none';
        }
      }, 300);
    }
  },

  /**
   * 绑定事件
   */
  _bindEvents() {
    // 字幕开关
    const btnSubtitle = document.getElementById('ydq-btn-subtitle');
    if (btnSubtitle) {
      btnSubtitle.addEventListener('click', () => {
        this._settings.subtitleEnabled = !this._settings.subtitleEnabled;
        this._updateState();
        if (this._callbacks.onSubtitleToggle) {
          this._callbacks.onSubtitleToggle(this._settings.subtitleEnabled);
        }
      });
    }

    // 配音开关
    const btnDubbing = document.getElementById('ydq-btn-dubbing');
    if (btnDubbing) {
      btnDubbing.addEventListener('click', () => {
        this._settings.dubbingEnabled = !this._settings.dubbingEnabled;
        this._updateState();
        if (this._callbacks.onDubbingToggle) {
          this._callbacks.onDubbingToggle(this._settings.dubbingEnabled);
        }
      });
    }

    // 逐字稿开关
    const btnTranscript = document.getElementById('ydq-btn-transcript');
    if (btnTranscript) {
      btnTranscript.addEventListener('click', () => {
        this._transcriptOpen = !this._transcriptOpen;
        btnTranscript.classList.toggle('ydq-active', this._transcriptOpen);
        if (this._callbacks.onTranscriptToggle) {
          this._callbacks.onTranscriptToggle(this._transcriptOpen);
        }
      });
    }

    // 导出 SRT
    const btnExportSrt = document.getElementById('ydq-btn-export-srt');
    if (btnExportSrt) {
      btnExportSrt.addEventListener('click', () => {
        if (this._callbacks.onExportSrt) {
          this._callbacks.onExportSrt();
        }
      });
    }

    // 音量面板切换
    const btnVolume = document.getElementById('ydq-btn-volume');
    const volumePanel = document.getElementById('ydq-volume-panel');
    if (btnVolume && volumePanel) {
      btnVolume.addEventListener('click', (e) => {
        e.stopPropagation();
        volumePanel.classList.toggle('ydq-visible');
      });

      document.addEventListener('click', () => {
        volumePanel.classList.remove('ydq-visible');
      });

      volumePanel.addEventListener('click', (e) => e.stopPropagation());
    }

    // 原视频音量滑块
    const sliderOriginal = document.getElementById('ydq-slider-original');
    const valOriginal = document.getElementById('ydq-val-original');
    if (sliderOriginal) {
      sliderOriginal.value = this._settings.originalVolume || 20;
      if (valOriginal) valOriginal.textContent = sliderOriginal.value + '%';

      sliderOriginal.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        if (valOriginal) valOriginal.textContent = value + '%';
        if (this._callbacks.onOriginalVolumeChange) {
          this._callbacks.onOriginalVolumeChange(value);
        }
      });
    }

    // 配音音量滑块
    const sliderDubbing = document.getElementById('ydq-slider-dubbing');
    const valDubbing = document.getElementById('ydq-val-dubbing');
    if (sliderDubbing) {
      sliderDubbing.value = this._settings.dubbingVolume || 100;
      if (valDubbing) valDubbing.textContent = sliderDubbing.value + '%';

      sliderDubbing.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        if (valDubbing) valDubbing.textContent = value + '%';
        if (this._callbacks.onDubbingVolumeChange) {
          this._callbacks.onDubbingVolumeChange(value);
        }
      });
    }

    // 鼠标悬停显示/隐藏
    const playerContainer =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player');
    if (playerContainer && this._container) {
      playerContainer.addEventListener('mouseenter', () => {
        this._container.classList.add('ydq-toolbar-visible');
      });
      playerContainer.addEventListener('mouseleave', () => {
        this._container.classList.remove('ydq-toolbar-visible');
        const vp = document.getElementById('ydq-volume-panel');
        if (vp) vp.classList.remove('ydq-visible');
      });
    }
  },

  /**
   * 更新按钮状态
   */
  _updateState() {
    const btnSubtitle = document.getElementById('ydq-btn-subtitle');
    const btnDubbing = document.getElementById('ydq-btn-dubbing');
    const btnTranscript = document.getElementById('ydq-btn-transcript');

    if (btnSubtitle) {
      btnSubtitle.classList.toggle('ydq-active', !!this._settings.subtitleEnabled);
    }
    if (btnDubbing) {
      btnDubbing.classList.toggle('ydq-active', !!this._settings.dubbingEnabled);
    }
    if (btnTranscript) {
      btnTranscript.classList.toggle('ydq-active', !!this._transcriptOpen);
    }
  },

  /**
   * 同步外部设置逐字稿按钮状态
   */
  setTranscriptActive(active) {
    this._transcriptOpen = !!active;
    const btnTranscript = document.getElementById('ydq-btn-transcript');
    if (btnTranscript) {
      btnTranscript.classList.toggle('ydq-active', this._transcriptOpen);
    }
  },

  /**
   * 同步外部设置字幕开关状态
   */
  setSubtitleActive(active) {
    this._settings.subtitleEnabled = !!active;
    const btnSubtitle = document.getElementById('ydq-btn-subtitle');
    if (btnSubtitle) {
      btnSubtitle.classList.toggle('ydq-active', this._settings.subtitleEnabled);
    }
  },

  /**
   * 显示翻译进度
   * @param {number} translated 已翻译数量
   * @param {number} total 总数量
   */
  showProgress(translated, total) {
    const progress = document.getElementById('ydq-progress');
    const fill = document.getElementById('ydq-progress-fill');
    const text = document.getElementById('ydq-progress-text');

    if (!progress) return;

    if (total > 0 && translated >= total) {
      progress.style.display = 'none';
      return;
    }

    progress.style.display = 'flex';
    const percent = total > 0 ? Math.round((translated / total) * 100) : 0;
    if (fill) fill.style.width = percent + '%';
    if (text) text.textContent = `翻译中 ${percent}% (${translated}/${total})`;
  },

  /**
   * 显示状态提示 (轻量 Toast)
   * @param {string} message 提示文本
   * @param {string} type 类型 'info' | 'success' | 'error'
   */
  showToast(message, type = 'info') {
    let toast = document.getElementById('ydq-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ydq-toast';
      const playerContainer =
        document.querySelector('#movie_player') ||
        document.querySelector('.html5-video-player');
      if (playerContainer) playerContainer.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `ydq-toast ydq-toast-${type} ydq-toast-show`;

    setTimeout(() => {
      toast.classList.remove('ydq-toast-show');
    }, 3000);
  },

  /**
   * 更新设置
   * @param {Object} newSettings
   */
  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    this._updateState();
  },

  /**
   * 销毁工具栏
   */
  destroy() {
    this._removeExisting();
  },
};

if (typeof window !== 'undefined') {
  window.Toolbar = Toolbar;
}
