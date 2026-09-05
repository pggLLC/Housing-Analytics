'use strict';

/**
 * Regression: the ACS "not available" sentinel must never become a metric.
 *
 * ACS ships suppressed cells as -666666666. In data/hna/summary/*.json it
 * arrives as the STRING "-666666666.0", which parses to a finite number.
 *
 * Ten place summaries carry it in DP04_0078PE / DP04_0079PE (occupants per
 * room). Before this guard, housing-type-need summed them into an overcrowding
 * rate of -1,333,333,332%, which ramp() then clamped to 0 — so those ten places
 * scored as having ZERO overcrowding instead of unknown. The absence was not
 * merely displayed wrong, it was silently favourable.
 *
 * Same class as #1531 and issue #1480.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SENTINEL_STR = '-666666666.0';

function loadScript(rel, html) {
  const dom = new JSDOM(html || '<div></div>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/housing-needs-assessment.html',
  });
  dom.window.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return dom.window;
}

// ── The shared guard must catch the form the data actually uses ─────────────
const dqWin = loadScript('js/utils/data-quality.js');
const DQ = dqWin.DataQuality || dqWin.dataQuality;
assert(DQ && typeof DQ.isMissingMetric === 'function', 'data-quality must expose isMissingMetric');

assert.strictEqual(DQ.isMissingMetric(-666666666), true, 'numeric sentinel is missing');
assert.strictEqual(
  DQ.isMissingMetric(SENTINEL_STR), true,
  'STRING sentinel is missing — this is the form every shipped data file uses'
);
assert.strictEqual(DQ.isMissingMetric('-666666666'), true, 'string sentinel without decimal is missing');
assert.strictEqual(DQ.isMissingMetric(null), true, 'null is missing');
assert.strictEqual(DQ.isMissingMetric(''), true, 'empty string is missing');
assert.strictEqual(DQ.isMissingMetric(0), false, 'a genuine 0 is a value, not missing');
assert.strictEqual(DQ.isMissingMetric(12.5), false, 'a real number is not missing');

// ── No shipped summary may yield a negative overcrowding rate ───────────────
const htnSrc = fs.readFileSync(path.join(ROOT, 'js/components/housing-type-need.js'), 'utf8');
assert(
  /ACS_SENTINEL/.test(htnSrc),
  'housing-type-need must guard the ACS sentinel'
);

// Behavioural: reproduce the num() + overcrowding computation over real files.
const win = loadScript('js/components/housing-type-need.js');
const HTN = win.HousingTypeNeed || win.housingTypeNeed;
assert(HTN, 'housing-type-need must expose its API');
assert(
  typeof HTN._extractAcs === 'function',
  '_extractAcs must be exported — the behavioural assertions below are vacuous without it'
);

const summaryDir = path.join(ROOT, 'data/hna/summary');
const files = fs.readdirSync(summaryDir).filter((f) => f.endsWith('.json'));

function deepFind(obj, key) {
  let found;
  (function walk(o) {
    if (found !== undefined || !o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (k === key) { found = o[k]; return; }
      walk(o[k]);
    }
  })(obj);
  return found;
}

let sentinelFiles = 0;
const offenders = [];

for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(summaryDir, f), 'utf8'));
  const profile = doc.acsProfile;
  if (!profile) continue;
  const a = profile.DP04_0078PE;
  const b = profile.DP04_0079PE;
  const hasSentinel = [a, b].some((v) => Number(v) === -666666666);
  if (!hasSentinel) continue;
  sentinelFiles++;

  const derived = HTN._extractAcs(profile);
  if (derived && derived.overcrowdPct !== null && derived.overcrowdPct < 0) {
    offenders.push(f.replace('.json', '') + ' -> ' + derived.overcrowdPct);
  }
}

assert(sentinelFiles > 0, 'fixture sanity: some summaries should carry the ACS sentinel');
assert.deepStrictEqual(
  offenders, [],
  `a suppressed ACS cell must yield null overcrowding, never a negative rate: ${offenders.slice(0, 3).join('; ')}`
);

console.log(
  `acs-sentinel-absence: PASS (${sentinelFiles} summaries carry the sentinel; none produced a negative rate)`
);
