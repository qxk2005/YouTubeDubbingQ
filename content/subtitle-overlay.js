/**
 * YouTubeDubbingQ - 字幕覆盖层渲染模块
 * 在 YouTube 视频播放器上渲染 Netflix 风格的双语字幕
 */

const SubtitleOverlay = {
  // 状态
  _container: null,
  _zhElement: null,
  _enElement: null,
  _subtitles: [],
  _currentIndex: -1,
  _enabled: false,
  _rafId: null,
  _settings: null,

  /**
   * 初始化字幕覆盖层
   * @param {Object} settings 字幕样式设置
   */
  async init(settings) {
    this._settings = settings || {};
    this._removeExisting();
    this._createOverlay();
    this._hideNativeSubtitles();
  },

  /**
   * 移除已有的覆盖层
   */
  _removeExisting() {
    const existing = document.getElementById('ydq-subtitle-container');
    if (existing) existing.remove();
  },

  /**
   * 创建字幕覆盖层 DOM
   */
  _createOverlay() {
    const playerContainer =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player');

    if (!playerContainer) {
      console.error('[YDQ] 未找到视频播放器容器');
      return;
    }

    // 主容器
    this._container = document.createElement('div');
    this._container.id = 'ydq-subtitle-container';

    // 字幕包装器
    const wrapper = document.createElement('div');
    wrapper.id = 'ydq-subtitle-wrapper';

    // 中文字幕行
    this._zhElement = document.createElement('div');
    this._zhElement.id = 'ydq-subtitle-zh';
    this._zhElement.className = 'ydq-subtitle-line ydq-zh';

    // 英文字幕行
    this._enElement = document.createElement('div');
    this._enElement.id = 'ydq-subtitle-en';
    this._enElement.className = 'ydq-subtitle-line ydq-en';

    wrapper.appendChild(this._zhElement);
    wrapper.appendChild(this._enElement);
    this._container.appendChild(wrapper);
    playerContainer.appendChild(this._container);

    this._applyStyles();
  },

  /**
   * 应用字幕样式
   */
  _applyStyles() {
    const s = this._settings;
    if (!this._zhElement || !this._enElement) return;

    // 中文字幕样式
    this._zhElement.style.fontFamily =
      s.zhFontFamily || '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
    this._zhElement.style.fontSize = (s.zhFontSize || 22) + 'px';
    this._zhElement.style.color = s.zhColor || '#FFDD00';
    this._zhElement.style.fontWeight = s.zhFontWeight || 'bold';

    // 英文字幕样式
    this._enElement.style.fontFamily =
      s.enFontFamily || '"Segoe UI", "Roboto", "Arial", sans-serif';
    this._enElement.style.fontSize = (s.enFontSize || 16) + 'px';
    this._enElement.style.color = s.enColor || '#FFFFFF';
    this._enElement.style.fontWeight = s.enFontWeight || 'normal';

    // 背景样式
    const wrapper = document.getElementById('ydq-subtitle-wrapper');
    if (wrapper) {
      switch (s.subtitleBg) {
        case 'transparent':
          wrapper.style.backgroundColor = 'transparent';
          break;
        case 'solid':
          wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
          break;
        case 'semi-transparent':
        default:
          wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
          break;
      }
    }

    // 描边效果
    const strokeStyle = s.subtitleStroke !== false
      ? '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6), 1px 1px 2px rgba(0,0,0,0.8)'
      : 'none';
    this._zhElement.style.textShadow = strokeStyle;
    this._enElement.style.textShadow = strokeStyle;

    // 字幕位置
    if (this._container) {
      this._container.style.bottom = (s.subtitlePosition || 10) + '%';
    }

    // 显示模式
    this._updateDisplayMode(s.subtitleMode || 'bilingual');
  },

  /**
   * 更新显示模式
   * @param {string} mode 'bilingual' | 'zh-only' | 'en-only'
   */
  _updateDisplayMode(mode) {
    if (!this._zhElement || !this._enElement) return;

    switch (mode) {
      case 'zh-only':
        this._zhElement.style.display = 'block';
        this._enElement.style.display = 'none';
        break;
      case 'en-only':
        this._zhElement.style.display = 'none';
        this._enElement.style.display = 'block';
        break;
      case 'bilingual':
      default:
        this._zhElement.style.display = 'block';
        this._enElement.style.display = 'block';
        break;
    }
  },

  /**
   * 隐藏 YouTube 原生字幕
   */
  _hideNativeSubtitles() {
    // 通过 CSS 隐藏原生字幕
    const style = document.createElement('style');
    style.id = 'ydq-hide-native-subs';
    style.textContent = `
      .ytp-caption-window-container,
      .caption-window,
      .captions-text {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;

    // 移除旧的样式
    const existing = document.getElementById('ydq-hide-native-subs');
    if (existing) existing.remove();

    document.head.appendChild(style);
  },

  /**
   * 恢复 YouTube 原生字幕
   */
  _showNativeSubtitles() {
    const style = document.getElementById('ydq-hide-native-subs');
    if (style) style.remove();
  },

  /**
   * 设置字幕数据
   * @param {Array} subtitles 带有 zhText 的字幕数组
   */
  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
    this._currentIndex = -1;
  },

  /**
   * 启用字幕同步
   */
  enable() {
    this._enabled = true;
    this._startSync();
    if (this._container) {
      this._container.style.display = 'flex';
    }
  },

  /**
   * 禁用字幕
   */
  disable() {
    this._enabled = false;
    this._stopSync();
    if (this._container) {
      this._container.style.display = 'none';
    }
    this._showNativeSubtitles();
  },

  /**
   * 开始字幕同步循环
   */
  _startSync() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const syncLoop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video) {
        const currentTimeMs = video.currentTime * 1000;
        this._updateSubtitle(currentTimeMs);
      }

      this._rafId = requestAnimationFrame(syncLoop);
    };

    this._rafId = requestAnimationFrame(syncLoop);
  },

  /**
   * 停止字幕同步循环
   */
  _stopSync() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  /**
   * 更新当前显示的字幕
   * @param {number} currentTimeMs 当前播放时间（毫秒）
   */
  _updateSubtitle(currentTimeMs) {
    if (!this._subtitles.length) return;

    // 二分查找当前时间对应的字幕
    const index = this._findSubtitleIndex(currentTimeMs);

    if (index === this._currentIndex) return;
    this._currentIndex = index;

    if (index === -1) {
      // 当前时间没有对应的字幕，隐藏
      this._hideSubtitle();
    } else {
      const sub = this._subtitles[index];
      this._showSubtitle(sub.zhText || '', sub.text || '');
    }
  },

  /**
   * 二分查找字幕索引
   * @param {number} timeMs 时间（毫秒）
   * @returns {number} 字幕索引，-1 表示没有匹配
   */
  _findSubtitleIndex(timeMs) {
    const subs = this._subtitles;
    let low = 0;
    let high = subs.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (subs[mid].startMs <= timeMs) {
        if (subs[mid].endMs > timeMs) {
          return mid;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  },

  /**
   * 显示字幕内容
   * @param {string} zhText 中文字幕
   * @param {string} enText 英文字幕
   */
  _showSubtitle(zhText, enText) {
    if (!this._zhElement || !this._enElement) return;

    const wrapper = document.getElementById('ydq-subtitle-wrapper');
    if (wrapper) {
      wrapper.classList.add('ydq-visible');
      wrapper.classList.remove('ydq-hidden');
    }

    if (this._zhElement.textContent !== zhText) {
      this._zhElement.textContent = zhText;
    }
    if (this._enElement.textContent !== enText) {
      this._enElement.textContent = enText;
    }
  },

  /**
   * 隐藏字幕
   */
  _hideSubtitle() {
    const wrapper = document.getElementById('ydq-subtitle-wrapper');
    if (wrapper) {
      wrapper.classList.add('ydq-hidden');
      wrapper.classList.remove('ydq-visible');
    }
  },

  /**
   * 更新设置
   * @param {Object} newSettings 新的设置
   */
  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    this._applyStyles();
  },

  /**
   * 销毁覆盖层
   */
  destroy() {
    this._stopSync();
    this._removeExisting();
    this._showNativeSubtitles();
    this._subtitles = [];
    this._currentIndex = -1;
    this._enabled = false;
  },
};

if (typeof window !== 'undefined') {
  window.SubtitleOverlay = SubtitleOverlay;
}
