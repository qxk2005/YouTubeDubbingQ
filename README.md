# YouTubeDubbingQ

YouTube 视频 AI 双语字幕翻译 + 实时中文配音 Chrome 扩展插件。

## 功能特点

- 🔤 **双语字幕**：自动获取 YouTube 视频英文字幕，通过 AI 翻译为中文，以 Netflix 风格显示双语字幕
- 🎙️ **实时配音**：支持 Edge TTS 和豆包 TTS 两种配音引擎，实时中文配音
- 🎨 **字幕样式自定义**：中英文字体、字号、颜色、背景、粗细、描边等全面可定制
- 🔊 **智能音量控制**：配音时自动降低原视频音量，保留背景音乐
- ⚡ **音画同步**：AI 翻译长度约束 + TTS 动态调速，确保配音与画面精确对齐
- 🤖 **OpenAI 兼容**：支持任何 OpenAI 兼容的 AI 服务（本地 LLM、豆包、深度求索等）

## 安装方法

1. 克隆或下载此仓库：
   ```bash
   git clone https://github.com/qxk2005/YouTubeDubbingQ.git
   ```

2. 打开 Chrome 浏览器，进入 `chrome://extensions/`

3. 开启右上角的 **开发者模式**

4. 点击 **加载已解压的扩展程序**

5. 选择 `YouTubeDubbingQ` 文件夹

6. 扩展图标出现在浏览器工具栏中 ✅

## 使用方法

### 1. 配置 AI 翻译服务
- 点击扩展图标，在 **API 设置** 标签中：
  - 输入 OpenAI 兼容服务器地址（如 `https://api.openai.com`）
  - 输入 API Key
  - 输入模型名称（如 `gpt-4o-mini`）
  - 点击「测试连接」确认配置正确

### 2. 启用双语字幕
- 打开任意 YouTube 视频
- 视频播放器右下角会出现 YouTubeDubbingQ 工具栏
- 点击 🔤 字幕按钮启用双语字幕

### 3. 启用中文配音
- 在工具栏中点击 🔊 配音按钮
- 首次使用需等待几秒钟加载
- 配音会自动跟随视频进度播放

### 4. 自定义设置
- 点击扩展图标打开设置页面
- 在 **字幕设置** 中自定义字幕样式
- 在 **配音设置** 中选择 TTS 引擎和语音

## 配音引擎

### Edge TTS（免费）
- 无需 API Key，直接使用微软 Edge 语音服务
- 支持多种中文语音（男声/女声）
- 适合日常使用

### 豆包 TTS
- 需要配置豆包 API Key
- 通过 OpenAI 兼容接口调用
- 音质更好，语音更自然

## 技术栈

- Chrome Extension Manifest V3
- 纯 HTML/CSS/JavaScript（无需构建工具）
- YouTube timedtext API
- OpenAI 兼容 Chat API
- Edge TTS WebSocket
- Web Audio API

## 许可证

MIT License

## 反馈

如有问题或建议，请在 [GitHub Issues](https://github.com/qxk2005/YouTubeDubbingQ/issues) 中提交。
