/**
 * YouTubeDubbingQ - 音频播放控制模块 (v3 - 段落式播放)
 * 
 * 核心变更：从逐句播放改为段落式播放
 * - 段落音频在首句 startMs 时开始播放
 * - 段落播放期间不重复触发
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
  _playingSegmentIndex: -1,   // 当前正在播放的段落 startIndex
  _lastCheckTimeMs: -1,

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
    this._stopCurrentAudio();
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

    const playbackLoop = () => {
      if (!this._enabled) return;

      const video = document.querySelector('video');
      if (video && !video.paused) {
        const currentTimeMs = video.currentTime * 1000;
        this._checkAndPlaySegment(currentTimeMs);
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

  /**
   * 检查是否需要播放段落音频
   */
  _checkAndPlaySegment(currentTimeMs) {
    if (typeof SegmentManager === 'undefined') return;

    // 通知 TTS 预加载
    if (typeof TTSManager !== 'undefined') {
      TTSManager.onTimeUpdate(currentTimeMs);
    }

    // 查找当前时间所在的段落
    const segment = SegmentManager.findSegmentAtTime(currentTimeMs);
    if (!segment) {
      // 不在任何段落中，不做任何操作
      return;
    }

    // 如果已在播放这个段落，不重复触发
    if (this._playingSegmentIndex === segment.startIndex) return;

    // 检查是否在段落开始的触发窗口内 (startMs ± 300ms)
    if (currentTimeMs >= segment.startMs - 300 && currentTimeMs < segment.startMs + 800) {
      this._playingSegmentIndex = segment.startIndex;
      this._playSegmentAudio(segment);
    }
  },

  /**
   * 播放段落音频
   */
  async _playSegmentAudio(segment) {
    if (!this._enabled || typeof TTSManager === 'undefined') return;

    console.log(`[YDQ Audio] 播放段落: idx=${segment.startIndex}-${segment.endIndex}`);

    const audioData = await TTSManager.getSegmentAudio(segment);
    if (!audioData) {
      console.warn('[YDQ Audio] 段落无音频数据');
      return;
    }

    // 直接朗读模式（SpeechSynthesis 已播放）
    if (audioData === '__DIRECT_PLAY__') return;

    // 检查在等待期间段落是否已变化
    if (this._playingSegmentIndex !== segment.startIndex) return;

    try {
      const base64 = this._arrayBufferToBase64(audioData);
      const volume = (this._settings.dubbingVolume || 100) / 100;

      chrome.runtime.sendMessage({
        type: 'YDQ_PLAY_AUDIO',
        audioBase64: base64,
        volume,
      });
    } catch (e) {
      console.error('[YDQ Audio] 播放失败:', e);
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
      this._playingSegmentIndex = -1;
      this._stopCurrentAudio();
      if (this._enabled && typeof TTSManager !== 'undefined') {
        TTSManager.onTimeUpdate(video.currentTime * 1000);
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
