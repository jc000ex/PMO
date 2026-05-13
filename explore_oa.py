"""
Explore OA system to find login API and weekly report interface.
Usage: python explore_oa.py
"""
import urllib.request, ssl, re, http.cookiejar, json, sys, base64, hashlib

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

cj = http.cookiejar.CookieJar()
https_handler = urllib.request.HTTPSHandler(context=ctx)
opener = urllib.request.build_opener(https_handler, urllib.request.HTTPCookieProcessor(cj))
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'}

def get(url, referer=None):
    h = dict(headers)
    if referer:
        h['Referer'] = referer
    req = urllib.request.Request(url, headers=h)
    return opener.open(req, timeout=15).read().decode('utf-8', errors='ignore')

def post(url, data, referer=None, content_type='application/x-www-form-urlencoded'):
    h = dict(headers)
    if referer:
        h['Referer'] = referer
    h['Content-Type'] = content_type
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
    elif isinstance(data, str):
        data = data.encode()
    req = urllib.request.Request(url, data=data, headers=h, method='POST')
    return opener.open(req, timeout=15).read().decode('utf-8', errors='ignore')

# Step 1: Get login page
print('[1] Fetching homepage...')
html = get('https://oa.gkxtsz.com/')
print(f'    HTML length: {len(html)}')

# Extract main app JS
main_js = None
for m in re.finditer(r'src="([^"]*index\.[^"]*\.js[^"]*)"', html):
    main_js = m.group(1)
    print(f'    Main JS: {main_js}')

if main_js:
    js_url = 'https://oa.gkxtsz.com' + main_js
    print('\n[2] Fetching main app JS...')
    js = get(js_url, referer='https://oa.gkxtsz.com/')
    print(f'    JS length: {len(js)}')

    # Look for login-related API paths
    for pattern in [r'login', r'Login', r'doLogin', r'signin', r'account', r'passport', r'auth']:
        for m in re.finditer(r'["\'`/]([^"\'`]*' + pattern + r'[^"\'`]*)["\'`]', js):
            val = m.group(1)
            if len(val) < 100 and not val.startswith('_'):
                print(f'    [{pattern}] {val}')

# Step 2: Get common.js for login functions
print('\n[3] Fetching common.js...')
common = get('https://oa.gkxtsz.com/resource/js/common.js')
print(f'    JS length: {len(common)}')

# Look for login function and AES usage
login_patterns = re.findall(r'(function\s+\w*login\w*[^}]*})', common, re.IGNORECASE)
print(f'    Login functions found: {len(login_patterns)}')
for p in login_patterns[:3]:
    print(f'    ---\n    {p[:300]}')

# Look for AES encryption patterns
aes_patterns = re.findall(r'(var\s+\w*\s*=\s*new\s+AES[^;]*)', common, re.IGNORECASE)
print(f'    AES patterns found: {len(aes_patterns)}')

# Step 3: Look at the login form structure
print('\n[4] Looking for login endpoint patterns...')
login_urls = set()
for pattern in [r'["\']([^"\']*login[^"\']*)["\']', r'["\']([^"\']*doLogin[^"\']*)["\']',
                r'["\']([^"\']*signIn[^"\']*)["\']', r'["\']([^"\']*passport[^"\']*)["\']']:
    for m in re.finditer(pattern, common, re.IGNORECASE):
        login_urls.add(m.group(1))
    for m in re.finditer(pattern, js, re.IGNORECASE):
        login_urls.add(m.group(1))

for u in sorted(login_urls):
    print(f'    {u}')

print('\n=== Done ===')
print('Cookies:', [(c.name, c.value[:30]) for c in cj])
