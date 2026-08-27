"""
测试直接通过 YouTube timedtext 公开 API 获取字幕
timedtext API 不需要认证，只需要正确的参数
"""
import json
import urllib.request
import sys

video_id = "VpMyfQRn8Go"

# YouTube 的公开 timedtext API
# 这个 API 不需要签名，只需要视频 ID 和语言代码
urls_to_test = [
    # 格式 1: 直接请求列表
    f"https://www.youtube.com/api/timedtext?v={video_id}&type=list",
    # 格式 2: 带语言的直接请求
    f"https://www.youtube.com/api/timedtext?v={video_id}&lang=en",
    f"https://www.youtube.com/api/timedtext?v={video_id}&lang=en&fmt=json3",
    f"https://www.youtube.com/api/timedtext?v={video_id}&lang=en&fmt=vtt",
    # 格式 3: 自动字幕
    f"https://www.youtube.com/api/timedtext?v={video_id}&lang=en&kind=asr",
    f"https://www.youtube.com/api/timedtext?v={video_id}&lang=en&kind=asr&fmt=json3",
]

for url in urls_to_test:
    try:
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8", errors="replace")
            status = resp.status
            short_url = url.replace(f"https://www.youtube.com/api/timedtext?v={video_id}&", "")
            content_preview = content[:150].replace('\n', ' ')
            sys.stdout.buffer.write(f"[{status}] {short_url}\n  -> length={len(content)}, preview: {content_preview}\n\n".encode('utf-8'))
    except urllib.error.HTTPError as e:
        short_url = url.replace(f"https://www.youtube.com/api/timedtext?v={video_id}&", "")
        sys.stdout.buffer.write(f"[{e.code}] {short_url}\n  -> {str(e)[:80]}\n\n".encode('utf-8'))
    except Exception as e:
        short_url = url.replace(f"https://www.youtube.com/api/timedtext?v={video_id}&", "")
        sys.stdout.buffer.write(f"[ERR] {short_url}\n  -> {str(e)[:80]}\n\n".encode('utf-8'))
