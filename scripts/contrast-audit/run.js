/**
 * scripts/contrast-audit/run.js
 * Playwright-based WCAG contrast audit with auto-fix capability.
 *
 * Usage:
 *   CONTRAST_BASE_URL=http://localhost:8080 node scripts/contrast-audit/run.js
 *
 * Environment variables:
 *   CONTRAST_BASE_URL   Base URL of the running HTTP server (default: http://localhost:8080)
 *   CONTRAST_PAGE       Audit a single page only, e.g. "index.html" (default: audit all 5 pages)
 *   CONTRAST_FIX=1      Apply contrast-guard fixes in the browser context and report before/after ratios
 *   CONTRAST_JSON=1     Print the full JSON report to stdout instead of the text summary
 *   CONTRAST_REPORT_FILE=<path>  Write the JSON report to a file (can combine with CONTRAST_JSON)
 *
 * Scans key pages served via http-server, capped at 2000 nodes/page.
 * Skips aria-hidden elements, opacity < 0.9, and font-size < 10px.
 * Thresholds: 4.5 normal text / 3.0 large text (WCAG AA).
 *
 * Fix logic mirrors js/contrast-guard.js (runtime fixer):
 *   - Uses CSS variables --text-d / --text-l for foreground corrections
 *   - Applies --card-d / --card-l background surface to boxy elements when needed
 *   - Marks fixed elements with the `contrast-guard-fixed` class
 */
'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const BASE_URL     = (process.env.CONTRAST_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const FIX_MODE     = process.env.CONTRAST_FIX   === '1' || process.argv.includes('--fix');
const JSON_MODE    = process.env.CONTRAST_JSON  === '1' || process.argv.includes('--json');
const REPORT_FILE  = process.env.CONTRAST_REPORT_FILE || null;
const SINGLE_PAGE  = process.env.CONTRAST_PAGE  || null;

const ALL_PAGES = [
  'index.html',
  'economic-dashboard.html',
  'LIHTC-dashboard.html',
  'colorado-deep-dive.html',
  'state-allocation-map.html'
];

const PAGES = SINGLE_PAGE ? [SINGLE_PAGE] : ALL_PAGES;

const MAX_NODES_PER_PAGE = 2000;
const THRESHOLD_NORMAL   = 4.5;
const THRESHOLD_LARGE    = 3.0;

/**
 * Audit a page for contrast violations and optionally apply fixes.
 *
 * Returns { violations, fixes } where:
 *   violations – elements that fail WCAG AA contrast before any fix is applied
 *   fixes      – elements that were fixed (only populated when doFix is true)
 *
 * Each violation: { tag, text, fg, bg, bg_effective, ratio, threshold, isLarge }
 * Each fix:       { tag, text, fg_before, fg_after, fix_applied, bg_effective,
 *                   bg_fixed, ratio_before, ratio_after, threshold, isLarge, passes_after_fix }
 */
