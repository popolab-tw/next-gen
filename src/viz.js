/* =========================================================================
   VIZ — 全台分享地圖：NEXT GEN 網站的 3D 可視化
   每一點是一位匿名分享的玩家，位置依縣市（與市中心／一般／外圍）和人口密度隨機撒，不是真實住址。
   選一種分法，點就升到台灣上方對應的切片；門檻 PR 則依數值連續分布在上方。
   資料是固定版本（build/viz_points.py 產生），底圖是 OpenStreetMap 道路與地形（build/viz_map.py）。
   ========================================================================= */
var VIZ = (function () {
  'use strict';
  var h = U.h;

  // ---------- 文字（中文／英文；語言由 src/i18n.js 決定，沒有它時一律中文） ----------
  function EN() { return !!(window.I18N && I18N.en()); }
  function T(zh, en) { return EN() && en != null ? en : zh; }
  function ord(n) { return window.I18N ? I18N.ord(n) : String(Math.round(n)); }
  var LBL = {
    zh: {
      age: ['20–24 歲', '25–29 歲', '30–34 歲', '35–39 歲', '40–44 歲', '45–49 歲'],
      house: { rent: '租房子', buyUsed: '買中古屋', buyNew: '買新成屋或預售屋', family: '住長輩的房子', own: '已經有房子' },
      care: { grandFree: '長輩帶，不用給錢', self: '自己帶，不用辭職', grandPaid: '長輩帶，給帶孫費', public: '公共托育', quasi: '準公共保母或托嬰', private: '私立托嬰或保母', helper: '外籍家庭幫傭', quit: '一人辭職在家帶' },
      school: { public: '全程讀公立', privateJH: '國中起讀私立', private: '全程讀私立', intl: '雙語或國際學校' },
      life: { frugal: '精打細算', normal: '一般', comfy: '寬裕一點' },
      verd: { broke: '駁回：到孩子獨立都缺錢', fail: '駁回：中途缺錢', tight: '附條件核准', pass: '核准' }
    },
    en: {
      age: ['Ages 20–24', 'Ages 25–29', 'Ages 30–34', 'Ages 35–39', 'Ages 40–44', 'Ages 45–49'],
      house: { rent: 'Renting', buyUsed: 'Buying a resale home', buyNew: 'Buying new or pre-sale', family: 'Living in a family home', own: 'Already own a home' },
      care: { grandFree: 'Grandparents, unpaid', self: 'Ourselves, both keep working', grandPaid: 'Grandparents, paid', public: 'Public daycare', quasi: 'Subsidized nanny or daycare', private: 'Private daycare or nanny', helper: 'Foreign domestic helper', quit: 'One parent quits to stay home' },
      school: { public: 'Public all the way', privateJH: 'Private from junior high', private: 'Private all the way', intl: 'Bilingual or international' },
      life: { frugal: 'Frugal', normal: 'Average', comfy: 'Comfortable' },
      verd: { broke: 'Rejected: short until the kids are grown', fail: 'Rejected: runs short partway', tight: 'Approved with conditions', pass: 'Approved' }
    }
  };
  var AGE_L, HOUSE_L, CARE_L, SCHOOL_L, LIFE_L, VERD_L;
  function useLang() { var L = LBL[EN() ? 'en' : 'zh']; AGE_L = L.age; HOUSE_L = L.house; CARE_L = L.care; SCHOOL_L = L.school; LIFE_L = L.life; VERD_L = L.verd; }
  useLang();
  // 縣市與區域的英文名稱（遊戲的資料檔只有中文，英文另外放在這裡）
  var COUNTY_EN = { TPE: 'Taipei', NTPC: 'New Taipei', TYN: 'Taoyuan', TXG: 'Taichung', TNN: 'Tainan', KHH: 'Kaohsiung', HSZ: 'Hsinchu City', HSQ: 'Hsinchu County', KEE: 'Keelung', ILA: 'Yilan', MIA: 'Miaoli', CHA: 'Changhua', NAN: 'Nantou', YUN: 'Yunlin', CYI: 'Chiayi City', CYQ: 'Chiayi County', PIF: 'Pingtung', HUA: 'Hualien', TTT: 'Taitung', PEN: 'Penghu', KIN: 'Kinmen', LIE: 'Lienchiang (Matsu)' };
  var DIST_EN = { _: { core: 'City center', mid: 'Typical areas', outer: 'Outer areas' }, TPE: { core: 'Prime districts' }, NTPC: { core: 'Inner ring', mid: 'Middle ring' }, TXG: { core: '7th Zone, Xitun & Nantun' }, HSQ: { core: 'Zhubei', outer: 'Other townships' } };

  // ---------- 下載與解析 ----------
  function b64bytes(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function gunzip(u8) {
    if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return Promise.resolve(u8);   // 伺服器已經解壓
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('old-browser'));
    var st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(st).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function getBytes(inline, url) {
    if (inline) return Promise.resolve(b64bytes(inline));
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); });
  }
  function getJSON(inline, url) {
    if (inline) return Promise.resolve(inline);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }
  // 底圖：TWV1 + 標頭 JSON + 各圖層（折線，座標差值以 zigzag varint 存；等高線另附每條線的高度）＋ 高度網格
  function parseMap(u8) {
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'TWV1') throw new Error('bad map');
    var hl = u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24);
    var head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
    var p = 8 + hl, q = head.q, layers = {};
    function vi() { var r = 0, s = 0, b; do { b = u8[p++]; r += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80); return (r % 2) ? -(r + 1) / 2 : r / 2; }
    function vu() { var r = 0, s = 0, b; do { b = u8[p++]; r += (b & 0x7f) * Math.pow(2, s); s += 7; } while (b & 0x80); return r; }
    head.layers.forEach(function (L) {
      var nl = vu(), pts = new Float32Array(L.pts * 2), lens = new Uint32Array(nl), k = 0, x = 0, y = 0, vals = null;
      for (var i = 0; i < nl; i++) {
        var n = vu(); lens[i] = n;
        for (var j = 0; j < n; j++) { x += vi(); y += vi(); pts[k++] = x * q; pts[k++] = y * q; }
      }
      if (L.vals) { vals = new Float32Array(nl); for (i = 0; i < nl; i++) vals[i] = vu(); }
      layers[L.id] = { pts: pts, lens: lens, vals: vals };
    });
    var dem = null;
    if (head.dem) { var d = head.dem; dem = { x0: d.x0, y0: d.y0, d: d.d, nx: d.nx, ny: d.ny, k: d.step / 1000, g: u8.subarray(p, p + d.nx * d.ny) }; }
    return { head: head, layers: layers, dem: dem };
  }
  // 地形高度（公里，雙線性內插）
  function heightAt(dem, x, y) {
    if (!dem) return 0;
    var fx = (x - dem.x0) / dem.d - 0.5, fy = (y - dem.y0) / dem.d - 0.5;
    var ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    function g(i, j) { i = Math.max(0, Math.min(dem.nx - 1, i)); j = Math.max(0, Math.min(dem.ny - 1, j)); return dem.g[j * dem.nx + i]; }
    var v = (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
    return v * dem.k;
  }

  // ---------- 內容的範圍：海岸線的凸包 ----------
  function hullOf(pts) {   // pts: [[x, y], ...]，回傳逆時針凸包
    var P = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 0) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop(); up.push(P[i]); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  // ---------- 配色：門檻 PR → 顏色（OKLCH，深淺模式各一組） ----------
  // PR 大多集中在 80–100，所以高分段給比較多的色彩變化
  var PR_STOPS = [[0, 0], [50, 0.3], [80, 0.55], [95, 0.8], [100, 1]];
  function prU(pr) { for (var i = 1; i < PR_STOPS.length; i++) if (pr <= PR_STOPS[i][0]) { var a = PR_STOPS[i - 1], b = PR_STOPS[i]; return a[1] + (b[1] - a[1]) * (pr - a[0]) / (b[0] - a[0]); } return 1; }
  var PALS = [  // 每組：[u, L, C, h]
    { id: 'neon', name: '霓虹', en: 'Neon', light: [[0, 0.62, 0.11, 195], [0.3, 0.58, 0.13, 245], [0.55, 0.55, 0.17, 292], [0.8, 0.57, 0.21, 345], [1, 0.6, 0.22, 28]],
      dark: [[0, 0.8, 0.11, 190], [0.3, 0.74, 0.13, 240], [0.55, 0.7, 0.16, 290], [0.8, 0.7, 0.2, 345], [1, 0.7, 0.21, 30]] },
    { id: 'ice', name: '冰火', en: 'Ice & fire', light: [[0, 0.5, 0.15, 255], [0.3, 0.62, 0.1, 245], [0.55, 0.74, 0.012, 80], [0.8, 0.64, 0.15, 40], [1, 0.56, 0.21, 27]],
      dark: [[0, 0.62, 0.15, 255], [0.3, 0.72, 0.1, 240], [0.55, 0.84, 0.012, 80], [0.8, 0.72, 0.15, 45], [1, 0.66, 0.21, 28]] },
    { id: 'lava', name: '熔岩', en: 'Lava', light: [[0, 0.4, 0.14, 300], [0.35, 0.5, 0.19, 345], [0.6, 0.58, 0.2, 28], [0.82, 0.67, 0.17, 52], [1, 0.74, 0.15, 75]],
      dark: [[0, 0.46, 0.16, 300], [0.35, 0.58, 0.2, 345], [0.6, 0.67, 0.2, 30], [0.82, 0.78, 0.16, 60], [1, 0.9, 0.15, 95]] },
    { id: 'aurora', name: '極光', en: 'Aurora', light: [[0, 0.42, 0.13, 285], [0.35, 0.55, 0.11, 230], [0.6, 0.62, 0.11, 185], [0.82, 0.68, 0.15, 145], [1, 0.74, 0.17, 115]],
      dark: [[0, 0.5, 0.14, 285], [0.35, 0.64, 0.11, 230], [0.6, 0.74, 0.11, 185], [0.82, 0.83, 0.15, 145], [1, 0.92, 0.17, 112]] },
    { id: 'traffic', name: '綠紅', en: 'Green–red', light: [[0, 0.6, 0.15, 150], [0.3, 0.66, 0.16, 128], [0.55, 0.74, 0.16, 100], [0.8, 0.66, 0.18, 58], [1, 0.57, 0.21, 28]],
      dark: [[0, 0.74, 0.17, 150], [0.3, 0.8, 0.17, 128], [0.55, 0.86, 0.16, 100], [0.8, 0.76, 0.18, 58], [1, 0.67, 0.22, 28]] },
    { id: 'vermilion', name: '朱墨', en: 'Vermilion', light: [[0, 0.8, 0, 0], [0.4, 0.68, 0.03, 30], [0.65, 0.62, 0.1, 30], [0.85, 0.6, 0.17, 29], [1, 0.57, 0.22, 28]],
      dark: [[0, 0.42, 0, 0], [0.4, 0.52, 0.04, 30], [0.65, 0.6, 0.11, 30], [0.85, 0.66, 0.18, 30], [1, 0.7, 0.22, 30]] }
  ];
  function oklch(L, C, H) {
    var a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    var rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    return rgb.map(function (v) { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; });
  }
  function palOf(id) { return PALS.filter(function (p) { return p.id === id; })[0] || PALS[0]; }
  function palColor(theme, u, id) {
    var P = palOf(id)[theme];
    for (var i = 1; i < P.length; i++) if (u <= P[i][0]) {
      var a = P[i - 1], b = P[i], t = (u - a[0]) / (b[0] - a[0]);
      var ha = a[2] < 0.02 ? b[3] : a[3], hb = b[2] < 0.02 ? a[3] : b[3], dh = hb - ha;   // 灰色沒有色相：跟著另一端
      if (dh < -180) dh += 360; if (dh > 180) dh -= 360;
      return oklch(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, ha + dh * t);
    }
    var e = P[P.length - 1]; return oklch(e[1], e[2], e[3]);
  }
  function gradientCss(theme, id) { var s = []; for (var k = 0; k <= 20; k++) s.push(css(palColor(theme, k / 20, id)) + ' ' + (k * 5) + '%'); return 'linear-gradient(90deg,' + s.join(',') + ')'; }
  function css(c, al) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (al == null ? 1 : al) + ')'; }
  var THEME = {
    light: { bg: [1, 1, 1], ink: [0.06, 0.06, 0.07], major: 0.42, mid: 0.2, minor: 0.12, contour: 0.16, coast: 0.8, border: 0.22, slice: 0.32, sliceB: 0.15, frame: 0.18, stem: 0.07 },
    dark: { bg: [0.02, 0.02, 0.025], ink: [0.93, 0.93, 0.9], major: 0.4, mid: 0.19, minor: 0.12, contour: 0.17, coast: 0.75, border: 0.22, slice: 0.32, sliceB: 0.16, frame: 0.2, stem: 0.09 }
  };
  function themeName() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }

  // ---------- 矩陣與補間 ----------
  function mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  // 相機：yaw 決定水平方向，pitch 90° 是正上方往下看（北邊朝上時 yaw = 0）
  function viewMat(T, yawDeg, pitDeg, d) {
    var yaw = yawDeg * Math.PI / 180, pit = pitDeg * Math.PI / 180;
    var sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
    var zx = -sy * cp, zy = -cy * cp, zz = sp;            // 從目標指向相機
    var xx = cy, xy = -sy, xz = 0;                        // 畫面右方（水平）
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var e = [T[0] + zx * d, T[1] + zy * d, T[2] + zz * d];
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  }
  function ortho(l, r, b, t, n, f) { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); }
  function xf(m, x, y, z) { return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function now() { return performance.now(); }
  // 補間數值：tw(v) 建立；to(x, ms) 開始動畫；val() 取目前值
  function tw(v) { return { a: v, b: v, t0: 0, d: 0 }; }
  function twTo(o, v, ms) { o.a = twVal(o); o.b = v; o.t0 = now(); o.d = U.reduceMotion() ? 0 : ms; }
  function twSet(o, v) { o.a = o.b = v; o.d = 0; }
  function twVal(o) { if (!o.d) return o.b; var k = (now() - o.t0) / o.d; return k >= 1 ? o.b : o.a + (o.b - o.a) * ease(Math.max(0, k)); }
  function twBusy(o) { return !!o.d && now() - o.t0 < o.d; }

  // ---------- WebGL 程式 ----------
  var VS_LINE = 'attribute vec3 aP;uniform mat4 uM;uniform float uZ;uniform float uHk;void main(){gl_Position=uM*vec4(aP.xy,uZ+aP.z*uHk,1.0);}';
  var FS_FLAT = 'precision mediump float;uniform vec4 uC;void main(){gl_FragColor=uC;}';
  // ---------- 植被地形 ----------
  // 預設的線條地圖＋一層選擇性的綠（Selective Desaturation）：底是接近背景的暗色，植被的地方先褪成灰、再變成綠
  //   uS：每 100 公尺的坡度（R 往東、G 往北、B 凹凸）→ 每個像素即時算光（太陽在西北方）；模糊過的坡度決定「哪裡綠」
  //   uC：植被比例（R 森林、G 農地、B 草地灌叢）；uB：底（R 陸地、G 城市、B 水域）
  //   綠的顏色跟著光（陰影偏藍綠、受光暖黃綠），飽和度也跟著光；色相有幾公里大的斑塊與每顆樹冠的變化
  //   細節是程式產生的：樹冠（Worley 細胞噪聲，會受光的小凸起；森林邊緣一顆一顆變少）、田塊（250 公尺的拼布）
  //   比一個螢幕像素還小的細節會淡成平均色（拉遠時不閃）；陡坡用三平面座標，細節不會被拉成直線；遠處漸暗到背景色
  var VS_TER = 'attribute vec3 aP;attribute vec2 aG;uniform mat4 uM;uniform float uHk;uniform vec4 uTB;uniform vec3 uZd;' +
    'varying vec2 vUV;varying vec2 vW;varying vec2 vG;varying float vH;varying float vD;' +
    'void main(){vW=aP.xy;vH=aP.z;vG=aG;vUV=vec2((aP.x-uTB.x)/uTB.z,(uTB.y-aP.y)/uTB.w);vec3 w=vec3(aP.xy,aP.z*uHk);vD=dot(w,uZd);gl_Position=uM*vec4(w,1.0);}';
  var FS_TER = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'uniform sampler2D uS;uniform sampler2D uC;uniform sampler2D uB;uniform vec3 uBg;uniform float uOp;uniform float uHk;uniform vec3 uSun;' +
    'uniform float uGray;uniform vec3 uFog;uniform float uDark;uniform float uBlur;uniform vec3 uP0;uniform vec3 uP1;uniform vec3 uP2;uniform vec3 uP3;uniform vec3 uF0;uniform vec3 uF1;uniform vec3 uGt;uniform float uGA2;' +
    'varying vec2 vUV;varying vec2 vW;varying vec2 vG;varying float vH;varying float vD;' +
    'float hs(vec2 c){return fract(sin(dot(c,vec2(127.1,311.7)))*43758.5453);}' +
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);i=mod(i,512.0);' +
    'return mix(mix(hs(i),hs(i+vec2(1.0,0.0)),f.x),mix(hs(i+vec2(0.0,1.0)),hs(i+vec2(1.0,1.0)),f.x),f.y);}' +
    'float fbm(vec2 p,float f){float s=0.0,t=0.0,a=1.0,sc=3.0;for(int i=0;i<5;i++){float k=clamp(sc/(f*8.0)-0.5,0.0,1.0)*a;s+=k*vn(p/sc+vec2(float(i)*17.3,float(i)*7.1));t+=k;a*=0.6;sc*=0.42;}return t>0.0?s/t:0.5;}' +
    // Worley：最近的特徵點（d1）、第二近（d2）、從特徵點指向這裡的向量（off）、這一格的亂數（id）
    'void wor(vec2 p,out float d1,out float d2,out vec2 off,out float id){vec2 i=floor(p),fr=fract(p);d1=9.0;d2=9.0;off=vec2(0.0);id=0.0;' +
    'for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 c=mod(i+g,1024.0);vec2 o=vec2(hs(c),hs(c+vec2(17.0,3.0)))*0.8+0.1;vec2 r=g+o-fr;float d=dot(r,r);' +
    'if(d<d1){d2=d1;d1=d;off=-r;id=hs(c+vec2(5.0,11.0));}else if(d<d2){d2=d;}}d1=sqrt(d1);d2=sqrt(d2);}' +
    // 一層樹冠：受光面亮、背光面暗、樹之間的縫暗一點；太小看不到時回傳 1（平均）
    'float crown(vec2 q,float s,float f,vec2 ls,float amp,float seed){float k=clamp(s/(f*1.8)-0.5,0.0,1.0);if(k<=0.0)return 1.0;' +
    'float d1,d2,id;vec2 off;wor(q/s+vec2(seed,seed*1.7),d1,d2,off,id);float r=0.5+0.22*id;float ins=1.0-smoothstep(r*0.72,r,d1);' +
    'vec2 tl=off/r*ins;float sh=1.0+amp*(dot(tl,ls)*0.9-(1.0-ins)*0.42+0.13+(id-0.5)*0.22);return mix(1.0,sh,k);}' +
    // 田塊與街廓：x＝這一塊的亂數、y＝邊界（田埂、街道）
    'vec2 cells(vec2 q,float s,float f,float seed){float k=clamp(s/(f*2.2)-0.6,0.0,1.0);if(k<=0.0)return vec2(0.5,0.0);' +
    'float d1,d2,id;vec2 off;wor(q/s+vec2(seed,0.0),d1,d2,off,id);float e=1.0-smoothstep(0.03,0.08+f/s*1.2,d2-d1);return vec2(mix(0.5,id,k),e*k);}' +
    // 某一個投影面上的細節：x 樹冠明暗、y 田塊亂數、z 田埂、w 城市街廓的明暗
    'vec4 detail(vec2 q,float f,vec2 ls,vec3 want){float c=1.0;vec2 fd=vec2(0.5,0.0);float u=1.0;' +
    'if(want.x>0.02){c=crown(q,0.045,f,ls,0.9,0.0)*crown(q,0.14,f,ls,0.7,13.0)*crown(q,0.42,f,ls,0.4,29.0);}' +
    'if(want.y>0.02){fd=cells(q,0.26,f,41.0);}' +
    'if(want.z>0.02){vec2 b=cells(q,0.13,f,71.0);u=(0.82+0.36*b.x)*(1.0-0.45*b.y);}' +
    'return vec4(c,fd.x,fd.y,u);}' +
    'vec3 hue(vec3 c,float a){vec3 k=vec3(0.57735);float ca=cos(a);return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.0-ca);}' +
    // 綠的明暗色票：陰影偏藍綠 → 中間調 → 受光面暖的黃綠 → 最亮（只在受光最強的樹冠頂）
    'vec3 pal(float t){if(t<0.45)return mix(uP0,uP1,t/0.45);if(t<0.85)return mix(uP1,uP2,(t-0.45)/0.4);return mix(uP2,uP3,clamp((t-0.85)/0.3,0.0,1.0));}' +
    'vec2 sdec(vec3 s){vec2 s2=(s.rg*255.0-128.0)/127.0;return sign(s2)*s2*s2*2.0;}' +
    'void main(){vec4 bs=texture2D(uB,vUV);if(bs.r<0.5)discard;' +
    'vec3 sl=texture2D(uS,vUV).rgb;vec2 gr=sdec(sl);float cv=(sl.b*255.0-128.0)/127.0;' +
    'vec3 sb=texture2D(uS,vUV,uBlur).rgb;vec2 grB=sdec(sb);float cvB=(sb.b*255.0-128.0)/127.0;' +   // 模糊過的地形（約 400 公尺）：決定哪裡綠
    'vec3 cov=texture2D(uC,vUV).rgb;float wat=bs.b;' +
    'vec2 fw=fwidth(vW);float f=sqrt(max(fw.x*fw.y,1e-12));' +
    // 光：坡度放大固定在 1.2–2.2 倍（不跟著地形倍率一路加到 5 倍，坡面才不會全亮或全暗）
    'float ex=clamp(uHk*0.8,1.2,2.2);vec3 N=normalize(vec3(-gr*ex,1.0));float lamN=max(dot(N,uSun),0.0)/uSun.z;' +
    'vec3 NB=normalize(vec3(-grB*ex,1.0));float lamB=max(dot(NB,uSun),0.0)/uSun.z;' +
    // 哪裡綠：植被 ×（0.75＋0.25×受光）× 山谷、緩坡 × 斑塊；受光主要拿來決定綠的明暗與色相
    'float litB=smoothstep(0.3,1.1,lamB);float valley=1.0-0.45*smoothstep(0.0,0.7,cvB);float steep=1.0-0.45*smoothstep(0.5,1.0,length(grB));' +
    'float alp=1.0-smoothstep(2.6,3.4,vH);float patch=smoothstep(0.2,0.8,0.5*vn(vW/3.5+vec2(9.0,4.0))+0.3*vn(vW/0.7+vec2(2.0,13.0))+0.2*vn(vW/0.22+vec2(7.0,3.0)));' +
    'float vegW=cov.r+0.9*cov.b+0.7*cov.g;' +
    'float G=vegW*(0.75+0.25*litB)*valley*steep*alp*(0.3+0.7*patch);' +
    // 邊緣：扭曲過的雜訊（幾公里、幾百公尺、一兩百公尺都有不規則的邊）；門檻放寬
    'vec2 wp=vW+(vec2(vn(vW/2.2+vec2(1.0,5.0)),vn(vW/2.2+vec2(8.0,2.0)))-0.5)*1.6+(vec2(vn(vW/0.45+vec2(4.0,1.0)),vn(vW/0.45+vec2(6.0,9.0)))-0.5)*0.3;' +
    'float Gn=G+(fbm(wp,f)-0.5)*0.35;' +
    'float g=smoothstep(0.36,0.88,Gn)*(1.0-clamp(wat*1.3,0.0,1.0));' +     // 綠的飽和度（約 4 成明顯綠、2–3 成淡綠）
    'float pres=smoothstep(0.1,0.55,Gn)*(1.0-clamp(wat*1.3,0.0,1.0));' +  // 植被這一層看得到的程度（更寬：先褪成灰，再褪成底）
    // 底：接近背景色，只帶很淡的山影
    'float hs2=(lamN-1.0)*0.5+0.2*cv;' +
    'vec3 base=uDark>0.5?uBg+vec3(0.034,0.038,0.044)*clamp(1.0+hs2*1.6,0.0,2.2):uBg*(1.0-0.07*clamp(1.0-hs2*1.6,0.0,2.2));' +
    'if(uGray<0.5&&pres<0.01)discard;' +
    // 樹冠、田塊：三平面座標，陡坡不拉絲
    'vec3 Ng=normalize(vec3(-vG*uHk,1.0));vec3 tw=pow(abs(Ng),vec3(4.0));tw/=tw.x+tw.y+tw.z;float ze=vH*uHk;' +
    'vec3 want=vec3(pres*(cov.r+cov.b),pres*cov.g,0.0);' +
    'vec4 dt=detail(vW,f,uSun.xy,want)*tw.z;vec2 qd=vW;float tm=tw.z;' +
    'if(tw.x>0.06){dt+=detail(vec2(vW.y,ze),f,uSun.yz,want)*tw.x;if(tw.x>tm){qd=vec2(vW.y,ze);tm=tw.x;}}else dt+=vec4(1.0,0.5,0.0,1.0)*tw.x;' +
    'if(tw.y>0.06){dt+=detail(vec2(vW.x,ze),f,uSun.xz,want)*tw.y;if(tw.y>tm){qd=vec2(vW.x,ze);}}else dt+=vec4(1.0,0.5,0.0,1.0)*tw.y;' +
    // 森林邊緣一顆一顆樹慢慢變少：每顆樹冠（約 70 公尺）依自己的亂數決定在綠色程度多少時出現
    'float cid=0.5,ck=clamp(0.07/(f*1.8)-0.5,0.0,1.0);if(ck>0.0){float d1,d2,id;vec2 of;wor(qd/0.07+vec2(3.0,8.0),d1,d2,of,id);cid=id;}' +
    'float g2=mix(g,smoothstep(cid*0.9-0.06,cid*0.9+0.06,g),ck);' +
    // 綠的顏色跟著光走（陰影偏藍綠、受光暖黃綠），幾公里大的斑塊與每顆樹冠的色相、亮度各有一點不同
    'float t=clamp(0.12+lamN*0.55,0.0,1.3)*mix(1.0,dt.x,0.9);' +
    'float hv=(vn(vW/3.0+vec2(11.0,2.0))-0.5)*0.36+(cid-0.5)*0.12*ck;' +
    'vec3 cF=hue(pal(t),hv)*(1.0+(cid-0.5)*0.16*ck);' +
    'vec3 cG=hue(pal(t*0.95),hv+0.18)*0.95;' +                                    // 草地灌叢：偏橄欖
    'vec3 cA=(dt.y<0.18?uF0*vec3(1.15,1.0,0.9):mix(uF0,uF1,dt.y))*(1.0-0.3*dt.z)*clamp(0.55+0.45*lamN,0.4,1.15);' +   // 農地：偏黃的綠、暗一點
    'float wF=cov.r,wG=0.9*cov.b,wA=0.7*cov.g,wS=max(wF+wG+wA,0.001);vec3 vc=(cF*wF+cG*wG+cA*wA)/wS;' +
    // Selective Desaturation：綠色程度只決定飽和度（亮處鮮、暗處接近灰），邊緣褪成灰而不是黑
    'float Y=dot(vc,vec3(0.3,0.59,0.11));vec3 gry=vec3(Y)*uGt*mix(0.6,1.0,g2);' +
    'float sat=g2*mix(0.25,1.0,smoothstep(0.05,0.75,t));' +
    'vec3 col=mix(base,mix(gry,vc,sat),pres*uGA2);' +
    // 遠處漸暗到背景色
    'float fz=(uFog.x-vD)/uFog.y;float fg=uFog.z*smoothstep(-0.15,1.0,fz);col=mix(col,uBg,fg);' +
    'float al=uGray<0.5?pres:1.0;' +
    'gl_FragColor=vec4(mix(uBg,col,al*uOp),1.0);}';
  // 點：aZ0／aZ1 是切片高度（0 代表在地面＝地形高度），aD 是每個點各自的延遲，讓上升看起來有層次
  var PT_Z = 'uniform float uT;uniform float uHk;uniform float uFz;uniform float uOther;' +
    'float ez(float t){return t<0.5?4.0*t*t*t:1.0-pow(-2.0*t+2.0,3.0)/2.0;}' +
    'float zAt(float z0,float z1,float d,float g){float t=ez(clamp((uT-d)/1.1,0.0,1.0));return mix(z0<0.5?g:z0,z1<0.5?g:z1,t);}' +
    'float liftAt(float z0,float z1,float d){float t=ez(clamp((uT-d)/1.1,0.0,1.0));return mix(z0,z1,t);}' +
    'uniform float uFz2;uniform float uX;' +
    'float focusA(float z1){if(uFz<-0.5)return 1.0;if(abs(z1-uFz)<0.5)return uX;if(abs(z1-uFz2)<0.5)return max(1.0-uX,uOther);return uOther;}';
  var VS_PT = 'attribute vec2 aP;attribute float aH;attribute float aZ0;attribute float aZ1;attribute float aD;attribute vec3 aC;' +
    'uniform mat4 uM;uniform float uS;uniform float uGround;varying vec3 vC;varying float vA;' + PT_Z +
    'void main(){float g=aH*uHk;float z=zAt(aZ0,aZ1,aD,g);float lift=liftAt(aZ0,aZ1,aD);' +
    'vA=(uGround>0.5?step(0.5,lift):1.0)*focusA(aZ1);gl_Position=uM*vec4(aP,uGround>0.5?g:z,1.0);gl_PointSize=uS;vC=aC;}';
  var FS_PT = 'precision mediump float;varying vec3 vC;varying float vA;uniform vec3 uBg;uniform float uA;uniform float uRing;' +
    'void main(){vec2 p=gl_PointCoord*2.0-1.0;float r=length(p);if(r>1.0||vA<0.01)discard;float e=fwidth(r);' +
    'float a=1.0-smoothstep(1.0-e*1.5,1.0,r);vec3 c=mix(vC,uBg,smoothstep(uRing-e,uRing+e,r)*step(0.01,uRing));gl_FragColor=vec4(c,a*uA*vA);}';
  var VS_STEM = 'attribute vec2 aP;attribute float aH;attribute float aZ0;attribute float aZ1;attribute float aD;attribute float aE;attribute vec3 aC;' +
    'uniform mat4 uM;uniform float uA;uniform float uUp;varying vec4 vC;' + PT_Z +
    'void main(){float g=aH*uHk;float z=zAt(aZ0,aZ1,aD,g);float lift=liftAt(aZ0,aZ1,aD);float up=step(0.5,lift);' +
    // 升起的點：從地面連到點（靠點的一端比較明顯）；在地面的點：往正上方一段、越上面越淡
    'float zt=mix(g+uUp,z,up);gl_Position=uM*vec4(aP,mix(g,zt,aE),1.0);' +
    'float al=up*(0.25+0.75*aE)+(1.0-up)*(1.0-aE)*step(0.01,uUp);vC=vec4(aC,uA*al*focusA(aZ1));}';
  var FS_STEM = 'precision mediump float;varying vec4 vC;void main(){if(vC.a<0.002)discard;gl_FragColor=vC;}';

  // ---------- 偏好設定（只存在這台裝置） ----------
  // terrain：地形高度放大倍數；lock：切換分法、看單一層時不動鏡頭；veg：植被風地形；tilt：微縮攝影效果
  // glass：霧玻璃的透明度（0–1，越大越透明）；blur：霧玻璃的散射（模糊，像素）
  // la：台灣線條（道路、等高線、海岸線、縣市界）的透明度倍率
  var PREF0 = { stem: 1, gap: 0.75, terrain: 5, dot: 1, la: 1, glass: 0.9, blur: 2, contour: false, pal: 'neon', lock: false, veg: false, tilt: false };
  var VEG_UI = false;   // 植被地形的開關先藏起來（功能保留；藏起來時一律關閉）
  // 手機（觸控、螢幕短邊不到 600px）：畫面小，圓點預設小一點
  function isPhone() { try { return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600; } catch (e) { return false; } }
  function prefDefaults() { var p = Object.assign({}, PREF0); if (isPhone()) p.dot = 0.6; return p; }
  function loadPrefs() {
    var p = prefDefaults();
    try {
      var s = JSON.parse(localStorage.getItem('tw-kids:vizPrefs3') || 'null');
      if (s && typeof s === 'object') {
        Object.keys(PREF0).forEach(function (k) { if (typeof s[k] === typeof PREF0[k]) p[k] = s[k]; });
        // 2026-11 手機圓點預設改成 0.6：之前存下來的還是舊預設 1 的話，跟著改（d2 = 已經換過）
        if (!s.d2 && s.dot === 1 && isPhone()) p.dot = 0.6;
      }
    } catch (e) { /* 忽略 */ }
    return p;
  }
  function savePrefs(p) { try { localStorage.setItem('tw-kids:vizPrefs3', JSON.stringify(Object.assign({}, p, { d2: true }))); } catch (e) { /* 忽略 */ } }

  // 同一次瀏覽只下載、解析一次（回到首頁時重用）
  var cache = null;
  function loadData(cfg) {
    if (!cache) cache = Promise.all([getBytes(window.__VIZ_MAP, cfg.vizMap).then(gunzip).then(parseMap), getJSON(window.__VIZ_PTS, cfg.vizPts)]);
    return cache;
  }

  function mount(host) {
    var cfg = window.TWKIDS || {};
    var YAW0 = 55;   // 從西南方往東北看：北部在左上、南部在右下
    var st = { theme: themeName(), filter: 'map', t0: -1e9, zoom: 1, panX: 0, panY: 0, sel: -1, hov: -1, visible: false, alive: true, full: false, focus: null, prefs: loadPrefs() };
    if (!VEG_UI) st.prefs.veg = false;
    var stage = h('div', { class: 'vz-stage' });
    var canvas = h('canvas', { class: 'vz-canvas', tabindex: '0' });
    var lbl = h('div', { class: 'vz-labels' });
    var svg = U.svg('svg', { class: 'vz-leads', 'aria-hidden': 'true' });
    var card = h('div', { class: 'vz-card', hidden: true, role: 'dialog' });
    var msg = h('div', { class: 'vz-msg' });
    var msgKey = 'load';   // 訊息（載入中、錯誤）換語言時跟著換
    var ctl = h('div', { class: 'vz-ctl' });
    var legend = h('div', { class: 'vz-legend' });
    var panel = h('div', { class: 'vz-set', hidden: true, role: 'dialog' });
    var touchy = (function () { try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })();
    var WHEEL = !!cfg.vizWheel;   // NEXT GEN：滾輪直接縮放（遊戲頁裡要按 Ctrl，一般滾動留給網頁）
    // 操作說明：右上角的小按鈕（再按一次收起）；第一次進到地圖時也會自己淡淡浮出來（guide）
    // 說明出現時按鈕照樣留著可以按：手機點一下的 click 是手指離開才補發，按鈕若先藏起來、收起說明時又冒出來，會被同一下點到又打開
    var help = h('button', { type: 'button', class: 'vz-help', 'aria-pressed': 'false', onclick: function () { if (gd.on) hideGuide(); else guide(0, true); } });
    var back = h('button', { type: 'button', class: 'vz-back', hidden: true, onclick: function () { goBack(); } });
    // 微縮攝影：畫面上下漸進模糊（只模糊地圖，名稱與按鈕不受影響）
    var tilt = h('div', { class: 'vz-tilt', hidden: true, 'aria-hidden': 'true' });
    ['t1', 't2', 't3', 'b1', 'b2', 'b3'].forEach(function (k) { tilt.appendChild(h('i', { class: k })); });
    [canvas, tilt, svg, lbl, back, legend, ctl, help, panel, card, msg].forEach(function (e) { stage.appendChild(e); });
    host.appendChild(stage);
    var bar = h('div', { class: 'vz-filters', role: 'tablist' });
    host.insertBefore(bar, stage);
    var sum = h('ul', { class: 'vz-sr' });
    host.appendChild(sum);

    var gl = null;
    try { gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: false }); } catch (e) { gl = null; }
    // 會隨語言改變的固定文字
    var MSGS = { load: ['正在載入地圖…', 'Loading the map…'], nogl: ['你的瀏覽器無法顯示 3D 地圖（需要 WebGL）。', 'Your browser can’t show the 3D map (WebGL is required).'], gl: ['你的瀏覽器無法顯示 3D 地圖。', 'Your browser can’t show the 3D map.'],
      old: ['你的瀏覽器版本太舊，無法顯示地圖。', 'Your browser is too old to show the map.'], fail: ['地圖載入失敗，請稍後再試。', 'The map failed to load. Please try again later.'] };
    function staticText() {
      canvas.setAttribute('aria-label', T('全台分享地圖：每一點是一位匿名分享的玩家。方向鍵旋轉，加號減號縮放。', 'Taiwan share map: each dot is a player who shared anonymously. Arrow keys rotate; plus and minus zoom.'));
      card.setAttribute('aria-label', T('這位玩家的選擇', 'This player’s choices'));
      panel.setAttribute('aria-label', T('顯示設定', 'Display settings'));
      bar.setAttribute('aria-label', T('分法', 'Groupings'));
      msg.textContent = T(MSGS[msgKey][0], MSGS[msgKey][1]);
      back.setAttribute('aria-label', T('回到上一步', 'Go back')); back.title = back.getAttribute('aria-label');
      back.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5"/></svg><span>' + T('上一步', 'Back') + '</span>';
      help.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.7c-.5.2-.8.6-.8 1.1v.4"/><circle cx="8" cy="11.6" r=".35"/></svg><span>' + T('操作說明', 'How to use') + '</span>';
      help.setAttribute('aria-label', T('操作說明', 'How to use the map'));
    }
    staticText();
    function fail(k) { msgKey = k; msg.textContent = T(MSGS[k][0], MSGS[k][1]); }
    if (!gl) { fail('nogl'); return { destroy: function () {} }; }
    gl.getExtension('OES_standard_derivatives');
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function prog(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, (fs.indexOf('fwidth') >= 0 ? '#extension GL_OES_standard_derivatives : enable\n' : '') + fs));
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      var o = { p: p, a: {}, u: {} }, i, n;
      for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { var a = gl.getActiveAttrib(p, i); o.a[a.name] = gl.getAttribLocation(p, a.name); }
      for (i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { var u = gl.getActiveUniform(p, i); o.u[u.name] = gl.getUniformLocation(p, u.name); }
      return o;
    }
    var P = {};
    try { P.line = prog(VS_LINE, FS_FLAT); P.pt = prog(VS_PT, FS_PT); P.stem = prog(VS_STEM, FS_STEM); }
    catch (e) { fail('gl'); return { destroy: function () {} }; }
    function buf(data, target, usage) { var b = gl.createBuffer(); gl.bindBuffer(target || gl.ARRAY_BUFFER, b); gl.bufferData(target || gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; }
    function put(b, data) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); }

    // 折線 → 多個不超過 65535 個頂點的區塊（gl.LINES + Uint16 索引）；每個頂點 (x, y, 地形高度)
    function lineChunks(L, closed, hgt) {
      var out = [];
      function flush(from, to, vstart, vend) {
        var nv = vend - vstart, idx = [], v = 0, xyz = new Float32Array(nv * 3);
        for (var k = 0; k < nv; k++) { xyz[k * 3] = L.pts[(vstart + k) * 2]; xyz[k * 3 + 1] = L.pts[(vstart + k) * 2 + 1]; xyz[k * 3 + 2] = hgt ? hgt(vstart + k) : 0; }
        for (var i = from; i < to; i++) { var n = L.lens[i]; for (var j = 0; j < n - 1; j++) idx.push(v + j, v + j + 1); if (closed && n > 2) idx.push(v + n - 1, v); v += n; }
        out.push({ vb: buf(xyz), ib: buf(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER), n: idx.length });
      }
      var vstart = 0, from = 0, cnt = 0;
      for (var i = 0; i < L.lens.length; i++) {
        if (cnt + L.lens[i] > 65000) { flush(from, i, vstart, vstart + cnt); vstart += cnt; from = i; cnt = 0; }
        cnt += L.lens[i];
      }
      if (cnt) flush(from, L.lens.length, vstart, vstart + cnt);
      return out;
    }

    var M = null, D = null, G = {}, N = 0, Zcur = null, Zto = null, delay = null, colors = null, Hpt = null;
    var BB = null, frameB = null, HULL = null, MAIN = null, MAINP = null, topH = 0;   // MAINP：台灣本島的海岸線（判斷某一點在不在島上）   // frameB：切片外框（正的長方形）；HULL：全部內容（含外島插圖）的凸包；MAIN：台灣本島的凸包；topH：地形最高點（公里，未放大）

    // ---------- 分法 ----------
    function cols() { return D.cols; }
    function prOf(i) { var t = D.cols.t[i]; return t < 0 ? null : t / 10; }
    // name、ground：[中文, 英文]
    var FILTERS = [
      { id: 'map', name: ['地圖', 'Map'] },
      { id: 'age', name: ['年齡層', 'Age'], cats: function () { return AGE_L.map(function (l, i) { return { label: l, test: function (j) { return cols().a[j] === i; } }; }); } },
      { id: 'house', name: ['住法', 'Housing'], cats: function () {
        var hd = D.dict.h, ix = function (k) { return hd.indexOf(k); };
        return [{ label: T('住長輩的房子', 'Living in a family home'), keys: ['family'] }, { label: T('租房子', 'Renting'), keys: ['rent'] }, { label: T('已經有房子', 'Already own a home'), keys: ['own'] }, { label: T('買房子', 'Buying a home'), keys: ['buyUsed', 'buyNew'] }]
          .map(function (c) { var ks = c.keys.map(ix); return { label: c.label, test: function (j) { return ks.indexOf(cols().h[j]) >= 0; } }; });
      } },
      { id: 'pr', name: ['門檻 PR', 'Threshold'] },
      { id: 'kids', name: ['孩子數', 'Kids'], cats: function () { return [1, 2, 3, 4].map(function (k) { return { label: T(k + ' 個孩子', k + (k === 1 ? ' kid' : ' kids')), test: function (j) { return cols().k[j] === k; } }; }); } },
      { id: 'care', name: ['0–2 歲誰帶', 'Childcare, 0–2'], cats: function () { return ['grandFree', 'self', 'grandPaid', 'public', 'quasi', 'private', 'helper', 'quit'].map(function (k) { var v = D.dict.cr.indexOf(k); return { label: CARE_L[k], test: function (j) { return cols().cr[j] === v; } }; }); } },
      { id: 'school', name: ['國小到高中', 'School, 1st–12th'], cats: function () { return ['public', 'privateJH', 'private', 'intl'].map(function (k) { var v = D.dict.sc.indexOf(k); return { label: SCHOOL_L[k], test: function (j) { return cols().sc[j] === v; } }; }); } },
      { id: 'life', name: ['生活水準', 'Lifestyle'], cats: function () { return ['frugal', 'normal', 'comfy'].map(function (k) { var v = D.dict.l.indexOf(k); return { label: LIFE_L[k], test: function (j) { return cols().l[j] === v; } }; }); } },
      { id: 'verdict', name: ['審查結果', 'Verdict'], ground: ['沒填收入', 'No income given'], cats: function () { return ['broke', 'fail', 'tight', 'pass'].map(function (k) { var v = D.dict.vd.indexOf(k); return { label: VERD_L[k], test: function (j) { return cols().vd[j] === v; } }; }); } }
    ];
    var PR_H = 300, GAP = 98;   // GAP：相鄰切片的高度差（公里，再乘上設定裡的間距倍率）
    var MAP_PITCH = 40, CAT_PITCH = 28;   // 預設俯角：地圖、切片
    function hk() { return st.prefs.terrain; }   // 地形高度放大倍數（真實比例看不出起伏）；植被地形也用同一個，切換時地形不會變形
    function baseZ() { return topH * hk() + 10; }   // 切片從地形最高點上方開始
    function catCount(id) { var f = FILTERS.filter(function (x) { return x.id === id; })[0]; return f && f.cats ? f.cats().length : 0; }
    // 預設角度：從西南方斜斜往東北看（北部在左上、南部在右下），每種分法都一樣，切換時鏡頭不會亂轉
    function viewFor(id) { return { yaw: YAW0, pitch: id === 'map' ? MAP_PITCH : CAT_PITCH }; }
    function median(a) { if (!a.length) return null; a.sort(function (x, y) { return x - y; }); var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
    // 切片清單（只算內容，不含高度）
    function sliceDefs(id) {
      var f = FILTERS.filter(function (x) { return x.id === id; })[0], out = [], cat = new Int16Array(N).fill(-1);
      if (id === 'pr') { [0, 20, 40, 60, 80, 100].forEach(function (p) { out.push({ key: 'pr' + p, label: T('PR ' + p, ord(p) + ' %ile'), ref: true, pr: p }); }); return { list: out, cat: cat }; }
      if (!f || !f.cats) return { list: out, cat: cat };
      var cs = f.cats(), prs = cs.map(function () { return []; }), cnt = cs.map(function () { return 0; }), left = 0;
      for (var j = 0; j < N; j++) {
        for (var c = 0; c < cs.length; c++) if (cs[c].test(j)) { cat[j] = c; cnt[c]++; var p2 = prOf(j); if (p2 != null) prs[c].push(p2); break; }
        if (cat[j] < 0) left++;
      }
      if (f.ground && left) out.push({ key: id + ':g', label: T(f.ground[0], f.ground[1]), n: left, ground: true, idx: -1 });
      cs.forEach(function (c, k) { out.push({ key: id + ':' + k, label: c.label, n: cnt[k], med: median(prs[k]), idx: k }); });
      return { list: out, cat: cat };
    }
    // 依目前的設定（間距、地形高度）算每一層的高度與每個點的目標高度
    var S = { list: [], leaving: [], cat: null, gap: 0, view: null };
    function heights() {
      var z = new Float32Array(N), b = baseZ(), g = S.gap * st.prefs.gap;
      if (st.filter === 'pr') {
        S.list.forEach(function (s) { s.zT = b + s.pr / 100 * PR_H * st.prefs.gap; });
        for (var i = 0; i < N; i++) { var pr = prOf(i); z[i] = pr == null ? 0 : b + pr / 100 * PR_H * st.prefs.gap; }
      } else {
        S.list.forEach(function (s) { s.zT = s.ground ? 0 : b + s.idx * g; });
        for (var j = 0; j < N; j++) z[j] = S.cat[j] >= 0 ? b + S.cat[j] * g : 0;
      }
      return z;
    }
    function setFilter(id, instant) {
      var changed = st.filter !== id || !S.cat;
      st.filter = id;
      if (st.focus) st.focus = null;
      st.backCam = null; back.hidden = true;
      var v = viewFor(id), sd = sliceDefs(id);
      S.view = v;
      S.gap = GAP;
      // 舊的切片淡出，新的從地面升起並淡入
      var old = {}; S.list.forEach(function (s) { old[s.key] = s; });
      if (changed) {
        S.list.forEach(function (s) { twTo(s.al, 0, instant ? 0 : 450); s.leave = now(); S.leaving.push(s); });
        S.list = sd.list.map(function (s) { s.z = tw(0); s.al = tw(0); twTo(s.al, 1, instant ? 0 : 700); return s; });
      } else S.list = sd.list.map(function (s) { var o = old[s.key]; s.z = o ? o.z : tw(0); s.al = o ? o.al : tw(1); return s; });
      S.cat = sd.cat;
      var nz = heights();
      S.list.forEach(function (s) { twTo(s.z, s.zT, instant ? 0 : 1100); });
      for (var i = 0; i < N; i++) { Zcur[i] = curLift(i); Zto[i] = nz[i]; delay[i] = instant || U.reduceMotion() ? -9 : Math.random() * 0.45; }
      upload();
      st.t0 = now(); if (instant || U.reduceMotion()) st.t0 -= 5000;
      twSet(st.other, 1); st.fz = -1;
      [].forEach.call(bar.children, function (b) { var on = b.getAttribute('data-id') === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      syncLabels(); summary();
      if (instant || !st.prefs.lock) refit(!instant, v);   // 固定鏡頭時，換分法不動鏡頭
      if (st.sel >= 0) showCard(st.sel);
      kick();
    }
    // 設定改變（間距、地形高度）：切片與點直接移到新高度
    function relayout() {
      if (!S.cat) return;
      var nz = heights();
      S.list.forEach(function (s) { twSet(s.z, s.zT); });
      for (var i = 0; i < N; i++) { Zcur[i] = Zto[i] = nz[i]; delay[i] = -9; }
      upload(); st.t0 = now() - 5000;
      if (st.focus) st.fz = st.focus.zT;
      kick();
    }
    // 點目前離地多高（0 = 在地面）
    function curT(i) { var t = (now() - st.t0) / 1000 - delay[i]; return ease(Math.max(0, Math.min(1, t / 1.1))); }
    function curLift(i) { if (!Zcur) return 0; return Zcur[i] + (Zto[i] - Zcur[i]) * curT(i); }
    // 點在畫面上的實際高度（在地面時＝地形高度），和著色器的算法相同
    function curZ(i) { var g = Hpt[i] * hk(), t = curT(i), z0 = Zcur[i] < 0.5 ? g : Zcur[i], z1 = Zto[i] < 0.5 ? g : Zto[i]; return z0 + (z1 - z0) * t; }
    function animating() { return (now() - st.t0) / 1000 < 1.7 || S.leaving.length > 0 || S.list.some(function (s) { return twBusy(s.z) || twBusy(s.al); }) || twBusy(st.other) || twBusy(st.fx); }

    // ---------- 點的緩衝區 ----------
    function buildPoints() {
      var c = D.cols; N = c.x.length;
      Zcur = new Float32Array(N); Zto = new Float32Array(N); delay = new Float32Array(N); Hpt = new Float32Array(N);
      var xy = new Float32Array(N * 2);
      for (var i = 0; i < N; i++) { xy[i * 2] = c.x[i] / 100; xy[i * 2 + 1] = c.y[i] / 100; Hpt[i] = heightAt(M.dem, xy[i * 2], xy[i * 2 + 1]); }
      G.xy = xy;
      G.pXY = buf(xy); G.pH = buf(Hpt); G.pZ0 = gl.createBuffer(); G.pZ1 = gl.createBuffer(); G.pD = gl.createBuffer(); G.pC = gl.createBuffer();
      var sxy = new Float32Array(N * 4), se = new Float32Array(N * 2);
      for (i = 0; i < N; i++) { sxy[i * 4] = sxy[i * 4 + 2] = xy[i * 2]; sxy[i * 4 + 1] = sxy[i * 4 + 3] = xy[i * 2 + 1]; se[i * 2] = 0; se[i * 2 + 1] = 1; }
      G.sXY = buf(sxy); G.sE = buf(se); G.sH = buf(dup(Hpt, 1)); G.sZ0 = gl.createBuffer(); G.sZ1 = gl.createBuffer(); G.sD = gl.createBuffer(); G.sC = gl.createBuffer();
      recolor();
    }
    function dup(a, k) { var o = new Float32Array(a.length * 2); for (var i = 0; i < a.length / k; i++) for (var j = 0; j < k; j++) { o[i * 2 * k + j] = a[i * k + j]; o[i * 2 * k + k + j] = a[i * k + j]; } return o; }
    function upload() {
      [[G.pZ0, Zcur, G.sZ0], [G.pZ1, Zto, G.sZ1], [G.pD, delay, G.sD]].forEach(function (x) { put(x[0], x[1]); put(x[2], dup(x[1], 1)); });
    }
    function colorOf(pr) { return pr == null ? [0.55, 0.55, 0.55] : palColor(st.theme, prU(pr), st.prefs.pal); }
    function recolor() {
      colors = new Float32Array(N * 3);
      var cache = {};
      for (var i = 0; i < N; i++) {
        var pr = prOf(i), k = pr == null ? -1 : Math.round(pr * 10);
        var col = cache[k] || (cache[k] = colorOf(pr));
        colors[i * 3] = col[0]; colors[i * 3 + 1] = col[1]; colors[i * 3 + 2] = col[2];
      }
      put(G.pC, colors); put(G.sC, dup(colors, 3));
      drawLegend();
      if (st.sel >= 0) showCard(st.sel);
    }

    // ---------- 相機 ----------
    st.yaw = YAW0; st.pitch = 52; st.piv = [0, 0, 0];
    // 相機：繞著樞紐點 st.piv 轉；cam.cx／cam.cy 是畫面中心相對樞紐點的位置（相機座標）
    var cam = { cx: 0, cy: 0, hh: 200, from: null, to: null, ta: 0, dur: 1100 };
    function viewM() { return viewMat(st.piv, st.yaw, st.pitch, 1500); }
    function stageSize() { return { w: stage.clientWidth || 1, h: stage.clientHeight || 1 }; }
    function leftPad() { var w = stageSize().w; return st.filter === 'map' ? 0 : w < 560 ? 92 : 176; }
    function labW() { var l = leftPad(); return l ? l + (stageSize().w < 560 ? 16 : 56) : 0; }   // 名稱欄＋到切片的引線
    var PADX = 12;   // 內容（含右邊的切片名稱）到畫面左右邊的距離
    // 右邊要留的寬度：引線＋切片名稱實際的文字寬度（不是整個名稱欄）
    function sideW() { var l = leftPad(); return l ? labW() - l + (st.labTW || l - 10) : 0; }
    function labTextW() {
      var w = 0, rg = document.createRange();
      S.list.forEach(function (s) {
        var L = lblMap[s.key]; if (!L) return;
        var left = L.el.getBoundingClientRect().left, tw = document.createTreeWalker(L.el, NodeFilter.SHOW_TEXT), n;
        while ((n = tw.nextNode())) { rg.selectNodeContents(n); var r = rg.getBoundingClientRect(); if (r.width) w = Math.max(w, r.right - left); }
      });
      return Math.ceil(w);
    }
    function padB() { return stageSize().w < 560 ? 56 : 64; }
    function zRange(all) {
      var z0 = 0, z1 = topH * hk();
      if (st.focus && !all) return st.focus.ground ? [0, z1] : [st.focus.zT, st.focus.zT];
      S.list.forEach(function (s) { z1 = Math.max(z1, s.zT || 0); });
      return [z0, z1];
    }
    // 畫面範圍：放大到「台灣本島＋各層切片」剛好塞滿畫面（右邊留給切片名稱）；外框、金門馬祖等外島插圖和少數點可能被切掉
    // 正上方俯瞰（或 whole）：全部內容（含外島插圖）都放進畫面
    // 樞紐點放在內容中間（看單一層時在那一層上）
    function fitTarget(yaw, pitch, whole, allZ) {
      var sz = stageSize(), zr = zRange(allZ), xs = [], ys = [];
      var piv = [(BB[0] + BB[2]) / 2, (BB[1] + BB[3]) / 2, (zr[0] + zr[1]) / 2];
      var V = viewMat(piv, yaw, pitch, 1500);
      (whole || pitch > 89.5 ? HULL : MAIN).forEach(function (c) { zr.forEach(function (z) { var p = xf(V, c[0], c[1], z); xs.push(p[0]); ys.push(p[1]); }); });
      var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
      var padT = 18, pb = padB(), side = sideW();
      var sx = (x1 - x0) / Math.max(40, sz.w - 2 * PADX - side), sy = (y1 - y0) / Math.max(40, sz.h - padT - pb), s = Math.max(sx, sy, 0.05);
      // 地圖＋右邊的切片名稱整組左右置中（左右離畫面邊一樣遠）；上下放在「上緣到底下圖例、按鈕」這一段的正中間
      return { cx: (x0 + x1) / 2 + side / 2 * s, cy: (y0 + y1) / 2 - (pb - padT) / 2 * s, hh: s * sz.h / 2, yaw: yaw, pitch: pitch, zoom: 1, panX: 0, panY: 0, px: piv[0], py: piv[1], pz: piv[2] };
    }
    function camNow() { return { cx: cam.cx, cy: cam.cy, hh: cam.hh, yaw: st.yaw, pitch: st.pitch, zoom: st.zoom, panX: st.panX, panY: st.panY, px: st.piv[0], py: st.piv[1], pz: st.piv[2] }; }
    function camSet(t) { cam.cx = t.cx; cam.cy = t.cy; cam.hh = t.hh; st.yaw = t.yaw; st.pitch = t.pitch; st.zoom = t.zoom; st.panX = t.panX; st.panY = t.panY; st.piv = [t.px, t.py, t.pz]; }
    function camTo(t, anim, dur) {
      t = Object.assign(camNow(), t);
      if (anim && !U.reduceMotion()) {
        var dy = ((t.yaw - st.yaw) % 360 + 540) % 360 - 180;   // 轉最短的方向
        t.yaw = st.yaw + dy;
        cam.from = camNow(); cam.to = t; cam.ta = now(); cam.dur = dur || 1100;
      } else { cam.from = null; camSet(t); }
      kick();
    }
    function refit(anim, v) { if (!BB) return; v = v || { yaw: st.yaw, pitch: st.pitch }; camTo(fitTarget(v.yaw, v.pitch), anim); }
    function camStep() {
      if (!cam.from) return false;
      var k = Math.min(1, (now() - cam.ta) / cam.dur), e = ease(k), f = cam.from, t = cam.to, o = {};
      Object.keys(t).forEach(function (key) { o[key] = f[key] + (t[key] - f[key]) * e; });
      camSet(o);
      if (k >= 1) cam.from = null;
      return true;
    }
    function stopCam() { if (cam.from) { camStep(); cam.from = null; } }
    // 開場運鏡（NEXT GEN：MV 結束後）：從高處、另一個方向慢慢轉到預設視角
    function runIntro() {
      var dur = st.wantIntro; st.wantIntro = 0;
      if (U.reduceMotion()) return;
      var v = viewFor(st.filter), t = fitTarget(v.yaw, v.pitch), s = fitTarget(v.yaw - 64, 74);
      s.zoom = 0.72;
      camSet(s); camTo(t, true, dur);
    }
    function mvp() {
      var sz = stageSize(), hh = cam.hh / st.zoom, hw = hh * sz.w / sz.h, cx = cam.cx + st.panX, cy = cam.cy + st.panY;
      return mul(ortho(cx - hw, cx + hw, cy - hh, cy + hh, -4000, 4000), viewM());
    }
    function toScreen(m, x, y, z) { var sz = stageSize(), p = xf(m, x, y, z); return [(p[0] + 1) / 2 * sz.w, (1 - p[1]) / 2 * sz.h]; }
    // 對焦中心：畫面左右的正中間、上下扣掉底下的圖例與按鈕後的中間；微縮攝影對焦在這裡，轉動也繞著這一點
    function focusPt() { var sz = stageSize(); return [sz.w / 2, (sz.h - padB() + 18) / 2]; }
    // 開始旋轉前：把樞紐點移到視覺中心看到的那一點（地圖模式在地表上、看單一層時在那一層上、其他在切片中間的高度），畫面不動，之後就繞著它轉
    function onIsland(q) {   // 點在台灣本島上（射線法）
      var P = MAINP, c = false;
      for (var i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > q[1]) !== (P[j][1] > q[1]) && q[0] < (P[j][0] - P[i][0]) * (q[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
      return c;
    }
    // onPlane：切換到另一層時，樞紐點一定放在那一層上（之後只把它移到新的那一層）
    function reanchor(onPlane) {
      var sz = stageSize(), hh = cam.hh / st.zoom, hw = hh * sz.w / sz.h;
      var fp = focusPt(), sx = fp[0], sy = fp[1];
      var ox = (sx / sz.w * 2 - 1) * hw, oy = (1 - sy / sz.h * 2) * hh;
      var vx = cam.cx + st.panX + ox, vy = cam.cy + st.panY + oy;
      var yaw = st.yaw * Math.PI / 180, pit = st.pitch * Math.PI / 180, sy_ = Math.sin(yaw), cy_ = Math.cos(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
      var Z = [-sy_ * cp, -cy_ * cp, sp], X = [cy_, -sy_, 0], Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
      if (Math.abs(Z[2]) < 0.05) return;
      var T = st.piv, zr = zRange(), pz, t;
      function hit(z) { t = (z - T[2] - vx * X[2] - vy * Y[2]) / Z[2]; return [T[0] + vx * X[0] + vy * Y[0] + t * Z[0], T[1] + vx * X[1] + vy * Y[1] + t * Z[1]]; }
      function inFrame(q) { return q[0] > BB[0] && q[0] < BB[2] && q[1] > BB[1] && q[1] < BB[3]; }
      // 轉動中心＝對焦中心（視覺中心）看到的那一點：沿著視線往下找，先碰到哪一層切片上的台灣就是那一層；
      // 看單一層時只看那一層；都沒有（例如移到下面的地圖）就是地表。門檻 PR 的參考平面沒有台灣，用點雲中間的高度
      var plane = null;
      if (st.focus) { if (!st.focus.ground && (onPlane || onIsland(hit(zr[0])))) plane = zr[0]; }
      else if (st.filter === 'pr') { if (inFrame(hit((zr[0] + zr[1]) / 2))) plane = (zr[0] + zr[1]) / 2; }
      else if (st.filter !== 'map') {
        S.list.filter(function (q) { return !q.ground && !q.ref && sliceAlpha(q) > 0.3; }).sort(function (x, y) { return y.zT - x.zT; })
          .some(function (q) { if (onIsland(hit(q.zT))) { plane = q.zT; return true; } return false; });
      }
      if (plane != null) { pz = plane; hit(pz); }
      else if (M) {   // 沿著視線找到地表
        var zg = 0;
        for (var it = 0; it < 12; it++) { var q = hit(zg); zg += (heightAt(M.dem, q[0], q[1]) * hk() - zg) * 0.6; }
        pz = zg; hit(pz);
      } else { pz = plane || 0; hit(pz); }
      st.piv = [T[0] + vx * X[0] + vy * Y[0] + t * Z[0], T[1] + vx * X[1] + vy * Y[1] + t * Z[1], pz];
      cam.cx = -ox; cam.cy = -oy; st.panX = 0; st.panY = 0;
    }
    // 正上方俯瞰：接近時自動對正（北、東、南、西其中一個方向朝上）
    function snapTop(force) {
      if (!force && st.pitch < 74) return false;
      camTo({ yaw: Math.round(st.yaw / 90) * 90, pitch: 90 }, true, 650);
      return true;
    }
    function isTop() { return st.pitch > 89.5; }

    // ---------- 焦點：只看一層切片 ----------
    // st.other：其他層的透明度；st.fx：從上一個焦點換到這一個的進度（交叉淡入淡出）
    // st.backCam：看單一層之前的鏡頭（按上一步回到全部時還原）
    st.other = tw(1); st.fz = -1; st.fx = tw(1); st.fz2 = -9; st.prevKey = null; st.backCam = null;
    function sliceByKey(k) { return S.list.filter(function (x) { return x.key === k; })[0] || null; }
    function setFocus(s) {
      if (s && (s.ref || st.filter === 'map' || st.filter === 'pr')) return;
      var prev = st.focus;
      if (s && prev && s.key === prev.key) return;
      if (s && prev) { stopCam(); reanchor(true); }   // 樞紐點先放在目前這一層上，等一下只把它移到新的一層
      if (s && !prev) st.backCam = camNow();   // 回到全部時要還原的鏡頭
      st.focus = s;
      if (s && prev) { st.fz2 = prev.zT; st.prevKey = prev.key; twSet(st.fx, 0); twTo(st.fx, 1, 600); st.fz = s.zT; }
      else if (s) { st.fz = s.zT; twSet(st.fx, 1); st.prevKey = null; twTo(st.other, 0, 600); }
      else { st.prevKey = prev ? prev.key : null; twTo(st.other, 1, 600); }
      if (st.prefs.lock) { /* 固定鏡頭：不動 */ }
      else if (s && prev) {
        // 換到另一層：鏡頭不重置（角度、遠近都一樣），只跟著移到新的那一層
        camTo({ pz: s.ground ? 0 : s.zT }, true, 700);
      } else if (s) camTo(fitTarget(st.yaw, st.pitch), true, 900);   // 角度不變，只放大到這一層
      else if (st.backCam) camTo(st.backCam, true, 900);
      else camTo(fitTarget(st.yaw, isTop() ? 90 : (S.view ? S.view.pitch : st.pitch)), true, 900);
      if (!s) st.backCam = null;
      back.hidden = !st.focus;
      syncLabels();
      kick();
    }
    function goBack() { if (st.focus) setFocus(null); }   // 上一步：離開單層檢視，回到全部切片
    function sliceAlpha(s) {   // 切片目前的透明度（含淡入淡出與焦點）
      var a = twVal(s.al), o = twVal(st.other), x = twVal(st.fx);
      if (st.focus) a *= s.key === st.focus.key ? x : s.key === st.prevKey && twBusy(st.fx) ? Math.max(1 - x, o) : o;
      else if (twBusy(st.other)) a *= s.key === st.prevKey ? 1 : o;
      return a;
    }

    // ---------- 繪製 ----------
    // ---------- 植被地形（打開時才下載貼圖、建網格） ----------
    var VEG = { tx: null, bands: null, loading: false, failed: false, tb: null };
    function loadImg(src) { return new Promise(function (ok, bad) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = bad; im.src = src; }); }
    function potTex(img, size) {   // 拉成 2 的次方大小才能用 mipmap（拉遠時不閃爍）
      var cv = document.createElement('canvas'); cv.width = size; cv.height = size;
      cv.getContext('2d').drawImage(img, 0, 0, size, size);
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var an = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    }
    // 坡度貼圖：電腦用 100 公尺（4096 貼圖），手機用 200 公尺（2048）
    var vegHi = !touchy && (gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0) >= 4096;
    function buildVeg(ims) {
      var dem = M.dem, nx = dem.nx, ny = dem.ny;
      P.ter = prog(VS_TER, FS_TER);
      VEG.tx = [potTex(ims[0], vegHi ? 4096 : 2048), potTex(ims[1], 2048), potTex(ims[2], 2048)];
      VEG.tb = [dem.x0, dem.y0 + ny * dem.d, nx * dem.d, ny * dem.d];
      // 陸地（底圖縮到高度網格大小）：只建陸地附近的三角面
      var mc = document.createElement('canvas'); mc.width = nx; mc.height = ny;
      var mx = mc.getContext('2d'); mx.drawImage(ims[2], 0, 0, nx, ny);
      var px = mx.getImageData(0, 0, nx, ny).data, has = new Uint8Array(nx * ny);
      for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) has[j * nx + i] = px[((ny - 1 - j) * nx + i) * 4] > 20 ? 1 : 0;
      function isL(i, j) { return i >= 0 && j >= 0 && i < nx && j < ny && has[j * nx + i]; }
      function hg(i, j) { i = Math.max(0, Math.min(nx - 1, i)); j = Math.max(0, Math.min(ny - 1, j)); return dem.g[j * nx + i] * dem.k; }
      // 頂點：每一格的中心＋網格的坡度（三平面用）；切成好幾段，每段不超過 65000 個頂點（Uint16 索引）
      var rows = Math.floor(65000 / nx), bands = [];
      for (var r0 = 0; r0 < ny - 1; r0 += rows - 1) {
        var r1 = Math.min(ny - 1, r0 + rows - 1), nv = (r1 - r0 + 1) * nx, xyz = new Float32Array(nv * 3), gr = new Float32Array(nv * 2), idx = [];
        for (j = r0; j <= r1; j++) for (i = 0; i < nx; i++) {
          var o = (j - r0) * nx + i, v = o * 3;
          xyz[v] = dem.x0 + (i + 0.5) * dem.d; xyz[v + 1] = dem.y0 + (j + 0.5) * dem.d; xyz[v + 2] = hg(i, j);
          gr[o * 2] = (hg(i + 1, j) - hg(i - 1, j)) / (2 * dem.d); gr[o * 2 + 1] = (hg(i, j + 1) - hg(i, j - 1)) / (2 * dem.d);
        }
        for (j = r0; j < r1; j++) for (i = 0; i < nx - 1; i++) {
          var keep = false;
          for (var dj = -1; dj <= 2 && !keep; dj++) for (var di = -1; di <= 2 && !keep; di++) if (isL(i + di, j + dj)) keep = true;
          if (!keep) continue;
          var a = (j - r0) * nx + i, b = a + 1, c = a + nx, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
        if (idx.length) bands.push({ vb: buf(xyz), gb: buf(gr), ib: buf(new Uint16Array(idx), gl.ELEMENT_ARRAY_BUFFER), n: idx.length });
      }
      VEG.bands = bands;
    }
    function applyVeg(on) {
      if (on && !VEG.bands && !VEG.loading && !VEG.failed && M) {
        VEG.loading = true;
        var src = window.__VIZ_VEG || cfg.vizVeg;
        (src ? Promise.all([loadImg(vegHi ? src.s : src.sm), loadImg(src.c), loadImg(src.b)]) : Promise.reject(new Error('no-veg')))
          .then(function (ims) { if (!st.alive) return; buildVeg(ims); VEG.loading = false; kick(); })
          .catch(function () { VEG.loading = false; VEG.failed = true; });   // 手機太舊、著色器編譯不過：維持原本的線條地圖
      }
      kick();
    }
    function vegOn() { return st.prefs.veg && !!VEG.bands; }
    var VEGC = {   // 綠的色票（陰影→中間調→受光→最亮）、農地、灰的色調、不透明度、遠處漸暗（深淺模式）
      dark: { p: [[0.082, 0.204, 0.169], [0.231, 0.451, 0.2], [0.498, 0.659, 0.247], [0.71, 0.8, 0.384]], f0: [0.25, 0.29, 0.1], f1: [0.43, 0.49, 0.18], gt: [0.97, 1, 1.03], a: 0.86, fogMax: 0.55, op: 1 },
      light: { p: [[0.5, 0.62, 0.55], [0.5, 0.68, 0.45], [0.64, 0.77, 0.42], [0.76, 0.85, 0.52]], f0: [0.66, 0.7, 0.45], f1: [0.78, 0.82, 0.52], gt: [1, 1, 1], a: 0.62, fogMax: 0.5, op: 1 }
    };
    var SUN = (function () { var az = 315 * Math.PI / 180, al = 48 * Math.PI / 180; return [Math.sin(az) * Math.cos(al), Math.cos(az) * Math.cos(al), Math.sin(al)]; })();   // 太陽在西北方、高度 48 度
    function drawVeg(M4, T, dim) {
      var p = P.ter, C = VEGC[st.theme] || VEGC.dark; gl.useProgram(p.p);
      var yw = st.yaw * Math.PI / 180, pt = st.pitch * Math.PI / 180, zd = [-Math.sin(yw) * Math.cos(pt), -Math.cos(yw) * Math.cos(pt), Math.sin(pt)];
      var d0 = st.piv[0] * zd[0] + st.piv[1] * zd[1] + st.piv[2] * zd[2], rng = cam.hh / st.zoom / Math.max(0.3, Math.sin(pt)) * 1.2;
      gl.uniformMatrix4fv(p.u.uM, false, M4); gl.uniform1f(p.u.uHk, hk()); gl.uniform4f(p.u.uTB, VEG.tb[0], VEG.tb[1], VEG.tb[2], VEG.tb[3]);
      gl.uniform3fv(p.u.uZd, zd); gl.uniform3f(p.u.uFog, d0, rng, C.fogMax); gl.uniform1f(p.u.uDark, st.theme === 'dark' ? 1 : 0);
      gl.uniform3f(p.u.uBg, T.bg[0], T.bg[1], T.bg[2]); gl.uniform1f(p.u.uOp, C.op * dim); gl.uniform3fv(p.u.uSun, SUN);
      ['uP0', 'uP1', 'uP2', 'uP3'].forEach(function (u, k) { gl.uniform3fv(p.u[u], C.p[k]); });
      gl.uniform3fv(p.u.uF0, C.f0); gl.uniform3fv(p.u.uF1, C.f1); gl.uniform3fv(p.u.uGt, C.gt); gl.uniform1f(p.u.uGA2, C.a);
      gl.uniform1f(p.u.uBlur, vegHi ? 2.3 : 1.3);   // 坡度貼圖模糊到約 400 公尺（mipmap 偏移）
      gl.uniform1f(p.u.uGray, 0);   // 綠色以外的地方不畫，直接看到底下的線條地圖
      ['uS', 'uC', 'uB'].forEach(function (u, k) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, VEG.tx[k]); gl.uniform1i(p.u[u], k); });
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND);
      VEG.bands.forEach(function (c) {
        attr(p, 'aP', c.vb, 3); attr(p, 'aG', c.gb, 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib); gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
      });
      off(p);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    }
    // tw：台灣的線（道路、等高線、海岸線、縣市界），透明度乘上設定的「線條透明度」
    function drawLines(chunks, M4, z, col, a, hscale, tw) {
      if (tw) a = Math.min(1, a * st.prefs.la);
      if (a <= 0.002) return;
      var p = P.line; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uM, false, M4); gl.uniform1f(p.u.uZ, z); gl.uniform1f(p.u.uHk, hscale || 0); gl.uniform4f(p.u.uC, col[0], col[1], col[2], a);
      chunks.forEach(function (c) {
        gl.bindBuffer(gl.ARRAY_BUFFER, c.vb); gl.enableVertexAttribArray(p.a.aP); gl.vertexAttribPointer(p.a.aP, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib); gl.drawElements(gl.LINES, c.n, gl.UNSIGNED_SHORT, 0);
      });
      gl.disableVertexAttribArray(p.a.aP);
    }
    function attr(p, name, b, n) { var l = p.a[name]; if (l == null || l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, 0, 0); }
    function off(p) { for (var k in p.a) if (p.a[k] >= 0) gl.disableVertexAttribArray(p.a[k]); }
    function ptUniforms(q, M4, ut, T) {
      gl.uniformMatrix4fv(q.u.uM, false, M4); gl.uniform1f(q.u.uT, ut); gl.uniform1f(q.u.uHk, hk());
      gl.uniform1f(q.u.uFz, st.focus || twBusy(st.other) ? st.fz : -1); gl.uniform1f(q.u.uOther, twVal(st.other));
      gl.uniform1f(q.u.uFz2, twBusy(st.fx) ? st.fz2 : -9); gl.uniform1f(q.u.uX, twVal(st.fx));
      if (q.u.uBg) gl.uniform3f(q.u.uBg, T.bg[0], T.bg[1], T.bg[2]);
    }
    var drag = null;
    function frame() {
      st.raf = 0;
      if (!st.alive || !D || !M) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1), sz = stageSize();
      var W = Math.round(sz.w * dpr), H = Math.round(sz.h * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      var moving = camStep(), t = now();
      if (st.vy) {   // 拖曳旋轉放開後的慣性
        var dtf = Math.min(64, t - (st.lastFrameT || t));
        st.yaw += st.vy * dtf; st.vy *= Math.exp(-dtf / 340);
        if (Math.abs(st.vy) < 0.003) st.vy = 0; else moving = true;
      }
      st.lastFrameT = t;
      var T = THEME[st.theme], ink = T.ink, M4 = mvp(), ut = (t - st.t0) / 1000, HKv = hk();
      var busy = moving || animating() || !!drag;
      if (st.lastF && busy) { st.ft = (st.ft || 16) * 0.9 + (t - st.lastF) * 0.1; if (st.ft > 40) st.lite = true; }
      st.lastF = busy ? t : 0;
      S.leaving = S.leaving.filter(function (s) { return t - s.leave < 500; });
      if (!twBusy(st.other) && !st.focus) st.fz = -1;
      gl.viewport(0, 0, W, H);
      gl.clearColor(T.bg[0], T.bg[1], T.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      var lifted = st.filter !== 'map', dim = lifted ? 0.6 : 1;
      if (st.focus && !st.focus.ground) dim *= 0.4 + 0.6 * twVal(st.other);
      var veg = vegOn() && !st.bare;
      if (veg) drawVeg(M4, T, lifted ? 0.45 + 0.35 * dim / 0.6 : 1);
      var rd = veg ? [0.9, 0.9, 0.95, 0.95] : [1, 1, 1, 1];   // 植被地形：線條地圖照常（只稍微淡一點點），等高線很淡   // 植被地形：鮮豔的顆粒投影在地表上，原本的線條地圖照常畫
      if (!st.bare) {   // bare：自動測試用（軟體繪圖太慢），只畫海岸線與點
        if (!(st.lite && busy) && rd[0]) drawLines(G.minor, M4, 0, ink, T.minor * dim, HKv, true);
        drawLines(G.mid, M4, 0, ink, T.mid * dim * rd[1], HKv, true);
        drawLines(G.major, M4, 0, ink, T.major * dim * rd[2], HKv, true);
        if (st.prefs.contour) drawLines(G.contour, M4, 0, ink, T.contour * dim * Math.min(1, HKv / 2) * (veg ? 0.4 : 1), HKv, true);
      }
      drawLines(G.border, M4, 0, ink, T.border * dim * rd[3], HKv, true);
      drawLines(G.coast, M4, 0, ink, T.coast * (lifted ? 0.85 : 1), 0, true);
      drawLines(G.insets, M4, 0, ink, T.frame);
      // 切片：外框與海岸線（淡入淡出、跟著高度動）
      S.leaving.concat(S.list).forEach(function (s) {
        if (s.ground) return;
        var a = sliceAlpha(s), z = twVal(s.z);
        drawLines(G.frame, M4, z, ink, T.frame * a);
        if (!s.ref) { drawLines(G.coast, M4, z, ink, T.slice * a, 0, true); drawLines(G.border, M4, z, ink, T.sliceB * a, 0, true); }   // 切片上的台灣：海岸線與縣市界
      });
      if (lifted) drawLines(G.frame, M4, 0, ink, T.frame);
      // 垂直的對齊線
      var stemA = T.stem * st.prefs.stem * (lifted ? 1 : 1.6);
      if (stemA > 0.002) {
        var sp = P.stem; gl.useProgram(sp.p); ptUniforms(sp, M4, ut, T); gl.uniform1f(sp.u.uA, Math.min(1, stemA)); gl.uniform1f(sp.u.uUp, lifted ? 0 : 55);
        attr(sp, 'aP', G.sXY, 2); attr(sp, 'aH', G.sH, 1); attr(sp, 'aZ0', G.sZ0, 1); attr(sp, 'aZ1', G.sZ1, 1); attr(sp, 'aD', G.sD, 1); attr(sp, 'aE', G.sE, 1); attr(sp, 'aC', G.sC, 3);
        gl.drawArrays(gl.LINES, 0, N * 2); off(sp);
      }
      // 點：地面上的落腳點（淡），再畫點本身
      var pp = P.pt; gl.useProgram(pp.p); ptUniforms(pp, M4, ut, T);
      attr(pp, 'aP', G.pXY, 2); attr(pp, 'aH', G.pH, 1); attr(pp, 'aZ0', G.pZ0, 1); attr(pp, 'aZ1', G.pZ1, 1); attr(pp, 'aD', G.pD, 1); attr(pp, 'aC', G.pC, 3);
      var ps = Math.max(2.4, Math.min(6, 2.6 * Math.sqrt(st.zoom * (st.focus ? 1.4 : 1)))) * dpr * st.prefs.dot;
      if (lifted) { gl.uniform1f(pp.u.uGround, 1); gl.uniform1f(pp.u.uS, ps * 0.7); gl.uniform1f(pp.u.uA, 0.3); gl.uniform1f(pp.u.uRing, 0); gl.drawArrays(gl.POINTS, 0, N); }
      gl.uniform1f(pp.u.uGround, 0); gl.uniform1f(pp.u.uS, ps + 1.4 * dpr); gl.uniform1f(pp.u.uA, 1); gl.uniform1f(pp.u.uRing, 0.7);
      gl.drawArrays(gl.POINTS, 0, N);
      off(pp);
      // 選取／滑過的點
      [st.hov, st.sel].forEach(function (i, k) {
        if (i < 0 || (k === 0 && i === st.sel)) return;
        var z = curZ(i), x = G.xy[i * 2], y = G.xy[i * 2 + 1];
        if (lifted && curLift(i) > 0.5) drawSeg(M4, x, y, Hpt[i] * HKv, z, ink, 0.8);   // 從地面連到點的線
        selDraw(M4, x, y, z, ps * (k ? 3.4 : 2.8), ink, 0.8, T.bg);
        selDraw(M4, x, y, z, ps * 1.5, colors.subarray(i * 3, i * 3 + 3), 0, T.bg);
      });
      U.clear(svg);
      if (st.sel >= 0) placeCard(M4);   // 先放資訊卡（手機上名稱要排在卡片下面）
      positionLabels(M4);
      if (moving || animating() || st.lblMoving) kick();
      else if (st.lite && !st.idleDrawn) { st.idleDrawn = true; kick(); }   // 停下來後補畫一次完整的
      if (busy) st.idleDrawn = false;
    }
    var tmpB = {};
    function tb(k) { return tmpB[k] || (tmpB[k] = gl.createBuffer()); }
    function selDraw(M4, x, y, z, size, col, ring, bg) {
      var q = P.pt; gl.useProgram(q.p);
      gl.uniformMatrix4fv(q.u.uM, false, M4); gl.uniform1f(q.u.uT, 99); gl.uniform1f(q.u.uHk, 0); gl.uniform1f(q.u.uFz, -1); gl.uniform1f(q.u.uOther, 1); gl.uniform1f(q.u.uFz2, -9); gl.uniform1f(q.u.uX, 1); gl.uniform1f(q.u.uGround, 0);
      put(tb('xy'), new Float32Array([x, y])); put(tb('h'), new Float32Array([0])); put(tb('z'), new Float32Array([Math.max(z, 0.6)])); put(tb('d'), new Float32Array([0])); put(tb('c'), new Float32Array([col[0], col[1], col[2]]));
      attr(q, 'aP', tb('xy'), 2); attr(q, 'aH', tb('h'), 1); attr(q, 'aZ0', tb('z'), 1); attr(q, 'aZ1', tb('z'), 1); attr(q, 'aD', tb('d'), 1); attr(q, 'aC', tb('c'), 3);
      gl.uniform1f(q.u.uS, size); gl.uniform1f(q.u.uA, 1); gl.uniform1f(q.u.uRing, ring); gl.uniform3f(q.u.uBg, bg[0], bg[1], bg[2]);
      gl.drawArrays(gl.POINTS, 0, 1); off(q);
    }
    function drawSeg(M4, x, y, z0, z1, col, a) {
      var p = P.line; gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uM, false, M4); gl.uniform1f(p.u.uZ, 0); gl.uniform1f(p.u.uHk, 1); gl.uniform4f(p.u.uC, col[0], col[1], col[2], a);
      put(tb('seg'), new Float32Array([x, y, z0, x, y, z1]));
      gl.enableVertexAttribArray(p.a.aP); gl.vertexAttribPointer(p.a.aP, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, 2); gl.disableVertexAttribArray(p.a.aP);
    }
    function kick() { if (!st.raf && st.visible && st.alive) st.raf = requestAnimationFrame(frame); }

    // ---------- 切片名稱：平常排在切片左邊（細線連到切片）；看單一層時固定在左側中間 ----------
    var lblMap = {};   // key → { el, x, y, init }
    function fmt(n) { return U.sep(n); }
    function syncLabels() {
      var keep = {};
      S.list.forEach(function (s) {
        keep[s.key] = true;
        var L = lblMap[s.key];
        if (!L) {
          var el = h('button', { type: 'button', class: 'vz-lbl' + (s.ref ? ' ref' : '') + (s.ground ? ' ground' : ''), tabindex: s.ref ? '-1' : '0' });
          el.appendChild(h('b', {}, s.label));
          if (s.n != null) {
            var ppl = fmt(s.n) + T(' 人', s.n === 1 ? ' person' : ' people');
            if (stageSize().w < 560) { el.appendChild(h('span', {}, ppl)); if (s.med != null) el.appendChild(h('span', {}, T('中位數 PR ' + Math.round(s.med), 'median ' + ord(s.med)))); }
            else el.appendChild(h('span', {}, ppl + (s.med != null ? T('・門檻中位數 PR ' + Math.round(s.med), ' · median threshold ' + ord(s.med)) : '')));
          }
          if (!s.ref) el.addEventListener('click', function () { if (st.pickBlock) { st.pickBlock = false; return; } if (st.focus && st.focus.key === s.key) setFocus(null); else setFocus(sliceByKey(s.key)); });
          el.style.width = (leftPad() - 10) + 'px';
          lbl.appendChild(el);
          L = lblMap[s.key] = { el: el, x: 0, y: 0, init: false, s: s };
          requestAnimationFrame(function () { el.classList.add('in'); });
        }
        L.s = s;
        L.el.classList.toggle('dim', !!st.focus && st.focus.key !== s.key);
        L.el.classList.toggle('on', !!st.focus && st.focus.key === s.key);
        L.el.setAttribute('aria-pressed', st.focus && st.focus.key === s.key ? 'true' : 'false');
      });
      Object.keys(lblMap).forEach(function (k) {
        if (keep[k]) return;
        var L = lblMap[k]; delete lblMap[k];
        L.el.classList.remove('in'); L.el.classList.add('out');
        setTimeout(function () { if (L.el.parentNode) L.el.parentNode.removeChild(L.el); }, 450);
      });
      S.list.forEach(function (s) { var L = lblMap[s.key]; if (L) L.el.style.width = (leftPad() - 10) + 'px'; });
      st.labTW = labTextW();   // 名稱實際的文字寬度：畫面左右置中時用
      lbl.classList.toggle('pick', !!st.focus);
      if (!st.focus) { st.pickOff = 0; st.pickGeo = null; }
    }
    // 名稱最高可以放到哪裡：手機上資訊卡固定在右上角時，名稱排在卡片下面
    function labTop() { return card.classList.contains('dock') && !card.hidden ? card.offsetTop + card.offsetHeight + 10 : 6; }
    // 看單一層時拖動名稱列表（或在上面滾滾輪）換層
    st.pickOff = 0; st.pickDrag = false; st.pickGeo = null;
    var pk = null, wAcc = 0, wT = -1e9;
    function pickTo(i) {
      var g = st.pickGeo; if (!g || i === g.fi || i < 0 || i >= g.ord.length) return false;
      var d = g.ord[i].c - g.ord[g.fi].c; st.pickOff += d; if (pk) pk.off0 += d;   // 位置不跳：換層後列表維持在手指底下
      g.fi = i; setFocus(sliceByKey(g.ord[i].key)); return true;
    }
    lbl.addEventListener('pointerdown', function (e) { st.pickBlock = false; var el = e.target.closest && e.target.closest('.vz-lbl'); if (st.focus && el && e.button === 0) pk = { id: e.pointerId, y0: e.clientY, off0: st.pickOff, moved: false, el: el }; });
    lbl.addEventListener('pointermove', function (e) {
      if (!pk || e.pointerId !== pk.id) return;
      var dy = e.clientY - pk.y0;
      if (!pk.moved && Math.abs(dy) > 6) { pk.moved = true; st.pickDrag = true; try { pk.el.setPointerCapture(e.pointerId); } catch (x) { /* 忽略 */ } }
      if (!pk.moved || !st.focus) return;
      st.pickOff = pk.off0 + dy;
      var g = st.pickGeo;
      if (g) {   // 最靠近中間那條線的名稱就是要看的那一層
        var base = g.c0 - g.ord[g.fi].c + st.pickOff, best = g.fi, bd = Infinity;
        g.ord.forEach(function (o, i) { var d = Math.abs(base + o.c - g.c0); if (d < bd) { bd = d; best = i; } });
        pickTo(best);
      }
      kick();
    });
    function pickEnd(e) { if (!pk || e.pointerId !== pk.id) return; if (pk.moved) { st.pickDrag = false; st.pickOff = 0; st.pickBlock = e.type === 'pointerup'; kick(); } pk = null; }   // 拖完放開不算點名稱
    lbl.addEventListener('pointerup', pickEnd); lbl.addEventListener('pointercancel', pickEnd);
    lbl.addEventListener('wheel', function (e) {
      if (!st.focus || !st.pickGeo) return;
      e.preventDefault(); wAcc += e.deltaY;
      var t = now(); if (Math.abs(wAcc) < 40 || t - wT < 150) return;
      pickTo(st.pickGeo.fi + (wAcc > 0 ? 1 : -1)); wAcc = 0; wT = t;
    }, { passive: false });
    function positionLabels(M4) {
      var keys = Object.keys(lblMap); st.lblMoving = false;
      if (!keys.length) return;
      var sz = stageSize(), lp = leftPad(), items = [], maxX = -Infinity, botLim = sz.h - padB() - 8;
      keys.forEach(function (k) {
        var L = lblMap[k], s = L.s, z = twVal(s.z), best = null;
        // 那一層的台灣本島，畫面上最右邊的一點
        MAIN.forEach(function (c) { var p = toScreen(M4, c[0], c[1], z); if (!best || p[0] > best[0]) best = p; });
        items.push({ L: L, ay: best[1], ax: best[0], hgt: L.el.offsetHeight || 30, z: z, zT: s.ground ? 0 : s.zT || 0 });
        maxX = Math.max(maxX, best[0]);
      });
      var tx, column = !!st.focus || st.pitch > 76, colX = sz.w - PADX - (st.labTW || lp - 10), top = labTop();
      if (st.focus) {
        // 看單一層：名稱像滾輪選單，看的那一層固定在右側中間，拖動（或滾輪）可以換層
        var ord = items.slice().sort(function (a, b) { return b.zT - a.zT; }), tops = [], acc = 0;
        ord.forEach(function (it) { tops.push(acc); acc += it.hgt + 6; });
        var fi = 0; ord.forEach(function (it, i) { if (it.L.s.key === st.focus.key) fi = i; });
        var c0 = (top + botLim) / 2, base = c0 - (tops[fi] + ord[fi].hgt / 2) + st.pickOff;
        ord.forEach(function (it, i) { it.ty = base + tops[i]; });
        st.pickGeo = { c0: c0, fi: fi, ord: ord.map(function (it, i) { return { key: it.L.s.key, c: tops[i] + it.hgt / 2 }; }) };
        tx = colX;
      } else if (column) {
        // 正上方俯瞰：名稱固定在右側中間，高的切片在上
        var ord2 = items.slice().sort(function (a, b) { return b.zT - a.zT; }), tot = ord2.reduce(function (t, it) { return t + it.hgt + 6; }, 0), y = Math.max(top, Math.min((top + botLim - tot) / 2, botLim - tot));
        ord2.forEach(function (it) { it.ty = y; y += it.hgt + 6; });
        tx = colX;
      } else {
        // 由上到下排開，避免重疊
        var order = items.slice().sort(function (a, b) { return a.ay - b.ay; }), yy = top;
        order.forEach(function (it) { it.ty = Math.max(it.ay - it.hgt / 2, yy); yy = it.ty + it.hgt + 4; });
        if (yy > botLim) order.slice().reverse().forEach(function (it) { var lim = botLim - it.hgt; if (it.ty > lim) it.ty = lim; });
        for (var k = order.length - 2; k >= 0; k--) if (order[k].ty + order[k].hgt + 4 > order[k + 1].ty) order[k].ty = order[k + 1].ty - order[k].hgt - 4;
        // 放大後切片跑到畫面外：名稱整組移到右側中間（維持上下順序），不擠在角落
        if (order.some(function (it) { return it.ay < 0 || it.ay > sz.h; })) {
          var gh = order.reduce(function (t, it) { return t + it.hgt + 4; }, -4), cy0 = Math.max(top, Math.min((top + botLim - gh) / 2, botLim - gh));
          order.forEach(function (it) { it.ty = cy0; cy0 += it.hgt + 4; });
        }
        tx = Math.max(10, Math.min(colX, maxX + labW() - lp));   // 名稱欄緊貼在切片右邊
      }
      svg.setAttribute('viewBox', '0 0 ' + sz.w + ' ' + sz.h); svg.setAttribute('width', sz.w); svg.setAttribute('height', sz.h);
      items.forEach(function (it) {
        var L = it.L;
        if (!L.init) { L.x = tx; L.y = it.ty; L.init = true; }
        // 名稱位置平滑移動
        var nx = L.x + (tx - L.x) * 0.22, ny = st.pickDrag ? it.ty : L.y + (it.ty - L.y) * 0.22;   // 拖動名稱列表時直接跟著手指
        if (Math.abs(nx - tx) < 0.4) nx = tx; if (Math.abs(ny - it.ty) < 0.4) ny = it.ty;
        if (nx !== tx || ny !== it.ty) st.lblMoving = true;
        L.x = nx; L.y = ny;
        L.el.style.transform = 'translate(' + nx.toFixed(1) + 'px,' + ny.toFixed(1) + 'px)';
        L.el.style.width = (lp - 10) + 'px';
        var a = sliceAlpha(L.s);
        if (st.focus ? st.focus.key !== L.s.key : column) return;   // 看單一層時只連那一層；俯瞰時不畫引線
        if (a < 0.05) return;
        var ly = ny + Math.min(it.hgt / 2, 9);
        svg.appendChild(U.svg('path', { d: 'M' + (nx - 6).toFixed(1) + ' ' + ly.toFixed(1) + ' L' + it.ax.toFixed(1) + ' ' + it.ay.toFixed(1), class: 'vz-lead', style: 'opacity:' + a.toFixed(2) }));
        svg.appendChild(U.svg('circle', { cx: it.ax.toFixed(1), cy: it.ay.toFixed(1), r: 2, class: 'vz-dot', style: 'opacity:' + a.toFixed(2) }));
      });
    }

    // ---------- 圖例、按鈕、設定 ----------
    function drawLegend() {
      U.clear(legend);
      legend.appendChild(h('div', { class: 'vz-lg-t' }, T('門檻 PR', 'Threshold %ile')));
      legend.appendChild(h('div', { class: 'vz-lg-bar', style: { background: gradientCss(st.theme, st.prefs.pal) } }));
      var ticks = h('div', { class: 'vz-lg-ticks' });
      [0, 50, 80, 95, 100].forEach(function (p) { ticks.appendChild(h('span', { style: { left: (prU(p) * 100) + '%' } }, String(p))); });
      legend.appendChild(ticks);
    }
    function btn(icon, label, fn) { var b = h('button', { class: 'vz-btn', type: 'button', onclick: fn }); b.innerHTML = icon; b._lab = label; labelBtn(b); return b; }
    function labelBtn(b) { var l = T(b._lab[0], b._lab[1]); b.setAttribute('aria-label', l); b.title = l; }
    var I_PLUS = '<svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg>', I_MINUS = '<svg viewBox="0 0 20 20"><path d="M4 10h12"/></svg>';
    var I_RESET = '<svg viewBox="0 0 20 20"><path d="M4.5 8.5A6 6 0 1 1 5 13"/><path d="M4 4.5v4h4"/></svg>', I_FULL = '<svg viewBox="0 0 20 20"><path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12"/></svg>';
    var I_EXIT = '<svg viewBox="0 0 20 20"><path d="M8 3.5V8H3.5M16.5 8H12V3.5M12 16.5V12h4.5M3.5 12H8v4.5"/></svg>';
    var I_TOP = '<svg viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" rx="1"/><circle cx="10" cy="10" r="1.6"/></svg>';
    var I_SIDE = '<svg viewBox="0 0 20 20"><path d="M3 13l7-4 7 4-7 4z"/><path d="M3 9l7-4 7 4"/></svg>';
    var I_SET = '<svg viewBox="0 0 20 20"><path d="M4 6h8M15 6h1M4 14h2M9 14h7"/><circle cx="13.5" cy="6" r="1.6"/><circle cx="7.5" cy="14" r="1.6"/></svg>';
    var setBtn = btn(I_SET, ['顯示設定', 'Display settings'], function () { panel.hidden = !panel.hidden; setBtn.classList.toggle('on', !panel.hidden); if (!panel.hidden) buildPanel(); });
    var topBtn = btn(I_TOP, ['正上方俯瞰', 'Top-down view'], function () {
      if (isTop()) { var v = st.focus ? { yaw: st.yaw, pitch: 52 } : (S.view || viewFor(st.filter)); camTo(fitTarget(YAW0, v.pitch), true, 800); }
      else camTo(fitTarget(0, 90, true), true, 800);   // 固定北邊朝上、整張地圖放進畫面
    });
    // 微縮攝影：長方形文字按鈕，放在按鈕列最前面（手機上排在按鈕列上方）
    var tiltBtn = h('button', { class: 'vz-btn vz-txt', type: 'button', 'aria-pressed': 'false', onclick: function () { st.prefs.tilt = !st.prefs.tilt; savePrefs(st.prefs); applyTilt(st.prefs.tilt); if (!panel.hidden) buildPanel(); kick(); } });
    function labelTilt() { tiltBtn.textContent = T('微縮攝影', 'Tilt-shift'); tiltBtn.title = T('微縮攝影：畫面上下模糊，像拍微縮模型', 'Tilt-shift: blur the top and bottom, like a photo of a miniature model'); }
    labelTilt();
    syncTiltBtn(st.prefs.tilt);
    ctl.appendChild(tiltBtn);
    ctl.appendChild(setBtn);
    ctl.appendChild(topBtn);
    var plusBtn = btn(I_PLUS, ['放大', 'Zoom in'], function () { zoomBy(1.35); });
    var minusBtn = btn(I_MINUS, ['縮小', 'Zoom out'], function () { zoomBy(1 / 1.35); });
    var resetBtn = btn(I_RESET, ['重設視角', 'Reset view'], function () { refit(true, st.focus ? { yaw: YAW0, pitch: 52 } : viewFor(st.filter)); });
    ctl.appendChild(plusBtn); ctl.appendChild(minusBtn); ctl.appendChild(resetBtn);
    var fullBtn = btn(I_FULL, ['全螢幕', 'Fullscreen'], function () { toggleFull(); });
    ctl.appendChild(fullBtn);
    function slider(label, key, min, max, step, fmtv, onInput) {
      var row = h('label', { class: 'vz-sl' });
      var val = h('b', {}, fmtv(st.prefs[key]));
      var inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(st.prefs[key]), 'aria-label': label });
      inp.addEventListener('input', function () { st.prefs[key] = +inp.value; val.textContent = fmtv(st.prefs[key]); savePrefs(st.prefs); onInput(); });
      row.appendChild(h('span', {}, label)); row.appendChild(inp); row.appendChild(val);
      return row;
    }
    function syncTiltBtn(on) { tiltBtn.classList.toggle('on', !!on); tiltBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    function applyTilt(on) { tilt.hidden = !on; stage.classList.toggle('vz-mini', !!on); syncTiltBtn(on); }
    function applyGlass() { host.style.setProperty('--vz-glass-a', (1 - st.prefs.glass).toFixed(3)); host.style.setProperty('--vz-glass-blur', st.prefs.blur + 'px'); }
    applyGlass();
    function toggle(label, key, onChange) {
      var cb = h('input', { type: 'checkbox', checked: !!st.prefs[key], onchange: function () { st.prefs[key] = cb.checked; savePrefs(st.prefs); onChange(cb.checked); kick(); } });
      return h('label', { class: 'vz-tg' }, cb, h('i', { 'aria-hidden': 'true' }), h('span', {}, label));
    }
    function pct(v) { return Math.round(v * 100) + '%'; }
    function times(v) { return (Math.round(v * 100) / 100) + '×'; }
    function buildPanel() {
      U.clear(panel);
      panel.appendChild(h('div', { class: 'vz-set-h' }, h('span', {}, T('顯示設定', 'Display settings')), h('button', { type: 'button', class: 'vz-x', 'aria-label': T('關閉', 'Close'), onclick: function () { panel.hidden = true; setBtn.classList.remove('on'); } }, '×')));
      panel.appendChild(slider(T('對齊線透明度', 'Drop lines'), 'stem', 0, 4, 0.05, pct, function () { kick(); }));
      panel.appendChild(slider(T('切片間距', 'Slice gap'), 'gap', 0.1, 2.5, 0.05, times, function () { relayout(); if (!st.prefs.lock) refit(false, { yaw: st.yaw, pitch: st.pitch }); }));
      panel.appendChild(slider(T('地形高度倍率', 'Terrain height'), 'terrain', 0, 15, 0.5, times, function () { relayout(); kick(); }));
      panel.appendChild(slider(T('圓點大小', 'Dot size'), 'dot', 0.4, 3, 0.05, times, function () { kick(); }));
      panel.appendChild(slider(T('線條透明度', 'Map lines'), 'la', 0, 4, 0.05, pct, function () { kick(); }));
      panel.appendChild(slider(T('霧玻璃透明度', 'Glass opacity'), 'glass', 0, 1, 0.01, pct, applyGlass));
      panel.appendChild(slider(T('霧玻璃散射', 'Glass blur'), 'blur', 0, 40, 1, function (v) { return Math.round(v) + 'px'; }, applyGlass));
      panel.appendChild(h('div', { class: 'vz-tgs' },
        toggle(T('微縮攝影', 'Tilt-shift'), 'tilt', function (on) { applyTilt(on); }),
        toggle(T('顯示等高線', 'Contours'), 'contour', function () {}),
        toggle(T('固定鏡頭', 'Lock camera'), 'lock', function () {}),
        VEG_UI ? toggle(T('植被地形', 'Vegetation'), 'veg', function (on) { applyVeg(on); buildPanel(); }) : null));
      panel.appendChild(h('div', { class: 'vz-set-n' }, T('固定鏡頭：換分法、看單一層時鏡頭不動（俯瞰與重設視角照常）', 'Lock camera: the view stays put when you switch groupings or open a single slice (top-down view and reset still work).')));
      panel.appendChild(h('div', { class: 'vz-set-t' }, T('配色', 'Colors')));
      var pals = h('div', { class: 'vz-pals' });
      PALS.forEach(function (p) {
        var b = h('button', { type: 'button', class: 'vz-pal' + (st.prefs.pal === p.id ? ' on' : ''), 'aria-pressed': st.prefs.pal === p.id ? 'true' : 'false', onclick: function () { st.prefs.pal = p.id; savePrefs(st.prefs); recolor(); buildPanel(); if (st.sel >= 0) showCard(st.sel); kick(); } },
          h('i', { style: { background: gradientCss(st.theme, p.id) } }), h('span', {}, T(p.name, p.en)));
        pals.appendChild(b);
      });
      panel.appendChild(pals);
      panel.appendChild(h('button', { type: 'button', class: 'vz-reset', onclick: function () { st.prefs = prefDefaults(); savePrefs(st.prefs); recolor(); relayout(); applyVeg(false); applyTilt(false); applyGlass(); refit(true, st.focus ? { yaw: st.yaw, pitch: st.pitch } : viewFor(st.filter)); buildPanel(); } }, T('恢復預設', 'Reset to defaults')));
    }
    function zoomBy(k, cx, cy) {
      stopCam();
      // 最多縮小到整張地圖（含所有切片）大約佔畫面一半
      var W = fitTarget(st.yaw, st.pitch, true, true), zmin = Math.min(0.6, cam.hh / (W.hh * 2));
      var nz = Math.max(zmin, Math.min(16, st.zoom * k)); if (nz === st.zoom) return;
      if (cx != null) { // 以手指／游標的位置為中心縮放
        var sz = stageSize(), hh = cam.hh / st.zoom, hw = hh * sz.w / sz.h;
        var wx = (cx / sz.w * 2 - 1) * hw, wy = (1 - cy / sz.h * 2) * hh, r = st.zoom / nz;
        st.panX += wx * (1 - r); st.panY += wy * (1 - r);
      }
      st.zoom = nz; kick();
    }
    function panBy(dx, dy) {   // 螢幕上移動多少像素，畫面就跟著移動
      var sz = stageSize(), upp = 2 * cam.hh / st.zoom / sz.h;
      st.panX -= dx * upp; st.panY += dy * upp; kick();
    }
    // 全螢幕：瀏覽器支援時用真正的全螢幕（手機上會藏起網址列）；不支援時（iPhone）只把地圖鋪滿畫面
    function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    var fsOurs = false;
    function toggleFull(force) {
      var on = force == null ? !st.full : !!force;
      if (on === st.full) return;
      st.full = on;
      host.classList.toggle('vz-full', st.full);
      document.documentElement.classList.toggle('vz-lock', st.full);
      fullBtn.innerHTML = st.full ? I_EXIT : I_FULL; fullBtn._lab = st.full ? ['離開全螢幕', 'Exit fullscreen'] : ['全螢幕', 'Fullscreen']; labelBtn(fullBtn);
      var req = host.requestFullscreen || host.webkitRequestFullscreen, ex = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        if (on && req && !fsEl()) { var p = req.call(host, { navigationUI: 'hide' }); fsOurs = true; if (p && p.catch) p.catch(function () { fsOurs = false; }); }
        else if (!on && fsOurs && fsEl() === host && ex) { var q = ex.call(document); if (q && q.catch) q.catch(function () { /* 忽略 */ }); }
      } catch (e) { fsOurs = false; }
      if (!on) fsOurs = false;
      kick();
    }
    function onFsChange() { if (fsOurs && fsEl() !== host) { fsOurs = false; toggleFull(false); } }   // 用返回鍵或 Esc 離開全螢幕：地圖也回到原位
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (!panel.hidden) { panel.hidden = true; setBtn.classList.remove('on'); }
      else if (st.sel >= 0) closeCard();
      else if (st.focus) goBack();
      else if (st.full && !fsEl()) toggleFull(false);   // 真正的全螢幕由瀏覽器處理 Esc
    }
    document.addEventListener('keydown', onKey);
    // ---------- 操作說明：第一次進到地圖時淡淡浮出來；示範手勢（或滑鼠）的小動畫輪流播，旁邊標出其他可以玩的地方 ----------
    // 碰一下地圖（拖、點、滾輪、按鍵）或 16 秒後自己淡掉；右上角「操作說明」可以再叫出來
    var GKEY = 'ng:guide';
    var gd = { el: null, on: false, want: false, t: 0, auto: 0 };
    function guideSeen() { try { return localStorage.getItem(GKEY) === '1'; } catch (e) { return false; } }
    // 圖示（64×64）：觸控點、滑鼠、軌跡；會動的部分在 CSS（.vz-g-*）
    var G_PT = function (x, y, cls) { return '<g transform="translate(' + x + ' ' + y + ')"><g class="' + cls + '"><circle class="g-halo" r="10"/><circle class="g-pt" r="5.6"/></g></g>'; };
    var G_MOUSE = function (x, y, cls, b) {
      var btn = b === 'l' ? '<path class="g-btn" d="M0 -10.5V-3.5H-7A7 7 0 0 1 0 -10.5Z"/>' : b === 'r' ? '<path class="g-btn" d="M0 -10.5V-3.5H7A7 7 0 0 0 0 -10.5Z"/>' : '';
      var wh = b === 'w' ? '<path class="g-wh" d="M0 -8.4V-5.4"/>' : '<path class="g-ln" d="M0 -8.4V-5.4"/>';
      return '<g transform="translate(' + x + ' ' + y + ') scale(1.18)"><g class="' + cls + '"><rect class="g-ms" x="-7" y="-10.5" width="14" height="21" rx="7"/>' + btn + '<path class="g-ln" d="M-7 -3.5H7M0 -10.5V-8.6M0 -5.2V-3.5"/>' + wh + '</g></g>';
    };
    var G_ARC = '<path class="g-trk" d="M14 26Q32 14 50 26"/><path class="g-trk g-ah" d="M18.98 25.67L14 26L16.2 21.52M45.02 25.67L50 26L47.8 21.52"/>';
    var G_FRAME = '<g transform="translate(32 32)"><path class="g-zm" d="M-14 -8V-14H-8M8 -14H14V-8M14 8V14H8M-8 14H-14V8"/></g>';
    var G_CROSS = '<path class="g-trk" d="M32 13V51M13 32H51"/><path class="g-trk g-ah" d="M29 16L32 13L35 16M29 48L32 51L35 48M16 29L13 32L16 35M48 29L51 32L48 35"/>';
    var G_DOTS = '<g class="g-dots"><circle cx="14" cy="44" r="1.3"/><circle cx="20" cy="50" r="1.3"/><circle cx="44" cy="48" r="1.3"/><circle cx="12" cy="30" r="1.3"/><circle cx="40" cy="40" r="1.3"/></g>' +
      '<circle class="g-dot" cx="27" cy="39" r="2.8"/><g transform="translate(27 39)"><circle class="g-rip" r="5"/></g>' +
      '<g class="g-card"><path class="g-lead" d="M29.5 36.5L35 29"/><rect x="34" y="11" width="22" height="18" rx="3.5"/><path d="M38 17.5H51M38 22.5H47"/></g>';
    var G_CUR = '<g transform="translate(27 39)"><g class="g-cur"><path class="g-arrow" d="M0 0V13L3.3 9.9L5.6 15L7.8 14L5.6 9L10 8.8Z"/></g></g>';
    function guideItems() {
      var t = touchy;
      return [
        { svg: G_ARC + (t ? G_PT(32, 40, 'g-mv g-rot') : G_MOUSE(32, 42, 'g-mv g-rot', 'l')), k: t ? T('單指拖曳', 'Drag') : T('拖曳', 'Drag'), v: T('轉動視角', 'Rotate') },
        { svg: G_FRAME + (t ? '<path class="g-trk" d="M19 45L45 19"/>' + G_PT(28, 36, 'g-pa') + G_PT(36, 28, 'g-pb') : G_MOUSE(32, 33, 'g-still', 'w')), k: t ? T('雙指開合', 'Pinch') : WHEEL ? T('滾輪', 'Scroll') : T('Ctrl＋滾輪', 'Ctrl + scroll'), v: T('縮放', 'Zoom') },
        { svg: G_CROSS + (t ? G_PT(26, 32, 'g-mv g-pan') + G_PT(38, 32, 'g-mv g-pan') : G_MOUSE(32, 33, 'g-mv g-pan', 'r')), k: t ? T('雙指拖曳', 'Two-finger drag') : T('右鍵拖曳', 'Right-drag'), v: T('移動', 'Pan') },
        { svg: G_DOTS + (t ? G_PT(27, 39, 'g-tap') : G_CUR), k: t ? T('點一下光點', 'Tap a dot') : T('點一下光點', 'Click a dot'), v: T('看他的選擇', 'See their choices') }
      ];
    }
    function buildGuide() {
      if (!gd.el) { gd.el = h('div', { class: 'vz-guide', 'aria-hidden': 'true', hidden: true }); stage.insertBefore(gd.el, help); }
      U.clear(gd.el);
      var row = h('div', { class: 'vz-g-row' });
      guideItems().forEach(function (it, i) {
        var d = h('div', { class: 'vz-g-it', style: { '--dl': (-((4 - i) % 4) * 2) + 's' } });
        d.innerHTML = '<svg class="vz-g-ic" viewBox="0 0 64 64">' + it.svg + '</svg>';
        d.appendChild(h('b', {}, it.k)); d.appendChild(h('span', {}, it.v));
        row.appendChild(d);
      });
      var mid = h('div', { class: 'vz-g-mid' }, row);
      if (touchy) mid.appendChild(h('div', { class: 'vz-g-note' }, T('要捲動網頁，請滑地圖外面', 'To scroll the page, swipe outside the map')));
      gd.el.appendChild(mid);
      gd.up = h('div', { class: 'vz-g-co vz-g-up' }, h('span', {}, T('換一種分法：大家會升成一層層', 'Try a grouping: everyone rises into layers')));
      gd.dn = h('div', { class: 'vz-g-co vz-g-dn' }, h('span', {}, T('微縮攝影、配色與更多設定', 'Tilt-shift, colors & more settings')));
      gd.el.appendChild(gd.up); gd.el.appendChild(gd.dn);
    }
    // 標註的位置：照實際的按鈕位置算（分法列在地圖上方；設定在右下角，手機上「微縮攝影」排在按鈕列上方）
    function placeGuide() {
      if (!gd.el) return;
      var sr = stage.getBoundingClientRect(), W = sr.width;
      var chip = bar.children[Math.min(2, bar.children.length - 1)];
      if (chip) {
        var cr = chip.getBoundingClientRect(), x = Math.max(12, Math.min(W - 140, cr.left - sr.left + cr.width / 2));
        gd.up.style.left = x.toFixed(0) + 'px'; gd.up.style.top = Math.max(18, cr.bottom - sr.top + 18).toFixed(0) + 'px';
        gd.up.style.maxWidth = Math.max(120, W - x - 12).toFixed(0) + 'px';
        gd.up.style.setProperty('--lh', (Math.max(18, cr.bottom - sr.top + 18) - Math.max(0, cr.bottom - sr.top) - 3).toFixed(0) + 'px');
      }
      var top = Infinity, left = Infinity;
      [].forEach.call(ctl.children, function (b) { var r = b.getBoundingClientRect(); if (r.width) { top = Math.min(top, r.top); left = Math.min(left, r.left); } });
      if (top < Infinity) {
        var sb = setBtn.getBoundingClientRect(), lx = Math.max(12, left - sr.left), bottom = sr.bottom - top + 16;
        gd.dn.style.left = lx.toFixed(0) + 'px'; gd.dn.style.bottom = bottom.toFixed(0) + 'px';
        gd.dn.style.maxWidth = Math.max(120, W - lx - 12).toFixed(0) + 'px';
        gd.dn.style.setProperty('--lx', (sb.left + sb.width / 2 - sr.left - lx).toFixed(0) + 'px');
        gd.dn.style.setProperty('--lh', (sb.top - (sr.bottom - bottom) - 3).toFixed(0) + 'px');
      }
    }
    function showGuide() {
      buildGuide(); gd.el.hidden = false; placeGuide();
      void gd.el.offsetWidth; gd.el.classList.add('on');
      gd.on = true; gd.want = false; help.classList.add('on'); help.setAttribute('aria-pressed', 'true');
      try { localStorage.setItem(GKEY, '1'); } catch (e) { /* 忽略 */ }
      clearTimeout(gd.auto); gd.auto = setTimeout(hideGuide, 16000);
    }
    // delay：多久之後出現（地圖轉進來之後）；force：已經看過也要出現（按了「操作說明」）
    function guide(delay, force) {
      if (!force && guideSeen()) return;
      clearTimeout(gd.t); gd.want = true;
      gd.t = setTimeout(function tryShow() {
        if (!st.alive || !gd.want) return;
        if (!(D && BB) || !st.visible || document.hidden) { gd.t = setTimeout(tryShow, 400); return; }   // 地圖還沒好，或畫面捲走了：等一下
        showGuide();
      }, delay || 0);
    }
    function hideGuide() {
      gd.want = false; clearTimeout(gd.t);
      if (!gd.on) return;
      gd.on = false; clearTimeout(gd.auto);
      gd.el.classList.remove('on'); help.classList.remove('on'); help.setAttribute('aria-pressed', 'false');
      setTimeout(function () { if (!gd.on && gd.el) gd.el.hidden = true; }, 800);
    }
    // 開始操作地圖就收起來（還沒出現的話就不出現了）；按「操作說明」本身不算
    host.addEventListener('pointerdown', function (e) { if (!e.target.closest || !e.target.closest('.vz-help')) hideGuide(); }, true);
    host.addEventListener('wheel', function () { hideGuide(); }, { capture: true, passive: true });
    host.addEventListener('keydown', function (e) { if (!/^(Shift|Control|Alt|Meta|Tab)$/.test(e.key)) hideGuide(); }, true);

    // ---------- 篩選按鈕 ----------
    FILTERS.forEach(function (f) {
      bar.appendChild(h('button', { type: 'button', class: 'vz-chip', role: 'tab', 'data-id': f.id, 'aria-selected': 'false', onclick: function () { if (st.filter !== f.id) setFilter(f.id); else if (st.focus) setFocus(null); } }, T(f.name[0], f.name[1])));
    });

    // ---------- 點選與卡片 ----------
    function pick(sx, sy, rad) {
      var M4 = mvp(), sz = stageSize(), best = -1, bd = rad * rad, fa = twVal(st.other);
      for (var i = 0; i < N; i++) {
        if (st.focus && fa < 0.5 && Math.abs(Zto[i] - st.focus.zT) > 0.5) continue;   // 看單一層時只能點那一層
        var p = xf(M4, G.xy[i * 2], G.xy[i * 2 + 1], curZ(i));
        var dx = (p[0] + 1) / 2 * sz.w - sx, dy = (1 - p[1]) / 2 * sz.h - sy, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    // 點到切片的外框邊緣：回傳那一層
    function pickSlice(sx, sy, rad) {
      if (st.filter === 'map' || st.filter === 'pr') return null;
      var M4 = mvp(), best = null, bd = rad;
      S.list.forEach(function (s) {
        if (s.ground || sliceAlpha(s) < 0.3) return;
        var z = twVal(s.z), c = frameB.map(function (q) { return toScreen(M4, q[0], q[1], z); });
        for (var k = 0; k < 4; k++) {
          var a = c[k], b = c[(k + 1) % 4], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
          var t = Math.max(0, Math.min(1, ((sx - a[0]) * vx + (sy - a[1]) * vy) / l2));
          var d = Math.hypot(a[0] + vx * t - sx, a[1] + vy * t - sy);
          if (d < bd) { bd = d; best = s; }
        }
      });
      return best;
    }
    function cname(i) { var k = D.dict.c[D.cols.c[i]], c = DATA.COUNTY[k]; return c ? (EN() && COUNTY_EN[k] ? COUNTY_EN[k] : c.name) : ''; }
    function dname(i) {
      var d = D.cols.d[i]; if (d < 0) return '';
      var k = D.dict.c[D.cols.c[i]], list = DATA.DISTRICTS[k] || [], id = D.dict.d[d];
      var x = list.filter(function (o) { return o.id === id; })[0];
      if (!x) return '';
      return EN() ? ((DIST_EN[k] || {})[id] || DIST_EN._[id] || x.name) : x.name;
    }
    // 資訊卡：霧玻璃圓角卡片；手機固定在右上角（切片名稱上面），電腦在點的右上方、用線連過去
    function showCard(i) {
      st.sel = i; U.clear(card); card.hidden = false;
      var dk = stageSize().w < 560; card.classList.toggle('dock', dk); lbl.classList.toggle('tight', dk);
      var c = D.cols, pr = prOf(i), hd = D.dict.h[c.h[i]], hidden = D.hide.indexOf(D.dict.c[c.c[i]]) >= 0;
      card.appendChild(h('div', { class: 'vz-card-h' },
        h('span', { class: 'vz-card-k' }, 'No.' + String(i + 1).padStart(4, '0')),
        h('button', { type: 'button', class: 'vz-x', 'aria-label': T('關閉', 'Close'), onclick: closeCard }, '×')));
      card.appendChild(h('div', { class: 'vz-card-t' }, cname(i) + (dname(i) ? T('・', ' · ') + dname(i) : '')));
      var big = pr == null ? '—' : pr >= 99.95 ? '100' : (Math.round(pr * 10) / 10).toString();
      var bar = pr == null ? null : h('div', { class: 'vz-card-bar', style: { background: gradientCss(st.theme, st.prefs.pal) } }, h('i', { style: { left: (prU(pr) * 100).toFixed(1) + '%' } }));
      if (dk) {   // 手機：只留重點，一行一項
        card.appendChild(h('div', { class: 'vz-card-pr' }, h('div', { class: 'vz-card-big' }, h('span', { class: 'vz-card-l' }, T('門檻 PR', 'Threshold')), h('b', {}, big)), bar));
        var inc2 = hidden ? T('不顯示（人少）', 'hidden (too few)') : c.pa[i] < 0 ? T('沒有填', 'not given') : c.pa[i] + (c.p[i] && c.pb[i] >= 0 ? T('・伴侶 ', ' · partner ') + c.pb[i] : '');
        card.appendChild(h('div', { class: 'vz-card-c' },
          h('div', {}, (c.a[i] >= 0 ? AGE_L[c.a[i]] : '—') + (c.k[i] ? T('・' + c.k[i] + ' 個孩子', ' · ' + c.k[i] + (c.k[i] === 1 ? ' kid' : ' kids')) : '')),
          h('div', {}, HOUSE_L[hd] || '—'),
          h('div', {}, h('span', { class: 'vz-card-l' }, T('收入 PR', 'Income %ile')), ' ' + inc2)));
        kick();
        return;
      }
      var prb = h('div', { class: 'vz-card-pr' },
        h('div', { class: 'vz-card-l' }, T('門檻 PR', 'Threshold')),
        h('div', { class: 'vz-card-big' }, h('b', {}, big), h('small', {}, pr == null ? '' : pr >= 99.95 ? T('收入再高也不夠', 'No income is high enough') : T('收入要贏過 ' + Math.round(pr) + '% 的同齡人', 'Must out-earn ' + Math.round(pr) + '% of people their age'))));
      if (bar) prb.appendChild(bar);
      card.appendChild(prb);
      var g = h('div', { class: 'vz-card-g' });
      function cell(k, v, wide) { g.appendChild(h('div', { class: wide ? 'wide' : '' }, h('span', {}, k), v)); }
      cell(T('年齡層', 'Age'), h('b', {}, c.a[i] >= 0 ? AGE_L[c.a[i]] : '—'));
      cell(T('孩子', 'Kids'), h('b', {}, c.k[i] ? T(c.k[i] + ' 個', String(c.k[i])) : '—'));
      cell(T('住法', 'Housing'), h('b', {}, HOUSE_L[hd] || '—'), true);
      var inc;
      if (hidden) inc = h('b', { class: 'muted' }, T('不顯示', 'Hidden'), h('small', {}, T('這個縣市分享的人少', 'too few shared from this county')));
      else if (c.pa[i] < 0) inc = h('b', { class: 'muted' }, T('沒有填', 'Not given'));
      else inc = h('b', {}, EN() ? (c.p[i] ? 'Self ' : '') + ord(c.pa[i]) + (c.p[i] && c.pb[i] >= 0 ? ' · partner ' + ord(c.pb[i]) : '') : (c.p[i] ? '自己 ' : '') + 'PR ' + c.pa[i] + (c.p[i] && c.pb[i] >= 0 ? '・伴侶 PR ' + c.pb[i] : ''));
      cell(T('收入 PR', 'Income percentile'), inc, true);
      card.appendChild(g);
      kick();
    }
    function closeCard() { st.sel = -1; card.hidden = true; lbl.classList.remove('tight'); kick(); }
    function placeCard(M4) {
      var sz = stageSize();
      if (sz.w < 560) { card.style.transform = ''; card.classList.add('dock'); lbl.classList.add('tight'); return; }
      card.classList.remove('dock'); lbl.classList.remove('tight');
      var i = st.sel, p = toScreen(M4, G.xy[i * 2], G.xy[i * 2 + 1], curZ(i)), cw = card.offsetWidth || 220, ch = card.offsetHeight || 190;
      var gx = 64, gy = 44, x = p[0] + gx, y = p[1] - gy - ch;
      if (x + cw > sz.w - 12) x = p[0] - gx - cw;   // 右邊放不下：放到左上
      if (y < 12) y = p[1] + gy;                     // 上面放不下：放到下面
      x = Math.max(12, Math.min(sz.w - cw - 12, x)); y = Math.max(12, Math.min(sz.h - ch - padB(), y));
      card.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      // 從點拉一條線到卡片最近的角：先斜 45 度、再水平
      var cx = p[0] < x ? x : p[0] > x + cw ? x + cw : null, cy = p[1] > y + ch ? y + ch : p[1] < y ? y : null;
      if (cx == null || cy == null) return;   // 點被卡片蓋住：不畫線
      var dy = cy - p[1], dx = cx - p[0], ex = Math.abs(dx) > Math.abs(dy) ? p[0] + Math.sign(dx) * Math.abs(dy) : cx;
      svg.appendChild(U.svg('polyline', { class: 'vz-card-lead', points: [p[0], p[1], ex, cy, cx, cy].map(function (v) { return v.toFixed(1); }).join(' ') }));
      svg.appendChild(U.svg('circle', { class: 'vz-card-dot', cx: cx.toFixed(1), cy: cy.toFixed(1), r: 2.2 }));
    }

    // ---------- 操作：拖曳旋轉、點兩下再拖移動、雙指縮放與傾斜 ----------
    var ptrs = {}, moved = 0, lastTap = null;
    function ptList() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // 中鍵：不要出現瀏覽器的自動捲動
    canvas.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, type: e.pointerType };
      moved = 0; stopCam(); st.vy = 0;
      var L = ptList(), t = now();
      if (L.length === 1) {
        // 點兩下（第二下按住）、滑鼠中鍵、右鍵或 Shift：移動畫面
        var dbl = lastTap && t - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 34;
        if (dbl) clearTimeout(st.tapTimer);   // 是點兩下：取消第一下的動作
        drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch, type: e.pointerType, pan: dbl || e.button === 1 || e.button === 2 || e.shiftKey, dbl: dbl, px: e.clientX, py: e.clientY, rot: false };
        if (drag.pan) canvas.classList.add('panning');
      } else if (L.length === 2) drag = { pinch: Math.hypot(L[0].x - L[1].x, L[0].y - L[1].y), my: (L[0].y + L[1].y) / 2, mx: (L[0].x + L[1].x) / 2 };
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* 忽略 */ }
    });
    // 點兩下再拖時，手機不要捲動網頁
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });   // 地圖上的手勢都給地圖，不捲動網頁
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      if (!ptrs[e.pointerId]) {
        if (e.pointerType === 'mouse' && D) { var i = pick(e.clientX - r.left, e.clientY - r.top, 10); if (i !== st.hov) { st.hov = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; kick(); } }
        return;
      }
      ptrs[e.pointerId].x = e.clientX; ptrs[e.pointerId].y = e.clientY;
      var L = ptList();
      if (L.length === 1 && drag && drag.x != null) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (drag.pan) { panBy(e.clientX - drag.px, e.clientY - drag.py); drag.px = e.clientX; drag.py = e.clientY; return; }
        if (!drag.rot) reanchor();   // 開始轉：繞著畫面中心底下（看單一層時是那一層）的點轉
        drag.rot = true;
        var tn = now(), ny = drag.yaw - dx * 0.35;
        if (drag.lt && tn > drag.lt) drag.vy = 0.5 * (drag.vy || 0) + 0.5 * (ny - st.yaw) / (tn - drag.lt);
        drag.lt = tn;
        st.yaw = ny;
        st.pitch = Math.max(12, Math.min(90, drag.pitch + dy * 0.3));
        kick();
      } else if (L.length === 2 && drag && drag.pinch) {
        var d = Math.hypot(L[0].x - L[1].x, L[0].y - L[1].y), my = (L[0].y + L[1].y) / 2, mx = (L[0].x + L[1].x) / 2;
        moved = 99;
        // 雙指：一邊縮放一邊拖動（以兩指中間為中心縮放，再跟著兩指中間移動）
        zoomBy(d / drag.pinch, drag.mx - r.left, drag.my - r.top);
        panBy(mx - drag.mx, my - drag.my);
        drag.pinch = d; drag.mx = mx; drag.my = my;
        kick();
      }
    });
    function up(e) {
      var was = ptrs[e.pointerId], dr = drag; delete ptrs[e.pointerId];
      var L = ptList();
      canvas.classList.remove('panning');
      if (L.length === 1) drag = { x: L[0].x, y: L[0].y, yaw: st.yaw, pitch: st.pitch, type: L[0].type, px: L[0].x, py: L[0].y, rot: !!(dr && dr.rot) };
      else if (!L.length) drag = null;
      if (!L.length && dr && (dr.rot || dr.pinch) && !snapTop() && dr.vy && now() - dr.lt < 90 && Math.abs(dr.vy) > 0.02) { st.vy = Math.max(-0.6, Math.min(0.6, dr.vy)); kick(); }   // 接近正上方：自動對正；否則保留慣性
      if (e.type === 'pointerup' && was && moved < 6 && D) {
        var r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, touch = e.pointerType !== 'mouse';
        if (dr && dr.pan) {   // 點兩下（沒有拖）：放大；右鍵或 Shift 沒有拖：不動作
          if (!dr.dbl) { lastTap = null; kick(); return; }
          lastTap = null; zoomBy(1.6, sx, sy);
        } else {
          lastTap = { t: now(), x: e.clientX, y: e.clientY };
          // 等一下再處理，確認不是點兩下的第一下
          clearTimeout(st.tapTimer);
          st.tapTimer = setTimeout(function () {
            if (!st.alive) return;
            var i = pick(sx, sy, touch ? 20 : 10);
            if (i >= 0) showCard(i);
            else { var s = pickSlice(sx, sy, touch ? 16 : 9); if (s) { closeCard(); setFocus(s); } else closeCard(); }
          }, 260);
        }
      } else if (e.type === 'pointerup') lastTap = null;
      kick();
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && st.hov >= 0) { st.hov = -1; kick(); } });
    canvas.addEventListener('wheel', function (e) {
      if (!(WHEEL || e.ctrlKey || e.metaKey || st.full)) return;   // 一般滾動留給網頁；觸控板雙指縮放、按住 Ctrl 才縮放
      e.preventDefault();
      var r = canvas.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    canvas.addEventListener('keydown', function (e) {
      var k = e.key, done = true;
      if (/^Arrow/.test(k)) { stopCam(); reanchor(); }
      if (k === 'ArrowLeft') st.yaw += 6; else if (k === 'ArrowRight') st.yaw -= 6;
      else if (k === 'ArrowUp') st.pitch = Math.min(90, st.pitch + 4); else if (k === 'ArrowDown') st.pitch = Math.max(12, st.pitch - 4);
      else if (k === '+' || k === '=') zoomBy(1.25); else if (k === '-' || k === '_') zoomBy(0.8);
      else done = false;
      if (done) { e.preventDefault(); stopCam(); kick(); }
    });

    // ---------- 只在看得到時才畫 ----------
    var io = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (es) { es.forEach(function (en) { st.visible = en.isIntersecting; if (st.visible) kick(); }); });
      io.observe(stage);
    } else st.visible = true;
    // 大小改變（轉向、全螢幕）時重新排；手機捲動時網址列伸縮造成的小變動就不理
    var ro = null, lastSz = null;
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(function () {
        if (gd.on) placeGuide();
        var sz = stageSize();
        if (lastSz && Math.abs(sz.w - lastSz.w) < 2 && Math.abs(sz.h - lastSz.h) < 90) { kick(); return; }
        lastSz = sz;
        if (D && cam.from) { var t = cam.to, n = fitTarget(t.yaw, t.pitch); cam.to = Object.assign({}, t, { cx: n.cx, cy: n.cy, hh: n.hh }); kick(); return; }
        if (D) { if (st.focus) refit(false, { yaw: st.yaw, pitch: st.pitch }); else setFilter(st.filter, true); }
      });
      ro.observe(stage);
    }
    function onTheme() { var t = themeName(); if (t !== st.theme) { st.theme = t; host.setAttribute('data-vz-theme', t); if (D) { recolor(); if (!panel.hidden) buildPanel(); } kick(); } }
    var mo = new MutationObserver(onTheme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    var mq = null; try { mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', onTheme); } catch (e) { mq = null; }
    host.setAttribute('data-vz-theme', st.theme);

    // ---------- 給螢幕報讀器的文字摘要 ----------
    function summary() {
      U.clear(sum);
      if (!S.list.length || st.filter === 'pr') { sum.appendChild(h('li', {}, T('共 ' + fmt(N) + ' 位玩家分享。', fmt(N) + ' players shared.'))); return; }
      S.list.forEach(function (s) { if (s.n != null) sum.appendChild(h('li', {}, s.label + T('：', ': ') + fmt(s.n) + T(' 人', ' people') + (s.med != null ? T('，門檻 PR 中位數 ' + Math.round(s.med), ', median threshold ' + ord(s.med) + ' percentile') : ''))); });
    }

    // ---------- 載入 ----------
    loadData(cfg).then(function (r) {
      if (!st.alive) return;
      M = r[0]; D = r[1];
      var L = M.layers, dem = M.dem;
      var hAt = function (Ly) { return function (k) { return heightAt(dem, Ly.pts[k * 2], Ly.pts[k * 2 + 1]); }; };
      G.coast = lineChunks(L.coast, true); G.border = lineChunks(L.border, false, hAt(L.border));
      G.major = lineChunks(L.major, false, hAt(L.major)); G.mid = lineChunks(L.mid, false, hAt(L.mid)); G.minor = lineChunks(L.minor, false, hAt(L.minor));
      if (L.contour) {   // 等高線：每條線的高度存在 vals（單位 50 公尺）
        var lineOf = new Float32Array(L.contour.pts.length / 2), k = 0;
        for (var i = 0; i < L.contour.lens.length; i++) for (var j = 0; j < L.contour.lens[i]; j++) lineOf[k++] = L.contour.vals[i] * 0.05;
        G.contour = lineChunks(L.contour, false, function (q) { return lineOf[q]; });
      } else G.contour = [];
      topH = 0; if (dem) for (i = 0; i < dem.g.length; i++) topH = Math.max(topH, dem.g[i] * dem.k);
      var cp = [];
      for (i = 0; i < L.coast.pts.length; i += 2) cp.push([L.coast.pts[i], L.coast.pts[i + 1]]);
      (M.head.insets || []).forEach(function (f) { cp.push([f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]); });
      HULL = hullOf(cp);
      // 台灣本島：最長的那一條海岸線
      var at = 0, mi = 0, ml = -1;
      for (i = 0; i < L.coast.lens.length; i++) { if (L.coast.lens[i] > ml) { ml = L.coast.lens[i]; mi = at; } at += L.coast.lens[i]; }
      var mp = []; for (i = 0; i < ml; i++) mp.push([L.coast.pts[(mi + i) * 2], L.coast.pts[(mi + i) * 2 + 1]]);
      MAIN = hullOf(mp); MAINP = mp;
      // 切片外框：正的長方形（地圖範圍外推 8 公里）
      var b = M.head.bbox, pad = 8;
      BB = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
      frameB = [[BB[0], BB[1]], [BB[2], BB[1]], [BB[2], BB[3]], [BB[0], BB[3]]];
      G.frame = lineChunks({ pts: new Float32Array([].concat.apply([], frameB)), lens: new Uint32Array([4]) }, true);
      var ip = [], il = [];
      (M.head.insets || []).forEach(function (f) { ip.push(f[0], f[1], f[2], f[1], f[2], f[3], f[0], f[3]); il.push(4); });
      G.insets = lineChunks({ pts: new Float32Array(ip), lens: new Uint32Array(il) }, true);
      buildPoints();
      applyTilt(st.prefs.tilt); if (st.prefs.veg) applyVeg(true);
      msg.hidden = true;
      host.classList.add('ready');
      setFilter('map', true);
      if (st.wantIntro) runIntro();
    }).catch(function (e) {
      cache = null;
      fail(e && e.message === 'old-browser' ? 'old' : 'fail');
    });

    // ---------- 換語言：畫面上所有文字重畫（切片名稱、圖例、按鈕、設定、資訊卡、操作說明） ----------
    function relang() {
      useLang(); staticText(); labelTilt();
      [setBtn, topBtn, plusBtn, minusBtn, resetBtn, fullBtn].forEach(labelBtn);
      [].forEach.call(bar.children, function (b) { var f = FILTERS.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0]; if (f) b.textContent = T(f.name[0], f.name[1]); });
      drawLegend();
      if (D && S.cat) {
        var by = {}; sliceDefs(st.filter).list.forEach(function (x) { by[x.key] = x; });
        S.list.forEach(function (x) { if (by[x.key]) x.label = by[x.key].label; });
        Object.keys(lblMap).forEach(function (k) { var L = lblMap[k]; if (L.el.parentNode) L.el.parentNode.removeChild(L.el); delete lblMap[k]; });
        syncLabels(); summary();
        if (st.sel >= 0) showCard(st.sel);
      }
      if (!panel.hidden) buildPanel();
      if (gd.on) { buildGuide(); placeGuide(); }
      kick();
    }
    if (window.I18N) I18N.on(relang);

    return {
      guide: function (delay, force) { guide(delay, force); },
      hideGuide: hideGuide,
      relang: relang,
      _gd: gd,
      destroy: function () {
        st.alive = false; if (st.raf) cancelAnimationFrame(st.raf); clearTimeout(st.tapTimer);
        if (io) io.disconnect(); if (ro) ro.disconnect(); mo.disconnect();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onTheme);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('fullscreenchange', onFsChange); document.removeEventListener('webkitfullscreenchange', onFsChange);
        document.documentElement.classList.remove('vz-lock');
        var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
      },
      setFilter: function (id) { if (D) setFilter(id); },
      intro: function (dur) { st.wantIntro = dur || 2800; if (D && BB) runIntro(); },
      ready: function () { return !!(D && BB); },
      focus: function (k) { var s = S.list.filter(function (x) { return x.key === k || x.label === k; })[0]; setFocus(s || null); },
      slices: function () { return S.list.map(function (s) { return { key: s.key, label: s.label, z: s.zT, ground: !!s.ground, ref: !!s.ref, cx: (BB[0] + BB[2]) / 2, cy: (BB[1] + BB[3]) / 2 }; }); },
      screenAt: function (x, y, z) { return toScreen(mvp(), x, y, z); },
      sliceEdge: function (k, e, t) { e = e || 0; t = t == null ? 0.5 : t; var s = S.list.filter(function (x) { return x.key === k; })[0]; if (!s) return null; var M4 = mvp(), a = toScreen(M4, frameB[e][0], frameB[e][1], twVal(s.z)), b = toScreen(M4, frameB[(e + 1) % 4][0], frameB[(e + 1) % 4][1], twVal(s.z)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; },
      setPref: function (k, v) { st.prefs[k] = v; savePrefs(st.prefs); if (k === 'pal') recolor(); else if (k === 'veg') applyVeg(v); else if (k === 'tilt') applyTilt(v); else if (k === 'glass' || k === 'blur') applyGlass(); else relayout(); if (!panel.hidden) buildPanel(); kick(); },
      _vegReady: function () { return !!VEG.bands; },
      state: st,
      cam: cam,
      _bare: function (v) { st.bare = !!v; kick(); },
      _view: function (yaw, pitch) { refit(false, { yaw: yaw, pitch: pitch }); },
      _box: function () { var M4 = mvp(), xs = [], ys = []; (isTop() ? HULL : MAIN).forEach(function (c) { zRange().forEach(function (z) { var p = toScreen(M4, c[0], c[1], z); xs.push(p[0]); ys.push(p[1]); }); }); return [Math.min.apply(0, xs), Math.min.apply(0, ys), Math.max.apply(0, xs), Math.max.apply(0, ys)]; },
      _pickSlice: function (x, y) { var r = pickSlice(x, y, 16); return r && r.key; },
      pick: function (sx, sy) { return pick(sx, sy, 20); },
      screenOf: function (i) { return toScreen(mvp(), G.xy[i * 2], G.xy[i * 2 + 1], curZ(i)); },
      data: function () { return D; },
      show: function (i) { showCard(i); }
    };
  }
  return { mount: mount, prU: prU, palColor: palColor, PALS: PALS };
})();
