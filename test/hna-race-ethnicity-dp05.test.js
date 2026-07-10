#!/usr/bin/env node
'use strict';

/**
 * Regression guard for the 2024 ACS DP05 race/ethnicity code shift.
 *
 * Independent reference for Garfield County (08045): Census Reporter B03002,
 * ACS 2024 5-year, reports ~32.6% Hispanic/Latino and ~61.5% Not Hispanic,
 * White alone. The old stale DP05 mapping rendered ~0.5% Hispanic and ~100%
 * Not Hispanic White because the variables no longer meant what the renderer
 * thought they meant.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const SOURCE_FILES = [
  'scripts/hna/build_hna_data.py',
  'js/hna/hna-controller.js',
  'js/hna/hna-renderers.js',
  'js/hna/hna-export.js',
];

const FETCHED_CODES = [
  'DP05_0033E',
  'DP05_0035E',
  'DP05_0037E',
  'DP05_0045E',
  'DP05_0053E',
  'DP05_0061E',
  'DP05_0069E',
  'DP05_0074E',
  'DP05_0090E',
  'DP05_0096E',
];

const REQUIRED_BY_FILE = {
  'scripts/hna/build_hna_data.py': FETCHED_CODES,
  'js/hna/hna-controller.js': FETCHED_CODES,
  'js/hna/hna-renderers.js': FETCHED_CODES,
  'js/hna/hna-export.js': [
    'DP05_0033E',
    'DP05_0035E',
    'DP05_0045E',
    'DP05_0053E',
    'DP05_0061E',
    'DP05_0090E',
    'DP05_0096E',
  ],
};

const STALE_CODES = [
  'DP05_0038E',
  'DP05_0039E',
  'DP05_0047E',
  'DP05_0055E',
  'DP05_0060E',
  'DP05_0076E',
  'DP05_0082E',
];

function pct(count, total) {
  assert(Number.isFinite(count), 'count is finite');
  assert(Number.isFinite(total) && total > 0, 'total population is positive');
  return count / total * 100;
}

function acsProfile(geoid) {
  return json(`data/hna/summary/${geoid}.json`).acsProfile || {};
}

function assertApprox(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}% ±${tolerance}, got ${actual.toFixed(1)}%`,
  );
}

function assertRaceCache(geoid, label, expectations) {
  const p = acsProfile(geoid);
  for (const code of FETCHED_CODES) {
    assert(code in p, `${label} cache includes ${code}`);
  }
  const total = Number(p.DP05_0033E);
  const raceTotal = [
    p.DP05_0037E,
    p.DP05_0045E,
    p.DP05_0053E,
    p.DP05_0061E,
    p.DP05_0069E,
    p.DP05_0074E,
    p.DP05_0035E,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
  const raceShare = pct(raceTotal, total);
  assertApprox(raceShare, 100, 0.8, `${label} race-alone plus two-or-more share`);

  const hispanic = pct(Number(p.DP05_0090E), total);
  const notHispWhite = pct(Number(p.DP05_0096E), total);
  assertApprox(hispanic, expectations.hispanic, expectations.tolerance, `${label} Hispanic/Latino`);
  assertApprox(notHispWhite, expectations.notHispWhite, expectations.tolerance, `${label} Not Hispanic White alone`);
}

for (const rel of SOURCE_FILES) {
  const src = read(rel);
  for (const code of REQUIRED_BY_FILE[rel]) {
    assert(src.includes(code), `${rel} references corrected ${code}`);
  }
  for (const code of STALE_CODES) {
    assert(!src.includes(code), `${rel} no longer references stale ${code}`);
  }
}

assertRaceCache('08045', 'Garfield County', {
  hispanic: 32.6,
  notHispWhite: 61.5,
  tolerance: 0.8,
});

assertRaceCache('0803620', 'Aspen city', {
  hispanic: 13.4,
  notHispWhite: 79.0,
  tolerance: 1.5,
});

console.log('HNA race/ethnicity DP05 regression checks passed');
