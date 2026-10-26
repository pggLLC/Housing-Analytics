// Deal Calculator quick estimate: the short panel at the top drives the full
// calculator and shows its results, so the two can never disagree.
//
// paul 10-26 picked "panel now, full stays for now" for the free quick estimate.
// Renders the real page in Chromium: each panel field must land in the full
// calculator's own input, each panel result must equal the full calculator's own
// output, a total typed in the panel must leave the cost lines adding up to it,
// and a share link must bring the panel back with the deal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const MESA = '08077';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

async function open(browser, search, width) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 } });
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
  await tab.goto(`${ORIGIN}/deal-calculator.html${search || ''}`, { waitUntil: 'load', timeout: 90000 });
  await tab.waitForFunction(() => window.__DealCalcQuick && document.getElementById('dq-county')
    && document.getElementById('dc-county-select').options.length > 60 && document.getElementById('dq-county').options.length > 60, null, { timeout: 60000 });
  await tab.waitForTimeout(search ? 2500 : 800);
  return { ctx, tab, errors };
}

// The panel's results and the full calculator's, as the reader sees them.
const pair = (tab) => tab.evaluate(() => window.__DealCalcQuick.OUTPUTS.map((o) => ({
  id: o.id,
  full: (document.getElementById(o.id) || {}).textContent.replace(/\s+/g, ' ').trim(),
  quick: document.getElementById('dq-out-' + o.id).textContent.replace(/\s+/g, ' ').trim()
})));
async function settle(tab) {
  let prev = JSON.stringify(await pair(tab));
  for (let i = 0; i < 30; i++) {
    await tab.waitForTimeout(300);
    const next = JSON.stringify(await pair(tab));
    if (next === prev) return JSON.parse(next);
    prev = next;
  }
  return JSON.parse(prev);
}
function agree(rows, label) {
  const off = rows.filter((r) => r.full !== r.quick);
  ok(off.length === 0, label + ': the panel shows exactly what the full calculator shows (' + JSON.stringify(off) + ')');
}
const measured = (rows) => rows.filter((r) => /^\$[\d,]+$/.test(r.full)).map((r) => r.id);
async function type(tab, id, value) {
  await tab.fill('#' + id, String(value));
  await tab.dispatchEvent('#' + id, 'change');
}

const bundled = chromium.executablePath();
const fromPuppeteer = fs.existsSync(bundled) ? null : await (await import('puppeteer')).default.executablePath();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled
  : fs.existsSync(fromPuppeteer) ? fromPuppeteer : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
