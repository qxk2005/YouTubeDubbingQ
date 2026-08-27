/**
 * YouTubeDubbingQ - Content Script 主入口
 * 协调所有模块的初始化和生命周期管理
 */

(function () {
  'use strict';

  // 防止重复初始化
  if (window.__YDQ_INITIALIZED__) return;
  window.__YDQ_INITIALIZED__ = true;

  console.log('[YDQ] YouTubeDubbingQ Content Script 已加载');

  // 全局状态
  const state = {
    initialized: false,
    subtitles: [],
    settings: {},
    currentVideoId: null,
  };

  /**
   * 主初始化函数
   */
  async function initialize() {
    // 检查是否在 YouTube 视频页面
    if (!isVideoPage()) {
      console.log('[YDQ] 非视频页面，跳过初始化');
      return;
    }

    const videoId = SubtitleFetcher.getVideoId();
    if (!videoId) return;

    // 如果视频 ID 没有变化，不重复初始化
    if (videoId === state.currentVideoId && state.initialized) return;

    console.log(`[YDQ] 初始化视频: ${videoId}`);

    // 清理旧状态
    cleanup();

    state.currentVideoId = videoId;

    // 加载设置
    state.settings = await YDQStorage.getAll();

    // 等待视频元素加载
    await waitForVideo();

    // 初始化字幕覆盖层
    await SubtitleOverlay.init(state.settings);

    // 初始化工具栏
    Toolbar.init(state.settings, {
      onSubtitleToggle: handleSubtitleToggle,
      onDubbingToggle: handleDubbingToggle,
      onOriginalVolumeChange: handleOriginalVolumeChange,
      onDubbingVolumeChange: handleDubbingVolumeChange,
    });

    // 初始化 TTS 管理器
    TTSManager.init(state.settings);

    // 初始化音频播放器
    AudioPlayer.init(state.settings);

    // 如果字幕已启用，自动获取和翻译字幕
    if (state.settings.subtitleEnabled) {
      await loadSubtitles();
    }

    state.initialized = true;
    console.log('[YDQ] 初始化完成');
  }

  /**
   * 加载并翻译字幕
   */
  async function loadSubtitles() {
    if (!state.settings.apiBaseUrl || !state.settings.apiKey) {
      Toolbar.showToast('请先在插件设置中配置 AI 翻译 API', 'error');
      return;
    }

    try {
      Toolbar.showToast('正在获取字幕...', 'info');

      // 获取英文字幕
      state.subtitles = await SubtitleFetcher.fetchSubtitles();

      if (!state.subtitles || state.subtitles.length === 0) {
        Toolbar.showToast('该视频没有可用的字幕', 'error');
        return;
      }

      Toolbar.showToast(`获取到 ${state.subtitles.length} 条字幕，开始翻译...`, 'info');

      // 翻译字幕
      await Translator.translateAll(
        state.subtitles,
        {
          apiBaseUrl: state.settings.apiBaseUrl,
          apiKey: state.settings.apiKey,
          apiModel: state.settings.apiModel,
        },
        (translated, total) => {
          Toolbar.showProgress(translated, total);
        }
      );

      Toolbar.showToast('字幕翻译完成！', 'success');

      // 设置字幕数据到覆盖层
      SubtitleOverlay.setSubtitles(state.subtitles);
      SubtitleOverlay.enable();

      // 设置字幕数据到 TTS 管理器
      TTSManager.setSubtitles(state.subtitles);

      // 设置字幕数据到音频播放器
      AudioPlayer.setSubtitles(state.subtitles);

      // 如果配音也启用了，启动配音
      if (state.settings.dubbingEnabled) {
        await startDubbing();
      }
    } catch (e) {
      console.error('[YDQ] 加载字幕失败:', e);
      Toolbar.showToast(`字幕加载失败: ${e.message}`, 'error');
    }
  }

  /**
   * 启动配音
   */
  async function startDubbing() {
    if (!state.subtitles || state.subtitles.length === 0) {
      Toolbar.showToast('请先启用字幕', 'error');
      return;
    }

    try {
      Toolbar.showToast('正在启动配音...', 'info');
      await TTSManager.enable();
      AudioPlayer.enable();
      Toolbar.showToast('配音已启动', 'success');
    } catch (e) {
      console.error('[YDQ] 配音启动失败:', e);
      Toolbar.showToast(`配音启动失败: ${e.message}`, 'error');
    }
  }

  /**
   * 停止配音
   */
  function stopDubbing() {
    TTSManager.disable();
    AudioPlayer.disable();
    Toolbar.showToast('配音已关闭', 'info');
  }

  // ============= 事件处理 =============

  /**
   * 字幕开关处理
   */
  async function handleSubtitleToggle(enabled) {
    state.settings.subtitleEnabled = enabled;
    await YDQStorage.set({ subtitleEnabled: enabled });

    if (enabled) {
      if (!state.subtitles || state.subtitles.length === 0) {
        await loadSubtitles();
      } else {
        SubtitleOverlay.enable();
      }
    } else {
      SubtitleOverlay.disable();
      // 如果字幕关闭，配音也关闭
      if (state.settings.dubbingEnabled) {
        state.settings.dubbingEnabled = false;
        await YDQStorage.set({ dubbingEnabled: false });
        stopDubbing();
        Toolbar.updateSettings(state.settings);
      }
    }
  }

  /**
   * 配音开关处理
   */
  async function handleDubbingToggle(enabled) {
    state.settings.dubbingEnabled = enabled;
    await YDQStorage.set({ dubbingEnabled: enabled });

    if (enabled) {
      // 如果字幕未启用，先启用字幕
      if (!state.settings.subtitleEnabled) {
        state.settings.subtitleEnabled = true;
        await YDQStorage.set({ subtitleEnabled: true });
        Toolbar.updateSettings(state.settings);
        await loadSubtitles();
      }
      await startDubbing();
    } else {
      stopDubbing();
    }
  }

  /**
   * 原视频音量变化处理
   */
  async function handleOriginalVolumeChange(value) {
    state.settings.originalVolume = value;
    await YDQStorage.set({ originalVolume: value });
    AudioPlayer.updateSettings({ originalVolume: value });
  }

  /**
   * 配音音量变化处理
   */
  async function handleDubbingVolumeChange(value) {
    state.settings.dubbingVolume = value;
    await YDQStorage.set({ dubbingVolume: value });
    AudioPlayer.updateSettings({ dubbingVolume: value });
  }

  // ============= 辅助函数 =============

  /**
   * 判断是否为视频页面
   */
  function isVideoPage() {
    return window.location.pathname === '/watch';
  }

  /**
   * 等待视频元素加载
   * @returns {Promise<HTMLVideoElement>}
   */
  function waitForVideo() {
    return new Promise((resolve) => {
      const check = () => {
        const video = document.querySelector('video');
        if (video && video.readyState >= 1) {
          resolve(video);
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  /**
   * 清理状态
   */
  function cleanup() {
    SubtitleOverlay.destroy();
    Toolbar.destroy();
    Translator.stop();
    TTSManager.disable();
    TTSManager.clearCache();
    AudioPlayer.disable();

    state.subtitles = [];
    state.initialized = false;
  }

  // ============= 监听页面导航 =============

  /**
   * YouTube SPA 导航检测
   */
  function setupNavigationListener() {
    // 方法1: yt-navigate-finish 事件
    document.addEventListener('yt-navigate-finish', () => {
      console.log('[YDQ] 检测到页面导航');
      setTimeout(initialize, 1000);
    });

    // 方法2: popstate 事件
    window.addEventListener('popstate', () => {
      setTimeout(initialize, 1000);
    });

    // 方法3: URL 变化检测
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[YDQ] 检测到 URL 变化');
        setTimeout(initialize, 1000);
      }
    });

    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 监听设置变化
   */
  function setupSettingsListener() {
    YDQStorage.onChange((changes) => {
      const newSettings = {};
      let hasSubtitleStyleChange = false;

      for (const [key, { newValue }] of Object.entries(changes)) {
        newSettings[key] = newValue;
        state.settings[key] = newValue;

        // 检查是否是字幕样式相关的变化
        if (
          [
            'zhFontFamily', 'zhFontSize', 'zhColor', 'zhFontWeight',
            'enFontFamily', 'enFontSize', 'enColor', 'enFontWeight',
            'subtitleBg', 'subtitleStroke', 'subtitlePosition', 'subtitleMode',
          ].includes(key)
        ) {
          hasSubtitleStyleChange = true;
        }
      }

      // 更新各模块设置
      if (hasSubtitleStyleChange) {
        SubtitleOverlay.updateSettings(state.settings);
      }

      TTSManager.updateSettings(state.settings);
      AudioPlayer.updateSettings(state.settings);
      Toolbar.updateSettings(state.settings);
    });
  }

  // ============= 启动 =============

  setupNavigationListener();
  setupSettingsListener();

  // 延迟初始化，等待 YouTube 页面完全加载
  if (isVideoPage()) {
    setTimeout(initialize, 2000);
  }
})();
