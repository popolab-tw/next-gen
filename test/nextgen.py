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
open(os.path.join(ROOT, 'map', '_yten.html'), 'w', encoding='utf8').write(re.sub(r'window\.NEXTGEN = \{.*?\};', 'window.NEXTGEN = {"mv":{"yt":"TESTID","len":"3 分半","en":{"yt":"TESTEN","len":"3.5 min"}}};', html, count=1, flags=re.S))
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
  var self = this, t = 0, muted = false, dur = window.__ytDur || 3, iv = 0;
  var f = document.createElement('iframe'); el.parentNode.replaceChild(f, el); window.__yt.opts = o;
  this.getIframe = function () { return f; };
  this.start = function () { o.events.onStateChange({ data: 1 }); clearInterval(iv); iv = setInterval(function () { t += 0.2; if (t >= dur) { clearInterval(iv); o.events.onStateChange({ data: 0 }); } }, 200); };
  this.playVideo = function () { window.__yt.calls.push('play'); if (window.__ytErr) { setTimeout(function () { o.events.onError({ data: 150 }); }, 100); return; } if (!window.__ytBlock) self.start(); };
  this.pauseVideo = function () { window.__yt.calls.push('pause'); clearInterval(iv); o.events.onStateChange({ data: 2 }); };
  this.seekTo = function (s, ahead) { t = s; (window.__yt.seeks = window.__yt.seeks || []).push([Math.round(s * 10) / 10, !!ahead]); }; this.getCurrentTime = function () { return t; }; this.getDuration = function () { return dur; };
  this.cueVideoById = function (id) { window.__yt.calls.push('cue:' + id); }; this.loadVideoById = function (id) { window.__yt.calls.push('load:' + id); self.start(); };
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
    _nc = b.new_context
    def newctx(**kw): kw.setdefault('locale', 'zh-TW'); return _nc(**kw)   # 預設是中文瀏覽器（介面語言跟著瀏覽器）
    b.new_context = newctx
    for mode in ('desktop', 'mobile'):
        vw = (1440, 900) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script('window.__ac = 0; (function () { var A = window.AudioContext; if (A) window.AudioContext = function () { window.__ac++; return new A(); }; })();')
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
        # 不會自己播：點空白處、按其他鍵、選語言都不會開始
        if mode == 'mobile': pg.tap('.ng-title', position={'x': 195, 'y': 300})
        else: pg.mouse.click(300, 300); pg.keyboard.press('k'); pg.keyboard.press('Enter') if pg.evaluate("document.activeElement === document.body") else None
        pg.wait_for_timeout(700)
        check(mode + ': 點空白處、按其他鍵不會開始播', pg.evaluate("window.__ng.intro.state()") == 'title' and 'playing' not in pg.evaluate(I + '.className') and pg.evaluate("document.querySelector('.ng-file').paused"))
        pg.click('.ng-play') if mode == 'desktop' else pg.tap('.ng-play')
        pg.wait_for_timeout(1300)
        check(mode + ': 按「播放 MV」開始播放', 'on' in pg.evaluate(I + '.className') and pg.evaluate("document.querySelector('.ng-file').currentTime") > 0.2, pg.evaluate(I + '.className'))
        check(mode + ': 地圖在背後先載入', pg.evaluate("window.__ng.viz.ready()"))
        if mode == 'mobile': pg.tap('.ng-catch', position={'x': 100, 'y': 300})
        else: pg.mouse.move(300, 300); pg.mouse.move(320, 320)
        pg.wait_for_timeout(300)
        check(mode + ': 互動後出現「略過」', 'hud' in pg.evaluate(I + '.className'))
        check(mode + ': 互動後出現暫停鍵', pg.evaluate("getComputedStyle(document.querySelector('.ng-pause')).pointerEvents") == 'auto' and float(pg.evaluate("getComputedStyle(document.querySelector('.ng-pause')).opacity")) > 0.5 and pg.evaluate("document.querySelector('.ng-pause').getAttribute('aria-label')") == '暫停')
        pg.click('.ng-pause') if mode == 'desktop' else pg.tap('.ng-pause')
        pg.wait_for_timeout(300)
        t1 = pg.evaluate("document.querySelector('.ng-file').currentTime")
        check(mode + ': 按暫停鍵暫停', 'paused' in pg.evaluate(I + '.className') and pg.evaluate("document.querySelector('.ng-file').paused") and pg.evaluate("document.querySelector('.ng-pause').getAttribute('aria-label')") == '繼續播放')
        pg.wait_for_timeout(3600)
        check(mode + ': 暫停中控制列不收起、影片不動', 'hud' in pg.evaluate(I + '.className') and abs(pg.evaluate("document.querySelector('.ng-file').currentTime") - t1) < 0.05)
        pg.click('.ng-pause') if mode == 'desktop' else pg.tap('.ng-pause')
        pg.wait_for_timeout(400)
        check(mode + ': 再按一次繼續播放', 'paused' not in pg.evaluate(I + '.className') and not pg.evaluate("document.querySelector('.ng-file').paused"))
        if mode == 'desktop':
            pg.keyboard.press(' '); pg.wait_for_timeout(300)
            sp1 = pg.evaluate("document.querySelector('.ng-file').paused")
            pg.keyboard.press(' '); pg.wait_for_timeout(300)
            check('desktop: 空白鍵暫停、再按繼續', sp1 and not pg.evaluate("document.querySelector('.ng-file').paused") and pg.evaluate("window.__ng.intro.state()") == 'play')
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
        pg.evaluate('window.__ng.viz._bare(true)')
        pg.wait_for_timeout(5500)
        ev_ = pg.evaluate("({ hidden: document.getElementById('ng-intro').hidden, ended: document.getElementById('ng-intro').classList.contains('ended'), state: window.__ng.intro.state(), next: getComputedStyle(document.querySelector('.ng-next')).display, paused: document.querySelector('.ng-file').paused })")
        check(mode + ': 播完不自動轉場，出現「重播」與「進入地圖」', ev_ == {'hidden': False, 'ended': True, 'state': 'end', 'next': 'flex', 'paused': True}, ev_)
        pg.wait_for_timeout(900)
        pg.click('.ng-next') if mode == 'desktop' else pg.tap('.ng-next')
        pg.wait_for_timeout(250)
        rp_ = pg.evaluate("({ rings: document.querySelectorAll('.ng-ripples i').length, mask: document.getElementById('ng-intro').style.maskImage || document.getElementById('ng-intro').style.webkitMaskImage || '', ac: window.__ac })")
        check(mode + ': 按「進入地圖」：漣漪、圓形揭開、發出聲音', rp_['rings'] == 3 and 'radial-gradient' in rp_['mask'] and rp_['ac'] == 1, rp_)
        pg.wait_for_timeout(1600)
        pg.wait_for_timeout(600)
        check(mode + ': 漣漪之後轉到地圖（遮罩清掉）', pg.evaluate(I + '.hidden') and pg.evaluate("document.getElementById('ng-intro').style.maskImage") == '' and not pg.evaluate("document.documentElement.classList.contains('ng-lock')"))
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
        pg.click('.ng-play'); pg.wait_for_timeout(800)
        check(tag + ': 按下播放後才載入 API', pg.evaluate("!!window.__yt && window.__yt.calls.indexOf('play') >= 0"))
        if block:
            pg.wait_for_timeout(3300)
            check(tag + ': 3.5 秒沒開始 → 讓觀眾點播放器', 'tap' in pg.evaluate(I + '.className') and not pg.evaluate("document.querySelector('.ng-tapmsg').hidden"))
            pg.evaluate('window.__ytp.start()'); pg.wait_for_timeout(400)
            check(tag + ': 點了之後恢復', 'tap' not in pg.evaluate(I + '.className') and 'on' in pg.evaluate(I + '.className'))
        else:
            check(tag + ': 播放中', 'on' in pg.evaluate(I + '.className'))
            pg.mouse.move(300, 300); pg.mouse.move(320, 320); pg.wait_for_timeout(200)   # 電腦：滑鼠一動就叫出控制列
            pg.click('.ng-pause'); pg.wait_for_timeout(300)
            check(tag + ': 暫停鍵暫停 YouTube', 'paused' in pg.evaluate(I + '.className') and pg.evaluate('window.__yt.calls')[-1] == 'pause')
            pg.click('.ng-pause'); pg.wait_for_timeout(300)
            check(tag + ': 再按繼續', 'paused' not in pg.evaluate(I + '.className') and pg.evaluate('window.__yt.calls')[-1] == 'play' and 'on' in pg.evaluate(I + '.className'))
            pg.mouse.click(600, 200); pg.wait_for_timeout(200)
            c1 = 'hud' in pg.evaluate(I + '.className')
            pg.mouse.click(600, 200); pg.wait_for_timeout(200)
            check(tag + ': 電腦：點畫面收起控制列、再點出現', not c1 and 'hud' in pg.evaluate(I + '.className'))
        if block:
            pg.keyboard.press('Escape'); pg.wait_for_timeout(1400)
            check(tag + ': 略過後轉到地圖', pg.evaluate(I + '.hidden') and 'pause' in pg.evaluate('window.__yt.calls'))
            vols = pg.evaluate('window.__yt.vols')
            check(tag + ': 略過時音樂漸弱、之後恢復音量', len(vols) >= 5 and min(vols) <= 5 and any(10 < v < 90 for v in vols) and vols[-1] == 100, vols)
        else:
            pg.wait_for_timeout(4200)
            check(tag + ': 播完停在結束畫面（暫停在最後，不出現 YouTube 推薦影片）', not pg.evaluate(I + '.hidden') and pg.evaluate("window.__ng.intro.state()") == 'end' and pg.evaluate('window.__yt.calls')[-1] == 'pause')
            pg.wait_for_timeout(900)
            n0 = len(pg.evaluate('window.__yt.calls'))
            pg.click('.ng-replay'); pg.wait_for_timeout(500)
            check(tag + ': 「重播」從頭播放', pg.evaluate("window.__ng.intro.state()") == 'play' and 'ended' not in pg.evaluate(I + '.className') and pg.evaluate('window.__yt.calls')[n0:] == ['play'] and pg.evaluate('window.__ytp.getCurrentTime()') < 0.7)
            pg.wait_for_timeout(4200)
            check(tag + ': 重播完再停在結束畫面', pg.evaluate("window.__ng.intro.state()") == 'end')
            pg.wait_for_timeout(900)
            pg.keyboard.press('Enter'); pg.wait_for_timeout(1900)
            check(tag + ': 「進入地圖」預設已選取，按 Enter 就轉到地圖', pg.evaluate(I + '.hidden') and pg.evaluate("window.__ng.intro.state()") == 'done')
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
    # 控制列收起後：暫停鍵與「略過」點不到（手機上點一下是叫出控制列，不會誤按）
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1500)
    pg.evaluate('window.__ng.viz._bare(true)')
    pg.tap('.ng-play'); pg.wait_for_timeout(4200)
    pe = pg.evaluate("[getComputedStyle(document.querySelector('.ng-pause')).pointerEvents, getComputedStyle(document.querySelector('.ng-hud')).pointerEvents, document.querySelector('#ng-intro').className]")
    check('手機：控制列收起時，暫停鍵和略過點不到', pe[0] == 'none' and pe[1] == 'none' and 'hud' not in pe[2], pe)
    sk = pg.evaluate("(() => { const r = document.querySelector('.ng-skip').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    pg.touchscreen.tap(sk[0], sk[1]); pg.wait_for_timeout(1300)
    check('手機：點到隱形的「略過」位置只會叫出控制列', not pg.evaluate(I + '.hidden') and 'hud' in pg.evaluate(I + '.className'))
    def hudOn(): return pg.evaluate("[document.getElementById('ng-intro').classList.contains('hud'), getComputedStyle(document.querySelector('.ng-pause')).pointerEvents, getComputedStyle(document.querySelector('.ng-hud')).pointerEvents]")
    pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    h1 = hudOn()
    pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    h2 = hudOn()
    check('手機：控制列在畫面上時再點一下就收起，再點又出現', h1 == [False, 'none', 'none'] and h2 == [True, 'auto', 'auto'], (h1, h2))
    pg.tap('.ng-pause'); pg.wait_for_timeout(300)
    pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    h3 = hudOn()
    pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    h4 = hudOn()
    check('手機：暫停中也可以點畫面收起、再叫出控制列', 'paused' in pg.evaluate(I + '.className') and h3[0] is False and h4[0] is True, (h3, h4))
    pg.tap('.ng-pause'); pg.wait_for_timeout(300)
    check('手機：叫出來後可以繼續播放', 'paused' not in pg.evaluate(I + '.className') and pg.evaluate('window.__yt.calls')[-1] == 'play')
    # 橫向全螢幕：按鈕在播放器的控制列裡也有
    check('手機：控制列有「橫向全螢幕」', pg.evaluate("document.querySelector('.ng-fs span').textContent") in ('橫向全螢幕', '橫向播放'))
    pg.tap('.ng-fs'); pg.wait_for_timeout(700)
    lv = pg.evaluate("(() => { const v = document.querySelector('.ng-vp'), r = v.getBoundingClientRect(); return { land: window.__ng.intro.land(), rot: document.getElementById('ng-intro').classList.contains('rot'), w: v.offsetWidth, h: v.offsetHeight, bw: Math.round(r.width), bh: Math.round(r.height), tf: getComputedStyle(v).transform, fs: !!document.fullscreenElement, label: document.querySelector('.ng-fs span').textContent }; })()")
    check('手機：橫向播放（畫面直的時把播放畫面轉 90 度、塞滿螢幕）', lv['land'] and lv['rot'] and lv['w'] == 844 and lv['h'] == 390 and lv['bw'] == 390 and lv['bh'] == 844 and lv['tf'] != 'none', lv)
    check('手機：全螢幕中按鈕改成「離開全螢幕」', lv['label'] in ('離開全螢幕', '直向播放'), lv)
    if 'hud' not in pg.evaluate(I + '.className'): pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(200)
    pg.tap('.ng-fs'); pg.wait_for_timeout(500)
    lv2 = pg.evaluate("({ land: window.__ng.intro.land(), rot: document.getElementById('ng-intro').classList.contains('rot'), st: document.querySelector('.ng-vp').style.cssText, fs: !!document.fullscreenElement })")
    check('手機：離開橫向，回到原本的畫面', not lv2['land'] and not lv2['rot'] and lv2['st'] == '' and not lv2['fs'], lv2)
    check('手機（YouTube）：沒有錯誤', not errs, errs)
    ctx.close()
    # 標題畫面的「橫向全螢幕播放」：直接橫向播放；略過後回到直向、離開全螢幕
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1800)
    check('手機：標題畫面有「橫向全螢幕播放」', pg.evaluate("document.querySelector('.ng-landbtn').offsetParent !== null") and pg.evaluate("document.querySelector('.ng-landbtn').innerText.trim()") in ('橫向全螢幕播放', '橫向播放'))
    pg.tap('.ng-landbtn'); pg.wait_for_timeout(900)
    check('手機：按下就橫向播放', 'on' in pg.evaluate(I + '.className') and pg.evaluate('window.__ng.intro.land()') and pg.evaluate("document.getElementById('ng-intro').classList.contains('rot')"))
    pg.evaluate("document.querySelector('.ng-skip').click()"); pg.wait_for_timeout(2000)
    lv3 = pg.evaluate("({ hidden: document.getElementById('ng-intro').hidden, land: window.__ng.intro.land(), fs: document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.className), st: document.querySelector('.ng-vp').style.cssText })")
    check('手機：略過後回到直向、離開全螢幕', lv3 == {'hidden': True, 'land': False, 'fs': None, 'st': ''}, lv3)
    check('手機（橫向）：沒有錯誤', not errs, errs)
    ctx.close()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1800)
    pg.evaluate('window.__ng.viz._bare(true)')
    pg.tap('.ng-landbtn'); pg.wait_for_timeout(900)
    pg.evaluate('window.__ng.intro._end()'); pg.wait_for_timeout(1700)
    eb = pg.evaluate("(() => { const r = document.querySelector('.ng-next').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), rot: document.getElementById('ng-intro').classList.contains('rot') }; })()")
    check('手機橫向播完：結束畫面跟著轉 90 度', eb['rot'] and eb['w'] > eb['h'], eb)   # 按鈕本身是直的（圓圈在上、字在下），轉 90 度後變成橫的
    pg.tap('.ng-next'); pg.wait_for_timeout(2600)
    lv4 = pg.evaluate("({ hidden: document.getElementById('ng-intro').hidden, land: window.__ng.intro.land(), fs: !!document.fullscreenElement, st: document.querySelector('.ng-vp').style.cssText })")
    check('手機橫向播完：進入地圖後回到直向、離開全螢幕', lv4 == {'hidden': True, 'land': False, 'fs': False, 'st': ''}, lv4)
    check('手機橫向播完：沒有錯誤', not errs, errs)
    ctx.close()
    # 電腦：標題畫面是「全螢幕播放」，不轉 90 度
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1800)
    check('電腦：標題畫面是「全螢幕播放」', pg.evaluate("document.querySelector('.ng-landbtn').innerText.trim()") == '全螢幕播放')
    pg.click('.ng-landbtn'); pg.wait_for_timeout(900)
    check('電腦：全螢幕播放、不轉 90 度', 'on' in pg.evaluate(I + '.className') and pg.evaluate('window.__ng.intro.land()') and not pg.evaluate("document.getElementById('ng-intro').classList.contains('rot')"))
    check('電腦（全螢幕）：沒有錯誤', not errs, errs)
    ctx.close()
    # 進度條：點一下、拖曳、方向鍵跳轉（電腦）
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1500)
    pg.evaluate('window.__ng.viz._bare(true)')
    pg.click('.ng-play'); pg.wait_for_timeout(700)
    pg.mouse.move(400, 300); pg.mouse.move(420, 320); pg.wait_for_timeout(300)
    tr = pg.evaluate("(() => { const r = document.querySelector('.ng-track').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()")
    pg.mouse.move(tr[0] + tr[2] * 0.1, tr[1]); pg.mouse.down(); pg.mouse.move(tr[0] + tr[2] * 0.3, tr[1], steps=4); pg.mouse.move(tr[0] + tr[2] * 0.5, tr[1], steps=4); pg.mouse.up(); pg.wait_for_timeout(300)
    sk = pg.evaluate('window.__yt.seeks'); t = pg.evaluate('window.__ytp.getCurrentTime()')
    check('電腦：拖曳進度條跳到 50%（放開時才完整跳轉）', 29 <= t <= 31.5 and sk[-1][1] is True and any(not a for _, a in sk[:-1]), (t, sk))
    check('電腦：時間顯示跟著更新', pg.evaluate("document.querySelector('.ng-tm-c').textContent") in ('0:30', '0:31') and pg.evaluate("document.querySelector('.ng-tm-d').textContent") == '1:00')
    pg.mouse.click(tr[0] + tr[2] * 0.25, tr[1]); pg.wait_for_timeout(300)
    t = pg.evaluate('window.__ytp.getCurrentTime()')
    check('電腦：點一下進度條跳到 25%', 14.5 <= t <= 16, t)
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200)
    t2 = pg.evaluate('window.__ytp.getCurrentTime()')
    check('電腦：方向鍵 → 快轉 5 秒', 4.5 <= t2 - t <= 5.8, (t, t2))
    pg.mouse.click(tr[0] + tr[2] * 0.995, tr[1]); pg.wait_for_timeout(100)
    t3 = pg.evaluate('window.__yt.seeks')[-1][0]
    check('電腦：跳到最後時留一點播完、接上結束畫面', t3 == 59.4 and pg.evaluate("window.__ng.intro.state()") == 'play', t3)
    pg.wait_for_timeout(1300)
    check('電腦：播完後出現結束畫面', pg.evaluate("window.__ng.intro.state()") == 'end')
    check('電腦（進度條）：沒有錯誤', not errs, errs)
    ctx.close()
    # 進度條：手機、橫向（轉 90 度）時點一下跳轉
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.add_init_script('window.__ytDur = 60;')
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1500)
    pg.evaluate('window.__ng.viz._bare(true)')
    pg.tap('.ng-play'); pg.wait_for_timeout(700)
    pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    tr = pg.evaluate("(() => { const r = document.querySelector('.ng-track').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.width]; })()")
    pg.touchscreen.tap(tr[0] + tr[2] * 0.75, tr[1]); pg.wait_for_timeout(300)
    t = pg.evaluate('window.__ytp.getCurrentTime()')
    check('手機：點進度條跳到 75%', 44 <= t <= 46.5 and not pg.evaluate(I + '.hidden'), t)
    pg.tap('.ng-fs'); pg.wait_for_timeout(700)
    if 'hud' not in pg.evaluate(I + '.className'): pg.tap('.ng-catch', position={'x': 100, 'y': 300}); pg.wait_for_timeout(300)
    rr = pg.evaluate("(() => { const r = document.querySelector('.ng-track').getBoundingClientRect(); return [r.left + r.width / 2, r.top, r.height, document.getElementById('ng-intro').classList.contains('rot')]; })()")
    pg.touchscreen.tap(rr[0], rr[1] + rr[2] * 0.2); pg.wait_for_timeout(300)
    t = pg.evaluate('window.__ytp.getCurrentTime()')
    check('手機橫向（轉 90 度）：點進度條跳到 20%', rr[3] and rr[2] > 200 and 11 <= t <= 13.5, (t, rr))
    check('手機（進度條）：沒有錯誤', not errs, errs)
    ctx.close()
    # 地圖全螢幕：手機橫放時，按鈕列和圖例都在畫面裡
    ctx = b.new_context(viewport={'width': 844, 'height': 390}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', route)
    pg.goto(BASE + '_nomv.html'); pg.wait_for_timeout(2000)
    pg.tap('.vz-ctl .vz-btn[aria-label="全螢幕"]'); pg.wait_for_timeout(600)
    fv = pg.evaluate("""(() => { const H = innerHeight, W = innerWidth, inV = e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= H + 0.5 && r.left >= 0 && r.right <= W + 0.5; };
      return { full: document.querySelector('.vz-body').classList.contains('vz-full'), btns: [...document.querySelectorAll('.vz-ctl .vz-btn')].every(inV), legend: inV(document.querySelector('.vz-legend')), tabs: inV(document.querySelector('.vz-filters')), H }; })()""")
    check('地圖全螢幕（手機橫放）：按鈕列、圖例、分法列都在畫面裡', fv['full'] and fv['btns'] and fv['legend'] and fv['tabs'], fv)
    pg.tap('.vz-ctl .vz-btn[aria-label="離開全螢幕"]'); pg.wait_for_timeout(1000)
    fx = pg.evaluate("({ full: document.querySelector('.vz-body').classList.contains('vz-full'), fs: document.fullscreenElement && (document.fullscreenElement.id || document.fullscreenElement.className) })")
    check('地圖全螢幕：可以離開', fx == {'full': False, 'fs': None}, fx)
    check('地圖全螢幕：沒有錯誤', not errs, errs)
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
    # ---- 語言：開場畫面就能換；英文介面播英文版 MV；地圖的文字跟著換 ----
    for mode in ('desktop', 'mobile'):
        vw = (1280, 800) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script('window.__ytDur = 60;')
        pg.route('**/*', route); del API[:]
        tap = (lambda sel: pg.click(sel)) if mode == 'desktop' else (lambda sel: pg.tap(sel))
        pg.goto(BASE + '_yten.html'); pg.wait_for_timeout(1500)
        tag = '語言 ' + mode
        check(tag + ': 中文瀏覽器預設中文', pg.evaluate("document.documentElement.lang") == 'zh-Hant-TW' and pg.evaluate("document.querySelector('.ng-play-t').textContent") == '播放 MV' and pg.evaluate("document.querySelector('[data-lang-pick=zh]').getAttribute('aria-pressed')") == 'true')
        tap('[data-lang-pick=en]'); pg.wait_for_timeout(300)
        ti = pg.evaluate("({ lang: document.documentElement.lang, play: document.querySelector('.ng-play-t').textContent, sub: document.querySelector('.ng-play-s').textContent, skip: document.querySelector('.ng-skipall').textContent, land: document.querySelector('.ng-landbtn').innerText.trim(), state: window.__ng.intro.state(), saved: localStorage.getItem('ng:lang'), title: document.title, pressed: document.querySelector('[data-lang-pick=en]').getAttribute('aria-pressed'), src: document.getElementById('ng-yt-frame').src })")
        check(tag + ': 開場按 EN：文字換成英文、還沒開始播、記住選擇', ti['lang'] == 'en' and ti['play'] == 'Play MV' and 'about 3.5 min' in ti['sub'] and ti['skip'].startswith('Skip the MV') and ti['land'].startswith('Play fullscreen') and ti['state'] == 'title' and ti['saved'] == 'en' and ti['title'].startswith('NEXT GEN · ') and ti['pressed'] == 'true', ti)
        check(tag + ': 英文介面換成英文版 MV（還沒按播放，不載入 YouTube API）', '/embed/TESTEN?' in ti['src'] and not API, (ti['src'], API))
        tap('[data-lang-pick=zh]'); pg.wait_for_timeout(300)
        check(tag + ': 換回中文：文字與 MV 都換回來', pg.evaluate("document.querySelector('.ng-play-t').textContent") == '播放 MV' and '/embed/TESTID?' in pg.evaluate("document.getElementById('ng-yt-frame').src") and pg.evaluate("document.querySelector('.ng-skipall').textContent").startswith('略過'))
        tap('[data-lang-pick=en]'); pg.wait_for_timeout(200)
        pg.evaluate('window.__ng.viz._bare(true)')
        tap('.ng-play'); pg.wait_for_timeout(800)
        check(tag + ': 英文介面按播放：播英文版', 'on' in pg.evaluate(I + '.className') and len(API) == 1)
        if mode == 'mobile': pg.tap('.ng-catch', position={'x': 100, 'y': 300})
        else: pg.mouse.move(300, 300); pg.mouse.move(320, 320)
        pg.wait_for_timeout(250)
        hud = pg.evaluate("({ mute: document.querySelector('.ng-mute span').textContent, fs: document.querySelector('.ng-fs span').textContent, skip: document.querySelector('.ng-skip').textContent.trim(), pause: document.querySelector('.ng-pause').getAttribute('aria-label') })")
        check(tag + ': 播放中的控制列是英文', hud['mute'] == 'Mute' and hud['skip'] == 'Skip MV' and hud['pause'] == 'Pause' and hud['fs'] in ('Fullscreen', 'Landscape'), hud)
        pg.keyboard.press('Escape') if mode == 'desktop' else pg.evaluate("document.querySelector('.ng-skip').click()")
        pg.wait_for_function("document.getElementById('ng-intro').hidden", timeout=6000)
        pg.wait_for_timeout(600)
        mp = pg.evaluate("({ chips: [...document.querySelectorAll('.vz-chip')].map(c => c.textContent), legend: document.querySelector('.vz-lg-t').textContent, tilt: document.querySelector('.vz-ctl .vz-txt').textContent, set: document.querySelector('.vz-ctl .vz-btn:not(.vz-txt)').getAttribute('aria-label'), mvbtn: document.getElementById('ng-mvbtn').title, head: document.querySelector('.ng-sub').textContent, lede: document.querySelector('.ng-lede').textContent.slice(0, 9) })")
        check(tag + ': 地圖與頁面是英文', mp['chips'][:3] == ['Map', 'Age', 'Housing'] and mp['legend'] == 'Threshold %ile' and mp['tilt'] == 'Tilt-shift' and mp['set'] == 'Display settings' and mp['mvbtn'] == 'Replay the MV' and mp['head'] == 'Parenthood threshold' and mp['lede'] == 'Each dot ', mp)
        pg.evaluate("window.__ng.viz.setFilter('age')"); pg.wait_for_timeout(500)
        lb = pg.evaluate("[...document.querySelectorAll('.vz-lbl b')].map(b => b.textContent)")
        check(tag + ': 切片名稱是英文', 'Ages 30–34' in lb, lb)
        pg.evaluate("window.__ng.viz.show(0)"); pg.wait_for_timeout(200)
        ct = pg.evaluate("document.querySelector('.vz-card').textContent")
        check(tag + ': 資訊卡是英文（縣市用英文名）', 'Threshold' in ct and not re.search('[\u4e00-\u9fff]', ct), ct)
        # 頁首的語言按鈕：換回中文，地圖上的字跟著換（資訊卡、切片名稱、圖例）
        tap('#ng-lang'); pg.wait_for_timeout(400)
        zh = pg.evaluate("({ lang: document.documentElement.lang, lbl: [...document.querySelectorAll('.vz-lbl:not(.out) b')].map(b => b.textContent), card: document.querySelector('.vz-card').textContent, legend: document.querySelector('.vz-lg-t').textContent, chip: document.querySelector('.vz-chip.on').textContent, btn: document.getElementById('ng-lang').textContent, calls: window.__yt.calls })")
        check(tag + ': 頁首按鈕換回中文：地圖文字立刻換', zh['lang'] == 'zh-Hant-TW' and '30–34 歲' in zh['lbl'] and '門檻 PR' in zh['card'] and zh['legend'] == '門檻 PR' and zh['chip'] == '年齡層' and zh['btn'] == 'EN', zh)
        check(tag + ': 已經接上播放器後換語言：改放那個語言的 MV（停在開頭）', zh['calls'][-1] == 'cue:TESTID', zh['calls'][-3:])
        pg.goto(BASE + '_yten.html?lang=en'); pg.wait_for_timeout(1200)
        check(tag + ': 網址 ?lang=en 直接是英文', pg.evaluate("document.documentElement.lang") == 'en' and pg.evaluate("document.querySelector('.vz-chip').textContent") == 'Map')
        check(tag + ': 沒有錯誤', not errs, errs)
        ctx.close()
    # 英文瀏覽器：預設英文；英文版 MV 還沒有時播中文版，標題畫面註明
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}, locale='en-US')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1300)
    check('英文瀏覽器：預設英文、沒有英文版 MV 時播中文版並註明', pg.evaluate("document.documentElement.lang") == 'en' and 'Chinese version' in pg.evaluate("document.querySelector('.ng-play-s').textContent") and '/embed/TESTID?' in pg.evaluate("document.getElementById('ng-yt-frame').src"))
    check('英文瀏覽器：沒有錯誤', not errs, errs)
    ctx.close()
    # ---- 操作說明：第一次進到地圖時浮出來；碰一下地圖就收起；右上角可以再叫出來 ----
    for mode in ('desktop', 'mobile'):
        vw = (1440, 900) if mode == 'desktop' else (390, 844)
        ctx = b.new_context(viewport={'width': vw[0], 'height': vw[1]}, has_touch=mode == 'mobile', is_mobile=mode == 'mobile')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/*', route)
        pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1200)
        tag = '操作說明 ' + mode
        check(tag + ': 開場時還沒出現', not pg.evaluate("!!document.querySelector('.vz-guide.on')"))
        pg.click('.ng-skipall') if mode == 'desktop' else pg.tap('.ng-skipall')
        pg.wait_for_timeout(1500)
        check(tag + ': 地圖轉進來的途中還沒出現', not pg.evaluate("!!document.querySelector('.vz-guide.on')"))
        pg.wait_for_function("!!document.querySelector('.vz-guide.on')", timeout=8000)
        pg.wait_for_timeout(1300)
        g = pg.evaluate("""(() => { const g = document.querySelector('.vz-guide'), st = document.querySelector('.vz-stage').getBoundingClientRect(), r = e => e.getBoundingClientRect(), inS = e => { const b = r(e); return b.left >= st.left - 1 && b.right <= st.right + 1 && b.top >= st.top - 1 && b.bottom <= st.bottom + 1; };
          const set = r(document.querySelector('.vz-ctl .vz-btn:not(.vz-txt)')), dn = r(document.querySelector('.vz-g-dn')), up = r(document.querySelector('.vz-g-up')), bar = r(document.querySelector('.vz-filters'));
          return { pe: getComputedStyle(g).pointerEvents, op: +getComputedStyle(g).opacity, items: [...g.querySelectorAll('.vz-g-it b')].map(b => b.textContent), anim: getComputedStyle(g.querySelector('.vz-g-it')).animationName,
            inside: [...g.querySelectorAll('.vz-g-mid, .vz-g-up, .vz-g-dn')].every(inS), dnAbove: dn.bottom <= set.top, upBelow: up.top >= bar.bottom, help: getComputedStyle(document.querySelector('.vz-help')).opacity, seen: localStorage.getItem('ng:guide') }; })()""")
        want = ['單指拖曳', '雙指開合', '雙指拖曳', '點一下光點'] if mode == 'mobile' else ['拖曳', '滾輪', '右鍵拖曳', '點一下光點']
        check(tag + ': 淡淡浮出手勢示範（' + ('觸控' if mode == 'mobile' else '滑鼠') + '）', g['items'] == want and g['anim'] == 'vzgIt' and g['op'] > 0.9 and g['pe'] == 'none' and g['seen'] == '1', g)
        check(tag + ': 標註在地圖裡，分別指向分法列和設定按鈕', g['inside'] and g['dnAbove'] and g['upBelow'], g)
        cv = pg.evaluate("(() => { const r = document.querySelector('.vz-canvas').getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height * 0.3]; })()")
        if mode == 'mobile': pg.touchscreen.tap(cv[0], cv[1])
        else: pg.mouse.move(cv[0], cv[1]); pg.mouse.down(); pg.mouse.move(cv[0] + 60, cv[1], steps=5); pg.mouse.up()
        pg.wait_for_timeout(1000)
        check(tag + ': 碰一下地圖就收起，右上角有「操作說明」', not pg.evaluate("!!document.querySelector('.vz-guide.on')") and pg.evaluate("document.querySelector('.vz-guide').hidden") and float(pg.evaluate("getComputedStyle(document.querySelector('.vz-help')).opacity")) > 0.9)
        pg.click('.vz-help') if mode == 'desktop' else pg.tap('.vz-help')
        pg.wait_for_timeout(1300)
        check(tag + ': 按「操作說明」再出現', pg.evaluate("!!document.querySelector('.vz-guide.on')"))
        pg.click('.vz-help') if mode == 'desktop' else pg.tap('.vz-help')
        pg.wait_for_timeout(1200)
        check(tag + ': 再按一次收起（手機上不會被同一下點到又打開）', not pg.evaluate("!!document.querySelector('.vz-guide.on')") and pg.evaluate("document.querySelector('.vz-help').getAttribute('aria-pressed')") == 'false')
        pg.goto(BASE + '_yt.html?again=1#map'); pg.wait_for_timeout(4000)
        check(tag + ': 看過之後不再自己出現', not pg.evaluate("!!document.querySelector('.vz-guide.on')"))
        check(tag + ': 沒有錯誤', not errs, errs)
        ctx.close()
    # 地圖轉進來途中就開始操作：這次不跳出操作說明
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/*', route)
    pg.goto(BASE + '_yt.html'); pg.wait_for_timeout(1200)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(1600)
    check('標題畫面按 Esc：略過 MV 看地圖', pg.evaluate(I + '.hidden'))
    pg.mouse.move(640, 400); pg.mouse.down(); pg.mouse.move(700, 420, steps=4); pg.mouse.up()
    pg.wait_for_timeout(3500)
    check('轉進來途中就開始拖：不跳出操作說明', not pg.evaluate("!!document.querySelector('.vz-guide.on')") and pg.evaluate("localStorage.getItem('ng:guide')") is None)
    check('（略過途中操作）沒有錯誤', not errs, errs)
    ctx.close()
    b.close()
srv.shutdown()
for f in ('_yt.html', '_yten.html', '_file.html', '_nomv.html', '_ext.html'): os.remove(os.path.join(ROOT, 'map', f))
print('全部通過' if ok else '有失敗')
sys.exit(0 if ok else 1)
