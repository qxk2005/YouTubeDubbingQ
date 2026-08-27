/**
 * YouTubeDubbingQ - Chrome Storage 配置管理模块
 * 负责所有用户设置的存储和读取
 */

const YDQ_DEFAULTS = {
  // API 设置
  apiBaseUrl: '',
  apiKey: '',
  apiModel: 'gpt-4o-mini',

  // 字幕设置
  subtitleEnabled: true,
  subtitleMode: 'bilingual', // 'bilingual' | 'zh-only' | 'en-only'

  // 中文字幕样式
  zhFontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  zhFontSize: 22,
  zhColor: '#FFDD00',
  zhFontWeight: 'bold',

  // 英文字幕样式
  enFontFamily: '"Segoe UI", "Roboto", "Arial", sans-serif',
  enFontSize: 16,
  enColor: '#FFFFFF',
  enFontWeight: 'normal',

  // 通用字幕样式
  subtitleBg: 'semi-transparent', // 'transparent' | 'semi-transparent' | 'solid'
  subtitleStroke: true,
  subtitlePosition: 10, // 底部偏移百分比

  // 配音设置
  dubbingEnabled: false,
  ttsEngine: 'edge', // 'edge' | 'doubao'

  // Edge TTS 设置
  edgeVoice: 'zh-CN-XiaoxiaoNeural',

  // 豆包 TTS 设置
  doubaoApiUrl: '',
  doubaoApiKey: '',
  doubaoModel: '',
  doubaoVoice: '',

  // 音量设置
  originalVolume: 20,  // 配音时原视频音量百分比
  dubbingVolume: 100,  // 配音音量百分比
};

/**
 * 存储管理器
 */
const YDQStorage = {
  /**
   * 获取所有设置
   * @returns {Promise<Object>} 合并默认值后的设置对象
   */
  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.local.get(YDQ_DEFAULTS, (result) => {
        resolve(result);
      });
    });
  },

  /**
   * 获取单个设置项
   * @param {string} key 设置键名
   * @returns {Promise<any>} 设置值
   */
  async get(key) {
    return new Promise((resolve) => {
      const defaults = {};
      defaults[key] = YDQ_DEFAULTS[key];
      chrome.storage.local.get(defaults, (result) => {
        resolve(result[key]);
      });
    });
  },

  /**
   * 保存设置
   * @param {Object} data 要保存的设置对象
   * @returns {Promise<void>}
   */
  async set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  },

  /**
   * 重置所有设置为默认值
   * @returns {Promise<void>}
   */
  async reset() {
    return new Promise((resolve) => {
      chrome.storage.local.set(YDQ_DEFAULTS, resolve);
    });
  },

  /**
   * 监听设置变化
   * @param {Function} callback 回调函数 (changes, areaName) => void
   */
  onChange(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        callback(changes);
      }
    });
  }
};

// 导出给其他模块使用（Content Script 环境中共享全局变量）
if (typeof window !== 'undefined') {
  window.YDQ_DEFAULTS = YDQ_DEFAULTS;
  window.YDQStorage = YDQStorage;
}
