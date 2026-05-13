"""
Fetch OA weekly report data and update projects.json with 周报动态.
Usage: python fetch_oa_weekly.py
Requires: oa_cookie.txt with JSESSIONID cookie value.
"""
import urllib.request, ssl, json, sys, os
from datetime import date

sys.stdout.reconfigure(encoding='utf-8')

# === Config ===
BASE_URL = 'https://oa.gkxtsz.com/oa'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(SCRIPT_DIR, 'oa_cookie.txt')
PROJECTS_FILE = os.path.join(SCRIPT_DIR, 'data', 'projects.json')

# OA project name keywords -> (our project ID, our project name keyword)
# The name_keyword is used to disambiguate when multiple projects share the same ID
# Order matters: more specific matches first
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
    """Read cookie from file."""
    if not os.path.exists(COOKIE_FILE):
        print(f'ERROR: Cookie file not found: {COOKIE_FILE}')
        print('Create oa_cookie.txt with content: JSESSIONID=your_session_id')
        sys.exit(1)
    with open(COOKIE_FILE, 'r', encoding='utf-8') as f:
        return f.read().strip()


def fetch_weekly_data(cookie):
    """Fetch all weekly report data from OA."""
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
    """Map OA project name to (our_project_id, name_keyword)."""
    for keyword, our_id, name_kw in OA_PROJECT_MAP:
        if keyword in oa_project_name:
            return our_id, name_kw
    return None, None


def group_by_project(records, target_week_dates=None):
    """Group records by our project ID for a given week.
    target_week_dates: list of date strings to include (e.g. ['2026-05-11', '2026-05-09'])
    Returns dict: {(our_id, name_kw): [{userName, workHours, thisWeekWork, nextWeekPlan, help}]}
    """
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


def generate_summary(entries):
    """Generate a concise summary from work entries."""
    lines = []
    for e in entries:
        user = e['userName']
        hours = e['workHours']
        works = e['thisWeekWork']
        plans = e['nextWeekPlan']
        helps = e['help']

        # Clean and flatten work items
        all_work = '; '.join(w.strip() for w in works if w.strip())
        all_plan = '; '.join(w.strip() for w in plans if w.strip())

        if all_work:
            lines.append(f"【{user}·{hours}h】{all_work[:300]}")
        if all_plan:
            lines.append(f"  下周计划: {all_plan[:200]}")
        if helps:
            all_help = '; '.join(w.strip() for w in helps if w.strip())
            lines.append(f"  ⚠需协助: {all_help[:200]}")
    return '\n'.join(lines)


def get_latest_week_dates(records):
    """Get all dates in the latest week (past 7 days from max date)."""
    from datetime import datetime, timedelta
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
    """Find the matching group key for a project.
    Returns (pid, name_kw) key if matched, None otherwise.
    """
    pid = project['id']
    name = project['name']
    for (gid, gname_kw) in groups:
        if gid == pid:
            # If ID is unique (not '-'), match directly
            if gid != '-':
                return (gid, gname_kw)
            # If ID is '-', also check name keyword
            if gname_kw in name:
                return (gid, gname_kw)
    return None


def update_projects_json(groups, week):
    """Add 周报动态 entries to projects.json.
    Removes any existing OA周报 entries first, then adds fresh ones.
    """
    with open(PROJECTS_FILE, 'r', encoding='utf-8') as f:
        projects = json.load(f)

    timestamp = f"{week} (OA周报)"
    updated = 0
    skipped = 0

    # First, remove all existing OA周报 entries
    for project in projects:
        if 'updates' in project:
            project['updates'] = [u for u in project['updates'] if u.get('author') != 'OA周报']

    # Now add fresh entries
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
        print(f'  [OK] {project["id"]} {project["name"]}: added 周报动态')

    with open(PROJECTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(projects, f, ensure_ascii=False, indent=2)

    return updated, skipped


def show_preview(groups, week):
    """Show preview of what will be added."""
    print(f'\n{"="*60}')
    print(f'OA Weekly Report Summary - Week of {week}')
    print(f'{"="*60}')
    for (pid, name_kw), entries in groups.items():
        print(f'\n--- {pid} ({name_kw}) ---')
        summary = generate_summary(entries)
        print(summary[:600])
    print(f'\n{"="*60}')
    print(f'Projects with data: {len(groups)}')
    for (pid, name_kw) in groups:
        print(f'  {pid} ({name_kw}): {len(groups[(pid, name_kw)])} entries')


def main():
    print('=== OA Weekly Report Fetcher ===')
    print()

    # Load cookie
    cookie = load_cookie()
    print(f'[1] Loaded cookie from {COOKIE_FILE}')

    # Fetch data
    print('[2] Fetching weekly report data from OA...')
    records = fetch_weekly_data(cookie)
    print(f'    Got {len(records)} records')

    # Find latest week dates (past 7 days from max)
    week_dates = get_latest_week_dates(records)
    print(f'    Latest week dates: {week_dates}')

    # Group by our project
    groups = group_by_project(records, week_dates)
    print(f'[3] Mapped to {len(groups)} of our projects')

    # Preview
    week_label = f'{week_dates[-1]} ~ {week_dates[0]}'
    show_preview(groups, week_label)

    # Update
    print(f'\n[4] Updating {PROJECTS_FILE}...')
    updated, skipped = update_projects_json(groups, week_label)
    print(f'    Updated: {updated}, Skipped: {skipped}')
    print('\nDone! Refresh index.html to see 周报动态.')


if __name__ == '__main__':
    main()
