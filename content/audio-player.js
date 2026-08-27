/**
 * YouTubeDubbingQ - 音频播放控制模块
 * 控制 TTS 音频播放和原视频音量
 */

const AudioPlayer = {
  // 状态
  _enabled: false,
  _subtitles: [],
  _currentSubIndex: -1,
  _playingSubIndex: -1,
  _settings: null,
  _originalVolume: 1.0,
  _rafId: null,
  _volumeTransitioning: false,

  /**
   * 初始化音频播放器
   * @param {Object} settings 设置
   */
  init(settings) {
    this._settings = settings || {};
    this._originalVolume = 1.0;
    this._currentSubIndex = -1;
    this._playingSubIndex = -1;
  },

  /**
   * 设置字幕数据
   * @param {Array} subtitles 字幕数组
   */
  setSubtitles(subtitles) {
    this._subtitles = subtitles || [];
  },

  /**
   * 启用配音播放
   */
  enable() {
    this._enabled = true;
    const video = document.querySelector('video');
    if (video) {
      this._originalVolume = video.volume;
      this._lowerVideoVolume(video);
    }
    this._startPlaybackLoop();
    this._bindVideoEvents();
  },

  /**
   * 禁用配音播放
   */
  disable() {
    this._enabled = false;
    this._stopPlaybackLoop();
    this._restoreVideoVolume();
    this._stopCurrentAudio();
    this._unbindVideoEvents();
  },

  /**
   * 降低原视频音量
   * @param {HTMLVideoElement} video
   */
  _lowerVideoVolume(video) {
    if (!video) return;

    const targetVolume = (this._settings.originalVolume || 20) / 100;
    this._animateVolume(video, video.volume, targetVolume, 500);
  },

  /**
   * 恢复原视频音量
   */
  _restoreVideoVolume() {
    const video = document.querySelector('video');
    if (!video) return;

    this._animateVolume(video, video.volume, this._originalVolume, 500);
  },

  /**
   * 音量渐变动画
   * @param {HTMLVideoElement} video
   * @param {number} from 起始音量
   * @param {number} to 目标音量
   * @param {number} durationMs 过渡时间
   */
  _animateVolume(video, from, to, durationMs) {
    if (this._volumeTransitioning) return;
    this._volumeTransitioning = true;

    const startTime = performance.now();
    const diff = to - from;

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      // 使用 easeInOutQuad 缓动函数
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      video.volume = Math.max(0, Math.min(1, from + diff * eased));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this._volumeTransitioning = false;
      }
    };

    requestAnimationFrame(animate);
  },

  /**
   * 开始播放循环
   */
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

  /**
   * 停止播放循环
   */
  _stopPlaybackLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  },

  /**
   * 检查是否需要播放新的 TTS 音频
   * @param {number} currentTimeMs 当前播放时间
   */
  _checkAndPlay(currentTimeMs) {
    // 找到当前应播放的字幕
    const subIndex = this._findCurrentSubtitle(currentTimeMs);

    // 通知 TTSManager 更新预加载
    if (typeof TTSManager !== 'undefined') {
      TTSManager.onTimeUpdate(currentTimeMs);
    }

    // 如果字幕索引变化，播放新的音频
    if (subIndex !== this._playingSubIndex && subIndex >= 0) {
      this._playingSubIndex = subIndex;
      this._playSubtitleAudio(subIndex);
    } else if (subIndex === -1 && this._playingSubIndex !== -1) {
      this._playingSubIndex = -1;
      // 当前没有字幕，但不停止已在播放的音频（让它自然结束）
    }

    // 清理缓存
    if (typeof TTSManager !== 'undefined' && subIndex >= 0) {
      TTSManager.trimCache(subIndex);
    }
  },

  /**
   * 查找当前时间对应的字幕索引
   * @param {number} timeMs
   * @returns {number}
   */
  _findCurrentSubtitle(timeMs) {
    for (let i = 0; i < this._subtitles.length; i++) {
      const sub = this._subtitles[i];
      // 在字幕开始时间附近触发（允许100ms的提前量）
      if (timeMs >= sub.startMs - 100 && timeMs < sub.startMs + 500) {
        return i;
      }
    }
    return -1;
  },

  /**
   * 播放指定字幕的 TTS 音频
   * @param {number} index 字幕索引
   */
  async _playSubtitleAudio(index) {
    if (!this._enabled || typeof TTSManager === 'undefined') return;

    const audioData = await TTSManager.getOrWaitAudio(index);
    if (!audioData) return;

    // 检查在等待期间索引是否已经变化
    if (this._playingSubIndex !== index) return;

    // 通过 Service Worker 发送到 Offscreen Document 播放
    try {
      // 将 ArrayBuffer 转为 base64
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

  /**
   * ArrayBuffer 转 base64
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
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

  /**
   * 停止当前音频
   */
  _stopCurrentAudio() {
    try {
      chrome.runtime.sendMessage({ type: 'YDQ_STOP_AUDIO' });
    } catch (e) {
      // 忽略
    }
  },

  /**
   * 绑定视频事件
   */
  _bindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    this._onPause = () => {
      this._stopCurrentAudio();
    };

    this._onPlay = () => {
      if (this._enabled) {
        this._startPlaybackLoop();
      }
    };

    this._onSeeked = () => {
      this._playingSubIndex = -1;
      this._stopCurrentAudio();
      // 重新触发预加载
      if (this._enabled && typeof TTSManager !== 'undefined') {
        const currentTimeMs = video.currentTime * 1000;
        TTSManager.onTimeUpdate(currentTimeMs);
      }
    };

    video.addEventListener('pause', this._onPause);
    video.addEventListener('play', this._onPlay);
    video.addEventListener('seeked', this._onSeeked);
  },

  /**
   * 解绑视频事件
   */
  _unbindVideoEvents() {
    const video = document.querySelector('video');
    if (!video) return;

    if (this._onPause) video.removeEventListener('pause', this._onPause);
    if (this._onPlay) video.removeEventListener('play', this._onPlay);
    if (this._onSeeked) video.removeEventListener('seeked', this._onSeeked);
  },

  /**
   * 更新设置
   * @param {Object} newSettings
   */
  updateSettings(newSettings) {
    const oldOriginalVolume = this._settings?.originalVolume;
    this._settings = { ...this._settings, ...newSettings };

    // 如果原视频音量设置变化且当前正在配音
    if (this._enabled && newSettings.originalVolume !== undefined && newSettings.originalVolume !== oldOriginalVolume) {
      const video = document.querySelector('video');
      if (video) {
        const targetVolume = newSettings.originalVolume / 100;
        this._animateVolume(video, video.volume, targetVolume, 300);
      }
    }
  },
};

if (typeof window !== 'undefined') {
  window.AudioPlayer = AudioPlayer;
}
