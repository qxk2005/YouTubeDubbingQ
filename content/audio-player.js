/**
 * YouTubeDubbingQ - 音频播放控制模块 (v5 - 逐句精确对齐)
 * 
 * 核心设计：
 * - 逐句触发 TTS（每条字幕到达时朗读对应中文）
 * - 精确时间同步：视频到达字幕 startMs 时触发朗读
 * - 防重复：每句只触发一次
 * - 音量直接赋值 + 持续维持
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,
  _lastSpokenIndex: -1, // 上一次触发朗读的字幕索引

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._lastSpokenIndex = -1;
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
    this._lastSpokenIndex = -1;
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

  // ============= 逐句播放循环 =============

  _startPlaybackLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const loop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        this._checkAndSpeak(video.currentTime * 1000);
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
   * 检查是否需要朗读当前字幕
   */
  _checkAndSpeak(currentTimeMs) {
    if (typeof TTSManager === 'undefined') return;

    // 查找当前时间对应的字幕
    const subIndex = this._findSubtitleAtTime(currentTimeMs);

    if (subIndex === -1) return; // 当前时间没有字幕

    // 已经朗读过这句了
    if (subIndex === this._lastSpokenIndex) return;

    // 如果 TTS 正在朗读上一句且还没说完，不打断
    // （让上一句自然说完，下一句在其 startMs 时触发）
    if (TTSManager.isSpeaking() && TTSManager.getSpeakingIndex() >= 0) {
      // 如果当前正在说的是上一句且距当前字幕开始不超过 500ms，等一等
      const speakingIdx = TTSManager.getSpeakingIndex();
      if (speakingIdx === subIndex - 1 && currentTimeMs - this._subtitles[subIndex].startMs < 500) {
        return;
      }
    }

    // 触发朗读
    this._lastSpokenIndex = subIndex;
    TTSManager.speakSubtitle(subIndex);
  },

  /**
   * 查找当前时间对应的字幕索引
   * 返回 startMs 在当前时间之前且 endMs 在当前时间之后的字幕
   */
  _findSubtitleAtTime(timeMs) {
    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      // 在字幕开始后的 300ms 内触发（给一点容差）
      if (timeMs >= sub.startMs && timeMs < sub.startMs + 300) {
        return i;
      }
    }
    return -1;
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
      this._lastSpokenIndex = -1;
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
