// The seven-step rail: every circle on one row, the connecting line through their middles.
//
// paul, 23 Nov 2026: "the 7 step menu has circles that jump around". The strip centred each step column against
// the tallest label, so a step whose label ran to two lines (Needs Assessment) or three (Opportunity Finder's
// "optional") lifted its circle 8 or 16px above the others. Measured in Chromium on the pages that draw the rail,
// at a phone, a tablet and a desktop width.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const PAGES = ['deal-calculator.html', 'lihtc-opportunity-finder.html', 'market-analysis.html'];
const WIDTHS = [390, 700, 1366];
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const tab = await ctx.newPage();
    // The page's own files only; nothing from the network, so the rail draws as it would with no data yet.
    await tab.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
      if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
    });
    for (const page of PAGES) {
      await tab.goto(`${ORIGIN}/${page}`, { waitUntil: 'load', timeout: 90000 });
      await tab.waitForSelector('.wf-progress-steps .wf-step__num', { timeout: 30000 });
      await tab.waitForTimeout(500);
      const m = await tab.evaluate(() => {
        const vis = (e) => e.getClientRects().length > 0;
        const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
        const nums = [...document.querySelectorAll('.wf-progress-steps .wf-step__num')].filter(vis);
        const lines = [...document.querySelectorAll('.wf-progress-steps .wf-step-connector')].filter(vis);
        return { circles: nums.map(mid), lines: lines.map(mid) };
      });
      const where = `${page} at ${width}px`;
      ok(m.circles.length === 7, `${where}: ${m.circles.length} circles, not 7`);
      const spread = Math.max(...m.circles) - Math.min(...m.circles);
      ok(spread <= 1, `${where}: the circles sit at different heights (${spread.toFixed(1)}px apart: ${m.circles.map((c) => Math.round(c)).join(', ')})`);
      const off = m.lines.filter((l) => Math.abs(l - m.circles[0]) > 2);
      ok(m.lines.length === 6 && off.length === 0, `${where}: the connecting lines do not run through the circles' middles (${m.lines.map((l) => Math.round(l)).join(', ')} against ${Math.round(m.circles[0])})`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`workflow rail circles: ${checks} checks passed`);
