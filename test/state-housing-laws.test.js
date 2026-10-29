'use strict';
// test/state-housing-laws.test.js
// The SB24-174 / state housing laws card on the HNA pages
// (js/components/state-housing-laws.js) and its data file
// (data/policy/state-housing-laws.json, built from DOLA's Multilaw sheet).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const doc = JSON.parse(read('data/policy/state-housing-laws.json'));
const tick = () => new Promise(r => setTimeout(r, 0));

// Data: every DOLA row placed, every law answered in DOLA's words, sourced.
assert.ok(doc.meta.jurisdiction_count >= 330, 'DOLA lists 335 jurisdictions');
assert.match(doc.meta.source_url, /docs\.google\.com\/spreadsheets\/d\/1dGcQTZ9X_3CUipeQ1q15xZLFMtGvzFgwfWrGDSkYo04/);
assert.ok(doc.meta.fetched && doc.meta.review_by > doc.meta.fetched);
const ids = doc.laws.map(l => l.id);
assert.ok(ids.includes('sb24-174-hna'));
for (const l of doc.laws) assert.match(l.url, /^https:\/\/(leg|dlg)\.colorado\.gov\//, l.id + ' links a primary source');
const rows = Object.entries(doc.jurisdictions);
assert.ok(rows.length >= doc.meta.jurisdiction_count, 'every sheet row has a GEOID');
for (const [g, r] of rows) {
  assert.match(g, /^08(\d{3}|\d{5})$/, g);
  for (const id of ids) assert.ok(r.laws[id], g + ' ' + id + ' has DOLA\'s status');
  assert.match(r.laws['sb24-174-hna'], /^(Required|Exempt)/);
}
assert.equal(doc.jurisdictions['08031'].name, 'Denver', 'Denver is both city and county');
assert.equal(doc.jurisdictions['0820000'].name, 'Denver');

async function page(current) {
  const dom = new JSDOM('<!doctype html><div id="m" data-state-laws></div>', { url: 'https://cohoanalytics.com/hna-who-lives-here.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.HNAState = { state: { current } };
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(doc) });
  w.eval(read('js/components/state-housing-laws.js'));
  for (let i = 0; i < 5; i++) await tick();
  return w;
}

(async () => {
  // A town on DOLA's approved list.
  let w = await page({ geoType: 'place', geoid: '0828745', label: 'Fruita', contextCounty: '08077' });
  let t = w.document.getElementById('m').textContent;
  assert.match(t, /State housing laws for Fruita/);
  assert.match(t, /December 31, 2026/);
  assert.match(t, /as approved on Mar 11, 2026/);
  assert.match(t, /DOLA decides whether a place complies/);
  assert.equal(w.document.querySelectorAll('.shl-list li').length, doc.laws.length);

  // A county with no approved assessment yet says so, with the date checked.
  w = await page({ geoType: 'county', geoid: '08077', label: 'Mesa County' });
  t = w.document.getElementById('m').textContent;
  assert.match(t, /Mesa County/);
  assert.match(t, /approved list had no assessment for it when we checked/);

  // A CDP is unincorporated: its county's obligations apply.
  w = await page({ geoType: 'cdp', geoid: '0800320', label: 'Acres Green CDP', contextCounty: '08035' });
  t = w.document.getElementById('m').textContent;
  assert.match(t, /Acres Green CDP is unincorporated, so Douglas County's obligations apply/);

  // An exempt town shows DOLA's exemption and no deadline.
  const exempt = Object.entries(doc.jurisdictions).find(([, r]) => /^Exempt: Under/.test(r.laws['sb24-174-hna']));
  w = await page({ geoType: 'place', geoid: exempt[0], label: exempt[1].name, contextCounty: '08001' });
  t = w.document.getElementById('m').textContent;
  assert.match(t, /Exempt: Under 1,000 Residents/);
  assert.doesNotMatch(t, /due to DOLA/);

  // Statewide asks for a place; combined views do too.
  w = await page({ geoType: 'state', geoid: '08', label: 'Colorado' });
  assert.match(w.document.getElementById('m').textContent, /Pick a county or town/);

  // The HNA source page and every generated chapter carry the mount and the script.
  for (const f of ['housing-needs-assessment.html', 'hna-who-lives-here.html', 'hna-what-housing-exists.html',
    'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html']) {
    const s = read(f);
    assert.match(s, /data-state-laws/, f + ' has the mount');
    assert.match(s, /js\/components\/state-housing-laws\.js/, f + ' loads the card');
  }
  console.log('state-housing-laws: all checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
