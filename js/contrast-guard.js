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

  function preferredTextForBg(bgRgb) {
    // If background is dark, pick light text; else pick dark text.
    return luminance(bgRgb) < 0.35
      ? 'var(--text-d, #e5e7eb)'
      : 'var(--text-l, #0f172a)';
  }

  function preferredCardForBg(bgRgb) {
    return luminance(bgRgb) < 0.35
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

      const cs = window.getComputedStyle(el);
      const fg = parseRGB(cs.color);
      if (!fg || fg.a < 0.02) continue;

      const bg = getOpaqueBg(el);
      const ratio = contrastRatio(fg, bg);
      const min = isLargeText(el) ? 3.0 : 4.5;

      if (ratio < min) {
        // Fix text color
        el.style.color = preferredTextForBg(bg);

        // If element has its own background that is nearly transparent, give it a card surface
        const ownBg = parseRGB(cs.backgroundColor);
        if (!ownBg || ownBg.a < 0.02) {
          // Only apply background if it's a "boxy" element or explicitly marked
          if (el.matches('.card, .panel, td, th, button, .chip, .badge') || el.hasAttribute('data-contrast-surface')) {
            el.style.backgroundColor = preferredCardForBg(bg);
          }
        }
        el.classList.add('contrast-guard-fixed');
      }
    }
  }

  function run() {
    try { scan(document); } catch (e) { /* no-op */ }
  }

  document.addEventListener('DOMContentLoaded', run);
  document.addEventListener('nav:rendered', run);
  window.addEventListener('load', run);
})();
