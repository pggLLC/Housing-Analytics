// Member pages on a phone: no public jurisdiction chip in the header, and the member
// menu in one row instead of five.
//
// paul's iPhone, 10-26 rehearsal: the shared header showed "+ Choose jurisdiction" above
// the member menu, and the menu's eleven links wrapped to five rows before any content.
// Renders the real pages in Chromium at 390px and 1280px. The public pages and the
// desktop member pages must not change.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
// Every member page the member menu lists that has a file here.
const NAV = (await import(path.join(ROOT, 'js/whitepaper/developer-nav.js'))).default;
const MEMBER = NAV.PAGES.map((p) => p.href).filter((f) => fs.existsSync(path.join(ROOT, f)));
const PUBLIC = ['index.html', 'deal-calculator.html'];
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

async function look(browser, file, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  // The local developer gate; the member site itself sits behind Cloudflare Access.
  await ctx.addInitScript(() => { try { sessionStorage.setItem('ib-auth-v1', JSON.stringify({ ts: Date.now() })); } catch (e) { /* blocked */ } });
  const tab = await ctx.newPage();
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
  });
  await tab.goto(`${ORIGIN}/${file}`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => document.querySelector('header.site-header .nav-wrap') && document.getElementById('jurisdictionPillWrap'), null, { timeout: 30000 });
  await tab.waitForFunction(() => !document.getElementById('devNav') || document.querySelectorAll('#devNav a').length > 0, null, { timeout: 30000 });
  await tab.waitForTimeout(200);
  const v = await tab.evaluate(() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const nav = document.getElementById('devNav');
    const links = nav ? [...nav.querySelectorAll('a')] : [];
    const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
    const cur = nav && nav.querySelector('[aria-current="page"]');
    const nr = nav && nav.getBoundingClientRect(), cr = cur && cur.getBoundingClientRect();
    return {
      chip: shown(document.getElementById('jurisdictionPillWrap')),
      rows: tops.size, links: links.length,
      curInView: !cur || (cr.left >= nr.left - 1 && cr.right <= nr.right + 1),
      scrolls: !!nav && nav.scrollWidth > nav.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  await ctx.close();
  return v;
}

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  ok(MEMBER.length >= 5, 'non-vacuous: the member menu lists pages that exist here: ' + MEMBER.join(', '));
  for (const f of MEMBER) {
    const phone = await look(browser, f, 390);
    ok(!phone.chip, f + ' at 390px: no jurisdiction chip in the header');
    ok(phone.links >= 5 && phone.rows === 1, f + ' at 390px: the member menu is one row (' + phone.links + ' links, ' + phone.rows + ' rows)');
    ok(phone.curInView, f + ' at 390px: the page you are on shows in that row');
    ok(phone.pageWidth <= 390, f + ' at 390px: the row scrolls by itself, not the page (' + phone.pageWidth + 'px)');
    const desk = await look(browser, f, 1280);
    ok(desk.rows <= 2 && !desk.scrolls, f + ' at 1280px: the menu still wraps as before, with nothing to scroll (' + desk.rows + ' rows)');
  }
  // The public site keeps its chip at both widths.
  for (const f of PUBLIC) {
    ok((await look(browser, f, 390)).chip, f + ' at 390px keeps the jurisdiction chip');
    ok((await look(browser, f, 1280)).chip, f + ' at 1280px keeps the jurisdiction chip');
  }
  // On a desktop the member pages keep the chip too: only the phone header changes.
  ok((await look(browser, MEMBER[0], 1280)).chip, MEMBER[0] + ' at 1280px keeps the jurisdiction chip');
} finally {
  await browser.close();
}
console.log(`member-phone-header: ${checks} checks passed`);
