"""
Fetch OA weekly report data and update projects.json with 周报动态.
Usage: python fetch_oa_weekly.py
Requires: oa_cookie.txt with JSESSIONID cookie value.
"""
import urllib.request, ssl, json, sys, os, re
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

# === Config ===
BASE_URL = 'https://oa.gkxtsz.com/oa'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(SCRIPT_DIR, 'oa_cookie.txt')
PROJECTS_FILE = os.path.join(SCRIPT_DIR, 'data', 'projects.json')

# OA project name keywords -> (our project ID, our project name keyword)
OA_PROJECT_MAP = [
    ('龙华区低空智联网数字底座一体化建设', '-', '龙华'),
    ('中移凌云低空监管平台（apec', 'GD-202', 'apec'),
    ('贺州市公安局警用无人机指挥调度系统（中移凌云）', 'GX-235', '贺州'),
    ('贺州市公安局警用无人机指挥调度系统', 'GX-235', '贺州'),
    ('贺州（移动）', 'GX-235', '贺州'),
    ('长春市公安低空智慧警务系统（中移凌云）', 'JL25-227', '长春'),
    ('长春公安低空智慧警务系统（共建）', 'JL25-227', '长春'),
    ('长春公安低空智慧警务系统（移动 共建）', 'JL25-227', '长春'),
    ('伊犁警用无人机调度指挥平台（中移凌云）', 'XJ-201', '伊犁'),
    ('中移凌云警用无人机调度指挥平台（伊犁）', 'XJ-201', '伊犁'),
    ('（伊犁）中移凌云警用无人机调度指挥平台', 'XJ-201', '伊犁'),
    ('成都高新低空警务实战场景建设项目（中移凌云-旧版）', 'SC25-228', '成都高新'),
    ('高新公安低空警务实战平台（共建+定开）', 'SC25-228', '成都高新'),
    ('北京市平谷区GA分局警用无人机飞控平台', 'BH-234', '平谷'),
    ('北京平谷低空安全管控系统', 'BH-234', '平谷'),
    ('北京平谷（移动-25年11月）', 'BH-234', '平谷'),
    ('海南州GA警用无人机飞控平台（高新+成研）', 'QH-233', '海南州'),
    ('海南州公安警用无人机飞控平台（青海海南州-移动）', 'QH-233', '海南州'),
    ('珠海系统（共建-名称待定）', 'GD25-229', '珠海'),
    ('珠海市公安局警用无人机综合应用管理平台', 'GD25-229', '珠海'),
    ('鄂尔多斯-东胜区交投低空管理运营服务平台（移动-星扬）', 'NMG-230', '鄂尔多斯'),
    ('鄂尔多斯系统（共建-名称待定）', 'NMG-230', '鄂尔多斯'),
]


def load_cookie():
    if not os.path.exists(COOKIE_FILE):
        print(f'ERROR: Cookie file not found: {COOKIE_FILE}')
        print('Create oa_cookie.txt with content: JSESSIONID=your_session_id')
        sys.exit(1)
    with open(COOKIE_FILE, 'r', encoding='utf-8') as f:
        return f.read().strip()


def fetch_weekly_data(cookie):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        'Cookie': cookie,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://oa.gkxtsz.com/oa/',
    }
    req = urllib.request.Request(f'{BASE_URL}/report/week/list', headers=h)
    resp = urllib.request.urlopen(req, timeout=30, context=ctx)
    body = resp.read().decode('utf-8')
    data = json.loads(body)
    if data.get('code') != 200:
        print(f"ERROR: API returned code {data.get('code')}, msg: {data.get('msg')}")
        print('Cookie may have expired. Please update oa_cookie.txt.')
        sys.exit(1)
    return data['data']['records']


def map_to_our_project(oa_project_name):
    for keyword, our_id, name_kw in OA_PROJECT_MAP:
        if keyword in oa_project_name:
            return our_id, name_kw
    return None, None


