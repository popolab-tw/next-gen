# 搬家：舊網址跳轉頁（build/redirect/）→ 新網址，路徑、參數、# 都要保留；遊戲首頁要把匿名代號等紀錄帶過去
#   python3 test/move.py
# 用 Playwright 攔截兩個網址，在本機模擬 jasontzeng123.github.io（跳轉頁）和 popolab-tw.github.io（新網站）
import os, sys, json, mimetypes
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD, NEW = 'https://jasontzeng123.github.io', 'https://popolab-tw.github.io'
RED = open(os.path.join(ROOT, 'build', 'redirect', 'index.html'), 'rb').read()
ok = True
def check(name, cond, info=''):
    global ok
    print(('OK  ' if cond else 'FAIL') + ' ' + name + ('' if cond else '  ' + str(info)))
    ok = ok and bool(cond)

def route(r):
    u = r.request.url
    path = u.split('?')[0].split('#')[0]
    if u.startswith(OLD + '/'):
        p = path[len(OLD):]
        if p == '/setup': return r.fulfill(status=200, body='<!doctype html><title>setup</title>', headers={'Content-Type': 'text/html'})
        if p in ('/next-gen/', '/next-gen/index.html', '/next-gen-redirect/'): return r.fulfill(status=200, body=RED, headers={'Content-Type': 'text/html'})
        return r.fulfill(status=404, body=RED, headers={'Content-Type': 'text/html'})   # 其他路徑：GitHub Pages 會給 404.html（內容一樣）
    if u.startswith(NEW + '/next-gen/'):
        rel = path[len(NEW + '/next-gen/'):] or 'index.html'
        if rel.endswith('/'): rel += 'index.html'
        f = os.path.join(ROOT, rel)
        if os.path.isfile(f): return r.fulfill(status=200, body=open(f, 'rb').read(), headers={'Content-Type': mimetypes.guess_type(f)[0] or 'application/octet-stream'})
        return r.fulfill(status=404, body='not found')
    return r.abort()   # 其他（含真正的 Supabase）一律不連

ANON = {'id': 'a' * 24, 'secret': 'b' * 40}
with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx():
        c = b.new_context(viewport={'width': 1200, 'height': 800}); c.route('**/*', route); return c, c.new_page()
    # 1. 遊戲首頁＋參數＋#lab：帶著紀錄跳過去
    c, pg = ctx()
    pg.goto(OLD + '/setup')
    pg.evaluate("""(a) => { localStorage.setItem('tw-kids:anon', JSON.stringify(a)); localStorage.setItem('tw-kids:shared', JSON.stringify({ts: 1, sig: 'x'}));
      localStorage.setItem('tw-kids:qi', '7'); localStorage.setItem('tw-kids:unlocked', 'true'); localStorage.setItem('tw-kids:cvd', 'true'); localStorage.setItem('other:key', '"x"'); }""", ANON)
    pg.goto(OLD + '/next-gen/?utm_source=threads#lab')
    pg.wait_for_url(NEW + '/next-gen/**'); pg.wait_for_timeout(1200)
    check('首頁：跳到新網址並保留參數與 #lab（實驗室已解鎖，直接打開）', pg.url == NEW + '/next-gen/?utm_source=threads#lab', pg.url)
    got = pg.evaluate("({anon: localStorage.getItem('tw-kids:anon'), shared: localStorage.getItem('tw-kids:shared'), qi: localStorage.getItem('tw-kids:qi'), other: localStorage.getItem('other:key')})")
    check('首頁：匿名代號帶過去（不會變成新的一筆）', json.loads(got['anon'] or 'null') == ANON, got)
    check('首頁：分享狀態、進度也帶過去', got['shared'] and got['qi'] == '7', got)
    check('首頁：只帶這個遊戲的紀錄', got['other'] is None, got)
    check('首頁：網址列已拿掉紀錄', 'tkmig' not in pg.url)
    hist = pg.evaluate("history.length")
    pg.go_back(); pg.wait_for_timeout(600)
    check('上一頁不會回到含紀錄的網址', 'tkmig' not in pg.url, pg.url)
    c.close()
    # 2. 其他路徑（NEXT GEN）：路徑、參數、# 原封不動
    c, pg = ctx()
    pg.goto(OLD + '/next-gen/map/?a=1&b=2#map')
    pg.wait_for_url(NEW + '/next-gen/**')
    check('其他路徑：/map/?a=1&b=2#map 原樣保留', pg.url == NEW + '/next-gen/map/?a=1&b=2#map', pg.url)
    pg.goto(OLD + '/next-gen/og.png'); pg.wait_for_url(NEW + '/next-gen/**')
    check('檔案路徑也轉過去', pg.url == NEW + '/next-gen/og.png', pg.url)
    c.close()
    # 3. 沒有紀錄：不加多餘的東西
    c, pg = ctx()
    pg.goto(OLD + '/next-gen/'); pg.wait_for_url(NEW + '/next-gen/**'); pg.wait_for_timeout(300)
    check('沒有紀錄：網址乾淨', pg.url == NEW + '/next-gen/', pg.url)
    c.close()
    # 4. 新網址已經分享過：保留新網址的身分
    c, pg = ctx()
    pg.goto(NEW + '/next-gen/'); pg.wait_for_timeout(800)
    pg.evaluate("""() => { localStorage.setItem('tw-kids:anon', JSON.stringify({id: 'c'.repeat(24), secret: 'd'.repeat(40)})); localStorage.setItem('tw-kids:shared', JSON.stringify({ts: 2, sig: 'y'})); }""")
    pg.goto(OLD + '/setup')
    pg.evaluate("(a) => { localStorage.setItem('tw-kids:anon', JSON.stringify(a)); localStorage.setItem('tw-kids:shared', JSON.stringify({ts: 1, sig: 'x'})); }", ANON)
    pg.goto(OLD + '/next-gen/'); pg.wait_for_url(NEW + '/next-gen/**'); pg.wait_for_timeout(800)
    check('新網址已分享過：不覆蓋', json.loads(pg.evaluate("localStorage.getItem('tw-kids:anon')"))['id'] == 'c' * 24)
    c.close()
    # 5. 不是從舊網址來的（有人自己做的連結）：不收
    c, pg = ctx()
    import base64
    payload = base64.urlsafe_b64encode(json.dumps({'anon': json.dumps({'id': 'e' * 24, 'secret': 'f' * 40})}).encode()).decode().rstrip('=')
    pg.goto(NEW + '/next-gen/#tkmig=' + payload); pg.wait_for_timeout(800)
    anon = json.loads(pg.evaluate("localStorage.getItem('tw-kids:anon')") or 'null')
    check('外來連結：不收、網址列也清掉', (not anon or anon['id'] != 'e' * 24) and 'tkmig' not in pg.url, (anon, pg.url))
    c.close()
    # 6. 先建好、還沒改名的跳轉 repo（next-gen-redirect）也能用
    c, pg = ctx()
    pg.goto(OLD + '/next-gen-redirect/?x=1#method'); pg.wait_for_url(NEW + '/next-gen/**')
    check('暫用名稱 next-gen-redirect 也正確', pg.url == NEW + '/next-gen/?x=1#method', pg.url)
    c.close()
    b.close()
print('全部通過' if ok else '有失敗')
sys.exit(0 if ok else 1)
