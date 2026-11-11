/* =========================================================================
   NG — NEXT GEN 網站：開場標題 → MV → 轉場到 3D 台灣
   ・標題畫面：點一下或按任意鍵才播 MV（有聲音的影片要先有一次點擊，瀏覽器才肯播）
   ・播放中：動滑鼠、點一下或按任意鍵 → 顯示「略過」；Esc 直接略過
   ・MV 播完或略過 → 畫面淡出，地圖從高處轉進預設視角
   ・MV 來源：YouTube（隱私強化模式）或網站上的影片檔，設定在 window.NEXTGEN.mv
   ========================================================================= */
var NG = (function () {
  'use strict';
  var h = U.h;
  var CFG = window.NEXTGEN || {};
  var KEY_THEME = 'ng:theme', KEY_SEEN = 'ng:seen';

  // ---------- 深淺色：NEXT GEN 預設深色；自己記住，不影響遊戲網站 ----------
  function getTheme() { var t = document.documentElement.getAttribute('data-theme'); return t === 'light' ? 'light' : 'dark'; }
  function setTheme(t, keep) {
    document.documentElement.setAttribute('data-theme', t);
    if (keep) { try { localStorage.setItem(KEY_THEME, t); } catch (e) { /* 忽略 */ } }
    try { [].forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { m.setAttribute('content', t === 'dark' ? '#050506' : '#ffffff'); }); } catch (e) { /* 忽略 */ }
    var b = document.getElementById('ng-theme'); if (b) { b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); b.title = t === 'dark' ? '換成淺色' : '換成深色'; }
  }
  function initTheme() { var t = null; try { t = localStorage.getItem(KEY_THEME); } catch (e) { /* 忽略 */ } setTheme(t === 'light' ? 'light' : 'dark', false); }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }

  // ---------- 音量漸弱：略過或播完時，音樂跟著畫面淡出；停下後恢復原本音量，重播才有聲音 ----------
  // get／set 的音量是 0–1；音量照平方遞減，聽起來比直線遞減平順（直線的話前段幾乎聽不出變小）
  function fader(get, set) {
    var t = 0, v0 = null;
    return {
      out: function (ms) {
        clearInterval(t);
        if (v0 == null) { try { v0 = get(); } catch (e) { v0 = 1; } if (!(v0 >= 0)) v0 = 1; }
        var a = v0, t0 = Date.now();
        t = setInterval(function () { var k = Math.min(1, (Date.now() - t0) / ms); try { set(a * (1 - k) * (1 - k)); } catch (e) { /* 忽略 */ } if (k >= 1) clearInterval(t); }, 40);
      },
      restore: function () { clearInterval(t); if (v0 != null) { try { set(v0); } catch (e) { /* 忽略 */ } v0 = null; } }
    };
  }

  // ---------- 播放器：YouTube 或影片檔，對外介面一樣 ----------
  // ev: { playing, waiting, ended, error, time(cur, dur) }
  function filePlayer(host, mv, ev) {
    var v = h('video', { class: 'ng-file', playsinline: '', preload: 'metadata' });
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    var big = (Math.max(screen.width, screen.height) >= 1100) && !(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    try { if (navigator.connection && navigator.connection.saveData) big = false; } catch (e) { /* 忽略 */ }
    var list = [].concat(mv.src || []), src = (big && mv.srcHi) || list[0];
    v.src = src;
    host.appendChild(v);
    v.addEventListener('playing', function () { ev.playing(); });
    v.addEventListener('waiting', function () { ev.waiting(); });
    v.addEventListener('ended', function () { ev.ended(); });
    v.addEventListener('error', function () { ev.error('file'); });
    v.addEventListener('timeupdate', function () { ev.time(v.currentTime, v.duration || 0); });
    var fd = fader(function () { return v.volume; }, function (x) { v.volume = Math.max(0, Math.min(1, x)); });
    return {
      ready: function () { return true; },
      play: function () { var p = v.play(); if (p && p.catch) p.catch(function () { v.muted = true; ev.muted(true); v.play().catch(function () { ev.error('blocked'); }); }); },
      fade: function (ms) { fd.out(ms); },
      stop: function () { try { v.pause(); v.currentTime = 0; } catch (e) { /* 忽略 */ } fd.restore(); },
      mute: function (m) { v.muted = m; },
      muted: function () { return v.muted; },
      native: function () { return false; }
    };
  }
  var ytApi = null;
  function loadYT() {
    if (ytApi) return ytApi;
    ytApi = new Promise(function (ok, no) {
      if (window.YT && window.YT.Player) { ok(window.YT); return; }
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) try { prev(); } catch (e) { /* 忽略 */ } ok(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = function () { no(new Error('yt-api')); };
      document.head.appendChild(s);
      setTimeout(function () { no(new Error('yt-timeout')); }, 12000);
    });
    return ytApi;
  }
  function ytWatch(mv) { return 'https://youtu.be/' + encodeURIComponent(mv.yt); }
  // 隱私強化模式：網頁打開時只先放 youtube-nocookie.com 的播放器（這一步不會設定 cookie）。
  // 控制播放器的 YouTube API 只能從 youtube.com 載入，而且會設定 cookie，所以等觀眾按下播放才載入。
  function ytPlayer(host, mv, ev) {
    var q = { enablejsapi: 1, autoplay: 0, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, cc_load_policy: 0, modestbranding: 1 };
    if (/^https?:$/.test(location.protocol)) q.origin = location.origin;
    var src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(mv.yt) + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
    var box = h('div', { class: 'ng-yt' });
    var frame = h('iframe', { id: 'ng-yt-frame', src: src, title: 'NEXT GEN MV', tabindex: '-1', allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin' });
    box.appendChild(frame); host.appendChild(box);
    var P = null, isReady = false, want = false, poll = 0, failed = false, started = false;
    function tick() { if (!P || !P.getCurrentTime) return; var c = P.getCurrentTime() || 0, d = P.getDuration() || 0; ev.time(c, d); }
    function fail(why) { if (failed) return; failed = true; clearInterval(poll); ev.error(why); }
    var fd = fader(function () { return P.getVolume() / 100; }, function (x) { P.setVolume(Math.round(Math.max(0, Math.min(1, x)) * 100)); });
    function attach() {
      if (started) return; started = true;
      setTimeout(function () { if (!isReady) fail('yt-timeout'); }, 15000);
      loadYT().then(function (YT) {
        P = new YT.Player(frame, {
          events: {
            onReady: function () { isReady = true; if (failed) return; if (want) { P.playVideo(); if (P.isMuted && P.isMuted()) ev.muted(true); } },
            onStateChange: function (e) {
              if (e.data === 1) { ev.playing(); clearInterval(poll); poll = setInterval(tick, 200); }
              else if (e.data === 3) ev.waiting();
              else if (e.data === 0) { clearInterval(poll); ev.ended(); }
              else if (e.data === 2) clearInterval(poll);
            },
            onError: function (e) { fail('yt-' + (e && e.data)); }
          }
        });
      }).catch(function () { fail('yt-api'); });
    }
    return {
      ready: function () { return isReady; },
      failed: function () { return failed; },
      play: function () { want = true; attach(); if (isReady) { P.playVideo(); if (P.isMuted && P.isMuted()) ev.muted(true); } },
      fade: function (ms) { if (isReady && !failed) fd.out(ms); },
      stop: function () { want = false; clearInterval(poll); if (isReady) { try { P.pauseVideo(); P.seekTo(0, true); } catch (e) { /* 忽略 */ } fd.restore(); } },
      mute: function (m) { if (isReady) { if (m) P.mute(); else P.unMute(); } },
      muted: function () { return isReady && P.isMuted ? P.isMuted() : false; },
      native: function (on) { box.classList.toggle('tap', !!on); }   // 手機擋自動播放時，改讓觀眾直接點 YouTube 的播放鍵
    };
  }

  // ---------- 開場 ----------
  function intro(viz) {
    var mv = CFG.mv || {};
    var root = document.getElementById('ng-intro');
    if (!root) return { open: function () {} };
    var title = root.querySelector('.ng-title'), stageEl = root.querySelector('.ng-mv'), hud = root.querySelector('.ng-hud');
    var skipBtn = root.querySelector('.ng-skip'), muteBtn = root.querySelector('.ng-mute'), bar = root.querySelector('.ng-prog i'), tapMsg = root.querySelector('.ng-tapmsg');
    var playBtn = root.querySelector('.ng-play'), skipAll = root.querySelector('.ng-skipall');
    var state = 'title', hudT = 0, startT = 0, player = null, nearEnd = false;
    var has = !!(mv.yt || mv.src);
    // ext：MV 不在這頁播，改到 YouTube 新分頁看（claude.ai 預覽版不能內嵌 YouTube；正式網站播放失敗時也改成這樣）
    var ext = !!(mv.yt && mv.ext);
    var ev = {
      playing: function () { root.classList.add('on'); root.classList.remove('wait', 'tap'); clearTimeout(startT); player.native(false); tapMsg.hidden = true; syncMute(); },
      waiting: function () { root.classList.add('wait'); },
      ended: function () { done(); },
      error: function (why) { if (mv.yt) setExt(); if (state === 'play') done('fail'); else if (state === 'title' && !mv.yt) noMv(); },
      muted: function () { syncMute(); },
      time: function (c, d) {
        if (d > 0) { bar.style.transform = 'scaleX(' + Math.min(1, c / d).toFixed(4) + ')'; if (!nearEnd && d - c < 0.35) { nearEnd = true; done(); } }   // 搶在 YouTube 片尾畫面出現前轉場
      }
    };
    if (ext) setExt();
    else if (has) player = mv.yt ? ytPlayer(stageEl, mv, ev) : filePlayer(stageEl, mv, ev);
    else noMv();
    function noMv() { root.classList.add('nomv'); playBtn.querySelector('.ng-play-t').textContent = '進入地圖'; }
    function setExt() {
      ext = true; root.classList.add('ext');
      [].forEach.call(playBtn.querySelectorAll('.k-key, .k-tap'), function (s) { s.textContent = '到 YouTube 看 MV'; });
      playBtn.querySelector('.ng-play-s').textContent = '在新分頁開啟' + (mv.len ? '・約 ' + mv.len : '');
      var b = document.getElementById('ng-mvbtn'); if (b) { b.title = '到 YouTube 看 MV（新分頁）'; b.setAttribute('aria-label', b.title); }
    }
    function openYT() { try { window.open(ytWatch(mv), '_blank', 'noopener'); } catch (e) { /* 忽略 */ } }

    function lock(on) { document.documentElement.classList.toggle('ng-lock', on); }
    function showHud() {
      if (state !== 'play') return;
      root.classList.add('hud'); clearTimeout(hudT);
      hudT = setTimeout(function () { root.classList.remove('hud'); }, 3200);
    }
    function syncMute() { if (!player) return; var m = player.muted(); muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false'); muteBtn.querySelector('span').textContent = m ? '開聲音' : '靜音'; }
    function play() {
      if (state !== 'title') return;
      if (ext) { openYT(); done(); return; }
      if (!has || (player.failed && player.failed())) { done(); return; }
      state = 'play'; nearEnd = false;
      root.classList.add('playing', 'wait'); root.classList.remove('on');
      bar.style.transform = 'scaleX(0)';
      player.play();
      // 3.5 秒還沒開始：可能是手機擋了自動播放 → 讓觀眾直接點影片
      clearTimeout(startT);
      startT = setTimeout(function () { if (state === 'play' && !root.classList.contains('on')) { if (mv.yt) { player.native(true); root.classList.add('tap', 'hud'); tapMsg.hidden = false; } else root.classList.add('hud'); } }, 3500);
      setTimeout(function () { if (state === 'play') skipBtn.focus({ preventScroll: true }); }, 60);
    }
    function done(why) {
      if (state === 'done') return;
      var wasPlay = state === 'play';
      state = 'done'; ss(KEY_SEEN, '1');
      clearTimeout(startT); clearTimeout(hudT);
      root.classList.add('out');
      if (wasPlay && player && player.fade) player.fade(900);   // 音樂和畫面一起在 0.9 秒內淡出
      if (viz && viz.intro) viz.intro(wasPlay ? 3000 : 2400);
      setTimeout(function () {
        if (player) player.stop();
        root.hidden = true; root.classList.remove('playing', 'on', 'wait', 'hud', 'out', 'tap'); tapMsg.hidden = true;
        lock(false);
        if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
      }, 950);
      if (why === 'fail') U.toast && U.toast('MV 無法在這裡播放，先帶你看地圖。按上方的 MV，可以到 YouTube 看。');
    }
    function open(direct) {
      if (direct && ext) { openYT(); return; }
      state = 'title'; root.hidden = false; lock(true);
      root.classList.remove('out', 'playing', 'on', 'hud', 'wait', 'tap');
      if (direct) play();
      else setTimeout(function () { playBtn.focus({ preventScroll: true }); }, 30);
    }

    // 標題畫面：點任何地方（「直接看地圖」除外）或按任意鍵 → 播放
    title.addEventListener('click', function (e) { if (e.target.closest('.ng-skipall')) return; if (ext && !e.target.closest('.ng-play')) return; play(); });
    skipAll.addEventListener('click', function (e) { e.preventDefault(); done(); });
    skipBtn.addEventListener('click', function (e) { e.stopPropagation(); done(); });
    muteBtn.addEventListener('click', function (e) { e.stopPropagation(); if (player) { player.mute(!player.muted()); setTimeout(syncMute, 120); } showHud(); });
    root.querySelector('.ng-catch').addEventListener('click', function () { showHud(); });
    root.addEventListener('mousemove', function () { showHud(); });
    document.addEventListener('keydown', function (e) {
      if (root.hidden || state === 'done') return;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|Tab)$/.test(e.key)) return;
      if (state === 'title') {
        if (ext) { if (e.key === 'Escape') { e.preventDefault(); done(); } return; }   // 開新分頁只交給按鈕本身（Enter／空白鍵）
        if (document.activeElement === skipAll && (e.key === 'Enter' || e.key === ' ')) return;   // 交給連結自己處理
        e.preventDefault(); play(); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); done(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && (document.activeElement === skipBtn || document.activeElement === muteBtn)) { if (!root.classList.contains('hud')) { e.preventDefault(); showHud(); } return; }
      e.preventDefault(); showHud();
    });
    return { open: open, skip: function () { done(); }, state: function () { return state; } };
  }

  // ---------- 啟動 ----------
  function start() {
    initTheme();
    var tb = document.getElementById('ng-theme');
    if (tb) tb.addEventListener('click', function () { setTheme(getTheme() === 'dark' ? 'light' : 'dark', true); });
    var host = document.querySelector('#map .vz-body');
    var viz = host ? VIZ.mount(host) : null;
    var hasMv = !!(CFG.mv && (CFG.mv.yt || CFG.mv.src));
    var it = intro(viz);
    var mvb = document.getElementById('ng-mvbtn');
    if (mvb) { if (hasMv) mvb.addEventListener('click', function () { it.open(true); }); else mvb.hidden = true; }
    // 還沒有 MV：不放開場，地圖直接從高處轉進來
    if (!hasMv) { var r0 = document.getElementById('ng-intro'); if (r0) r0.hidden = true; if (viz && viz.intro) viz.intro(2600); window.__ng = { viz: viz, intro: it }; return; }
    // 已經看過（同一個分頁）或網址帶 #map：直接看地圖
    var skip = ss(KEY_SEEN) === '1' || /^#(map|地圖)$/.test(decodeURIComponent(location.hash || ''));
    if (skip) { var r = document.getElementById('ng-intro'); if (r) r.hidden = true; }
    else it.open(false);
    // 「往下看」：捲到地圖下面的說明
    var more = document.getElementById('ng-more');
    if (more) more.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById('ng-about'); if (t) t.scrollIntoView({ behavior: U.reduceMotion() ? 'auto' : 'smooth' }); });
    window.__ng = { viz: viz, intro: it };
  }
  return { start: start };
})();
