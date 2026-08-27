/**
 * YouTubeDubbingQ - Main World 桥接脚本 (深度增强版)
 * 运行在 YouTube 网页主上下文 (MAIN world) 中
 * 整合 6 大数据通道（包括 Innertube API 官方通道），提取完整且带合法签名的真实 captionTracks
 */

(function () {
  'use strict';

  if (window.__YDQ_BRIDGE_INITIALIZED__) return;
  window.__YDQ_BRIDGE_INITIALIZED__ = true;

  console.log('[YDQ Bridge] Main World 深度桥接脚本已就绪');

  /**
   * 通道 1-5：从 DOM、播放器实例或全局对象中提取字幕轨
   */
  function extractTracksFromPage() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // 通道 1: 播放器 getOption
    if (player && typeof player.getOption === 'function') {
      try {
        const tracklist = player.getOption('captions', 'tracklist');
        if (Array.isArray(tracklist) && tracklist.length > 0) {
          const valid = tracklist.map((t) => ({
            baseUrl: t.baseUrl || t.url,
            languageCode: t.languageCode || t.lang,
            name: { simpleText: t.name || t.displayName || t.languageName || '' },
            kind: t.kind || (t.vssId?.startsWith('a.') ? 'asr' : ''),
            vssId: t.vssId,
          })).filter((t) => !!t.baseUrl);
          if (valid.length > 0) return valid;
        }
      } catch (e) {}
    }

    // 通道 2: 播放器 getPlayerResponse
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const resp = player.getPlayerResponse();
        const list = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(list) && list.length > 0) return list;
      } catch (e) {}
    }

    // 通道 3: ytd-watch-flexy 组件数据
    try {
      const watchFlexy = document.querySelector('ytd-watch-flexy');
      if (watchFlexy?.playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const list = watchFlexy.playerData.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list) && list.length > 0) return list;
      }
    } catch (e) {}

    // 通道 4: window.ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const list = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (Array.isArray(list) && list.length > 0) return list;
    }

    // 通道 5: window.ytplayer 配置
    if (window.ytplayer?.config?.args?.raw_player_response) {
      try {
        const raw = JSON.parse(window.ytplayer.config.args.raw_player_response);
        const list = raw?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(list) && list.length > 0) return list;
      } catch (e) {}
    }

    return null;
  }

  /**
   * 通道 6: 直接调用 YouTube Innertube API (/youtubei/v1/player) 兜底获取
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
        console.log('[YDQ Bridge] 通过 Innertube API 成功获取到字幕轨:', list.length);
        return list;
      }
    } catch (e) {
      console.warn('[YDQ Bridge] Innertube API 降级请求失败:', e);
    }

    return null;
  }

  /**
   * 消息监听与处理
   */
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || !event.data.type) return;

    // 获取字幕轨道
    if (event.data.type === 'YDQ_REQUEST_TRACKS') {
      const { requestId, videoId } = event.data;

      // 先从页面 DOM / 播放器获取
      let tracks = extractTracksFromPage();

      // 如果未获取到，尝试 Innertube API 兜底
      if (!tracks && videoId) {
        tracks = await fetchTracksViaInnertube(videoId);
      }

      window.postMessage(
        {
          type: 'YDQ_RESPONSE_TRACKS',
          requestId,
          tracks: tracks || [],
        },
        '*'
      );
    }

    // 在页面宿主环境拉取字幕原汁原味内容 (绝不改动带签名的 URL)
    if (event.data.type === 'YDQ_FETCH_SUBTITLE_TEXT') {
      const { requestId, url } = event.data;
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          throw new Error(`HTTP 状态码 ${response.status}`);
        }
        const text = await response.text();
        window.postMessage(
          {
            type: 'YDQ_RESPONSE_SUBTITLE_TEXT',
            requestId,
            success: true,
            text,
          },
          '*'
        );
      } catch (err) {
        window.postMessage(
          {
            type: 'YDQ_RESPONSE_SUBTITLE_TEXT',
            requestId,
            success: false,
            error: err.message,
          },
          '*'
        );
      }
    }
  });
})();
