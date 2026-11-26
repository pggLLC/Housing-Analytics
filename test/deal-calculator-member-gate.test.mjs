#!/usr/bin/env node
// Member tools on the public Deal Calculator (paul, 26 Nov 2026, "all three": gate the calculator's lender
// schedules and the A/B scenario comparison, as lab #333 did for the deal workspace). js/components/dc-member-gate.js.
//
// In Chromium, with Mesa County picked in the quick start:
// 1. On the public site the lender schedules and the scenario comparison show the "For members" card, with a member
//    sign-in link to the same page on the member site, and their controls are hidden, not removed.
// 2. On the member site (*.workers.dev) both draw as before and no card shows.
// 3. Every figure in the pro forma and the capital stack is the same on both.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };

const html = fs.readFileSync(path.join(ROOT, 'deal-calculator.html'), 'utf8');
ok(html.includes('<script src="js/components/dc-step-bar.js"></script>\n<script src="js/components/dc-member-gate.js"></script>'), 'deal-calculator.html does not load the member gate after the step bar');

// As test/workflow-rail-circles.test.mjs: Playwright's own browser, else Puppeteer's (CI), else this machine's.
const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fromPuppeteer && fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });

async function open(origin, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
  });
  await tab.goto(`${origin}/deal-calculator.html`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForSelector('#dq-county option[value="08077"]', { state: 'attached', timeout: 60000 });
  await tab.selectOption('#dq-county', '08077');
  await tab.waitForSelector('#dc-ls-panel', { state: 'attached', timeout: 60000 });
  // Wait until the CHFA tables have loaded and the figures stop changing, so both views are compared settled.
  await tab.waitForFunction(() => /CHFA \u2014 \d{4}/.test((document.getElementById('dc-pro-forma-col') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await tab.evaluate(() => (document.getElementById('dc-pro-forma-col') || {}).textContent || '');
    if (now === last) break;
    last = now; await tab.waitForTimeout(750);
  }
  const m = await tab.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const cards = [...document.querySelectorAll('[data-member-card]')];
    const panel = document.getElementById('dc-ls-panel');
    return {
      cards: cards.filter(vis).map((c) => c.getAttribute('data-member-card')),
      links: cards.map((c) => (c.querySelector('a.button-link') || {}).href || ''),
      lsLegend: vis(panel && panel.querySelector('legend')),
      lsInputs: panel ? panel.querySelectorAll('input,select').length : 0,
      saveA: vis(document.getElementById('dcSaveAsA')),
      saveAExists: !!document.getElementById('dcSaveAsA'),
      // The figures outside the gated parts (the lender panel sits inside the pro forma column): every dollar amount,
      // coverage ratio and percentage, in order. (Source lines are left out: when the CHFA tables arrive varies by run.)
      figures: ['dc-pro-forma-col', 'dc-capital-stack-col'].map((id) => {
        const e = document.getElementById(id); if (!e) return '';
        const c = e.cloneNode(true); c.querySelectorAll('#dc-ls-panel').forEach((x) => x.remove());
        return (c.textContent.match(/-?\$[\d,]+(?:\.\d+)?[KMB]?|\d+(?:\.\d+)?x\b|\d+(?:\.\d+)?%/g) || []).join(' ');
      }).join('\n'),
      sw: document.documentElement.scrollWidth,
      heads: [...document.querySelectorAll('[data-member-card] h2')].map((h) => h.id),
    };
  });
  await ctx.close();
  return { m, errors };
}

try {
  for (const width of [390, 1280]) {
    const pub = await open('http://example.org', width);
    const mem = await open('http://coho-test.example.workers.dev', width);
    const w = `at ${width}px`;
    ok(pub.m.cards.join() === 'lender-schedules,scenario-compare' || pub.m.cards.sort().join() === 'lender-schedules,scenario-compare', `public ${w}: cards shown ${pub.m.cards.join()}`);
    ok(pub.m.links.every((h) => h.startsWith('https://coho-backend.communityplanner.workers.dev/deal-calculator.html')), `public ${w}: member links ${pub.m.links.join(' ')}`);
    ok(new Set(pub.m.heads).size === pub.m.heads.length, `public ${w}: two cards share a heading id`);
    ok(!pub.m.lsLegend && !pub.m.saveA, `public ${w}: the lender schedules or the Save as Scenario buttons still show`);
    ok(pub.m.lsInputs > 5 && pub.m.saveAExists, `public ${w}: the gated controls were removed instead of hidden (${pub.m.lsInputs} inputs)`);
    ok(mem.m.cards.length === 0, `member site ${w}: a member card shows (${mem.m.cards.join()})`);
    ok(mem.m.lsLegend && mem.m.saveA, `member site ${w}: the lender schedules or the scenario buttons did not draw`);
    if (pub.m.figures !== mem.m.figures) { const a = pub.m.figures, b = mem.m.figures; let i = 0; while (a[i] === b[i]) i++; console.error('first difference:', JSON.stringify(a.slice(i - 80, i + 120)), '|', JSON.stringify(b.slice(i - 80, i + 120))); }
    ok(pub.m.figures.split(' ').length > 50 && pub.m.figures === mem.m.figures, `${w}: the pro forma or capital stack differs between the public and member views`);
    ok(pub.m.sw <= width && mem.m.sw <= width, `${w}: the page scrolls sideways (${pub.m.sw}, ${mem.m.sw})`);
    ok(!pub.errors.length && !mem.errors.length, `${w}: page errors: ${pub.errors.concat(mem.errors).slice(0, 3).join(' | ')}`);
  }
} finally {
  await browser.close();
}
console.log(`deal-calculator-member-gate: ${checks} checks passed`);
