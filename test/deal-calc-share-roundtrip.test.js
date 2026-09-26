'use strict';

// Deal Calculator share link / JSON export round-trip.
//
// Found on main 2026-09-26: the share URL was built from a hand-kept list of
// input ids (SHARE_KEYS) that had stopped growing while the calculator kept
// adding inputs — the county selector, gross SF, the studio split column, the
// ownership resale inputs, the methodology constants. A sender in Mesa County
// in ownership mode saw a max affordable price of $291,723 and a gap of
// $41,610; the recipient opening the link saw every output as "—", because
// the county never arrived and nothing is priced without one.
//
// Held here, on the whole page (every local script the page loads, inline ones
// included, run in page order against the real data files):
//   1. a rental deal and an ownership deal round-trip: every visible output on
//      the recipient's page equals the sender's;
//   2. every form control on the page is either shared or excluded with a
//      reason — a control added to neither is reported, so an input cannot be
//      silently dropped again;
//   3. the JSON export carries the computed outputs, null (never 0) where an
//      output is unavailable, and keeps its inputs shape for importers;
//   4. a unit mix whose tiers exceed Total Units renders no credit figures.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const PAGE = 'deal-calculator.html';
const ORIGIN = 'http://127.0.0.1/';
const MESA = '08077';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
  // Each page keeps timers running; close them so the next test's pages load
  // at full speed.
  openPages.splice(0).forEach((dom) => dom.window.close());
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, what, ms, errors) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error('timed out waiting for ' + what + (errors && errors.length ? '; page errors: ' + errors.slice(0, 3).join(' | ') : ''));
}

/* ── The whole page, its scripts run in page order ─────────────────────── */

function fileFetch(url) {
  const u = new URL(String(url), ORIGIN + PAGE);
  let body = null;
  if (u.origin + '/' === ORIGIN) {
    try { body = fs.readFileSync(path.join(root, decodeURIComponent(u.pathname)), 'utf8'); } catch (_) { /* 404 */ }
  }
  return Promise.resolve({
    ok: body != null, status: body != null ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(body)), text: () => Promise.resolve(body)
  });
}

const pageSrc = fs.readFileSync(path.join(root, PAGE), 'utf8');
const openPages = [];

