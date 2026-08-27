"""
测试多种 Innertube 客户端配置来获取 captionTracks
YouTube 可能限制了某些客户端类型
"""
import json
import urllib.request
import sys

video_id = "VpMyfQRn8Go"
api_key = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"

# 尝试不同的客户端配置
client_configs = [
    {"name": "WEB", "version": "2.20260826.01.00"},
    {"name": "ANDROID", "version": "19.09.37"},
    {"name": "IOS", "version": "19.09.3"},
    {"name": "TVHTML5_SIMPLY_EMBEDDED_PLAYER", "version": "2.0"},
    {"name": "MWEB", "version": "2.20240101.00.00"},
]

for cfg in client_configs:
    url = f"https://www.youtube.com/youtubei/v1/player?key={api_key}&prettyPrint=false"
    
    payload = json.dumps({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": cfg["name"],
                "clientVersion": cfg["version"],
                "hl": "en",
                "gl": "US"
            }
        }
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "https://www.youtube.com")
    req.add_header("Referer", "https://www.youtube.com/")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            status = data.get("playabilityStatus", {}).get("status", "UNKNOWN")
            reason = data.get("playabilityStatus", {}).get("reason", "")
            
            tracks = []
            captions = data.get("captions", {})
            renderer = captions.get("playerCaptionsTracklistRenderer", {})
            tracks = renderer.get("captionTracks", [])
            
            track_info = f"{len(tracks)} tracks" if tracks else "NO tracks"
            sys.stdout.buffer.write(f"[{cfg['name']}] status={status}, {track_info}, reason={reason[:50]}\n".encode('utf-8'))
            
            if tracks:
                for t in tracks:
                    lang = t.get("languageCode", "?")
                    kind = t.get("kind", "")
                    sys.stdout.buffer.write(f"  -> lang={lang}, kind={kind}, url_length={len(t.get('baseUrl',''))}\n".encode('utf-8'))
                    
    except Exception as e:
        sys.stdout.buffer.write(f"[{cfg['name']}] ERROR: {str(e)[:80]}\n".encode('utf-8'))
    
    sys.stdout.flush()
