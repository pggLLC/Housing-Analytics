#!/usr/bin/env node
/*
 * Guard: scripts/augment-local-resources.js must never delete or overwrite
 * data already committed in data/hna/local-resources.json.
 *
 * Regression for the 2026-07-14 incident where running the script on a clean
 * main destructively rewrote local-resources.json (31 insertions, 458
 * deletions), wiping post-hoc enrichment: council_agenda_url, schoolDistrict,
 * hospital, majorEmployers, F35-healed search URLs, advocacy additions.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { PLACE_ENTRIES, mergeMissing, TARGET } = require('../scripts/augment-local-resources.js');

// --- 1. Fixture: pre-existing enrichment survives a merge -------------------

const existing = {
  'place:0899999': {
    // post-hoc enrichment not known to PLACE_ENTRIES
    council_agenda_url: 'http://127.0.0.1/agendas',
    schoolDistrict: { name: 'Example RE-1', url: 'http://127.0.0.1/example-re1' },
    hospital: 'Example Medical Center',
    majorEmployers: ['Example Corp', 'Example University'],
    // F35-healed URL (script has the old deep link)
    housingLead: { name: 'Example Housing Dept', url: 'https://www.google.com/search?q=%22Example+Housing+Dept%22+Colorado' },
    // hand-extended array (script has a shorter version)
    advocacy: [
      { name: 'Original Org', url: 'http://127.0.0.1/original' },
      { name: 'Hand-Added Org', url: 'http://127.0.0.1/hand-added' }
    ],
    prop123: { status: 'Committed', hand_added_flag: true }
  }
};

const incoming = {
  'place:0899999': {
    housingLead: { name: 'Example Housing Dept', url: 'http://127.0.0.1/housing-old-deep-link' },
    advocacy: [
      { name: 'Original Org', url: 'http://127.0.0.1/original' }
    ],
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingAuthority: [
      { name: 'Example Housing Authority', url: 'http://127.0.0.1/example-ha' }
    ]
  }
};

const before = JSON.parse(JSON.stringify(existing));
mergeMissing(existing['place:0899999'], incoming['place:0899999']);
const entry = existing['place:0899999'];

// enrichment keys survive
for (const key of ['council_agenda_url', 'schoolDistrict', 'hospital', 'majorEmployers']) {
  assert.deepStrictEqual(entry[key], before['place:0899999'][key],
    `enrichment field "${key}" must survive the merge untouched`);
}

// healed URL is not reverted to the script's old deep link
assert.strictEqual(entry.housingLead.url, before['place:0899999'].housingLead.url,
  'F35-healed housingLead URL must not be reverted');

// hand-extended array keeps its extra element (arrays are never replaced)
assert.strictEqual(entry.advocacy.length, 2, 'hand-added advocacy entry must survive');
assert.strictEqual(entry.advocacy[1].name, 'Hand-Added Org');

// nested object: existing subkeys survive, missing subkeys are filled in
assert.strictEqual(entry.prop123.hand_added_flag, true, 'hand-added prop123 subkey must survive');
assert.strictEqual(entry.prop123.link, 'https://cdola.colorado.gov/commitment-filings',
  'missing prop123.link should be filled in from the script');

// genuinely missing field is added
assert.deepStrictEqual(entry.housingAuthority, incoming['place:0899999'].housingAuthority,
  'missing housingAuthority should be added');

// --- 2. Real data: simulating a full run removes/changes nothing ------------

// Records every path: plain objects by existence (so purely-additive changes
// inside them don't flag the parent), leaves (scalars + arrays) by value.
function collectPaths(obj, prefix, out) {
  for (const [key, value] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.set(p, '__object__');
      collectPaths(value, p, out);
    } else {
      out.set(p, JSON.stringify(value));
    }
  }
  return out;
}

const real = JSON.parse(fs.readFileSync(TARGET, 'utf-8'));
const originalPaths = collectPaths(real, '', new Map());

// replicate main()'s merge on the in-memory copy (never write to disk)
for (const [key, value] of Object.entries(PLACE_ENTRIES)) {
  if (!real[key]) {
    real[key] = value;
  } else {
    mergeMissing(real[key], value);
  }
}

const mergedPaths = collectPaths(real, '', new Map());
const damaged = [];
for (const [p, v] of originalPaths) {
  if (!mergedPaths.has(p)) damaged.push(`REMOVED: ${p}`);
  else if (mergedPaths.get(p) !== v) damaged.push(`CHANGED: ${p}`);
}
assert.strictEqual(damaged.length, 0,
  `augment run must be purely additive against committed local-resources.json; damage:\n  ${damaged.slice(0, 20).join('\n  ')}`);

// --- 3. GEOID sanity: every PLACE_ENTRIES key is a CO place FIPS ------------
// Regression for Aspen keyed as 0803455 (Arvada) and Vail as 0680930 (a
// California FIPS).

for (const key of Object.keys(PLACE_ENTRIES)) {
  assert.match(key, /^place:08\d{5}$/,
    `PLACE_ENTRIES key "${key}" is not a Colorado place GEOID (place:08#####)`);
}
assert.ok(!('place:0803455' in PLACE_ENTRIES), 'Aspen data must not be keyed under Arvada GEOID 0803455');
assert.ok(!('place:0680930' in PLACE_ENTRIES), 'Vail data must not be keyed under CA FIPS 0680930');

// --- 4. End-to-end: run the ACTUAL script against a fixture copy ------------
// The in-memory simulation above exercises mergeMissing() but not main()'s
// wiring — a regression where main() reverts to `existing[key] = value`
// would slip past it (caught in QA of #1209). Run the script as a child
// process via AUGMENT_TARGET and assert enrichment survives on disk.

const scriptPath = path.resolve(__dirname, '..', 'scripts/augment-local-resources.js');
const tmpTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'augment-e2e-')), 'local-resources.json');
try {
  fs.copyFileSync(TARGET, tmpTarget);
  const before = collectPaths(JSON.parse(fs.readFileSync(tmpTarget, 'utf-8')), '', new Map());

  execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, AUGMENT_TARGET: tmpTarget },
    stdio: 'pipe',
  });

  const after = collectPaths(JSON.parse(fs.readFileSync(tmpTarget, 'utf-8')), '', new Map());
  const e2eDamage = [];
  for (const [p, v] of before) {
    if (!after.has(p)) e2eDamage.push(`REMOVED: ${p}`);
    else if (after.get(p) !== v) e2eDamage.push(`CHANGED: ${p}`);
  }
  assert.strictEqual(e2eDamage.length, 0,
    `real script run must be purely additive; damage:\n  ${e2eDamage.slice(0, 20).join('\n  ')}`);

  // Second run must be a no-op (idempotent, no write).
  const mtimeAfterRun1 = fs.statSync(tmpTarget).mtimeMs;
  const out2 = execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, AUGMENT_TARGET: tmpTarget },
    stdio: 'pipe',
  }).toString();
  assert.ok(out2.includes('No changes needed'),
    `second run must report "No changes needed", got:\n${out2}`);
  assert.strictEqual(fs.statSync(tmpTarget).mtimeMs, mtimeAfterRun1,
    'second run must not rewrite the file');
} finally {
  fs.rmSync(path.dirname(tmpTarget), { recursive: true, force: true });
}

console.log('augment-local-resources non-destructive: PASS');
console.log(`  (${originalPaths.size} committed paths verified intact after simulated run)`);
console.log('  (end-to-end child-process run verified additive + idempotent)');
