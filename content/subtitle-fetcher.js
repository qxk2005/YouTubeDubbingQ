/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (v8 - 终极稳健版)
 * 
 * 核心认识：YouTube 已不支持匿名获取字幕，必须在用户认证环境中请求。
 * 只有 MAIN world 脚本的 fetch 100% 携带用户 Cookie。
 * 
 * 五级获取策略 (按可靠性排序):
 * 1. 网络拦截器缓存 (MAIN world 自动捕获 timedtext 响应)
 * 2. DOM 桥接字幕轨 + MAIN world 代理 fetch (最可靠的主动获取)
 * 3. 页面 <script> 标签括号匹配
 * 4. Content Script 直接 Innertube API
 * 5. Service Worker 代理 Innertube API
 * 
 * 字幕内容下载优先级:
 * A. Main World DOM 代理 fetch (100% 携带 Cookie)
 * B. Content Script 直接 fetch
 * C. Service Worker 代理 fetch
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

  // ============= Innertube 配置提取 =============

  _getInnertubeConfig() {
    try {
      const scripts = document.querySelectorAll('script');
      let apiKey = null, clientVersion = null;
      for (const s of scripts) {
        const text = s.textContent;
        if (!text) continue;
        if (!apiKey) {
          const m = text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
          if (m) apiKey = m[1];
        }
        if (!clientVersion) {
          const m = text.match(/"clientVersion"\s*:\s*"([^"]+)"/);
          if (m) clientVersion = m[1];
        }
        if (apiKey && clientVersion) break;
      }
      if (apiKey) return { apiKey, clientName: 'WEB', clientVersion: clientVersion || '2.20240101.00.00' };
    } catch (e) {}
    return null;
  },

  // ============= 通道 0: 网络拦截器缓存 =============

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

  // ============= 通道 1: DOM 桥接字幕轨 =============

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

  // ============= 通道 2: 页面 <script> 括号匹配 =============

  _extractTracksFromPageScripts() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const list = this._extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(list) && list.length > 0) {
            console.log('[YDQ] ✓ 从 script 标签提取到 ' + list.length + ' 条字幕轨');
            return list;
          }
        }
      }
    } catch (e) {}
    return [];
  },

  // ============= 通道 3: Content Script 直接 Innertube API =============

  async _fetchTracksViaInnertubeAPI(videoId) {
    const config = this._getInnertubeConfig();
    if (!config) return [];
    console.log('[YDQ] 正在通过 Content Script 直接调用 Innertube API...');
    try {
      const url = 'https://www.youtube.com/youtubei/v1/player?key=' + config.apiKey + '&prettyPrint=false';
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          videoId: videoId,
          context: { client: { clientName: config.clientName, clientVersion: config.clientVersion, hl: 'en', gl: 'US' } },
        }),
      });
      if (!response.ok) { console.warn('[YDQ] Innertube HTTP ' + response.status); return []; }
      const data = await response.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        console.log('[YDQ] ✓ Innertube API 返回 ' + tracks.length + ' 条字幕轨');
        return tracks;
      }
      console.warn('[YDQ] Innertube 状态: ' + (data?.playabilityStatus?.status || 'unknown'));
    } catch (e) { console.error('[YDQ] Innertube 异常:', e.message); }
    return [];
  },

  // ============= 通道 4: Service Worker 代理 Innertube API =============

  async _fetchTracksViaSW(videoId) {
    try {
      const config = this._getInnertubeConfig();
      console.log('[YDQ] 正在通过 Service Worker 代理...');
      const result = await chrome.runtime.sendMessage({
        type: 'YDQ_FETCH_PLAYER_DATA', videoId: videoId, config: config || {},
      });
      if (result?.success && Array.isArray(result.tracks)) {
        console.log('[YDQ] ✓ SW 代理返回 ' + result.tracks.length + ' 条字幕轨');
        return result.tracks;
      }
      if (result?.error) console.warn('[YDQ] SW 代理错误:', result.error);
    } catch (e) { console.warn('[YDQ] SW 通信异常:', e.message); }
    return [];
  },

  // ============= 字幕内容下载 (三重保障) =============

  async _downloadSubtitleContent(baseUrl) {
    // 方式 A: Main World DOM 代理 (最可靠 - 100% 携带 Cookie)
    try {
      const text = await this._fetchViaDOMProxy(baseUrl);
      if (text && text.trim()) {
        console.log('[YDQ] ✓ Main World 代理下载成功');
        return text;
      }
    } catch (e) {
      console.warn('[YDQ] Main World 代理下载失败:', e.message);
    }

    // 方式 B: Content Script 直接 fetch
    try {
      const response = await fetch(baseUrl, { credentials: 'include' });
      if (response.ok) {
        const text = await response.text();
        if (text && text.trim()) {
          console.log('[YDQ] ✓ Content Script 直接下载成功');
          return text;
        }
      }
    } catch (e) {
      console.warn('[YDQ] Content Script 下载异常:', e.message);
    }

    // 方式 C: Service Worker 代理
    try {
      const result = await chrome.runtime.sendMessage({ type: 'YDQ_FETCH_URL', url: baseUrl });
      if (result?.success && result.text) {
        console.log('[YDQ] ✓ SW 代理下载成功');
        return result.text;
      }
    } catch (e) {
      console.warn('[YDQ] SW 代理下载异常:', e.message);
    }

    return null;
  },

  // ============= Main World DOM 代理 fetch =============

  async _fetchViaDOMProxy(url) {
    return new Promise((resolve, reject) => {
      const reqId = 'r' + Date.now() + Math.random().toString(36).substr(2, 6);

      // 创建请求节点
      let reqNode = document.getElementById('ydq-fetch-request');
      if (!reqNode) {
        reqNode = document.createElement('div');
        reqNode.id = 'ydq-fetch-request';
        reqNode.style.display = 'none';
        document.body.appendChild(reqNode);
      }

      let resolved = false;
      const timeout = 8000;

      const checkResponse = () => {
        if (resolved) return;
        const respNode = document.getElementById('ydq-fetch-response');
        if (respNode && respNode.getAttribute('data-req-id') === reqId) {
          resolved = true;
          if (respNode.getAttribute('data-success') === 'true') {
            resolve(respNode.textContent || '');
          } else {
            reject(new Error(respNode.getAttribute('data-error') || 'DOM 代理失败'));
          }
        }
      };

      // 轮询检查
      const intervalId = setInterval(checkResponse, 150);

      // 超时
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(intervalId);
          reject(new Error('DOM 代理超时 (' + (timeout / 1000) + '秒)'));
        }
      }, timeout);

      // 清理
      setTimeout(() => clearInterval(intervalId), timeout + 1000);

      // 发送请求
      reqNode.setAttribute('data-url', url);
      reqNode.setAttribute('data-req-id', reqId);
    });
  },

  // ============= 轨道排序 =============

  _sortTracks(tracks) {
    return [...tracks].sort((a, b) => {
      const langA = a.languageCode || '';
      const langB = b.languageCode || '';
      const isEnA = langA === 'en' || langA.startsWith('en');
      const isEnB = langB === 'en' || langB.startsWith('en');
      if (isEnA && !isEnB) return -1;
      if (!isEnA && isEnB) return 1;
      const isAsrA = a.kind === 'asr';
      const isAsrB = b.kind === 'asr';
      if (!isAsrA && isAsrB) return -1;
      if (isAsrA && !isAsrB) return 1;
      return 0;
    });
  },

  // ============= 主入口 =============

  async fetchSubtitles(onProgress) {
    const videoId = this.getVideoId();
    if (!videoId) throw new Error('未检测到视频 ID');

    console.log('[YDQ] ===== 开始字幕获取 v9 (videoId: ' + videoId + ') =====');

    const maxRounds = 30; // 最多轮询 30 轮 (~45 秒)
    const startTime = Date.now();

    for (let round = 1; round <= maxRounds; round++) {
      const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      console.log('[YDQ] --- 第 ' + round + '/' + maxRounds + ' 轮 (' + elapsedSec + 's) ---');

      if (onProgress) {
        onProgress(`正在连接字幕源 (${elapsedSec}s)...`, elapsedSec);
      }

      // 优先级 0: 拦截器缓存
      const intercepted = this._getInterceptedSubtitle();
      if (intercepted) {
        if (onProgress) onProgress(`已通过网络缓存获取字幕 (${intercepted.length}条)`, elapsedSec);
        return intercepted;
      }

      // 收集轨道
      let tracks = [];

      // 优先级 1: 页面 script 括号匹配 (每轮)
      tracks = this._extractTracksFromPageScripts();

      // 优先级 2: DOM 桥接 (每轮)
      if (!tracks.length) tracks = this._readTracksFromBridgeDOM();

      // 优先级 3: Content Script Innertube API (第 2 轮起)
      if (!tracks.length && round >= 2) tracks = await this._fetchTracksViaInnertubeAPI(videoId);

      // 优先级 4: SW 代理 Innertube API (第 4 轮起)
      if (!tracks.length && round >= 4) tracks = await this._fetchTracksViaSW(videoId);

      // 有轨道则尝试下载
      if (tracks.length > 0) {
        const sorted = this._sortTracks(tracks);
        for (const track of sorted) {
          const baseUrl = track.baseUrl;
          if (!baseUrl) continue;

          const lang = track.languageCode || '?';
          const name = (track.name && (track.name.simpleText ||
            (track.name.runs && track.name.runs[0] && track.name.runs[0].text))) || '';
          console.log('[YDQ] 下载字幕: [' + lang + '] ' + name);

          if (onProgress) {
            onProgress(`已检测到字幕轨 [${lang}]，正在下载解析...`, elapsedSec);
          }

          const rawText = await this._downloadSubtitleContent(baseUrl);
          if (rawText) {
            const subs = this._parseRawSubtitle(rawText);
            if (subs && subs.length > 0) {
              console.log('[YDQ] ✓✓✓ 成功! ' + subs.length + ' 条字幕 (轨道: ' + lang + ')');
              if (onProgress) {
                onProgress(`字幕轨解析成功 (${subs.length} 条)`, elapsedSec);
              }
              return subs;
            }
          }
        }
      }

      const roundInterval = round <= 8 ? 1000 : 1500;
      if (round < maxRounds) await new Promise((r) => setTimeout(r, roundInterval));
    }

    throw new Error('45 秒内未获取到字幕。请确认视频有 CC 字幕且 YouTube 页面已就绪');
  },

  // ============= 全能解析引擎 =============

  _parseRawSubtitle(rawText) {
    const t = rawText.trim();
    if (t.startsWith('{')) try { const r = this._parseJSON3(JSON.parse(t)); if (r.length) return r; } catch (e) {}
    if (t.startsWith('<')) try { const r = this._parseXML(t); if (r.length) return r; } catch (e) {}
    if (t.includes('-->')) try { const r = this._parseVTT(t); if (r.length) return r; } catch (e) {}
    return [];
  },

  _parseJSON3(data) {
    if (!data?.events) return [];
    const subs = []; let idx = 0;
    for (const ev of data.events) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 || '').join('').trim();
      if (!text || text === '\n') continue;
      subs.push({ text: this._d(text), startMs: ev.tStartMs || 0, endMs: (ev.tStartMs || 0) + (ev.dDurationMs || 3000), index: idx++, zhText: '' });
    }
    return subs;
  },

  _parseXML(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const subs = []; let idx = 0;
    const textN = doc.getElementsByTagName('text');
    for (let i = 0; i < textN.length; i++) {
      const n = textN[i]; const raw = (n.textContent || '').trim(); if (!raw) continue;
      const s = parseFloat(n.getAttribute('start') || '0');
      const d = parseFloat(n.getAttribute('dur') || '3');
      subs.push({ text: this._d(raw), startMs: Math.round(s * 1000), endMs: Math.round((s + d) * 1000), index: idx++, zhText: '' });
    }
    if (subs.length) return subs;
    const pN = doc.getElementsByTagName('p');
    for (let i = 0; i < pN.length; i++) {
      const n = pN[i]; const raw = (n.textContent || '').trim(); if (!raw) continue;
      const t = parseInt(n.getAttribute('t') || '0'); const d = parseInt(n.getAttribute('d') || '3000');
      subs.push({ text: this._d(raw), startMs: t, endMs: t + d, index: idx++, zhText: '' });
    }
    return subs;
  },

  _parseVTT(vtt) {
    const lines = vtt.split('\n'); const subs = []; let idx = 0, i = 0;
    while (i < lines.length) {
      const m = lines[i].trim().match(/(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})[.,](\d{3})/);
      if (m) {
        const p = (h, mi, s, ms) => (h ? parseInt(h) : 0) * 3600000 + parseInt(mi) * 60000 + parseInt(s) * 1000 + parseInt(ms);
        const startMs = p(m[1], m[2], m[3], m[4]); const endMs = p(m[5], m[6], m[7], m[8]);
        i++; const tl = [];
        while (i < lines.length && lines[i].trim() !== '') { tl.push(lines[i].trim()); i++; }
        const text = tl.join(' ').replace(/<[^>]*>/g, '');
        if (text) subs.push({ text: this._d(text), startMs, endMs, index: idx++, zhText: '' });
      }
      i++;
    }
    return subs;
  },

  _d(s) { if (!s) return ''; const t = document.createElement('textarea'); t.innerHTML = s; return t.value; },
};

if (typeof window !== 'undefined') window.SubtitleFetcher = SubtitleFetcher;
