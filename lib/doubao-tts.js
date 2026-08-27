/**
 * YouTubeDubbingQ - 豆包 TTS API 客户端
 * 通过 OpenAI 兼容接口调用豆包 TTS 服务
 */

const DoubaoTTS = {
  /**
   * 合成语音
   * @param {string} text 要合成的文本
   * @param {Object} config 配置
   * @param {string} config.apiUrl API 地址（如 https://api.doubao.com）
   * @param {string} config.apiKey API Key
   * @param {string} config.model 模型名称
   * @param {string} config.voice 语音 ID
   * @param {number} config.speed 语速 (0.25 - 4.0, 1.0 为正常)
   * @returns {Promise<ArrayBuffer>} 音频数据
   */
  async synthesize(text, config) {
    const { apiUrl, apiKey, model, voice, speed = 1.0 } = config;

    if (!apiUrl || !apiKey) {
      throw new Error('豆包 TTS 未配置 API 地址或 API Key');
    }

    const url = `${apiUrl.replace(/\/+$/, '')}/v1/audio/speech`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'tts-1',
        input: text,
        voice: voice || 'alloy',
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`豆包 TTS 请求失败 (${response.status}): ${errorText}`);
    }

    return await response.arrayBuffer();
  },

  /**
   * 测试连接
   * @param {Object} config 配置对象
   * @returns {Promise<boolean>} 是否连接成功
   */
  async testConnection(config) {
    try {
      await this.synthesize('测试', { ...config, speed: 1.0 });
      return true;
    } catch (e) {
      console.error('豆包 TTS 连接测试失败:', e);
      return false;
    }
  },
};

if (typeof window !== 'undefined') {
  window.DoubaoTTS = DoubaoTTS;
}
