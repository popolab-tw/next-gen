# NEXT GEN（map/index.html）：開場 → MV → 略過 → 地圖；YouTube 播放器用模擬的 API
#   python3 test/nextgen.py
# 需要 Playwright。暫代影片是 H.264，測試用的 Chromium 播不了，所以改送一份 WebM（ffmpeg 轉）
import os, sys, re, json, subprocess, threading, functools, http.server, socketserver, tempfile
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok = True
def check(name, cond, info=''):
    global ok
    print(('OK  ' if cond else 'FAIL') + ' ' + name + ('' if cond else '  ' + str(info)))
    ok = ok and bool(cond)

tmp = tempfile.mkdtemp()
webm = os.path.join(tmp, 'p.webm')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(ROOT, 'viz', 'mv-placeholder.mp4'), '-t', '4', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', webm], check=True)
WEBM = open(webm, 'rb').read()
html = open(os.path.join(ROOT, 'map', 'index.html'), encoding='utf8').read()
open(os.path.join(ROOT, 'map', '_yt.html'), 'w', encoding='utf8').write(re.sub(r'window\.NEXTGEN = \{.*?\};', 'window.NEXTGEN = {"mv":{"yt":"TESTID"}};', html, count=1, flags=re.S))
open(os.path.join(ROOT, 'map', '_file.html'), 'w', encoding='utf8').write(re.sub(r'window\.NEXTGEN = \{.*?\};', 'window.NEXTGEN = {"mv":{"src":"../viz/mv-placeholder.mp4"}};', html, count=1, flags=re.S))
open(os.path.join(ROOT, 'map', '_nomv.html'), 'w', encoding='utf8').write(re.sub(r'window\.NEXTGEN = \{.*?\};', 'window.NEXTGEN = {"mv":null};', html, count=1, flags=re.S))
open(os.path.join(ROOT, 'map', '_ext.html'), 'w', encoding='utf8').write(re.sub(r'window\.NEXTGEN = \{.*?\};', 'window.NEXTGEN = {"mv":{"yt":"TESTID","len":"3 分半","ext":true}};', html, count=1, flags=re.S))
CFG = json.load(open(os.path.join(ROOT, 'build', 'web.config.json'), encoding='utf8')).get('nextgenMv') or {}

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d/map/' % port

MOCK = """
window.__yt = { calls: [] };
window.YT = { Player: function (el, o) {
  var self = this, t = 0, muted = false, dur = 3, iv = 0;
  var f = document.createElement('iframe'); el.parentNode.replaceChild(f, el); window.__yt.opts = o;
  this.getIframe = function () { return f; };
  this.start = function () { o.events.onStateChange({ data: 1 }); clearInterval(iv); iv = setInterval(function () { t += 0.2; if (t >= dur) { clearInterval(iv); o.events.onStateChange({ data: 0 }); } }, 200); };
  this.playVideo = function () { window.__yt.calls.push('play'); if (window.__ytErr) { setTimeout(function () { o.events.onError({ data: 150 }); }, 100); return; } if (!window.__ytBlock) self.start(); };
  this.pauseVideo = function () { window.__yt.calls.push('pause'); clearInterval(iv); };
  this.seekTo = function (s) { t = s; }; this.getCurrentTime = function () { return t; }; this.getDuration = function () { return dur; };
  this.mute = function () { muted = true; }; this.unMute = function () { muted = false; }; this.isMuted = function () { return muted; };
  var vol = 100; window.__yt.vols = []; this.getVolume = function () { return vol; }; this.setVolume = function (v) { vol = v; window.__yt.vols.push(v); };
  window.__ytp = this; setTimeout(function () { o.events.onReady({ target: self }); }, 50);
} };
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
"""
def route(r):
    u = r.request.url
    if u.endswith('.mp4'): return r.fulfill(status=200, body=WEBM, headers={'Content-Type': 'video/webm'})
    if u.startswith('https://www.youtube.com/iframe_api'):
        API.append(u); return r.fulfill(status=200, body=MOCK, headers={'Content-Type': 'text/javascript'})
    if u.startswith(BASE[:-4]): return r.continue_()
    return r.abort()