try {
  const { ctx, tab, errors } = await open(browser);
  agree(await settle(tab), 'On opening');

  // County.
  await tab.selectOption('#dq-county', MESA);
  ok(await tab.$eval('#dc-county-select', (s) => s.value) === MESA, 'the county picked in the panel is the full calculator\'s county');
  const mesa = await settle(tab);
  agree(mesa, 'Mesa');
  ok(measured(mesa).length === 4, 'non-vacuous: all four results are dollar figures in Mesa (' + JSON.stringify(mesa) + ')');

  // Total development cost: the cost lines follow it, so the credit is still measured.
  await type(tab, 'dq-tdc', 25000000);
  const cost = await tab.evaluate(() => ({ tdc: document.getElementById('dc-tdc').value, lines: window.__DealCalcQuick.itemized() }));
  ok(cost.tdc === '25000000' && cost.lines === 25000000, 'a $25M total is the full calculator\'s total, and its cost lines add up to it (' + JSON.stringify(cost) + ')');
  const big = await settle(tab);
  agree(big, '$25M');
  ok(measured(big).includes('dc-r-credits') && measured(big).includes('dc-su-gap'), 'at $25M the credit and the gap are still measured');
  const credit = (rows) => rows.find((r) => r.id === 'dc-r-credits').full;
  ok(credit(big) !== credit(mesa), 'non-vacuous: the larger total moves the credit (' + credit(mesa) + ' to ' + credit(big) + ')');

  // Credit rate.
  await tab.check('#dq-rate-4');
  ok(await tab.$eval('#dc-rate-4', (r) => r.checked), '4% in the panel is 4% in the full calculator');
  const four = await settle(tab);
  agree(four, '4%');
  ok(credit(four) !== credit(big), 'non-vacuous: 4% moves the credit');
  await tab.check('#dq-rate-9');
  ok(await tab.$eval('#dc-rate-9', (r) => r.checked), '9% in the panel is 9% in the full calculator');

  // Homes by income limit, both ways.
  await tab.fill('#dq-units-60', '40');
  ok(await tab.$eval('#dc-units-60', (u) => u.value) === '40', 'homes typed in the panel are the full calculator\'s homes');
  agree(await settle(tab), '40 homes at 60%');
  await tab.evaluate(() => { const u = document.getElementById('dc-units-30'); u.value = '7'; u.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(tab);
  ok(await tab.$eval('#dq-units-30', (u) => u.value) === '7', 'homes typed in the full calculator show in the panel');

  // A tier the full calculator leaves out counts as none in the panel, and homes typed there put it back in.
  await tab.evaluate(() => { const c = document.getElementById('dc-chk-70'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(tab);
  ok(await tab.$eval('#dq-units-70', (u) => u.value) === '0', 'a tier left out below shows no homes in the panel');
  await tab.fill('#dq-units-70', '5');
  ok(await tab.$eval('#dc-chk-70', (c) => c.checked) && await tab.$eval('#dc-units-70', (u) => u.value) === '5',
    'homes typed in the panel for a left-out tier put it back in the full calculator');
  agree(await settle(tab), '5 homes at 70%');

  // Every control is shared or excluded with a reason; the panel adds no share key.
  const audit = await tab.evaluate(() => JSON.parse(JSON.stringify(window.__DealCalcShare.auditInputs())));
  ok(audit.unaccounted.length === 0, 'every control on the page is shared or excluded: ' + audit.unaccounted.join(', '));
  ok(!audit.shared.some((id) => /^dq-/.test(id)), 'the panel\'s own controls carry nothing in a share link');
  ok(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));

  // A share link brings the panel back with the deal.
  const sent = await settle(tab);
  const search = new URL(await tab.evaluate(() => window.__DealCalcShare.buildSnapshot().url)).search;
  const back = await open(browser, search);
  const got = await settle(back.tab);
  agree(got, 'Opened from the share link');
  ok(JSON.stringify(got) === JSON.stringify(sent), 'the opened link shows the sender\'s results in the panel');
  ok(await back.tab.$eval('#dq-tdc', (i) => i.value) === '25000000' && await back.tab.$eval('#dq-units-60', (i) => i.value) === '40',
    'the opened link fills the panel\'s fields');
  await back.ctx.close();

  // For-sale deals: the panel is for tax credit rentals, so it steps aside.
  await tab.check('#dc-mode-ownership');
  await tab.waitForTimeout(500);
  ok(await tab.$eval('#dcQuick', (s) => !!s.closest('[hidden]') || s.hidden || getComputedStyle(s).display === 'none'), 'in for-sale mode the panel is hidden');
  await ctx.close();

  // At 390px the panel fits.
  const phone = await open(browser, '', 390);
  const fit = await phone.tab.evaluate(() => {
    const p = document.getElementById('dcQuick').getBoundingClientRect();
    const inputs = [...document.querySelectorAll('#dcQuick input, #dcQuick select')].map((el) => el.getBoundingClientRect());
    return { left: p.left, right: p.right, page: document.documentElement.scrollWidth, inside: inputs.every((r) => r.left >= 0 && r.right <= 390) };
  });
  ok(fit.left >= 0 && fit.right <= 390 && fit.inside, 'at 390px the panel and its fields are on screen: ' + JSON.stringify(fit));
  ok(fit.page <= 390, 'at 390px the page does not scroll sideways (' + fit.page + 'px)');
  await phone.ctx.close();
} finally {
  await browser.close();
}
console.log(`deal-quick-estimate: ${checks} checks passed`);
