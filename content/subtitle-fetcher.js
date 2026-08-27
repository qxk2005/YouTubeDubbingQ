/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (全能强化版 v4)
 * 1. DOM 隐藏节点直读 (0ms 无延迟)
 * 2. HTML5 video.textTracks 运行时 cues 提取 (绝对保底)
 * 3. XML (<text> 和 <p> 标签) / JSON3 / WebVTT 全能解析引擎
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
   * 通道 1: 从 DOM 隐藏节点直读 captionTracks (0ms 零开销)
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
   * 通道 2: 通过 CustomEvent 主动向 Main World 请求并等待
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
   * 通过 CustomEvent 代理拉取字幕内容 (带凭证，不破坏签名)
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
          reject(new Error('请求字幕内容超时 (10s)'));
        }
      }, 10000);
    });
  },

  /**
   * 通道 3 (终极保底): 直接从 HTML5 <video> 元素的 textTracks 中提取 cues
   * @returns {Array}
   */
  extractFromHTML5VideoTracks() {
    const video = document.querySelector('video');
    if (!video || !video.textTracks || video.textTracks.length === 0) return [];

    console.log(`[YDQ] 正在检查 HTML5 video.textTracks (发现 ${video.textTracks.length} 个原生轨道)...`);

    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      if (track.cues && track.cues.length > 0) {
        console.log(`[YDQ] ✓ 在 textTracks[${i}] (${track.language || track.label}) 发现 ${track.cues.length} 条原生 cues！`);
        const subtitles = [];
        for (let j = 0; j < track.cues.length; j++) {
          const cue = track.cues[j];
          const text = cue.text ? cue.text.trim() : '';
          if (text) {
            subtitles.push({
              text: this._decodeHtmlEntities(text.replace(/<[^>]*>/g, '')),
              startMs: Math.round(cue.startTime * 1000),
              endMs: Math.round(cue.endTime * 1000),
              index: j,
              zhText: '',
            });
          }
        }
        if (subtitles.length > 0) {
          return subtitles;
        }
      }
    }

    return [];
  },

  /**
   * 获取并筛选最佳可用字幕轨列表
   * @returns {Promise<Array>}
   */
  async getAvailableTracks() {
    const videoId = this.getVideoId();

    // 1. 同步直读
    let tracks = this._readTracksFromDOMStore();
    if (tracks && tracks.length > 0) {
      return this._sortTracks(tracks);
    }

    // 2. CustomEvent 轮询请求 (最多 6 次，每次 500ms)
    for (let attempt = 1; attempt <= 6; attempt++) {
      tracks = this._readTracksFromDOMStore();
      if (tracks && tracks.length > 0) {
        return this._sortTracks(tracks);
      }

      tracks = await this._requestTracksViaCustomEvent(videoId);
      if (tracks && tracks.length > 0) {
        return this._sortTracks(tracks);
      }

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
              console.log(`[YDQ] ✓ 成功解析出 ${subs.length} 条字幕 (来自轨道: ${track.languageCode})`);
              return subs;
            }
          }
        } catch (err) {
          console.warn(`[YDQ] 字幕轨 [${track.languageCode}] 下载异常:`, err.message);
        }
      }
    }

    // 阶段 2 (终极保底): 尝试从 HTML5 视频播放器的 textTracks cues 直接提取
    const cuesSubs = this.extractFromHTML5VideoTracks();
    if (cuesSubs && cuesSubs.length > 0) {
      console.log(`[YDQ] ✓ 成功从 HTML5 video.textTracks 提取到 ${cuesSubs.length} 条实时字幕！`);
      return cuesSubs;
    }

    throw new Error('未能提取到当前视频的字幕，请确保 YouTube 视频有可用的 CC 字幕');
  },

  /**
   * 全能解析器：XML (<text> 或 <p>) / JSON3 / WebVTT
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