I = "document.getElementById('ng-intro')"
API = []

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    for mode in ('desktop', 'mobile'):
        vw = (1440, 900) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/*', route)
        if mode == 'desktop':
            pg.goto(BASE + '_nomv.html'); pg.wait_for_timeout(1500)
            check('沒有 MV：直接看地圖、不顯示 MV 按鈕', pg.evaluate(I + '.hidden') and pg.evaluate("document.getElementById('ng-mvbtn').hidden") and not pg.evaluate("document.documentElement.classList.contains('ng-lock')"))
            if CFG.get('yt'):
                del API[:]
                pg.goto(BASE); pg.wait_for_timeout(1500)
                fsrc = pg.evaluate("(document.getElementById('ng-yt-frame') || {}).src || ''")
                check('網站版：有 MV 開場與 MV 按鈕', not pg.evaluate(I + '.hidden') and not pg.evaluate("document.getElementById('ng-mvbtn').hidden"))
                check('網站版：YouTube 隱私強化模式、影片代號正確', fsrc.startswith('https://www.youtube-nocookie.com/embed/' + CFG['yt'] + '?') and 'enablejsapi=1' in fsrc, fsrc)
                check('網站版：按下播放前不載入 youtube.com 的 API（不設 cookie）', not API, API)
                check('網站版：標題畫面顯示 MV 長度', ('約 ' + CFG.get('len', '')) in pg.evaluate("document.querySelector('.ng-play-s').textContent"))
        pg.goto(BASE + '_file.html'); pg.wait_for_timeout(2000)
        check(mode + ': 開場標題畫面', pg.evaluate(I + '.hidden') is False and pg.evaluate("document.documentElement.classList.contains('ng-lock')"))
        check(mode + ': 預設深色', pg.evaluate("document.documentElement.getAttribute('data-theme')") == 'dark')
        if mode == 'mobile': pg.tap('.ng-title', position={'x': 195, 'y': 300})
        else: pg.keyboard.press('k')
        pg.wait_for_timeout(1300)
        check(mode + ': 按鍵／點一下開始播放', 'on' in pg.evaluate(I + '.className') and pg.evaluate("document.querySelector('.ng-file').currentTime") > 0.2, pg.evaluate(I + '.className'))
        check(mode + ': 地圖在背後先載入', pg.evaluate("window.__ng.viz.ready()"))
        if mode == 'mobile': pg.tap('.ng-catch', position={'x': 100, 'y': 300})
        else: pg.mouse.move(300, 300); pg.mouse.move(320, 320)
        pg.wait_for_timeout(300)
        check(mode + ': 互動後出現「略過」', 'hud' in pg.evaluate(I + '.className'))
        pg.evaluate('window.__ng.viz._bare(true)')   # 軟體繪圖太慢，會拖住計時器；量音量時只畫海岸線與點
        if mode == 'mobile': pg.tap('.ng-skip')
        else: pg.keyboard.press('Escape')
        pg.wait_for_timeout(450)
        vol = pg.evaluate("document.querySelector('.ng-file').volume")
        check(mode + ': 略過時音樂漸弱（不是直接消失）', 0.05 < vol < 0.7 and not pg.evaluate("document.querySelector('.ng-file').paused"), vol)
        pg.wait_for_function("document.getElementById('ng-intro').hidden", timeout=6000)
        check(mode + ': 停下後音量恢復，重播才有聲音', pg.evaluate("document.querySelector('.ng-file').volume") == 1 and pg.evaluate("document.querySelector('.ng-file').paused"))
        check(mode + ': 略過後轉到地圖', pg.evaluate(I + '.hidden') and not pg.evaluate("document.documentElement.classList.contains('ng-lock')"), (pg.evaluate('document.documentElement.className'), pg.evaluate(I + '.hidden'), pg.evaluate('window.__ng.intro.state()')))
        pg.wait_for_timeout(4200)
        st = pg.evaluate("({y: window.__ng.viz.state.yaw, p: window.__ng.viz.state.pitch})")
        check(mode + ': 開場運鏡停在預設視角', abs(st['y'] - 55) < 0.5 and abs(st['p'] - 40) < 0.5, st)
        check(mode + ': 圓點大小預設（手機 0.6、電腦 1）', pg.evaluate("window.__ng.viz.state.prefs.dot") == (0.6 if mode == 'mobile' else 1), pg.evaluate("window.__ng.viz.state.prefs.dot"))
        tb = "document.querySelector('.vz-ctl .vz-txt')"
        check(mode + ': 右下角有「微縮攝影」按鈕，排在按鈕列最前面', pg.evaluate(tb + ".textContent") == '微縮攝影' and pg.evaluate(tb + " === document.querySelector('.vz-ctl').firstElementChild") and pg.evaluate(tb + ".getAttribute('aria-pressed')") == 'false')
        # 不能和圖例、其他按鈕重疊
        ov = pg.evaluate("""(() => { const r = e => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const t = r(document.querySelector('.vz-ctl .vz-txt')), others = [...document.querySelectorAll('.vz-ctl .vz-btn:not(.vz-txt)'), document.querySelector('.vz-legend')].map(r);
          const st = r(document.querySelector('.vz-stage'));
          return { overlap: others.some(o => hit(t, o)), inside: t.left >= st.left && t.right <= st.right && t.bottom <= st.bottom, w: t.width, h: t.height }; })()""")
        check(mode + ': 「微縮攝影」按鈕不壓到圖例和其他按鈕', not ov['overlap'] and ov['inside'] and ov['w'] > ov['h'], ov)
        pg.click('.vz-ctl .vz-txt') if mode == 'desktop' else pg.tap('.vz-ctl .vz-txt')
        pg.wait_for_timeout(200)
        on = pg.evaluate("({ mini: document.querySelector('.vz-stage').classList.contains('vz-mini'), tilt: !document.querySelector('.vz-tilt').hidden, pref: window.__ng.viz.state.prefs.tilt, pressed: " + tb + ".getAttribute('aria-pressed'), on: " + tb + ".classList.contains('on'), saved: JSON.parse(localStorage.getItem('tw-kids:vizPrefs3')).tilt })")
        check(mode + ': 點「微縮攝影」打開效果並記住', on == {'mini': True, 'tilt': True, 'pref': True, 'pressed': 'true', 'on': True, 'saved': True}, on)
        pg.click('.vz-ctl .vz-btn[aria-label="顯示設定"]') if mode == 'desktop' else pg.tap('.vz-ctl .vz-btn[aria-label="顯示設定"]')
        pg.wait_for_timeout(200)
        check(mode + ': 設定裡的「微縮攝影」開關同步', pg.evaluate("[...document.querySelectorAll('.vz-set .vz-tg')].find(l => l.textContent.includes('微縮攝影')).querySelector('input').checked"))
        pg.click('.vz-set .vz-x') if mode == 'desktop' else pg.tap('.vz-set .vz-x')
        pg.click('.vz-ctl .vz-txt') if mode == 'desktop' else pg.tap('.vz-ctl .vz-txt')
        pg.wait_for_timeout(200)
        check(mode + ': 再點一次關掉', not pg.evaluate("document.querySelector('.vz-stage').classList.contains('vz-mini')") and pg.evaluate("document.querySelector('.vz-tilt').hidden") and pg.evaluate(tb + ".getAttribute('aria-pressed')") == 'false')
        check(mode + ': 下方小欄有 QR Code 與測驗連結', pg.evaluate("!!document.querySelector('.ng-x .ng-qr-box svg') && /next-gen\\/$/.test(document.querySelector('.ng-x-btn').href)"))
        pg.reload(); pg.wait_for_timeout(1200)
        check(mode + ': 同一分頁重新整理不再播開場', pg.evaluate(I + '.hidden'))
        pg.click('#ng-mvbtn') if mode == 'desktop' else pg.tap('#ng-mvbtn')
        pg.wait_for_timeout(1200)
        check(mode + ': 「MV」按鈕重播', not pg.evaluate(I + '.hidden') and 'playing' in pg.evaluate(I + '.className'))
        pg.wait_for_timeout(7000)
        check(mode + ': 播完自動轉到地圖', pg.evaluate(I + '.hidden'))
        check(mode + ': 沒有錯誤', not errs, errs)
        ctx.close()
    # YouTube：正常播放、播到最後轉場；手機擋自動播放時改讓觀眾直接點播放器
    for block in (False, True):
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        if block: pg.add_init_script('window.__ytBlock = true;')
        pg.route('**/*', route)
        pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1500)
        pg.evaluate('window.__ng.viz._bare(true)')
        tag = 'YouTube' + ('（擋自動播放）' if block else '')
        check(tag + ': 隱私強化模式', pg.evaluate("document.getElementById('ng-yt-frame').src").startswith('https://www.youtube-nocookie.com/embed/TESTID?'))
        check(tag + ': 按下播放前不載入 API', not pg.evaluate("!!window.__yt"))
        pg.click('.ng-title', position={'x': 600, 'y': 300}); pg.wait_for_timeout(800)
        check(tag + ': 按下播放後才載入 API', pg.evaluate("!!window.__yt && window.__yt.calls.indexOf('play') >= 0"))
        if block:
            pg.wait_for_timeout(3300)
            check(tag + ': 3.5 秒沒開始 → 讓觀眾點播放器', 'tap' in pg.evaluate(I + '.className') and not pg.evaluate("document.querySelector('.ng-tapmsg').hidden"))
            pg.evaluate('window.__ytp.start()'); pg.wait_for_timeout(400)
            check(tag + ': 點了之後恢復', 'tap' not in pg.evaluate(I + '.className') and 'on' in pg.evaluate(I + '.className'))
        else:
            check(tag + ': 播放中', 'on' in pg.evaluate(I + '.className'))
        pg.wait_for_timeout(5200)
        check(tag + ': 播到最後轉到地圖', pg.evaluate(I + '.hidden') and 'pause' in pg.evaluate('window.__yt.calls'))
        vols = pg.evaluate('window.__yt.vols')
        check(tag + ': 音樂漸弱後恢復音量', len(vols) >= 5 and min(vols) <= 5 and any(10 < v < 90 for v in vols) and vols[-1] == 100, vols)
        check(tag + ': 沒有錯誤', not errs, errs)
        ctx.close()
    for saved, want, name in (({'dot': 1, 'tilt': True}, 0.6, '舊預設 1 改成 0.6'), ({'dot': 1, 'd2': True}, 1, '自己調成 1 的保留'), ({'dot': 2.2}, 2.2, '自己調過的保留')):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = ctx.new_page()
        pg.add_init_script("try { if (!sessionStorage.getItem('x')) { localStorage.setItem('tw-kids:vizPrefs3', '%s'); sessionStorage.setItem('x', '1'); } } catch (e) {}" % json.dumps(saved))
        pg.route('**/*', route)
        pg.goto(BASE + '_nomv.html'); pg.wait_for_timeout(1500)
        check('手機圓點：' + name, pg.evaluate("window.__ng.viz.state.prefs.dot") == want, pg.evaluate("window.__ng.viz.state.prefs.dot"))
        ctx.close()
    # YouTube 回報錯誤（例如不允許嵌入）：轉到地圖、提示，之後 MV 按鈕改開 YouTube 新分頁
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytErr = true; window.__opened = []; window.open = function (u) { window.__opened.push(u); return null; };')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1500)
    pg.click('.ng-play'); pg.wait_for_timeout(2200)
    check('YouTube 錯誤: 轉到地圖並提示', pg.evaluate(I + '.hidden') and 'YouTube' in (pg.evaluate("(document.querySelector('.toast') || {}).textContent || ''")))
    pg.click('#ng-mvbtn'); pg.wait_for_timeout(300)
    check('YouTube 錯誤: MV 按鈕改開 YouTube', pg.evaluate('window.__opened') == ['https://youtu.be/TESTID'] and pg.evaluate(I + '.hidden'), pg.evaluate('window.__opened'))
    check('YouTube 錯誤: 沒有錯誤', not errs, errs)
    ctx.close()
    # ext（claude.ai 預覽版）：不放播放器，按鈕開 YouTube 新分頁
    for mode in ('desktop', 'mobile'):
        vw = (1440, 900) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script('window.__opened = []; window.open = function (u) { window.__opened.push(u); return null; };')
        pg.route('**/*', route); del API[:]
        pg.goto(BASE + '_ext.html'); pg.wait_for_timeout(1800)
        tag = 'ext ' + mode
        check(tag + ': 標題畫面改成「到 YouTube 看 MV」', '到 YouTube 看 MV' in pg.evaluate("document.querySelector('.ng-play-t').innerText") and '新分頁' in pg.evaluate("document.querySelector('.ng-play-s').textContent"))
        check(tag + ': 不放播放器、不載入 API', not pg.evaluate("!!document.getElementById('ng-yt-frame')") and not API)
        if mode == 'desktop': pg.keyboard.press('k')
        else: pg.tap('.ng-title', position={'x': 195, 'y': 200})
        pg.wait_for_timeout(300)
        check(tag + ': 按任意鍵／點空白處不會開新分頁', pg.evaluate('window.__opened') == [] and not pg.evaluate(I + '.hidden'))
        pg.click('.ng-play') if mode == 'desktop' else pg.tap('.ng-play')
        pg.wait_for_timeout(1300)
        check(tag + ': 按鈕開 YouTube、轉到地圖', pg.evaluate('window.__opened') == ['https://youtu.be/TESTID'] and pg.evaluate(I + '.hidden'))
        check(tag + ': 沒有錯誤', not errs, errs)
        ctx.close()
    b.close()
srv.shutdown()
for f in ('_yt.html', '_file.html', '_nomv.html', '_ext.html'): os.remove(os.path.join(ROOT, 'map', f))
print('全部通過' if ok else '有失敗')
sys.exit(0 if ok else 1)
