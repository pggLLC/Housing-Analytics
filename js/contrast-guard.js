/**
 * contrast-guard.js
 * Runtime readability guard to prevent dark-on-dark or light-on-light text.
 * It checks computed contrast ratio and adjusts text color (and sometimes background)
 * using the site-theme CSS variables.
 */
(function () {
  function parseRGB(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
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

  function getOpaqueBg(el) {
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const cs = window.getComputedStyle(cur);
      const bg = parseRGB(cs.backgroundColor);
      if (bg && bg.a > 0.02) return bg;
      cur = cur.parentElement;
    }
    const rootBg = parseRGB(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return rootBg;
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
      if (el.matches('.dark-mode-toggle, .btn, .btn-primary, .help-trigger, .map-reset-btn, .dqs-source-count, [data-no-contrast-guard]')) continue;
      // F251 — exclusion must extend to descendants. Without this, a link
      // inside a <span data-no-contrast-guard> would still get patched
      // and could end up with a stale fg against a freshly-walked bg
      // (e.g. dark-mode article-pricing.html had this exact failure: an
      // <a> inside the STATIC-badge span got its color rewritten to
      // TEXT_DARK against an rgb(8,18,30) bg = 1.05:1).
      if (el.closest('[data-no-contrast-guard]')) continue;

      const cs = window.getComputedStyle(el);
      const fg = parseRGB(cs.color);
      if (!fg || fg.a < 0.02) continue;

      const bg = getOpaqueBg(el);
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
          } else {
            el.classList.add('contrast-guard-fixed');
          }
        }
      }
    }
  }

  function run() {
    try { scan(document); } catch (e) { /* no-op */ }
  }

  document.addEventListener('DOMContentLoaded', run);
  document.addEventListener('nav:rendered', run);
  window.addEventListener('load', run);

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
      // Clear previous fixes so contrast-guard re-evaluates against the new
      // theme; otherwise an element forced to dark-text in light mode stays
      // dark-text in dark mode.
      document.querySelectorAll('.contrast-guard-fixed').forEach(function (el) {
        el.style.color = '';
        el.style.backgroundColor = '';
        el.classList.remove('contrast-guard-fixed');
      });
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
