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
      if (el.matches('.dark-mode-toggle, [data-no-contrast-guard]')) continue;

      const cs = window.getComputedStyle(el);
      const fg = parseRGB(cs.color);
      if (!fg || fg.a < 0.02) continue;

      const bg = getOpaqueBg(el);
      const ratio = contrastRatio(fg, bg);
      const min = isLargeText(el) ? 3.0 : 4.5;

      if (ratio < min) {
        // F132 — verify the proposed patch would ACTUALLY improve contrast
        // before applying. Previously contrast-guard would happily apply a
        // text color that itself fell below 4.5:1 against the bg — the runtime
        // scanner kept catching `.contrast-guard-fixed` elements that were
        // STILL failing. Now: compute the contrast of the proposed text color
        // against the effective bg, and only apply if it passes (or at least
        // improves the original). Prevents the guard from "fixing" things
        // into a different broken state.
        var candidateRef = preferredTextForBg(bg);
        // candidateRef is a CSS var() expression; resolve to actual rgb
        // by setting it on a probe element off-screen.
        var probe = document.createElement('span');
        probe.style.color = candidateRef;
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        document.body.appendChild(probe);
        var probedFg = parseRGB(getComputedStyle(probe).color);
        document.body.removeChild(probe);
        if (probedFg && contrastRatio(probedFg, bg) >= min) {
          el.style.color = candidateRef;
          var ownBg = parseRGB(cs.backgroundColor);
          if (!ownBg || ownBg.a < 0.02) {
            if (el.matches('.card, .panel, td, th, button, .chip, .badge') || el.hasAttribute('data-contrast-surface')) {
              el.style.backgroundColor = preferredCardForBg(bg);
            }
          }
          el.classList.add('contrast-guard-fixed');
        }
        // If the patch wouldn't help, leave the element alone — at least
        // we don't add a "fixed" class to something that's still broken,
        // and the runtime scanner can still report the real failure.
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
    requestAnimationFrame(function () {
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
    });
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
