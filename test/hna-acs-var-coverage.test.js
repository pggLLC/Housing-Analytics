#!/usr/bin/env node
/**
 * test/hna-acs-var-coverage.test.js
 *
 * Guardrail for the F169/F170 demographic-panel class of break (the
 * 2026-06-18 bug where Household-composition, Race & ethnicity, and
 * Educational-attainment rendered EMPTY for every place).
 *
 * Those panels read detailed ACS variables that live only in the *extended*
 * fetch, which fires only when `missingExtended` is true. The trigger checked
 * variables the precomputed summary caches already had, so the extended fetch
 * never fired and the panels got no data — and nothing caught it statically.
 *
 * This asserts:
 *   (1) every ACS DP-variable a renderer reads is fetched somewhere in the
 *       controller (base profile fetch OR extended fetch) — no renderer reads
 *       a variable that is fetched nowhere; and
 *   (2) the `missingExtended` trigger references at least one variable that is
 *       ABSENT from the precomputed summary cache — otherwise the extended
 *       fetch never fires for cached places and extended-only panels stay
 *       empty. (Pre-fix this FAILS; post-fix it PASSES.)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const VAR = /DP0[2-5]_\d{4}E/g;
const uniq = (a) => Array.from(new Set(a));

let failed = 0;
const fail = (m) => { console.error('  ❌ ' + m); failed++; };
const pass = (m) => console.log('  ✅ ' + m);

const renderers  = read('js/hna/hna-renderers.js');
const controller = read('js/hna/hna-controller.js');

// Variables the renderers read, and variables the controller fetches/references.
const readVars    = uniq(renderers.match(VAR) || []);
const fetchedVars = uniq(controller.match(VAR) || []); // base vars[] + extVars[] + trigger

// Variables a renderer reads DEFENSIVELY ("if present" — the code renders fine
// without them). Exempt from coverage; they are not required fetches.
const OPTIONAL = new Set([
  'DP02_0070E', // hna-renderers.js ~4258: civilian pop, read "if present" with a graceful fallback
]);

// (1) Coverage — a renderer must never read a REQUIRED variable fetched nowhere.
const orphans = readVars.filter((v) => !fetchedVars.includes(v) && !OPTIONAL.has(v));
if (orphans.length) fail('renderer reads ACS vars fetched NOWHERE in the controller: ' + orphans.join(', '));
else pass(readVars.length + ' renderer ACS variables are all fetched by the controller');

// (2) The extended-fetch trigger must actually fire for cached places.
const trigMatch = controller.match(/const\s+missingExtended[\s\S]*?\);/);
if (!trigMatch) {
  fail('could not locate the `missingExtended` trigger block in hna-controller.js');
} else {
  const trigVars = uniq(trigMatch[0].match(VAR) || []);
  const cache = JSON.parse(read('data/hna/summary/0820000.json')).acsProfile || {};
  const cacheKeys = Object.keys(cache);
  // A trigger var only makes the fetch fire for a cached place if it is ABSENT from the cache.
  const firing = trigVars.filter((v) => !cacheKeys.includes(v));
  if (!firing.length) {
    fail('missingExtended trigger only checks variables the summary cache already has (' +
         trigVars.join(', ') + ') — the extended fetch will NEVER fire for cached places, so ' +
         'extended-only panels (household composition / race / education) render empty. ' +
         'Add a panel variable that is absent from the cache to the trigger.');
  } else {
    pass('missingExtended trigger fires for cached places (checks ' + firing.length +
         ' var(s) absent from the cache: ' + firing.join(', ') + ')');
  }
}

if (failed) { console.error('\nHNA ACS var-coverage: ' + failed + ' failure(s)'); process.exit(1); }
console.log('\nHNA ACS var-coverage: all checks passed');
