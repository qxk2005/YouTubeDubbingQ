/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (v7 - Content Script 完全自主)
 * 
 * 核心策略变更：完全放弃跨世界通信，Content Script 自主完成所有工作。
 * 
 * 三级获取策略：
 * 1. 从页面 HTML <script> 标签中提取 captionTracks (括号匹配算法)
 * 2. 从 DOM 中读取 Main World 桥接脚本同步的字幕轨道数据
 * 3. 自主调用 YouTube Innertube API (/youtubei/v1/player) 获取字幕轨道
 * 
 * 字幕下载：直接由 Content Script fetch (host_permissions 保证 Cookie 携带)
 */

const SubtitleFetcher = {
  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  },

  // ============= 括号匹配算法 =============

  _extractJsonArray(text, key) {
    if (!text) return null;
    const keyIdx = text.indexOf(key);
    if (keyIdx === -1) return null;
    const startIdx = text.indexOf('[', keyIdx + key.length);
    if (startIdx === -1) return null;

    let depth = 0, inString = false, escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (!inString) {
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(text.substring(startIdx, i + 1)); }
            catch (e) { return null; }
          }
        }
      }
    }
    return null;
  },

  // ============= 从页面 HTML 提取 Innertube 配置 =============

  _getInnertubeConfig() {
    try {
      const scripts = document.querySelectorAll('script');
      let apiKey = null;
      let clientVersion = null;
      let clientName = 'WEB';

      for (const s of scripts) {
        const text = s.textContent;
        if (!text) continue;

        if (!apiKey) {
          const keyMatch = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
          if (keyMatch) apiKey = keyMatch[1];
        }

        if (!clientVersion) {
          const verMatch = text.match(/"clientVersion"\s*:\s*"([^"]+)"/);
          if (verMatch) clientVersion = verMatch[1];
        }

        if (apiKey && clientVersion) break;
      }

      if (apiKey) {
        return { apiKey, clientName, clientVersion: clientVersion || '2.20240101.00.00' };
      }
    } catch (e) {}
    return null;
  },

  // ============= 通道 1: 从页面 <script> 标签提取 captionTracks =============

  _extractTracksFromPageScripts() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const list = this._extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(list) && list.length > 0) {
            console.log('[YDQ] ✓ 从页面 script 标签提取到 ' + list.length + ' 条字幕轨');
            return list;
          }
        }
      }
    } catch (e) {}
    return [];
  },

  // ============= 通道 2: 从 DOM 直读 Main World 桥接数据 =============

  _readTracksFromBridgeDOM() {
    try {
      const store = document.getElementById('ydq-caption-tracks');
      if (store && store.textContent && store.textContent.trim()) {
        const list = JSON.parse(store.textContent);
        if (Array.isArray(list) && list.length > 0) {
          console.log('[YDQ] ✓ 从 DOM 桥接节点读取到 ' + list.length + ' 条字幕轨');
          return list;
        }
      }
    } catch (e) {}
    return [];
  },

  // ============= 通道 3: 直接调用 YouTube Innertube API =============

  async _fetchTracksViaInnertubeAPI(videoId) {
    const config = this._getInnertubeConfig();
    if (!config) {
      console.warn('[YDQ] 未能从页面提取 Innertube 配置');
      return [];
    }

    console.log('[YDQ] 正在通过 Innertube API 获取字幕轨道...');

    try {
      const url = 'https://www.youtube.com/youtubei/v1/player?key=' + config.apiKey + '&prettyPrint=false';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          videoId: videoId,
          context: {
            client: {
              clientName: config.clientName,
              clientVersion: config.clientVersion,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
      });

      if (!response.ok) {
        console.warn('[YDQ] Innertube API 返回 HTTP ' + response.status);
        return [];
      }

      const data = await response.json();

      // 检查是否可播放
      if (data.playabilityStatus && data.playabilityStatus.status !== 'OK') {
        console.warn('[YDQ] Innertube 播放状态:', data.playabilityStatus.status);
      }

      const tracks = data.captions &&
                      data.captions.playerCaptionsTracklistRenderer &&
                      data.captions.playerCaptionsTracklistRenderer.captionTracks;

      if (Array.isArray(tracks) && tracks.length > 0) {
        console.log('[YDQ] ✓ Innertube API 返回 ' + tracks.length + ' 条字幕轨');
        return tracks;
      }

      console.warn('[YDQ] Innertube API 返回中无 captionTracks');
      return [];
    } catch (e) {
      console.error('[YDQ] Innertube API 调用异常:', e);
      return [];
    }
  },

  // ============= 检查拦截器缓存 =============

  _getInterceptedSubtitle() {
    try {
      const store = document.getElementById('ydq-intercepted-subtitle');
      if (store && store.textContent && store.textContent.trim()) {
        const parsed = this._parseRawSubtitle(store.textContent);
        if (parsed && parsed.length > 0) {
          console.log('[YDQ] ✓ 从网络拦截器获取到 ' + parsed.length + ' 条字幕');
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  },

  // ============= 优先级排序 =============

  _sortTracks(tracks) {
    return [...tracks].sort((a, b) => {
      const langA = a.languageCode || '';
      const langB = b.languageCode || '';
      const isEnA = langA === 'en' || langA.startsWith('en');
      const isEnB = langB === 'en' || langB.startsWith('en');
      const isAsrA = a.kind === 'asr';
      const isAsrB = b.kind === 'asr';
      if (isEnA && !isEnB) return -1;
      if (!isEnA && isEnB) return 1;
      if (!isAsrA && isAsrB) return -1;
      if (isAsrA && !isAsrB) return 1;
      return 0;
    });
  },

  // ============= 主入口 =============

  async fetchSubtitles() {
    const videoId = this.getVideoId();
    if (!videoId) throw new Error('未检测到视频 ID');

    console.log('[YDQ] ===== 开始字幕获取流程 (videoId: ' + videoId + ') =====');

    // 多轮尝试，每轮尝试所有通道
    const maxRounds = 10;
    const roundInterval = 1000;

    for (let round = 1; round <= maxRounds; round++) {
      console.log('[YDQ] --- 第 ' + round + '/' + maxRounds + ' 轮探测 ---');

      // 检查拦截器缓存
      const intercepted = this._getInterceptedSubtitle();
      if (intercepted) return intercepted;

      // 汇总所有通道获取到的轨道
      let tracks = [];

      // 通道 1: 页面 script 括号匹配
      if (tracks.length === 0) {
        tracks = this._extractTracksFromPageScripts();
      }

      // 通道 2: DOM 桥接节点
      if (tracks.length === 0) {
        tracks = this._readTracksFromBridgeDOM();
      }

      // 通道 3: Innertube API (从第 2 轮开始)
      if (tracks.length === 0 && round >= 2) {
        tracks = await this._fetchTracksViaInnertubeAPI(videoId);
      }

      // 如果获取到了轨道，尝试下载字幕内容
      if (tracks.length > 0) {
        const sorted = this._sortTracks(tracks);
        for (const track of sorted) {
          const baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          const langCode = track.languageCode || 'unknown';
          const trackName = (track.name && (track.name.simpleText ||
            (track.name.runs && track.name.runs[0] && track.name.runs[0].text))) || '';
          console.log('[YDQ] 正在下载字幕: [' + langCode + '] ' + trackName);

          try {
            // Content Script 直接 fetch，host_permissions 保证 Cookie 携带
            const response = await fetch(baseUrl, { credentials: 'include' });
            if (!response.ok) {
              console.warn('[YDQ] 字幕下载 HTTP ' + response.status);
              continue;
            }

            const rawText = await response.text();
            if (!rawText || !rawText.trim()) {
              console.warn('[YDQ] 字幕下载内容为空');
              continue;
            }

            const subs = this._parseRawSubtitle(rawText);
            if (subs && subs.length > 0) {
              console.log('[YDQ] ✓✓✓ 成功解析 ' + subs.length + ' 条字幕！(来自轨道: ' + langCode + ')');
              return subs;
            }
          } catch (err) {
            console.warn('[YDQ] 字幕轨 [' + langCode + '] 下载异常:', err.message);
          }
        }
      }

      // 等待下一轮
      if (round < maxRounds) {
        await new Promise((r) => setTimeout(r, roundInterval));
      }
    }

    throw new Error('经过 10 秒探测仍未获取到字幕。请确认: 1) 视频有 CC 字幕 2) YouTube 已登录');
  },

  // ============= 全能解析引擎 =============

  _parseRawSubtitle(rawText) {
    const trimmed = rawText.trim();

    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        const parsed = this._parseJSON3(data);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    if (trimmed.includes('-->')) {
      try {
        const parsed = this._parseVTT(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    return [];
  },

  _parseJSON3(data) {
    if (!data || !data.events) return [];
    const subs = [];
    let idx = 0;
    for (const ev of data.events) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').trim();
      if (!text || text === '\n') continue;
      subs.push({
        text: this._decode(text),
        startMs: ev.tStartMs || 0,
        endMs: (ev.tStartMs || 0) + (ev.dDurationMs || 3000),
        index: idx++,
        zhText: '',
      });
    }
    return subs;
  },

  _parseXML(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const subs = [];
    let idx = 0;

    const textNodes = doc.getElementsByTagName('text');
    if (textNodes.length > 0) {
      for (let i = 0; i < textNodes.length; i++) {
        const n = textNodes[i];
        const raw = (n.textContent || '').trim();
        if (!raw) continue;
        subs.push({
          text: this._decode(raw),
          startMs: Math.round(parseFloat(n.getAttribute('start') || '0') * 1000),
          endMs: Math.round((parseFloat(n.getAttribute('start') || '0') + parseFloat(n.getAttribute('dur') || '3')) * 1000),
          index: idx++, zhText: '',
        });
      }
      if (subs.length > 0) return subs;
    }

    const pNodes = doc.getElementsByTagName('p');
    for (let i = 0; i < pNodes.length; i++) {
      const n = pNodes[i];
      const raw = (n.textContent || '').trim();
      if (!raw) continue;
      const startMs = parseInt(n.getAttribute('t') || '0');
      const durMs = parseInt(n.getAttribute('d') || '3000');
      subs.push({
        text: this._decode(raw), startMs, endMs: startMs + durMs, index: idx++, zhText: '',
      });
    }
    return subs;
  },

  _parseVTT(vttText) {
    const lines = vttText.split('\n');
    const subs = [];
    let idx = 0, i = 0;
    while (i < lines.length) {
      const m = lines[i].trim().match(/(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})/);
      if (m) {
        const p = (h, mi, s, ms) => (h ? parseInt(h) : 0) * 3600000 + parseInt(mi) * 60000 + parseInt(s) * 1000 + parseInt(ms);
        const startMs = p(m[1], m[2], m[3], m[4]);
        const endMs = p(m[5], m[6], m[7], m[8]);
        i++;
        const tl = [];
        while (i < lines.length && lines[i].trim() !== '') { tl.push(lines[i].trim()); i++; }
        const text = tl.join(' ').replace(/<[^>]*>/g, '');
        if (text) subs.push({ text: this._decode(text), startMs, endMs, index: idx++, zhText: '' });
      }
      i++;
    }
    return subs;
  },

  _decode(str) {
    if (!str) return '';
    const t = document.createElement('textarea');
    t.innerHTML = str;
    return t.value;
  },
};

if (typeof window !== 'undefined') {
  window.SubtitleFetcher = SubtitleFetcher;
}
