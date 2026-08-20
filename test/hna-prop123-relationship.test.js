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

  assert.equal(DATA.jurisdictions.length, 217, 'real-data count is expected to drift; update this fixture pin when DOLA changes its filed jurisdictions');
  assert.equal(DATA.jurisdictions.filter((row) => row.status === 'Committed').length, 216, 'Committed count is expected to drift; update this fixture pin when DOLA changes the data');
  assert.equal(DATA.jurisdictions.filter((row) => row.status === 'Commitment Met').length, 1, 'Commitment Met count is expected to drift; update this fixture pin when DOLA changes the data');
  assert.equal(DATA.jurisdictions.filter((row) => row.fast_track === true).length, 91, 'fast-track count is expected to drift; update this fixture pin when DOLA changes the data');

  const aurora = api.relationship(DATA, 'place', 'Aurora (city)');
  assert.equal(aurora.status, 'Committed', 'prefixed DOLA city name matches the HNA place label');
  assert.equal(aurora.fastTrack, 'Yes', 'fast_track true displays as its own fact');

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

  const glendaleCdp = api.relationship(DATA, 'cdp', 'Glendale (CDP)');
  assert.equal(glendaleCdp.record, null, 'a colliding CDP does not inherit a municipality filing');
  assert.equal(glendaleCdp.status, 'Not committed', 'a colliding CDP remains explicitly Not committed');
  assert.equal(glendaleCdp.rejectedSameNameRecord.name, 'City of Glendale', 'the rejected same-name filing is retained for disclosure');
  const glendaleCity = api.relationship(DATA, 'place', 'Glendale (city)');
  assert.equal(glendaleCity.record.name, 'City of Glendale', 'the incorporated city still matches its DOLA filing');
  assert.equal(glendaleCity.status, 'Committed', 'the CDP guard does not refuse the incorporated city');

  const arapahoeCdp = api.relationship(DATA, 'cdp', 'Arapahoe (CDP)');
  assert.equal(arapahoeCdp.status, 'Not committed', 'a CDP sharing a county name remains explicitly Not committed');
  assert.equal(arapahoeCdp.rejectedSameNameRecord, null, 'a same-name county filing does not trigger the CDP disclosure');

  const highlandsRanch = api.relationship(DATA, 'cdp', 'Highlands Ranch (CDP)');
  assert.equal(highlandsRanch.status, 'Not committed', 'Highlands Ranch remains Not committed under the CDP rule');
  assert.equal(highlandsRanch.record, null, 'Highlands Ranch does not inherit DOLA\'s anomalous municipal filing');
  assert.equal(highlandsRanch.rejectedSameNameRecord.name, 'City of Highlands Ranch', 'same-name DOLA anomaly is available to the renderer');

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
