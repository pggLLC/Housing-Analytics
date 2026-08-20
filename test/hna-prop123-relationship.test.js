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
    url: 'https://example.test/housing-needs-assessment.html',
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

  assert.equal(DATA.jurisdictions.length, 217, 'real fixture contains the 217 filed jurisdictions');
  assert.equal(DATA.jurisdictions.filter((row) => row.status === 'Committed').length, 216, '216 records remain Committed');
  assert.equal(DATA.jurisdictions.filter((row) => row.status === 'Commitment Met').length, 1, 'one record remains Commitment Met');
  assert.equal(DATA.jurisdictions.filter((row) => row.fast_track === true).length, 91, '91 records carry fast_track true');

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

  const controller = fs.readFileSync(path.join(ROOT, 'js/hna/hna-controller.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert(html.includes('js/prop123-map.js'), 'HNA reuses the existing Prop 123 module');
  assert(!controller.includes("loadJson('data/policy/prop123_jurisdictions.json')"), 'controller adds no fourth fetch path');

  dom.window.close();
  console.log('hna-prop123-relationship: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
