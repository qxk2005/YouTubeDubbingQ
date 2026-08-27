/**
 * YouTubeDubbingQ - YouTube 字幕获取模块
 * 从 YouTube 视频获取原始英文字幕（CC字幕）
 */

const SubtitleFetcher = {
  /**
   * 获取当前视频 ID
   * @returns {string|null}
   */
  getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  },

  /**
   * 从页面数据中提取字幕轨道信息
   * @returns {Array|null} 字幕轨道列表
   */
  _getCaptionTracks() {
    try {
      // 方法1: 从 ytInitialPlayerResponse 获取
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes('captionTracks')) {
          const match = text.match(/"captionTracks"\s*:\s*(\[.*?\])/);
          if (match) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {
              // JSON 解析失败，尝试其他方法
            }
          }
        }
      }

      // 方法2: 从 ytInitialPlayerResponse 全局变量获取
      if (typeof ytInitialPlayerResponse !== 'undefined') {
        const tracks =
          ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks) return tracks;
      }

      // 方法3: 通过 yt.config_ 获取
      const playerResponse = document.querySelector('#movie_player');
      if (playerResponse) {
        const playerData = playerResponse.getPlayerResponse?.();
        if (playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          return playerData.captions.playerCaptionsTracklistRenderer.captionTracks;
        }
      }

      return null;
    } catch (e) {
      console.error('[YDQ] 获取字幕轨道失败:', e);
      return null;
    }
  },

  /**
   * 查找英文字幕轨道的 URL
   * @returns {string|null} 字幕 URL
   */
  _findEnglishTrackUrl() {
    const tracks = this._getCaptionTracks();
    if (!tracks || tracks.length === 0) {
      console.log('[YDQ] 未找到字幕轨道');
      return null;
    }

    // 优先查找英文字幕
    const englishTrack = tracks.find(
      (t) => t.languageCode === 'en' || t.languageCode?.startsWith('en')
    );

    if (englishTrack) {
      return englishTrack.baseUrl;
    }

    // 如果没有英文，尝试自动生成的英文字幕 (asr)
    const asrTrack = tracks.find(
      (t) =>
        (t.languageCode === 'en' || t.languageCode?.startsWith('en')) &&
        t.kind === 'asr'
    );

    if (asrTrack) {
      return asrTrack.baseUrl;
    }

    // 没有英文字幕，返回第一个可用的字幕
    console.log('[YDQ] 未找到英文字幕，使用第一个可用字幕:', tracks[0]?.languageCode);
    return tracks[0]?.baseUrl || null;
  },

  /**
   * 获取字幕数据（JSON3 格式）
   * @returns {Promise<Array<{text: string, startMs: number, endMs: number, index: number}>>}
   */
  async fetchSubtitles() {
    const videoId = this.getVideoId();
    if (!videoId) {
      throw new Error('无法获取视频 ID');
    }

    let trackUrl = this._findEnglishTrackUrl();

    if (!trackUrl) {
      // 备选方案：直接构建 timedtext API URL
      trackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`;
    }

    // 确保请求 JSON3 格式
    const url = new URL(trackUrl);
    url.searchParams.set('fmt', 'json3');

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        // 尝试不带 lang 参数
        const fallbackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3&kind=asr`;
        const fallbackResponse = await fetch(fallbackUrl);
        if (!fallbackResponse.ok) {
          throw new Error(`字幕获取失败 (HTTP ${response.status})`);
        }
        return this._parseJSON3(await fallbackResponse.json());
      }

      const data = await response.json();
      return this._parseJSON3(data);
    } catch (e) {
      console.error('[YDQ] 字幕获取失败:', e);
      throw e;
    }
  },

  /**
   * 解析 JSON3 格式字幕
   * @param {Object} data JSON3 字幕数据
   * @returns {Array<{text: string, startMs: number, endMs: number, index: number}>}
   */
  _parseJSON3(data) {
    if (!data || !data.events) {
      throw new Error('字幕数据格式无效');
    }

    const subtitles = [];
    let index = 0;

    for (const event of data.events) {
      // 跳过没有文本的事件
      if (!event.segs) continue;

      // 合并 segments 文本
      const text = event.segs
        .map((seg) => seg.utf8 || '')
        .join('')
        .trim();

      if (!text || text === '\n') continue;

      const startMs = event.tStartMs || 0;
      const durationMs = event.dDurationMs || 3000;
      const endMs = startMs + durationMs;

      subtitles.push({
        text,
        startMs,
        endMs,
        index: index++,
        zhText: '', // 翻译后填充
      });
    }

    console.log(`[YDQ] 解析到 ${subtitles.length} 条字幕`);
    return subtitles;
  },

  /**
   * 尝试从 video 元素的 track 获取字幕（备选方案）
   * @returns {Promise<Array>}
   */
  async _fetchFromTrackElement() {
    const video = document.querySelector('video');
    if (!video) throw new Error('未找到视频元素');

    const tracks = video.querySelectorAll('track');
    for (const track of tracks) {
      if (track.kind === 'subtitles' || track.kind === 'captions') {
        if (track.srclang === 'en' || track.srclang.startsWith('en')) {
          const response = await fetch(track.src);
          const vttText = await response.text();
          return this._parseVTT(vttText);
        }
      }
    }

    throw new Error('未找到 track 元素中的英文字幕');
  },

  /**
   * 解析 VTT 格式字幕（备选方案）
   * @param {string} vttText VTT 文本
   * @returns {Array}
   */
  _parseVTT(vttText) {
    const lines = vttText.split('\n');
    const subtitles = [];
    let index = 0;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      // 查找时间码行
      const timeMatch = line.match(
        /(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/
      );

      if (timeMatch) {
        const startMs =
          parseInt(timeMatch[1]) * 3600000 +
          parseInt(timeMatch[2]) * 60000 +
          parseInt(timeMatch[3]) * 1000 +
          parseInt(timeMatch[4]);

        const endMs =
          parseInt(timeMatch[5]) * 3600000 +
          parseInt(timeMatch[6]) * 60000 +
          parseInt(timeMatch[7]) * 1000 +
          parseInt(timeMatch[8]);

        // 读取后续文本行
        i++;
        const textLines = [];
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i].trim());
          i++;
        }

        const text = textLines.join(' ').replace(/<[^>]*>/g, '');
        if (text) {
          subtitles.push({ text, startMs, endMs, index: index++, zhText: '' });
        }
      }

      i++;
    }

    return subtitles;
  },
};

if (typeof window !== 'undefined') {
  window.SubtitleFetcher = SubtitleFetcher;
}
