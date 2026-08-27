/**
 * YouTubeDubbingQ - Offscreen Document 脚本 (v2)
 * 
 * v2 变更:
 * - 新增浏览器原生 SpeechSynthesis TTS 作为主引擎
 * - Edge TTS WebSocket 降级为备选（浏览器中通常会失败）
 * - 音频播放保持 Web Audio API
 */

(function () {
  'use strict';

  console.log('[YDQ Offscreen] Offscreen Document v2 已加载');

  // Web Audio API
  let audioContext = null;
  let currentSource = null;
  let gainNode = null;

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

  async function playAudio(audioData, volume = 1.0) {
    try {
      stopAudio();
      const ctx = getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
      currentSource = ctx.createBufferSource();
      currentSource.buffer = audioBuffer;
      gainNode.gain.value = volume;
      currentSource.connect(gainNode);
      currentSource.start(0);
      currentSource.onended = () => { currentSource = null; };
    } catch (e) {
      console.error('[YDQ Offscreen] 音频播放失败:', e);
    }
  }

  function stopAudio() {
    if (currentSource) {
      try { currentSource.stop(); currentSource.disconnect(); } catch (e) {}
      currentSource = null;
    }
  }

  // ============= TTS 合成 =============

  /**
   * 使用浏览器原生 SpeechSynthesis 合成音频
   * 通过 MediaRecorder 录制为可播放的音频数据
   */
  async function synthesizeWithNativeTTS(text, voice, speed) {
    return new Promise((resolve, reject) => {
      if (!window.speechSynthesis) {
        reject(new Error('浏览器不支持 SpeechSynthesis API'));
        return;
      }

      // 取消之前的语音
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = Math.max(0.5, Math.min(2.0, speed || 1.0));
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // 尝试选择中文语音
      const voices = window.speechSynthesis.getVoices();
      const zhVoice = voices.find(v => v.lang === 'zh-CN' || v.lang.startsWith('zh'))
        || voices.find(v => v.lang.includes('zh') || v.name.includes('Chinese'))
        || voices.find(v => v.name.includes('Microsoft') && v.lang.startsWith('zh'));

      if (zhVoice) {
        utterance.voice = zhVoice;
        console.log('[YDQ Offscreen] 使用语音:', zhVoice.name);
      }

      // 使用 AudioContext + MediaStreamDestination 录制
      try {
        const ctx = getAudioContext();
        const dest = ctx.createMediaStreamDestination();
        const mediaRecorder = new MediaRecorder(dest.stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm'
        });

        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          if (chunks.length === 0) {
            reject(new Error('录制无数据'));
            return;
          }
          const blob = new Blob(chunks, { type: 'audio/webm' });
          try {
            const buffer = await blob.arrayBuffer();
            resolve(buffer);
          } catch (e) {
            reject(e);
          }
        };

        mediaRecorder.start();

        utterance.onend = () => {
          setTimeout(() => mediaRecorder.stop(), 100);
        };

        utterance.onerror = (e) => {
          mediaRecorder.stop();
          reject(new Error('SpeechSynthesis 错误: ' + (e.error || 'unknown')));
        };

        window.speechSynthesis.speak(utterance);

        // 超时
        setTimeout(() => {
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            window.speechSynthesis.cancel();
          }
        }, 15000);

      } catch (recordErr) {
        // 如果 MediaRecorder 不可用，退回到直接朗读模式
        console.warn('[YDQ Offscreen] MediaRecorder 不可用，使用直接朗读模式');
        
        utterance.onend = () => resolve(null);
        utterance.onerror = (e) => reject(new Error('SpeechSynthesis 错误: ' + (e.error || 'unknown')));
        window.speechSynthesis.speak(utterance);

        setTimeout(() => {
          window.speechSynthesis.cancel();
          resolve(null);
        }, 15000);
      }
    });
  }

  /**
   * 使用 Edge TTS WebSocket 合成 (可能在浏览器中失败)
   */
  async function synthesizeWithEdgeTTS(text, voice, speed) {
    if (typeof EdgeTTS !== 'undefined') {
      return await EdgeTTS.synthesize(text, voice, speed);
    }
    throw new Error('EdgeTTS 模块未加载');
  }

  /**
   * 处理 TTS 请求 - 多引擎降级
   */
  async function handleTTSRequest(message) {
    const { requestId, engine, text, voice, speed, config } = message;

    try {
      let audioBuffer = null;

      if (engine === 'doubao' && typeof DoubaoTTS !== 'undefined') {
        audioBuffer = await DoubaoTTS.synthesize(text, { ...config, speed });
      } else {
        // Edge TTS 优先尝试，失败则用原生 SpeechSynthesis
        try {
          audioBuffer = await synthesizeWithEdgeTTS(text, voice, speed);
          console.log('[YDQ Offscreen] Edge TTS 合成成功');
        } catch (edgeErr) {
          console.warn('[YDQ Offscreen] Edge TTS 失败:', edgeErr.message, '，切换到原生 TTS');
          audioBuffer = await synthesizeWithNativeTTS(text, voice, speed);
        }
      }

      if (audioBuffer) {
        const base64 = arrayBufferToBase64(audioBuffer);
        chrome.runtime.sendMessage({
          type: 'YDQ_TTS_RESULT',
          requestId,
          audioBase64: base64,
        });
      } else {
        // 原生 TTS 直接朗读模式（无录制数据），通知成功但无音频数据
        // 音频已经通过 SpeechSynthesis 直接播放了
        chrome.runtime.sendMessage({
          type: 'YDQ_TTS_RESULT',
          requestId,
          audioBase64: null,
          directPlay: true,
        });
      }
    } catch (e) {
      console.error('[YDQ Offscreen] TTS 生成失败:', e);
      chrome.runtime.sendMessage({
        type: 'YDQ_TTS_RESULT',
        requestId,
        error: e.message,
      });
    }
  }

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

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // 确保语音列表已加载
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      const voices = window.speechSynthesis.getVoices();
      const zhVoices = voices.filter(v => v.lang.startsWith('zh'));
      console.log('[YDQ Offscreen] 可用中文语音:', zhVoices.map(v => v.name + ' (' + v.lang + ')').join(', '));
    });
  }

  // 消息监听
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
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        break;
    }
  });
})();