async function auditPage(page, url, doFix) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return page.evaluate(function (params) {
    var MAX_NODES = params.MAX_NODES;
    var T_NORMAL  = params.T_NORMAL;
    var T_LARGE   = params.T_LARGE;
    var DO_FIX    = params.DO_FIX;

    /* ── WCAG helpers ─────────────────────────────────────────────────── */
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
    /* Matches rgb(R,G,B) and rgba(R,G,B,A) — captures r[1], g[2], b[3], a[4]. */
    var RGB_RE = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i;
    function parseRgb(str) {
      if (!str) return null;
      var m = str.match(RGB_RE);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }

    /* Walk up the DOM to find the nearest opaque background colour. */
    function getOpaqueBg(el) {
      var cur = el;
      while (cur && cur !== document.documentElement) {
        var cs  = window.getComputedStyle(cur);
        var bg  = parseRgb(cs.backgroundColor);
        if (bg && bg.a > 0.02) return bg;
        cur = cur.parentElement;
      }
      return parseRgb(window.getComputedStyle(document.body).backgroundColor)
        || { r: 255, g: 255, b: 255, a: 1 };
    }

    function isLargeText(el) {
      var cs     = window.getComputedStyle(el);
      var size   = parseFloat(cs.fontSize   || '16');
      var weight = parseInt(cs.fontWeight   || '400', 10);
      /* WCAG: >= 18pt (24px) regular, or >= 14pt (18.66px) bold */
      return (size >= 24) || (size >= 18.66 && weight >= 700);
    }

    /* Luminance threshold below which a background is considered "dark". */
    /* Midpoint between pure black (0) and medium-grey (0.5); tuned to match */
    /* contrast-guard.js so foreground token selection is consistent.        */
    var DARK_BG_THRESHOLD = 0.35;

    /* Pick foreground token based on background luminance (mirrors contrast-guard.js). */
    function preferredTextForBg(bgLum) {
      return bgLum < DARK_BG_THRESHOLD ? 'var(--text-d, #e5e7eb)' : 'var(--text-l, #0f172a)';
    }
    /* Pick card-surface token based on background luminance (mirrors contrast-guard.js). */
    function preferredCardForBg(bgLum) {
      return bgLum < DARK_BG_THRESHOLD ? 'var(--card-d, #0f172a)' : 'var(--card-l, #ffffff)';
    }

    /* ── Scan ──────────────────────────────────────────────────────────── */
    var root  = document.querySelector('main, header, footer') || document.body;
    var sel   = 'h1,h2,h3,h4,h5,h6,p,span,a,li,td,th,label,button';
    var nodes = Array.from(root.querySelectorAll(sel)).slice(0, MAX_NODES);

    var violations = [];
    var fixes      = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (!el.textContent || !el.textContent.trim()) continue;

      var cs = window.getComputedStyle(el);
      if (parseFloat(cs.fontSize  || '16') < 10) continue;
      if (parseFloat(cs.opacity   || '1')  < 0.9) continue;

      var fg  = parseRgb(cs.color);
      if (!fg) continue;

      var bg        = getOpaqueBg(el);
      var large     = isLargeText(el);
      var threshold = large ? T_LARGE : T_NORMAL;
      var fgL       = lum(fg.r, fg.g, fg.b);
      var bgL       = lum(bg.r, bg.g, bg.b);
      var ratio     = cratio(fgL, bgL);

      if (ratio < threshold) {
        violations.push({
          tag:          el.tagName.toLowerCase(),
          text:         el.textContent.trim().slice(0, 60),
          fg:           cs.color,
          bg:           cs.backgroundColor,
          bg_effective: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
          ratio:        Math.round(ratio * 100) / 100,
          threshold:    threshold,
          isLarge:      large
        });

        if (DO_FIX) {
          var fgBefore    = cs.color;
          var ratioBefore = Math.round(ratio * 100) / 100;
          var fixColor    = preferredTextForBg(bgL);

          /* Apply foreground fix */
          el.style.color = fixColor;
          el.classList.add('contrast-guard-fixed');

          /* Apply background surface to transparent boxy elements */
          var ownBg    = parseRgb(cs.backgroundColor);
          var bgFixed  = null;
          if ((!ownBg || ownBg.a < 0.02) &&
              el.matches('.card, .panel, td, th, button, .chip, .badge')) {
            bgFixed = preferredCardForBg(bgL);
            el.style.backgroundColor = bgFixed;
          }

          /* Measure contrast after fix */
          var csAfter    = window.getComputedStyle(el);
          var fgAfterRgb = parseRgb(csAfter.color);
          var ratioAfter = null;
          if (fgAfterRgb) {
            var fgAfterL = lum(fgAfterRgb.r, fgAfterRgb.g, fgAfterRgb.b);
            ratioAfter   = Math.round(cratio(fgAfterL, bgL) * 100) / 100;
          }

          fixes.push({
            tag:             el.tagName.toLowerCase(),
            text:            el.textContent.trim().slice(0, 60),
            fg_before:       fgBefore,
            fg_after:        csAfter.color,
            fix_applied:     fixColor,
            bg_effective:    'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')',
            bg_fixed:        bgFixed,
            ratio_before:    ratioBefore,
            ratio_after:     ratioAfter,
            threshold:       threshold,
            isLarge:         large,
            passes_after_fix: ratioAfter !== null ? ratioAfter >= threshold : null
          });
        }
      }
    }

    return { violations: violations, fixes: fixes };
  }, { MAX_NODES: MAX_NODES_PER_PAGE, T_NORMAL: THRESHOLD_NORMAL, T_LARGE: THRESHOLD_LARGE, DO_FIX: doFix });
}

