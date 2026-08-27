/**
 * YouTubeDubbingQ - AI 翻译模块
 * 通过 OpenAI 兼容 API 批量翻译英文字幕为中文
 * 翻译时约束长度以保证音画同步
 */

const Translator = {
  // 翻译缓存 (key: videoId_index, value: zhText)
  _cache: new Map(),

  // 翻译状态
  _translating: false,
  _abortController: null,

  /**
   * 批量翻译字幕
   * @param {Array} subtitles 字幕数组
   * @param {Object} config API 配置 {apiBaseUrl, apiKey, apiModel}
   * @param {Function} onProgress 进度回调 (translated, total) => void
   * @returns {Promise<Array>} 带有 zhText 的字幕数组
   */
  async translateAll(subtitles, config, onProgress) {
    if (!config.apiBaseUrl || !config.apiKey) {
      throw new Error('请先配置 AI 翻译服务的 API 地址和 Key');
    }

    this._translating = true;
    this._abortController = new AbortController();

    const videoId = SubtitleFetcher.getVideoId();
    const batchSize = 25; // 每批翻译的字幕数量
    const maxConcurrency = 3; // 最大并发数
    let translated = 0;

    // 检查缓存
    const uncachedSubtitles = subtitles.filter((sub) => {
      const cacheKey = `${videoId}_${sub.index}`;
      if (this._cache.has(cacheKey)) {
        sub.zhText = this._cache.get(cacheKey);
        translated++;
        return false;
      }
      return true;
    });

    if (onProgress) onProgress(translated, subtitles.length);

    if (uncachedSubtitles.length === 0) {
      this._translating = false;
      return subtitles;
    }

    // 分批
    const batches = [];
    for (let i = 0; i < uncachedSubtitles.length; i += batchSize) {
      batches.push(uncachedSubtitles.slice(i, i + batchSize));
    }

    // 并发翻译
    const processBatch = async (batch) => {
      if (!this._translating) return;

      try {
        const results = await this._translateBatch(batch, config);

        for (const result of results) {
          const sub = batch.find((s) => s.index === result.index);
          if (sub) {
            sub.zhText = result.zh;
            const cacheKey = `${videoId}_${sub.index}`;
            this._cache.set(cacheKey, result.zh);
            translated++;
          }
        }

        if (onProgress) onProgress(translated, subtitles.length);
      } catch (e) {
        console.error('[YDQ] 批量翻译失败:', e);
        // 对失败的批次逐条翻译
        for (const sub of batch) {
          if (!this._translating) break;
          if (!sub.zhText) {
            try {
              const result = await this._translateSingle(sub, config);
              sub.zhText = result;
              const cacheKey = `${videoId}_${sub.index}`;
              this._cache.set(cacheKey, result);
              translated++;
              if (onProgress) onProgress(translated, subtitles.length);
            } catch (e2) {
              console.error(`[YDQ] 字幕 #${sub.index} 翻译失败:`, e2);
              sub.zhText = sub.text; // 翻译失败使用原文
              translated++;
            }
          }
        }
      }
    };

    // 控制并发
    const queue = [...batches];
    const running = [];

    while (queue.length > 0 || running.length > 0) {
      if (!this._translating) break;

      while (running.length < maxConcurrency && queue.length > 0) {
        const batch = queue.shift();
        const promise = processBatch(batch).then(() => {
          running.splice(running.indexOf(promise), 1);
        });
        running.push(promise);
      }

      if (running.length > 0) {
        await Promise.race(running);
      }
    }

    this._translating = false;
    return subtitles;
  },

  /**
   * 批量翻译一批字幕
   * @param {Array} batch 字幕批次
   * @param {Object} config API 配置
   * @returns {Promise<Array<{index: number, zh: string}>>}
   */
  async _translateBatch(batch, config) {
    const subtitleText = batch
      .map((sub) => `${sub.index}|${sub.text}`)
      .join('\n');

    const prompt = `你是一个专业的视频字幕翻译员。请将以下英文字幕翻译成简体中文。

要求：
1. 每条翻译的中文字符数应尽量控制在原文英文单词数的1.2倍以内，确保配音时间长度接近原文
2. 翻译要自然流畅，适合语音朗读
3. 保持简洁精炼，避免冗长
4. 直接返回JSON数组，不要包含任何其他内容

字幕列表（每行格式：序号|原文）：
${subtitleText}

返回格式示例：[{"index": 0, "zh": "翻译内容"}]`;

    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.apiModel || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              '你是一个专业的视频字幕翻译员。请严格按照JSON数组格式返回翻译结果，不要输出任何其他内容。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
      signal: this._abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('API 返回空内容');
    }

    // 解析 JSON 结果
    try {
      // 尝试提取 JSON 数组（可能被 markdown 代码块包裹）
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (e) {
      console.error('[YDQ] 翻译结果 JSON 解析失败:', content);
      throw new Error('翻译结果格式错误');
    }
  },

  /**
   * 单条字幕翻译（降级方案）
   * @param {Object} sub 字幕对象
   * @param {Object} config API 配置
   * @returns {Promise<string>} 中文翻译
   */
  async _translateSingle(sub, config) {
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

    const wordCount = sub.text.split(/\s+/).length;
    const maxChars = Math.ceil(wordCount * 1.2);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.apiModel || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: '你是一个视频字幕翻译员。直接返回翻译结果，不要任何解释。',
          },
          {
            role: 'user',
            content: `将以下英文翻译为简体中文（控制在${maxChars}个中文字符以内）：\n${sub.text}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
      signal: this._abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`API 请求失败 (${response.status})`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || sub.text;
  },

  /**
   * 停止翻译
   */
  stop() {
    this._translating = false;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  },

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache.clear();
  },

  /**
   * 测试 API 连接
   * @param {Object} config API 配置
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection(config) {
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
        return { success: false, message: `连接失败 (${response.status}): ${errorText}` };
      }
    } catch (e) {
      return { success: false, message: `连接错误: ${e.message}` };
    }
  },
};

if (typeof window !== 'undefined') {
  window.Translator = Translator;
}
