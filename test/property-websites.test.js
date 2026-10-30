'use strict';
// test/property-websites.test.js
// Confirmed links for former affordable properties
// (data/affordable-housing/property-websites.json), shown by the property
// lookup bar (js/components/property-lookup-links.js) and the HUD contracts
// table on Preservation (js/components/hud-contract-expiry.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const raw = read('data/affordable-housing/property-websites.json');
const sites = JSON.parse(raw);
const props = JSON.parse(read('data/affordable-housing/properties.json')).properties;
const byId = new Map(props.map(p => [p.property_id, p]));
const hud = JSON.parse(read('data/market/hud_s8_contracts_co.json'));
const tick = () => new Promise(r => setTimeout(r, 0));

// Data: dated, sourced, and every entry still names the record it is keyed to.
const m = sites.meta;
assert.match(m.checked, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(m.review_by > m.checked, 'review_by is after checked');
assert.equal(m.count, Object.keys(sites.entries).length);
for (const [id, e] of Object.entries(sites.entries)) {
  const p = byId.get(id);
  assert.ok(p, id + ' is in properties.json');
  assert.equal(e.name, p.property_name.trim(), id + ' name matches');
  assert.equal(e.address, p.address, id + ' address matches');
  assert.ok(['property', 'usda-listing'].includes(e.kind), id + ' kind');
  assert.match(e.url, /^https:\/\//, id + ' is https');
  assert.match(e.checked, /^\d{4}-\d{2}-\d{2}$/, id + ' has a checked date');
  assert.ok(e.listed_there_as, id + ' says how the page names it');
  if (e.kind === 'usda-listing') {
    assert.match(e.url, /^https:\/\/rdmfhrentals\.sc\.egov\.usda\.gov\/RDMFHRentals\/projectservlet\?state=CO&st=08&cnty=\d{3}&/, id + ' is a USDA county list');
    assert.equal(e.url.match(/cnty=(\d{3})/)[1], String(p.county_fips).slice(2), id + ' county matches');
  }
}
// Listing and ad sites never count as a property's page.
assert.doesNotMatch(Object.values(sites.entries).map(e => e.url).join(' '), /apartments\.com|zillow|rentcafe|apartmentfinder|apartmentlist|after55|affordablehousingonline|caring\.com|seniors\.fyi|hotpads|trulia|redfin/i);
assert.doesNotMatch(raw, /[\w.+-]+@[\w-]+\.[\w.]+/, 'no email addresses');
assert.doesNotMatch(raw, /\(?\d{3}\)?[ -]?\d{3}-\d{4}/, 'no phone numbers');
// HUD entries are keyed so the contracts table can find them.
for (const id of Object.keys(sites.entries).filter(k => sites.entries[k].kind === 'property' && k.startsWith('hud-mf:'))) {
  assert.ok(hud.contracts.some(c => 'hud-mf:' + c.property_id === id), id + ' is in the HUD contracts file');
}

function dom(html, files) {
  const d = new JSDOM('<!doctype html><body>' + html + '</body>', { url: 'https://cohoanalytics.com/preservation.html', runScripts: 'outside-only' });
  d.window.fetch = url => {
    const f = Object.keys(files).find(k => String(url).endsWith(k));
    return Promise.resolve(f ? { ok: true, json: () => Promise.resolve(files[f]) } : { ok: false, status: 404 });
  };
  return d.window;
}

(async () => {
  // Lookup bar: a USDA record links to its county list, a confirmed page shows as Website.
  const w = dom('', { 'property-websites.json': sites });
  let ready = 0;
  w.addEventListener('property-websites:ready', () => { ready++; });
  w.eval(read('js/components/property-lookup-links.js'));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(ready, 1, 'announces the links once loaded');
  const PL = w.PropertyLookup;
  const usda = byId.get('usda-rd:0');
  const bar = PL.htmlFor(usda);
  assert.ok(bar.includes(sites.entries['usda-rd:0'].url.replace(/&/g, '&amp;')), 'USDA record links to its county list');
  assert.match(bar, /USDA listing/);
  assert.doesNotMatch(bar, />Website</, 'a USDA list is not called the property website');
  const girard = byId.get('hud-mf:800222637');
  assert.ok(PL.htmlFor(girard).includes('https://www.voacolorado.org/locations/girard-place-apartments/'), 'confirmed page shows');
  assert.match(PL.htmlFor(girard), />Website</);
  // A renumbered record with another name never borrows the link.
  assert.equal(PL.websiteFor(Object.assign({}, girard, { property_name: 'Some Other Place' })), null);
  assert.doesNotMatch(PL.htmlFor(byId.get('usda-rd:2') || { property_id: 'usda-rd:x', property_name: 'X', address: '1 Main', program_type: ['usda-rural-development'] }), /USDA listing/);

  // Without the file, the bar falls back to the old generic links.
  const w2 = dom('', {});
  w2.eval(read('js/components/property-lookup-links.js'));
  for (let i = 0; i < 5; i++) await tick();
  assert.match(w2.PropertyLookup.htmlFor(usda), /USDA RD/);

  // Preservation: the HUD table links a name only where a page was confirmed.
  const w3 = dom('<section id="hudContracts"></section>', { 'hud_s8_contracts_co.json': hud, 'property-websites.json': sites });
  w3.eval(read('js/components/hud-contract-expiry.js'));
  for (let i = 0; i < 5; i++) await tick();
  const links = [...w3.document.querySelectorAll('#hudContractsBody td:first-child a')];
  assert.equal(links.length, 1, 'one HUD property has a confirmed page');
  assert.equal(links[0].href, 'https://www.voacolorado.org/locations/girard-place-apartments/');
  assert.equal(links[0].getAttribute('rel'), 'noopener');
  console.log('property-websites: ok (' + m.count + ' entries)');
})().catch(e => { console.error(e); process.exit(1); });
