#!/usr/bin/env python3
"""
YouTubeDubbingQ - 自动化版本号与构建时间注入脚本
根据当前时间自动更新 manifest.json 中的 version 与 version_name
"""

import json
import os
import sys
from datetime import datetime

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_PATH = os.path.join(ROOT_DIR, 'manifest.json')

def update_version():
    now = datetime.now()
    
    # Chrome 要求 version 必须是由 1-4 个整数组成 (<= 65535)
    # 例如: 2026.8.27.2325
    chrome_version = f"{now.year}.{now.month}.{now.day}.{now.hour * 100 + now.minute}"
    
    # version_name 可以是任意易读字符串
    # 例如: v2026.08.27.2325 (Build 2026-08-27 23:25:00)
    display_version = now.strftime("v%Y.%m.%d.%H%M")
    build_time = now.strftime("%Y-%m-%d %H:%M:%S")

    if not os.path.exists(MANIFEST_PATH):
        print(f"[Error] {MANIFEST_PATH} not found!")
        return False

    with open(MANIFEST_PATH, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    manifest['version'] = chrome_version
    manifest['version_name'] = f"{display_version} ({build_time})"

    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f"[OK] Updated version to: {display_version}")
    print(f"[OK] Chrome Manifest version: {chrome_version}")
    print(f"[OK] Build time: {build_time}")
    return True

if __name__ == '__main__':
    update_version()
