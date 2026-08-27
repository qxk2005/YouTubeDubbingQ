/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (增强版 v2)
 * 通过 postMessage 与 Main World 宿主脚本通信，提取真实 captionTracks
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
   * 向 Main World 请求获取当前视频的字幕轨道列表
   * @returns {Promise<Array>}
   */
  async requestTracksFromMainWorld() {
    return new Promise((resolve) => {
      const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      let resolved = false;

      const handler = (event) => {
        if (
          event.source === window &&
          event.data?.type === 'YDQ_RESPONSE_TRACKS' &&
          event.data?.requestId === requestId
        ) {
          if (!resolved) {
            resolved = true;
            window.removeEventListener('message', handler);
            resolve(event.data.tracks || []);
          }
        }
      };

      window.addEventListener('message', handler);

      window.postMessage(
        {
          type: 'YDQ_REQUEST_TRACKS',
          requestId,
        },
        '*'
      );

      // 超时处理 (1.5 秒)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', handler);
          resolve([]);
        }
      }, 1500);
    });
  },

  /**
   * 通过 Main World 宿主环境请求字幕内容文本
   * @param {string} url 字幕 URL
   * @returns {Promise<string>}
   */
  async fetchSubtitleTextViaBridge(url) {
    return new Promise((resolve, reject) => {
      const requestId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      let resolved = false;

      const handler = (event) => {
        if (
          event.source === window &&
          event.data?.type === 'YDQ_RESPONSE_SUBTITLE_TEXT' &&
          event.data?.requestId === requestId
        ) {
          if (!resolved) {
            resolved = true;
            window.removeEventListener('message', handler);
            if (event.data.success) {
              resolve(event.data.text);
            } else {
              reject(new Error(event.data.error || '获取字幕内容失败'));
            }
          }
        }
      };

      window.addEventListener('message', handler);

      window.postMessage(
        {
          type: 'YDQ_FETCH_SUBTITLE_TEXT',
          requestId,
          url,
        },
        '*'
      );

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', handler);
          reject(new Error('请求字幕内容超时'));
        }
      }, 8000);
    });
  },

  /**
   * 从 DOM 或 Script 标签中正则提取字幕轨（回退方案）
   * @returns {Array}
   */
  _getCaptionTracksFromDOM() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes('captionTracks')) {
          const match = text.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {}
          }
        }
      }
      return [];
    } catch (e) {
      return [];
    }
  },

  /**
   * 获取并筛选最佳可用字幕轨列表
   * @returns {Promise<Array>}
   */
  async getAvailableTracks() {
    // 1. 尝试从 Main World 获取
    let tracks = await this.requestTracksFromMainWorld();

    // 2. 如果未获取到，等待 600ms 重试一次（播放器可能刚加载完成）
    if (!tracks || tracks.length === 0) {
      await new Promise((r) => setTimeout(r, 600));
      tracks = await this.requestTracksFromMainWorld();
    }

    // 3. 回退尝试 DOM 解析
    if (!tracks || tracks.length === 0) {
      tracks = this._getCaptionTracksFromDOM();
    }

    if (!tracks || tracks.length === 0) {
      return [];
    }

    // 排序：人工英文 -> 自动生成英文 -> 其他人工语言 -> 其他自动语言
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
   * 获取字幕数据（主入口）
   * @returns {Promise<Array<{text: string, startMs: number, endMs: number, index: number}>>}
   */
  async fetchSubtitles() {
    const videoId = this.getVideoId();
    if (!videoId) {
      throw new Error('未检测到有效视频 ID，请确认位于 YouTube 视频播放页');
    }

    const tracks = await this.getAvailableTracks();

    if (tracks && tracks.length > 0) {
      for (const track of tracks) {
        try {
          let baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          console.log(`[YDQ] 正在尝试字幕轨: [${track.languageCode}] ${track.name?.simpleText || ''}`);

          // 优先尝试 JSON3 格式
          let fetchUrl = baseUrl;
          if (!fetchUrl.includes('fmt=json3') && !fetchUrl.includes('fmt=')) {
            fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + 'fmt=json3';
          }

          let rawText = '';
          try {
            rawText = await this.fetchSubtitleTextViaBridge(fetchUrl);
          } catch (e) {
            // 如果加了 fmt=json3 报错，尝试原 baseUrl
            rawText = await this.fetchSubtitleTextViaBridge(baseUrl);
          }

          if (rawText && rawText.trim()) {
            const subs = this._parseRawSubtitle(rawText);
            if (subs && subs.length > 0) {
              console.log(`[YDQ] 成功解析到 ${subs.length} 条字幕 (来自轨道 ${track.languageCode})`);
              return subs;
            }
          }
        } catch (err) {
          console.warn(`[YDQ] 轨道 [${track.languageCode}] 获取失败:`, err.message);
        }
      }
    }

    throw new Error('该视频未提供任何可识别的字幕（CC），请尝试包含字幕的视频');
  },

  /**
   * 解析原始字幕文本（自动识别 JSON3 或 XML）
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

    // 2. XML 格式
    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    return [];
  },

  /**
   * 解析 JSON3 格式
   * @param {Object} data
   * @returns {Array}
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
   * 解析 XML 格式 (<transcript><text start="1.2" dur="2.3">hello</text></transcript>)
   * @param {string} xmlText
   * @returns {Array}
   */
  _parseXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const textNodes = xmlDoc.getElementsByTagName('text');

    if (!textNodes || textNodes.length === 0) return [];

    const subtitles = [];
    let index = 0;

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];
      const rawText = node.textContent?.trim();
      if (!rawText) continue;

      const startSec = parseFloat(node.getAttribute('start') || '0');
      const durSec = parseFloat(node.getAttribute('dur') || '3');

      const startMs = Math.round(startSec * 1000);
      const endMs = Math.round((startSec + durSec) * 1000);

      subtitles.push({
        text: this._decodeHtmlEntities(rawText),
        startMs,
        endMs,
        index: index++,
        zhText: '',
      });
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
