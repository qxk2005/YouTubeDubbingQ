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
    const totalDurationSec = batch.reduce((sum, s) => sum + (s.endMs - s.startMs) / 1000, 0).toFixed(1);
    const subtitleLines = batch
      .map((sub) => {
        const durationSec = ((sub.endMs - sub.startMs) / 1000).toFixed(1);
        const maxChars = Math.max(4, Math.round(parseFloat(durationSec) * 3.6));
        return `[#${sub.index}|${durationSec}s|建议≤${maxChars}字] ${sub.text}`;
      })
      .join('\n');

    const prompt = `你是一名资深的影视/纪录片国语配音导演兼翻译专家。请将以下 YouTube 视频英文字幕翻译为精炼、自然、流畅的简体中文配音稿。

【核心配音要求（至关重要）】：
1. 【字数严格压缩】：中文正常自然朗读语速为 3.5~3.8 字/秒。每条翻译的中文字数必须严格控制在给定的建议字数内，确保在对应时间内能以平稳自然的正常语速从容读完，绝不能过长导致配音滞后或需要快进！
2. 【提炼去冗余】：果断剔除英文口头禅与无实质信息的填充词（例如：You know, Like, Actually, Basically, As you can see, I mean, Well, Right here 等），将冗长从句浓缩为干练地道的中文表达。
3. 【段落连贯顺畅】：以 20 秒左右的整体语境为单位，前后句子衔接要通顺连贯，语气自然，适合专业播音员口播朗读，听感舒适。
4. 【忠实原意】：在压缩字数的同时精准保留核心技术概念、数据与原意。
5. 【纯 JSON 格式输出】：必须直接返回标准 JSON 数组，严禁任何 Markdown 标记或额外解释。

【字幕清单（本批总时长约 ${totalDurationSec} 秒）】：
${subtitleLines}

【返回格式示例】：
[{"index": ${batch[0].index}, "zh": "精炼中文配音内容"}]`;

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
              '你是一名专业的视频配音翻译员。必须严格按照JSON数组格式输出精炼中文翻译，确保每句字数与时长严格匹配。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.25,
        max_tokens: 4096,
      }),
      signal: this._abortController?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`AI API 请求失败 (${response.status}): ${errorText}`);
    }

    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      throw new Error('AI API 返回空响应');
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`AI API 响应解析失败: ${rawText.slice(0, 100)}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('AI API 返回的选择内容为空');
    }

    // 解析 JSON 结果
    try {
      const cleanContent = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
      const jsonMatch = cleanContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(cleanContent);
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
    const durationSec = Math.max(1, (sub.endMs - sub.startMs) / 1000);
    const maxChars = Math.max(4, Math.round(durationSec * 3.6));

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
            content: '你是视频配音翻译员。请直接返回精炼、口语化的简体中文配音，不要任何解释。',
          },
          {
            role: 'user',
            content: `请将以下英文字幕翻译为精炼流畅的口语化中文（时长 ${durationSec.toFixed(1)} 秒，中文字数必须严格控制在 ${maxChars} 字以内）：\n${sub.text}`,
          },
        ],
        temperature: 0.25,
        max_tokens: 256,
      }),
      signal: this._abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`API 请求失败 (${response.status})`);
    }

    const raw = await response.text();
    if (!raw) return sub.text;
    const data = JSON.parse(raw);
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
