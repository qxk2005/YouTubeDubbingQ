/**
 * YouTubeDubbingQ - Main World 桥接脚本 (v6 - 纯 DOM 数据交换)
 * 
 * 关键设计决策：
 * - Chrome MV3 中 MAIN world 与 ISOLATED world 共享 DOM，但 CustomEvent.detail 的
 *   对象跨世界传递可能因 Chrome 安全策略被阻止。
 * - 因此本版本完全不依赖 CustomEvent.detail 传递复杂对象。
 * - 所有数据通过 DOM 节点的 textContent (纯字符串) 交换，100% 可靠。
 * - 使用 MutationObserver 监听 DOM 变化触发回调，替代事件通信。
 */

(function () {
  'use strict';

  if (window.__YDQ_BRIDGE_INITIALIZED__) return;
  window.__YDQ_BRIDGE_INITIALIZED__ = true;

  console.log('[YDQ Bridge] Main World 脚本已初始化 (v6 纯 DOM 交换模式)');

  // ============= DOM 数据存储节点 =============

  function getOrCreateStore(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.display = 'none';
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  // ============= Fetch / XHR 网络拦截器 =============

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && (url.includes('/api/timedtext') || url.includes('timedtext'))) {
        const clone = response.clone();
        clone.text().then((text) => {
          if (text && text.trim()) {
            const store = getOrCreateStore('ydq-intercepted-subtitle');
            store.textContent = text;
            store.setAttribute('data-url', url);
            store.setAttribute('data-time', Date.now().toString());
            console.log('[YDQ Bridge] ✓ 已拦截 fetch timedtext 响应:', url.substring(0, 80));
          }
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ydqUrl = url;
    return origXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (this._ydqUrl && (this._ydqUrl.includes('/api/timedtext') || this._ydqUrl.includes('timedtext'))) {
          if (this.responseText && this.responseText.trim()) {
            const store = getOrCreateStore('ydq-intercepted-subtitle');
            store.textContent = this.responseText;
            store.setAttribute('data-url', this._ydqUrl);
            store.setAttribute('data-time', Date.now().toString());
            console.log('[YDQ Bridge] ✓ 已拦截 XHR timedtext 响应');
          }
        }
      } catch (e) {}
    });
    return origXHRSend.apply(this, args);
  };

  // ============= 括号匹配算法 =============

  function extractJsonArray(text, key) {
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

      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }

      if (!inString) {
        if (char === '[') depth++;
        else if (char === ']') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.substring(startIdx, i + 1));
            } catch (e) {
              return null;
            }
          }
        }
      }
    }
    return null;
  }

  // ============= 字幕轨道提取核心 =============

  function extractCaptionTracks() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // 通道 1: player.getOption('captions', 'tracklist')
    if (player && typeof player.getOption === 'function') {
      try {
        const tracklist = player.getOption('captions', 'tracklist');
        if (Array.isArray(tracklist) && tracklist.length > 0) {
          const valid = tracklist.map((t) => ({
            baseUrl: t.baseUrl || t.url || '',
            languageCode: t.languageCode || t.lang || '',
            name: t.name || t.displayName || t.languageName || '',
            kind: t.kind || (t.vssId && t.vssId.startsWith('a.') ? 'asr' : ''),
          })).filter((t) => !!t.baseUrl);
          if (valid.length > 0) return valid;
        }
      } catch (e) {}
    }

    // 通道 2: player.getPlayerResponse()
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const resp = player.getPlayerResponse();
        const list = resp && resp.captions && resp.captions.playerCaptionsTracklistRenderer &&
                     resp.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          return list.map((t) => ({
            baseUrl: t.baseUrl || '',
            languageCode: t.languageCode || '',
            name: (t.name && t.name.simpleText) || (t.name && t.name.runs && t.name.runs[0] && t.name.runs[0].text) || '',
            kind: t.kind || '',
          })).filter((t) => !!t.baseUrl);
        }
      } catch (e) {}
    }

    // 通道 3: ytInitialPlayerResponse
    try {
      const ytipr = window.ytInitialPlayerResponse;
      if (ytipr && ytipr.captions && ytipr.captions.playerCaptionsTracklistRenderer &&
          ytipr.captions.playerCaptionsTracklistRenderer.captionTracks) {
        const list = ytipr.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          return list.map((t) => ({
            baseUrl: t.baseUrl || '',
            languageCode: t.languageCode || '',
            name: (t.name && t.name.simpleText) || '',
            kind: t.kind || '',
          })).filter((t) => !!t.baseUrl);
        }
      }
    } catch (e) {}

    // 通道 4: 页面 script 标签 + 括号匹配
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const extracted = extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(extracted) && extracted.length > 0) {
            return extracted.map((t) => ({
              baseUrl: t.baseUrl || '',
              languageCode: t.languageCode || '',
              name: (t.name && (t.name.simpleText || (t.name.runs && t.name.runs[0] && t.name.runs[0].text))) || '',
              kind: t.kind || '',
            })).filter((t) => !!t.baseUrl);
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // ============= 周期性写入 DOM =============

  function syncTracksToDOM() {
    const tracks = extractCaptionTracks();
    if (tracks && tracks.length > 0) {
      const store = getOrCreateStore('ydq-caption-tracks');
      const json = JSON.stringify(tracks);
      if (store.textContent !== json) {
        store.textContent = json;
        store.setAttribute('data-time', Date.now().toString());
        console.log('[YDQ Bridge] ✓ 字幕轨道已同步到 DOM (' + tracks.length + ' 个轨道)');
      }
    }
  }

  // 每秒探测并同步
  setInterval(syncTracksToDOM, 1000);
  // 初始延迟执行
  setTimeout(syncTracksToDOM, 500);
  setTimeout(syncTracksToDOM, 1500);
  setTimeout(syncTracksToDOM, 3000);

  // ============= 监听拉取字幕的指令 =============
  // Content Script 在 'ydq-fetch-request' DOM 节点写入 URL
  // Main World 监听到后去 fetch 并写入 'ydq-fetch-response' 

  const observer = new MutationObserver(() => {
    const reqNode = document.getElementById('ydq-fetch-request');
    if (!reqNode) return;

    const url = reqNode.getAttribute('data-url');
    const reqId = reqNode.getAttribute('data-req-id');
    const processed = reqNode.getAttribute('data-processed');

    if (url && reqId && processed !== reqId) {
      reqNode.setAttribute('data-processed', reqId);

      fetch(url, { credentials: 'include' })
        .then((resp) => {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.text();
        })
        .then((text) => {
          const respNode = getOrCreateStore('ydq-fetch-response');
          respNode.textContent = text;
          respNode.setAttribute('data-req-id', reqId);
          respNode.setAttribute('data-success', 'true');
          respNode.setAttribute('data-time', Date.now().toString());
        })
        .catch((err) => {
          const respNode = getOrCreateStore('ydq-fetch-response');
          respNode.textContent = '';
          respNode.setAttribute('data-req-id', reqId);
          respNode.setAttribute('data-success', 'false');
          respNode.setAttribute('data-error', err.message);
          respNode.setAttribute('data-time', Date.now().toString());
        });
    }
  });

  // 开始观察
  function startObserving() {
    const target = document.body || document.documentElement;
    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-req-id'] });
  }

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
