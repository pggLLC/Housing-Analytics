#!/usr/bin/env node
/**
 * scripts/audit/ux-pass.mjs — the usability benchmark as a repeatable check.
 *
 * Opens the pages a newcomer walks through at phone width (390 x 844), served
 * the way GitHub Pages serves them, and measures what makes a first visit hard:
 *
 *   budgeted (fails the run when over scripts/audit/ux-budget.json)
 *     - DOM nodes after the page's data has loaded
 *     - main-thread blocking: the sum of every long task beyond 50 ms
 *     - exactly one <h1>
 *     - per page, that its data actually rendered (`ready`), and the same
 *       limits after pressing a control a reader would press (`click`)
 *   reported as rough signals (never fail, and never a substitute for
 *   testing whether real readers understand the page)
 *     - reading grade of the page's prose (Flesch-Kincaid)
 *     - capitalised abbreviations in the first screen; professional terms
 *       are fine for this site's audience, but each should be explained once
 *     - length in phone screens
 *   with --lighthouse, also Lighthouse mobile performance and accessibility
 *   scores for each page (report only: performance scores swing between runs).
 *   CHROME_PATH overrides the browser Lighthouse launches.
 *
 * Why these: on 2026-10-15 the benchmark of this site against 11 comparable
 * sites (site-flow review) found step 3 drawing ~51,000 DOM nodes and blocking
 * a phone for ~18 s, reading grades of 9-14 against a target of 8, and
 * abbreviations on every first screen. Nothing in CI measured any of it.
 *
 * Output: a Markdown table on stdout, appended to $GITHUB_STEP_SUMMARY when
 * set, and data written to the path given by --out (nothing is committed).
 *
 * Usage:
 *   npm run audit:ux
 *   node scripts/audit/ux-pass.mjs --page index.html
 *   node scripts/audit/ux-pass.mjs --lighthouse --out ux-pass.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveRoot } from './lib/serve-root.mjs';
import { checkUxBudget, fleschKincaidGrade } from './lib/audit-budget.mjs';
import { arriveUrl } from './lib/arrive-with.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// The homepage, the seven guided steps in order, and the two pages the
// site-flow review found hardest to read. Keep in step with
// js/components/workflow-progress.js.
export const UX_PAGES = [
  'index.html',
  'select-jurisdiction.html',
  'lihtc-opportunity-finder.html',
  'hna-what-housing-exists.html',
  'market-analysis.html',
  'hna-scenario-builder.html',
  'deal-calculator.html',
  'recommendation.html',
  'colorado-deep-dive.html',
  'about.html',
];

// Grade of a professional report. The site is for people working in or
// around affordable housing, so this flags only prose denser than that.
const READING_GRADE_SIGNAL = 12;
// Abbreviations a newcomer reads as words, and ordinary words set in capitals
// by a label ("STEP 3 OF 7").
const PLAIN_CAPS = new Set([
  'I', 'OK', 'US', 'USA', 'FAQ', 'PDF', 'CSV', 'TV', 'AM', 'PM',
  'OF', 'THE', 'AND', 'TO', 'IN', 'ON', 'FOR', 'BY', 'AT', 'OR', 'STEP', 'NEW', 'NOW', 'BETA',
]);

function parseArgs() {
  const a = process.argv.slice(2);
  const val = (flag) => { const i = a.indexOf(flag); return i !== -1 ? a[i + 1] : null; };
  return { page: val('--page'), out: val('--out'), lighthouse: a.includes('--lighthouse') };
}

// Runs in the page before any of its scripts, so no long task is missed.
function installLongTaskObserver() {
  window.__uxBlockingMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__uxBlockingMs += Math.max(0, e.duration - 50);
    }).observe({ type: 'longtask', buffered: true });
  } catch { window.__uxBlockingMs = null; }
}

function measurePage([plainCaps, readySelector]) {
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
  };
  const root = document.querySelector('main') || document.body;
  const prose = [...root.querySelectorAll('p, li')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => e.innerText.trim())
    .filter((t) => t.split(/\s+/).length >= 8)
    .join(' ');
  const firstScreen = [...document.querySelectorAll('h1,h2,h3,p,li,a,button,label,span,strong,td,th')]
    .filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    .map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '))
    .join(' ');
  const caps = (firstScreen.match(/\b[A-Z]{2,}[A-Z0-9]*\b/g) || []).filter((w) => !plainCaps.includes(w));
  return {
    title: document.title,
    h1Count: document.querySelectorAll('h1').length,
    domNodes: document.getElementsByTagName('*').length,
    readyCount: readySelector ? document.querySelectorAll(readySelector).length : null,
    blockingMs: window.__uxBlockingMs == null ? null : Math.round(window.__uxBlockingMs),
    screens: Math.round((document.documentElement.scrollHeight / innerHeight) * 10) / 10,
    prose,
    acronyms: [...new Set(caps)],
  };
}

async function measure(browser, origin, page, pageBudget = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const tab = await context.newPage();
  await tab.addInitScript(installLongTaskObserver);
  try {
    const response = await tab.goto(`${origin}/${arriveUrl(page)}`, { waitUntil: 'load', timeout: 45_000 });
    if (!response || !response.ok()) throw new Error(`HTTP ${response ? response.status() : 'no response'}`);
    await tab.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await tab.waitForTimeout(2_000);
    const readySel = pageBudget.ready ? pageBudget.ready.selector : null;
    const m = await tab.evaluate(measurePage, [[...PLAIN_CAPS], readySel]);
    const { prose, ...rest } = m;
    const out = { page, ...rest, readingGrade: fleschKincaidGrade(prose), proseWords: prose.split(/\s+/).filter(Boolean).length };
    if (pageBudget.click) out.afterClick = await exerciseClick(tab, pageBudget.click);
    return out;
  } catch (err) {
    return { page, error: String(err.message || err).split('\n')[0].slice(0, 200) };
  } finally {
    await context.close().catch(() => {});
  }
}

// Press a control the way a reader would, up to `times` times, and measure
// the page it leaves behind. Blocking is counted from the first press.
async function exerciseClick(tab, { selector, times = 1 }) {
  await tab.evaluate(() => { window.__uxBlockingMs = 0; });
  let clicks = 0;
  for (let i = 0; i < times; i += 1) {
    const btn = tab.locator(selector).first();
    if (!(await btn.count())) break;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    clicks += 1;
    await tab.waitForTimeout(500);
  }
  await tab.waitForTimeout(1_000);
  const after = await tab.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    blockingMs: window.__uxBlockingMs == null ? null : Math.round(window.__uxBlockingMs),
  }));
  return { clicks, ...after };
}

async function lighthouseScores(origin, pages, chromePath) {
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  const out = {};
  // A missing binary makes chrome-launcher emit an unhandled spawn error that
  // kills the process, so check first and report it per page instead.
  const missing = await fs.access(chromePath).then(() => null, () => `no browser at ${chromePath}`);
  for (const page of pages) {
    if (missing) { out[page] = { error: missing }; continue; }
    let chrome;
    try {
      chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
      const r = await lighthouse(`${origin}/${page}`, {
        port: chrome.port, output: 'json', logLevel: 'error', formFactor: 'mobile',
        onlyCategories: ['performance', 'accessibility'], maxWaitForLoad: 60_000,
      });
      const c = r.lhr.categories;
      out[page] = {
        performance: Math.round(c.performance.score * 100),
        accessibility: Math.round(c.accessibility.score * 100),
        lcp: r.lhr.audits['largest-contentful-paint']?.displayValue || null,
        tbt: r.lhr.audits['total-blocking-time']?.displayValue || null,
      };
    } catch (err) {
      out[page] = { error: String(err.message || err).slice(0, 120) };
    } finally {
      if (chrome) await chrome.kill();
    }
  }
  return out;
}

function toMarkdown(results, breaches, lh) {
  const cell = (v) => (v == null ? '—' : String(v));
  const lines = [
    '## Usability pass (phone, 390 px)',
    '',
    `Budgets in \`scripts/audit/ux-budget.json\` (DOM nodes, blocking, h1). Reading grade and abbreviations are rough signals only: "dense" marks prose above grade ${READING_GRADE_SIGNAL}, and abbreviations should each be explained once on the page.`,
    '',
    '| Page | DOM nodes | Blocking ms | h1 | Screens | Reading grade | First-screen abbreviations' + (lh ? ' | LH perf | LH a11y' : '') + ' |',
    '|---|---:|---:|---:|---:|---:|---' + (lh ? '|---:|---:' : '') + '|',
  ];
  for (const r of results) {
    if (r.error) { lines.push(`| ${r.page} | did not load: ${r.error} |`); continue; }
    const grade = r.readingGrade == null ? '—' : `${r.readingGrade}${r.readingGrade > READING_GRADE_SIGNAL ? ' (dense)' : ''}`;
    const ac = r.acronyms.length ? `${r.acronyms.length}: ${r.acronyms.slice(0, 8).join(', ')}` : '0';
    const l = lh ? lh[r.page] || {} : null;
    lines.push(`| ${r.page} | ${r.domNodes} | ${cell(r.blockingMs)} | ${r.h1Count} | ${r.screens} | ${grade} | ${ac}` +
      (lh ? ` | ${cell(l.performance ?? l.error)} | ${cell(l.accessibility)}` : '') + ' |');
  }
  lines.push('');
  if (breaches.length) {
    lines.push('**Over budget:**', '');
    for (const b of breaches) lines.push(`- ${b.page}: ${b.measure} ${b.found}, budget ${b.allowed}`);
  } else {
    lines.push('All pages within budget.');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs();
  const pages = args.page ? [args.page] : UX_PAGES;
  const budget = JSON.parse(await fs.readFile(path.join(__dirname, 'ux-budget.json'), 'utf8'));
  const { chromium } = await import('playwright');
  const server = await serveRoot(ROOT);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const p of pages) {
      process.stderr.write(`[ux-pass] ${p} ... `);
      const pageBudget = { ...(budget.defaults || {}), ...((budget.pages || {})[p] || {}) };
      let r = await measure(browser, server.origin, p, pageBudget);
      if (r.error) r = await measure(browser, server.origin, p, pageBudget); // one retry, as in a11y-audit
      results.push(r);
      process.stderr.write(r.error ? `error: ${r.error}\n` : `${r.domNodes} nodes, ${r.blockingMs} ms blocking\n`);
    }
    const lh = args.lighthouse ? await lighthouseScores(server.origin, pages, process.env.CHROME_PATH || chromium.executablePath()) : null;
    const breaches = checkUxBudget(results, budget);
    const md = toMarkdown(results, breaches, lh);
    process.stdout.write(md);
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md);
    if (args.out) await fs.writeFile(args.out, JSON.stringify({ generatedAt: new Date().toISOString(), results, lighthouse: lh, breaches }, null, 2));
    if (breaches.length) {
      console.error(`ux-pass: ${breaches.length} measure(s) over budget. Fix the page; the budget only goes down.`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error('ux-pass crashed:', err); process.exit(1); });
}
