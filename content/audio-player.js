/**
 * YouTubeDubbingQ - 音频播放控制模块 (v6 - 20秒黄金段落平稳调度)
 * 
 * 核心设计：
 * - 监控视频播放进度，按 20 秒段落触发连贯中文配音
 * - 拖拽进度条 (seek) 立即重新定位段落并平滑恢复朗读
 * - 暂停/恢复/音量控制与 YouTube 原生播放器无缝协同
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,
  _lastSpokenSegmentId: -1, // 上一次触发朗读的段落 ID

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._lastSpokenSegmentId = -1;
    this._targetVideoVolume = null;
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  enable() {
    this._enabled = true;
    this._lastSpokenSegmentId = -1;
    const video = document.querySelector('video');
    if (video) {
      this._originalVolume = video.volume;
      const target = (this._settings.originalVolume ?? 20) / 100;
      this._setVideoVolume(video, target);
    }
    this._startPlaybackLoop();
    this._startVolumeEnforcement();
    this._bindVideoEvents();
  },

  disable() {
    this._enabled = false;
    this._stopPlaybackLoop();
    this._stopVolumeEnforcement();
    this._restoreVideoVolume();
    if (typeof TTSManager !== 'undefined') TTSManager.stop();
    this._unbindVideoEvents();
    this._lastSpokenSegmentId = -1;
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

  // ============= 段落式播放循环 =============

  _startPlaybackLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const loop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        this._checkAndSpeakSegment(video.currentTime * 1000);
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
   * 检查并触发当前段落的配音
   */
  _checkAndSpeakSegment(currentTimeMs) {
    if (typeof SegmentManager === 'undefined' || typeof TTSManager === 'undefined') return;

    // 查找当前播放时间所在的 20 秒段落
    const segment = SegmentManager.findSegmentAtTime(currentTimeMs);
    if (!segment) return;

    // 如果当前段落已经在播放或已播放过，无需重复触发
    if (segment.id === this._lastSpokenSegmentId) {
      return;
    }

    // 触发新段落的朗读
    this._lastSpokenSegmentId = segment.id;
    TTSManager.speakSegment(segment);
  },

  // ============= 视频事件处理 =============

  _bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    this._onPause = () => {
      if (typeof TTSManager !== 'undefined') TTSManager.stop();
    };

    this._onPlay = () => {
      if (this._enabled) {
        // 恢复播放时重置当前段落以便重新就绪
        this._lastSpokenSegmentId = -1;
        this._startPlaybackLoop();
      }
    };

    this._onSeeked = () => {
      // 用户跳转进度，立即切断当前朗读并重置段落触发标记
      this._lastSpokenSegmentId = -1;
      if (typeof TTSManager !== 'undefined') TTSManager.stop();
      if (this._enabled && video && !video.paused) {
        this._checkAndSpeakSegment(video.currentTime * 1000);
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
