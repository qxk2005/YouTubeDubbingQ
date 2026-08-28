/**
 * YouTubeDubbingQ - 智能翻译调度器
 * 借鉴 aiyu 优先级排程算法：
 * 1. 播放点优先（当前播放时间点所处的字幕群组最高优先级，评分 0）
 * 2. 前方缓冲（即将播放的字幕按距离当前时间近优先）
 * 3. 失败优先重试（Tier 0 优先重试，避免字幕断档）
 * 4. 过去片段后置（已播放过的字幕大幅降权但仍会处理）
 */

(function (root) {
  const STATE_PENDING = 0;
  const STATE_INFLIGHT = 1;
  const STATE_DONE = 2;
  const STATE_EXHAUSTED = 3;

  /**
   * 创建调度器
   * @param {Array} groups 字幕分组列表 [{ id, startMs, endMs, subtitles: [...] }]
   * @param {Object} opts 配置项 { retryCap: 4 }
   */
  function createTranslateScheduler(groups, opts) {
    const retryCap = (opts && opts.retryCap) || 4;
    const n = groups ? groups.length : 0;
    const state = new Array(n).fill(STATE_PENDING);
    const attempts = new Array(n).fill(0);

    /**
     * 计算位置评分 (分数越小越优先)
     * @param {Object} g 群组
     * @param {number} tSec 当前播放时间 (秒)
     */
    function positionScore(g, tSec) {
      const gStart = (g.startMs || 0) / 1000;
      const gEnd = (g.endMs || g.startMs + 1000) / 1000;

      // 播放点正落在该段内 -> 最优先
      if (tSec >= gStart && tSec < gEnd) return 0;
      // 在播放点前方 -> 越近越优先
      if (gStart >= tSec) return gStart - tSec;
      // 已经播过 -> 大幅延后
      return (tSec - gEnd) * 3 + 100000;
    }

    /**
     * 挑取下一个要翻译的群组
     * Tier 0: 之前失败待重试的群组 (最优先)
     * Tier 1: 全新待翻译群组
     * @param {number} currentTimeSec 当前视频播放秒数
     * @returns {number} 选中的群组索引，无任务时返回 -1
     */
    function pickNext(currentTimeSec) {
      const t = currentTimeSec || 0;
      let best = -1;
      let bestTier = Infinity;
      let bestScore = Infinity;

      for (let i = 0; i < n; i++) {
        if (state[i] !== STATE_PENDING) continue;
        const tier = attempts[i] > 0 ? 0 : 1;
        const score = positionScore(groups[i], t);

        if (tier < bestTier || (tier === bestTier && score < bestScore)) {
          bestTier = tier;
          bestScore = score;
          best = i;
        }
      }

      if (best < 0) return -1;
      state[best] = STATE_INFLIGHT;
      return best;
    }

    /**
     * 记录群组翻译结果
     * @param {number} index 群组索引
     * @param {boolean} ok 是否成功获取完整有效译文
     */
    function record(index, ok) {
      if (index < 0 || index >= n) return;
      if (ok) {
        state[index] = STATE_DONE;
        return;
      }
      attempts[index]++;
      state[index] = attempts[index] >= retryCap ? STATE_EXHAUSTED : STATE_PENDING;
    }

    /**
     * 将重试耗尽的群组重置为待处理
     */
    function reopenExhausted() {
      for (let i = 0; i < n; i++) {
        if (state[i] === STATE_EXHAUSTED) {
          state[i] = STATE_PENDING;
          attempts[i] = 0;
        }
      }
    }

    /**
     * 获取当前调度器状态统计
     */
    function status() {
      let done = 0;
      let exhausted = 0;
      let pending = 0;
      let inflight = 0;

      for (let i = 0; i < n; i++) {
        if (state[i] === STATE_DONE) done++;
        else if (state[i] === STATE_EXHAUSTED) exhausted++;
        else if (state[i] === STATE_INFLIGHT) inflight++;
        else pending++;
      }

      const total = n;
      const progressPct = total > 0 ? Math.round((done / total) * 100) : 100;

      return {
        total,
        done,
        exhausted,
        inflight,
        pending,
        progressPct,
        allResolved: pending === 0 && inflight === 0,
        allDone: done === total && total > 0
      };
    }

    return {
      pickNext,
      record,
      reopenExhausted,
      status,
      groups
    };
  }

  root.TranslateScheduler = {
    create: createTranslateScheduler
  };
})(typeof window !== 'undefined' ? window : globalThis);
