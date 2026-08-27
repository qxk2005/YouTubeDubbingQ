/**
 * YouTubeDubbingQ - Edge TTS WebSocket 客户端
 * 通过微软 Edge 语音服务 WebSocket 接口生成中文语音
 */

const EdgeTTS = {
  // Edge TTS WebSocket 端点
  WS_URL: 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',

  // 可用的中文语音列表
  VOICES: {
    'zh-CN-XiaoxiaoNeural': { name: '晓晓', gender: '女声', desc: '温暖亲切' },
    'zh-CN-YunxiNeural': { name: '云希', gender: '男声', desc: '阳光活力' },
    'zh-CN-YunjianNeural': { name: '云健', gender: '男声', desc: '沉稳大气' },
    'zh-CN-XiaoyiNeural': { name: '晓伊', gender: '女声', desc: '活泼可爱' },
    'zh-CN-YunyangNeural': { name: '云扬', gender: '男声', desc: '专业播报' },
    'zh-CN-XiaochenNeural': { name: '晓辰', gender: '女声', desc: '知性优雅' },
    'zh-CN-XiaohanNeural': { name: '晓涵', gender: '女声', desc: '温柔甜美' },
    'zh-CN-XiaomengNeural': { name: '晓梦', gender: '女声', desc: '清新自然' },
    'zh-CN-XiaoruiNeural': { name: '晓睿', gender: '女声', desc: '成熟稳重' },
    'zh-CN-XiaozhenNeural': { name: '晓甄', gender: '女声', desc: '端庄大方' },
  },

  /**
   * 生成唯一的请求 ID
   */
  _generateRequestId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  /**
   * 生成连接 Token（模拟 Edge 浏览器的 Token）
   */
  _generateToken() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  },

  /**
   * 构建 SSML 文本
   * @param {string} text 要合成的文本
   * @param {string} voice 语音名称
   * @param {number} rate 语速倍率 (0.5 - 2.0, 1.0 为正常)
   * @returns {string} SSML XML 字符串
   */
  buildSSML(text, voice = 'zh-CN-XiaoxiaoNeural', rate = 1.0) {
    // 将倍率转换为百分比表示 (如 1.2 -> "+20%", 0.8 -> "-20%")
    const ratePercent = Math.round((rate - 1.0) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${rateStr}">
      ${this._escapeXml(text)}
    </prosody>
  </voice>
</speak>`;
  },

  /**
   * XML 转义
   */
  _escapeXml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * 通过 WebSocket 合成语音
   * @param {string} text 要合成的中文文本
   * @param {string} voice 语音名称
   * @param {number} rate 语速倍率
   * @returns {Promise<ArrayBuffer>} 音频数据 (MP3)
   */
  synthesize(text, voice = 'zh-CN-XiaoxiaoNeural', rate = 1.0) {
    return new Promise((resolve, reject) => {
      const requestId = this._generateRequestId().replace(/-/g, '');
      const token = this._generateToken();

      const wsUrl = `${this.WS_URL}?TrustedClientToken=${token}&ConnectionId=${requestId}`;

      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(new Error(`Edge TTS WebSocket 连接失败: ${err.message}`));
        return;
      }

      const audioChunks = [];
      let headerReceived = false;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Edge TTS 请求超时 (30s)'));
      }, 30000);

      ws.onopen = () => {
        // 发送配置消息
        const configMessage =
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify({
            context: {
              synthesis: {
                audio: {
                  metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
                },
              },
            },
          });
        ws.send(configMessage);

        // 发送 SSML 合成请求
        const ssml = this.buildSSML(text, voice, rate);
        const ssmlMessage =
          `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml;
        ws.send(ssmlMessage);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          // 文本消息 - 检查是否完成
          if (event.data.includes('Path:turn.end')) {
            clearTimeout(timeout);
            ws.close();
            // 合并音频数据
            const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of audioChunks) {
              result.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            }
            resolve(result.buffer);
          }
        } else if (event.data instanceof Blob) {
          // 二进制音频数据
          event.data.arrayBuffer().then((buffer) => {
            // 提取音频数据（跳过头部）
            const headerEnd = this._findAudioDataStart(buffer);
            if (headerEnd > 0) {
              audioChunks.push(buffer.slice(headerEnd));
              headerReceived = true;
            } else if (headerReceived) {
              audioChunks.push(buffer);
            }
          });
        } else if (event.data instanceof ArrayBuffer) {
          const headerEnd = this._findAudioDataStart(event.data);
          if (headerEnd > 0) {
            audioChunks.push(event.data.slice(headerEnd));
            headerReceived = true;
          } else if (headerReceived) {
            audioChunks.push(event.data);
          }
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        reject(new Error(`Edge TTS WebSocket 错误: ${error.message || '连接失败'}`));
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        if (audioChunks.length === 0 && !event.wasClean) {
          reject(new Error('Edge TTS 连接关闭但未接收到音频数据'));
        }
      };
    });
  },

  /**
   * 在二进制数据中查找音频数据起始位置
   * Edge TTS 的二进制消息以文本头部开始，用 \r\n\r\n 分隔
   */
  _findAudioDataStart(buffer) {
    const view = new Uint8Array(buffer);
    // 搜索 \r\n\r\n (0x0D 0x0A 0x0D 0x0A)
    for (let i = 0; i < Math.min(view.length - 3, 500); i++) {
      if (view[i] === 0x0d && view[i + 1] === 0x0a && view[i + 2] === 0x0d && view[i + 3] === 0x0a) {
        return i + 4;
      }
    }
    return -1;
  },

  /**
   * 获取可用语音列表
   * @returns {Array<{id: string, name: string, gender: string, desc: string}>}
   */
  getVoiceList() {
    return Object.entries(this.VOICES).map(([id, info]) => ({
      id,
      ...info,
    }));
  },
};

if (typeof window !== 'undefined') {
  window.EdgeTTS = EdgeTTS;
}
