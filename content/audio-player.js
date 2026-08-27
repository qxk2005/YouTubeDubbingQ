/**
 * YouTubeDubbingQ - 音频播放控制模块 (v4 - 直接朗读)
 * 
 * v4 变更：
 * - 移除 Offscreen Document 播放链路
 * - 直接调用 TTSManager.speakSegment() 按段落朗读
 * - 音量控制直接赋值 + 持续维持
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,
  _playingSegmentIndex: -1,

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._playingSegmentIndex = -1;
    this._targetVideoVolume = null;
  },

  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  enable() {
    this._enabled = true;
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
    this._playingSegmentIndex = -1;
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
        this._checkAndPlaySegment(video.currentTime * 1000);
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

  _checkAndPlaySegment(currentTimeMs) {
    if (typeof SegmentManager === 'undefined' || typeof TTSManager === 'undefined') return;

    const segment = SegmentManager.findSegmentAtTime(currentTimeMs);
    if (!segment) return;

    // 已在播放此段落，不重复触发
    if (this._playingSegmentIndex === segment.startIndex) return;

    // 进入新段落 → 朗读
    this._playingSegmentIndex = segment.startIndex;
    TTSManager.speakSegment(segment);
  },

  // ============= 视频事件 =============

  _bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    this._onPause = () => {
      if (typeof TTSManager !== 'undefined') TTSManager.stop();
    };
    this._onPlay = () => {
      if (this._enabled) this._startPlaybackLoop();
    };
    this._onSeeked = () => {
      this._playingSegmentIndex = -1;
      if (typeof TTSManager !== 'undefined') TTSManager.stop();
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
