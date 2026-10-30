'use strict';
// test/hud-s8-contracts.test.js
// HUD Section 8 / 202 / 811 contract end dates on the Preservation page
// (js/components/hud-contract-expiry.js) and their data file
// (data/market/hud_s8_contracts_co.json, from scripts/hud/build_hud_s8_contracts.py).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const raw = read('data/market/hud_s8_contracts_co.json');
const doc = JSON.parse(raw);
const tick = () => new Promise(r => setTimeout(r, 0));

// Data: HUD's Colorado rows, dated and sourced, with no personal contacts.
const m = doc.meta;
assert.match(m.source_url, /^https:\/\/www\.hud\.gov\//);
assert.match(m.as_of, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(m.review_by > m.fetched, 'review_by is after fetched');
assert.equal(m.contract_count, doc.contracts.length);
assert.ok(doc.contracts.length >= 250, 'HUD lists about 340 Colorado contracts');
const counties = JSON.parse(read('data/co-county-boundaries.json')).features.map(f => '08' + String(f.properties.COUNTYFP || f.properties.GEOID || '').slice(-3));
for (const c of doc.contracts) {
  assert.match(c.county_fips, /^08\d{3}$/, c.contract_number);
  assert.ok(counties.includes(c.county_fips), c.contract_number + ' is in a Colorado county');
  assert.match(c.term_ends, /^\d{4}-\d{2}-\d{2}$/, c.contract_number + ' has a term end');
  assert.ok(c.program && !/^(S8|Sec\.|PRAC|Other) /.test(c.program), c.contract_number + ' program is in plain words');
}
assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no email addresses');
assert.doesNotMatch(raw, /\(?\d{3}\)?[ -]?\d{3}-\d{4}/, 'no phone numbers');
assert.doesNotMatch(raw, /"owner_|"mgmt_/, 'no owner or manager fields');

async function page() {
  const html = '<!doctype html><section id="hudContracts"></section>';
  const dom = new JSDOM(html, { url: 'https://cohoanalytics.com/preservation.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(doc) });
  w.eval(read('js/components/hud-contract-expiry.js'));
  for (let i = 0; i < 5; i++) await tick();
  return w;
}

(async () => {
  const w = await page();
  const d = w.document;
  const until = d.getElementById('hudContractsUntil');
  const county = d.getElementById('hudContractsCounty');
  const rowsShown = () => d.querySelectorAll('#hudContractsBody tr td:nth-child(2)').length;
  const homesShown = () => [...d.querySelectorAll('#hudContractsBody tr td:nth-child(3)')]
    .reduce((s, td) => s + (Number(td.textContent.replace(/,/g, '')) || 0), 0);
  // The summary must agree with the table under it, whatever the filters.
  function agrees(label) {
    const t = d.getElementById('hudContractsSummary').textContent;
    const n = Number(t.match(/^([\d,]+) HUD/)[1].replace(/,/g, ''));
    const h = Number(t.match(/covering ([\d,]+) homes/)[1].replace(/,/g, ''));
    assert.equal(n, rowsShown(), label + ': contract count matches the table');
    assert.equal(h, homesShown(), label + ': homes match the table');
    return n;
  }
  // Default window: HUD's year plus five, so the count is the data's, not a constant.
  const end = (Number(doc.meta.as_of.slice(0, 4)) + 5) + '-12-31';
  assert.equal(until.value, end);
  const expect = doc.contracts.filter(c => c.term_ends <= end).length;
  assert.ok(expect > 0, 'some contracts end in the window, so the checks below ran');
  assert.equal(agrees('default'), expect);
  // A county narrows both.
  const denver = doc.contracts.filter(c => c.county_fips === '08031' && c.term_ends <= end).length;
  county.value = '08031'; county.dispatchEvent(new w.Event('change'));
  assert.equal(agrees('Denver'), denver);
  assert.match(d.getElementById('hudContractsSummary').textContent, /in Denver County/);
  // Any year shows every contract.
  county.value = ''; county.dispatchEvent(new w.Event('change'));
  until.value = ''; until.dispatchEvent(new w.Event('change'));
  assert.equal(agrees('any year'), doc.contracts.length);
  // Every header explains itself (table-header-tips reads title).
  for (const th of d.querySelectorAll('#hudContractsTable th')) assert.ok(th.getAttribute('title'), th.textContent + ' has a definition');
  // The page says an ending term is not a loss, and names HUD's date.
  const text = d.getElementById('hudContracts').textContent;
  assert.match(text, /not a loss/);
  assert.match(text, /current as of/);

  const api = w.HudContractExpiry;
  assert.equal(api._niceName('ARAPAHOE MENTAL HEALTH'), 'Arapahoe Mental Health');
  assert.equal(api._niceName('SUNSET PARK II'), 'Sunset Park II');
  assert.equal(api._niceName('Harmony Road Apts.'), 'Harmony Road Apts.');

  // The page mounts it.
  const pres = read('preservation.html');
  assert.match(pres, /id="hudContracts"/);
  assert.match(pres, /src="js\/components\/hud-contract-expiry\.js"/);
  console.log('hud-s8-contracts: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
