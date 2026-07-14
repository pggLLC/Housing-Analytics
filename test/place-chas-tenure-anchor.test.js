const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const placeChas = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/place-chas.json'), 'utf8'));

function readSummary(geoid) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/summary', `${geoid}.json`), 'utf8')).acsProfile || {};
}

function renterShare(entry) {
  const summary = entry.summary || {};
  const renter = Number(summary.total_renter_hh) || 0;
  const owner = Number(summary.total_owner_hh) || 0;
  return renter + owner ? renter / (renter + owner) : null;
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label} must be numeric`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`
  );
}

function assertApplied(geoid) {
  const entry = placeChas.places[geoid];
  assert.ok(entry, `${geoid} must exist in place-chas`);
  assert.equal(entry.tenure_anchor && entry.tenure_anchor.applied, true, `${geoid} must have tenure_anchor.applied`);
  return entry;
}

const fixtures = [
  ['0857400', 'Parachute', 0.493, 0.01],
  ['0871755', 'Snowmass Village', 0.392, 0.02],
  ['0864255', 'Rifle', 0.336, 0.02],
  ['0804935', 'Basalt', 0.407, 0.02],
];

let appliedCount = 0;
for (const [geoid, entry] of Object.entries(placeChas.places || {})) {
  const anchor = entry.tenure_anchor || {};
  if (!anchor.applied) continue;
  appliedCount += 1;
  const profile = readSummary(geoid);
  const expectedPct = Number(profile.DP04_0047PE) / 100;
  assert.ok(Number.isFinite(expectedPct), `${geoid} applied anchor must have cached DP04_0047PE`);
  assertNear(renterShare(entry), expectedPct, 0.01, `${geoid} renter share matches ACS DP04_0047PE`);
}
assert.ok(appliedCount > 400, `expected a non-vacuous set of tenure-anchored places, got ${appliedCount}`);

for (const [geoid, label, expected, tolerance] of fixtures) {
  const entry = assertApplied(geoid);
  assertNear(renterShare(entry), expected, tolerance, `${label} renter share`);
}

const parachute = assertApplied('0857400');
const preservedRates = {
  lte30: [0.7933, 0.66],
  '31to50': [0.904, 0.232],
  '51to80': [0.1892, 0],
  '81to100': [0, 0],
  '100plus': [0, 0],
};
for (const [tier, [cb30, cb50]] of Object.entries(preservedRates)) {
  const band = parachute.renter_hh_by_ami[tier];
  assertNear(band.pct_cost_burdened_30, cb30, 0.0001, `Parachute ${tier} renter cb30 rate preserved`);
  assertNear(band.pct_cost_burdened_50, cb50, 0.0001, `Parachute ${tier} renter cb50 rate preserved`);
}

const controls = [
  ['0803620', 'Aspen', 0.41867],
  ['0830780', 'Glenwood Springs', 0.421267],
];
for (const [geoid, label, beforeShare] of controls) {
  const entry = assertApplied(geoid);
  assertNear(renterShare(entry), beforeShare, 0.035, `${label} renter share did not materially move`);
}

const basaltLookup = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/hna/derived/place_county_lookup.json'), 'utf8')
);
assert.equal(basaltLookup.places['0804935'], '08037', 'Basalt place-county lookup stays anchored to Eagle County');

console.log(`place-chas-tenure-anchor: validated ${appliedCount} tenure-anchored places and ${fixtures.length} fixtures`);
