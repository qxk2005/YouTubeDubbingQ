/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (全能强化版 v5)
 * 1. 自动读取 Main World 拦截到的播放器 timedtext 真实字幕数据
 * 2. 括号匹配算法 (Bracket Matcher) 从页面脚本提取 captionTracks
 * 3. 0ms DOM 同步直读与 CustomEvent 通信
 * 4. 支持 XML (<p> 和 <text> 标签) / JSON3 / WebVTT 全能解析
 */

const SubtitleFetcher = {
  /**
   * 获取当前视频 ID
   * @returns {string|null}
   */
  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  },

  /**
   * 括号匹配算法：精准提取包含嵌套数组的 JSON
   * @param {string} text
   * @param {string} key
   * @returns {Array|null}
   */
  _extractJsonArray(text, key) {
    if (!text) return null;
    const keyIdx = text.indexOf(key);
    if (keyIdx === -1) return null;

    const startIdx = text.indexOf('[', keyIdx + key.length);
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[') depth++;
        else if (char === ']') {
          depth--;
          if (depth === 0) {
            const jsonStr = text.substring(startIdx, i + 1);
            try {
              return JSON.parse(jsonStr);
            } catch (e) {
              return null;
            }
          }
        }
      }
    }

    return null;
  },

  /**
   * 通道 0: 检查是否已有拦截器捕获到的原始字幕文本
   * @returns {Array}
   */
  _getCapturedSubtitle() {
    try {
      const store = document.getElementById('ydq-captured-subtitle-store');
      if (store && store.textContent && store.textContent.trim()) {
        const parsed = this._parseRawSubtitle(store.textContent);
        if (parsed && parsed.length > 0) {
          console.log(`[YDQ] ✓ 直接从网络拦截器获取到 ${parsed.length} 条已捕获的字幕！`);
          return parsed;
        }
      }
    } catch (e) {}
    return [];
  },

  /**
   * 通道 1: 从 DOM 隐藏节点直读 captionTracks (0ms)
   * @returns {Array}
   */
  _readTracksFromDOMStore() {
    try {
      const container = document.getElementById('ydq-caption-tracks-store');
      if (container && container.textContent) {
        const list = JSON.parse(container.textContent);
        if (Array.isArray(list) && list.length > 0) {
          return list;
        }
      }
    } catch (e) {}
    return [];
  },

  /**
   * 通道 2: 扫描当前页面所有 <script> 标签并用括号匹配算法提取
   * @returns {Array}
   */
  _extractTracksFromPageScripts() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const list = this._extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(list) && list.length > 0) {
            return list;
          }
        }
      }
    } catch (e) {}
    return [];
  },

  /**
   * 通道 3: 通过 CustomEvent 主动向 Main World 请求
   * @param {string} videoId
   * @returns {Promise<Array>}
   */
  async _requestTracksViaCustomEvent(videoId) {
    return new Promise((resolve) => {
      let resolved = false;

      const handler = (e) => {
        if (!resolved) {
          resolved = true;
          document.removeEventListener('YDQ_EVENT_RESPONSE_TRACKS', handler);
          resolve(e.detail?.tracks || []);
        }
      };

      document.addEventListener('YDQ_EVENT_RESPONSE_TRACKS', handler);
      document.dispatchEvent(
        new CustomEvent('YDQ_EVENT_REQUEST_TRACKS', { detail: { videoId } })
      );

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          document.removeEventListener('YDQ_EVENT_RESPONSE_TRACKS', handler);
          resolve([]);
        }
      }, 2000);
    });
  },

  /**
   * 代理拉取带签名的字幕 URL
   * @param {string} url
   * @returns {Promise<string>}
   */
  async fetchSubtitleTextViaBridge(url) {
    return new Promise((resolve, reject) => {
      const requestId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      let resolved = false;

      const handler = (e) => {
        if (e.detail?.requestId === requestId && !resolved) {
          resolved = true;
          document.removeEventListener('YDQ_EVENT_FETCH_SUBTITLE_DONE', handler);
          if (e.detail.success) {
            resolve(e.detail.text);
          } else {
            reject(new Error(e.detail.error || '获取字幕内容失败'));
          }
        }
      };

      document.addEventListener('YDQ_EVENT_FETCH_SUBTITLE_DONE', handler);
      document.dispatchEvent(
        new CustomEvent('YDQ_EVENT_FETCH_SUBTITLE', {
          detail: { requestId, url },
        })
      );

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          document.removeEventListener('YDQ_EVENT_FETCH_SUBTITLE_DONE', handler);
          reject(new Error('请求字幕内容超时'));
        }
      }, 10000);
    });
  },

  /**
   * 获取并筛选最佳可用字幕轨列表
   * @returns {Promise<Array>}
   */
  async getAvailableTracks() {
    const videoId = this.getVideoId();

    // 1. 同步直读
    let tracks = this._readTracksFromDOMStore();
    if (tracks && tracks.length > 0) return this._sortTracks(tracks);

    // 2. 页面 script 括号匹配提取
    tracks = this._extractTracksFromPageScripts();
    if (tracks && tracks.length > 0) return this._sortTracks(tracks);

    // 3. CustomEvent 轮询请求 (最多 6 次，每次 500ms)
    for (let attempt = 1; attempt <= 6; attempt++) {
      tracks = this._readTracksFromDOMStore();
      if (tracks && tracks.length > 0) return this._sortTracks(tracks);

      tracks = await this._requestTracksViaCustomEvent(videoId);
      if (tracks && tracks.length > 0) return this._sortTracks(tracks);

      if (attempt < 6) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return [];
  },

  /**
   * 优先级排序
   */
  _sortTracks(tracks) {
    return [...tracks].sort((a, b) => {
      const isEnA = a.languageCode === 'en' || a.languageCode?.startsWith('en');
      const isEnB = b.languageCode === 'en' || b.languageCode?.startsWith('en');
      const isAsrA = a.kind === 'asr';
      const isAsrB = b.kind === 'asr';

      if (isEnA && !isEnB) return -1;
      if (!isEnA && isEnB) return 1;

      if (!isAsrA && isAsrB) return -1;
      if (isAsrA && !isAsrB) return 1;

      return 0;
    });
  },

  /**
   * 获取并解析字幕数据 (主入口)
   * @returns {Promise<Array<{text: string, startMs: number, endMs: number, index: number}>>}
   */
  async fetchSubtitles() {
    const videoId = this.getVideoId();
    if (!videoId) {
      throw new Error('未检测到视频 ID，请确认位于 YouTube 视频播放页');
    }

    // 优先检查：拦截器是否已捕获到字幕
    const captured = this._getCapturedSubtitle();
    if (captured && captured.length > 0) {
      return captured;
    }

    // 阶段 1: 尝试从 captionTracks 下载
    const tracks = await this.getAvailableTracks();
    if (tracks && tracks.length > 0) {
      for (const track of tracks) {
        try {
          const baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          console.log(`[YDQ] 正在下载字幕轨: [${track.languageCode}] ${track.name?.simpleText || ''}`);
          const rawText = await this.fetchSubtitleTextViaBridge(baseUrl);

          if (rawText && rawText.trim()) {
            const subs = this._parseRawSubtitle(rawText);
            if (subs && subs.length > 0) {
              console.log(`[YDQ] ✓ 成功解析出 ${subs.length} 条有效字幕 (来自轨道: ${track.languageCode})`);
              return subs;
            }
          }
        } catch (err) {
          console.warn(`[YDQ] 字幕轨 [${track.languageCode}] 下载异常:`, err.message);
        }
      }
    }

    // 再次检查拦截器
    const capturedAgain = this._getCapturedSubtitle();
    if (capturedAgain && capturedAgain.length > 0) {
      return capturedAgain;
    }

    throw new Error('未能提取到当前视频的字幕，请确保 YouTube 视频有可用的 CC 字幕');
  },

  /**
   * 全能解析器：XML (<p> 或 <text>) / JSON3 / WebVTT
   * @param {string} rawText
   * @returns {Array}
   */
  _parseRawSubtitle(rawText) {
    const trimmed = rawText.trim();

    // 1. JSON3 格式
    if (trimmed.startsWith('{')) {
      try {
        const jsonData = JSON.parse(trimmed);
        const parsed = this._parseJSON3(jsonData);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    // 2. XML 格式 (<transcript> 或 <timedtext>)
    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    // 3. WebVTT 格式
    if (trimmed.includes('-->')) {
      try {
        const parsed = this._parseVTT(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    return [];
  },

  /**
   * 解析 JSON3 格式
   */
  _parseJSON3(data) {
    if (!data || !data.events) return [];

    const subtitles = [];
    let index = 0;

    for (const event of data.events) {
      if (!event.segs) continue;

      const text = event.segs
        .map((seg) => seg.utf8 || '')
        .join('')
        .trim();

      if (!text || text === '\n') continue;

      const startMs = event.tStartMs || 0;
      const durationMs = event.dDurationMs || 3000;
      const endMs = startMs + durationMs;

      subtitles.push({
        text: this._decodeHtmlEntities(text),
        startMs,
        endMs,
        index: index++,
        zhText: '',
      });
    }

    return subtitles;
  },

  /**
   * 全面解析 XML 格式 (兼容 <text> 标签与 <p> 标签)
   */
  _parseXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const subtitles = [];
    let index = 0;

    // 格式 A: <text start="1.23" dur="4.56">...</text>
    const textNodes = xmlDoc.getElementsByTagName('text');
    if (textNodes && textNodes.length > 0) {
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        const raw = node.textContent?.trim();
        if (!raw) continue;

        const startSec = parseFloat(node.getAttribute('start') || '0');
        const durSec = parseFloat(node.getAttribute('dur') || '3');

        subtitles.push({
          text: this._decodeHtmlEntities(raw),
          startMs: Math.round(startSec * 1000),
          endMs: Math.round((startSec + durSec) * 1000),
          index: index++,
          zhText: '',
        });
      }
      if (subtitles.length > 0) return subtitles;
    }

    // 格式 B: <p t="1230" d="4560"><s>...</s></p>
    const pNodes = xmlDoc.getElementsByTagName('p');
    if (pNodes && pNodes.length > 0) {
      for (let i = 0; i < pNodes.length; i++) {
        const node = pNodes[i];
        const raw = node.textContent?.trim();
        if (!raw) continue;

        const startMs = parseInt(node.getAttribute('t') || '0');
        const durMs = parseInt(node.getAttribute('d') || '3000');

        subtitles.push({
          text: this._decodeHtmlEntities(raw),
          startMs,
          endMs: startMs + durMs,
          index: index++,
          zhText: '',
        });
      }
      if (subtitles.length > 0) return subtitles;
    }

    return [];
  },

  /**
   * 解析 VTT 格式
   */
  _parseVTT(vttText) {
    const lines = vttText.split('\n');
    const subtitles = [];
    let index = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      const timeMatch = line.match(
        /(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})/
      );

      if (timeMatch) {
        const parseTime = (h, m, s, ms) => {
          const hours = h ? parseInt(h.replace(':', '')) : 0;
          return hours * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
        };

        const startMs = parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        const endMs = parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);

        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i].trim());
          i++;
        }

        const text = textLines.join(' ').replace(/<[^>]*>/g, '');
        if (text) {
          subtitles.push({
            text: this._decodeHtmlEntities(text),
            startMs,
            endMs,
            index: index++,
            zhText: '',
          });
        }
      }
      i++;
    }

    return subtitles;
  },

  /**
   * HTML 实体反转义
   */
  _decodeHtmlEntities(str) {
    if (!str) return '';
    const txt = document.createElement('textarea');
    txt.innerHTML = str;
    return txt.value;
  },
};

if (typeof window !== 'undefined') {
  window.SubtitleFetcher = SubtitleFetcher;
}
