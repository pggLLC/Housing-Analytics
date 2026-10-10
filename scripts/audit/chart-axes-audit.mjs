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

// Pages whose charts only render for a chosen geography get one here.
const PAGE_URLS = {
  'housing-needs-assessment.html': 'housing-needs-assessment.html?geoType=county&geoid=08001&auto=1',
  // A redirect stub since the merge; its slot audits the tab it now opens.
  'market-intelligence.html': 'colorado-deep-dive.html#tab-signals'
};

// The chart this audit was written for. If the scan stops seeing it, the
// scan is broken, not the chart fixed.
const MUST_CHECK = { page: 'article-pricing.html', chart: 'svg#tceHistoryChart' };

function listPages() {
  if (process.env.AUDIT_PAGES) return process.env.AUDIT_PAGES.split(',').map((s) => s.trim()).filter(Boolean);
  return fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.html') && !f.startsWith('developer') && f !== '404.html')
    .sort();
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

  return { checked, failures };
}

async function main() {
  const known = JSON.parse(fs.readFileSync(KNOWN_PATH, 'utf8')).gaps || [];
  const pages = listPages();
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const results = [];
  let checkedTotal = 0;
  const perPage = {};
  let sawMustCheck = false;

  for (const page of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tab = await ctx.newPage();
    try {
      await tab.goto(BASE_URL + '/' + (PAGE_URLS[page] || page), { waitUntil: 'load', timeout: TIMEOUT });
      await tab.waitForTimeout(SETTLE_MS);
      // Scroll through once so lazy (IntersectionObserver) charts paint.
      await tab.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      });
      await tab.waitForTimeout(800);
      const { checked, failures } = await tab.evaluate(inspectPage);
      checkedTotal += checked.length;
      perPage[page] = checked.length;
      if (page === MUST_CHECK.page && checked.some((c) => c.startsWith(MUST_CHECK.chart))) sawMustCheck = true;
      const seen = new Set();
      failures.forEach((f) => {
        const key = page + ' ' + f.chart + ' ' + f.problem;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({ page, ...f });
      });
      console.log(`${failures.length ? '✗' : '✓'} ${page} — ${checked.length} chart(s)${failures.length ? ', ' + failures.length + ' problem(s)' : ''}`);
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
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify({ base: BASE_URL, pages: pages.length, chartsChecked: checkedTotal, results, fresh, stale, perPage, short }, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`Chart axes audit: ${pages.length} page(s), ${checkedTotal} chart(s) checked`);
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
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
