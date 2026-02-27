/**
 * scripts/contrast-audit/run.js
 * Playwright-based WCAG contrast audit for key site pages.
 *
 * Run via: npm run test:contrast
 * Requires: npm install && npx playwright install chromium
 * Requires a local HTTP server on port 8080 (e.g. http-server or npx serve . -p 8080)
 */
'use strict';

const { chromium } = require('@playwright/test');

const BASE_URL = process.env.CONTRAST_BASE_URL || 'http://localhost:8080';

const PAGES = [
  'index.html',
  'economic-dashboard.html',
  'LIHTC-dashboard.html',
  'colorado-deep-dive.html',
  'state-allocation-map.html',
];

// WCAG thresholds
const THRESHOLD_NORMAL = 4.5;
const THRESHOLD_LARGE  = 3.0;

// Scan limits
const MAX_NODES_PER_PAGE = 2000;

/** Convert sRGB channel (0–255) to linear light. */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance of an { r, g, b } object (channels 0–255). */
function luminance({ r, g, b }) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two luminance values. */
function contrastRatio(L1, L2) {
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse "rgb(r,g,b)" or "rgba(r,g,b,a)" → { r, g, b } or null. */
function parseRgb(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

/**
 * Run the contrast check in the browser context via page.evaluate().
 * Returns an array of failure objects: { tag, text, fg, bg, ratio, isLarge }.
 */
async function auditPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return page.evaluate(function (params) {
    var MAX_NODES    = params.MAX_NODES;
    var T_NORMAL     = params.T_NORMAL;
    var T_LARGE      = params.T_LARGE;

    function srgbLin(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function lum(r, g, b) {
      return 0.2126 * srgbLin(r) + 0.7152 * srgbLin(g) + 0.0722 * srgbLin(b);
    }
    function cratio(L1, L2) {
      var lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
      return (lighter + 0.05) / (darker + 0.05);
    }
    function parseRgb(str) {
      if (!str) return null;
      var m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    }
    function getOpaqueBg(el) {
      var cur = el;
      while (cur && cur !== document.documentElement) {
        var cs = window.getComputedStyle(cur);
        var bgStr = cs.backgroundColor;
        var bg = parseRgb(bgStr);
        if (bg) {
          // Extract alpha: look for 4th numeric value in rgba(r,g,b,a)
          var aMatch = bgStr.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i);
          var a = aMatch ? parseFloat(aMatch[1]) : 1;
          if (a > 0.02) return bg;
        }
        cur = cur.parentElement;
      }
      return parseRgb(window.getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255 };
    }
    function isLargeText(el) {
      var cs = window.getComputedStyle(el);
      var size = parseFloat(cs.fontSize || '16');
      var weight = parseInt(cs.fontWeight || '400', 10);
      return (size >= 24) || (size >= 18.66 && weight >= 700);
    }

    // Find scan root (main, header, footer — fallback body)
    var root = document.querySelector('main, header, footer') || document.body;
    var sel = 'h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button';
    var nodes = Array.from(root.querySelectorAll(sel)).slice(0, MAX_NODES);

    var failures = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // Skip aria-hidden
      if (el.getAttribute('aria-hidden') === 'true') continue;
      // Skip elements with no visible text
      if (!el.textContent || !el.textContent.trim()) continue;
      var cs = window.getComputedStyle(el);
      // Skip tiny text
      if (parseFloat(cs.fontSize || '16') < 10) continue;
      // Skip near-invisible
      if (parseFloat(cs.opacity || '1') < 0.9) continue;

      var fg = parseRgb(cs.color);
      if (!fg) continue;
      var bg = getOpaqueBg(el);
      var large = isLargeText(el);
      var threshold = large ? T_LARGE : T_NORMAL;

      var fgL = lum(fg.r, fg.g, fg.b);
      var bgL = lum(bg.r, bg.g, bg.b);
      var ratio = cratio(fgL, bgL);

      if (ratio < threshold) {
        failures.push({
          tag: el.tagName.toLowerCase(),
          text: el.textContent.trim().slice(0, 60),
          fg: cs.color,
          bg: cs.backgroundColor,
          ratio: Math.round(ratio * 100) / 100,
          isLarge: large
        });
      }
    }
    return failures;
  }, { MAX_NODES: MAX_NODES_PER_PAGE, T_NORMAL: THRESHOLD_NORMAL, T_LARGE: THRESHOLD_LARGE });
}

(async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  let totalFailures = 0;

  for (const pagePath of PAGES) {
    const url = BASE_URL.replace(/\/$/, '') + '/' + pagePath;
    let failures;
    try {
      failures = await auditPage(page, url);
    } catch (err) {
      console.error('[contrast-audit] Error auditing ' + url + ':', err.message, err.stack || '');
      continue;
    }

    if (failures.length > 0) {
      totalFailures += failures.length;
      console.error('\n[contrast-audit] FAILURES on ' + pagePath + ':');
      failures.forEach(function (f) {
        console.error(
          '  ' + f.tag + ' | ratio=' + f.ratio +
          ' (min=' + (f.isLarge ? THRESHOLD_LARGE : THRESHOLD_NORMAL) + ')' +
          ' | fg=' + f.fg + ' bg=' + f.bg +
          ' | "' + f.text + '"'
        );
      });
    } else {
      console.log('[contrast-audit] PASS: ' + pagePath);
    }
  }

  await browser.close();

  if (totalFailures > 0) {
    console.error('\n[contrast-audit] ' + totalFailures + ' contrast failure(s) found.');
    process.exit(1);
  } else {
    console.log('\n[contrast-audit] All pages passed contrast audit.');
  }
})();
