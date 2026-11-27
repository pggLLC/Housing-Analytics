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
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://example.org';
const MESA = '08077';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.geojson': 'application/json' };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

async function open(browser, search, width, saved) {
  const ctx = await browser.newContext({ viewport: { width: width || 1280, height: 900 } });
  // A Market Analysis rent schedule saved on this browser, as Market Analysis saves it.
  if (saved) await ctx.addInitScript((s) => localStorage.setItem('coho.subjectProject.v1', s), JSON.stringify(saved));
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

  // Homes by income limit, both ways. Total Units moves with the tier, so the deal stays whole.
  const val = (id) => tab.$eval('#' + id, (u) => u.value);
  const total0 = Number(await val('dc-units')), tier0 = Number(await val('dq-units-60'));
  await tab.fill('#dq-units-60', '40');
  ok(await val('dc-units-60') === '40', 'homes typed in the panel are the full calculator\'s homes');
  ok(Number(await val('dc-units')) === total0 + 40 - tier0 && await val('dq-units') === await val('dc-units'),
    'total homes move with the tier (' + total0 + ' to ' + await val('dc-units') + ')');
  const forty = await settle(tab);
  agree(forty, '40 homes at 60%');
  ok(measured(forty).includes('dc-r-credits') && measured(forty).includes('dc-r-equity'), 'with more homes at 60% the credit and equity are still measured (' + JSON.stringify(forty) + ')');
  // Homes outside these limits stay as they were: 10 market-rate homes, then a tier change.
  await tab.fill('#dq-units', String(Number(await val('dc-units')) + 10));
  ok(Number(await val('dc-units')) === total0 + 40 - tier0 + 10, 'total homes typed in the panel are the full calculator\'s Total Units');
  await settle(tab);
  ok(/10 unrestricted market-rate units/.test(await tab.$eval('#dq-mix', (m) => m.hidden ? '' : m.textContent)), 'the panel shows the full calculator\'s market-rate count');
  await tab.fill('#dq-units-60', '35');
  ok(Number(await val('dc-units')) === total0 + 35 - tier0 + 10, 'a smaller tier lowers total homes and keeps the 10 market-rate homes');
  await tab.fill('#dq-units-60', '40');
  await tab.fill('#dq-units', String(total0 + 40 - tier0));
  agree(await settle(tab), 'back to all homes at income limits');
  await tab.evaluate(() => { const u = document.getElementById('dc-units-30'); u.value = '7'; u.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle(tab);
  ok(await tab.$eval('#dq-units-30', (u) => u.value) === '7', 'homes typed in the full calculator show in the panel');

  // Bedroom size by income limit, both ways (paul, 23 Nov 2026: "deal calculator has only ami, not brs?"). The
  // size sets the tier's rent limit, so it moves the results, and the panel still shows what the calculator shows.
  ok(await val('dq-br-60') === '2br' && await val('dc-br-60') === '2br', 'the panel shows the calculator\'s 2-bedroom default');
  const before = await settle(tab);
  await tab.selectOption('#dq-br-60', '3br');
  ok(await val('dc-br-60') === '3br', 'a bedroom size picked in the panel is the full calculator\'s bedroom size');
  const three = await settle(tab);
  agree(three, '3 bedrooms at 60%');
  ok(JSON.stringify(three) !== JSON.stringify(before), 'non-vacuous: 3 bedrooms at 60% moves the results (' + JSON.stringify(three) + ')');
  await tab.evaluate(() => { const b = document.getElementById('dc-br-30'); b.value = '1br'; b.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(tab);
  ok(await val('dq-br-30') === '1br', 'a bedroom size picked in the full calculator shows in the panel');
  // A tier split by bedroom in Unit mix shows in the panel as its row of sizes, in place of the single picker.
  await tab.evaluate(() => { const u = document.getElementById('dc-units-50-2br'); u.value = '3'; u.dispatchEvent(new Event('input', { bubbles: true })); u.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(tab);
  ok(await tab.evaluate(() => document.getElementById('dq-br-50').hidden && !document.getElementById('dq-split-50').hidden && document.getElementById('dq-split-50-2br').value === '3'),
    'a tier split by bedroom in Unit mix shows as its row of sizes in the panel');
  await tab.evaluate(() => { ['studio', '1br', '2br', '3br', '4br'].map((b) => document.getElementById('dc-units-50-' + b)).forEach((u) => { u.value = '0'; u.dispatchEvent(new Event('input', { bubbles: true })); u.dispatchEvent(new Event('change', { bubbles: true })); }); });
  await settle(tab);
  ok(await tab.$eval('#dq-br-50', (b) => !b.disabled && !b.hidden), 'with the split cleared the picker is back');

  // Bedroom mix in the panel (paul, 27 Nov 2026: "only 1 br type?"): "Mix sizes" opens the tier's row with its homes in
  // the size they had, so nothing moves; a count there is the full calculator's bedroom split, the tier is its sum,
  // and Total Units moves by the same change; "One size" folds it back into the biggest size.
  {
    const t60 = Number(await val('dc-units-60')), all0 = Number(await val('dc-units')), size0 = await val('dc-br-60');
    const other = size0 === '3br' ? '2br' : '3br', third = size0 === '1br' ? 'studio' : '1br';
    const steady = await settle(tab);
    await tab.click('#dq-more-60');
    ok(await val('dc-units-60-' + size0) === String(t60) && await val('dq-split-60-' + size0) === String(t60) && await tab.$eval('#dq-split-60', (r) => !r.hidden),
      '"+ size" opens the 60% row with its ' + t60 + ' homes in their ' + size0);
    ok(JSON.stringify(await settle(tab)) === JSON.stringify(steady), 'opening the row moves no result');
    await tab.fill('#dq-split-60-' + size0, String(t60 - 5));
    await tab.fill('#dq-split-60-' + other, '5');
    ok(await val('dc-units-60-' + other) === '5' && await val('dc-units-60-' + size0) === String(t60 - 5), 'counts typed in the row are the full calculator\'s bedroom split');
    ok(await val('dq-units-60') === String(t60) && Number(await val('dc-units')) === all0, 'the tier is the row\'s sum and Total Units is unchanged (' + await val('dc-units') + ')');
    const mixed = await settle(tab);
    agree(mixed, '60% split into two sizes');
    ok(JSON.stringify(mixed) !== JSON.stringify(steady), 'non-vacuous: five homes of another size at 60% move the results');
    await tab.fill('#dq-split-60-' + third, '4');
    ok(await val('dq-units-60') === String(t60 + 4) && Number(await val('dc-units')) === all0 + 4, 'a home added in the row adds to the tier and to Total Units');
    agree(await settle(tab), '60% split with 4 more homes');
    await tab.fill('#dq-split-60-' + third, '0');
    await tab.click('#dq-split-60 button[data-dq-act="close"]');
    ok(await val('dc-br-60') === size0 && await val('dc-units-60') === String(t60) && await val('dc-units-60-' + other) === '0' && await tab.$eval('#dq-split-60', (r) => r.hidden),
      '"One size" folds the tier back into its biggest size, ' + size0);
    ok(JSON.stringify(await settle(tab)) === JSON.stringify(steady), 'and the results are back where they were');
  }

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
  const search = new URL(await tab.evaluate(() => window.__DealCalcShare.buildSnapshot().url)).hash;
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

  // A Market Analysis rent schedule sets the homes: the panel shows the schedule's counts, read only.
  const limits = require('../js/chfa-rent-limits.js');
  const chfa = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chfa-income-rent-limits-2026.json'), 'utf8'));
  const gross = (tier, br) => limits.maxGrossRent(chfa, MESA, tier, br).grossRent;
  const row = (tier, br, count) => ({ ami_tier: tier, bedrooms: br, count, proposed_gross_rent: gross(tier, br) - 37, utility_allowance: 150, fees: 10 });
  const saved = { county_fips: MESA, total_units: 21, vacancy_rate: 0.05,
    utility_allowance_basis: { method: 'pha', reference: 'County PHA schedule', effective_date: '2026-01-01', resident_paid: ['heat'], bound_county_fips: MESA },
    unit_mix: [row(30, '1BR', 4), row(60, '2BR', 12), row(60, '1BR', 3), row(50, '3BR', 2)] };
  const sch = await open(browser, '', 1280, saved);
  await sch.tab.selectOption('#dq-county', MESA);
  await sch.tab.waitForFunction(() => document.getElementById('dc-unit-mix-status') && document.getElementById('dc-unit-mix-status').dataset.mode === 'schedule', null, { timeout: 30000 });
  await settle(sch.tab);
  const shown = await sch.tab.evaluate(() => {
    const v = (id) => { const el = document.getElementById(id); return { value: el.value, disabled: el.disabled }; };
    return { t30: v('dq-units-30'), t60: v('dq-units-60'), t80: v('dq-units-80'), t50: v('dq-units-50'), total: v('dq-units'), br60: v('dq-br-60'), note: document.getElementById('dq-homes').textContent };
  });
  ok(shown.t30.value === '4' && shown.t60.value === '15' && shown.t50.value === '2' && shown.t80.value === '0',
    'the panel shows the rent schedule\'s homes at each income limit: ' + JSON.stringify(shown));
  ok(shown.total.value === '21' && /^21 homes.*rent schedule/.test(shown.note), 'the panel shows the schedule\'s 21 homes: ' + JSON.stringify(shown));
  ok([shown.t30, shown.t60, shown.t80, shown.t50, shown.total, shown.br60].every((f) => f.disabled), 'with a rent schedule the panel\'s homes and bedroom sizes are read only');
  const schOut = await settle(sch.tab);
  agree(schOut, 'With a rent schedule');
  ok(measured(schOut).length >= 3, 'non-vacuous: the schedule deal is measured (' + JSON.stringify(schOut) + ')');
  ok(sch.errors.length === 0, 'no page errors with a rent schedule: ' + sch.errors.slice(0, 3).join(' | '));
  await sch.ctx.close();

  // Changing a tier's size by clearing one count before typing the next (Codex, #3046): with every home in one tier,
  // the cleared count can't take Total Units below 1, so the panel holds the running total and the new count lands on
  // it. Moving 60 homes from one size to another must leave 60 in all, not 120 with 60 invented market-rate homes.
  {
    const w = await open(browser);
    const t = w.tab;
    const v = (id) => t.$eval('#' + id, (u) => u.value);
    for (const p of [20, 30, 40, 50, 70, 80]) if (Number(await v('dq-units-' + p)) > 0) await t.fill('#dq-units-' + p, '0');
    const n = Number(await v('dc-units-60'));
    await t.fill('#dq-units', String(n));
    ok(n > 0 && Number(await v('dc-units')) === n, 'non-vacuous: every one of ' + n + ' homes is at 60% (' + await v('dc-units') + ' in all)');
    // By the tier box: clear it, then type the homes back.
    await t.fill('#dq-units-60', '');
    await t.fill('#dq-units-60', String(n));
    ok(Number(await v('dc-units')) === n && Number(await v('dc-units-60')) === n, 'clearing the 60% count and typing it again leaves ' + n + ' in all (' + await v('dc-units') + ')');
    // By the bedroom row: clear one size, then put the homes in another.
    const size = await v('dc-br-60'), to = size === '3br' ? '2br' : '3br';
    await t.click('#dq-more-60');
    await t.fill('#dq-split-60-' + size, '');
    await t.fill('#dq-split-60-' + to, String(n));
    ok(Number(await v('dc-units')) === n && Number(await v('dc-units-60')) === n && await v('dc-units-60-' + to) === String(n),
      'moving all ' + n + ' homes from ' + size + ' to ' + to + ' leaves ' + n + ' in all (' + await v('dc-units') + ')');
    // A total typed while a count is cleared drops the hold: with no homes in a limit, all n + 2 typed are outside
    // the limits, and they stay outside when the n homes come back.
    await t.fill('#dq-split-60-' + to, '');
    await t.fill('#dq-units', String(n + 2));
    await t.fill('#dq-split-60-' + to, String(n));
    ok(Number(await v('dc-units')) === 2 * n + 2, 'a total typed meanwhile counts as typed (' + await v('dc-units') + ', expected ' + (2 * n + 2) + ')');
    ok(w.errors.length === 0, 'no page errors while moving sizes: ' + w.errors.slice(0, 3).join(' | '));
    await w.ctx.close();
  }

  // paul's walkthrough, 27 Nov 2026 ("I'm getting errors", "even when they match"): Mesa, $20.2M, 9%, one home at
  // 20% (3 bedrooms) and one at 70% beside the default 60. The 70% home earns no credit under the 40-60 election,
  // so the law needs floor space (26 U.S.C. 42(c)(1)(B)). The panel must say why, take the floor space or the
  // Average Income Test right there, and then show a measured result.
  {
    const w = await open(browser);
    const t = w.tab;
    const v = (id) => t.$eval('#' + id, (u) => u.value);
    const box = () => t.evaluate(() => { const b = document.getElementById('dq-floor'); return { shown: !b.hidden && b.getClientRects().length > 0, why: document.getElementById('dq-floor-why').textContent, status: document.getElementById('dq-floor-status').hidden ? '' : document.getElementById('dq-floor-status').textContent }; });
    await t.selectOption('#dq-county', MESA);
    await type(t, 'dq-tdc', 20200000);
    let base = await settle(t);
    ok(!(await box()).shown, 'with every home at 60% or below the floor-space box stays out of the way');
    ok(measured(base).length === 4, 'the default Mesa deal is measured: ' + JSON.stringify(base));
    await t.fill('#dq-units-20', '1');
    await t.selectOption('#dq-br-20', '3br');
    await t.fill('#dq-units-70', '1');
    ok(await v('dc-units') === '62' && await v('dq-units') === '62', 'two homes added at 20% and 70% make 62 in all (' + await v('dc-units') + ')');
    const before = await settle(t);
    agree(before, '62 homes, one at 70%');
    const b1 = await box();
    // The explanation must agree with the engine, not match one sentence: the engine decides which homes earn no credit
    // under the chosen election and what the election's ceiling is; the text must name those, in any wording.
    const truth = await t.evaluate(() => {
      const election = document.getElementById('dc-minimum-set-aside').value;
      const out = [];
      document.querySelectorAll('[id^="dc-units-"]').forEach((el) => {
        const m = /^dc-units-(\d+)$/.exec(el.id); const n = Number(el.value) || 0;
        if (m && n > 0 && !window.DealEngine.isLihtcCreditEligiblePct(Number(m[1]), election)) out.push({ pct: Number(m[1]), homes: n });
      });
      let ceiling = 0; for (let p = 20; p <= 120; p += 10) if (window.DealEngine.isLihtcCreditEligiblePct(p, election)) ceiling = p;
      return { election, out, ceiling };
    });
    ok(truth.election === '40-60' && truth.out.length === 1 && truth.out[0].pct === 70 && truth.out[0].homes === 1 && truth.ceiling === 60,
      'non-vacuous: the engine says one 70% home earns no credit under 40-60, ceiling 60%: ' + JSON.stringify(truth));
    const names = (why, t2) => t2.out.every((x) => new RegExp('\\b' + x.homes + ' homes?\\b[^.]*\\b' + x.pct + '%').test(why))
      && why.indexOf(t2.election) >= 0 && why.indexOf(t2.ceiling + '%') >= 0 && /credit/i.test(why);
    ok(b1.shown && names(b1.why, truth) && /Average Income Test/.test(b1.why),
      'the panel names the homes the engine leaves out, the election and its ceiling, and offers the Average Income Test: ' + JSON.stringify(b1));
    ok(/floor space/i.test(credit(before)), 'before floor space, the credit waits on it (the case paul hit): ' + credit(before));
    // Floor space typed in the panel is the full calculator's own floor space, and the credit is measured.
    await type(t, 'dq-res-sf', 54000);
    await type(t, 'dq-restricted-sf', 53150);
    ok(await v('dc-res-sf') === '54000' && await v('dc-restricted-sf') === '53150', 'floor space typed in the panel lands in the full calculator');
    const after = await settle(t);
    agree(after, 'with floor space');
    ok(measured(after).includes('dc-r-credits') && measured(after).includes('dc-r-equity') && measured(after).includes('dc-su-gap'),
      'with floor space the credit, equity and gap are measured: ' + JSON.stringify(after));
    // Or the Average Income Test counts the 70% home, and no floor space is needed.
    await type(t, 'dq-res-sf', '');
    await type(t, 'dq-restricted-sf', '');
    await t.selectOption('#dq-set-aside', 'average-income');
    ok(await v('dc-minimum-set-aside') === 'average-income', 'the election picked in the panel is the full calculator\'s election');
    const ait = await settle(t);
    agree(ait, 'Average Income Test');
    ok(!(await box()).shown, 'under the Average Income Test every home counts, so the box steps aside');
    ok(measured(ait).includes('dc-r-credits') && measured(ait).includes('dc-su-gap'), 'under the Average Income Test the credit and gap are measured: ' + JSON.stringify(ait));
    // A market-rate home (63 in all): it never earns credit, and CHFA's Average Income Test needs every home designated.
    await t.fill('#dq-units', '63');
    const mkt = await settle(t);
    agree(mkt, '63 homes under the Average Income Test');
    const b2 = await box();
    const mktHomes = Number(await v('dc-units')) - (await t.evaluate(() => [...document.querySelectorAll('[id^="dc-units-"]')].filter((el) => /^dc-units-\d+$/.test(el.id)).reduce((a, el) => a + (Number(el.value) || 0), 0)));
    ok(mktHomes === 1, 'non-vacuous: one home is outside every income limit (' + mktHomes + ')');
    ok(b2.shown && new RegExp('\\b' + mktHomes + ' market-rate homes?\\b').test(b2.why) && /credit/i.test(b2.why) && /Does not qualify/.test(b2.status), 'with a market-rate home the panel says why, and that the election fails: ' + JSON.stringify(b2));
    await t.selectOption('#dq-set-aside', '40-60');
    await type(t, 'dq-res-sf', 55000);
    await type(t, 'dq-restricted-sf', 53150);
    const back = await settle(t);
    agree(back, '63 homes, 40-60, floor space entered');
    ok(measured(back).includes('dc-r-credits') && measured(back).includes('dc-su-gap'), 'back on 40-60 with floor space the deal is measured: ' + JSON.stringify(back));
    ok(credit(back) !== credit(after), 'non-vacuous: the extra market-rate home moves the credit (' + credit(after) + ' to ' + credit(back) + ')');
    ok(w.errors.length === 0, 'no page errors in paul\'s case: ' + w.errors.slice(0, 3).join(' | '));
    await w.ctx.close();
  }

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