async function openPage(search) {
  const vc = new VirtualConsole();
  const errors = [];
  // jsdom's "Not implemented" notices (canvas, scrolling) are not page errors.
  vc.on('jsdomError', (e) => { if (!/^Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(pageSrc, {
    url: ORIGIN + PAGE + (search || ''), runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  openPages.push(dom);
  const w = dom.window;
  w.fetch = fileFetch;
  // Every page is a first visit: jsdom shares storage across instances of the
  // same origin, and the recipient of a share link has none of the sender's.
  try { w.localStorage.clear(); w.sessionStorage.clear(); } catch (_) { /* storage unavailable */ }
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  // Classic scripts (head and inline) run as parsed; deferred ones after the
  // parse, in order; then DOMContentLoaded. CDN libraries (PDF export) skipped.
  const deferred = [];
  Array.from(w.document.querySelectorAll('script')).forEach((s) => {
    if (s.type && !/javascript/.test(s.type)) return;
    const src = s.getAttribute('src');
    if (src && /^https?:/.test(src)) return;
    // jsdom has no canvas; Chart.js would throw inside the renderers that
    // draw charts and cut their recalculation short. Without it the page
    // takes its no-chart path, on sender and recipient alike.
    if (src === 'js/vendor/chart.umd.min.js') return;
    const code = src ? fs.readFileSync(path.join(root, src), 'utf8') : s.textContent;
    const run = () => {
      try { w.eval(code + '\n//# sourceURL=' + (src || 'inline')); }
      catch (e) { errors.push((src || 'inline script') + ': ' + e.message); }
    };
    if (src && s.hasAttribute('defer')) deferred.push(run); else run();
  });
  deferred.forEach((run) => run());
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.dispatchEvent(new w.Event('load'));
  const d = w.document;
  await waitFor(() => {
    const c = d.getElementById('dc-county-select');
    return c && c.options.length > 60;
  }, 'the county list to load', 20000, errors.concat(['HudFmr loaded=' + (w.HudFmr && w.HudFmr.isLoaded())]));
  // Hydration fires at 350 ms and may wait on async options; let it settle.
  await sleep(search ? 2500 : 600);
  return { w, d, errors };
}

function setField(page, id, value) {
  const el = page.d.getElementById(id);
  assert(el, id + ' does not render');
  if (el.type === 'checkbox' || el.type === 'radio') el.checked = value;
  else el.value = String(value);
  el.dispatchEvent(new page.w.Event('input', { bubbles: true }));
  el.dispatchEvent(new page.w.Event('change', { bubbles: true }));
}
function setSelector(page, selector, value) {
  const el = page.d.querySelector(selector);
  assert(el, selector + ' does not render');
  el.value = value;
  assert.strictEqual(el.value, value, selector + ' has no option ' + value);
  el.dispatchEvent(new page.w.Event('change', { bubbles: true }));
}

// What a reader sees: every rendered output figure, as text. Hidden ones are
// skipped (the other mode's panel), form controls are not outputs.
const OUTPUT_ID = /^(dc-(r|su|own)-|dc-minimum-set-aside-status$|dc-units-sync-warn$|dc-gsf-working$|proFormaMount$)/;
function visibleOutputs(page) {
  const out = {};
  page.d.querySelectorAll('main [id]').forEach((el) => {
    if (!OUTPUT_ID.test(el.id) || /^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(el.tagName)) return;
    if (el.closest('[hidden]')) return;
    out[el.id] = el.textContent.replace(/\s+/g, ' ').trim();
  });
  return out;
}
const isValue = (t) => t && t !== '—' && t !== '-';

function shareSearch(page) {
  // The URL the page builds for Copy share link / Export JSON. Read from the
  // snapshot (public since F202), so this test runs unchanged against main.
  const snap = page.w.__DealCalcShare.buildSnapshot();
  return new URL(snap.url).search;
}

async function roundTrip(sender, label) {
  const sent = visibleOutputs(sender);
  const search = shareSearch(sender);
  const recipient = await openPage(search);
  assert.deepStrictEqual(recipient.errors, [], label + ' recipient page raised errors while hydrating');
  const got = visibleOutputs(recipient);
  const diffs = Object.keys(sent).filter((id) => sent[id] !== got[id])
    .map((id) => id + ': sender "' + sent[id].slice(0, 70) + '" / recipient "' + String(got[id]).slice(0, 70) + '"');
  assert.deepStrictEqual(diffs, [], label + ' outputs differ after the round trip (' + diffs.length + '):\n      ' +
    diffs.slice(0, 12).join('\n      ') + '\n      URL: ' + search.slice(0, 300));
  return { sent, recipient, search };
}

(async () => {
  console.log('\nDeal Calculator share round-trip');
  console.log('='.repeat(62));

  await test('an ownership deal in Mesa round-trips (the reported defect)', async () => {
    const s = await openPage('');
    setField(s, 'dc-mode-ownership', true);
    setSelector(s, '#dc-county-select', MESA);
    await sleep(300);
    setField(s, 'dc-gross-sf', 64000);
    setField(s, 'dc-sale-target-ami', '100');
    setField(s, 'dc-own-resale-years', 7);
    setField(s, 'dc-own-resale-appreciation', 25000);
    await sleep(200);
    const subsidy = s.d.querySelector('[data-resale-subsidy-type]');
    assert(subsidy, 'the resale convention picker did not render in ownership mode');
    setSelector(s, '[data-resale-subsidy-type]', 'home_development_subsidy');
    await sleep(200);
    const sent = visibleOutputs(s);
    ['dc-own-max-price', 'dc-own-gap-per-unit', 'dc-own-cost-per-sf'].forEach((id) =>
      assert(isValue(sent[id]), 'sender shows no ' + id + ' (' + sent[id] + '); the round trip would compare blanks'));
    const rentalShown = Object.keys(sent).filter((id) => /^dc-r-(basis|credits|equity|rents|mortgage|noi)/.test(id));
    assert.deepStrictEqual(rentalShown, [], 'rental outputs visible in ownership mode');
    const { recipient, search } = await roundTrip(s, 'Ownership');
    assert.strictEqual(recipient.d.getElementById('dc-county-select').value, MESA, 'recipient county is not Mesa');
    assert(recipient.d.getElementById('dc-mode-ownership').checked, 'recipient is not in ownership mode');
    assert.strictEqual(recipient.d.querySelector('[data-resale-subsidy-type]').value, 'home_development_subsidy',
      'recipient resale subsidy type differs');
    // #1874 still holds: an ownership link carries no rental-only input.
    const params = new URLSearchParams(search);
    ['rate-9', 'basis-pct', 'noi', 'dcr', 'equity-price', 'units-60', 'units-60-studio', 'const-rent-burden', 'tr']
      .forEach((k) => assert(!params.has(k), 'ownership share URL carries rental-only ' + k));
  });

  await test('a rental deal with a studio split, gross SF, 4% credits and a changed constant round-trips', async () => {
    const s = await openPage('');
    setSelector(s, '#dc-county-select', MESA);
    await sleep(300);
    setField(s, 'dc-rate-4', true);
    setField(s, 'dc-tdc', 18500000);
    setField(s, 'dc-gross-sf', 52000);
    setField(s, 'dc-units-60-studio', 6);
    setField(s, 'dc-units-60-1br', 9);
    setField(s, 'dc-const-rent-burden', 28);
    setField(s, 'dc-vacancy', 6);
    setField(s, 'dc-gsf-efficiency', 0.83);
    const amount = s.d.querySelector('[data-tranche-id] .dc-tr-amount');
    if (amount) { amount.value = '750000'; amount.dispatchEvent(new s.w.Event('input', { bubbles: true })); }
    await sleep(200);
    const sent = visibleOutputs(s);
    const shown = Object.keys(sent).filter((id) => isValue(sent[id]));
    assert(shown.length >= 25, 'only ' + shown.length + ' rental outputs carry a value; the comparison would be vacuous');
    ['dc-r-credits', 'dc-r-rents', 'dc-r-mortgage', 'dc-su-gap'].forEach((id) =>
      assert(isValue(sent[id]), 'sender shows no ' + id));
    const { recipient } = await roundTrip(s, 'Rental');
    assert.strictEqual(recipient.d.getElementById('dc-units-60-studio').value, '6', 'studio split did not arrive');
    assert(recipient.d.getElementById('dc-rate-4').checked, '4% credit rate did not arrive');
  });

  await test('every form control on the page is shared or excluded with a reason', async () => {
    const p = await openPage('');
    const audit = JSON.parse(JSON.stringify(p.w.__DealCalcShare.auditInputs()));
    assert.deepStrictEqual(audit.unaccounted, [], 'controls neither shared nor excluded: ' + audit.unaccounted.join(', '));
    assert(audit.shared.length >= 100, 'only ' + audit.shared.length + ' shared inputs; the scan is not reading the page');
    ['dc-county-select', 'dc-gross-sf', 'dc-units-60-studio', 'dc-own-resale-years', 'dc-const-rent-burden',
      'dc-gsf-standard', 'dc-mode-rental', 'dc-rate-9', 'pf-rent-growth'].forEach((id) =>
      assert(audit.shared.includes(id), id + ' is not shared'));
    assert(!audit.shared.includes('dc-mode-ownership') && !audit.shared.includes('dc-rate-4'),
      'a radio group is carried by more than one key');
    audit.excluded.forEach((e) => assert(e.reason && e.reason.length > 10, 'exclusion without a reason: ' + e.control));
  });

  await test('the guard reports a control added to neither list, and shares a new dc- input', async () => {
    const p = await openPage('');
    const mount = p.d.getElementById('dealCalcMount');
    const stray = p.d.createElement('input');
    stray.id = 'new-unlisted-input';
    mount.appendChild(stray);
    const audit = JSON.parse(JSON.stringify(p.w.__DealCalcShare.auditInputs()));
    assert(p.d.getElementById('new-unlisted-input'), 'sabotage did not apply: the stray input is not on the page');
    assert.deepStrictEqual(audit.unaccounted, ['new-unlisted-input'], 'the guard missed a control in neither list: ' + JSON.stringify(audit.unaccounted));
    stray.remove();

    const added = p.d.createElement('input');
    added.id = 'dc-new-assumption';
    added.value = '42';
    mount.appendChild(added);
    assert(p.w.__DealCalcShare.shareKeys().includes('dc-new-assumption'), 'a new dc- input is not shared');
    assert.strictEqual(new URLSearchParams(shareSearch(p)).get('new-assumption'), '42', 'a new dc- input is missing from the URL');
  });

  await test('the JSON export carries outputs, null where unavailable, and keeps its inputs shape', async () => {
    // No county: nothing is priced, so rent-driven outputs are unavailable.
    const p = await openPage('');
    const snap = p.w.__DealCalcShare.buildSnapshot();
    assert.strictEqual(snap.dealMode, 'rental');
    assert(snap.inputs && typeof snap.inputs.tdc === 'string' && Array.isArray(snap.tranches), 'inputs/tranches shape changed');
    assert(snap.outputs && typeof snap.outputs === 'object', 'the export has no outputs key');
    assert.strictEqual(snap.outputs.annualRents, null, 'no county, but annualRents is ' + JSON.stringify(snap.outputs.annualRents));
    assert.strictEqual(snap.outputs.firstMortgage, null, 'no county, but firstMortgage is ' + JSON.stringify(snap.outputs.firstMortgage));
    Object.keys(snap.outputs).forEach((k) => {
      const v = snap.outputs[k];
      assert(v === null || (typeof v === 'string' && isValue(v)), k + ' is ' + JSON.stringify(v) + ', neither a value nor null');
      assert(!(v !== null && /^\$0$/.test(v) && /rents|mortgage/i.test(k)), k + ' reports $0 for an unmeasured value');
    });
    assert.strictEqual(snap.outputs.eligibleBasis, p.d.getElementById('dc-r-basis').textContent,
      'eligibleBasis is not what the page shows');

    p.w.document.getElementById('dc-mode-ownership').checked = true;
    p.w.document.getElementById('dc-mode-ownership').dispatchEvent(new p.w.Event('change', { bubbles: true }));
    setSelector(p, '#dc-county-select', MESA);
    await sleep(300);
    const own = p.w.__DealCalcShare.buildSnapshot();
    assert.strictEqual(own.dealMode, 'ownership');
    assert.deepStrictEqual(Object.keys(own.outputs).sort(),
      ['costPerGrossSf', 'costPerUnit', 'maxAffordablePrice', 'subsidyGapPerUnit', 'totalOwnershipGap'],
      'ownership outputs carry a rental figure or miss an ownership one');
    assert.strictEqual(own.outputs.maxAffordablePrice, p.d.getElementById('dc-own-max-price').textContent.trim());
    assert(isValue(own.outputs.maxAffordablePrice), 'Mesa ownership max price unavailable: ' + own.outputs.maxAffordablePrice);
    assert.strictEqual(own.outputs.costPerGrossSf, null, 'no gross SF entered, but costPerGrossSf is ' + own.outputs.costPerGrossSf);
  });

  await test('tier units exceeding Total Units render no basis, credits, equity or set-aside verdict', async () => {
    const p = await openPage('');
    setSelector(p, '#dc-county-select', MESA);
    await sleep(300);
    assert(isValue(p.d.getElementById('dc-r-equity').textContent), 'no equity before the sabotage; the check would be vacuous');
    setField(p, 'dc-units', 20);   // default tiers hold 60 units
    const warn = p.d.getElementById('dc-units-sync-warn');
    assert(!warn.hidden && /exceed Total Units/.test(warn.textContent), 'the hard error did not show');
    ['dc-r-basis', 'dc-r-credits', 'dc-r-equity', 'dc-r-rents', 'dc-su-gap'].forEach((id) =>
      assert.strictEqual(p.d.getElementById(id).textContent.trim(), '—', id + ' still renders ' + p.d.getElementById(id).textContent));
    const msa = p.d.getElementById('dc-minimum-set-aside-status').textContent;
    assert(!/Qualifies/.test(msa) && !/60 of 20/.test(msa), 'set-aside still evaluated: ' + msa);
    const snap = p.w.__DealCalcShare.buildSnapshot();
    assert.strictEqual(snap.outputs.creditEquity, null, 'JSON export creditEquity is ' + snap.outputs.creditEquity);
    setField(p, 'dc-units', 60);
    assert(isValue(p.d.getElementById('dc-r-equity').textContent), 'equity did not return once the mix was fixed');
  });

  if (failures) {
    console.log('\n' + failures + ' failed');
    process.exit(1);
  }
  console.log('\nAll Deal Calculator share round-trip checks passed');
  process.exit(0);
})();
