// NEXT GEN：全台分享地圖網站（開場 MV → 3D 台灣），以及兩個網站互相介紹的小欄
//   網站版   map/index.html（GitHub Pages，和遊戲同一個 repo：網址是遊戲網址 + map/）
//   預覽版   dist/map.html（claude.ai Artifact：資料全部內嵌）
// 由 build/build.js 呼叫
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const R = p => fs.readFileSync(path.join(ROOT, 'src', p), 'utf8');
const RB = p => fs.readFileSync(path.join(ROOT, p));
const hash = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 10);
const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const sep = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const strip = t => t.replace(/\nif \(typeof module !== ['"]undefined['"]\) module\.exports = [A-Z]+;\s*$/m, '\n');

const PTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'viz', 'points.json'), 'utf8'));
const N = PTS.n, DATE = PTS.date;
const SEAL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="3" y="3" width="34" height="34" rx="5" fill="#fbfcfa" stroke="#c0302b" stroke-width="3"/><text x="20" y="27.5" text-anchor="middle" font-family="Noto Serif TC,Noto Serif CJK TC,serif" font-weight="900" font-size="20" fill="#c0302b">審</text></svg>';
const NG_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="7" fill="#050506"/><g fill="#ececE6"><rect x="9" y="10" width="4" height="20"/><rect x="27" y="10" width="4" height="20"/><path d="M9 10h4l18 20h-4z"/></g><circle cx="31.5" cy="8.5" r="2.6" fill="#f0507a"/><circle cx="8.5" cy="32" r="2" fill="#4fd6e8"/></svg>';
const I_ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 12L12 4M6 4h6v6"/></svg>';
const QR_MAP = R('ng/qr-map.svg'), QR_GAME = R('ng/qr-game.svg');
const dataUrl = (p, type) => 'data:' + type + ';base64,' + RB(p).toString('base64');

// ---------- 遊戲頁：頁尾上方的 NEXT GEN 小欄 ----------
// web：網站版（圖片另存檔案、同分頁開啟）；否則 claude.ai 版（圖片內嵌、新分頁開啟）
function xpHtml(o) {
  const href = o.web ? 'map/' : o.ngUrl;
  const tgt = o.web ? '' : ' target="_blank" rel="noopener noreferrer"';
  const src1 = o.web ? 'kv-640.webp' : dataUrl('src/ng/kv-640.webp', 'image/webp');
  const src2 = o.web ? 'kv-1280.webp' : null;
  const shown = o.ngUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `<aside class="xp" aria-labelledby="xp-t">
  <div class="xp-in">
    <a class="xp-kv" href="${href}"${tgt} tabindex="-1" aria-hidden="true"><img src="${src1}"${src2 ? ` srcset="${src1} 1x, ${src2} 2x"` : ''} width="640" height="360" alt="" loading="lazy" decoding="async"></a>
    <div class="xp-txt">
      <div class="xp-k"><span>延伸作品</span><span>NEXT GEN</span></div>
      <h3 class="xp-t" id="xp-t">NEXT GEN 生育門檻可視化網頁</h3>
      <p>把 ${sep(N)} 位玩家匿名分享的養育標準放到 3D 台灣上：不同縣市、住法、托育方式的人，心中養一個孩子需要多高的收入，一眼就看得出差別。開場有專屬 MV。</p>
      <div class="xp-go"><a class="xp-btn" href="${href}"${tgt}>前往 NEXT GEN ${I_ARROW}</a><span class="xp-url">${esc(shown)}</span></div>
    </div>
    <figure class="xp-qr"><span class="xp-qr-box" role="img" aria-label="NEXT GEN 網址的 QR Code">${QR_MAP}</span><figcaption>手機掃描</figcaption></figure>
  </div>
</aside>`;
}

