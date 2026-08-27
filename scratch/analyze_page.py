import json
import re

with open(r'C:\Users\qiuya\.gemini\antigravity-ide\brain\51d188c1-de49-463d-b4c9-ca153dd03478\.system_generated\steps\283\content.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Check LOGIN_REQUIRED
if 'LOGIN_REQUIRED' in content:
    print('*** CRITICAL: playabilityStatus is LOGIN_REQUIRED ***')
    idx = content.index('LOGIN_REQUIRED')
    print(content[max(0,idx-100):idx+300])
    print()

# Find ytInitialPlayerResponse and check for captions
idx = content.index('ytInitialPlayerResponse')
region = content[idx:idx+50000]

if '"captions"' in region:
    caps_idx = region.index('"captions"')
    print(f'captions key found at offset {caps_idx}')
    print('Context:', region[caps_idx:caps_idx+500])
else:
    print('NO "captions" key found in ytInitialPlayerResponse')
    # Show the playabilityStatus
    if '"status"' in region:
        status_idx = region.index('"status"')
        print('Status:', region[status_idx:status_idx+200])
