// Deal Calculator deal file: "Download deal file" saves the deal, "Open deal file"
// brings it back, on a fresh browser with nothing stored.
//
// paul picked this on 10-26 (option 2A in the free-or-member doc): a visitor without
// a login keeps a deal as a file, and the same file opens on the member site. The file
// is the Export JSON snapshot; its `url` query is the deal, so it must agree with the
// share link, and opening it must show the sender's figures, recomputed.
// Renders the real page in Chromium, downloads through the button and opens through
// the file picker.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const PAGE = `${ORIGIN}/deal-calculator.html`;
const MESA = '08077';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

async function open(browser, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 }, acceptDownloads: true });
  // Every message the page shows, kept: a toast fades after 2.4 s.
  await ctx.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      const t = document.getElementById('dc-share-toast');
      if (t && window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent);
    }).observe(document, { childList: true, subtree: true });
  });
  const tab = await ctx.newPage();
  await tab.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const f = path.resolve(ROOT, decodeURIComponent(u.pathname.slice(1)));
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(f), contentType: mime[path.extname(f)] || 'application/octet-stream' });
  });
  const errors = [];
  tab.on('pageerror', (e) => errors.push(e.message));
  await tab.goto(PAGE, { waitUntil: 'load', timeout: 90000 });
  await ready(tab);
  return { ctx, tab, errors };
}
async function ready(tab) {
  await tab.waitForFunction(() => window.__DealCalcShare && document.getElementById('dc-county-select')
    && document.getElementById('dc-county-select').options.length > 60, null, { timeout: 60000 });
  await tab.waitForTimeout(800);
}

