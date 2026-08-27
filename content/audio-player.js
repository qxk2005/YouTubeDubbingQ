/**
 * YouTubeDubbingQ - 音频播放控制模块 (v2)
 * 控制 TTS 音频播放和原视频音量
 * 
 * v2 变更: 
 * - 移除音量动画过渡和互斥锁，改为直接赋值
 * - 增加持续音量强制维持，防止 YouTube 覆盖
 */

const AudioPlayer = {
  _enabled: false,
  _subtitles: [],
  _playingSubIndex: -1,
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeEnforceInterval: null,
  _targetVideoVolume: null,   // 目标视频音量 (null = 不干预)

  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._playingSubIndex = -1;
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
      // 直接设置目标音量
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
    this._stopCurrentAudio();
    this._unbindVideoEvents();
  },

  /**
   * 直接设置视频音量 (无动画)
   */
  _setVideoVolume(video, volume) {
    if (!video) return;
    this._targetVideoVolume = Math.max(0, Math.min(1, volume));
    video.volume = this._targetVideoVolume;
  },

  /**
   * 开始音量持续强制维持 (防止 YouTube 覆盖)
   */
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
    if (video) {
      video.volume = this._originalVolume;
    }
  },

  _startPlaybackLoop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const playbackLoop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        const currentTimeMs = video.currentTime * 1000;
        this._checkAndPlay(currentTimeMs);
      }

      this._rafId = requestAnimationFrame(playbackLoop);
    };

    this._rafId = requestAnimationFrame(playbackLoop);
  },

  _stopPlaybackLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  _checkAndPlay(currentTimeMs) {
    const subIndex = this._findCurrentSubtitle(currentTimeMs);

    if (typeof TTSManager !== 'undefined') {
      TTSManager.onTimeUpdate(currentTimeMs);
    }

    if (subIndex !== this._playingSubIndex && subIndex >= 0) {
      this._playingSubIndex = subIndex;
      this._playSubtitleAudio(subIndex);
    } else if (subIndex === -1 && this._playingSubIndex !== -1) {
      this._playingSubIndex = -1;
    }

    if (typeof TTSManager !== 'undefined' && subIndex >= 0) {
      TTSManager.trimCache(subIndex);
    }
  },

  _findCurrentSubtitle(timeMs) {
    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      if (timeMs >= sub.startMs - 100 && timeMs < sub.startMs + 500) {
        return i;
      }
    }
    return -1;
  },

  async _playSubtitleAudio(index) {
    if (!this._enabled || typeof TTSManager === 'undefined') return;

    const audioData = await TTSManager.getOrWaitAudio(index);
    if (!audioData) return;

    // 原生 SpeechSynthesis 直接朗读模式，音频已在 Offscreen Document 播放
    if (audioData === '__DIRECT_PLAY__') return;

    if (this._playingSubIndex !== index) return;

    try {
      const base64 = this._arrayBufferToBase64(audioData);
      const volume = (this._settings.dubbingVolume || 100) / 100;

      chrome.runtime.sendMessage({
        type: 'YDQ_PLAY_AUDIO',
        audioBase64: base64,
        volume,
      });
    } catch (e) {
      console.error(`[YDQ] 播放音频失败 (字幕 #${index}):`, e);
    }
  },

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  },

  _stopCurrentAudio() {
    try {
      chrome.runtime.sendMessage({ type: 'YDQ_STOP_AUDIO' });
    } catch (e) {}
  },

  _bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    this._onPause = () => this._stopCurrentAudio();
    this._onPlay = () => { if (this._enabled) this._startPlaybackLoop(); };
    this._onSeeked = () => {
      this._playingSubIndex = -1;
      this._stopCurrentAudio();
      if (this._enabled && typeof TTSManager !== 'undefined') {
        TTSManager.onTimeUpdate(video.currentTime * 1000);
      }
    };
    // 监听 YouTube 音量变化并强制覆盖
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

    // 如果配音启用且原视频音量变化，立即应用
    if (this._enabled && newSettings.originalVolume !== undefined) {
      const video = document.querySelector('video');
      if (video) {
        this._setVideoVolume(video, newSettings.originalVolume / 100);
      }
    }
  },
};

if (typeof window !== 'undefined') {
  window.AudioPlayer = AudioPlayer;
}
