"""Attempt OA login with correct /oa prefix."""
import urllib.request, urllib.parse, ssl, re, http.cookiejar, json

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

cj = http.cookiejar.CookieJar()
https_handler = urllib.request.HTTPSHandler(context=ctx)
opener = urllib.request.build_opener(https_handler, urllib.request.HTTPCookieProcessor(cj))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'

def do_req(url, data=None, referer=None, content_type=None):
    h = {'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest'}
    if referer:
        h['Referer'] = referer
    if data and isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
        if not content_type:
            h['Content-Type'] = 'application/x-www-form-urlencoded'
    r = urllib.request.Request(url, data=data, headers=h)
    resp = opener.open(r, timeout=15)
    body = resp.read().decode('utf-8', errors='ignore')
    return body, resp.status

user = 'zhengjinchun'
pwd = 'Gkxt123456@'
BASE = 'https://oa.gkxtsz.com/oa'

# Step 1: Visit homepage first to get any cookies
print('[1] Visiting homepage...')
html, _ = do_req('https://oa.gkxtsz.com/')
print(f'    Cookies: {[(c.name, c.value[:30]) for c in cj]}')

# Step 2: Try login
print(f'\n[2] Attempting login at {BASE}/doLogin.do...')
resp, status = do_req(
    f'{BASE}/doLogin.do',
    data={'username': user, 'password': pwd},
    referer='https://oa.gkxtsz.com/')
print(f'    Status: {status}')
print(f'    Response: {resp[:800]}')

try:
    data = json.loads(resp)
    print(f'    Parsed JSON: {json.dumps(data, indent=2, ensure_ascii=False)[:500]}')
except:
    print('    (not JSON, probably HTML)')

print(f'\n    Cookies after login: {[(c.name, c.value[:40]) for c in cj]}')

# Step 3: Check if logged in - try to get user info
print(f'\n[3] Checking session - getting user info...')
try:
    resp, status = do_req(
        f'{BASE}/user',
        referer='https://oa.gkxtsz.com/')
    print(f'    /oa/user: status={status}, resp={resp[:300]}')
except Exception as e:
    print(f'    Error: {e}')

# Step 4: Try weekly report related endpoints
weekly_urls = [
    f'{BASE}/report/week/dept/option',
    f'{BASE}/weeklyReport',
    f'{BASE}/weekly',
    f'{BASE}/report/weekly',
]
for url in weekly_urls:
    try:
        resp, status = do_req(url, referer='https://oa.gkxtsz.com/')
        print(f'    {url}: status={status}, len={len(resp)}, preview={resp[:200]}')
    except Exception as e:
        print(f'    {url}: {e}')
