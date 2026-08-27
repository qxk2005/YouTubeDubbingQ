/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (增强版)
 * 从 YouTube 视频获取原始字幕，支持 JSON3 与 XML 格式，支持多语言自动降级
 */

const SubtitleFetcher = {
  _bridgeInjected: false,

  /**
   * 获取当前视频 ID
   * @returns {string|null}
   */
  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  },

  /**
   * 确保 Main World 桥接脚本已注入
   */
  _ensureBridgeInjected() {
    if (this._bridgeInjected || document.getElementById('ydq-page-bridge')) {
      this._bridgeInjected = true;
      return;
    }

    try {
      const script = document.createElement('script');
      script.id = 'ydq-page-bridge';
      script.src = chrome.runtime.getURL('content/page-bridge.js');
      script.onload = () => {
        this._bridgeInjected = true;
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[YDQ] 注入桥接脚本失败:', e);
    }
  },

  /**
   * 通过桥接脚本从 Main World 异步获取字幕轨道列表
   * @returns {Promise<Array|null>}
   */
  async _fetchCaptionTracksFromBridge() {
    this._ensureBridgeInjected();

    return new Promise((resolve) => {
      let resolved = false;

      const handler = (event) => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('YDQ_GET_PLAYER_DATA_RESPONSE', handler);
          resolve(event.detail?.captionTracks || null);
        }
      };

      window.addEventListener('YDQ_GET_PLAYER_DATA_RESPONSE', handler);

      // 发送请求
      window.dispatchEvent(new CustomEvent('YDQ_GET_PLAYER_DATA_REQUEST'));

      // 超时回退
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('YDQ_GET_PLAYER_DATA_RESPONSE', handler);
          resolve(null);
        }
      }, 1000);
    });
  },

  /**
   * 从 DOM 中提取字幕轨道信息（备用方案）
   * @returns {Array|null}
   */
  _getCaptionTracksFromDOM() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes('captionTracks')) {
          const match = text.match(/"captionTracks"\s*:\s*(\[.*?\])/);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  },

  /**
   * 获取并筛选最佳可用字幕轨列表
   * @returns {Promise<Array>} 按优先级排序的字幕轨列表
   */
  async getAvailableTracks() {
    let tracks = await this._fetchCaptionTracksFromBridge();

    if (!tracks || tracks.length === 0) {
      tracks = this._getCaptionTracksFromDOM();
    }

    if (!tracks || tracks.length === 0) {
      return [];
    }

    // 优先级排序：
    // 1. 人工英文字幕 (kind !== 'asr')
    // 2. 自动生成英文字幕 (kind === 'asr')
    // 3. 其他人工语言字幕
    // 4. 其他自动生成语言字幕
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
      throw new Error('无法获取当前视频 ID，请确认位于 YouTube 视频播放页');
    }

    const tracks = await this.getAvailableTracks();

    // 优先尝试从轨道列表中逐个获取
    if (tracks && tracks.length > 0) {
      for (const track of tracks) {
        try {
          const baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          console.log(`[YDQ] 尝试获取字幕轨道: [${track.languageCode}] ${track.name?.simpleText || ''}`);
          const subs = await this._fetchAndParseUrl(baseUrl);
          if (subs && subs.length > 0) {
            console.log(`[YDQ] 成功从轨道 [${track.languageCode}] 获取到 ${subs.length} 条字幕`);
            return subs;
          }
        } catch (e) {
          console.warn(`[YDQ] 获取轨道 [${track.languageCode}] 失败，尝试下一轨道:`, e.message);
        }
      }
    }

    // 回退尝试直接构造 timedtext API
    const fallbackUrls = [
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&kind=asr`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&fmt=json3`,
      `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`,
      `https://www.youtube.com/api/timedtext?v=${videoId}`,
    ];

    for (const url of fallbackUrls) {
      try {
        console.log(`[YDQ] 尝试回退接口: ${url}`);
        const subs = await this._fetchAndParseUrl(url);
        if (subs && subs.length > 0) {
          return subs;
        }
      } catch (e) {
        // 继续尝试下一个
      }
    }

    throw new Error('该视频未提供任何可识别的字幕（CC），请尝试包含字幕的视频');
  },

  /**
   * 获取并解析指定 URL 的字幕内容（支持 JSON3 与 XML 格式）
   * @param {string} url 字幕 URL
   * @returns {Promise<Array>}
   */
  async _fetchAndParseUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP 状态码异常: ${response.status}`);
    }

    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      throw new Error('返回字幕内容为空 (0 字节)');
    }

    const trimmed = rawText.trim();

    // 1. 尝试解析为 JSON3
    if (trimmed.startsWith('{')) {
      try {
        const jsonData = JSON.parse(trimmed);
        const parsed = this._parseJSON3(jsonData);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.warn('[YDQ] JSON 解析失败，尝试 XML 解析:', e.message);
      }
    }

    // 2. 尝试解析为 XML (timedtext / transcript 格式)
    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.warn('[YDQ] XML 解析失败:', e.message);
      }
    }

    throw new Error('未能识别的字幕格式或字幕为空');
  },

  /**
   * 解析 JSON3 格式字幕
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
   * 解析 XML 格式字幕 (<transcript><text start="1.2" dur="2.3">hello</text></transcript>)
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
   * @param {string} str
   * @returns {string}
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
