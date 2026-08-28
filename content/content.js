/**
 * YouTubeDubbingQ - Content Script 主入口
 * 协调所有模块的初始化和生命周期管理
 * 综合支持：双语字幕、智能排程翻译、20秒语音配音、右侧原生等高逐字稿面板、常驻状态胶囊、双语 SRT 导出与快捷键
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
    timeSyncRafId: null,
    loadingSubtitles: false,
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

    // 如果视频 ID 没有变化且已初始化，不重复初始化
    if (videoId === state.currentVideoId && state.initialized) return;

    console.log(`[YDQ] 初始化视频: ${videoId}`);

    // 清理旧状态
    cleanup();

    state.currentVideoId = videoId;

    // 加载设置
    state.settings = await YDQStorage.getAll();

    // 等待视频元素加载
    const video = await waitForVideo();

    // 初始化字幕覆盖层
    await SubtitleOverlay.init(state.settings);

    // 初始化逐字稿面板 (右侧侧边栏原生吸附 & 播放器等高对齐)
    TranscriptPanel.init({
      onSeek: (timeSec) => {
        const v = document.querySelector('video');
        if (v) {
          v.currentTime = timeSec;
        }
      },
      onExportSrt: () => {
        handleExportSrt();
      },
      onClose: () => {
        Toolbar.setTranscriptActive(false);
      },
    });

    // 初始化工具栏与常驻状态胶囊
    Toolbar.init(state.settings, {
      onSubtitleToggle: handleSubtitleToggle,
      onDubbingToggle: handleDubbingToggle,
      onTranscriptToggle: handleTranscriptToggle,
      onExportSrt: handleExportSrt,
      onOriginalVolumeChange: handleOriginalVolumeChange,
      onDubbingVolumeChange: handleDubbingVolumeChange,
    });

    // 初始化 TTS 管理器
    TTSManager.init(state.settings);

    // 初始化音频播放器
    AudioPlayer.init(state.settings);

    // 绑定视频多重时间同步监听 (timeupdate + seeked + play + RAF)
    bindVideoTimeListeners(video);

    // 绑定快捷键
    setupKeyboardShortcuts();

    // 如果字幕已启用，延迟加载以等待播放器和 Main World 桥接脚本就绪
    if (state.settings.subtitleEnabled) {
      setTimeout(() => {
        loadSubtitles();
      }, 2000);
    }

    state.initialized = true;
    console.log('[YDQ] 初始化完成');
  }

  /**
   * 绑定视频多重时间同步监听 (timeupdate + seeked + play + RAF)
   */
  function bindVideoTimeListeners(video) {
    if (!video) return;

    const syncTime = () => {
      const currentTimeMs = video.currentTime * 1000;
      if (typeof TranscriptPanel !== 'undefined' && TranscriptPanel.isOpen()) {
        TranscriptPanel.onTimeUpdate(currentTimeMs);
      }
    };

    video.addEventListener('timeupdate', syncTime);
    video.addEventListener('seeked', () => {
      syncTime();
      if (typeof TranscriptPanel !== 'undefined' && TranscriptPanel.isOpen()) {
        TranscriptPanel.onTimeUpdate(video.currentTime * 1000, true);
      }
    });
    video.addEventListener('play', syncTime);

    startTimeSyncLoop();
  }

  /**
   * 启动精准时间轴同步循环 (播放时毫秒级平滑跟随)
   */
  function startTimeSyncLoop() {
    if (state.timeSyncRafId) cancelAnimationFrame(state.timeSyncRafId);

    const loop = () => {
      const video = document.querySelector('video');
      if (video && !video.paused) {
        const currentTimeMs = video.currentTime * 1000;
        if (typeof TranscriptPanel !== 'undefined' && TranscriptPanel.isOpen()) {
          TranscriptPanel.onTimeUpdate(currentTimeMs);
        }
      }
      state.timeSyncRafId = requestAnimationFrame(loop);
    };

    state.timeSyncRafId = requestAnimationFrame(loop);
  }

  /**
   * 停止时间轴同步循环
   */
  function stopTimeSyncLoop() {
    if (state.timeSyncRafId) {
      cancelAnimationFrame(state.timeSyncRafId);
      state.timeSyncRafId = null;
    }
  }

  /**
   * 加载并翻译字幕 (带常驻状态胶囊与长轮询)
   */
  async function loadSubtitles() {
    if (state.loadingSubtitles) return;

    if (!state.settings.apiBaseUrl || !state.settings.apiKey) {
      Toolbar.showToast('请先在插件设置中配置 AI 翻译 API', 'error');
      Toolbar.showStatusPill('请先配置 API Key', 'error', 4000);
      return;
    }

    state.loadingSubtitles = true;

    try {
      Toolbar.showStatusPill('正在连接字幕源 (1s)...', 'loading');

      // 获取英文字幕 (长轮询带秒数与状态回调)
      state.subtitles = await SubtitleFetcher.fetchSubtitles((statusText) => {
        Toolbar.showStatusPill(statusText, 'loading');
      });

      if (!state.subtitles || state.subtitles.length === 0) {
        Toolbar.showStatusPill('该视频未找到可用字幕', 'error', 5000);
        Toolbar.showToast('该视频未获取到可用字幕', 'error');
        state.loadingSubtitles = false;
        return;
      }

      Toolbar.showStatusPill(`已捕获 ${state.subtitles.length} 条字幕，开始翻译...`, 'loading');

      // 立即启用字幕覆盖层
      SubtitleOverlay.setSubtitles(state.subtitles);
      if (state.settings.subtitleEnabled) {
        SubtitleOverlay.enable();
      }

      // 立即渲染到逐字稿面板
      TranscriptPanel.render(state.subtitles);

      // 设置到 TTS 和音频播放器
      TTSManager.setSubtitles(state.subtitles);
      AudioPlayer.setSubtitles(state.subtitles);

      // 使用智能调度器翻译字幕
      await Translator.translateAll(
        state.subtitles,
        {
          apiBaseUrl: state.settings.apiBaseUrl,
          apiKey: state.settings.apiKey,
          apiModel: state.settings.apiModel,
        },
        (translated, total, status) => {
          Toolbar.showProgress(translated, total);
          TranscriptPanel.updateCues(state.subtitles);
          TranscriptPanel.updateStatus(status);

          const pct = status ? status.progressPct : Math.round((translated / total) * 100);
          if (pct < 100) {
            Toolbar.showStatusPill(`⚡ 智能翻译 ${pct}% (${translated}/${total})`, 'loading');
          } else {
            Toolbar.showStatusPill('✅ 双语字幕已就绪', 'success', 3500);
          }
        }
      );

      // 构建 20 秒黄金配音段落
      if (typeof SegmentManager !== 'undefined') {
        SegmentManager.segmentSubtitles(state.subtitles);
      }

      Toolbar.showStatusPill('✅ 双语字幕已就绪', 'success', 3500);

      // 如果配音也启用了，启动配音
      if (state.settings.dubbingEnabled) {
        await startDubbing();
      }
    } catch (e) {
      console.error('[YDQ] 加载字幕失败:', e);
      Toolbar.showStatusPill(`字幕获取提示: ${e.message}`, 'error', 6000);
      Toolbar.showToast(`字幕加载提示: ${e.message}`, 'error');
    } finally {
      state.loadingSubtitles = false;
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

    const hasTranslation = state.subtitles.some((s) => s.zhText && s.zhText.trim());
    if (!hasTranslation) {
      Toolbar.showToast('请等待字幕翻译完成后再开启配音', 'error');
      return;
    }

    try {
      if (typeof SegmentManager !== 'undefined') {
        SegmentManager.segmentSubtitles(state.subtitles);
      }

      await TTSManager.enable();
      AudioPlayer.enable();

      Toolbar.showToast('配音已启动！', 'success');
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
    if (typeof SegmentManager !== 'undefined') {
      SegmentManager.clear();
    }
    Toolbar.showToast('配音已关闭', 'info');
  }

  // ============= 事件与操作处理 =============

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
      Toolbar.hideStatusPill();
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
   * 逐字稿面板切换
   */
  async function handleTranscriptToggle(open) {
    if (open) {
      if (!state.subtitles || state.subtitles.length === 0) {
        if (state.settings.apiBaseUrl && state.settings.apiKey) {
          loadSubtitles();
        } else {
          Toolbar.showToast('请先在插件设置中配置 AI 翻译 API', 'error');
        }
      } else {
        TranscriptPanel.render(state.subtitles);
      }
      TranscriptPanel.show();
    } else {
      TranscriptPanel.hide();
    }
    Toolbar.setTranscriptActive(open);
  }

  /**
   * 导出双语 SRT
   */
  function handleExportSrt() {
    if (!state.subtitles || state.subtitles.length === 0) {
      Toolbar.showToast('暂无字幕数据可导出', 'error');
      return;
    }
    const status = Translator.getStatus();
    SRTExporter.exportSrt(state.subtitles, status);
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

  /**
   * 全局快捷键处理 (如 C 键切换双语字幕)
   */
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // 如果焦点在输入框、文本域或富文本编辑区，不拦截快捷键
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }

      // 按 C 键一键切换双语字幕
      if (e.key === 'c' || e.key === 'C') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          const nextState = !state.settings.subtitleEnabled;
          handleSubtitleToggle(nextState);
          Toolbar.setSubtitleActive(nextState);
          Toolbar.showToast(nextState ? '双语字幕：已开启' : '双语字幕：已关闭', 'info');
        }
      }
    });
  }

  // ============= 辅助函数 =============

  function isVideoPage() {
    return window.location.pathname === '/watch';
  }

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

  function cleanup() {
    stopTimeSyncLoop();
    SubtitleOverlay.destroy();
    TranscriptPanel.hide();
    Toolbar.destroy();
    Translator.stop();
    TTSManager.disable();
    TTSManager.clearCache();
    AudioPlayer.disable();
    if (typeof SegmentManager !== 'undefined') {
      SegmentManager.clear();
    }

    state.subtitles = [];
    state.initialized = false;
    state.loadingSubtitles = false;
  }

  // ============= 监听页面导航 =============

  function setupNavigationListener() {
    document.addEventListener('yt-navigate-finish', () => {
      console.log('[YDQ] 检测到页面导航');
      setTimeout(initialize, 1000);
    });

    window.addEventListener('popstate', () => {
      setTimeout(initialize, 1000);
    });

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

  function setupSettingsListener() {
    YDQStorage.onChange((changes) => {
      const newSettings = {};
      let hasSubtitleStyleChange = false;

      for (const [key, { newValue }] of Object.entries(changes)) {
        newSettings[key] = newValue;
        state.settings[key] = newValue;

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

      if (hasSubtitleStyleChange) {
        SubtitleOverlay.updateSettings(state.settings);
      }

      TTSManager.updateSettings(state.settings);
      AudioPlayer.updateSettings(state.settings);
      Toolbar.updateSettings(state.settings);
    });
  }

  // 启动监听
  setupNavigationListener();
  setupSettingsListener();

  if (isVideoPage()) {
    setTimeout(initialize, 1500);
  }
})();
