/* =========================================================================
   I18N — NEXT GEN 網站的語言（繁體中文／英文）
   ・選擇順序：網址 ?lang=zh|en → 上次自己選的（localStorage）→ 瀏覽器語言（中文 → 中文，其他 → 英文）
   ・寫在 HTML 裡的文字：元素加上 data-i18n，英文放在 data-en（純文字）、data-en-html（含標籤）、
     data-en-屬性名（例如 data-en-aria-label）；中文是原本的內容，第一次切換時另存成 data-zh…
   ・程式產生的文字：用 I18N.t('中文', 'English')；切換時 I18N.on(fn) 登記的函式會被呼叫，各自重畫
   ・遊戲網站只有中文，不用這個檔案
   ========================================================================= */
var I18N = (function () {
  'use strict';
  var KEY = 'ng:lang', LANGS = ['zh', 'en'];
  var subs = [];
  function fromUrl() { var m = /[?&]lang=([a-z]+)/i.exec(location.search || ''); var l = m && m[1].toLowerCase(); return LANGS.indexOf(l) >= 0 ? l : null; }
  function stored() { try { var l = localStorage.getItem(KEY); return LANGS.indexOf(l) >= 0 ? l : null; } catch (e) { return null; } }
  function browser() {
    var list = [];
    try { list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']).map(String); } catch (e) { list = []; }
    // 偏好語言裡有中文（例如介面是英文、但也加了中文的台灣使用者）就用中文
    return !list.length || !list[0] || list.some(function (x) { return /^zh\b/i.test(x); }) ? 'zh' : 'en';
  }
  var lang = fromUrl() || stored() || browser();

  function htmlLang(l) { return l === 'en' ? 'en' : 'zh-Hant-TW'; }
  // 寫在 HTML 裡的文字換成目前的語言
  function apply(root) {
    var els = (root || document).querySelectorAll('[data-i18n]');
    [].forEach.call(els, function (el) {
      [].slice.call(el.attributes).forEach(function (a) {
        var n = a.name; if (n.indexOf('data-en') !== 0) return;
        var what = n === 'data-en' ? '#text' : n === 'data-en-html' ? '#html' : n.slice(8);
        var zk = 'data-zh' + n.slice(7);
        if (!el.hasAttribute(zk)) el.setAttribute(zk, what === '#text' ? el.textContent : what === '#html' ? el.innerHTML : (el.getAttribute(what) || ''));
        var v = lang === 'en' ? a.value : el.getAttribute(zk);
        if (what === '#text') { if (el.textContent !== v) el.textContent = v; }
        else if (what === '#html') { if (el.innerHTML !== v) el.innerHTML = v; }
        else el.setAttribute(what, v);
      });
    });
  }
  function sync() {
    document.documentElement.setAttribute('lang', htmlLang(lang));
    document.documentElement.setAttribute('data-lang', lang);
    apply();
    [].forEach.call(document.querySelectorAll('[data-lang-pick]'), function (b) { var on = b.getAttribute('data-lang-pick') === lang; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); });
  }
  // 換語言：keep＝記住這個選擇；網址上有 ?lang= 的話一併改掉，重新整理才不會跳回去
  function set(l, keep) {
    if (LANGS.indexOf(l) < 0) return;
    var changed = l !== lang;
    lang = l;
    if (keep) {
      try { localStorage.setItem(KEY, l); } catch (e) { /* 忽略 */ }
      try { if (fromUrl() && fromUrl() !== l && history.replaceState) { var u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(history.state, '', u.toString()); } } catch (e) { /* 忽略 */ }
    }
    sync();
    if (changed) subs.slice().forEach(function (fn) { try { fn(l); } catch (e) { if (window.console) console.error(e); } });
  }
  sync();   // 這個檔案在頁面最後才執行，HTML 已經都在了：馬上換成對的語言（頁首的小程式先把英文版藏著，避免先閃一下中文）
  document.documentElement.classList.remove('ng-hold');
  return {
    get lang() { return lang; },
    en: function () { return lang === 'en'; },
    t: function (zh, en) { return lang === 'en' && en != null ? en : zh; },
    set: set,
    sync: sync,
    on: function (fn) { subs.push(fn); },
    // 英文序數：1st、2nd、3rd、11th…
    ord: function (n) { n = Math.round(n); var t = n % 100, d = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'); }
  };
})();
