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

  // ---------- 「進入地圖」的聲音：仿配樂約 3:32（第 73 小節）最後畫面亮起那一段的所有聲部 ----------
  // 分析原曲那 3 秒（3:32.24 起）：
  //  ・高音：E♭6（約 1245 Hz）疊一層低約 16 音分的同音，拍出每秒約 11 次的閃爍；先在左邊響、一個八分音符後右邊回應，約 0.6 秒最亮
  //  ・和弦：E♭5、B♭4、A♭4、D♭5 一起響，慢慢淡掉；低音區是 A♭2、B♭2，之後換成 E♭3、A♭3、B♭3 的長音一直延續到最後
  //  ・超低頻：一層沒有明確音高的低沉轟鳴，開頭最強
  //  ・空氣聲：起音後約 0.15 秒有一陣很高的「沙」聲，之後慢慢退去
  //  ・最後 1.5 秒：3～4 kHz 一帶的高音光暈（像 E♭6 往上的泛音被殘響放大）和高頻噪音一路往上推，約 3.05 秒整段一起切掉
  // 這裡照這些特徵用 Web Audio 合成，不使用原曲音訊。
  var actx = null;
  function rippleSound() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended' && actx.resume) actx.resume();
      var c = actx, t0 = c.currentTime + 0.03, SR = c.sampleRate, CUT = 2.99, END = t0 + CUT + 0.2;
      // 總音量：最後一起切掉（殘響也一起），跟原曲收尾一樣
      var master = c.createGain(); master.gain.setValueAtTime(0.66, t0); master.gain.setValueAtTime(0.66, t0 + CUT); master.gain.linearRampToValueAtTime(0.0001, t0 + CUT + 0.07);
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 15000; lp.Q.value = 0.3;
      master.connect(lp); lp.connect(c.destination);
      // 殘響（左右各自的衰減雜訊，約 2.6 秒）
      var len = Math.round(SR * 2.6), ir = c.createBuffer(2, len, SR), ramp = SR * 0.012;
      for (var ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2) * (i < ramp ? i / ramp : 1); }
      var rev = c.createConvolver(); rev.buffer = ir;
      var wet = c.createGain(); wet.gain.value = 0.5; rev.connect(wet); wet.connect(master);
      // 乒乓回聲：右 → 左 → 右…，間隔一個八分音符（165 BPM）
      var E = 60 / 165 / 2, send = c.createGain(), d1 = c.createDelay(1), d2 = c.createDelay(1), f1 = c.createGain(), f2 = c.createGain(), mg = c.createChannelMerger(2);
      send.gain.value = 0.6; d1.delayTime.value = E; d2.delayTime.value = E; f1.gain.value = 0.42; f2.gain.value = 0.42;
      send.connect(d1); d1.connect(mg, 0, 1); d1.connect(f1); f1.connect(d2); d2.connect(mg, 0, 0); d2.connect(f2); f2.connect(d1);
      mg.connect(master); mg.connect(rev);
      // 白雜訊（給轟鳴、空氣聲、光暈用）
      var nb = c.createBuffer(1, Math.round(SR * 3.5), SR), nd = nb.getChannelData(0);
      for (var j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
      function bus(pan, toRev, toEcho) {   // 聲部的出口：左右位置、送殘響、送回聲
        var g = c.createGain(), node = g;
        if (c.createStereoPanner && pan) { var p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
        node.connect(master); if (toRev) { var r = c.createGain(); r.gain.value = toRev; node.connect(r); r.connect(rev); }
        if (toEcho) { var e = c.createGain(); e.gain.value = toEcho; g.connect(e); e.connect(send); }
        return g;
      }
      function env(prm, pts) {   // pts：[[秒, 值, 'lin'|'exp'|無]]，第一點直接設定
        pts.forEach(function (q, k) { var at = t0 + q[0], v = Math.max(0.00001, q[1]); if (!k) prm.setValueAtTime(v, at); else if (q[2] === 'lin') prm.linearRampToValueAtTime(v, at); else prm.exponentialRampToValueAtTime(v, at); });
      }
      function note(f, pan, harm, pts, rv, ec, type) {   // 一個音：harm 是 [倍頻, 音量]
        var g = c.createGain(); g.connect(bus(pan, rv, ec)); env(g.gain, pts);
        harm.forEach(function (k) { var o = c.createOscillator(), a = c.createGain(); o.type = type || 'sine'; o.frequency.value = f * k[0]; a.gain.value = k[1]; o.connect(a); a.connect(g); o.start(t0); o.stop(END); });
      }
      function noise(pan, filters, pts, rv) {   // 濾過的雜訊：filters 是 [[種類, 頻率, Q, 頻率走勢]]
        var src = c.createBufferSource(); src.buffer = nb; src.loop = true;
        var node = src;
        filters.forEach(function (k) { var b = c.createBiquadFilter(); b.type = k[0]; b.frequency.value = k[1]; b.Q.value = k[2]; if (k[3]) env(b.frequency, k[3]); node.connect(b); node = b; });
        var g = c.createGain(); node.connect(g); g.connect(bus(pan, rv, 0)); env(g.gain, pts);
        src.start(t0, Math.random() * 2); src.stop(END);
      }
      // 1. 高音 E♭6：左邊先響，快起慢收；加上低約 16 音分的同音層，慢慢亮起、互相拍出閃爍
      note(1244.5, -0.45, [[1, 1], [2, 0.25], [3, 0.1]], [[0, 0.0001], [0.006, 0.13], [0.6, 0.06], [1.6, 0.026], [3.1, 0.011]], 1, 1);
      [[1233.5, -0.6], [1244.5, 0.6]].forEach(function (k) {
        note(k[0], k[1], [[1, 1], [2, 0.22], [3, 0.1]], [[0, 0.0001], [0.6, 0.065, 'lin'], [1.4, 0.028], [2.4, 0.016], [3.1, 0.012]], 1, 1);
      });
      // 2. 和弦：E♭5、B♭4、A♭4、D♭5，和高音一起響，慢慢淡掉
      note(622.25, -0.1, [[1, 1], [2, 0.18]], [[0, 0.0001], [0.01, 0.08], [0.5, 0.05], [1.4, 0.022], [3.1, 0.012]], 0.8, 0.5);
      note(466.16, 0.2, [[1, 1], [2, 0.12]], [[0, 0.0001], [0.01, 0.085], [0.6, 0.045], [1.6, 0.014], [3.1, 0.004]], 0.8, 0.3);
      note(415.30, -0.25, [[1, 1], [2, 0.1]], [[0, 0.0001], [0.02, 0.045], [0.8, 0.022], [2.2, 0.006]], 0.8, 0);
      note(554.37, 0.3, [[1, 1]], [[0, 0.0001], [0.03, 0.032], [0.9, 0.016], [2.2, 0.005]], 0.8, 0);
      noise(0, [['bandpass', 4000, 1.2]], [[0, 0.0001], [0.006, 0.11], [0.25, 0.016], [0.6, 0.003]], 0.6);
      // 3. 低音區：先是 A♭2、B♭2，接著 E♭3、A♭3、B♭3 的長音延續到最後（三角波＋低通，比較溫暖）
      var padLp = c.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 950; padLp.Q.value = 0.5; padLp.connect(bus(0, 0.6, 0));
      function pad(f, pts) { var g = c.createGain(); g.connect(padLp); env(g.gain, pts); var o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t0); o.stop(END); }
      pad(103.83, [[0, 0.0001], [0.04, 0.045], [0.6, 0.03], [1.6, 0.01], [2.6, 0.003]]);
      pad(116.54, [[0, 0.0001], [0.04, 0.05], [0.7, 0.035], [1.8, 0.012], [2.8, 0.004]]);
      [155.56, 207.65, 233.08].forEach(function (f) { pad(f, [[0, 0.0001], [0.5, 0.004], [1.4, 0.016, 'lin'], [2.95, 0.028, 'lin']]); });
      // 4. 超低頻的轟鳴：沒有明確音高，開頭最強
      noise(0, [['lowpass', 75, 0.8], ['highpass', 26, 0.7]], [[0, 0.0001], [0.03, 0.9], [0.4, 0.55], [0.9, 0.3], [2.0, 0.3], [2.9, 0.26], [3.1, 0.2]], 0);
      note(51.91, 0, [[1, 1]], [[0, 0.0001], [0.03, 0.12], [0.8, 0.05], [2.5, 0.035], [3.1, 0.03]], 0, 0);
      // 5. 空氣聲：起音後約 0.15 秒最大，之後退去
      noise(-0.3, [['bandpass', 9500, 0.8]], [[0, 0.0001], [0.15, 0.08, 'lin'], [0.35, 0.03], [0.8, 0.014], [1.4, 0.008]], 0.7);
      noise(0.3, [['bandpass', 11000, 0.8]], [[0, 0.0001], [0.17, 0.065, 'lin'], [0.37, 0.025], [0.8, 0.012], [1.4, 0.007]], 0.7);
      // 6. 最後 1.5 秒：高音光暈（3～4 kHz 的一群音，帶一點顫音）和高頻噪音一路往上推
      [[2489, 0.5, -0.5], [3320, 0.45, 0.4], [3733, 1, -0.2], [3830, 0.7, 0.55], [3930, 0.55, -0.6], [4180, 0.35, 0.2]].forEach(function (k) {
        var g = c.createGain(); g.connect(bus(k[2], 0.8, 0));
        env(g.gain, [[0, 0.0001], [0.3, 0.003 * k[1]], [1.5, 0.008 * k[1]], [2.2, 0.016 * k[1]], [2.95, 0.026 * k[1]]]);
        var o = c.createOscillator(); o.frequency.value = k[0]; var lfo = c.createOscillator(), dep = c.createGain(); lfo.frequency.value = 4 + Math.random() * 2.5; dep.gain.value = k[0] * 0.004;
        lfo.connect(dep); dep.connect(o.frequency); o.connect(g); o.start(t0); lfo.start(t0); o.stop(END); lfo.stop(END);
      });
      noise(0, [['bandpass', 3800, 4]], [[0, 0.0001], [0.4, 0.004], [1.6, 0.012], [2.95, 0.05]], 0.6);
      noise(-0.2, [['bandpass', 7000, 0.9, [[0, 6000], [2.2, 6500, 'exp'], [3.0, 9500, 'exp']]]], [[0, 0.0001], [1.4, 0.008], [2.4, 0.022], [3.0, 0.065]], 0.5);
      noise(0.25, [['highpass', 4500, 0.7, [[0, 4500], [2.6, 4500], [3.02, 8000, 'exp']]]], [[0, 0.0001], [2.0, 0.003], [2.8, 0.02], [3.0, 0.045]], 0.3);
    } catch (e) { /* 沒有音效也照常轉場 */ }
  }

  // ---------- 播放器：YouTube 或影片檔，對外介面一樣 ----------
  // ev: { playing, waiting, paused, ended, error, muted, time(cur, dur) }
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
    v.addEventListener('pause', function () { if (!v.ended) ev.paused(); });
    v.addEventListener('error', function () { ev.error('file'); });
    v.addEventListener('timeupdate', function () { ev.time(v.currentTime, v.duration || 0); });
    var fd = fader(function () { return v.volume; }, function (x) { v.volume = Math.max(0, Math.min(1, x)); });
    return {
      ready: function () { return true; },
      play: function () { var p = v.play(); if (p && p.catch) p.catch(function () { v.muted = true; ev.muted(true); v.play().catch(function () { ev.error('blocked'); }); }); },
      fade: function (ms) { fd.out(ms); },
      pause: function () { try { v.pause(); } catch (e) { /* 忽略 */ } },
      resume: function () { var p = v.play(); if (p && p.catch) p.catch(function () { /* 忽略 */ }); },
      restart: function () { try { v.currentTime = 0; } catch (e) { /* 忽略 */ } var p = v.play(); if (p && p.catch) p.catch(function () { /* 忽略 */ }); },
      seek: function (sec) { try { v.currentTime = sec; } catch (e) { /* 忽略 */ } },
      dur: function () { return v.duration || 0; },
      cur: function () { return v.currentTime || 0; },
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
              else if (e.data === 2) { clearInterval(poll); ev.paused(); }
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
      pause: function () { if (isReady) { try { P.pauseVideo(); } catch (e) { /* 忽略 */ } } },
      resume: function () { if (isReady) { try { P.playVideo(); } catch (e) { /* 忽略 */ } } },
      restart: function () { if (isReady) { try { P.seekTo(0, true); P.playVideo(); } catch (e) { /* 忽略 */ } } },
      seek: function (sec, final) { if (isReady) { try { P.seekTo(sec, !!final); } catch (e) { /* 忽略 */ } } },   // 拖曳途中 final=false：只預覽畫面，不下載
      dur: function () { return isReady && P.getDuration ? P.getDuration() || 0 : 0; },
      cur: function () { return isReady && P.getCurrentTime ? P.getCurrentTime() || 0 : 0; },
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
    var landBtn = root.querySelector('.ng-landbtn'), pauseBtn = root.querySelector('.ng-pause'), fsBtn = root.querySelector('.ng-fs'), vp = root.querySelector('.ng-vp');
    var replayBtn = root.querySelector('.ng-replay'), nextBtn = root.querySelector('.ng-next');
    var seekEl = root.querySelector('.ng-seek'), trackEl = root.querySelector('.ng-track'), fillEl = root.querySelector('.ng-fill'), knobEl = root.querySelector('.ng-knob'), tmC = root.querySelector('.ng-tm-c'), tmD = root.querySelector('.ng-tm-d');
    var dragging = false;
    var state = 'title', hudT = 0, startT = 0, player = null, nearEnd = false;
    var has = !!(mv.yt || mv.src);
    // ext：MV 不在這頁播，改到 YouTube 新分頁看（claude.ai 預覽版不能內嵌 YouTube；正式網站播放失敗時也改成這樣）
    var ext = !!(mv.yt && mv.ext);
    var ev = {
      playing: function () { root.classList.add('on'); root.classList.remove('wait', 'tap', 'paused'); clearTimeout(startT); player.native(false); tapMsg.hidden = true; syncMute(); syncPause(); },
      waiting: function () { root.classList.add('wait'); },
      paused: function () { if (state !== 'play' || !root.classList.contains('on') || root.classList.contains('ended')) return; root.classList.add('paused'); root.classList.remove('wait'); syncPause(); showHud(); },
      ended: function () { showEnd(true); },
      error: function (why) { if (mv.yt) setExt(); if (state === 'play') done('fail'); else if (state === 'title' && !mv.yt) noMv(); },
      muted: function () { syncMute(); },
      time: function (c, d) {
        if (d > 0) { if (!dragging) showPos(c, d); if (!nearEnd && !dragging && d - c < 0.35) { nearEnd = true; showEnd(); } }   // 搶在 YouTube 片尾畫面（推薦影片）出現前停下
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
      hudT = setTimeout(function () { if (!root.classList.contains('paused')) root.classList.remove('hud'); }, 3200);   // 暫停中控制列不自動收起
    }
    function hideHud() { clearTimeout(hudT); root.classList.remove('hud'); }
    // ---- 暫停／繼續 ----
    function isPaused() { return root.classList.contains('paused'); }
    function syncPause() { var p = isPaused(); pauseBtn.setAttribute('aria-label', p ? '繼續播放' : '暫停'); pauseBtn.title = p ? '繼續播放' : '暫停'; }
    function togglePause() {
      if (state !== 'play' || !player || !root.classList.contains('on')) return;
      if (isPaused()) { root.classList.remove('paused'); syncPause(); player.resume(); showHud(); }
      else { player.pause(); root.classList.add('paused'); syncPause(); showHud(); }
    }

    // ---- 橫向全螢幕 ----
    // 手機：全螢幕（藏起網址列）＋鎖成橫向；不支援全螢幕的瀏覽器（例如 iPhone 的 Safari）改把播放畫面轉 90 度，
    // 觀眾把手機往左轉（上緣朝左）就是橫向。電腦：一般的全螢幕。
    var touch = (function () { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();
    var land = false, fsOurs = false;
    var reqFs = root.requestFullscreen || root.webkitRequestFullscreen;
    function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    if (touch && !reqFs) { landBtn.querySelector('.ng-land-t').textContent = '橫向播放'; }
    function syncFs() {
      var t = land ? (reqFs ? '離開全螢幕' : '直向播放') : (touch ? (reqFs ? '橫向全螢幕' : '橫向播放') : '全螢幕');
      fsBtn.querySelector('span').textContent = t; fsBtn.setAttribute('aria-pressed', land ? 'true' : 'false');
    }
    syncFs();
    function layoutLand() {
      var W = root.clientWidth, H = root.clientHeight;
      if (land && touch && H > W) {   // 畫面還是直的（鎖不住橫向，或不支援全螢幕）：播放畫面轉 90 度
        vp.style.cssText = 'inset:auto;left:50%;top:50%;width:' + H + 'px;height:' + W + 'px;transform:translate(-50%,-50%) rotate(90deg)';
        root.classList.add('rot');
      } else { vp.style.cssText = ''; root.classList.remove('rot'); }
    }
    function lockLand() {
      if (!touch) return;
      try { var o = screen.orientation; if (o && o.lock) { var p = o.lock('landscape'); if (p && p.catch) p.catch(function () { /* 鎖不住：用轉 90 度的畫面 */ }); } } catch (e) { /* 忽略 */ }
    }
    function enterLand() {
      if (land) return;
      land = true; root.classList.add('land');
      if (reqFs && !fsEl()) {
        try {
          var p = reqFs.call(root, { navigationUI: 'hide' });
          fsOurs = true;
          if (p && p.then) p.then(lockLand, function () { fsOurs = false; });
          else setTimeout(lockLand, 200);
        } catch (e) { fsOurs = false; }
      }
      layoutLand(); setTimeout(layoutLand, 400); syncFs();
    }
    function leaveLand() {
      if (!land) return;
      land = false; root.classList.remove('land');
      try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* 忽略 */ }
      if (fsOurs && fsEl() === root) {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        try { var p = ex.call(document); if (p && p.catch) p.catch(function () { /* 忽略 */ }); } catch (e) { /* 忽略 */ }
      }
      fsOurs = false; layoutLand(); syncFs();
    }
    function onFsChange() { if (fsOurs && fsEl() !== root) { fsOurs = false; leaveLand(); } else layoutLand(); }   // 觀眾用返回鍵離開全螢幕：回到直向
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    window.addEventListener('resize', layoutLand);
    window.addEventListener('orientationchange', function () { setTimeout(layoutLand, 250); });
    function syncMute() { if (!player) return; var m = player.muted(); muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false'); muteBtn.querySelector('span').textContent = m ? '開聲音' : '靜音'; }
    function play() {
      if (state !== 'title') return;
      if (ext) { openYT(); done(); return; }
      if (!has || (player.failed && player.failed())) { done(); return; }
      state = 'play'; nearEnd = false;
      root.classList.add('playing', 'wait'); root.classList.remove('on', 'paused'); syncPause();
      showPos(0, player && player.dur ? player.dur() : 0);
      player.play();
      // 3.5 秒還沒開始：可能是手機擋了自動播放 → 讓觀眾直接點影片
      clearTimeout(startT);
      startT = setTimeout(function () { if (state === 'play' && !root.classList.contains('on')) { if (mv.yt) { player.native(true); root.classList.add('tap', 'hud'); tapMsg.hidden = false; } else root.classList.add('hud'); } }, 3500);
      setTimeout(function () { if (state === 'play') pauseBtn.focus({ preventScroll: true }); }, 60);
    }
    // ---- 進度條：點一下或拖曳跳到想看的地方 ----
    function fmtT(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
    function showPos(c, d) {
      var k = d > 0 ? Math.max(0, Math.min(1, c / d)) : 0;
      bar.style.transform = 'scaleX(' + k.toFixed(4) + ')';
      fillEl.style.width = (k * 100).toFixed(3) + '%'; knobEl.style.left = (k * 100).toFixed(3) + '%';
      tmC.textContent = fmtT(c); tmD.textContent = fmtT(d);
      seekEl.setAttribute('aria-valuemax', String(Math.round(d))); seekEl.setAttribute('aria-valuenow', String(Math.round(c)));
      seekEl.setAttribute('aria-valuetext', fmtT(c) + ' / ' + fmtT(d));
    }
    function seekTo(sec, final) {
      var d = player && player.dur ? player.dur() : 0;
      if (!(d > 0) || state !== 'play') return;
      sec = Math.max(0, Math.min(d - 0.6, sec));   // 不直接跳到最後一刻：留一點播完，才會接上結束畫面
      player.seek(sec, final); showPos(sec, d);
    }
    var seekT = 0, seekLast = 0;
    function fracAt(e) {
      var r = trackEl.getBoundingClientRect();
      var k = root.classList.contains('rot') ? (e.clientY - r.top) / (r.height || 1) : (e.clientX - r.left) / (r.width || 1);   // 轉 90 度時，進度條在螢幕上是直的
      return Math.max(0, Math.min(1, k));
    }
    function dragAt(e, final) {
      var d = player && player.dur ? player.dur() : 0; if (!(d > 0)) return;
      var sec = fracAt(e) * d, now = Date.now();
      showPos(Math.min(sec, d - 0.6), d);
      if (final) { clearTimeout(seekT); seekTo(sec, true); return; }
      if (now - seekLast > 180) { seekLast = now; seekTo(sec, false); }   // 拖曳中每 0.18 秒更新一次畫面
    }
    seekEl.addEventListener('pointerdown', function (e) {
      if (state !== 'play' || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      dragging = true; seekEl.classList.add('drag'); clearTimeout(hudT); root.classList.add('hud');
      try { seekEl.setPointerCapture(e.pointerId); } catch (x) { /* 忽略 */ }
      dragAt(e, false);
    });
    seekEl.addEventListener('pointermove', function (e) { if (dragging) { e.stopPropagation(); dragAt(e, false); } });
    function endDrag(e) { if (!dragging) return; dragAt(e, true); dragging = false; seekEl.classList.remove('drag'); showHud(); }
    seekEl.addEventListener('pointerup', endDrag);
    seekEl.addEventListener('pointercancel', function () { dragging = false; seekEl.classList.remove('drag'); showHud(); });
    seekEl.addEventListener('click', function (e) { e.stopPropagation(); });
    function nudge(dt) { if (!player || !player.cur) return; seekTo(player.cur() + dt, true); showHud(); }
    var maskRun = 0;
    // ---- 播完：結束畫面 ----
    // byEnd：YouTube 已經真的播到底（片長多算了零點幾秒，沒在最後一刻前停住）→ 影片立刻藏起來，不讓片尾推薦影片閃出來
    function showEnd(byEnd) {
      if (state !== 'play') return;
      if (byEnd) root.classList.add('cut');
      state = 'end'; nearEnd = true;
      clearTimeout(startT); clearTimeout(hudT);
      if (player) player.pause();   // 停在最後，不讓 YouTube 的片尾推薦出現；畫面淡成黑底
      root.classList.remove('hud', 'paused', 'wait', 'tap'); root.classList.add('ended'); tapMsg.hidden = true;
      setTimeout(function () { if (state === 'end') nextBtn.focus({ preventScroll: true }); }, 900);
    }
    function replay() {
      if (state !== 'end') return;
      state = 'play'; nearEnd = false;
      root.classList.remove('ended', 'cut'); showPos(0, player && player.dur ? player.dur() : 0);
      player.restart();
      setTimeout(function () { if (state === 'play') pauseBtn.focus({ preventScroll: true }); }, 60);
    }
    // ---- 進入地圖：漣漪聲＋從按鈕擴散的圓，把開場畫面揭開，露出底下的 3D 台灣 ----
    function rippleTo() {
      if (state !== 'end') return;
      var muted = player && player.muted && player.muted();
      if (!muted) rippleSound();   // 要在點擊當下發聲（手機瀏覽器的規定）
      root.classList.add('going');
      var reduce = U.reduceMotion && U.reduceMotion();
      function go() {
        var r = nextBtn.getBoundingClientRect(), W = innerWidth, H = innerHeight;
        var x = r.width ? r.left + r.width / 2 : W / 2, y = r.height ? r.top + r.height / 2 : H / 2;
        if (fsEl()) { x = W / 2; y = H / 2; }
        if (reduce) { done(); return; }
        // 水波圈：三圈，間隔出現
        var far = Math.hypot(Math.max(x, W - x), Math.max(y, H - y));
        var box = h('div', { class: 'ng-ripples', 'aria-hidden': 'true' });
        [0, 220, 470].forEach(function (dl, i) { var e = h('i'); e.style.cssText = 'left:' + x + 'px;top:' + y + 'px;animation-delay:' + dl + 'ms;--d:' + Math.round(far * 2 * (1.05 - i * 0.12)) + 'px'; box.appendChild(e); });
        document.body.appendChild(box);
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 2800);
        done('ripple', { x: x, y: y, far: far });
      }
      // 全螢幕裡看不到底下的地圖：先離開全螢幕（畫面轉回直向）再揭開
      if (fsEl()) { leaveLand(); setTimeout(go, 380); } else go();
    }
    function done(why, rp) {
      if (state === 'done') return;
      var wasPlay = state === 'play', wasEnd = state === 'end';
      state = 'done'; ss(KEY_SEEN, '1');
      clearTimeout(startT); clearTimeout(hudT);
      if (wasPlay && player && player.fade) player.fade(900);   // 音樂和畫面一起在 0.9 秒內淡出
      if (viz && viz.intro) viz.intro(wasPlay || wasEnd ? 3000 : 2400);
      var hideIn = 950;
      if (rp) {   // 圓形揭開：半徑從 0 長到蓋滿整個畫面
        hideIn = 1500;
        var t0 = performance.now(), D = 1350, edge = 70, run = ++maskRun;
        (function step(now) {
          if (run !== maskRun || root.hidden) return;   // 已經收起來了：不要再把遮罩加回去
          var k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          var rr = Math.max(0, e * (rp.far + edge)) - edge * (1 - e);
          var m = 'radial-gradient(circle at ' + rp.x + 'px ' + rp.y + 'px, transparent ' + Math.max(0, rr).toFixed(1) + 'px, #000 ' + (Math.max(0, rr) + edge).toFixed(1) + 'px)';
          root.style.webkitMaskImage = m; root.style.maskImage = m;
          if (k < 1 && state === 'done' && !root.hidden) requestAnimationFrame(step);
        })(t0);
      } else root.classList.add('out');
      setTimeout(function () {
        if (player) player.stop();
        leaveLand();
        root.hidden = true; root.classList.remove('playing', 'on', 'wait', 'hud', 'out', 'tap', 'paused', 'ended', 'going', 'cut'); tapMsg.hidden = true;
        maskRun++; root.style.webkitMaskImage = ''; root.style.maskImage = '';
        lock(false);
        if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
      }, hideIn);
      if (why === 'fail') U.toast && U.toast('MV 無法在這裡播放，先帶你看地圖。按上方的 MV，可以到 YouTube 看。');
    }
    function open(direct) {
      if (direct && ext) { openYT(); return; }
      state = 'title'; root.hidden = false; lock(true);
      root.classList.remove('out', 'playing', 'on', 'hud', 'wait', 'tap', 'paused', 'ended', 'going', 'cut');
      maskRun++; root.style.webkitMaskImage = ''; root.style.maskImage = '';
      if (direct) play();
      else setTimeout(function () { playBtn.focus({ preventScroll: true }); }, 30);
    }

    // 標題畫面：點任何地方（「直接看地圖」除外）或按任意鍵 → 播放
    title.addEventListener('click', function (e) {
      if (e.target.closest('.ng-skipall')) return;
      if (e.target.closest('.ng-landbtn')) { if (!ext && has) enterLand(); play(); return; }   // 先進全螢幕（要在點擊當下），再播放
      if (ext && !e.target.closest('.ng-play')) return;
      play();
    });
    pauseBtn.addEventListener('click', function (e) { e.stopPropagation(); togglePause(); });
    replayBtn.addEventListener('click', function (e) { e.stopPropagation(); replay(); });
    nextBtn.addEventListener('click', function (e) { e.stopPropagation(); rippleTo(); });
    fsBtn.addEventListener('click', function (e) { e.stopPropagation(); if (land) leaveLand(); else enterLand(); showHud(); });
    skipAll.addEventListener('click', function (e) { e.preventDefault(); done(); });
    skipBtn.addEventListener('click', function (e) { e.stopPropagation(); done(); });
    muteBtn.addEventListener('click', function (e) { e.stopPropagation(); if (player) { player.mute(!player.muted()); setTimeout(syncMute, 120); } showHud(); });
    // 點畫面：控制列和暫停鍵出現；它們在畫面上時再點一下就收起來（暫停中也一樣）
    // 電腦：用滑鼠點掉之後，要真的移動滑鼠（超過 24px）才再叫出來，不然點完手一晃又跑出來
    var hidAt = null;
    root.querySelector('.ng-catch').addEventListener('click', function (e) {
      if (root.classList.contains('hud')) { hideHud(); hidAt = { x: e.clientX, y: e.clientY }; }
      else { hidAt = null; showHud(); }
    });
    // 只有真的滑鼠移動才叫出控制列：手機點一下時瀏覽器也會補發 mousemove，會讓隱形的「略過」在同一下被按到
    root.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      if (hidAt) { if (Math.abs(e.clientX - hidAt.x) + Math.abs(e.clientY - hidAt.y) < 24) return; hidAt = null; }
      showHud();
    });
    document.addEventListener('keydown', function (e) {
      if (root.hidden || state === 'done') return;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|Tab)$/.test(e.key)) return;
      if (state === 'title') {
        if (ext) { if (e.key === 'Escape') { e.preventDefault(); done(); } return; }   // 開新分頁只交給按鈕本身（Enter／空白鍵）
        if ((document.activeElement === skipAll || document.activeElement === landBtn) && (e.key === 'Enter' || e.key === ' ')) return;   // 交給連結／按鈕自己處理
        e.preventDefault(); play(); return;
      }
      if (state === 'end') {   // 結束畫面：Enter／空白鍵交給按鈕本身；R 重播；Esc 直接看地圖
        if (e.key === 'Escape') { if (fsEl()) return; e.preventDefault(); done(); }
        else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); replay(); }
        return;
      }
      if (state !== 'play') return;
      if (e.key === 'Escape') { if (fsEl()) return; e.preventDefault(); done(); return; }   // 全螢幕中的 Esc 交給瀏覽器離開全螢幕，不略過 MV
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); nudge(e.key === 'ArrowLeft' ? -5 : 5); return; }
      if (document.activeElement === seekEl && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); seekTo(e.key === 'Home' ? 0 : 1e9, true); showHud(); return; }
      var hb = document.activeElement === skipBtn || document.activeElement === muteBtn || document.activeElement === fsBtn;
      if ((e.key === 'Enter' || e.key === ' ') && hb) { if (!root.classList.contains('hud')) { e.preventDefault(); showHud(); } return; }
      if (e.key === ' ' || e.key === 'k' || e.key === 'K' || (e.key === 'Enter' && document.activeElement === pauseBtn)) { e.preventDefault(); togglePause(); return; }
      e.preventDefault(); showHud();
    });
    return { open: open, skip: function () { done(); }, state: function () { return state; }, land: function () { return land; }, _end: function () { showEnd(); } };
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
