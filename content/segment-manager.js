/**
 * YouTubeDubbingQ - 20秒黄金段落管理模块
 * 将连续字幕智能聚合成约 15~25 秒（目标 20 秒）的自然语义段落，用于生成流畅连贯的中文配音
 */

const SegmentManager = {
  _segments: [],

  /**
   * 将字幕按 20 秒左右的自然停顿划分段落
   * @param {Array} subtitles 字幕数组 [{text, zhText, startMs, endMs, index}, ...]
   * @returns {Array} 段落数组
   */
  segmentSubtitles(subtitles) {
    if (!subtitles || subtitles.length === 0) {
      this._segments = [];
      return [];
    }

    const segments = [];
    const TARGET_DURATION_MS = 20000; // 目标时长 20 秒
    const MIN_DURATION_MS = 16000;    // 最低时长 16 秒（达到此长度后遇到自然断句切分）
    const MAX_DURATION_MS = 26000;    // 最大时长 26 秒（超过此长度强制切分）
    const LARGE_GAP_MS = 3000;        // 视频空白间隙 > 3.0 秒独立断开

    let currentSegmentSubs = [subtitles[0]];
    let segStartMs = subtitles[0].startMs;

    for (let i = 1; i < subtitles.length; i++) {
      const prev = subtitles[i - 1];
      const curr = subtitles[i];
      const gap = curr.startMs - prev.endMs;
      const accumulatedDuration = prev.endMs - segStartMs; // 已打包部分的累计时长
      const projectedDuration = curr.endMs - segStartMs;   // 若加入本句的预期时长

      let shouldBreak = false;

      // 条件 1: 遇到视频空白静音大间隙 (>3.0s)
      if (gap >= LARGE_GAP_MS) {
        shouldBreak = true;
      }
      // 条件 2: 加入本句会超出最大安全时长 (26s)
      else if (projectedDuration >= MAX_DURATION_MS && accumulatedDuration >= 8000) {
        shouldBreak = true;
      }
      // 条件 3: 已打包时长达到 15s 以上，且在自然停顿/断句点切分
      else if (accumulatedDuration >= MIN_DURATION_MS) {
        const isStrongBreak = this._isStrongBreak(prev.text);
        const hasNaturalGap = gap >= 500;
        if (isStrongBreak || hasNaturalGap || accumulatedDuration >= TARGET_DURATION_MS) {
          shouldBreak = true;
        }
      }

      if (shouldBreak) {
        segments.push(this._createSegment(segments.length, currentSegmentSubs));
        currentSegmentSubs = [curr];
        segStartMs = curr.startMs;
      } else {
        currentSegmentSubs.push(curr);
      }
    }

    // 最后一个段落
    if (currentSegmentSubs.length > 0) {
      segments.push(this._createSegment(segments.length, currentSegmentSubs));
    }

    this._segments = segments;
    console.log(
      `[YDQ Segment] 智能分段完成: ${subtitles.length} 条字幕 → ${segments.length} 个配音段落 (平均时长 ~${(
        (subtitles[subtitles.length - 1].endMs - subtitles[0].startMs) /
        1000 /
        Math.max(1, segments.length)
      ).toFixed(1)}s)`
    );

    return segments;
  },

  /**
   * 构建段落对象
   */
  _createSegment(id, subs) {
    const startMs = subs[0].startMs;
    const endMs = subs[subs.length - 1].endMs;
    const durationMs = Math.max(1000, endMs - startMs);
    const durationSec = durationMs / 1000;
    // 正常中文朗读语速约 3.6 字/秒
    const targetMaxChars = Math.round(durationSec * 3.6);

    return {
      id,
      startIndex: subs[0].index !== undefined ? subs[0].index : 0,
      endIndex: subs[subs.length - 1].index !== undefined ? subs[subs.length - 1].index : subs.length - 1,
      startMs,
      endMs,
      durationMs,
      durationSec: parseFloat(durationSec.toFixed(1)),
      targetMaxChars,
      subtitles: subs,
    };
  },

  /**
   * 判断是否包含强断句标志
   */
  _isStrongBreak(text) {
    if (!text) return false;
    const trimmed = text.trim();
    return /[.!?。！？]$/.test(trimmed);
  },

  /**
   * 将段落中的中文字幕合并为连贯朗读文稿
   * @param {Object} segment 段落对象
   * @returns {string} 合并后的精炼文本
   */
  mergeSegmentText(segment) {
    if (!segment || !segment.subtitles) return '';

    const parts = [];
    for (const sub of segment.subtitles) {
      const zh = (sub.zhText || '').trim();
      if (!zh) continue;

      let clean = zh.replace(/^[,，.。!！?？;；:]+/, '').trim();
      if (!clean) continue;

      if (parts.length > 0) {
        const lastChar = parts[parts.length - 1].slice(-1);
        if (!/[，。！？、；：,.!?;:]/.test(lastChar)) {
          parts[parts.length - 1] += '，';
        }
      }
      parts.push(clean);
    }

    let merged = parts.join('');
    if (merged && !/[。！？.!?]$/.test(merged)) {
      merged += '。';
    }
    return merged;
  },

  /**
   * 根据当前播放时间查找对应的段落
   * @param {number} timeMs 当前播放时间毫秒
   * @returns {Object|null}
   */
  findSegmentAtTime(timeMs) {
    for (const seg of this._segments) {
      if (timeMs >= seg.startMs - 200 && timeMs < seg.endMs + 100) {
        return seg;
      }
    }
    return null;
  },

  /**
   * 根据字幕索引查找所在段落
   */
  findSegmentBySubIndex(subIndex) {
    for (const seg of this._segments) {
      if (subIndex >= seg.startIndex && subIndex <= seg.endIndex) {
        return seg;
      }
    }
    return null;
  },

  getSegments() {
    return this._segments;
  },

  clear() {
    this._segments = [];
  },
};

if (typeof window !== 'undefined') {
  window.SegmentManager = SegmentManager;
}
