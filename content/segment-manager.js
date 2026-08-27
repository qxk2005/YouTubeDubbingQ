/**
 * YouTubeDubbingQ - 段落管理模块
 * 将连续字幕智能分成段落，用于生成连贯配音
 */

const SegmentManager = {
  _segments: [],

  /**
   * 将字幕按自然停顿分成段落
   * @param {Array} subtitles 字幕数组 [{text, zhText, startMs, endMs, index}, ...]
   * @returns {Array} 段落数组 [{startIndex, endIndex, startMs, endMs, subtitles}, ...]
   */
  segmentSubtitles(subtitles) {
    if (!subtitles || subtitles.length === 0) return [];

    const segments = [];
    let currentSegment = {
      startIndex: 0,
      subtitles: [subtitles[0]],
    };

    const MAX_SUBS_PER_SEGMENT = 8;
    const MIN_SUBS_PER_SEGMENT = 3;
    const GAP_THRESHOLD_MS = 1200; // 间隙 > 1.2 秒视为自然停顿

    for (let i = 1; i < subtitles.length; i++) {
      const prev = subtitles[i - 1];
      const curr = subtitles[i];
      const gap = curr.startMs - prev.endMs;

      // 是否应该在此处断开段落
      const shouldBreak =
        // 达到最大句数
        currentSegment.subtitles.length >= MAX_SUBS_PER_SEGMENT ||
        // 自然停顿（间隙大）
        (gap >= GAP_THRESHOLD_MS && currentSegment.subtitles.length >= MIN_SUBS_PER_SEGMENT) ||
        // 上一句末尾是强断句标志且已积累足够句数
        (currentSegment.subtitles.length >= MIN_SUBS_PER_SEGMENT &&
          this._isStrongBreak(prev.text));

      if (shouldBreak) {
        segments.push(this._finalizeSegment(currentSegment));
        currentSegment = {
          startIndex: i,
          subtitles: [curr],
        };
      } else {
        currentSegment.subtitles.push(curr);
      }
    }

    // 最后一个段落
    if (currentSegment.subtitles.length > 0) {
      segments.push(this._finalizeSegment(currentSegment));
    }

    this._segments = segments;
    console.log(`[YDQ] 分段完成: ${subtitles.length} 条字幕 → ${segments.length} 个段落`);
    return segments;
  },

  /**
   * 完成段落的元数据计算
   */
  _finalizeSegment(seg) {
    const subs = seg.subtitles;
    return {
      startIndex: seg.startIndex,
      endIndex: seg.startIndex + subs.length - 1,
      startMs: subs[0].startMs,
      endMs: subs[subs.length - 1].endMs,
      durationMs: subs[subs.length - 1].endMs - subs[0].startMs,
      subtitles: subs,
    };
  },

  /**
   * 判断是否为强断句标志
   */
  _isStrongBreak(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /[.!?。！？]$/.test(trimmed);
  },

  /**
   * 将段落中的中文字幕合并为连贯文本
   * 用逗号/句号连接，保持语气连贯
   * @param {Object} segment 段落对象
   * @returns {string} 合并后的中文文本
   */
  mergeSegmentText(segment) {
    const texts = [];
    for (const sub of segment.subtitles) {
      const zh = (sub.zhText || '').trim();
      if (!zh) continue;

      // 如果上一句没有结尾标点，加逗号连接
      let text = zh;
      if (texts.length > 0) {
        const lastChar = texts[texts.length - 1].slice(-1);
        if (!/[，。！？、；：,.!?;:]/.test(lastChar)) {
          texts[texts.length - 1] += '，';
        }
      }
      texts.push(text);
    }

    // 最后加句号
    let merged = texts.join('');
    if (merged && !/[。！？.!?]$/.test(merged)) {
      merged += '。';
    }
    return merged;
  },

  /**
   * 根据时间查找当前所在段落
   * @param {number} timeMs 当前时间
   * @returns {Object|null} 段落对象
   */
  findSegmentAtTime(timeMs) {
    for (const seg of this._segments) {
      if (timeMs >= seg.startMs - 200 && timeMs < seg.endMs + 200) {
        return seg;
      }
    }
    return null;
  },

  /**
   * 根据字幕索引查找所在段落
   * @param {number} subIndex 字幕索引
   * @returns {Object|null}
   */
  findSegmentBySubIndex(subIndex) {
    for (const seg of this._segments) {
      if (subIndex >= seg.startIndex && subIndex <= seg.endIndex) {
        return seg;
      }
    }
    return null;
  },

  /**
   * 获取所有段落
   */
  getSegments() {
    return this._segments;
  },

  /**
   * 清空
   */
  clear() {
    this._segments = [];
  },
};

if (typeof window !== 'undefined') {
  window.SegmentManager = SegmentManager;
}
