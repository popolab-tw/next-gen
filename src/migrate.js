/* 搬家（2026 年 11 月）：網站從 jasontzeng123.github.io/next-gen 搬到 popolab-tw.github.io/next-gen。
   瀏覽器的紀錄是依網址分開存的，換網址後會看不到舊的紀錄；舊網址的跳轉頁會把那台裝置的紀錄
  （匿名代號、分享狀態、填到一半的答案、存檔）放在網址 # 後面帶過來，這裡收下後立刻從網址列拿掉。
   這樣之前分享過的人再分享，會更新原本那一筆，不會多出一筆；也還能用同一台裝置取消分享。
   只接受從舊網址跳轉頁過來的（看 document.referrer），新網址已經有的紀錄不覆蓋。
   ＃ 後面的資料不會送到伺服器。 */
(function () {
  'use strict';
  var h = location.hash || '', i = h.indexOf('tkmig=');
  if (i < 0) return;
  var raw = h.slice(i + 6), before = h.slice(0, i).replace(/[&#]+$/, '');
  try { history.replaceState(history.state, '', location.pathname + location.search + (before.length > 1 ? before : '')); } catch (e) { /* 忽略 */ }
  if (String(document.referrer || '').indexOf('https://jasontzeng123.github.io/') !== 0) return;
  var data = null;
  try { data = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return; }
  if (!data || typeof data !== 'object') return;
  var P = 'tw-kids:', OK = ['anon', 'shared', 'submitted', 'lastResult', 'draft', 'seen', 'qi', 'saves', 'unlocked', 'consent', 'noticeOk', 'cvd', 'theme', 'labTab', 'vizPrefs3'];
  try {
    var ls = window.localStorage, sh = ls.getItem(P + 'shared'), sharedHere = !!(sh && sh !== 'null');
    OK.forEach(function (k) {
      var v = data[k];
      if (typeof v !== 'string' || v.length > 300000) return;
      try { JSON.parse(v); } catch (e) { return; }
      if (k === 'anon' || k === 'shared') {
        // 在新網址已經分享過：保留新網址的身分；否則用舊網址的身分（舊的那一筆分享在資料庫裡）
        if (sharedHere) return;
        if (k === 'anon') { var a = JSON.parse(v); if (!a || !/^[a-z0-9]{24}$/.test(a.id || '') || !/^[a-z0-9]{40}$/.test(a.secret || '')) return; }
        ls.setItem(P + k, v); return;
      }
      if (ls.getItem(P + k) != null) return;
      ls.setItem(P + k, v);
    });
  } catch (e) { /* 無法儲存時略過 */ }
})();
