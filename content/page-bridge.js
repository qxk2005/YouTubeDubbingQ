/**
 * YouTubeDubbingQ - Main World 桥接脚本
 * 运行在 YouTube 网页主上下文 (MAIN world) 中，用于提取播放器数据与字幕轨道
 */

(function () {
  'use strict';

  // 监听来自 Content Script 的字幕数据请求
  window.addEventListener('YDQ_GET_PLAYER_DATA_REQUEST', () => {
    try {
      let captionTracks = null;
      const player = document.getElementById('movie_player');

      if (player && typeof player.getPlayerResponse === 'function') {
        const response = player.getPlayerResponse();
        captionTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      }

      if (!captionTracks && window.ytInitialPlayerResponse) {
        captionTracks =
          window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      }

      // 通过 CustomEvent 返回给 Content Script
      window.dispatchEvent(
        new CustomEvent('YDQ_GET_PLAYER_DATA_RESPONSE', {
          detail: {
            captionTracks: captionTracks || null,
          },
        })
      );
    } catch (e) {
      console.warn('[YDQ Bridge] 获取播放器字幕数据异常:', e);
      window.dispatchEvent(
        new CustomEvent('YDQ_GET_PLAYER_DATA_RESPONSE', {
          detail: { captionTracks: null, error: e.message },
        })
      );
    }
  });

  console.log('[YDQ Bridge] Main World 桥接脚本已就绪');
})();
