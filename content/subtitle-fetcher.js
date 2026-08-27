/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (深度增强版 v3)
 * 通过 Main World 宿主通信 + Innertube API 官方通道 + 5秒异步重试
 * 绝不篡改带签名的 baseUrl，支持 XML 与 JSON3 格式字幕
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
   * @param {string} videoId 视频 ID
   * @returns {Promise<Array>}
   */
  async requestTracksFromMainWorld(videoId) {
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
          videoId,
        },
        '*'
      );

      // 超时处理 (2.5 秒)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', handler);
          resolve([]);
        }
      }, 2500);
    });
  },

  /**
   * 通过 Main World 宿主环境请求字幕内容文本（保持原汁原味的签名 URL）
   * @param {string} url 原样带签名的字幕 URL
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
      }, 10000);
    });
  },

  /**
   * 从 DOM 或 Script 标签中正则提取字幕轨（DOM 回退方案）
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
   * 异步轮询获取最佳可用字幕轨列表（最多重试 10 次，总计 5 秒）
   * @returns {Promise<Array>}
   */
  async getAvailableTracks() {
    const videoId = this.getVideoId();
    if (!videoId) return [];

    const maxRetries = 10;
    const retryInterval = 500;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[YDQ] 正在检测字幕轨道 (第 ${attempt}/${maxRetries} 次探测)...`);

      // 1. 尝试从 Main World / Innertube 获取
      let tracks = await this.requestTracksFromMainWorld(videoId);

      // 2. 尝试从 DOM 正则提取
      if (!tracks || tracks.length === 0) {
        tracks = this._getCaptionTracksFromDOM();
      }

      if (tracks && tracks.length > 0) {
        console.log(`[YDQ] 第 ${attempt} 次探测成功，发现 ${tracks.length} 个字幕轨`);
        return this._sortTracks(tracks);
      }

      // 等待下一次重试
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryInterval));
      }
    }

    console.warn('[YDQ] 经过 5 秒轮询未发现字幕轨');
    return [];
  },

  /**
   * 字幕轨道优先级排序
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
   * 获取并解析字幕数据（主入口）
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
          const baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          console.log(`[YDQ] 正在下载字幕: [${track.languageCode}] ${track.name?.simpleText || ''}`);

          // 原样请求带签名的 URL，绝不随意追加破坏签名的参数
          const rawText = await this.fetchSubtitleTextViaBridge(baseUrl);

          if (rawText && rawText.trim()) {
            const subs = this._parseRawSubtitle(rawText);
            if (subs && subs.length > 0) {
              console.log(`[YDQ] ✓ 成功解析出 ${subs.length} 条有效字幕 (来自轨道: ${track.languageCode})`);
              return subs;
            }
          }
        } catch (err) {
          console.warn(`[YDQ] 字幕轨 [${track.languageCode}] 下载失败:`, err.message);
        }
      }
    }

    throw new Error('该视频未提供任何可识别的字幕（CC），请尝试包含字幕的视频');
  },

  /**
   * 自动识别并解析 XML 或 JSON3 格式字幕
   * @param {string} rawText 原始响应文本
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
      } catch (e) {
        console.warn('[YDQ] JSON3 解析失败:', e.message);
      }
    }

    // 2. XML 格式 (<transcript><text start="1.2" dur="3.4">...</text></transcript>)
    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.warn('[YDQ] XML 解析失败:', e.message);
      }
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
   * 解析 XML 格式
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
