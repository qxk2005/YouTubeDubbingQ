/**
 * YouTubeDubbingQ - Main World 桥接脚本 (DOM 同步直读 + CustomEvent 通信)
 * 运行在 YouTube 网页宿主环境 (MAIN world) 中
 */

(function () {
  'use strict';

  if (window.__YDQ_BRIDGE_INITIALIZED__) return;
  window.__YDQ_BRIDGE_INITIALIZED__ = true;

  console.log('[YDQ Bridge] Main World 宿主脚本已初始化');

  /**
   * 将数据同步写入 DOM 隐藏节点，供 Content Script 0ms 无损直读
   */
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

  /**
   * 从播放器对象或页面全局变量中全面提取字幕轨道
   */
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

    // 通道 3: ytd-watch-flexy 组件
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy?.playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const list = watchFlexy.playerData.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          syncTracksToDOM(list);
          return list;
        }
      }
    } catch (e) {}

    // 通道 4: window.ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const list = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (Array.isArray(list) && list.length > 0) {
        syncTracksToDOM(list);
        return list;
      }
    }

    // 通道 5: window.ytplayer
    if (window.ytplayer?.config?.args?.raw_player_response) {
      try {
        const raw = JSON.parse(window.ytplayer.config.args.raw_player_response);
        const list = raw?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          syncTracksToDOM(list);
          return list;
        }
      } catch (e) {}
    }

    return null;
  }

  /**
   * 通道 6: 调用 YouTube Innertube 官方 API (/youtubei/v1/player)
   */
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
    } catch (e) {
      console.warn('[YDQ Bridge] Innertube 请求失败:', e);
    }

    return null;
  }

  // 周期性探测并自动同步到 DOM
  setInterval(() => {
    extractCaptionTracks();
  }, 1000);

  // 监听来自 Content Script 的 CustomEvent
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

  // 代理拉取字幕内容
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