// ---------- NEXT GEN 網頁 ----------
function page(o) {
  const mvLen = o.mv && o.mv.len ? '約 ' + o.mv.len : '';
  const gameShown = o.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const gtgt = o.web ? '' : ' target="_blank" rel="noopener noreferrer"';
  const notes = [
    `資料更新到 ${DATE}・只計入同意匿名分享的玩家；之後取消分享的人，下次更新時移除。`,
    '分享少於 5 筆的縣市不顯示收入 PR 與審查結果。',
    '地形高度放大 5 倍，才看得出起伏；可以在右下角的設定調整。',
    '地圖：道路 © OpenStreetMap contributors（經 Overture Maps）・地形 AWS Terrain Tiles（SRTM 等）・人口密度 WorldPop・行政區界 內政部',
    o.mv && o.mv.yt ? 'MV 由 YouTube 播放（隱私強化模式：按下播放前不會設定 YouTube 的 cookie）。' : null
  ].filter(Boolean);
  // claude.ai 版：平台會補上 <html><head><body> 外框，所以不寫這幾個標籤
  const open = o.web ? `<!doctype html>
<html lang="zh-Hant-TW" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
` : '';
  return `${open}<title>NEXT GEN・生育門檻可視化網頁</title>
<meta name="description" content="${esc(o.desc)}">
${o.web ? `<link rel="canonical" href="${o.ngUrl}">
<meta property="og:type" content="website">
<meta property="og:locale" content="zh_TW">
<meta property="og:site_name" content="NEXT GEN">
<meta property="og:title" content="NEXT GEN・生育門檻可視化網頁">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${o.ngUrl}">
<meta property="og:image" content="${o.ngUrl}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="NEXT GEN 生育門檻可視化網頁：3D 台灣上的 ${sep(N)} 個光點">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
` : ''}<meta name="theme-color" content="#050506">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap">
<script>${o.web ? '' : "document.documentElement.setAttribute('data-theme', 'dark');\n"}try { if (localStorage.getItem('ng:theme') === 'light') document.documentElement.setAttribute('data-theme', 'light'); } catch (e) {}</script>
<style>
${R('viz.css')}
${R('ng.css')}
</style>
<script>window.TWKIDS = ${JSON.stringify(o.twkids)};
window.NEXTGEN = ${JSON.stringify({ mv: o.mv || null })};</script>
${o.inline || ''}${o.web ? '</head>\n<body class="ng">' : '<script>document.body.classList.add(\'ng\');</script>'}
<div class="ng-intro" id="ng-intro" role="dialog" aria-modal="true" aria-label="NEXT GEN 開場">
  <div class="ng-title">
    <img class="ng-kv" src="${o.kv}" width="1920" height="1080" alt="NEXT GEN 生育門檻可視化網頁" fetchpriority="high" decoding="async">
    <button class="ng-play" type="button"><span class="ng-play-c" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 3.2v13.6L16.4 10z"/></svg></span><span class="ng-play-t"><span class="k-key">點一下或按任意鍵，播放 MV</span><span class="k-tap">點一下，播放 MV</span></span><span class="ng-play-s">有聲音${mvLen ? '・' + mvLen : ''}</span></button>
    <a class="ng-skipall" href="#map">略過 MV，直接看地圖 →</a>
  </div>
  <div class="ng-mv"></div>
  <div class="ng-wait" aria-hidden="true"></div>
  <div class="ng-catch" aria-hidden="true"></div>
  <p class="ng-tapmsg" hidden>瀏覽器擋住了自動播放，請點影片中間的播放鍵</p>
  <div class="ng-hud">
    <button class="ng-hb ng-mute" type="button" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z"/><path d="M11 5.5c1 1.3 1 3.7 0 5M12.8 3.8c2 2.4 2 6 0 8.4"/></svg><span>靜音</span></button>
    <span class="ng-esc">ESC 略過</span>
    <button class="ng-hb ng-skip" type="button">略過 MV<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg></button>
  </div>
  <div class="ng-prog" aria-hidden="true"><i></i></div>
</div>
<header class="ng-top"><div class="ng-in">
  <a class="ng-brand" href="./" aria-label="NEXT GEN 生育門檻可視化網頁"><span class="ng-word">NEXT GEN</span><span class="ng-sub">生育門檻可視化</span></a>
  <div class="ng-head"><b>${sep(N)}</b> 個人心中，養孩子的標準</div>
  <div class="ng-acts">
    <button class="ng-btn" id="ng-mvbtn" type="button" aria-label="重播 MV" title="重播 MV"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 3.2v13.6L16.4 10z"/></svg>MV</button>
    <button class="ng-btn ic" id="ng-theme" type="button" aria-label="深色模式" aria-pressed="true" title="換成淺色"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2A5.6 5.6 0 0 0 8 2.4z" fill="currentColor" stroke="none"/></svg></button>
  </div>
</div></header>
<main>
  <section class="vz" id="map" aria-label="全台分享地圖"><div class="vz-body"></div></section>
  <section class="ng-about" id="ng-about" aria-labelledby="ng-about-t">
    <div class="ng-in">
      <a class="ng-more" id="ng-more" href="#ng-about"><span>ARCHIVE</span><span>全台分享地圖・N=${sep(N)}</span><span>往下看 <i>↓</i></span></a>
      <h2 id="ng-about-t">${sep(N)} 個人心中，<br>養孩子的標準</h2>
      <p class="ng-lede">每一點是一位在「你有資格生下一代嗎？」做完試算、選擇匿名分享的玩家；顏色是他的標準需要多高的收入（門檻 PR）。點的位置依縣市與人口密度隨機分布，不是真實住址。選一種分法，大家就會升到台灣上方的切片；點一下，可以看那個人的選擇。</p>
      <ul class="ng-notes">${notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>
  </section>
  <aside class="ng-x" aria-labelledby="ng-x-t">
    <div class="ng-in">
      <span class="ng-x-seal" aria-hidden="true">${SEAL}</span>
      <div class="ng-x-txt">
        <div class="ng-x-head"><div class="ng-x-k"><span>生育門檻測驗</span></div><h3 id="ng-x-t">你有資格生下一代嗎？</h3></div>
        <p>地圖上的每一點，都是做完這份測驗的人。用你心中養孩子的標準，加上台灣真實的房價、薪資、補助與稅制，算算你有沒有足夠的錢把孩子養大，也看看自己落在這張地圖的哪裡。約 5 分鐘。</p>
        <div class="ng-x-go"><a class="ng-x-btn" href="${o.siteUrl}"${gtgt}>開始測驗 ${I_ARROW}</a><span class="ng-x-url">${esc(gameShown)}</span></div>
      </div>
      <figure class="ng-qr"><span class="ng-qr-box" role="img" aria-label="生育門檻測驗網址的 QR Code">${QR_GAME}</span><figcaption>手機掃描</figcaption></figure>
    </div>
  </aside>
</main>
<footer class="ng-foot"><div class="ng-in">
  <span class="ng-credit"><b>CREDIT</b>製作 <a href="https://www.threads.com/@popo890827" target="_blank" rel="noopener noreferrer">popo890827</a> × Claude</span>
  <a href="${o.repo}" target="_blank" rel="noopener noreferrer">原始碼與資料來源</a>
  <span>程式碼 MIT・地圖與資料 CC BY 4.0・MV 與主視覺不在 CC BY 範圍內</span>
  <span class="ng-r">在 Threads 上追蹤 <a href="https://www.threads.com/@popo890827" target="_blank" rel="noopener noreferrer">@popo890827</a></span>
</div></footer>
<script>
${['util.js', 'data.js', 'viz.js', 'nextgen.js'].map(f => '/* ---- ' + f + ' ---- */\n' + strip(R(f))).join('\n')}
NG.start();
</script>
${o.web ? '</body>\n</html>\n' : ''}`;
}

