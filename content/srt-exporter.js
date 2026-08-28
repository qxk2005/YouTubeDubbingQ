/**
 * YouTubeDubbingQ - 双语 SRT 字幕导出模块
 * 将中英双语字幕格式化为标准 .srt 文件并触发浏览器下载
 */

const SRTExporter = {
  /**
   * 将秒数转换为 SRT 时间码格式 "HH:MM:SS,mmm"
   * @param {number} sec 秒数
   * @returns {string} SRT 时间码
   */
  formatSrtTime(sec) {
    const s = Math.max(0, sec || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    const wholeS = Math.floor(rest);
    const ms = Math.floor((rest - wholeS) * 1000);

    const pad2 = (v) => String(v).padStart(2, '0');
    const pad3 = (v) => String(v).padStart(3, '0');

    return `${pad2(h)}:${pad2(m)}:${pad2(wholeS)},${pad3(ms)}`;
  },

  /**
   * 构建中英对齐的双语 SRT 字符串
   * 中文在上、英文在下
   * @param {Array} subtitles 字幕数组
   * @returns {string} SRT 文本
   */
  buildBilingualSrt(subtitles) {
    if (!subtitles || !subtitles.length) return '';

    const blocks = [];
    let srtIndex = 1;

    for (const sub of subtitles) {
      const start = (sub.startMs || 0) / 1000;
      const end = (sub.endMs || sub.startMs + 1000) / 1000;
      const startCode = this.formatSrtTime(start);
      const endCode = this.formatSrtTime(end);

      const enText = (sub.text || '').trim();
      const zhText = (sub.zhText || '').trim();

      const lines = [srtIndex.toString(), `${startCode} --> ${endCode}`];

      if (zhText && enText) {
        lines.push(zhText);
        lines.push(enText);
      } else if (zhText) {
        lines.push(zhText);
      } else if (enText) {
        lines.push(enText);
      } else {
        lines.push('');
      }

      blocks.push(lines.join('\n'));
      srtIndex++;
    }

    return blocks.join('\n\n') + '\n';
  },

  /**
   * 获取当前视频标题并清理非法文件名字符
   * @returns {string} 清理后的标题
   */
  getVideoTitle() {
    let title = '';
    const titleEl =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
      document.querySelector('h1.ytd-watch-metadata') ||
      document.querySelector('h1.title yt-formatted-string') ||
      document.querySelector('.ytp-title-link');

    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim();
    }

    if (!title) {
      title = (document.title || '').replace(/- YouTube$/i, '').trim();
    }

    if (!title) {
      const videoId = typeof SubtitleFetcher !== 'undefined' ? SubtitleFetcher.getVideoId() : '';
      title = videoId ? `youtube_${videoId}` : 'youtube_subtitles';
    }

    // 移除文件名中的非法字符
    return title.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim();
  },

  /**
   * 执行导出下载
   * @param {Array} subtitles 字幕数组
   * @param {Object} [translatorStatus] 当前翻译状态
   * @returns {boolean} 是否成功触发下载
   */
  exportSrt(subtitles, translatorStatus) {
    if (!subtitles || subtitles.length === 0) {
      alert('未找到可用字幕数据，无法导出！');
      return false;
    }

    // 严格检查翻译完成度
    const total = subtitles.length;
    const doneCount = subtitles.filter((s) => !!s.zhText).length;
    const isComplete = translatorStatus ? translatorStatus.allDone : doneCount === total;
    const progressPct = translatorStatus ? translatorStatus.progressPct : Math.round((doneCount / total) * 100);

    if (!isComplete && progressPct < 100) {
      const confirmed = window.confirm(
        `【YouTubeDubbingQ 导出提示】\n\n当前 AI 翻译进度为 ${progressPct}%（已翻译 ${doneCount}/${total} 句）。\n尚未翻译完成的句子将保留英文原文。\n\n是否确认现在导出已完成的双语 SRT 字幕？`
      );
      if (!confirmed) {
        return false;
      }
    }

    const srtContent = this.buildBilingualSrt(subtitles);
    if (!srtContent) {
      alert('字幕内容生成失败！');
      return false;
    }

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const title = this.getVideoTitle();
    const fileName = `${title}.zh-en.srt`;

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);

    console.log(`[YDQ] ✓ 双语 SRT 导出成功: ${fileName}`);
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.SRTExporter = SRTExporter;
}
