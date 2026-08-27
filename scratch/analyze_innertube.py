import re
import json

with open(r'C:\Users\qiuya\.gemini\antigravity-ide\brain\51d188c1-de49-463d-b4c9-ca153dd03478\.system_generated\steps\283\content.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Search for INNERTUBE_API_KEY
matches = re.findall(r'"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"', content)
if matches:
    print(f"INNERTUBE_API_KEY found: {matches[0]}")
else:
    print("INNERTUBE_API_KEY NOT found via key pattern")
    # Try the ytcfg.set pattern
    matches2 = re.findall(r'INNERTUBE_API_KEY.*?"([A-Za-z0-9_-]+)"', content)
    if matches2:
        print(f"INNERTUBE_API_KEY (alt): {matches2[0]}")

# Search for INNERTUBE_CONTEXT or client info
client_matches = re.findall(r'"clientVersion"\s*:\s*"([^"]+)"', content)
if client_matches:
    print(f"clientVersion found: {client_matches[0]}")

client_name = re.findall(r'"clientName"\s*:\s*"([^"]+)"', content)
if client_name:
    print(f"clientName found: {client_name[0]}")

# Check if ytcfg.set is in the page  
ytcfg_count = content.count('ytcfg.set')
print(f"\nytcfg.set occurrences: {ytcfg_count}")

# Find any ytcfg.set block with INNERTUBE
for m in re.finditer(r'ytcfg\.set\((\{[^}]{1,500}\})\)', content):
    block = m.group(1)
    if 'INNERTUBE' in block:
        print(f"\nytcfg block with INNERTUBE:")
        print(block[:300])
        break
