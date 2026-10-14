#!/usr/bin/env node
'use strict';
// A Deal Calculator opened from a shared link (?geoid=) or priced through its
// own county selector must find that place's rents. Before 2026-10-14 the rent
// card read only the saved project and the site-wide county, so a linked
// Alamosa or Greeley read "No rent data on file" beside rents the page held.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const acs = JSON.parse(read('data/market/acs_median_rent_co.json'));
const fmr = JSON.parse(read('data/hud-fmr-income-limits.json'));
const zori = JSON.parse(read('data/market/zori_rents_co.json'));

// The page's own hydrator, taken from deal-calculator.html as shipped.
const html = read('deal-calculator.html');
const hydrator = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('_hydrateDcRent'));
assert.ok(hydrator, 'deal-calculator.html carries the rent-card hydrator');

function page(query, selectValue) {
  const dom = new JSDOM(`<!doctype html><body>
    <select id="dc-county-select"><option value="">Select a county…</option>
      <option value="08003">Alamosa County — Alamosa County, CO</option>
      <option value="08123">Weld County — Greeley, CO MSA</option></select>
    <div id="dcRentTriangulationMount"></div></body>`,
  { url: 'http://127.0.0.1/deal-calculator.html' + query, runScripts: 'outside-only' });
  const w = dom.window;
  w.document.getElementById('dc-county-select').value = selectValue;
  const calls = [];
  w.RentTriangulation = { attach: (mount, opts) => calls.push(opts) };
  w.eval(hydrator);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, calls };
}

// Linked place, county already chosen by the calculator.
let { calls } = page('?geoid=0801090', '08003');
assert.equal(calls.at(-1).placeGeoid, '0801090', 'the linked place reaches the rent card');
assert.equal(calls.at(-1).countyFips, '003', 'the calculator county reaches the rent card');

// No link: the selector alone, and a change to it, drive the card.
const p2 = page('', '');
assert.equal(p2.calls.at(-1).countyFips, null, 'nothing chosen yet');
const sel = p2.w.document.getElementById('dc-county-select');
sel.value = '08123';
sel.dispatchEvent(new p2.w.Event('change', { bubbles: true }));
assert.equal(p2.calls.at(-1).countyFips, '123', 'choosing a county redraws the rent card for it');
assert.equal(p2.calls.at(-1).countyName, 'Weld County');

// The component itself, against the shipped data files.
async function render(opts) {
  const dom = new JSDOM('<!doctype html><body><div id="m"></div></body>', { url: 'http://127.0.0.1/', runScripts: 'outside-only' });
  const w = dom.window;
  const byUrl = { 'data/market/zori_rents_co.json': zori, 'data/market/acs_median_rent_co.json': acs, 'data/hud-fmr-income-limits.json': fmr };
  w.fetch = (url) => Promise.resolve({ ok: true, json: () => Promise.resolve(byUrl[url]) });
  w.eval(read('js/components/rent-triangulation.js'));
  const m = w.document.getElementById('m');
  w.RentTriangulation.attach(m, opts);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return m.textContent;
}

(async () => {
  for (const [geoid, county] of [['0801090', '08003'], ['0832155', '08123']]) {
    const place = acs.places[geoid];
    assert.ok(place && place.median_gross_rent > 0, `${geoid} has an ACS rent in the data`);
    const fmrRow = fmr.counties.find((c) => c.fips === county);
    assert.ok(fmrRow && fmrRow.fmr && fmrRow.fmr.two_br > 0, `${county} has an FMR in the data`);
    const text = await render({ placeGeoid: geoid });
    assert.doesNotMatch(text, /No rent data on file/, `${place.name} by GEOID alone finds its rents`);
    const bare = place.name.replace(/\s*\((town|city|CDP)\)\s*$/i, '');
    assert.ok(text.includes(bare), `the card names ${bare}, from the ACS place record`);
    assert.ok(text.includes(fmrRow.fmr.two_br.toLocaleString()), `the card shows ${county}'s 2BR FMR from the data`);
  }
  const none = await render({});
  assert.match(none, /Choose a county/, 'no geography chosen asks for one');
  assert.doesNotMatch(none, /No rent data on file/, 'no geography chosen is not "no data"');
  console.log('deal calculator rent card finds linked places: PASS');
})().catch((e) => { console.error(e); process.exitCode = 1; });