// What a reader sees: every rendered output figure, as text (the share round-trip
// test's reading, less closed popovers). Two reads 400 ms apart that agree.
async function outputs(tab) {
  const read = () => tab.evaluate(() => {
    const OUT = /^(dc-(r|su|own)-|dc-minimum-set-aside-status$|dc-units-sync-warn$|dc-gsf-working$|proFormaMount$)/;
    const out = {};
    document.querySelectorAll('main [id]').forEach((el) => {
      if (!OUT.test(el.id) || /^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(el.tagName) || el.closest('[hidden]')) return;
      // Closed explanation popovers are not on screen, and refresh only when opened.
      const seen = el.cloneNode(true);
      seen.querySelectorAll('[hidden]').forEach((h) => h.remove());
      out[el.id] = seen.textContent.replace(/\s+/g, ' ').trim();
    });
    return out;
  });
  let prev = JSON.stringify(await read());
  for (let i = 0; i < 40; i++) {
    await tab.waitForTimeout(400);
    const next = JSON.stringify(await read());
    if (next === prev) return JSON.parse(next);
    prev = next;
  }
  return JSON.parse(prev);
}
const inputs = (tab) => tab.evaluate(() => {
  const out = {};
  window.__DealCalcShare.shareKeys().forEach((id) => {
    const el = document.getElementById(id);
    out[id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
  });
  return out;
});
async function set(tab, id, value) {
  await tab.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
}
const toasts = (tab) => tab.evaluate(() => window.__toasts.slice());
async function pick(tab, file) {
  const [chooser] = await Promise.all([tab.waitForEvent('filechooser'), tab.click('#dc-share-open')]);
  await chooser.setFiles(file);
}

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deal-file-'));
try {
  // A rental deal with a studio split, a changed constant and a soft loan.
  const sender = await open(browser);
  await set(sender.tab, 'dc-county-select', MESA);
  await sender.tab.waitForTimeout(400);
  await set(sender.tab, 'dc-tdc', 18500000);
  await set(sender.tab, 'dc-units-60-studio', 6);
  await set(sender.tab, 'dc-units-60-1br', 9);
  await set(sender.tab, 'dc-vacancy', 6);
  await sender.tab.evaluate(() => {
    const a = document.querySelector('[data-tranche-id] .dc-tr-amount');
    if (a) { a.value = '750000'; a.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  const sent = await outputs(sender.tab);
  const sentInputs = await inputs(sender.tab);
  const shown = Object.keys(sent).filter((id) => sent[id] && sent[id] !== '—' && sent[id] !== '-');
  ok(shown.length >= 25 && ['dc-r-credits', 'dc-su-gap'].every((id) => shown.includes(id)),
    'non-vacuous: the sender shows ' + shown.length + ' figures, the credit and the gap among them');

  // Download through the button.
  const [dl] = await Promise.all([sender.tab.waitForEvent('download'), sender.tab.click('#dc-share-json')]);
  const name = dl.suggestedFilename();
  ok(/^deal-\d{4}-\d{2}-\d{2}\.coho\.json$/.test(name), 'the deal file has a plain name: ' + name);
  const file = path.join(tmp, name);
  await dl.saveAs(file);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The file's deal is the share link, and the importers read the same thing.
  const agree = await sender.tab.evaluate((s) => ({
    file: window.__DealCalcShare.dealFileQuery(s), link: window.__DealCalcShare.serialize()
  }), snap);
  ok(agree.file && agree.file === agree.link, 'the deal file carries exactly the share link\'s settings');

  // Open it on a fresh browser: no storage, the page's defaults on screen.
  const fresh = await open(browser);
  const before = await outputs(fresh.tab);
  ok(before['dc-su-gap'] !== sent['dc-su-gap'] || before['dc-r-credits'] !== sent['dc-r-credits'],
    'non-vacuous: the fresh page does not already show the sender\'s deal');
  await Promise.all([fresh.tab.waitForNavigation({ timeout: 60000 }), pick(fresh.tab, file)]);
  await ready(fresh.tab);
  await fresh.tab.waitForTimeout(2500);
  const got = await outputs(fresh.tab);
  const diffs = Object.keys(sent).filter((id) => sent[id] !== got[id]).map((id) => {
    const a = sent[id], b = String(got[id]);
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return id + ' (from char ' + i + '): "' + a.slice(Math.max(0, i - 40), i + 80) + '" / "' + b.slice(Math.max(0, i - 40), i + 80) + '"';
  });
  ok(diffs.length === 0, 'the opened file shows every figure the sender saw (' + diffs.length + ' differ):\n  ' + diffs.slice(0, 8).join('\n  '));
  const gotInputs = await inputs(fresh.tab);
  const inDiffs = Object.keys(sentInputs).filter((id) => sentInputs[id] !== gotInputs[id]);
  ok(inDiffs.length === 0, 'the opened file restores every input (' + inDiffs.join(', ') + ')');
  ok(fresh.errors.length === 0, 'no page errors on opening: ' + fresh.errors.slice(0, 3).join(' | '));
  ok((await toasts(fresh.tab)).some((t) => t.includes(name)), 'the page says which file it opened: ' + JSON.stringify(await toasts(fresh.tab)));

  // Files that are not deal files leave the deal on screen alone.
  const bad = {
    'not JSON': 'this is not json',
    'JSON without a deal': JSON.stringify({ hello: 1 }),
    'another page\'s link': JSON.stringify(Object.assign({}, snap, { url: snap.url.replace('deal-calculator.html', 'market-analysis.html') })),
    'a deal with no settings': JSON.stringify(Object.assign({}, snap, { url: snap.url.split('?')[0] }))
  };
  for (const [label, body] of Object.entries(bad)) {
    const f = path.join(tmp, label.replace(/\W+/g, '-') + '.json');
    fs.writeFileSync(f, body);
    const url = fresh.tab.url();
    await fresh.tab.evaluate(() => { window.__toasts = []; });
    await pick(fresh.tab, f);
    await fresh.tab.waitForFunction(() => window.__toasts.some((t) => /not a Deal Calculator deal file/.test(t)), null, { timeout: 5000 });
    await fresh.tab.waitForTimeout(500);
    ok(fresh.tab.url() === url, label + ': refused, and the page stays on the same deal');
  }
  await sender.ctx.close();
  await fresh.ctx.close();

  // At 390px the save buttons fit on the screen.
  const phone = await open(browser, 390);
  const fit = await phone.tab.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll('#dcShareBar button')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, left: r.left, right: r.right }; })
  }));
  ok(fit.buttons.some((b) => b.id === 'dc-share-open') && fit.buttons.some((b) => b.id === 'dc-share-json'), 'both deal-file buttons render');
  ok(fit.buttons.every((b) => b.left >= 0 && b.right <= 390), 'at 390px every save button is on screen: ' + JSON.stringify(fit.buttons));
  ok(fit.page <= 390, 'at 390px the page does not scroll sideways (' + fit.page + 'px)');
  await phone.ctx.close();
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`deal-file: ${checks} checks passed`);
