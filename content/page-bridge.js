/**
 * YouTubeDubbingQ - Main World 桥接脚本
 * 运行在 YouTube 网页主上下文 (MAIN world) 中
 * 负责与 YouTube 播放器深度交互，提取带鉴权签名的真实 captionTracks
 */

(function () {
  'use strict';

  if (window.__YDQ_BRIDGE_INITIALIZED__) return;
  window.__YDQ_BRIDGE_INITIALIZED__ = true;

  console.log('[YDQ Bridge] Main World 宿主脚本已初始化');

  /**
   * 从播放器对象或页面全局变量中全面提取字幕轨道
   */
  function extractCaptionTracks() {
    let tracks = null;
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');

    // 1. 尝试从播放器 API 获取
    if (player) {
      // 尝试确保字幕模块加载
      if (typeof player.loadModule === 'function') {
        try {
          player.loadModule('captions');
        } catch (e) {}
      }

      // 从 getOption('captions', 'tracklist') 获取
      if (typeof player.getOption === 'function') {
        try {
          const tracklist = player.getOption('captions', 'tracklist');
          if (Array.isArray(tracklist) && tracklist.length > 0) {
            tracks = tracklist.map((t) => ({
              baseUrl: t.baseUrl || t.url,
              languageCode: t.languageCode || t.lang,
              name: { simpleText: t.name || t.displayName || t.languageName || '' },
              kind: t.kind || (t.vssId?.startsWith('a.') ? 'asr' : ''),
              vssId: t.vssId,
            })).filter((t) => !!t.baseUrl);
            if (tracks.length > 0) return tracks;
          }
        } catch (e) {}
      }

      // 从 getPlayerResponse() 获取
      if (typeof player.getPlayerResponse === 'function') {
        try {
          const resp = player.getPlayerResponse();
          const list = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (Array.isArray(list) && list.length > 0) {
            return list;
          }
        } catch (e) {}
      }
    }

    // 2. 从 window.ytInitialPlayerResponse 获取
    if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      const list = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    }

    // 3. 从 window.ytplayer?.config?.args 获取
    if (window.ytplayer?.config?.args?.raw_player_response) {
      try {
        const raw = JSON.parse(window.ytplayer.config.args.raw_player_response);
        const list = raw?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (Array.isArray(list) && list.length > 0) {
          return list;
        }
      } catch (e) {}
    }

    return null;
  }

  /**
   * 监听来自 Content Script (ISOLATED world) 的 postMessage 消息
   */
  window.addEventListener('message', async (event) => {
    // 只处理当前窗口的消息
    if (event.source !== window || !event.data || !event.data.type) return;

    // 获取字幕轨道列表
    if (event.data.type === 'YDQ_REQUEST_TRACKS') {
      const requestId = event.data.requestId;
      const tracks = extractCaptionTracks();

      window.postMessage(
        {
          type: 'YDQ_RESPONSE_TRACKS',
          requestId,
          tracks: tracks || [],
        },
        '*'
      );
    }

    // 在 MAIN world 代理拉取字幕内容
    if (event.data.type === 'YDQ_FETCH_SUBTITLE_TEXT') {
      const { requestId, url } = event.data;
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
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
