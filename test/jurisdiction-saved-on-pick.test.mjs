#!/usr/bin/env node
/**
 * Choosing a jurisdiction saves it — on the pick, not on the Continue button.
 *
 * Step 1 has several ways out: Continue, the "Step 1 of 7 · Go on to
 * Opportunity Finder →" box, the step rail, the site nav. Until 2026-09-25
 * only Continue saved the choice. The header still read "+ Choose
 * jurisdiction" after a pick, and a reader who followed the numbered steps
 * (1, then 2) arrived at steps 3-7 looking at the State of Colorado. The G3
 * dry run hit it on its first walk.
 *
 * So this does not enumerate exits — any list of them is one link short of
 * the next one someone adds. It asserts the thing every exit depends on: by
 * the time a pick has been made, WorkflowState already holds it.
 *
 * What the saved record must AGREE with is data/hna/geo-config.json: the geoid
 * saved for "Fruita" is Fruita's geoid there, and a county pick saves that
 * county's FIPS. A restyled picker, reworded labels, a different results
 * list — all green. Save the wrong place, or nothing — red.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELECTOR = fs.readFileSync(path.join(ROOT, 'js/jurisdiction-selector.js'), 'utf8');
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/geo-config.json'), 'utf8'));

let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

const PAGE = `<!doctype html><html><body>
  <input id="citySearch"><ul id="cityResults" hidden></ul>
  <input id="countySearch"><ul id="countyResults" hidden></ul>
  <p id="countyHint"></p><div id="cityFieldGroup"></div>
  <div id="sjSelection" hidden><strong id="sjSelectionName"></strong><span id="sjSelectionSub"></span>
  <button id="sjClearBtn"></button></div>
  <button id="sjContinueBtn" disabled></button><p id="sjActionNote"></p>
  <div id="sjRecent" hidden><div id="sjRecentList"></div></div>
</body></html>`;

/** Load the real selector against a recording WorkflowState. */
function load({ saved = null } = {}) {
  const dom = new JSDOM(PAGE, { url: 'http://localhost/select-jurisdiction.html', runScripts: 'outside-only' });
  const w = dom.window;
  const writes = [];
  let active = saved ? { id: 'p1' } : null;
  w.WorkflowState = {
    getActiveProject: () => active,
    newProject: () => { active = { id: 'p1' }; },
    setJurisdiction: (payload) => { writes.push(payload); },
    getStep: (k) => (k === 'jurisdiction' ? saved : null),
    listProjects: () => [],
  };
  w.fetch = (url) => Promise.resolve({
    ok: /geo-config\.json$/.test(String(url)),
    json: () => Promise.resolve(GEO),
  });
  w.eval(SELECTOR);
  return { w, writes };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Type into a search box and pick the first result, as a reader does. */
async function pick(w, inputId, listId, text) {
  const input = w.document.getElementById(inputId);
  input.value = text;
  input.dispatchEvent(new w.Event('input'));
  await tick();
  const first = w.document.querySelector(`#${listId} li`);
  // Non-vacuity on the scan: if nothing was offered, nothing was picked, and a
  // "no write" result would prove nothing.
  assert.ok(first, `typing "${text}" offered no results to pick from`);
  first.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await tick();
}

console.log('jurisdiction-saved-on-pick');

const fruita = (GEO.places || []).find((p) => /^Fruita\b/.test(p.label || ''));
const jackson = (GEO.counties || []).find((c) => /^Jackson\b/.test(c.label || c.name || ''));

await test('the fixtures this guard reads exist in geo-config', () => {
  assert.ok(fruita && fruita.geoid, 'Fruita is not in data/hna/geo-config.json places');
  assert.ok(jackson, 'Jackson County is not in data/hna/geo-config.json counties');
});

await test('a place picked from search is saved before anything is clicked', async () => {
  const { w, writes } = load();
  await tick();
  await pick(w, 'citySearch', 'cityResults', 'Fruita');
  assert.ok(writes.length > 0,
    'picking Fruita saved nothing — leaving step 1 by any route but Continue loses it');
  const last = writes[writes.length - 1];
  assert.strictEqual(last.geoid, fruita.geoid,
    `saved geoid ${last.geoid} is not Fruita's geoid in geo-config (${fruita.geoid})`);
  assert.strictEqual(last.countyFips, fruita.containingCounty,
    `saved county ${last.countyFips} is not the county geo-config places Fruita in`);
});

await test('a county picked from search is saved before anything is clicked', async () => {
  const { w, writes } = load();
  await tick();
  await pick(w, 'countySearch', 'countyResults', 'Jackson');
  assert.ok(writes.length > 0, 'picking Jackson County saved nothing');
  const last = writes[writes.length - 1];
  const fips = jackson.geoid || jackson.fips;
  assert.strictEqual(last.geoid, fips, `saved ${last.geoid}, geo-config has Jackson County as ${fips}`);
  assert.strictEqual(last.geoType, 'county');
});

await test('showing a saved choice on return does not re-save it', async () => {
  // Restoring runs selectCounty() then selectCity(). Saving inside that would
  // write the county alone first — and for good, if geo-config has not loaded
  // yet and the place cannot be looked up — replacing the place the reader
  // chose last time with its county.
  const saved = { fips: fruita.containingCounty, name: fruita.label, type: 'city', displayName: fruita.label };
  const { w, writes } = load({ saved });
  await tick();
  assert.ok(w.document.getElementById('sjSelection').hidden === false,
    'the saved choice was not shown at all, so this test exercised nothing');
  assert.strictEqual(writes.length, 0,
    `restoring a saved choice wrote ${writes.length} time(s); the first write was ${JSON.stringify(writes[0] && writes[0].geoType)}`);
});

if (failures) {
  console.log(`  jurisdiction-saved-on-pick: FAIL (${failures})`);
  process.exit(1);
}
console.log('  jurisdiction-saved-on-pick: PASS');
