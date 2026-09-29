/**
 * contrast-guard.js
 * Runtime readability guard to prevent dark-on-dark or light-on-light text.
 * It checks computed contrast ratio and adjusts text color (and sometimes background)
 * using the site-theme CSS variables.
 */
(function () {
  // Computed colours are not always rgb(): color-mix() computes to oklab(...)
  // and a translucent colour can come back as color(srgb ...). Those used to
  // fail the regex and be skipped as transparent. A 1x1 canvas converts any
  // colour the browser accepts to sRGB.
  var probeCtx = null;
  function parseRGB(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    try {
      if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = 'transparent';
      probeCtx.fillStyle = str;           // an unparseable value leaves 'transparent'
      probeCtx.fillRect(0, 0, 1, 1);
      const d = probeCtx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch (e) {
      return null;
    }
  }

  function over(top, under) {
    const a = top.a;
    return {
      r: top.r * a + under.r * (1 - a),
      g: top.g * a + under.g * (1 - a),
      b: top.b * a + under.b * (1 - a),
      a: 1
    };
  }

  function srgbToLin(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance(rgb) {
    const r = srgbToLin(rgb.r), g = srgbToLin(rgb.g), b = srgbToLin(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(fg, bg) {
    const L1 = luminance(fg);
    const L2 = luminance(bg);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // The background the text is actually drawn on: every translucent layer
  // from the element up, composited over white. This used to take the first
  // layer with alpha > 0.02 and use its r/g/b as if it were opaque, so a 10%
  // teal wash (--accent-dim, which renders near-white) read as solid teal and
  // nav text on it was repainted near-white (economic-dashboard.html,
  // 2026-09-28). working-paper.html's style block works around the same bug.
  function getOpaqueBg(el) {
    const layers = [];
    for (let cur = el; cur; cur = cur.parentElement) {
      const bg = parseRGB(window.getComputedStyle(cur).backgroundColor);
      if (!bg || bg.a <= 0) continue;
      layers.push(bg);
      if (bg.a >= 1) break;
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) result = over(layers[i], result);
    return result;
  }

  // Pick whichever text color produces the higher actual contrast ratio
  // against the specific background. The old approach used a
  // luminance-threshold of 0.35, which misfired on mid-tone backgrounds
  // (e.g. #888 at luminance ~0.33 → picked light #e5e7eb text, yielding
  // ~1.8:1 contrast — a *created* WCAG failure). Computing both
  // candidate contrasts and returning the winner is correct at every
  // background luminance.
  var TEXT_DARK   = { r: 0x0f, g: 0x17, b: 0x2a, a: 1 };
  var TEXT_LIGHT  = { r: 0xe5, g: 0xe7, b: 0xeb, a: 1 };
  var CARD_DARK   = { r: 0x0f, g: 0x17, b: 0x2a, a: 1 };
  var CARD_LIGHT  = { r: 0xff, g: 0xff, b: 0xff, a: 1 };

  function preferredTextForBg(bgRgb) {
    return contrastRatio(TEXT_DARK, bgRgb) >= contrastRatio(TEXT_LIGHT, bgRgb)
      ? 'var(--text-l, #0f172a)'
      : 'var(--text-d, #e5e7eb)';
  }

  function preferredCardForBg(bgRgb) {
    return contrastRatio(CARD_DARK, bgRgb) >= contrastRatio(CARD_LIGHT, bgRgb)
      ? 'var(--card-d, #0f172a)'
      : 'var(--card-l, #ffffff)';
  }

  function isLargeText(el) {
    const cs = window.getComputedStyle(el);
    const size = parseFloat(cs.fontSize || '16');
    const weight = parseInt(cs.fontWeight || '400', 10);
    // WCAG large text: >= 18pt (~24px) regular, or >= 14pt (~18.66px) bold
    return (size >= 24) || (size >= 18.66 && weight >= 700);
  }

  function scan(root) {
    const selector = [
      'h1','h2','h3','h4','h5','h6',
      'p','span','a','li','td','th','label','button',
      '.stat-value','.stat-label','.metric-value','.metric-label',
      '.card','.panel','.chip','.badge'
    ].join(',');
    const nodes = root.querySelectorAll(selector);
    for (const el of nodes) {
      if (!el || !el.textContent || !el.textContent.trim()) continue;
      // F132 — explicit opt-out for elements with known-good theme handling
      // (dark-mode-toggle button, .btn elements with their own paired-token
      // styling). The runtime scanner can still report on these; we just
      // don't want contrast-guard's heuristic re-painting their colors
      // because the element's own CSS already does the right thing.
      // F133 — exclude .btn / .btn-primary / common interactive button classes
      // entirely. These already have explicit theme-aware color/bg pairs in
      // site-theme.css (`:where(.btn)` defaults + `.btn-primary` /
      // `html.dark-mode .btn-primary` overrides). The heuristic was patching
      // them whenever it sampled the wrong bg from a parent (e.g. a hero
      // panel with var(--accent) bg) and then locking in TEXT_LIGHT against
      // a now-cyan bg. Their styled state is correct without help.
      // F133 — also exclude .help-trigger (round "?" button in page header)
      // and .map-reset-btn / .dqs-* (data-quality summary chips). All have
      // explicit theme-aware CSS pairs and the heuristic was patching them
      // against a sampled bg that didn't match the real rendered bg.
      if (el.matches('.dark-mode-toggle, .btn, .btn-primary, .kicker, .tag, .chart-source, .chart-source *, .fes-error, .fes-error *, .help-trigger, .map-reset-btn, .dqs-source-count, [data-no-contrast-guard]')) continue;
      // F251 — exclusion must extend to descendants. Without this, a link
      // inside a <span data-no-contrast-guard> would still get patched
      // and could end up with a stale fg against a freshly-walked bg
      // (e.g. dark-mode article-pricing.html had this exact failure: an
      // <a> inside the STATIC-badge span got its color rewritten to
      // TEXT_DARK against an rgb(8,18,30) bg = 1.05:1).
      if (el.closest('[data-no-contrast-guard]')) continue;

      const cs = window.getComputedStyle(el);
      let fg = parseRGB(cs.color);
      if (!fg || fg.a < 0.02) continue;

      const bg = getOpaqueBg(el);
      if (fg.a < 1) fg = over(fg, bg);
      const ratio = contrastRatio(fg, bg);
      const min = isLargeText(el) ? 3.0 : 4.5;

      if (ratio < min) {
        // F133 — pick the better of TEXT_DARK / TEXT_LIGHT directly using
        // the known RGB constants (no probe element needed — eliminates the
        // CSS-var resolution timing race that left .contrast-guard-fixed
        // elements still failing). Only apply if the BEST candidate actually
        // passes the WCAG threshold against the effective bg AND improves
        // over the original. Otherwise leave the element alone — the
        // runtime scanner will surface the real failure.
        var rDark = contrastRatio(TEXT_DARK, bg);
        var rLight = contrastRatio(TEXT_LIGHT, bg);
        var bestRgb = (rDark > rLight) ? TEXT_DARK : TEXT_LIGHT;
        var bestRatio = Math.max(rDark, rLight);
        if (bestRatio >= min && bestRatio > ratio) {
          var prevColor = el.style.color;
          var prevBgColor = el.style.backgroundColor;
          el.__contrastGuardPrev = { color: prevColor, bg: prevBgColor };
          el.style.color = 'rgb(' + bestRgb.r + ',' + bestRgb.g + ',' + bestRgb.b + ')';
          var ownBg = parseRGB(cs.backgroundColor);
          if (!ownBg || ownBg.a < 0.02) {
            if (el.matches('.card, .panel, td, th, button, .chip, .badge') || el.hasAttribute('data-contrast-surface')) {
              var card = preferredCardForBg(bg);
              el.style.backgroundColor = card;
            }
          }
          // F133 — verify the patch actually improved contrast against the
          // REAL bg the browser sees after our style write. We already KNOW
          // the foreground we just wrote (`bestRgb`), so compute against that
          // directly rather than re-reading getComputedStyle (which doesn't
          // always reflect inline writes synchronously in Chrome and was
          // letting bad patches through). Re-compute the bg by walking up
          // again in case our backgroundColor write changed the chain.
          var verifyBg = getOpaqueBg(el);
          var verifyRatio = verifyBg ? contrastRatio(bestRgb, verifyBg) : 0;
          if (verifyRatio < min) {
            el.style.color = prevColor;
            el.style.backgroundColor = prevBgColor;
            delete el.__contrastGuardPrev;
          } else {
            el.classList.add('contrast-guard-fixed');
          }
        }
      }
    }
  }

  // Undo every patch from an earlier pass, restoring the element's own inline
  // values. Each pass must start from the page's authored colours: the guard
  // first runs on `nav:rendered`, before the stylesheets navigation.js injects
  // have loaded, and used to leave whatever it patched then in place until a
  // theme change. Which patches survived into the finished page depended on
  // whether the stylesheet or the guard's next pass won the race, so the same
  // page settled differently from one load to the next. Clearing and
  // re-scanning inside one task never paints the intermediate state.
  function clearFixes() {
    document.querySelectorAll('.contrast-guard-fixed').forEach(function (el) {
      var prev = el.__contrastGuardPrev || { color: '', bg: '' };
      el.style.color = prev.color;
      el.style.backgroundColor = prev.bg;
      el.classList.remove('contrast-guard-fixed');
      delete el.__contrastGuardPrev;
    });
  }

  // Transitions are suspended while the guard measures and writes. Clearing a
  // patch and re-reading the colour in the same task otherwise returns the
  // START of the transition back to the authored colour — i.e. the patched
  // colour — so the pass saw a pass, did not re-patch, and the element then
  // animated back to failing. Styles are flushed before the rule is removed,
  // so no transition is started by the guard's own writes. run() waits for
  // running transitions first, so none is cut short.
  function scanNow() {
    var freeze = document.createElement('style');
    freeze.textContent = '*,*::before,*::after{transition:none !important}';
    (document.head || document.documentElement).appendChild(freeze);
    try {
      clearFixes();
      scan(document);
    } catch (e) {
      /* no-op */
    } finally {
      void document.documentElement.offsetHeight;   // flush with transitions off
      freeze.remove();
    }
  }

  // A colour read mid-transition is neither the old colour nor the new one.
  // The "Data current" badge transitions its colour over 150 ms when it turns
  // green, and a pass that landed inside that window measured an in-between
  // grey-green, passed it, and left the settled badge unpatched. Wait for
  // running finite animations and transitions to finish, then scan.
  function run() {
    var running = [];
    try {
      running = document.getAnimations ? document.getAnimations().filter(function (a) {
        if (a.playState !== 'running') return false;
        var t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming();
        return !!t && Number.isFinite(t.endTime);   // an infinite spinner never finishes
      }) : [];
    } catch (e) { running = []; }
    if (!running.length) return scanNow();
    Promise.all(running.map(function (a) { return a.finished.catch(function () {}); })).then(run);
  }

  document.addEventListener('DOMContentLoaded', run);
  document.addEventListener('nav:rendered', run);
  window.addEventListener('load', run);

  // Content rendered after the last of those events used to be guarded or not
  // depending on timing: economic-dashboard.html's "Data current" badge turns
  // green when its fetches resolve, and was patched on 7 loads in 10 and left
  // failing (4.27:1) on the other 3. Re-scan when content changes, debounced,
  // with a ceiling so a page that never stops updating still gets scanned.
  // Only childList/characterData are observed: the guard itself writes style
  // and class attributes, so it cannot trigger itself.
  var CONTENT_DEBOUNCE_MS = 250;
  var CONTENT_MAX_WAIT_MS = 1000;
  var _contentTimer = null, _contentFirst = 0;
  function onContentChange() {
    var now = Date.now();
    if (!_contentTimer) _contentFirst = now;
    clearTimeout(_contentTimer);
    var wait = Math.max(0, Math.min(CONTENT_DEBOUNCE_MS, _contentFirst + CONTENT_MAX_WAIT_MS - now));
    _contentTimer = setTimeout(function () { _contentTimer = null; run(); }, wait);
  }
  function observeContent() {
    try {
      new MutationObserver(onContentChange)
        .observe(document.body, { childList: true, characterData: true, subtree: true });
    } catch (e) { /* MutationObserver not available — graceful degrade */ }
  }
  if (document.body) observeContent();
  else document.addEventListener('DOMContentLoaded', observeContent);

  // F122 — re-scan on theme change. Without this, contrast-guard ran once at
  // load against the INITIAL theme; if the user then toggled to dark mode
  // (where --accent is bright cyan #0fd4cf), every white-on-accent button
  // dropped to 1.7:1 contrast and stayed broken until the next page load.
  // We observe two signals: (a) the MutationObserver on <html> class changes,
  // which fires whenever dark-mode-toggle.js flips .theme-dark / .theme-light;
  // (b) the OS-level prefers-color-scheme media-query change so users tracking
  // system theme also get re-scanned. Both deduped through a short rAF so
  // back-to-back triggers don't double-scan.
  var _pendingRescan = false;
  function rescheduleScan() {
    if (_pendingRescan) return;
    _pendingRescan = true;
    // F140 — wait 350 ms after a theme-class change before re-scanning so
    // that all CSS transitions (background-color / color, 0.25 s ease) have
    // fully settled.  A raw requestAnimationFrame (~16 ms) could fire while
    // fg and bg are converging through similar mid-tone values, causing the
    // scanner to see near-zero contrast and incorrectly patch elements with
    // TEXT_DARK; that patch then persists until the runtime-contrast-scanner
    // evaluates the page 1 500 ms later.
    setTimeout(function () {
      _pendingRescan = false;
      // run() clears previous fixes first, so contrast-guard re-evaluates
      // against the new theme; otherwise an element forced to dark-text in
      // light mode stays dark-text in dark mode.
      run();
    }, 350);
  }
  try {
    var themeObserver = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === 'class') { rescheduleScan(); return; }
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* MutationObserver not available — graceful degrade */ }
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rescheduleScan);
    } catch (e) { /* older Safari — graceful degrade */ }
  }
})();
