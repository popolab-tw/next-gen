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
  this.playVideo = function () { window.__yt.calls.push('play'); if (!window.__ytBlock) self.start(); };
  this.pauseVideo = function () { window.__yt.calls.push('pause'); clearInterval(iv); };
  this.seekTo = function (s) { t = s; }; this.getCurrentTime = function () { return t; }; this.getDuration = function () { return dur; };
  this.mute = function () { muted = true; }; this.unMute = function () { muted = false; }; this.isMuted = function () { return muted; };
  window.__ytp = this; setTimeout(function () { o.events.onReady({ target: self }); }, 50);
} };
if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
"""
def route(r):
    u = r.request.url
    if u.endswith('.mp4'): return r.fulfill(status=200, body=WEBM, headers={'Content-Type': 'video/webm'})
    if u.startswith('https://www.youtube.com/iframe_api'): return r.fulfill(status=200, body=MOCK, headers={'Content-Type': 'text/javascript'})
    if u.startswith(BASE[:-4]): return r.continue_()
    return r.abort()
I = "document.getElementById('ng-intro')"

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
    for mode in ('desktop', 'mobile'):
        vw = (1440, 900) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/*', route)
        pg.goto(BASE); pg.wait_for_timeout(2000)
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
        if mode == 'mobile': pg.tap('.ng-skip')
        else: pg.keyboard.press('Escape')
        pg.wait_for_timeout(1400)
        check(mode + ': 略過後轉到地圖', pg.evaluate(I + '.hidden') and not pg.evaluate("document.documentElement.classList.contains('ng-lock')"))
        pg.wait_for_timeout(3000)
        st = pg.evaluate("({y: window.__ng.viz.state.yaw, p: window.__ng.viz.state.pitch})")
        check(mode + ': 開場運鏡停在預設視角', abs(st['y'] - 55) < 0.5 and abs(st['p'] - 40) < 0.5, st)
        check(mode + ': 下方小欄有 QR Code 與測驗連結', pg.evaluate("!!document.querySelector('.ng-x .ng-qr-box svg') && /next-gen\\/$/.test(document.querySelector('.ng-x-btn').href)"))
        pg.reload(); pg.wait_for_timeout(1200)
        check(mode + ': 同一分頁重新整理不再播開場', pg.evaluate(I + '.hidden'))
        pg.click('#ng-mvbtn') if mode == 'desktop' else pg.tap('#ng-mvbtn')
        pg.wait_for_timeout(1200)
        check(mode + ': 「MV」按鈕重播', not pg.evaluate(I + '.hidden') and 'playing' in pg.evaluate(I + '.className'))
        pg.wait_for_timeout(5500)
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
        tag = 'YouTube' + ('（擋自動播放）' if block else '')
        check(tag + ': 隱私強化模式', pg.evaluate("window.__yt.opts.host") == 'https://www.youtube-nocookie.com' and pg.evaluate("window.__yt.opts.videoId") == 'TESTID')
        pg.click('.ng-title', position={'x': 600, 'y': 300}); pg.wait_for_timeout(800)
        if block:
            pg.wait_for_timeout(3300)
            check(tag + ': 3.5 秒沒開始 → 讓觀眾點播放器', 'tap' in pg.evaluate(I + '.className') and not pg.evaluate("document.querySelector('.ng-tapmsg').hidden"))
            pg.evaluate('window.__ytp.start()'); pg.wait_for_timeout(400)
            check(tag + ': 點了之後恢復', 'tap' not in pg.evaluate(I + '.className') and 'on' in pg.evaluate(I + '.className'))
        else:
            check(tag + ': 播放中', 'on' in pg.evaluate(I + '.className'))
        pg.wait_for_timeout(4200)
        check(tag + ': 播到最後轉到地圖', pg.evaluate(I + '.hidden') and 'pause' in pg.evaluate('window.__yt.calls'))
        check(tag + ': 沒有錯誤', not errs, errs)
        ctx.close()
    b.close()
srv.shutdown()
os.remove(os.path.join(ROOT, 'map', '_yt.html'))
print('全部通過' if ok else '有失敗')
sys.exit(0 if ok else 1)
