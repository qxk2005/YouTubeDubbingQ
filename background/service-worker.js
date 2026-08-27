/**
 * YouTubeDubbingQ - Service Worker 后台脚本
 * 消息中转和 Offscreen Document 生命周期管理
 */

// Offscreen Document 状态
let offscreenCreated = false;

/**
 * 创建 Offscreen Document
 */
async function createOffscreen() {
  if (offscreenCreated) return;

  try {
    // 检查是否已存在
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      offscreenCreated = true;
      return;
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'TTS 音频生成和播放需要持久的音频上下文',
    });

    offscreenCreated = true;
    console.log('[YDQ SW] Offscreen Document 已创建');
  } catch (e) {
    console.error('[YDQ SW] 创建 Offscreen Document 失败:', e);
  }
}

/**
 * 消息处理
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'YDQ_CREATE_OFFSCREEN':
      createOffscreen().then(() => sendResponse({ success: true }));
      return true; // 异步响应

    case 'YDQ_FETCH_PLAYER_DATA':
      // 通过 Service Worker 代理调用 Innertube API 获取视频元数据
      fetchPlayerData(message.videoId, message.config)
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case 'YDQ_FETCH_URL':
      // 通过 Service Worker 代理下载任意 URL 内容
      fetchUrlContent(message.url)
        .then(sendResponse)
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case 'YDQ_TTS_REQUEST':
      // 确保 Offscreen Document 存在，然后转发请求
      createOffscreen().then(() => {
        // 转发 TTS 请求到 Offscreen Document
        chrome.runtime.sendMessage(message);
      });
      return false;

    case 'YDQ_TTS_RESULT':
      // TTS 结果从 Offscreen Document 返回，转发到 Content Script
      if (sender.url?.includes('offscreen')) {
        // 广播到所有 YouTube 标签
        chrome.tabs.query({ url: '*://*.youtube.com/*' }, (tabs) => {
          for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
          }
        });
      }
      return false;

    case 'YDQ_PLAY_AUDIO':
      // 转发播放请求到 Offscreen Document
      createOffscreen().then(() => {
        chrome.runtime.sendMessage(message);
      });
      return false;

    case 'YDQ_STOP_AUDIO':
      // 转发停止请求
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;

    case 'YDQ_TEST_API':
      // 测试 API 连接
      testApiConnection(message.config).then(sendResponse);
      return true;

    default:
      return false;
  }
});

/**
 * 测试 API 连接
 * @param {Object} config API 配置
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testApiConnection(config) {
  try {
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.apiModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      return { success: true, message: '连接成功！' };
    } else {
      const errorText = await response.text().catch(() => '');
      return { success: false, message: `HTTP ${response.status}: ${errorText}` };
    }
  } catch (e) {
    return { success: false, message: `连接错误: ${e.message}` };
  }
}

/**
 * 通过 Service Worker 调用 YouTube Innertube API 获取视频播放器数据
 * @param {string} videoId 视频 ID
 * @param {Object} config Innertube 配置 {apiKey, clientName, clientVersion}
 * @returns {Promise<{success: boolean, tracks?: Array, error?: string}>}
 */
async function fetchPlayerData(videoId, config) {
  try {
    const apiKey = config?.apiKey || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const clientName = config?.clientName || 'WEB';
    const clientVersion = config?.clientVersion || '2.20240101.00.00';

    const url = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
      },
      body: JSON.stringify({
        videoId: videoId,
        context: {
          client: {
            clientName: clientName,
            clientVersion: clientVersion,
            hl: 'en',
            gl: 'US',
          },
        },
      }),
    });

    if (!response.ok) {
      return { success: false, error: 'Innertube API HTTP ' + response.status };
    }

    const data = await response.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (Array.isArray(tracks) && tracks.length > 0) {
      console.log('[YDQ SW] Innertube API 返回 ' + tracks.length + ' 条字幕轨');
      return { success: true, tracks: tracks };
    }

    return {
      success: false,
      error: 'Innertube 未返回字幕轨道 (playabilityStatus: ' + (data?.playabilityStatus?.status || 'unknown') + ')',
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 通过 Service Worker 代理下载任意 URL 内容
 * @param {string} url 要下载的 URL
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function fetchUrlContent(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: 'HTTP ' + response.status };
    }
    const text = await response.text();
    return { success: true, text: text };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 扩展安装/更新事件
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[YDQ SW] 扩展已安装');
  } else if (details.reason === 'update') {
    console.log('[YDQ SW] 扩展已更新到版本', chrome.runtime.getManifest().version);
  }
});

console.log('[YDQ SW] Service Worker 已启动');
