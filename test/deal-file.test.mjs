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
    // The live host refuses a request line this long (HTTP 414, 2026-11-04):
    // a test server that serves any length would miss it.
    if (route.request().url().length > 8192) return route.fulfill({ status: 414, body: 'URI Too Long' });
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
    const held = await inputs(fresh.tab);
    // A marker on this page: it survives only if the page does not reload.
    await fresh.tab.evaluate(() => { window.__toasts = []; window.__samePage = true; });
    await pick(fresh.tab, f);
    // The page answers (whatever the wording), then nothing reloads.
    await fresh.tab.waitForFunction(() => !window.__samePage || window.__toasts.length > 0, null, { timeout: 5000 });
    await fresh.tab.waitForTimeout(1000);
    const still = await fresh.tab.evaluate(() => window.__samePage === true).catch(() => false);
    ok(still && fresh.tab.url() === url, label + ': refused, and the page does not reload');
    const after = await inputs(fresh.tab);
    ok(Object.keys(held).every((id) => held[id] === after[id]), label + ': every input stays as it was');
  }
  await sender.ctx.close();
  await fresh.ctx.close();

  // A full deal (invented D1 from the 2026-11-04 practitioner QA): 60 Mesa
  // homes, 20 each at 30/50/60% AMI, $24m, itemized costs with their sources.
  // Its settings run to about 30 KB, which in the query drew HTTP 414 on the
  // live site through both Copy link and Open deal file. Both now open it.
  const big = await open(browser);
  await set(big.tab, 'dc-county-select', MESA);
  await big.tab.waitForTimeout(800);
  await big.tab.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e.type === 'checkbox' || e.type === 'radio') e.checked = v; else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('dc-unit-mix-source', 'manual');
    set('dc-units', 60);
    for (const t of [20, 30, 40, 50, 60, 70, 80, 100, 110, 120]) {
      set('dc-chk-' + t, false); set('dc-units-' + t, 0);
      for (const br of ['studio', '1br', '2br', '3br', '4br']) set('dc-units-' + t + '-' + br, '');
    }
    for (const t of [30, 50, 60]) { set('dc-chk-' + t, true); set('dc-units-' + t, 20); set('dc-br-' + t, document.querySelector('#dc-br-' + t + ' option[value*="2"]').value); }
    document.querySelectorAll('[id^="dc-op-"]').forEach((e) => { if (!/income/.test(e.id)) set(e.id, 0); });
    set('dc-building-type', 'walk_up');
    set('dc-tdc', 24000000);
    document.querySelectorAll('input[id^="dc-cost-"]').forEach((e) => { if (!/-(basis|eligible|used)$/.test(e.id) && e.type !== 'checkbox') set(e.id, ''); });
    set('dc-cost-land', 1000000); set('dc-cost-structures', 19000000); set('dc-cost-design', 720000);
    set('dc-cost-developer_fee', 2280000); set('dc-cost-reserves', 1000000);
    set('dc-vacancy', 7); set('dc-op-operating_other', 5400); set('dc-rep-reserve', 350); set('dc-prop-tax', 900);
    set('dc-rate', 6.59); set('dc-term', 35); set('dc-dcr', 1.15); set('dc-equity-price', 0.89); set('dc-deferred-pct', 40);
  });
  const figures = async (tab) => {
    let last = '';
    for (let i = 0; i < 40; i++) {
      await tab.waitForTimeout(400);
      const now = await tab.evaluate(() => { const o = window.__DealCalc.getOutputRecords(); return JSON.stringify({ gap: o.fundingGap.value, noi: o.stabilizedNoi.value, rents: o.annualRents.value }); });
      if (now === last) return JSON.parse(now);
      last = now;
    }
    return JSON.parse(last);
  };
  const d1 = await figures(big.tab);
  ok(Math.round(d1.gap) === 4294800 && d1.noi === 308544 && d1.rents === 760800,
    'non-vacuous: the sender shows the D1 gap $4,294,800, NOI $308,544 and rents $760,800: ' + JSON.stringify(d1));
  const legacy = await big.tab.evaluate(() => new URL(window.__DealCalcShare.buildSnapshot().url).search.length);
  ok(legacy > 8192, 'non-vacuous: in the query this deal is ' + legacy + ' bytes, past the 8,192 the host accepts');
  await big.tab.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
    window.__DealCalcShare.copyLink();
  });
  await big.tab.waitForFunction(() => window.__copied, null, { timeout: 5000 });
  const link = await big.tab.evaluate(() => window.__copied);
  ok(/deal-calculator\.html#v=1&/.test(link) && !link.includes('?'), 'Copy link puts the deal in the fragment, which never reaches the server');
  // A tab already on the calculator: only the fragment changes, and the page
  // must still open the new deal (it reloads on hashchange).
  const viaLink = await open(browser, 1280);
  await Promise.all([viaLink.tab.waitForNavigation({ timeout: 60000 }), viaLink.tab.evaluate((u) => { window.location.href = u; }, link)]);
  await ready(viaLink.tab);
  ok(JSON.stringify(await figures(viaLink.tab)) === JSON.stringify(d1), 'a fresh browser opening the copied link shows the sender\'s gap, NOI and rents');
  const [bigDl] = await Promise.all([big.tab.waitForEvent('download'), big.tab.click('#dc-share-json')]);
  const bigFile = path.join(tmp, 'd1.coho.json');
  await bigDl.saveAs(bigFile);
  const viaFile = await open(browser);
  await Promise.all([viaFile.tab.waitForNavigation({ timeout: 60000 }), pick(viaFile.tab, bigFile)]);
  await ready(viaFile.tab);
  ok(JSON.stringify(await figures(viaFile.tab)) === JSON.stringify(d1), 'a fresh browser opening the deal file shows the sender\'s gap, NOI and rents');
  ok(viaLink.errors.length === 0 && viaFile.errors.length === 0, 'no page errors: ' + viaLink.errors.concat(viaFile.errors).slice(0, 3).join(' | '));
  await big.ctx.close(); await viaLink.ctx.close(); await viaFile.ctx.close();

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
