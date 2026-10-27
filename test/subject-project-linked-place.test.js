'use strict';
// A link that names a place prices it on Market Analysis.
//
// Found 2026-10-26 (usability audit J3): opened from a link in a fresh
// browser, Market Analysis headed itself "Fruita (city)" but left the
// Subject project county blank, so every rent-limit row read unavailable.
// The subject now takes the linked county when nothing else names one, and
// when the link carries auto=1 (the site's own "open this place" links).
// A plain link never overrides a visitor's saved project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(p, 'utf8');
const json = p => JSON.parse(read(p));
const KEY = 'coho.subjectProject.v1';
const BOULDER = { geoid: '0807850', countyFips: '08013', name: 'Boulder', geoType: 'place' };
const files = ['js/site-state.js', 'js/workflow-state-core.js', 'js/workflow-state-api.js',
  'js/components/jurisdiction-url-context.js', 'js/chfa-rent-limits.js', 'js/components/subject-project.js'];

async function page(query, setup) {
  const w = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://example.org/market-analysis.html' + query, runScripts: 'outside-only' }).window;
  w.fetch = u => {
    const p = new URL(u, w.location.href).pathname.slice(1);
    const exists = fs.existsSync(p);
    return Promise.resolve({ ok: exists, status: exists ? 200 : 404, json: () => Promise.resolve(exists ? json(p) : null) });
  };
  files.forEach(p => w.eval(read(p)));
  if (setup) setup(w);
  await w.JurisdictionUrlContext.resolve();
  return w;
}

(async () => {
  let w = await page('?fips=08109&geoType=county&auto=1');
  assert.equal(w.SubjectProject.get().county_fips, '08109', 'a county link must set the subject county');

  w = await page('?geoid=0828745');
  assert.equal(w.SubjectProject.get().county_fips, '08077', 'a place link must set its containing county (Fruita -> Mesa)');

  const saved = w2 => {
    w2.WorkflowState.setJurisdiction(BOULDER);
    w2.localStorage.setItem(KEY, JSON.stringify({ jurisdiction_geoid: BOULDER.geoid, county_fips: BOULDER.countyFips,
      address: 'My Boulder site', unit_mix: [] }));
  };
  w = await page('?geoid=0828745', saved);
  assert.equal(w.SubjectProject.get().county_fips, '08013', 'a plain link must not override a saved project');
  assert.equal(w.SubjectProject.get().address, 'My Boulder site', 'a plain link must not clear the saved subject');

  w = await page('?fips=0828745&geoType=place&auto=1', saved);
  assert.equal(w.SubjectProject.get().county_fips, '08077', 'an auto=1 link must outrank a stale saved place');

  w = await page('');
  assert.equal(w.SubjectProject.get().county_fips, '', 'no link and no project leaves the county unpicked');

  console.log('subject-project-linked-place: PASS');
})().catch(e => { console.error(e); process.exit(1); });
