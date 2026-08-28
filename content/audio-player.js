/**
 * YouTubeDubbingQ - 音频播放控制模块 (非破坏性顺序调度与音画毫秒级对齐)
 * 
 * 核心设计：
 * 1. 连续播放时非破坏性流转：保证每一句完整读完，平滑衔接下一句，杜绝掐断与丢音
 * 2. Seek 瞬时响应：用户点击逐字稿单句或拖拽进度条时，瞬时切断旧音并精准播放所选句子
 * 3. 二分查找精准定位：毫秒级匹配视频播放时间点与对应字幕
 * 4. 暂停/恢复/音量控制与 YouTube 原生播放器无缝协同
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,
  _lastSpokenSubtitleIndex: -1, // 上一次触发朗读的字幕索引

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._lastSpokenSubtitleIndex = -1;
    this._targetVideoVolume = null;
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
    // 若当前正在播放的字幕已被翻译，且此前未发声，允许即时触发
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

  // ============= 逐句精准播放循环 =============

  _startPlaybackLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const loop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
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
   * 检查并触发当前字幕句子的配音 (逐句精准音画对齐)
   * @param {number} currentTimeMs 当前视频播放毫秒数
   * @param {boolean} [isSeek=false] 是否为用户主动跳转/点击
   */
  _checkAndSpeakSubtitle(currentTimeMs, isSeek = false) {
    if (typeof TTSManager === 'undefined' || !this._subtitles.length) return;

    // 二分查找当前播放时间所在的单条字幕
    const index = this._findSubtitleIndex(currentTimeMs);
    if (index === -1) {
      return;
    }

    // 连续播放且已经触发过该句时，无需重复触发
    if (!isSeek && index === this._lastSpokenSubtitleIndex) {
      return;
    }

    const sub = this._subtitles[index];
    if (!sub || !sub.zhText || !sub.zhText.trim()) {
      return;
    }

    // 记录并触发单句朗读
    this._lastSpokenSubtitleIndex = index;
    TTSManager.speakSubtitle(sub, isSeek);
  },

  /**
   * 当 TTSManager 某一句朗读自然结束后回调
   */
  onSentenceEnded(finishedIndex) {
    if (!this._enabled) return;
    const video = document.querySelector('video');
    if (video && !video.paused) {
      this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
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
      // 容许提前 120ms 预触发，确保开口音画即刻同步
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
    };

    this._onPlay = () => {
      if (this._enabled) {
        this._startPlaybackLoop();
        this._lastSpokenSubtitleIndex = -1;
        this._checkAndSpeakSubtitle(video.currentTime * 1000, false);
      }
    };

    this._onSeeked = () => {
      // 用户跳转进度或点击逐字稿单句，立即切断旧音频并瞬时朗读目标句
      this._lastSpokenSubtitleIndex = -1;
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

    video.addEventListener('pause', this._onPause);
    video.addEventListener('play', this._onPlay);
    video.addEventListener('seeked', this._onSeeked);
    video.addEventListener('volumechange', this._onVolumeChange);
  },

  _unbindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;
    if (this._onPause) video.removeEventListener('pause', this._onPause);
    if (this._onPlay) video.removeEventListener('play', this._onPlay);
    if (this._onSeeked) video.removeEventListener('seeked', this._onSeeked);
    if (this._onVolumeChange) video.removeEventListener('volumechange', this._onVolumeChange);
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
