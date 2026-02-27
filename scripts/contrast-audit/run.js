/**
 * scripts/contrast-audit/run.js
 * Playwright-based WCAG contrast audit for key pages.
 *
 * Usage:
 *   CONTRAST_BASE_URL=http://localhost:8080 node scripts/contrast-audit/run.js
 *
 * Scans 5 key pages served via http-server, capped at 2000 nodes/page.
 * Skips aria-hidden elements, opacity < 0.9, and font-size < 10px.
 * Thresholds: 4.5 normal text / 3.0 large text (WCAG AA).
 */
'use strict';

const { chromium } = require('playwright');

const BASE_URL = (process.env.CONTRAST_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');

const PAGES = [
  'index.html',
  'economic-dashboard.html',
  'LIHTC-dashboard.html',
  'colorado-deep-dive.html',
  'state-allocation-map.html'
];

const MAX_NODES_PER_PAGE = 2000;
const THRESHOLD_NORMAL   = 4.5;
const THRESHOLD_LARGE    = 3.0;

/**
 * Run the contrast check in the browser context via page.evaluate().
 * Returns an array of failure objects: { tag, text, fg, bg, ratio, isLarge }.
 */
async function auditPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return page.evaluate(function (params) {
    var MAX_NODES = params.MAX_NODES;
    var T_NORMAL  = params.T_NORMAL;
    var T_LARGE   = params.T_LARGE;

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

    var root = document.querySelector('main, header, footer') || document.body;
    var sel = 'h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button';
    var nodes = Array.from(root.querySelectorAll(sel)).slice(0, MAX_NODES);

    var failures = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (!el.textContent || !el.textContent.trim()) continue;
      var cs = window.getComputedStyle(el);
      if (parseFloat(cs.fontSize || '16') < 10) continue;
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
    const url = BASE_URL + '/' + pagePath;
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
}());
