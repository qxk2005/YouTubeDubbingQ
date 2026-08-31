/**
 * YouTubeDubbingQ - 音频播放控制模块 (智能双向弹性拟合 + 视频微变速同步 + 刚性追帧)
 * 
 * 核心特性：
 * 1. 智能双向弹性拟合：当中文译文较长时，视频平滑微调降速 (0.85x~0.92x) 配合配音；遇到空白停顿微加速 (1.08x) 滑行
 * 2. 刚性追帧熔断：若配音落后达到 2 段（lagCount >= 2），瞬时跳跃定位至当前画面字幕并立即发声
 * 3. 连续播放非破坏性流转：保证每一句完整读完，平滑衔接下一句
 * 4. 用户 Seek 瞬时响应：用户点击逐字稿单句或拖拽进度条时，瞬时切断旧音并精准播放所选句子
 * 5. 暂停/关闭无损复位：随时还原原视频基础倍速与音量
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _originalVolume: 1.0,
  _basePlaybackRate: 1.0, // 用户原生视频倍速基准
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,
  _lastSpokenSubtitleIndex: -1,

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._basePlaybackRate = 1.0;
    this._lastSpokenSubtitleIndex = -1;
    this._targetVideoVolume = null;
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
    if (this._enabled) {
      const video = document.querySelector('video');
      if (video && !video.paused && !TTSManager.isSpeaking()) {
        this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
      }
    }
  },

  enable() {
    this._enabled = true;
    this._lastSpokenSubtitleIndex = -1;
    const video = document.querySelector('video');
    if (video) {
      this._originalVolume = video.volume;
      this._basePlaybackRate = video.playbackRate || 1.0;
      const target = (this._settings.originalVolume ?? 20) / 100;
      this._setVideoVolume(video, target);
    }
    this._startPlaybackLoop();
    this._startVolumeEnforcement();
    this._bindVideoEvents();

    if (video && !video.paused) {
      this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
    }
  },

  disable() {
    this._enabled = false;
    this._stopPlaybackLoop();
    this._stopVolumeEnforcement();
    this._restoreVideoVolume();
    this._restoreVideoPlaybackRate();
    if (typeof TTSManager !== 'undefined') TTSManager.stop();
    this._unbindVideoEvents();
    this._lastSpokenSubtitleIndex = -1;
  },

  _setVideoVolume(video, volume) {
    if (!video) return;
    this._targetVideoVolume = Math.max(0, Math.min(1, volume));
    video.volume = this._targetVideoVolume;
  },

  _startVolumeEnforcement() {
    this._stopVolumeEnforcement();
    this._volumeEnforceInterval = setInterval(() => {
      if (!this._enabled || this._targetVideoVolume === null) return;
      const video = document.querySelector('video');
      if (video && Math.abs(video.volume - this._targetVideoVolume) > 0.01) {
        video.volume = this._targetVideoVolume;
      }
    }, 500);
  },

  _stopVolumeEnforcement() {
    if (this._volumeEnforceInterval) {
      clearInterval(this._volumeEnforceInterval);
      this._volumeEnforceInterval = null;
    }
    this._targetVideoVolume = null;
  },

  _restoreVideoVolume() {
    const video = document.querySelector('video');
    if (video) video.volume = this._originalVolume;
  },

  _restoreVideoPlaybackRate() {
    const video = document.querySelector('video');
    if (video && Math.abs(video.playbackRate - this._basePlaybackRate) > 0.01) {
      video.playbackRate = this._basePlaybackRate;
    }
  },

  // ============= 逐句精准播放与智能微变速循环 =============

  _startPlaybackLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const loop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        const currentTimeMs = video.currentTime * 1000;
        this._checkAndSpeakSubtitle(currentTimeMs, false);
        this._applyPaceSync(video, currentTimeMs);
      }

      this._rafId = requestAnimationFrame(loop);
    };

    this._rafId = requestAnimationFrame(loop);
  },

  _stopPlaybackLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  /**
   * 智能视频微变速同步引擎 (Smart Video Pace Sync)
   * 双向弹性拟合：译文较长时视频微调降速配合配音，空白停顿微加速滑行
   */
  _applyPaceSync(video, currentTimeMs) {
    if (!video || video.paused) return;
    if (this._settings.autoPaceSync === false) {
      this._restoreVideoPlaybackRate();
      return;
    }

    let targetRate = this._basePlaybackRate;

    if (TTSManager.isSpeaking()) {
      const speakingIndex = TTSManager.getCurrentSubtitleIndex();
      if (speakingIndex >= 0 && this._subtitles[speakingIndex]) {
        const sub = this._subtitles[speakingIndex];
        const timeRemainingMs = sub.endMs - currentTimeMs;

        // 视频即将离开该字幕（剩余时间 < 800ms）但配音仍在朗读中：微调降速为发音争取时间
        if (timeRemainingMs < 800) {
          targetRate = this._basePlaybackRate * 0.86;
        } else if (timeRemainingMs < 1400) {
          targetRate = this._basePlaybackRate * 0.92;
        } else {
          targetRate = this._basePlaybackRate;
        }
      }
    } else {
      // 当前未在发声，检测距离下一句字幕是否有空白静音间隙
      const nextSub = this._findNextSubtitle(currentTimeMs);
      if (nextSub) {
        const silenceGapMs = nextSub.startMs - currentTimeMs;
        // 处于大空白间隙 (>500ms) 时，轻微加速滑行至下一句起点
        if (silenceGapMs > 500) {
          targetRate = this._basePlaybackRate * 1.08;
        } else {
          targetRate = this._basePlaybackRate;
        }
      } else {
        targetRate = this._basePlaybackRate;
      }
    }

    // 仅在倍速发生变化时更新 DOM，节约性能
    if (Math.abs(video.playbackRate - targetRate) > 0.02) {
      video.playbackRate = targetRate;
    }
  },

  /**
   * 查找当前时间点之后的下一条字幕
   */
  _findNextSubtitle(currentTimeMs) {
    for (const sub of this._subtitles) {
      if (sub.startMs > currentTimeMs) {
        return sub;
      }
    }
    return null;
  },

  /**
   * 检查并触发当前字幕句子的配音 (带落后不超2段刚性追帧熔断)
   * @param {number} currentTimeMs 当前视频播放毫秒数
   * @param {boolean} [isSeek=false] 是否为用户主动跳转/点击
   */
  _checkAndSpeakSubtitle(currentTimeMs, isSeek = false) {
    if (typeof TTSManager === 'undefined' || !this._subtitles.length) return;

    // 二分查找当前视频画面所在的字幕索引
    const currentVideoIndex = this._findSubtitleIndex(currentTimeMs);
    if (currentVideoIndex === -1) {
      return;
    }

    const currentSub = this._subtitles[currentVideoIndex];
    if (!currentSub || !currentSub.zhText || !currentSub.zhText.trim()) {
      return;
    }

    // 1. 用户主动 Seek / 点击逐字稿单句
    if (isSeek) {
      this._lastSpokenSubtitleIndex = currentVideoIndex;
      TTSManager.speakSubtitle(currentSub, true);
      return;
    }

    // 2. 正常连续播放时的调度与落后检测
    if (TTSManager.isSpeaking()) {
      const speakingIndex = TTSManager.getCurrentSubtitleIndex();
      if (speakingIndex >= 0) {
        const lagCount = currentVideoIndex - speakingIndex;

        // 核心规则：若配音朗读落后画面达到 2 段及以上 (lagCount >= 2)，触发刚性追赶熔断！
        if (lagCount >= 2) {
          console.warn(
            `[YDQ Audio] ⚠️ 配音落后达到 ${lagCount} 段 (当前画面 #${currentVideoIndex}, 正在朗读 #${speakingIndex})，执行刚性追帧跳跃！`
          );
          this._lastSpokenSubtitleIndex = currentVideoIndex;
          TTSManager.speakSubtitle(currentSub, true); // 强制切换至当前画面句子
          return;
        }

        // 落后在 1 段以内，排入下一句等待队列
        if (currentVideoIndex > speakingIndex) {
          TTSManager.queueSubtitle(currentSub);
        }
      }
      return;
    }

    // 3. 当前未在发声
    if (currentVideoIndex !== this._lastSpokenSubtitleIndex) {
      this._lastSpokenSubtitleIndex = currentVideoIndex;
      TTSManager.speakSubtitle(currentSub, false);
    }
  },

  /**
   * 当 TTSManager 某一句朗读自然结束后回调
   */
  onSentenceEnded(finishedIndex) {
    if (!this._enabled) return;
    const video = document.querySelector('video');
    if (video && !video.paused) {
      const currentTimeMs = video.currentTime * 1000;
      const nowIdx = this._findSubtitleIndex(currentTimeMs);
      if (nowIdx !== -1 && nowIdx !== finishedIndex) {
        const sub = this._subtitles[nowIdx];
        if (sub && sub.zhText && sub.zhText.trim()) {
          this._lastSpokenSubtitleIndex = nowIdx;
          TTSManager.speakSubtitle(sub, false);
        }
      }
    }
  },

  /**
   * 二分查找当前播放时间匹配的字幕索引
   * @param {number} timeMs 时间 (毫秒)
   * @returns {number} 字幕索引，-1 为未匹配到
   */
  _findSubtitleIndex(timeMs) {
    const subs = this._subtitles;
    if (!subs || !subs.length) return -1;

    let low = 0;
    let high = subs.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const sub = subs[mid];
      if (timeMs >= sub.startMs - 120) {
        if (timeMs <= sub.endMs + 100) {
          return mid;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return -1;
  },

  // ============= 视频事件处理 =============

  _bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    this._onPause = () => {
      if (typeof TTSManager !== 'undefined') TTSManager.stop();
      this._lastSpokenSubtitleIndex = -1;
      this._restoreVideoPlaybackRate();
    };

    this._onPlay = () => {
      if (this._enabled) {
        this._startPlaybackLoop();
        this._lastSpokenSubtitleIndex = -1;
        this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
      }
    };

    this._onSeeked = () => {
      this._lastSpokenSubtitleIndex = -1;
      this._restoreVideoPlaybackRate();
      if (this._enabled && video && !video.paused) {
        this._checkAndSpeakSubtitle(video.currentTime * 1000, true);
      }
    };

    this._onVolumeChange = () => {
      if (this._enabled && this._targetVideoVolume !== null) {
        if (Math.abs(video.volume - this._targetVideoVolume) > 0.01) {
          video.volume = this._targetVideoVolume;
        }
      }
    };

    this._onRateChange = () => {
      // 记录用户手动在播放器菜单选择的基础倍速
      if (!this._enabled) {
        this._basePlaybackRate = video.playbackRate || 1.0;
      }
    };

    video.addEventListener('pause', this._onPause);
    video.addEventListener('play', this._onPlay);
    video.addEventListener('seeked', this._onSeeked);
    video.addEventListener('volumechange', this._onVolumeChange);
    video.addEventListener('ratechange', this._onRateChange);
  },

  _unbindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;
    if (this._onPause) video.removeEventListener('pause', this._onPause);
    if (this._onPlay) video.removeEventListener('play', this._onPlay);
    if (this._onSeeked) video.removeEventListener('seeked', this._onSeeked);
    if (this._onVolumeChange) video.removeEventListener('volumechange', this._onVolumeChange);
    if (this._onRateChange) video.removeEventListener('ratechange', this._onRateChange);
  },

  updateSettings(newSettings) {
    this._settings = { ...this._settings, ...newSettings };
    if (this._enabled && newSettings.originalVolume !== undefined) {
      const video = document.querySelector('video');
      if (video) this._setVideoVolume(video, newSettings.originalVolume / 100);
    }
  },
};

if (typeof window !== 'undefined') {
  window.AudioPlayer = AudioPlayer;
}
