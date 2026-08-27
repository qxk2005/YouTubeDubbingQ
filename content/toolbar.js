/**
 * YouTubeDubbingQ - 视频内嵌浮动工具栏
 * 在 YouTube 视频播放器上显示快捷操作工具栏
 */

const Toolbar = {
  _container: null,
  _settings: null,
  _callbacks: {},

  /**
   * 初始化工具栏
   * @param {Object} settings 当前设置
   * @param {Object} callbacks 回调函数
   * @param {Function} callbacks.onSubtitleToggle 字幕开关
   * @param {Function} callbacks.onDubbingToggle 配音开关
   * @param {Function} callbacks.onOriginalVolumeChange 原视频音量
   * @param {Function} callbacks.onDubbingVolumeChange 配音音量
   */
  init(settings, callbacks) {
    this._settings = settings || {};
    this._callbacks = callbacks || {};
    this._removeExisting();
    this._createToolbar();
  },

  /**
   * 移除已有工具栏
   */
  _removeExisting() {
    const existing = document.getElementById('ydq-toolbar');
    if (existing) existing.remove();
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
        <div class="ydq-toolbar-brand">
          <span class="ydq-toolbar-logo">YDQ</span>
        </div>

        <div class="ydq-toolbar-divider"></div>

        <!-- 字幕开关 -->
        <button class="ydq-toolbar-btn" id="ydq-btn-subtitle" title="双语字幕">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M7 12h4M13 12h4M7 16h10"/>
          </svg>
          <span class="ydq-toolbar-label">字幕</span>
        </button>

        <!-- 配音开关 -->
        <button class="ydq-toolbar-btn" id="ydq-btn-dubbing" title="中文配音">
          <svg class="ydq-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span class="ydq-toolbar-label">配音</span>
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

    // 音量面板切换
    const btnVolume = document.getElementById('ydq-btn-volume');
    const volumePanel = document.getElementById('ydq-volume-panel');
    if (btnVolume && volumePanel) {
      btnVolume.addEventListener('click', (e) => {
        e.stopPropagation();
        volumePanel.classList.toggle('ydq-visible');
      });

      // 点击外部关闭
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
        // 关闭音量面板
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

    if (btnSubtitle) {
      btnSubtitle.classList.toggle('ydq-active', !!this._settings.subtitleEnabled);
    }
    if (btnDubbing) {
      btnDubbing.classList.toggle('ydq-active', !!this._settings.dubbingEnabled);
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

    if (translated >= total) {
      progress.style.display = 'none';
      return;
    }

    progress.style.display = 'flex';
    const percent = Math.round((translated / total) * 100);
    if (fill) fill.style.width = percent + '%';
    if (text) text.textContent = `翻译中 ${translated}/${total}`;
  },

  /**
   * 显示状态提示
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