/* ── Main ─────────────────────────────────────────────────────────────── */
(async function main() {
  const browser = await chromium.launch();
  const page    = await browser.newPage();

  let totalViolations = 0;
  let totalFixed      = 0;

  const report = {
    timestamp:   new Date().toISOString(),
    base_url:    BASE_URL,
    fix_mode:    FIX_MODE,
    pages:       []
  };

  for (const pagePath of PAGES) {
    const url = BASE_URL + '/' + pagePath;
    let result;
    try {
      result = await auditPage(page, url, FIX_MODE);
    } catch (err) {
      console.error('[contrast-audit] Error auditing ' + url + ':', err.message);
      report.pages.push({ url: url, error: err.message, violations: [], fixes: [],
        summary: { violations: 0, fixed: 0, passed: false, error: true } });
      continue;
    }

    const { violations, fixes } = result;
    totalViolations += violations.length;
    totalFixed      += fixes.length;

    report.pages.push({
      url:        url,
      violations: violations,
      fixes:      fixes,
      summary: {
        violations:  violations.length,
        fixed:       fixes.length,
        passed:      violations.length === 0
      }
    });

    if (!JSON_MODE) {
      if (violations.length > 0) {
        console.error('\n[contrast-audit] FAILURES on ' + pagePath + ':');
        violations.forEach(function (v) {
          console.error(
            '  ' + v.tag + ' | ratio=' + v.ratio +
            ' (min=' + v.threshold + ')' +
            ' | fg=' + v.fg + ' bg=' + v.bg_effective +
            ' | "' + v.text + '"'
          );
        });
        if (FIX_MODE && fixes.length > 0) {
          console.log('[contrast-audit] FIXES applied on ' + pagePath + ':');
          fixes.forEach(function (f) {
            var status = f.passes_after_fix ? '✓' : '✗';
            console.log(
              '  ' + status + ' ' + f.tag +
              ' | before=' + f.ratio_before + ' → after=' + (f.ratio_after !== null ? f.ratio_after : '?') +
              ' | color: ' + f.fg_before + ' → ' + f.fix_applied
            );
          });
        }
      } else {
        console.log('[contrast-audit] PASS: ' + pagePath);
      }
    }
  }

  report.totals = {
    violations:     totalViolations,
    fixed:          totalFixed,
    pages_audited:  PAGES.length,
    passed:         totalViolations === 0
  };

  /* ── Output ─────────────────────────────────────────────────────────── */
  const reportJson = JSON.stringify(report, null, 2);

  if (JSON_MODE) {
    console.log(reportJson);
  }

  if (REPORT_FILE) {
    const dir = path.dirname(path.resolve(REPORT_FILE));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(REPORT_FILE, reportJson, 'utf8');
    if (!JSON_MODE) {
      console.log('[contrast-audit] Report written to: ' + REPORT_FILE);
    }
  }

  await browser.close();

  if (!JSON_MODE) {
    if (totalViolations > 0) {
      if (FIX_MODE) {
        console.error(
          '\n[contrast-audit] ' + totalViolations + ' violation(s) found; ' +
          totalFixed + ' fix(es) applied in browser context.'
        );
      } else {
        console.error('\n[contrast-audit] ' + totalViolations + ' contrast violation(s) found.');
        console.error('[contrast-audit] Re-run with CONTRAST_FIX=1 to apply fixes automatically.');
      }
    } else {
      console.log('\n[contrast-audit] All pages passed contrast audit.');
    }
  }

  if (totalViolations > 0) {
    process.exit(1);
  }
}());
