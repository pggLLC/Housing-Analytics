'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/policy/prop123_jurisdictions.json'), 'utf8'));
const MAP_MODULE = path.join(ROOT, 'js/prop123-map.js');
const RENDERERS = path.join(ROOT, 'js/hna/hna-renderers.js');

async function main() {
  const dom = new JSDOM('<!doctype html><div id="prop123Relationship"></div>', {
    url: 'http://127.0.0.1/housing-needs-assessment.html',
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Chart = class { destroy() {} };
  window.Chart = global.Chart;

  let loads = 0;
  window.DataService = {
    baseData: (rel) => 'data/' + rel,
    getJSON: async () => { loads += 1; return DATA; },
  };
  window.HNAUtils = {};

  delete require.cache[require.resolve(MAP_MODULE)];
  require(MAP_MODULE);
  const api = window.Prop123Jurisdictions;
  assert(api, 'shared Prop 123 loader/lookup is exposed');
  await Promise.all([api.load(), api.load()]);
  assert.equal(loads, 1, 'shared loader caches the existing data-service request');

  // The counts must agree with the totals the file states, which the builder
  // takes from DOLA's lists (scripts/policy/build_prop123_jurisdictions.py).
  const met = DATA.jurisdictions.filter((row) => row.status === 'Commitment Met').length;
  assert.equal(DATA.jurisdictions.length, 217, 'DOLA states 217 first-cycle filings');
  assert.equal(met, DATA.commitment_met_count, 'Commitment Met rows equal the stated commitment_met_count');
  assert(met > 1, 'DOLA has verified more than Silverton since January 2026');
  assert.equal(DATA.jurisdictions.filter((row) => row.status === 'Committed').length, DATA.jurisdictions.length - met, 'every other filer is Committed');
  assert.equal(DATA.jurisdictions.filter((row) => row.fast_track === true).length, DATA.fast_track_count, 'fast-track rows equal the stated fast_track_count');
  assert.equal(DATA.jurisdictions.reduce((s, row) => s + row.proposed_units, 0), DATA.total_projected_units, 'unit goals sum to the stated total');

  const aurora = api.relationship(DATA, 'place', 'Aurora (city)');
  assert.equal(aurora.status, 'Committed', 'prefixed DOLA city name matches the HNA place label');
  const springs = api.relationship(DATA, 'place', 'Colorado Springs (city)');
  assert.equal(springs.fastTrack, 'Yes', 'fast_track true displays as its own fact');

  const fruita = api.relationship(DATA, 'place', 'Fruita (city)');
  assert.equal(fruita.status, 'Committed', 'Fruita filing status is direct from the record');
  assert.equal(fruita.fastTrack, 'No', 'fast_track false displays independently from committed status');

  const silverton = api.relationship(DATA, 'place', 'Silverton (town)');
  assert.equal(silverton.status, 'Commitment Met', 'non-default status is preserved verbatim');

  const mountCrestedButte = api.relationship(DATA, 'place', 'Mount Crested Butte (town)');
  assert.equal(mountCrestedButte.status, 'Committed', 'DOLA Mt. abbreviation matches the full HNA label');

  const absent = api.relationship(DATA, 'cdp', 'Clifton (CDP)');
  assert.equal(absent.record, null, 'an absent geography does not fabricate a record');
  assert.equal(absent.status, 'Not committed', 'absence means Not committed, never missing data');
  assert.equal(absent.fastTrack, 'Not committed', 'absence is explicit in the fast-track fact too');

  // A CDP cannot file; its county's commitment covers it (C.R.S.
  // § 29-32-105(1)(b)), so its status must equal the county's record.
  const douglas = api.relationship(DATA, 'county', 'Douglas County');
  const acresGreen = api.relationship(DATA, 'cdp', 'Acres Green (CDP)', 'Douglas County');
  assert.equal(acresGreen.record, null, 'a CDP has no filing of its own');
  assert.equal(acresGreen.coveredBy.name, douglas.record.name, 'a CDP is covered by its containing county');
  assert.equal(acresGreen.status, douglas.status, 'a CDP shows its county\'s commitment status');
  assert.equal(acresGreen.fastTrack, douglas.fastTrack, 'a CDP shows its county\'s fast-track designation');
  const unknownCounty = api.relationship(DATA, 'cdp', 'Acres Green (CDP)', 'Nowhere County');
  assert.equal(unknownCounty.status, 'Not committed', 'a county with no DOLA filing leaves the CDP Not committed');

  // A CDP across a county line takes each county's record; where they
  // differ the status says so instead of picking one county.
  const columbine = api.relationship(DATA, 'cdp', 'Columbine (CDP)', ['Jefferson County', 'Arapahoe County']);
  const jeffco = api.relationship(DATA, 'county', 'Jefferson County');
  const arapahoe = api.relationship(DATA, 'county', 'Arapahoe County');
  assert.equal(columbine.countyRecords.length, 2, 'a two-county CDP carries both county records');
  assert.equal(columbine.fastTrack, jeffco.fastTrack === arapahoe.fastTrack ? jeffco.fastTrack : 'Depends on county',
    'a two-county CDP never shows one county\'s fast-track designation for the whole area');

  // The 2027–2029 filing comes from DOLA's next-cycle list, including
  // filers with no 2024–2026 record.
  DATA.next_cycle.filings.forEach((f) => {
    const isCounty = /county/i.test(f.name) && !/city and county/i.test(f.name);
    const label = isCounty ? f.name : f.name.replace(/^(City and County|City|Town) of /, '') + ' (place)';
    const r = api.relationship(DATA, isCounty ? 'county' : 'place', label === 'Central (place)' ? 'Central City (city)' : label);
    assert(r.nextCycle && r.nextCycle.filing, `${f.name}: its 2027–2029 filing is found`);
    assert.equal(r.nextCycle.filing.submitted, f.submitted, `${f.name}: the filing date is DOLA's`);
  });
  assert.equal(api.relationship(DATA, 'place', 'Fruita (city)').nextCycle.filing, null, 'no 2027–2029 filing is invented');
  (DATA.fast_track_without_cycle1_commitment || []).forEach((f) => {
    const r = api.relationship(DATA, 'place', f.name.replace(/^(City|Town) of /, '') + ' (town)');
    assert.equal(r.fastTrack, 'Yes', `${f.name}: a fast-track adoption without a 2024–2026 commitment still shows`);
    assert.equal(r.status, 'Not committed', `${f.name}: its 2024–2026 status stays Not committed`);
  });
  assert((DATA.fast_track_without_cycle1_commitment || []).length > 0, 'the fast-track-only list is non-empty, so the check above ran');
  // A fast-track-only entry must not be a misspelt cycle-1 jurisdiction: DOLA's
  // sheet wrote "Parker Town of" and "Town of Plateville", which left Parker
  // and Platteville showing "Not adopted" (#2564 review).
  const bare = (n) => n.toLowerCase().replace(/,/g, ' ').replace(/\b(city and county|town|city|county) of\b|\bof (town|city)\b|\b(town|city|county)\b/g, ' ')
    .replace(/[^a-z]/g, '').replace(/(.)\1/g, '$1');
  const cycle1 = new Set(DATA.jurisdictions.map((r) => bare(r.name)));
  (DATA.fast_track_without_cycle1_commitment || []).forEach((f) => {
    assert(!cycle1.has(bare(f.name)), `${f.name}: matches a cycle-1 jurisdiction, so its adoption belongs on that record`);
  });

  // Every DOLA filing by a Colorado county or municipality matches a geography.
  const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/geo-config.json'), 'utf8'));
  const matched = new Set();
  geo.counties.forEach((c) => { const r = api.relationship(DATA, 'county', c.label); if (r.record) matched.add(r.record.name); });
  geo.places.concat(geo.cdps || []).forEach((p) => { const r = api.relationship(DATA, p.type === 'cdp' ? 'cdp' : 'place', p.label); if (r.record) matched.add(r.record.name); });
  const unmatched = DATA.jurisdictions.filter((j) => !matched.has(j.name) && !/tribe/i.test(j.name)).map((j) => j.name);
  assert.deepEqual(unmatched, [], 'every county and municipal filing reaches a selectable geography');

  // The same-name guards are checked on synthetic filings: DOLA's real list
  // has no Glendale or Highlands Ranch filing (the hand-typed list before
  // 2026-10 invented both).
  const FIXTURE = Object.assign({}, DATA, {
    jurisdictions: DATA.jurisdictions.concat([
      { name: 'City of Glendale', kind: 'municipality', type: 'City', status: 'Committed', fast_track: false },
      { name: 'City of Highlands Ranch', kind: 'municipality', type: 'City', status: 'Committed', fast_track: false },
    ]),
  });
  assert.equal(api.relationship(DATA, 'place', 'Glendale (city)').status, 'Not committed', 'DOLA lists no Glendale filing');
  assert.equal(api.relationship(DATA, 'cdp', 'Highlands Ranch (CDP)').rejectedSameNameRecord, null, 'DOLA lists no Highlands Ranch filing to disclose');

  const glendaleCdp = api.relationship(FIXTURE, 'cdp', 'Glendale (CDP)');
  assert.equal(glendaleCdp.record, null, 'a colliding CDP does not inherit a municipality filing');
  assert.equal(glendaleCdp.status, 'Not committed', 'a colliding CDP remains explicitly Not committed');
  assert.equal(glendaleCdp.rejectedSameNameRecord.name, 'City of Glendale', 'the rejected same-name filing is retained for disclosure');
  const glendaleCity = api.relationship(FIXTURE, 'place', 'Glendale (city)');
  assert.equal(glendaleCity.record.name, 'City of Glendale', 'the incorporated city still matches its DOLA filing');
  assert.equal(glendaleCity.status, 'Committed', 'the CDP guard does not refuse the incorporated city');

  const arapahoeCdp = api.relationship(DATA, 'cdp', 'Arapahoe (CDP)');
  assert.equal(arapahoeCdp.status, 'Not committed', 'a CDP sharing a county name remains explicitly Not committed');
  assert.equal(arapahoeCdp.rejectedSameNameRecord, null, 'a same-name county filing does not trigger the CDP disclosure');

  const highlandsRanch = api.relationship(FIXTURE, 'cdp', 'Highlands Ranch (CDP)');
  assert.equal(highlandsRanch.status, 'Not committed', 'Highlands Ranch remains Not committed under the CDP rule');
  assert.equal(highlandsRanch.record, null, 'Highlands Ranch does not inherit a same-name municipal filing');
  assert.equal(highlandsRanch.rejectedSameNameRecord.name, 'City of Highlands Ranch', 'the rejected same-name filing is available to the renderer');

  delete require.cache[require.resolve(RENDERERS)];
  require(RENDERERS);
  window.HNARenderers.renderProp123Relationship(absent, 'Clifton (CDP)', true);
  const relationshipEl = document.getElementById('prop123Relationship');
  const rendered = relationshipEl.textContent.replace(/\s+/g, ' ').trim();
  const values = Array.from(relationshipEl.querySelectorAll('.metric-value')).map((el) => el.textContent);
  assert.equal(values[0], 'Not committed', 'rendered HNA shows the absent status explicitly');
  assert.equal(values[1], 'Not committed', 'rendered HNA does not show an absent fast-track value as blank');
  assert(!rendered.includes('No data'), 'absent geography never renders as No data');
  assert(values.every((value) => value !== '—' && value !== ''), 'neither factual value renders as a dash or blank');
  assert(rendered.includes('not a ranking or recommendation'), 'relationship panel expressly disclaims ranking');

  window.HNARenderers.renderProp123Relationship(acresGreen, 'Acres Green (CDP)', true);
  const acresRendered = relationshipEl.textContent.replace(/\s+/g, ' ').trim();
  assert.equal(relationshipEl.querySelector('.metric-value').textContent, douglas.status, 'rendered CDP status is the county\'s');
  assert(acresRendered.includes('covered by ' + douglas.record.name), 'rendered CDP names the county whose commitment covers it');

  window.HNARenderers.renderProp123Relationship(columbine, 'Columbine (CDP)', true);
  const columbineRendered = relationshipEl.textContent.replace(/\s+/g, ' ').trim();
  assert(columbineRendered.includes('Jefferson County') && columbineRendered.includes('Arapahoe County'), 'a two-county CDP names both counties');
  // 2027–2029 across a county line: one answer only when the counties agree.
  const jeffFiled = Object.assign({}, DATA, { next_cycle: Object.assign({}, DATA.next_cycle, {
    filings: DATA.next_cycle.filings.concat([{ name: 'Jefferson County', submitted: '2026-10-15', unit_goal: 100 }]) }) });
  const mixed = api.relationship(jeffFiled, 'cdp', 'Columbine (CDP)', ['Jefferson County', 'Arapahoe County']);
  assert.equal(mixed.nextCycle.across, 'mixed', 'one county filed, one not: mixed');
  window.HNARenderers.renderProp123Relationship(mixed, 'Columbine (CDP)', true);
  const mixedValues = Array.from(relationshipEl.querySelectorAll('.metric-value')).map((el) => el.textContent);
  assert.equal(mixedValues[2], 'Depends on county', 'mixed next-cycle filings show Depends on county, not nothing');
  assert(relationshipEl.textContent.includes('2027–2029 filed 2026-10-15') && relationshipEl.textContent.includes('2027–2029 not yet filed'),
    'each county\'s 2027–2029 filing is listed');

  const stratton = api.relationship(DATA, 'place', 'Stratton (town)');
  window.HNARenderers.renderProp123Relationship(stratton, 'Stratton (town)', true);
  const strattonValues = Array.from(relationshipEl.querySelectorAll('.metric-value')).map((el) => el.textContent);
  assert.equal(strattonValues[2], 'Filed ' + stratton.nextCycle.filing.submitted, 'a 2027–2029 filer shows its filing even with no 2024–2026 record');

  window.HNARenderers.renderProp123Relationship(highlandsRanch, 'Highlands Ranch (CDP)', true);
  const highlandsRendered = relationshipEl.textContent.replace(/\s+/g, ' ').trim();
  assert.equal(relationshipEl.querySelector('.metric-value').textContent, 'Not committed', 'same-name anomaly does not hedge the headline status');
  assert(highlandsRendered.includes("DOLA lists a filing under \u201cCity of Highlands Ranch\u201d"), 'disclosure names the rejected DOLA filing');
  assert(highlandsRendered.includes('unincorporated CDP, which cannot file'), 'disclosure explains why the same-name filing was rejected');

  const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert(html.includes('js/prop123-map.js'), 'HNA reuses the existing Prop 123 module');
  assert(!controller.includes('prop123_jurisdictions.json'), 'controller contains no fetch-like reference to the policy filename; the shared loader remains the only path');

  dom.window.close();
  console.log('hna-prop123-relationship: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
