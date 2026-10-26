#!/usr/bin/env node
/**
 * chart-axes-audit.mjs — every rendered chart has readable axes.
 *
 * The daily audit reads HTML as text and never renders a page, and
 * chart-population-audit.mjs only checks that ~20 named HNA canvases hold
 * data. Neither looks at whether a chart can be read. On 2026-10-09 the
 * LIHTC Equity Pricing History chart on article-pricing.html shipped with no
 * axes at all, and once it had them, a glossary tooltip spliced into an SVG
 * <text> blanked its x-axis title. Both are only visible after rendering.
 *
 * Opens every top-level page in headless Chromium, lets its renderers
 * settle, and checks every chart that actually painted:
 *
 *   Chart.js (Chart.instances) — every cartesian chart shows an x scale and
 *     a y scale, each with at least two tick labels. Pie, doughnut, polar
 *     area and radar charts have no x/y axes and are skipped by type.
 *   SVG charts — any <svg role="img"> at least 200px wide inside a
 *     .chart-card, or any <svg data-chart>, must carry
 *     <g data-axis="x"> and <g data-axis="y">, each with at least two
 *     [data-tick] labels.
 *   Blank labels — any SVG <text> with text content but no rendered box
 *     (an HTML element inside SVG text renders nothing).
 *   Legends — two entries with different labels whose swatches are the same
 *     color and dash, in a Chart.js legend or in any HTML legend (a class
 *     naming "legend", one small colored swatch per entry), fail. So does a
 *     Chart.js legend entry whose color the canvas cannot draw. On
 *     2026-10-11 every policy event under the economic-dashboard.html charts
 *     shared one indigo, and three map-marker categories shared one amber.
 *
 * A failure listed in chart-axes-known-gaps.json (page, chart AND problem,
 * so a new defect on a listed chart is not hidden by the old entry) is
 * reported as known; anything else fails the run. The list must stay
 * exact: an entry that no longer fails is reported as stale and also fails,
 * so a fixed chart comes off the list in the PR that fixes it.
 *
 * Coverage: chart-axes-coverage.json records how many charts each page
 * painted when the floor was set. A page that checks fewer fails, so a
 * renderer that stops painting a page's charts cannot pass as "0 charts".
 * After adding or removing charts on purpose, refresh it with
 * `npm run audit:chart-axes -- --write-coverage` and commit the file.
 *
 * Local:
 *   npx http-server . -p 8080 --silent &
 *   npm run audit:chart-axes
 * Env: AUDIT_BASE_URL (default http://127.0.0.1:8080), AUDIT_PAGES
 * (comma-separated page list, for a quick run), AUDIT_SETTLE_MS.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { arriveUrl } from './lib/arrive-with.mjs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:8080';
const SETTLE_MS = Number(process.env.AUDIT_SETTLE_MS || 3000);
const TIMEOUT = 30000;
const KNOWN_PATH = path.join(__dirname, 'chart-axes-known-gaps.json');
const COVERAGE_PATH = path.join(__dirname, 'chart-axes-coverage.json');
const WRITE_COVERAGE = process.argv.includes('--write-coverage');
const REPORT_DIR = path.join(ROOT, 'audit-report', 'chart-axes');

// Pages whose charts only render for a chosen geography get one here. The
// other HNA chapters open on Colorado statewide (lib/arrive-with.mjs), as they
// loaded before the HNA started on "pick a place" (2026-10-26).
const PAGE_URLS = {
  'housing-needs-assessment.html': 'housing-needs-assessment.html?geoType=county&geoid=08001&auto=1',
  // No projection before a place loads (#2288); audit Mesa County, as
  // chart-population-audit.mjs does.
  'hna-scenario-builder.html': 'hna-scenario-builder.html?geoType=county&geoid=08077&auto=1',
  // A redirect stub since the merge; its slot audits the tab it now opens.
  'market-intelligence.html': 'colorado-deep-dive.html#tab-signals',
  'historical-trends.html': 'colorado-deep-dive.html#tab-history',
  // The decade affordability chart renders only for a place (#2387), so the
  // county slot above cannot see it; this slot keeps it under a floor.
  'housing-needs-assessment.html#place': 'housing-needs-assessment.html?geoType=place&geoid=0831660&auto=1'
};

// Extra slots audited whenever their base page is: a second geography for a
// page whose charts differ by geography type. Each has its own floor.
const EXTRA_SLOTS = Object.keys(PAGE_URLS).filter((k) => k.includes('#'));

// The chart this audit was written for. If the scan stops seeing it, the
// scan is broken, not the chart fixed.
const MUST_CHECK = { page: 'article-pricing.html', chart: 'svg#tceHistoryChart' };
// Likewise for the legend check: the policy-event key under the FRED cards.
const MUST_CHECK_LEGEND = { page: 'economic-dashboard.html', legend: '.fred-event-legend' };

function listPages() {
  const base = process.env.AUDIT_PAGES
    ? process.env.AUDIT_PAGES.split(',').map((s) => s.trim()).filter(Boolean)
    : fs.readdirSync(ROOT)
      .filter((f) => f.endsWith('.html') && !f.startsWith('developer') && f !== '404.html')
      .sort();
  const extra = EXTRA_SLOTS.filter((slot) => base.includes(slot.split('#')[0]) && !base.includes(slot));
  return [...base, ...extra];
}

// Runs in the page. Returns { checked: [...ids], failures: [{chart, problem}] }.
function inspectPage() {
  const checked = [];
  const failures = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = (el, prefix) => {
    if (el.id) return prefix + '#' + el.id;
    const host = el.parentElement && el.parentElement.closest('[id]');
    return prefix + (host ? '#' + host.id : '') + (el.getAttribute('data-chart') ? '[' + el.getAttribute('data-chart') + ']' : '');
  };

  const NO_AXES = ['pie', 'doughnut', 'polarArea', 'radar'];
  const instances = window.Chart && window.Chart.instances ? Object.values(window.Chart.instances) : [];
  instances.forEach((chart) => {
    const canvas = chart.canvas;
    if (!canvas || !canvas.isConnected || !visible(canvas)) return;
    const type = (chart.config && (chart.config.type || (chart.config._config && chart.config._config.type))) || '';
    if (NO_AXES.includes(type)) return;
    const id = label(canvas, 'canvas');
    checked.push(id);
    const scales = Object.values(chart.scales || {});
    const problems = [];
    ['x', 'y'].forEach((axis) => {
      const shown = scales.filter((s) => s.axis === axis && s.options && s.options.display !== false);
      if (!shown.length) { problems.push('no visible ' + axis + ' axis'); return; }
      const ticks = Math.max(...shown.map((s) => (s.ticks || []).filter((t) => t && t.label !== '' && t.label != null).length));
      if (ticks < 2) problems.push(axis + ' axis has ' + ticks + ' tick label(s)');
    });
    if (problems.length) failures.push({ chart: id, problem: problems.join('; ') });
  });

  const svgs = new Set([
    ...document.querySelectorAll('.chart-card svg[role="img"]'),
    ...document.querySelectorAll('svg[data-chart]')
  ]);
  svgs.forEach((svg) => {
    if (!visible(svg) || svg.getBoundingClientRect().width < 200) return;
    if (svg.parentElement && svg.parentElement.closest('svg')) return;
    const id = label(svg, 'svg');
    checked.push(id);
    const problems = [];
    ['x', 'y'].forEach((axis) => {
      const g = svg.querySelector('[data-axis="' + axis + '"]');
      if (!g) { problems.push('no data-axis="' + axis + '" group'); return; }
      const ticks = Array.from(g.querySelectorAll('[data-tick]')).filter((t) => t.textContent.trim() && visible(t)).length;
      if (ticks < 2) problems.push(axis + ' axis has ' + ticks + ' visible tick label(s)');
    });
    if (problems.length) failures.push({ chart: id, problem: problems.join('; ') });
  });

  document.querySelectorAll('svg text').forEach((t) => {
    if (!t.textContent.trim()) return;
    const svg = t.closest('svg');
    if (!svg || !visible(svg)) return;
    if (t.getBoundingClientRect().width === 0 && getComputedStyle(t).display !== 'none' && getComputedStyle(t).visibility !== 'hidden') {
      const id = label(svg, 'svg');
      failures.push({ chart: id, problem: 'blank label "' + t.textContent.trim().slice(0, 40) + '"' + (t.querySelector('*') ? ' (holds HTML: ' + t.querySelector('*').tagName.toLowerCase() + ')' : '') });
    }
  });

  // Legends: entries a reader cannot tell apart. Two entries with different
  // labels whose swatches are the same color (and the same dash) carry no
  // information, which is how ten policy events on economic-dashboard.html
  // all drew in one indigo (2026-10-11). Colors are compared in CIE Lab;
  // a distance under LEGEND_MIN_DELTA_E reads as the same color.
  const LEGEND_MIN_DELTA_E = 20;
  const legends = [];
  const probe = document.createElement('canvas').getContext('2d');
  const toRgba = (color) => {
    if (typeof color !== 'string' || !color.trim()) return null;
    // The canvas silently ignores a color it cannot parse (a CSS var(), for
    // one), so reject those first, then let it normalise the rest.
    if (!CSS.supports('color', color) || /var\(/i.test(color)) return null;
    probe.fillStyle = color;
    const v = probe.fillStyle;
    let m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
    m = /^rgba?\(([^)]+)\)$/.exec(v);
    if (!m) return null;
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  // A translucent swatch is seen against the page, so blend it onto white.
  const onWhite = (c) => c && [0, 1, 2].map((i) => c[i] * c[3] + 255 * (1 - c[3]));
  const lab = (rgb) => {
    const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    const xyz = [
      (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047,
      (lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722),
      (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883
    ].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
    return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
  };
  const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const checkLegend = (id, entries) => {
    const items = entries.filter((e) => e.text && e.rgb).map((e) => ({ ...e, lab: lab(e.rgb) }));
    if (items.length < 2) return;
    legends.push(id);
    // Group entries whose swatches match, then report each group once.
    const group = items.map((_, i) => i);
    const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[i].text === items[j].text || (items[i].dash || '') !== (items[j].dash || '')) continue;
        if (deltaE(items[i].lab, items[j].lab) < LEGEND_MIN_DELTA_E) group[find(j)] = find(i);
      }
    }
    const groups = {};
    items.forEach((it, i) => { (groups[find(i)] = groups[find(i)] || []).push(it); });
    Object.values(groups).forEach((g) => {
      const names = [...new Set(g.map((it) => it.text))];
      if (names.length < 2) return;
      failures.push({ chart: id, problem: 'legend entries share one color (' + hex(g[0].rgb) + '): ' + names.join(' | ') });
    });
  };

  instances.forEach((chart) => {
    const canvas = chart.canvas;
    if (!canvas || !canvas.isConnected || !visible(canvas)) return;
    const legend = chart.legend;
    const opts = chart.options && chart.options.plugins && chart.options.plugins.legend;
    if (!legend || !legend.legendItems || (opts && opts.display === false)) return;
    const line = ['line', 'radar'].includes((chart.config && chart.config.type) || '');
    const id = label(canvas, 'canvas');
    const shownItems = legend.legendItems.filter((it) => !it.hidden);
    // A color the canvas cannot parse (var(--chart-1) is the usual one) is
    // silently dropped, so the series draws in whatever color came before.
    shownItems.forEach((it) => {
      const named = [it.fillStyle, it.strokeStyle].filter((c) => typeof c === 'string' && c !== 'transparent');
      if (named.length && named.every((c) => !toRgba(c))) {
        failures.push({ chart: id, problem: 'legend entry "' + String(it.text || '').trim() + '" has no drawable color (' + named[0] + ')' });
      }
    });
    checkLegend(id, shownItems.map((it) => {
      const fill = toRgba(it.fillStyle);
      const stroke = toRgba(it.strokeStyle);
      // A line's swatch reads as its stroke; a box's as its fill, unless the
      // fill is a faint wash under a solid border.
      const shown = line || !fill || (fill[3] < 0.5 && stroke) ? (stroke || fill) : fill;
      return { text: String(it.text || '').trim(), rgb: onWhite(shown), dash: (it.lineDash || []).join(',') };
    }));
  });

  // HTML legends: a container whose class names a legend. Each small colored
  // swatch in it (a box, or a shape in a small inline SVG) marks one entry,
  // and the entry is the swatch's nearest ancestor that carries text.
  const swatchOf = (el) => {
    if (el.closest('button')) return null; // toggle chevrons, not keys
    const cs = getComputedStyle(el);
    const ink = toRgba(cs.color);
    const same = (c) => ink && c && c[0] === ink[0] && c[1] === ink[1] && c[2] === ink[2];
    if (el instanceof SVGElement) {
      if (!/^(rect|circle|ellipse|line|path|polygon|polyline)$/.test(el.tagName)) return null;
      const svg = el.ownerSVGElement;
      if (!svg || svg.getBoundingClientRect().width > 48) return null;
      const fill = cs.fill === 'none' ? null : toRgba(cs.fill);
      const stroke = cs.stroke === 'none' ? null : toRgba(cs.stroke);
      const f = fill && fill[3] * parseFloat(cs.fillOpacity || 1) >= 0.5 ? fill : (stroke || fill);
      return f && f[3] > 0.05 && !same(f) ? { at: svg, rgb: onWhite(f) } : null;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || r.width > 24 || r.height > 24) return null;
    const bg = toRgba(cs.backgroundColor);
    const bc = parseFloat(cs.borderTopWidth) >= 1 && cs.borderTopStyle !== 'none' ? toRgba(cs.borderTopColor) : null;
    const dash = cs.borderTopStyle === 'dashed' || cs.borderTopStyle === 'dotted' ? cs.borderTopStyle : '';
    // A faint wash inside a solid outline reads as the outline, as on a map.
    if (bc && bc[3] >= 0.5 && !same(bc) && (!bg || bg[3] < 0.5)) return { at: el, rgb: onWhite(bc), dash };
    if (bg && bg[3] > 0.05) return { at: el, rgb: onWhite(bg), dash };
    return null;
  };
  document.querySelectorAll('[class*="legend"]').forEach((box) => {
    if (!visible(box) || (box.parentElement && box.parentElement.closest('[class*="legend"]'))) return;
    const entries = new Map();
    box.querySelectorAll('*').forEach((el) => {
      if (!visible(el)) return;
      const sw = swatchOf(el);
      if (!sw) return;
      let entry = sw.at.parentElement;
      while (entry && entry !== box && !entry.innerText.trim()) entry = entry.parentElement;
      if (!entry || entry === box || entries.has(entry)) return;
      entries.set(entry, sw);
    });
    if (entries.size < 2) return;
    // Name the legend after the chart beside it, else its nearest id.
    const chart = box.parentElement && box.parentElement.querySelector('canvas[id], svg[id]');
    const host = box.closest('[id]');
    const id = 'legend' + (box.id ? '#' + box.id : chart ? '[' + chart.id + ']' : host ? '#' + host.id : '') + '.' + String(box.getAttribute('class')).trim().split(/\s+/)[0];
    checkLegend(id, [...entries].map(([el, sw]) => ({ text: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 60), rgb: sw.rgb, dash: sw.dash })));
  });

  return { checked, failures, legends };
}

async function main() {
  const known = JSON.parse(fs.readFileSync(KNOWN_PATH, 'utf8')).gaps || [];
  const pages = listPages();
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const results = [];
  let checkedTotal = 0;
  const perPage = {};
  let sawMustCheck = false;
  let sawMustLegend = false;
  let legendsTotal = 0;

  for (const page of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    try {
      await tab.goto(BASE_URL + '/' + (PAGE_URLS[page] || arriveUrl(page)), { waitUntil: 'load', timeout: TIMEOUT });
      await tab.waitForTimeout(SETTLE_MS);
      // Scroll through once so lazy (IntersectionObserver) charts paint.
      await tab.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      });
      await tab.waitForTimeout(800);
      const { checked, failures, legends } = await tab.evaluate(inspectPage);
      checkedTotal += checked.length;
      legendsTotal += legends.length;
      if (page === MUST_CHECK_LEGEND.page && legends.some((l) => l.endsWith(MUST_CHECK_LEGEND.legend))) sawMustLegend = true;
      perPage[page] = checked.length;
      if (page === MUST_CHECK.page && checked.some((c) => c.startsWith(MUST_CHECK.chart))) sawMustCheck = true;
      const seen = new Set();
      failures.forEach((f) => {
        const key = page + ' ' + f.chart + ' ' + f.problem;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ page, ...f });
      });
      console.log(`${failures.length ? '✗' : '✓'} ${page} — ${checked.length} chart(s), ${legends.length} legend(s)${failures.length ? ', ' + failures.length + ' problem(s)' : ''}`);
    } catch (err) {
      console.log(`! ${page} — could not load: ${err.message.split('\n')[0]}`);
      results.push({ page, chart: '(page)', problem: 'could not load: ' + err.message.split('\n')[0] });
    } finally {
      await ctx.close();
    }
  }
  await browser.close();

  const sameGap = (k, r) => k.page === r.page && k.chart === r.chart && k.problem === r.problem;
  const isKnown = (r) => known.some((k) => sameGap(k, r));
  const fresh = results.filter((r) => !isKnown(r));
  const stale = process.env.AUDIT_PAGES ? [] : known.filter((k) => !results.some((r) => sameGap(k, r)));

  if (WRITE_COVERAGE) {
    const floors = {};
    Object.keys(perPage).sort().forEach((p) => { if (perPage[p] > 0) floors[p] = perPage[p]; });
    fs.writeFileSync(COVERAGE_PATH, JSON.stringify({
      _comment: 'Charts each page painted when this floor was set. chart-axes-audit.mjs fails a page that checks fewer. Regenerate with npm run audit:chart-axes -- --write-coverage.',
      pages: floors
    }, null, 2) + '\n');
    console.log(`Wrote coverage floors for ${Object.keys(floors).length} page(s) to ${path.relative(ROOT, COVERAGE_PATH)}`);
  }
  const floors = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8')).pages || {};
  const short = Object.keys(floors)
    .filter((p) => pages.includes(p) && (perPage[p] || 0) < floors[p])
    .map((p) => ({ page: p, expected: floors[p], checked: perPage[p] || 0 }));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify({ base: BASE_URL, pages: pages.length, chartsChecked: checkedTotal, legendsChecked: legendsTotal, results, fresh, stale, perPage, short }, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`Chart axes audit: ${pages.length} page(s), ${checkedTotal} chart(s) and ${legendsTotal} legend(s) checked`);
  console.log(`  known gaps still open: ${results.length - fresh.length}`);
  fresh.forEach((r) => console.log(`  NEW  ${r.page} ${r.chart}: ${r.problem}`));
  stale.forEach((k) => console.log(`  STALE known gap no longer fails, remove it: ${k.page} ${k.chart}: ${k.problem}`));
  short.forEach((c) => console.log(`  COVERAGE ${c.page} checked ${c.checked} chart(s), floor is ${c.expected}: charts stopped rendering`));

  let failed = fresh.length > 0 || stale.length > 0 || short.length > 0;
  if (checkedTotal === 0) { console.log('  FAIL scan checked no charts at all'); failed = true; }
  if (pages.includes(MUST_CHECK.page) && !sawMustCheck) {
    console.log(`  FAIL ${MUST_CHECK.chart} on ${MUST_CHECK.page} was not checked; the scan is broken`);
    failed = true;
  }
  if (pages.includes(MUST_CHECK_LEGEND.page) && !sawMustLegend) {
    console.log(`  FAIL no ${MUST_CHECK_LEGEND.legend} legend on ${MUST_CHECK_LEGEND.page} was checked; the legend scan is broken`);
    failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
