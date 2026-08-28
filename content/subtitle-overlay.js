/**
 * YouTubeDubbingQ - 字幕覆盖层渲染模块
 * 在 YouTube 视频播放器上渲染 Netflix 风格的双语字幕
 * 增强交互：
 * 1. 鼠标直接拖拽定位（播放器中心点百分比存储，全屏切换无缝适配）
 * 2. 滚轮直接缩放中英文字号（16px ~ 72px）并即时持久化
 * 3. 双击字幕框快速复位位置
 */

const SubtitleOverlay = {
  // 状态
  _container: null,
  _wrapper: null,
  _zhElement: null,
  _enElement: null,
  _fontToast: null,
  _subtitles: [],
  _currentIndex: -1,
  _enabled: false,
  _rafId: null,
  _settings: null,
  _fontToastTimer: null,

  /**
   * 初始化字幕覆盖层
   * @param {Object} settings 字幕样式设置
   */
  async init(settings) {
    this._settings = settings || {};
    this._loadSavedInteractiveSettings();
    this._removeExisting();
    this._createOverlay();
    this._hideNativeSubtitles();
  },

  /**
   * 读取用户本地拖拽位置与滚轮字号
   */
  _loadSavedInteractiveSettings() {
    try {
      const savedFont = JSON.parse(localStorage.getItem('ydq-sub-font') || 'null');
      if (savedFont) {
        if (savedFont.zhFontSize) this._settings.zhFontSize = savedFont.zhFontSize;
        if (savedFont.enFontSize) this._settings.enFontSize = savedFont.enFontSize;
      }
    } catch (e) {}
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
    wrapper.className = 'ydq-subtitle-wrapper';
    wrapper.title = '可拖拽移动位置，滚轮调节字号，双击复位';
    this._wrapper = wrapper;

    // 字号提示 Toast
    const fontToast = document.createElement('div');
    fontToast.className = 'ydq-sub-font-toast';
    fontToast.id = 'ydq-sub-font-toast';
    this._fontToast = fontToast;

    // 中文字幕行
    this._zhElement = document.createElement('div');
    this._zhElement.id = 'ydq-subtitle-zh';
    this._zhElement.className = 'ydq-subtitle-line ydq-zh';

    // 英文字幕行
    this._enElement = document.createElement('div');
    this._enElement.id = 'ydq-subtitle-en';
    this._enElement.className = 'ydq-subtitle-line ydq-en';

    wrapper.appendChild(fontToast);
    wrapper.appendChild(this._zhElement);
    wrapper.appendChild(this._enElement);
    this._container.appendChild(wrapper);
    playerContainer.appendChild(this._container);

    this._applyStyles();
    this._bindInteractiveEvents(playerContainer);
  },

  /**
   * 绑定拖拽、滚轮缩放与双击复位事件
   */
  _bindInteractiveEvents(playerContainer) {
    if (!this._wrapper || !playerContainer) return;

    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let initialLeftPct = 50, initialTopPct = 86;

    // 1. 拖拽定位 (以中心点在播放器中的宽高百分比存储)
    this._wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const playerRect = playerContainer.getBoundingClientRect();
      const wrapperRect = this._wrapper.getBoundingClientRect();
      const currentCenterX = wrapperRect.left + wrapperRect.width / 2 - playerRect.left;
      const currentCenterY = wrapperRect.top + wrapperRect.height / 2 - playerRect.top;

      initialLeftPct = (currentCenterX / playerRect.width) * 100;
      initialTopPct = (currentCenterY / playerRect.height) * 100;

      this._wrapper.classList.add('ydq-sub-dragging');
      e.preventDefault();
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging || !this._wrapper) return;
      const playerRect = playerContainer.getBoundingClientRect();
      if (playerRect.width === 0 || playerRect.height === 0) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      const dxPct = (dx / playerRect.width) * 100;
      const dyPct = (dy / playerRect.height) * 100;

      const newCx = Math.max(5, Math.min(95, initialLeftPct + dxPct));
      const newCy = Math.max(5, Math.min(95, initialTopPct + dyPct));

      this._applyPositionPercent(newCx, newCy);
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (this._wrapper) {
          this._wrapper.classList.remove('ydq-sub-dragging');
          const playerRect = playerContainer.getBoundingClientRect();
          const wrapperRect = this._wrapper.getBoundingClientRect();
          const cx = ((wrapperRect.left + wrapperRect.width / 2 - playerRect.left) / playerRect.width) * 100;
          const cy = ((wrapperRect.top + wrapperRect.height / 2 - playerRect.top) / playerRect.height) * 100;
          localStorage.setItem('ydq-sub-pos', JSON.stringify({ cx: parseFloat(cx.toFixed(2)), cy: parseFloat(cy.toFixed(2)) }));
        }
      }
    });

    // 2. 滚轮调节字号
    this._wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY < 0 ? 1 : -1;
      const curZh = this._settings.zhFontSize || 22;
      const curEn = this._settings.enFontSize || 16;

      const newZh = Math.min(72, Math.max(14, curZh + delta));
      const newEn = Math.min(54, Math.max(10, Math.round(curEn + delta * 0.75)));

      this._settings.zhFontSize = newZh;
      this._settings.enFontSize = newEn;

      if (this._zhElement) this._zhElement.style.fontSize = `${newZh}px`;
      if (this._enElement) this._enElement.style.fontSize = `${newEn}px`;

      localStorage.setItem('ydq-sub-font', JSON.stringify({ zhFontSize: newZh, enFontSize: newEn }));
      this._showFontToast(`中 ${newZh}px / 英 ${newEn}px`);
    });

    // 3. 双击复位
    this._wrapper.addEventListener('dblclick', (e) => {
      e.preventDefault();
      localStorage.removeItem('ydq-sub-pos');
      this._applyDefaultPosition();
      this._showFontToast('字幕位置已复位');
    });
  },

  /**
   * 应用百分比位置
   */
  _applyPositionPercent(cx, cy) {
    if (!this._wrapper || !this._container) return;
    this._container.style.bottom = 'auto';
    this._container.style.top = '0';
    this._container.style.left = '0';
    this._container.style.width = '100%';
    this._container.style.height = '100%';
    this._container.style.pointerEvents = 'none';

    this._wrapper.style.position = 'absolute';
    this._wrapper.style.left = `${cx}%`;
    this._wrapper.style.top = `${cy}%`;
    this._wrapper.style.bottom = 'auto';
    this._wrapper.style.transform = 'translate(-50%, -50%)';
    this._wrapper.style.pointerEvents = 'auto';
  },

  /**
   * 恢复默认位置
   */
  _applyDefaultPosition() {
    if (!this._wrapper || !this._container) return;
    const pos = (this._settings && this._settings.subtitlePosition) || 10;
    this._applyPositionPercent(50, 100 - pos);
  },

  /**
   * 临时显示字号或提示
   */
  _showFontToast(text) {
    if (!this._fontToast) return;
    this._fontToast.textContent = text;
    this._fontToast.classList.add('ydq-visible');

    if (this._fontToastTimer) clearTimeout(this._fontToastTimer);
    this._fontToastTimer = setTimeout(() => {
      this._fontToast?.classList.remove('ydq-visible');
    }, 1200);
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
    const wrapper = this._wrapper || document.getElementById('ydq-subtitle-wrapper');
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
          wrapper.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
          break;
      }
    }

    // 描边效果
    const strokeStyle = s.subtitleStroke !== false
      ? '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.6), 1px 1px 2px rgba(0,0,0,0.8)'
      : 'none';
    this._zhElement.style.textShadow = strokeStyle;
    this._enElement.style.textShadow = strokeStyle;

    // 定位处理
    try {
      const savedPos = JSON.parse(localStorage.getItem('ydq-sub-pos') || 'null');
      if (savedPos && typeof savedPos.cx === 'number' && typeof savedPos.cy === 'number') {
        this._applyPositionPercent(savedPos.cx, savedPos.cy);
      } else {
        this._applyDefaultPosition();
      }
    } catch (e) {
      this._applyDefaultPosition();
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

    const index = this._findSubtitleIndex(currentTimeMs);

    if (index === this._currentIndex) return;
    this._currentIndex = index;

    if (index === -1) {
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

    const wrapper = this._wrapper || document.getElementById('ydq-subtitle-wrapper');
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
    const wrapper = this._wrapper || document.getElementById('ydq-subtitle-wrapper');
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
