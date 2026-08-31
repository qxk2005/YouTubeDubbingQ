/**
 * YouTubeDubbingQ - Popup 设置页逻辑
 */

(function () {
  'use strict';

  // ============= Tab 切换 =============

  const tabs = document.querySelectorAll('.popup-tab');
  const panels = document.querySelectorAll('.popup-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`panel-${target}`).classList.add('active');
    });
  });

  // ============= 设置项映射 =============

  const settingsMap = {
    'api-base-url': { key: 'apiBaseUrl', type: 'text' },
    'api-key': { key: 'apiKey', type: 'text' },
    'api-model': { key: 'apiModel', type: 'text' },

    'zh-font-family': { key: 'zhFontFamily', type: 'select' },
    'zh-font-size': { key: 'zhFontSize', type: 'range', display: 'zh-font-size-val', suffix: 'px' },
    'zh-color': { key: 'zhColor', type: 'color', display: 'zh-color-val' },
    'zh-font-weight': { key: 'zhFontWeight', type: 'select' },

    'en-font-family': { key: 'enFontFamily', type: 'select' },
    'en-font-size': { key: 'enFontSize', type: 'range', display: 'en-font-size-val', suffix: 'px' },
    'en-color': { key: 'enColor', type: 'color', display: 'en-color-val' },
    'en-font-weight': { key: 'enFontWeight', type: 'select' },

    'subtitle-bg': { key: 'subtitleBg', type: 'select' },
    'subtitle-stroke': { key: 'subtitleStroke', type: 'checkbox' },
    'subtitle-position': { key: 'subtitlePosition', type: 'range', display: 'subtitle-position-val', suffix: '%' },

    'edge-voice': { key: 'edgeVoice', type: 'select' },

    'doubao-api-url': { key: 'doubaoApiUrl', type: 'text' },
    'doubao-api-key': { key: 'doubaoApiKey', type: 'text' },
    'doubao-model': { key: 'doubaoModel', type: 'text' },
    'doubao-voice': { key: 'doubaoVoice', type: 'text' },

    'original-volume': { key: 'originalVolume', type: 'range', display: 'original-volume-val', suffix: '%' },
    'dubbing-volume': { key: 'dubbingVolume', type: 'range', display: 'dubbing-volume-val', suffix: '%' },
    'auto-pace-sync': { key: 'autoPaceSync', type: 'checkbox' },
  };

  // ============= 加载设置 =============

  async function loadSettings() {
    const settings = await YDQStorage.getAll();

    // 文本/密码/URL 输入框
    for (const [elemId, config] of Object.entries(settingsMap)) {
      const elem = document.getElementById(elemId);
      if (!elem) continue;

      const value = settings[config.key];
      if (value === undefined) continue;

      switch (config.type) {
        case 'text':
          elem.value = value;
          break;
        case 'select':
          elem.value = value;
          break;
        case 'range':
          elem.value = value;
          if (config.display) {
            const displayElem = document.getElementById(config.display);
            if (displayElem) displayElem.textContent = value + (config.suffix || '');
          }
          break;
        case 'color':
          elem.value = value;
          if (config.display) {
            const displayElem = document.getElementById(config.display);
            if (displayElem) displayElem.textContent = value;
          }
          break;
        case 'checkbox':
          elem.checked = !!value;
          break;
      }
    }

    // 单选按钮组
    const subtitleMode = settings.subtitleMode || 'bilingual';
    const modeRadio = document.querySelector(`input[name="subtitle-mode"][value="${subtitleMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    const ttsEngine = settings.ttsEngine || 'edge';
    const engineRadio = document.querySelector(`input[name="tts-engine"][value="${ttsEngine}"]`);
    if (engineRadio) engineRadio.checked = true;

    // 显示/隐藏 TTS 引擎设置
    toggleTTSSettings(ttsEngine);
  }

  // ============= 保存设置 =============

  async function saveSettings() {
    const data = {};

    for (const [elemId, config] of Object.entries(settingsMap)) {
      const elem = document.getElementById(elemId);
      if (!elem) continue;

      switch (config.type) {
        case 'text':
          data[config.key] = elem.value;
          break;
        case 'select':
          data[config.key] = elem.value;
          break;
        case 'range':
          data[config.key] = parseInt(elem.value);
          break;
        case 'color':
          data[config.key] = elem.value;
          break;
        case 'checkbox':
          data[config.key] = elem.checked;
          break;
      }
    }

    // 单选按钮组
    const subtitleMode = document.querySelector('input[name="subtitle-mode"]:checked');
    if (subtitleMode) data.subtitleMode = subtitleMode.value;

    const ttsEngine = document.querySelector('input[name="tts-engine"]:checked');
    if (ttsEngine) data.ttsEngine = ttsEngine.value;

    await YDQStorage.set(data);

    // 显示保存成功提示
    showSaveSuccess();
  }

  // ============= 事件绑定 =============

  // Range 滑块实时更新显示
  for (const [elemId, config] of Object.entries(settingsMap)) {
    if (config.type === 'range' && config.display) {
      const elem = document.getElementById(elemId);
      if (elem) {
        elem.addEventListener('input', () => {
          const displayElem = document.getElementById(config.display);
          if (displayElem) displayElem.textContent = elem.value + (config.suffix || '');
        });
      }
    }
    if (config.type === 'color' && config.display) {
      const elem = document.getElementById(elemId);
      if (elem) {
        elem.addEventListener('input', () => {
          const displayElem = document.getElementById(config.display);
          if (displayElem) displayElem.textContent = elem.value;
        });
      }
    }
  }

  // TTS 引擎切换
  document.querySelectorAll('input[name="tts-engine"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      toggleTTSSettings(e.target.value);
    });
  });

  function toggleTTSSettings(engine) {
    const edgeSettings = document.getElementById('edge-settings');
    const doubaoSettings = document.getElementById('doubao-settings');

    if (engine === 'edge') {
      if (edgeSettings) edgeSettings.style.display = 'block';
      if (doubaoSettings) doubaoSettings.style.display = 'none';
    } else {
      if (edgeSettings) edgeSettings.style.display = 'none';
      if (doubaoSettings) doubaoSettings.style.display = 'block';
    }
  }

  // API Key 显示/隐藏
  const toggleApiKey = document.getElementById('toggle-api-key');
  const apiKeyInput = document.getElementById('api-key');
  if (toggleApiKey && apiKeyInput) {
    toggleApiKey.addEventListener('click', () => {
      apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
  }

  // 测试连接
  const btnTestApi = document.getElementById('btn-test-api');
  const testResult = document.getElementById('api-test-result');
  if (btnTestApi) {
    btnTestApi.addEventListener('click', async () => {
      const apiBaseUrl = document.getElementById('api-base-url').value;
      const apiKey = document.getElementById('api-key').value;
      const apiModel = document.getElementById('api-model').value;

      if (!apiBaseUrl || !apiKey) {
        showTestResult('请填写服务器地址和 API Key', 'error');
        return;
      }

      showTestResult('正在测试连接...', 'loading');

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'YDQ_TEST_API',
          config: { apiBaseUrl, apiKey, apiModel },
        });

        if (response && response.success) {
          showTestResult('✓ ' + response.message, 'success');
        } else {
          showTestResult('✗ ' + (response?.message || '连接失败'), 'error');
        }
      } catch (e) {
        showTestResult('✗ ' + e.message, 'error');
      }
    });
  }

  function showTestResult(message, type) {
    if (!testResult) return;
    testResult.textContent = message;
    testResult.className = `test-result ${type}`;
  }

  // 保存按钮
  const btnSave = document.getElementById('btn-save');
  if (btnSave) {
    btnSave.addEventListener('click', saveSettings);
  }

  // 恢复默认按钮
  const btnReset = document.getElementById('btn-reset');
  if (btnReset) {
    btnReset.addEventListener('click', async () => {
      if (confirm('确定要恢复所有设置为默认值吗？')) {
        await YDQStorage.reset();
        await loadSettings();
        showSaveSuccess('已恢复默认设置');
      }
    });
  }

  // ============= 辅助函数 =============

  function showSaveSuccess(message = '设置已保存') {
    const btnSave = document.getElementById('btn-save');
    if (!btnSave) return;

    const originalText = btnSave.textContent;
    btnSave.textContent = '✓ ' + message;
    btnSave.style.background = 'linear-gradient(135deg, #50c878, #3da55f)';

    setTimeout(() => {
      btnSave.textContent = originalText;
      btnSave.style.background = '';
    }, 2000);
  }

  // ============= 版本信息渲染 =============

  function renderVersionInfo() {
    try {
      const manifest = chrome.runtime.getManifest();
      const versionName = manifest.version_name || ('v' + manifest.version);
      
      // 头部版本简写 (如 v2026.08.27.2325)
      const headerVersionElem = document.getElementById('header-version');
      if (headerVersionElem) {
        const shortMatch = versionName.match(/(v\d{4}\.\d{2}\.\d{2}\.\d{4})/i);
        headerVersionElem.textContent = shortMatch ? shortMatch[1] : ('v' + manifest.version);
      }

      // 关于面板详细版本与构建时间
      const aboutVersionTag = document.getElementById('about-version-tag');
      const aboutBuildTime = document.getElementById('about-build-time');

      if (aboutVersionTag) {
        aboutVersionTag.textContent = versionName;
      }

      if (aboutBuildTime) {
        const timeMatch = versionName.match(/\((.*?)\)/);
        if (timeMatch) {
          aboutBuildTime.textContent = '最后代码时间: ' + timeMatch[1];
        } else {
          aboutBuildTime.textContent = 'Chrome 内部版本: ' + manifest.version;
        }
      }
    } catch (e) {
      console.warn('[YDQ Popup] 无法获取版本信息:', e);
    }
  }

  // ============= 初始化 =============

  loadSettings();
  renderVersionInfo();
})();
