import json
import re

s = '{"captionTracks": [{"baseUrl": "https://example.com", "name": {"runs": [{"text": "English"}]}, "languageCode": "en"}]}'

m = re.search(r'"captionTracks":\s*(\[.*?\])', s)
if m:
    captured = m.group(1)
    print("Captured text:", captured)
    try:
        json.loads(captured)
        print("JSON parse SUCCESS!")
    except Exception as e:
        print("JSON parse FAILED:", e)
