# -*- coding: utf-8 -*-
"""
每日备份线上 PMO 项目数据。

从 GitHub 拉取 data/projects.json，存到 备份/ 目录，保留最近 30 份。
如果条目数比上一份少，会明确告警（说明线上发生了回退）。
"""
import json
import os
import sys
import urllib.request
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

URL = 'https://raw.githubusercontent.com/jc000ex/PMO/main/data/projects.json'
BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, '备份')
KEEP = 30


def count_updates(data):
    return sum(len(p.get('updates') or []) for p in data)


def latest_backup():
    if not os.path.isdir(OUT_DIR):
        return None
    files = sorted(f for f in os.listdir(OUT_DIR) if f.startswith('projects_') and f.endswith('.json'))
    if not files:
        return None
    with open(os.path.join(OUT_DIR, files[-1]), encoding='utf-8') as f:
        return files[-1], json.load(f)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    req = urllib.request.Request(URL, headers={'User-Agent': 'PMO-Backup/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode('utf-8')
    data = json.loads(raw)

    total = count_updates(data)
    stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
    path = os.path.join(OUT_DIR, f'projects_{stamp}.json')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(raw)

    print(f'已备份: {path}')
    print(f'项目 {len(data)} 个，周报记录 {total} 条')

    prev = latest_backup()
    if prev and prev[0] != os.path.basename(path):
        prev_name, prev_data = prev
        prev_total = count_updates(prev_data)
        if total < prev_total:
            print(f'⚠ 告警：比上次备份少 {prev_total - total} 条（上次 {prev_total} → 现在 {total}）')
            print(f'   上次备份：{prev_name}')
        else:
            print(f'较上次 +{total - prev_total} 条')

    files = sorted(f for f in os.listdir(OUT_DIR) if f.startswith('projects_') and f.endswith('.json'))
    for old in files[:-KEEP]:
        os.remove(os.path.join(OUT_DIR, old))
        print(f'清理旧备份: {old}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
