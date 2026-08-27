/**
 * YouTubeDubbingQ - YouTube 字幕获取模块 (v6 - 纯 DOM 读取)
 * 
 * 三级数据获取策略 (全部通过 DOM textContent 读取，100% 跨世界可靠)：
 * 1. 读取 Main World 网络拦截器已捕获的字幕原文 (#ydq-intercepted-subtitle)
 * 2. 读取 Main World 周期同步的字幕轨道列表 (#ydq-caption-tracks)，然后通过 DOM 请求下载
 * 3. 页面 script 标签括号匹配算法提取
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

  // ============= 通道 0: 读取网络拦截器已捕获的字幕 =============

  _getInterceptedSubtitle() {
    try {
      const store = document.getElementById('ydq-intercepted-subtitle');
      if (store && store.textContent && store.textContent.trim()) {
        const parsed = this._parseRawSubtitle(store.textContent);
        if (parsed && parsed.length > 0) {
          console.log('[YDQ] ✓ 从网络拦截器直接获取到 ' + parsed.length + ' 条字幕');
          return parsed;
        }
      }
    } catch (e) {}
    return null;
  },

  // ============= 通道 1: DOM 直读字幕轨道列表 =============

  _readTracksFromDOM() {
    try {
      const store = document.getElementById('ydq-caption-tracks');
      if (store && store.textContent && store.textContent.trim()) {
        const list = JSON.parse(store.textContent);
        if (Array.isArray(list) && list.length > 0) return list;
      }
    } catch (e) {}
    return [];
  },

  // ============= 通道 2: 页面 script 括号匹配 =============

  _extractTracksFromPageScripts() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const list = this._extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(list) && list.length > 0) return list;
        }
      }
    } catch (e) {}
    return [];
  },

  // ============= 通过 DOM 节点代理 fetch 字幕内容 =============

  async _fetchViaDOMProxy(url) {
    return new Promise((resolve, reject) => {
      const reqId = 'r' + Date.now() + Math.random().toString(36).substr(2, 6);

      // 创建或获取请求节点
      let reqNode = document.getElementById('ydq-fetch-request');
      if (!reqNode) {
        reqNode = document.createElement('div');
        reqNode.id = 'ydq-fetch-request';
        reqNode.style.display = 'none';
        document.body.appendChild(reqNode);
      }

      // 设置响应监听
      let resolved = false;
      const checkResponse = () => {
        const respNode = document.getElementById('ydq-fetch-response');
        if (respNode && respNode.getAttribute('data-req-id') === reqId) {
          if (!resolved) {
            resolved = true;
            const success = respNode.getAttribute('data-success') === 'true';
            if (success) {
              resolve(respNode.textContent || '');
            } else {
              reject(new Error(respNode.getAttribute('data-error') || '代理请求失败'));
            }
          }
        }
      };

      // 轮询检查响应（每 100ms）
      const intervalId = setInterval(checkResponse, 100);

      // 超时
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(intervalId);
          reject(new Error('代理请求字幕超时'));
        }
      }, 10000);

      // 发送请求（写入 DOM 属性触发 Main World 的 MutationObserver）
      reqNode.setAttribute('data-url', url);
      reqNode.setAttribute('data-req-id', reqId);

      // 也额外用轮询保证响应不被遗漏
      setTimeout(checkResponse, 200);
      setTimeout(checkResponse, 500);
      setTimeout(checkResponse, 1000);
      setTimeout(checkResponse, 2000);
      setTimeout(checkResponse, 3000);

      // 清理
      setTimeout(() => {
        clearInterval(intervalId);
      }, 11000);
    });
  },

  // ============= 优先级排序 =============

  _sortTracks(tracks) {
    return [...tracks].sort((a, b) => {
      const isEnA = (a.languageCode || '').startsWith('en');
      const isEnB = (b.languageCode || '').startsWith('en');
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

    console.log('[YDQ] 开始获取字幕 (videoId: ' + videoId + ')');

    // 策略: 轮询多通道，最多等 8 秒
    const maxAttempts = 16;
    const interval = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log('[YDQ] 字幕探测第 ' + attempt + '/' + maxAttempts + ' 次...');

      // 优先级 0: 检查拦截器
      const intercepted = this._getInterceptedSubtitle();
      if (intercepted) return intercepted;

      // 优先级 1: DOM 直读字幕轨道
      let tracks = this._readTracksFromDOM();

      // 优先级 2: 页面 script 括号匹配
      if (!tracks || tracks.length === 0) {
        tracks = this._extractTracksFromPageScripts();
      }

      if (tracks && tracks.length > 0) {
        const sorted = this._sortTracks(tracks);
        for (const track of sorted) {
          if (!track.baseUrl) continue;
          try {
            console.log('[YDQ] 正在通过 DOM 代理下载字幕: [' + track.languageCode + '] ' + (track.name || ''));
            const rawText = await this._fetchViaDOMProxy(track.baseUrl);
            if (rawText && rawText.trim()) {
              const subs = this._parseRawSubtitle(rawText);
              if (subs && subs.length > 0) {
                console.log('[YDQ] ✓ 成功解析 ' + subs.length + ' 条字幕 (轨道: ' + track.languageCode + ')');
                return subs;
              }
            }
          } catch (err) {
            console.warn('[YDQ] 轨道 [' + track.languageCode + '] 下载失败:', err.message);
          }
        }
      }

      // 等待下一轮
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, interval));
      }
    }

    throw new Error('未能提取到当前视频的字幕，请确保 YouTube 视频有可用的 CC 字幕');
  },

  // ============= 全能解析引擎 =============

  _parseRawSubtitle(rawText) {
    const trimmed = rawText.trim();

    // JSON3
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(trimmed);
        const parsed = this._parseJSON3(data);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    // XML
    if (trimmed.startsWith('<')) {
      try {
        const parsed = this._parseXML(trimmed);
        if (parsed.length > 0) return parsed;
      } catch (e) {}
    }

    // VTT
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

    // <text start="..." dur="...">
    const textNodes = doc.getElementsByTagName('text');
    if (textNodes.length > 0) {
      for (let i = 0; i < textNodes.length; i++) {
        const n = textNodes[i];
        const raw = (n.textContent || '').trim();
        if (!raw) continue;
        const startSec = parseFloat(n.getAttribute('start') || '0');
        const durSec = parseFloat(n.getAttribute('dur') || '3');
        subs.push({
          text: this._decode(raw), startMs: Math.round(startSec * 1000),
          endMs: Math.round((startSec + durSec) * 1000), index: idx++, zhText: '',
        });
      }
      if (subs.length > 0) return subs;
    }

    // <p t="..." d="...">
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
