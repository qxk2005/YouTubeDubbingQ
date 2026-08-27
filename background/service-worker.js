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
