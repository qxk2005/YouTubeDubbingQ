/**
 * YouTubeDubbingQ - Main World 终极拦截与桥接脚本 (v5)
 * 1. 全局 Fetch / XHR 劫持：自动捕获播放器发出的所有 /api/timedtext 原始字幕响应
 * 2. 括号匹配算法 (Bracket Matcher)：100% 精确提取页面内嵌的深度嵌套 captionTracks
 * 3. 多通道 DOM 同步与 CustomEvent 调度
 */

(function () {
  'use strict';

  if (window.__YDQ_BRIDGE_INITIALIZED__) return;
  window.__YDQ_BRIDGE_INITIALIZED__ = true;

  console.log('[YDQ Bridge] Main World 终极桥接与拦截引擎已启动');

  // ============= 1. 网络请求拦截器 (自动截获 timedtext) =============

  function cacheSubtitleText(url, text) {
    if (!text || !text.trim()) return;

    let store = document.getElementById('ydq-captured-subtitle-store');
    if (!store) {
      store = document.createElement('script');
      store.id = 'ydq-captured-subtitle-store';
      store.type = 'text/plain';
      store.style.display = 'none';
      (document.head || document.documentElement).appendChild(store);
    }

    store.textContent = text;
    store.setAttribute('data-url', url);
    store.setAttribute('data-time', Date.now().toString());
    console.log('[YDQ Bridge] ✓ 成功拦截并缓存播放器 timedtext 字幕响应！');
  }

  // 拦截 window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && url.includes('/api/timedtext')) {
        const clone = response.clone();
        clone.text().then((text) => cacheSubtitleText(url, text)).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  // 拦截 XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ydqUrl = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (this._ydqUrl && this._ydqUrl.includes('/api/timedtext')) {
          cacheSubtitleText(this._ydqUrl, this.responseText);
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  // ============= 2. 括号匹配算法 (Bracket Matcher) =============

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
  }

  // ============= 3. 提取字幕轨 =============

  function syncTracksToDOM(tracks) {
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) return;

    let container = document.getElementById('ydq-caption-tracks-store');
    if (!container) {
      container = document.createElement('script');
      container.id = 'ydq-caption-tracks-store';
      container.type = 'application/json';
      container.style.display = 'none';
      (document.head || document.documentElement).appendChild(container);
    }

    container.textContent = JSON.stringify(tracks);
  }

  function extractCaptionTracks() {
    let tracks = null;
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // 通道 1: 播放器 getOption
    if (player && typeof player.getOption === 'function') {
      try {
        const tracklist = player.getOption('captions', 'tracklist');
        if (Array.isArray(tracklist) && tracklist.length > 0) {
          const valid = tracklist.map((t) => ({
            baseUrl: t.baseUrl || t.url,
            languageCode: t.languageCode || t.lang || (t.vssId ? t.vssId.replace(/^[a-z]\./, '') : 'en'),
            name: { simpleText: t.name || t.displayName || t.languageName || t.name_locale || '' },
            kind: t.kind || (t.vssId?.startsWith('a.') ? 'asr' : ''),
            vssId: t.vssId,
          })).filter((t) => !!t.baseUrl);
          if (valid.length > 0) {
            syncTracksToDOM(valid);
            return valid;
          }
        }
      } catch (e) {}
    }

    // 通道 2: 播放器 getPlayerResponse
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const resp = player.getPlayerResponse();
        const list = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          syncTracksToDOM(list);
          return list;
        }
      } catch (e) {}
    }

    // 通道 3: window.ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const list = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (Array.isArray(list) && list.length > 0) {
        syncTracksToDOM(list);
        return list;
      }
    }

    // 通道 4: 扫描页面所有脚本，使用括号匹配算法提取
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent;
        if (text && text.includes('captionTracks')) {
          const extracted = extractJsonArray(text, '"captionTracks"');
          if (Array.isArray(extracted) && extracted.length > 0) {
            syncTracksToDOM(extracted);
            return extracted;
          }
        }
      }
    } catch (e) {}

    return null;
  }

  // 通道 5: Innertube API 官方通道
  async function fetchTracksViaInnertube(videoId) {
    if (!videoId) return null;
    try {
      const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
      const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT') || {
        client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' },
      };

      if (!apiKey) return null;

      const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          context,
          playbackContext: {
            contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' },
          },
        }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      const list = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(list) && list.length > 0) {
        syncTracksToDOM(list);
        return list;
      }
    } catch (e) {}

    return null;
  }

  // 周期性探测
  setInterval(() => {
    extractCaptionTracks();
  }, 1000);

  // CustomEvent 通信
  document.addEventListener('YDQ_EVENT_REQUEST_TRACKS', async (e) => {
    const videoId = e.detail?.videoId;
    let tracks = extractCaptionTracks();
    if (!tracks && videoId) {
      tracks = await fetchTracksViaInnertube(videoId);
    }
    if (tracks) {
      syncTracksToDOM(tracks);
    }
    document.dispatchEvent(
      new CustomEvent('YDQ_EVENT_RESPONSE_TRACKS', {
        detail: { tracks: tracks || [] },
      })
    );
  });

  // 代理拉取字幕
  document.addEventListener('YDQ_EVENT_FETCH_SUBTITLE', async (e) => {
    const { requestId, url } = e.detail || {};
    if (!requestId || !url) return;

    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP 状态码 ${response.status}`);
      }
      const text = await response.text();
      document.dispatchEvent(
        new CustomEvent('YDQ_EVENT_FETCH_SUBTITLE_DONE', {
          detail: { requestId, success: true, text },
        })
      );
    } catch (err) {
      document.dispatchEvent(
        new CustomEvent('YDQ_EVENT_FETCH_SUBTITLE_DONE', {
          detail: { requestId, success: false, error: err.message },
        })
      );
    }
  });
})();