def group_by_project(records, target_week_dates=None):
    groups = {}
    for r in records:
        week = r.get('createTime', '')[:10]
        if target_week_dates and week not in target_week_dates:
            continue
        for c in r.get('content', []):
            oa_name = c.get('project', '')
            pid, name_kw = map_to_our_project(oa_name)
            if pid is None:
                continue
            key = (pid, name_kw)
            if key not in groups:
                groups[key] = []
            groups[key].append({
                'userName': r.get('userName', ''),
                'workHours': c.get('workHours', 0),
                'thisWeekWork': [w.get('content', '') for w in c.get('thisWeekWork', [])],
                'nextWeekPlan': [w.get('content', '') for w in c.get('nextWeekPlan', [])],
                'help': [w.get('content', '') for w in c.get('help', [])],
            })
    return groups


# ===== Summarization =====

def clean_work_text(text):
    """Clean OA work item text: remove hierarchy markers, progress, excess whitespace."""
    # Remove leading tree markers like "- 组件", "  - 子项", "- "
    text = re.sub(r'^[\s\-—•·]+[一-鿿\w\s]+[\s\-—•·]+', '', text)
    text = re.sub(r'^[\s\-—•·]+', '', text)
    # Remove progress like [100%], (100%), 100%
    text = re.sub(r'[\[（\(]\d{1,3}%[\]）\)]', '', text)
    # Remove standalone progress numbers at start
    text = re.sub(r'^\d{1,3}%\s*', '', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip().rstrip('，。；;、')


def extract_atomic_items(work_list):
    """Break down work entries into atomic items, clean, and deduplicate."""
    raw_items = []
    for work in work_list:
        work = work.strip()
        if not work:
            continue
        # Split by common delimiters
        parts = re.split(r'[;；\n]', work)
        for p in parts:
            cleaned = clean_work_text(p)
            if len(cleaned) >= 5:
                raw_items.append(cleaned)

    # Deduplicate by first 20 chars
    seen = set()
    unique = []
    for item in raw_items:
        prefix = item[:20]
        if prefix not in seen:
            seen.add(prefix)
            unique.append(item)
    return unique


def categorize_items(items):
    """Categorize work items. Returns dict of category -> items."""
    cats = {'开发': [], '修复': [], '测试': [], '部署对接': [], '文档': [], '其他': []}

    dev_kw = ['开发', '新增', '实现', '构建', '重构', '编写', '撰写', '制作']
    fix_kw = ['修复', 'bug', 'BUG', '缺陷', '问题', '异常']
    test_kw = ['测试', '复测', '验收', '回归', '压测']
    deploy_kw = ['部署', '安装', '上线', '发布', '配置', '对接', '沟通', '协调', '会议', '支撑', '演示']
    doc_kw = ['文档', 'PPT', '方案', '需求', '说明书', '手册', '脚本', '素材', '视频']

    for item in items:
        if any(kw in item for kw in fix_kw):
            cats['修复'].append(item)
        elif any(kw in item for kw in dev_kw):
            cats['开发'].append(item)
        elif any(kw in item for kw in test_kw):
            cats['测试'].append(item)
        elif any(kw in item for kw in deploy_kw):
            cats['部署对接'].append(item)
        elif any(kw in item for kw in doc_kw):
            cats['文档'].append(item)
        else:
            cats['其他'].append(item)
    return cats


def generate_summary(entries):
    """Generate a 200-char structured summary from all work entries."""
    users = list(set(e['userName'] for e in entries))
    total_h = sum(e.get('workHours', 0) for e in entries)

    # Collect all work items
    all_works = []
    for e in entries:
        all_works.extend(e.get('thisWeekWork', []))

    items = extract_atomic_items(all_works)
    if not items:
        return ''

    cats = categorize_items(items)

    # Build summary (target: under 200 chars)
    parts = [f"本周{len(users)}人参与（{total_h}h）"]

    # Pick top items from each category, keep it tight
    selected = []
    for cat_name in ['修复', '开发', '测试', '部署对接', '文档', '其他']:
        cat_items = cats.get(cat_name, [])
        for item in cat_items[:2]:  # max 2 per category
            short = item[:55].rstrip('，。；;、')
            if short and short not in selected:
                selected.append(short)
            if len(selected) >= 5:
                break
        if len(selected) >= 5:
            break

    if selected:
        parts.append('：' + '；'.join(selected))

    # Next week plans (concise)
    all_plans = []
    for e in entries:
        all_plans.extend(e.get('nextWeekPlan', []))
    plan_items = extract_atomic_items(all_plans)
    if plan_items:
        plan_text = '；'.join(p[:35].rstrip('，。；、') for p in plan_items[:2])
        parts.append('。下周：' + plan_text)

    # Help needed
    all_helps = []
    for e in entries:
        all_helps.extend(e.get('help', []))
    help_items = extract_atomic_items(all_helps)
    if help_items:
        help_text = '；'.join(h[:40] for h in help_items[:1])
        parts.append('。需协助：' + help_text)

    result = ''.join(parts)

    # Truncate to 200 chars at sentence boundary
    if len(result) > 200:
        result = result[:197] + '...'

    return result


def get_latest_week_dates(records):
    """Get all dates in the latest week (past 7 days from max date)."""
    from datetime import timedelta
    dates = set()
    for r in records:
        d = r.get('createTime', '')[:10]
        if d:
            dates.add(d)
    max_date = max(dates)
    max_dt = datetime.strptime(max_date, '%Y-%m-%d')
    week_dates = set()
    for d in dates:
        dt = datetime.strptime(d, '%Y-%m-%d')
        if (max_dt - dt).days < 7:
            week_dates.add(d)
    return sorted(week_dates, reverse=True)


def find_project_key(project, groups):
    pid = project['id']
    name = project['name']
    for (gid, gname_kw) in groups:
        if gid == pid:
            if gid != '-':
                return (gid, gname_kw)
            if gname_kw in name:
                return (gid, gname_kw)
    return None


def update_projects_json(groups, week):
    with open(PROJECTS_FILE, 'r', encoding='utf-8') as f:
        projects = json.load(f)

    timestamp = f"{week} (OA周报)"
    updated = 0
    skipped = 0

    # Remove existing OA entries
    for project in projects:
        if 'updates' in project:
            project['updates'] = [u for u in project['updates'] if u.get('author') != 'OA周报']

    # Add fresh entries
    for project in projects:
        key = find_project_key(project, groups)
        if key is None:
            skipped += 1
            continue

        summary = generate_summary(groups[key])
        if not summary:
            skipped += 1
            continue

        if 'updates' not in project:
            project['updates'] = []

        project['updates'].append({
            'date': timestamp,
            'content': summary,
            'author': 'OA周报',
        })
        updated += 1
        print(f'  [OK] {project["id"]} {project["name"]}: {len(summary)}字')

    with open(PROJECTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(projects, f, ensure_ascii=False, indent=2)

    return updated, skipped


def show_preview(groups, week):
    print(f'\n{"="*60}')
    print(f'OA Weekly Report Summary - {week}')
    print(f'{"="*60}')
    for (pid, name_kw), entries in groups.items():
        users = set(e['userName'] for e in entries)
        print(f'\n--- {pid} ({name_kw}) | {len(users)}人: {", ".join(users)} ---')
        summary = generate_summary(entries)
        print(f'  [{len(summary)}字] {summary}')


def main():
    print('=== OA Weekly Report Fetcher ===\n')

    cookie = load_cookie()
    print(f'[1] Loaded cookie from {COOKIE_FILE}')

    print('[2] Fetching weekly report data from OA...')
    records = fetch_weekly_data(cookie)
    print(f'    Got {len(records)} records')

    week_dates = get_latest_week_dates(records)
    print(f'    Latest week dates: {week_dates}')

    groups = group_by_project(records, week_dates)
    print(f'[3] Mapped to {len(groups)} of our projects')

    week_label = f'{week_dates[-1]} ~ {week_dates[0]}'
    show_preview(groups, week_label)

    print(f'\n[4] Updating {PROJECTS_FILE}...')
    updated, skipped = update_projects_json(groups, week_label)
    print(f'    Updated: {updated}, Skipped: {skipped}')
    print('\nDone! Commit and push to GitHub to see 周报动态 online.')


if __name__ == '__main__':
    main()
