'use strict';

/**
 * Regression: the local-resources discovery script must not probe CDPs.
 *
 * A Census-Designated Place is unincorporated — it has no municipal government,
 * so no official city website can exist. Probing URL patterns for one can only
 * surface an unrelated organisation that happens to own the domain.
 *
 * The script already intended to skip them, but identified them with
 * `/\bCDP\b/.test(place_name)`. The source it reads,
 * `data/co_ami_gap_by_place.json`, carries bare names ("Clifton", "Ken Caryl"),
 * so that test matched none of them.
 *
 * On the 2026-08-31 run (issue #1495) 7 of 20 candidates were CDPs, which is
 * how these were surfaced as candidate city websites:
 *
 *   Ken Caryl  -> kencaryl.org   "Ken Caryl North Ranch"        (an HOA)
 *   Meridian   -> meridian.org   "Meridian International Center"
 *   Clifton    -> cityofclifton.com "City of Clifton, TN"        (wrong state)
 *
 * Identify CDPs by GEOID from data/hna/geo-config.json instead.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const geoConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/hna/geo-config.json'), 'utf8')
);
const ami = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/co_ami_gap_by_place.json'), 'utf8')
);

// ── The authoritative CDP list must exist and be non-trivial ────────────────
assert(Array.isArray(geoConfig.cdps), 'geo-config.json must expose a `cdps` array');
assert(
  geoConfig.cdps.length > 100,
  `geo-config.cdps should list every CO CDP, got ${geoConfig.cdps.length}`
);

const cdpIds = new Set(geoConfig.cdps.map((c) => c.geoid).filter(Boolean));

// ── The old name-based heuristic must be shown to be inadequate ─────────────
// If this ever starts passing, the source began carrying "(CDP)" suffixes and
// the name check would be sufficient — but the GEOID check is still correct.
const namedCdpsInSource = Object.values(ami.places || {}).filter((p) =>
  /\bCDP\b/.test(p.place_name || '')
).length;
assert.strictEqual(
  namedCdpsInSource, 0,
  'co_ami_gap_by_place.json carries bare names; a /\\bCDP\\b/ name test cannot identify CDPs'
);

// ── Every CDP in the source must be identifiable by GEOID ──────────────────
const sourceCdps = Object.values(ami.places || {}).filter((p) => cdpIds.has(p.fips));
assert(
  sourceCdps.length > 0,
  'fixture sanity: the AMI source should contain CDPs for this guard to matter'
);

// ── The specific candidates from #1495 must all be caught ──────────────────
const knownCdpCandidates = {
  '0815165': 'Clifton',
  '0850012': 'Meridian',
  '0840377': 'Ken Caryl',
  '0833502': 'Gunbarrel',
  '0823300': 'Edwards',
  '0806172': 'Berkley',
  '0821330': 'Dove Valley',
};
const missed = Object.entries(knownCdpCandidates)
  .filter(([geoid]) => !cdpIds.has(geoid))
  .map(([geoid, name]) => `${name} (${geoid})`);
assert.deepStrictEqual(
  missed, [],
  `these CDPs from issue #1495 must be identifiable by GEOID: ${missed.join(', ')}`
);

// ── BEHAVIOURAL: the exported helper must actually identify them ───────────
// A source grep alone would pass on dead code; run the real function.
(async () => {
  const mod = await import('../scripts/discover-local-resources.mjs');
  assert(
    typeof mod.cdpGeoids === 'function',
    'cdpGeoids must be exported so this guard can exercise it'
  );

  const ids = mod.cdpGeoids(geoConfig);
  assert.strictEqual(
    ids.size, cdpIds.size,
    `cdpGeoids must return every CDP; got ${ids.size} of ${cdpIds.size}`
  );

  const leaked = Object.keys(knownCdpCandidates).filter((g) => !ids.has(g));
  assert.deepStrictEqual(
    leaked, [],
    `cdpGeoids missed these #1495 candidates: ${leaked.join(', ')}`
  );

  // An empty/absent geo-config must yield an empty set, not throw — the caller
  // turns that into a loud exit rather than probing every CDP.
  assert.strictEqual(mod.cdpGeoids(null).size, 0, 'cdpGeoids(null) must be empty, not throw');
  assert.strictEqual(mod.cdpGeoids({}).size, 0, 'cdpGeoids({}) must be empty, not throw');

  // ── The script must filter by GEOID, not only by name ────────────────────
  const src = fs.readFileSync(path.join(ROOT, 'scripts/discover-local-resources.mjs'), 'utf8');
assert(
  /cdpGeoids/.test(src),
  'discover-local-resources.mjs must derive CDP GEOIDs from geo-config'
);
assert(
  /cdps\.has\(p\.fips\)/.test(src),
  'the isCdp determination must consult the GEOID set, not only the place name'
);
assert(
  /geoConfig\.cdps/.test(src) && /process\.exit\(1\)/.test(src),
  'the script must fail loudly if geo-config.cdps is unavailable rather than probing every CDP'
);

  console.log(
    `discover-local-resources-cdp: PASS (${cdpIds.size} CDPs identifiable by GEOID; ` +
    `${sourceCdps.length} present in the AMI source; name-based test would catch ${namedCdpsInSource})`
  );
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
