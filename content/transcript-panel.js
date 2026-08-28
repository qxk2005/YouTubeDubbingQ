/**
 * YouTubeDubbingQ - 中英对照逐字稿面板 (右侧侧边栏原生吸附模式)
 * 核心特性：
 * 1. 深度内嵌至 YouTube 右侧推荐侧边栏 (#secondary-inner)，Sticky 随页面滑动
 * 2. 动态像素级与视频播放器等高对齐 (ResizeObserver 实时追踪)
 * 3. 毫秒级跟播高亮算法，带句子间隙防闪烁防掉落机制
 * 4. 智能居中平滑自动滚动（黄金视口 35%~40% 位置），带手动阅读手势保护
 * 5. 关键词实时全文检索、高亮与上下项快速跳转
 * 6. 点击任意句子/时间码瞬间跳播定位
 * 7. 一键导出中英双语对齐 SRT 字幕
 */

const TranscriptPanel = {
  _panel: null,
  _listContainer: null,
  _searchInput: null,
  _matchCountEl: null,
  _statusBadge: null,
  _subtitles: [],
  _rowElements: [],
  _currentIndex: -1,
  _autoScrolling: false,
  _lastUserScrollTime: 0,
  _searchMatches: [], // 匹配的行 index
  _currentMatchIdx: -1,
  _searchQuery: '',
  _callbacks: {},
  _isOpen: false,
  _playerObserver: null,

  /**
   * 初始化面板
   * @param {Object} callbacks 回调函数 { onSeek: (timeSec) => void, onExportSrt: () => void, onClose: () => void }
   */
  init(callbacks) {
    this._callbacks = callbacks || {};
    this._removeExisting();
    this._createPanel();
  },

  /**
   * 移除已存在面板
   */
  _removeExisting() {
    this._stopPlayerObserver();
    const existing = document.getElementById('ydq-transcript-panel');
    if (existing) existing.remove();
    this._panel = null;
    this._rowElements = [];
  },

  /**
   * 创建面板 DOM 结构并内嵌至 YouTube 侧边栏
   */
  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'ydq-transcript-panel';
    panel.className = 'ydq-transcript-panel';
    panel.style.display = 'none';

    panel.innerHTML = `
      <div class="ydq-transcript-header" id="ydq-tr-header">
        <div class="ydq-transcript-header-title">
          <svg class="ydq-icon-transcript" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <span>中英双语逐字稿</span>
          <span class="ydq-tr-badge" id="ydq-tr-status-badge">准备就绪</span>
        </div>
        <div class="ydq-transcript-header-actions">
          <button class="ydq-tr-header-btn" id="ydq-tr-btn-export" title="导出双语 SRT 字幕">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            导出 SRT
          </button>
          <button class="ydq-tr-header-btn ydq-tr-close-btn" id="ydq-tr-btn-close" title="收起逐字稿面板">✕</button>
        </div>
      </div>

      <div class="ydq-transcript-search-bar">
        <div class="ydq-search-input-wrapper">
          <svg class="ydq-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" id="ydq-tr-search-input" placeholder="搜索中英文逐字稿..." />
          <span class="ydq-search-count" id="ydq-tr-search-count"></span>
        </div>
        <div class="ydq-search-nav">
          <button class="ydq-search-nav-btn" id="ydq-tr-search-prev" title="上一个 (Shift+Enter)">▲</button>
          <button class="ydq-search-nav-btn" id="ydq-tr-search-next" title="下一个 (Enter)">▼</button>
          <button class="ydq-search-nav-btn ydq-search-clear-btn" id="ydq-tr-search-clear" title="清空搜索">✕</button>
        </div>
      </div>

      <div class="ydq-transcript-list" id="ydq-tr-list">
        <div class="ydq-tr-empty">暂无可用字幕数据</div>
      </div>
    `;

    this._panel = panel;
    this._listContainer = panel.querySelector('#ydq-tr-list');
    this._searchInput = panel.querySelector('#ydq-tr-search-input');
    this._matchCountEl = panel.querySelector('#ydq-tr-search-count');
    this._statusBadge = panel.querySelector('#ydq-tr-status-badge');

    this._mountToSecondarySidebar();
    this._bindEvents();
  },

  /**
   * 将面板挂载到 YouTube 右侧侧边栏容器中
   */
  _mountToSecondarySidebar() {
    if (!this._panel) return;

    // 优先挂载在 #secondary-inner 的顶部（即 #related 之前）
    const secondaryInner =
      document.querySelector('#secondary-inner') ||
      document.querySelector('#secondary') ||
      document.querySelector('ytd-watch-flexy #secondary');

    if (secondaryInner) {
      if (this._panel.parentNode !== secondaryInner) {
        if (secondaryInner.firstChild) {
          secondaryInner.insertBefore(this._panel, secondaryInner.firstChild);
        } else {
          secondaryInner.appendChild(this._panel);
        }
      }
      return;
    }

    // 兜底挂载
    const related = document.querySelector('#related');
    if (related && related.parentNode) {
      if (this._panel.parentNode !== related.parentNode) {
        related.parentNode.insertBefore(this._panel, related);
      }
      return;
    }

    if (this._panel.parentNode !== document.body) {
      document.body.appendChild(this._panel);
    }
  },

  /**
   * 实时同步播放器高度 (与视频播放器等高对齐)
   */
  _syncWithPlayerHeight() {
    if (!this._panel) return;

    const player =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('#player-container') ||
      document.querySelector('ytd-player');

    if (player) {
      const playerHeight = player.clientHeight || player.offsetHeight;
      if (playerHeight > 100) {
        this._panel.style.height = `${playerHeight}px`;
        this._panel.style.maxHeight = `${playerHeight}px`;
      }
    }
  },

  /**
   * 启动播放器高度监听器
   */
  _startPlayerObserver() {
    this._stopPlayerObserver();

    const player =
      document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('#player-container') ||
      document.querySelector('ytd-player');

    if (player && typeof ResizeObserver !== 'undefined') {
      this._playerObserver = new ResizeObserver(() => {
        this._syncWithPlayerHeight();
      });
      this._playerObserver.observe(player);
    }

    this._syncWithPlayerHeight();
    window.addEventListener('resize', this._onWindowResize);
  },

  _onWindowResize() {
    TranscriptPanel._syncWithPlayerHeight();
  },

  /**
   * 停止播放器高度监听器
   */
  _stopPlayerObserver() {
    if (this._playerObserver) {
      this._playerObserver.disconnect();
      this._playerObserver = null;
    }
    window.removeEventListener('resize', this._onWindowResize);
  },

  /**
   * 绑定事件
   */
  _bindEvents() {
    if (!this._panel) return;

    // 1. 关闭按钮
    this._panel.querySelector('#ydq-tr-btn-close')?.addEventListener('click', () => {
      this.hide();
      if (this._callbacks.onClose) {
        this._callbacks.onClose();
      }
    });

    // 2. 导出 SRT
    this._panel.querySelector('#ydq-tr-btn-export')?.addEventListener('click', () => {
      if (this._callbacks.onExportSrt) {
        this._callbacks.onExportSrt();
      }
    });

    // 3. 手动滚动检测（保护用户主动查看历史/未来句子时不被自动滚动强行打断）
    this._listContainer?.addEventListener('scroll', () => {
      if (!this._autoScrolling) {
        this._lastUserScrollTime = Date.now();
      }
    });

    // 4. 搜索功能
    this._searchInput?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value.trim().toLowerCase();
      this._executeSearch();
    });

    this._searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          this._navigateSearch(-1);
        } else {
          this._navigateSearch(1);
        }
        e.preventDefault();
      }
    });

    this._panel.querySelector('#ydq-tr-search-prev')?.addEventListener('click', () => this._navigateSearch(-1));
    this._panel.querySelector('#ydq-tr-search-next')?.addEventListener('click', () => this._navigateSearch(1));
    this._panel.querySelector('#ydq-tr-search-clear')?.addEventListener('click', () => {
      if (this._searchInput) this._searchInput.value = '';
      this._searchQuery = '';
      this._executeSearch();
    });
  },

  /**
   * 渲染字幕逐字稿列表
   * @param {Array} subtitles 字幕数组
   */
  render(subtitles) {
    this._subtitles = subtitles || [];
    this._currentIndex = -1;
    this._rowElements = [];

    if (!this._listContainer) return;

    if (this._subtitles.length === 0) {
      this._listContainer.innerHTML = '<div class="ydq-tr-empty">暂无可用字幕数据</div>';
      return;
    }

    this._listContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      const startSec = (sub.startMs || 0) / 1000;
      const timeStr = this._formatTime(startSec);

      const row = document.createElement('div');
      row.className = 'ydq-transcript-row';
      row.dataset.index = i;
      row.dataset.startMs = sub.startMs;
      row.dataset.endMs = sub.endMs;

      row.innerHTML = `
        <button class="ydq-tr-time-tag" title="点击跳转到 ${timeStr}">${timeStr}</button>
        <div class="ydq-tr-text-group">
          <div class="ydq-tr-zh-text">${this._escapeHTML(sub.zhText || '（翻译中...）')}</div>
          <div class="ydq-tr-en-text">${this._escapeHTML(sub.text || '')}</div>
        </div>
      `;

      // 点击跳转播放
      row.addEventListener('click', () => {
        const timeSec = (sub.startMs || 0) / 1000;
        if (this._callbacks.onSeek) {
          this._callbacks.onSeek(timeSec);
        }
      });

      fragment.appendChild(row);
      this._rowElements.push(row);
    }

    this._listContainer.appendChild(fragment);

    // 渲染完成后立即检查当前播放时间并高亮
    const video = document.querySelector('video');
    if (video) {
      this.onTimeUpdate(video.currentTime * 1000, true);
    }

    if (this._searchQuery) {
      this._executeSearch();
    }
  },

  /**
   * 更新单条或批量字幕的中文译文
   */
  updateCues(subtitles) {
    this._subtitles = subtitles || [];
    if (!this._rowElements.length || this._rowElements.length !== this._subtitles.length) {
      this.render(this._subtitles);
      return;
    }

    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      const row = this._rowElements[i];
      if (!row) continue;

      const zhEl = row.querySelector('.ydq-tr-zh-text');
      if (zhEl && sub.zhText) {
        if (this._searchQuery) {
          zhEl.innerHTML = this._highlightText(sub.zhText, this._searchQuery);
        } else {
          zhEl.textContent = sub.zhText;
        }
      }
    }
  },

  /**
   * 二分与间隙防抖查找当前活跃字幕索引
   * @param {number} currentTimeMs 当前毫秒
   * @returns {number} 匹配索引或 -1
   */
  _findActiveSubtitleIndex(currentTimeMs) {
    const subs = this._subtitles;
    if (!subs || !subs.length) return -1;

    // 1. 精确区间匹配 (二分加速)
    let low = 0, high = subs.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (subs[mid].startMs <= currentTimeMs) {
        if (subs[mid].endMs >= currentTimeMs) {
          return mid;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // 2. 停顿间隙防闪烁机制：
    // 若当前时间处于两句字幕的停顿间隙中 (< 2.5s)，保持高亮前一句，避免视觉闪烁
    for (let i = 1; i < subs.length; i++) {
      const prev = subs[i - 1];
      const curr = subs[i];
      if (currentTimeMs > prev.endMs && currentTimeMs < curr.startMs) {
        if (currentTimeMs - prev.endMs < 2500) {
          return i - 1;
        }
      }
    }

    // 3. 最后一句结尾的延时保持 (2.5s)
    const last = subs[subs.length - 1];
    if (currentTimeMs >= last.startMs && currentTimeMs <= last.endMs + 2500) {
      return subs.length - 1;
    }

    return -1;
  },

  /**
   * 视频播放时的时间轴更新与智能居中滚动
   * @param {number} currentTimeMs 当前视频播放毫秒
   * @param {boolean} [forceScroll=false] 是否强制滚动定位
   */
  onTimeUpdate(currentTimeMs, forceScroll = false) {
    if (!this._isOpen || !this._rowElements.length) return;

    const activeIdx = this._findActiveSubtitleIndex(currentTimeMs);

    if (activeIdx !== this._currentIndex) {
      // 移除上一句高亮
      if (this._currentIndex >= 0 && this._rowElements[this._currentIndex]) {
        this._rowElements[this._currentIndex].classList.remove('ydq-transcript-row-active');
      }

      this._currentIndex = activeIdx;

      if (activeIdx >= 0 && this._rowElements[activeIdx]) {
        const activeRow = this._rowElements[activeIdx];
        activeRow.classList.add('ydq-transcript-row-active');

        // 智能平滑居中滚动：
        // 若用户 4 秒内没有手动滚动（或 forceScroll），则平滑滚动使当前句处于视口 35% 偏上的黄金阅读区
        const now = Date.now();
        if (forceScroll || now - this._lastUserScrollTime > 4000) {
          this._autoScrolling = true;
          const container = this._listContainer;
          if (container) {
            const rowTop = activeRow.offsetTop;
            const targetScrollTop = Math.max(0, rowTop - container.clientHeight * 0.35);
            container.scrollTo({
              top: targetScrollTop,
              behavior: 'smooth',
            });
          }
          setTimeout(() => {
            this._autoScrolling = false;
          }, 300);
        }
      }
    }
  },

  /**
   * 更新翻译进度徽章
   */
  updateStatus(status) {
    if (!this._statusBadge) return;

    if (!status) {
      this._statusBadge.textContent = '准备就绪';
      this._statusBadge.className = 'ydq-tr-badge';
      return;
    }

    if (status.allDone || status.progressPct === 100) {
      this._statusBadge.textContent = '100% 完成';
      this._statusBadge.className = 'ydq-tr-badge ydq-tr-badge-done';
    } else if (status.translating) {
      this._statusBadge.textContent = `翻译中 ${status.progressPct}%`;
      this._statusBadge.className = 'ydq-tr-badge ydq-tr-badge-translating';
    } else {
      this._statusBadge.textContent = `已就绪 ${status.progressPct}%`;
      this._statusBadge.className = 'ydq-tr-badge';
    }
  },

  /**
   * 搜索匹配
   */
  _executeSearch() {
    this._searchMatches = [];
    this._currentMatchIdx = -1;

    if (!this._searchQuery) {
      if (this._matchCountEl) this._matchCountEl.textContent = '';
      for (let i = 0; i < this._subtitles.length; i++) {
        const row = this._rowElements[i];
        if (!row) continue;
        const sub = this._subtitles[i];
        const zhEl = row.querySelector('.ydq-tr-zh-text');
        const enEl = row.querySelector('.ydq-tr-en-text');
        if (zhEl) zhEl.textContent = sub.zhText || '（翻译中...）';
        if (enEl) enEl.textContent = sub.text || '';
        row.classList.remove('ydq-tr-match-row', 'ydq-tr-current-match');
      }
      return;
    }

    const q = this._searchQuery;
    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      const row = this._rowElements[i];
      if (!row) continue;

      const zh = (sub.zhText || '').toLowerCase();
      const en = (sub.text || '').toLowerCase();
      const match = zh.includes(q) || en.includes(q);

      const zhEl = row.querySelector('.ydq-tr-zh-text');
      const enEl = row.querySelector('.ydq-tr-en-text');

      if (match) {
        this._searchMatches.push(i);
        row.classList.add('ydq-tr-match-row');
        if (zhEl) zhEl.innerHTML = this._highlightText(sub.zhText || '', q);
        if (enEl) enEl.innerHTML = this._highlightText(sub.text || '', q);
      } else {
        row.classList.remove('ydq-tr-match-row', 'ydq-tr-current-match');
        if (zhEl) zhEl.textContent = sub.zhText || '（翻译中...）';
        if (enEl) enEl.textContent = sub.text || '';
      }
    }

    if (this._searchMatches.length > 0) {
      this._currentMatchIdx = 0;
      this._updateSearchMatchHighlight();
    } else {
      if (this._matchCountEl) this._matchCountEl.textContent = '0 / 0';
    }
  },

  /**
   * 搜索匹配项导航
   */
  _navigateSearch(direction) {
    if (!this._searchMatches.length) return;

    this._currentMatchIdx =
      (this._currentMatchIdx + direction + this._searchMatches.length) % this._searchMatches.length;
    this._updateSearchMatchHighlight();
  },

  _updateSearchMatchHighlight() {
    if (!this._searchMatches.length || this._currentMatchIdx < 0) return;

    const rowIdx = this._searchMatches[this._currentMatchIdx];
    if (this._matchCountEl) {
      this._matchCountEl.textContent = `${this._currentMatchIdx + 1} / ${this._searchMatches.length}`;
    }

    for (let i = 0; i < this._rowElements.length; i++) {
      this._rowElements[i]?.classList.remove('ydq-tr-current-match');
    }

    const matchRow = this._rowElements[rowIdx];
    if (matchRow) {
      matchRow.classList.add('ydq-tr-current-match');
      this._autoScrolling = true;
      const container = this._listContainer;
      if (container) {
        const targetTop = Math.max(0, matchRow.offsetTop - container.clientHeight * 0.35);
        container.scrollTo({ top: targetTop, behavior: 'smooth' });
      }
      setTimeout(() => {
        this._autoScrolling = false;
      }, 300);
    }
  },

  _highlightText(text, query) {
    if (!query || !text) return this._escapeHTML(text);
    const regex = new RegExp(`(${this._escapeRegExp(query)})`, 'gi');
    return this._escapeHTML(text).replace(regex, '<mark class="ydq-highlight">$1</mark>');
  },

  _formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const restS = s % 60;
    return `${m}:${String(restS).padStart(2, '0')}`;
  },

  _escapeHTML(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  toggle() {
    if (this._isOpen) this.hide();
    else this.show();
  },

  show() {
    if (!this._panel) this._createPanel();
    this._mountToSecondarySidebar();
    this._panel.style.display = 'flex';
    this._isOpen = true;
    this._startPlayerObserver();

    // 打开时立即更新一次高亮并强制滚动居中
    const video = document.querySelector('video');
    if (video) {
      this.onTimeUpdate(video.currentTime * 1000, true);
    }
  },

  hide() {
    this._stopPlayerObserver();
    if (this._panel) this._panel.style.display = 'none';
    this._isOpen = false;
  },

  isOpen() {
    return this._isOpen;
  },
};

if (typeof window !== 'undefined') {
  window.TranscriptPanel = TranscriptPanel;
}
