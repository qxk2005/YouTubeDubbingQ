/**
 * YouTubeDubbingQ - Offscreen Document 脚本
 * 处理 TTS 音频生成（Edge TTS WebSocket / 豆包 TTS HTTP）和音频播放
 * 运行在 Offscreen Document 环境中，可以维持 WebSocket 长连接和播放音频
 */

(function () {
  'use strict';

  console.log('[YDQ Offscreen] Offscreen Document 已加载');

  // Web Audio API 上下文
  let audioContext = null;
  let currentSource = null;
  let gainNode = null;

  /**
   * 获取或创建 AudioContext
   */
  function getAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContext();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  /**
   * 播放音频数据
   * @param {ArrayBuffer} audioData MP3 音频数据
   * @param {number} volume 音量 (0-1)
   */
  async function playAudio(audioData, volume = 1.0) {
    try {
      // 停止当前播放
      stopAudio();

      const ctx = getAudioContext();

      // 解码音频数据
      const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));

      // 创建音频源
      currentSource = ctx.createBufferSource();
      currentSource.buffer = audioBuffer;

      // 设置音量
      gainNode.gain.value = volume;

      // 连接并播放
      currentSource.connect(gainNode);
      currentSource.start(0);

      currentSource.onended = () => {
        currentSource = null;
      };
    } catch (e) {
      console.error('[YDQ Offscreen] 音频播放失败:', e);
    }
  }

  /**
   * 停止音频播放
   */
  function stopAudio() {
    if (currentSource) {
      try {
        currentSource.stop();
        currentSource.disconnect();
      } catch (e) {
        // 忽略已停止的情况
      }
      currentSource = null;
    }
  }

  /**
   * 处理 TTS 请求
   * @param {Object} message 消息对象
   */
  async function handleTTSRequest(message) {
    const { requestId, engine, text, voice, speed, config } = message;

    try {
      let audioBuffer;

      if (engine === 'edge') {
        // Edge TTS
        audioBuffer = await EdgeTTS.synthesize(text, voice, speed);
      } else if (engine === 'doubao') {
        // 豆包 TTS
        audioBuffer = await DoubaoTTS.synthesize(text, {
          ...config,
          speed,
        });
      } else {
        throw new Error(`未知的 TTS 引擎: ${engine}`);
      }

      // 将 ArrayBuffer 转为 base64 返回
      const base64 = arrayBufferToBase64(audioBuffer);

      chrome.runtime.sendMessage({
        type: 'YDQ_TTS_RESULT',
        requestId,
        audioBase64: base64,
      });
    } catch (e) {
      console.error('[YDQ Offscreen] TTS 生成失败:', e);
      chrome.runtime.sendMessage({
        type: 'YDQ_TTS_RESULT',
        requestId,
        error: e.message,
      });
    }
  }

  /**
   * ArrayBuffer 转 base64
   */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  /**
   * base64 转 ArrayBuffer
   */
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * 消息监听
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'YDQ_TTS_REQUEST':
        handleTTSRequest(message);
        break;

      case 'YDQ_PLAY_AUDIO':
        if (message.audioBase64) {
          const audioData = base64ToArrayBuffer(message.audioBase64);
          playAudio(audioData, message.volume || 1.0);
        }
        break;

      case 'YDQ_STOP_AUDIO':
        stopAudio();
        break;
    }
  });
})();