function build(o) {
  const site = o.siteUrl.replace(/\/?$/, '/');
  const ngUrl = (o.ngUrl || site + 'map/').replace(/\/?$/, '/');
  const desc = `${sep(N)} 位玩家匿名分享的養育標準，放在 3D 台灣上：不同縣市、住法與托育方式的人，心中養孩子需要多高的收入。開場有專屬 MV。`;
  const mvCfg = o.mv || {};
  // ---- 網站版 ----
  const out = path.join(ROOT, 'map');
  fs.mkdirSync(out, { recursive: true });
  const mapB = RB('viz/map.bin.gz'), ptsB = RB('viz/points.json');
  const mapF = 'viz-map.' + hash(mapB) + '.bin.gz', ptsF = 'viz-pts.' + hash(ptsB) + '.json';
  const keep = new Set([mapF, ptsF]);
  fs.writeFileSync(path.join(out, mapF), mapB); fs.writeFileSync(path.join(out, ptsF), ptsB);
  let mvWeb = null;
  if (mvCfg.yt) mvWeb = { yt: mvCfg.yt, len: mvCfg.len };
  else { const b = RB('viz/mv-placeholder.mp4'), f = 'mv-placeholder.' + hash(b) + '.mp4'; fs.writeFileSync(path.join(out, f), b); keep.add(f); mvWeb = { src: f, len: mvCfg.len }; }
  ['kv-1920.webp', 'og.jpg'].forEach(f => { fs.copyFileSync(path.join(ROOT, 'src', 'ng', f), path.join(out, f)); keep.add(f); });
  fs.writeFileSync(path.join(out, 'favicon.svg'), NG_ICON); keep.add('favicon.svg');
  const web = page({ web: true, siteUrl: site, ngUrl, repo: o.repo, desc, kv: 'kv-1920.webp', mv: mvWeb,
    twkids: { target: 'nextgen', vizN: N, vizDate: DATE, vizMap: mapF, vizPts: ptsF } });
  fs.writeFileSync(path.join(out, 'index.html'), web); keep.add('index.html');
  // 舊的雜湊檔：只留最近一個版本（剛更新時，快取裡的舊網頁還找得到它要的檔案）
  const old = fs.readdirSync(out).filter(f => !keep.has(f)).map(f => ({ f, t: fs.statSync(path.join(out, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  const seen = {};
  old.forEach(x => { const k = x.f.replace(/\.[0-9a-f]{10}\./, '.'); if (!seen[k] && /\.[0-9a-f]{10}\./.test(x.f)) { seen[k] = 1; return; } fs.unlinkSync(path.join(out, x.f)); });
  // ---- claude.ai 預覽版：全部內嵌 ----
  const inline = `<script>window.__VIZ_MAP = "${mapB.toString('base64')}";
window.__VIZ_PTS = ${ptsB.toString('utf8').trim()};</script>
`;
  const mvDist = mvCfg.yt ? { yt: mvCfg.yt, len: mvCfg.len } : { src: dataUrl('viz/mv-placeholder.mp4', 'video/mp4'), len: mvCfg.len };
  const dist = page({ web: false, siteUrl: site, ngUrl, repo: o.repo, desc, kv: dataUrl('src/ng/kv-1920.webp', 'image/webp'), mv: mvDist, inline,
    twkids: { target: 'nextgen-artifact', local: true, vizN: N, vizDate: DATE } });
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'map.html'), dist);
  console.log('map/index.html', (Buffer.byteLength(web) / 1024).toFixed(1) + ' KB', '｜' + mapF, ptsF, mvWeb.yt ? '｜MV：YouTube ' + mvWeb.yt : '｜MV：暫代影片', '｜dist/map.html', (Buffer.byteLength(dist) / 1024 / 1024).toFixed(2) + ' MB');
}

module.exports = { xpHtml, build, N, DATE };
