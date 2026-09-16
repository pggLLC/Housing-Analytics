#!/usr/bin/env node
/**
 * The ranking index has three producers. All three must have run.
 *
 * data/hna/ranking-index.json is written by build_ranking_index.py and then
 * augmented, in place, by augment_ranking_index_recency.mjs (F179/F240) and
 * augment_lihtc_by_geometry.mjs (F191). Nothing recorded that, so on
 * 2026-06-14 a routine rebuild ran the builder alone and deleted 32 metrics
 * from all 546 jurisdictions — out of the index and out of every digest built
 * from it. It stood for three months. Nothing failed, because nothing looked.
 *
 * The consumers were all correctly null-guarded, which is why it stayed quiet:
 * the HNA badge and the Opportunity Finder both degraded instead of crashing.
 * Absence discipline stops a wrong NUMBER; it does not notice a missing
 * FEATURE. That is what this file is for.
 *
 * Counts are asserted as floors well under today's values, not as exact
 * figures: the point is to catch a chain that did not run (which takes every
 * count to zero), not to freeze Colorado's LIHTC history in a test.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'data', 'hna', 'ranking-index.json');
const CHECKER = path.join(ROOT, 'scripts', 'check-ranking-index-fresh.py');
const RENDERER = path.join(ROOT, 'js', 'hna', 'hna-renderers.js');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('ranking-index-augmentation-present');

const doc = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const rows = Array.isArray(doc.rankings) ? doc.rankings : [];
const countNonNull = (field) => rows.filter((r) => r && r.metrics && r.metrics[field] != null).length;

const REBUILD = 'Re-run the full chain: build_ranking_index.py, then '
  + 'augment_ranking_index_recency.mjs, then augment_lihtc_by_geometry.mjs.';

test('the index has entries at all', () => {
  assert.ok(rows.length >= 500, `only ${rows.length} ranking entries`);
});

test('both augmenters stamped the file they wrote', () => {
  const meta = doc.metadata || {};
  assert.ok(meta.recencyAugmentedBy,
    `metadata.recencyAugmentedBy is missing — augment_ranking_index_recency.mjs did not run. ${REBUILD}`);
  assert.ok(meta.lihtcGeometryAugmentedBy,
    `metadata.lihtcGeometryAugmentedBy is missing — augment_lihtc_by_geometry.mjs did not run. ${REBUILD}`);
});

test('every jurisdiction carries a recency BASIS', () => {
  // The basis is what separates "measured, never funded" from "not measured".
  // The badge reads it to decide whether it may make a claim, so a gap here is
  // not a missing number — it is the badge losing the ability to tell those
  // two apart, which is the #1698 defect exactly.
  const n = countNonNull('recency_basis');
  assert.ok(n >= 500, `only ${n} of ${rows.length} entries carry recency_basis. ${REBUILD}`);
});

test('a real LIHTC award history is present, not just a field full of nulls', () => {
  // 108 at the time of writing. A builder-only rebuild takes this to 0, which
  // is the state the site shipped in for three months.
  const n = countNonNull('latest_lihtc_year');
  assert.ok(n >= 50,
    `only ${n} jurisdictions have a measured latest_lihtc_year — the recency `
    + `augmentation is missing or empty. ${REBUILD}`);
});

test('the F240 regional recency the Opportunity Finder reads is present', () => {
  // js/lihtc-opportunity-finder.js reads these off state.rankByGeoid with a
  // `!= null ? … : fallback`, so their absence is silent: every comparison
  // just quietly stops being regional.
  for (const f of ['regional_recency_score_9pct', 'regional_recency_score_4pct',
    'regional_recency_score_state_credit', 'regional_recency_score_competitive']) {
    const n = countNonNull(f);
    assert.ok(n >= 400, `only ${n} of ${rows.length} entries carry ${f}. ${REBUILD}`);
  }
});

test('the F191 point-in-polygon boundary count is present', () => {
  const n = countNonNull('lihtc_in_boundary');
  assert.ok(n >= 400, `only ${n} of ${rows.length} entries carry lihtc_in_boundary. ${REBUILD}`);
});

test('the digests built from the index carry the augmented metrics too', () => {
  // The digests are a second copy. In June they lost the same 32 metrics, and
  // checking only the index would have declared that repaired while every
  // digest was still short.
  const dir = path.join(ROOT, 'data', 'hna', 'jurisdiction-metrics-digest');
  if (!fs.existsSync(dir)) throw new Error('the digest directory is absent');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 500, `only ${files.length} digest files`);
  const sample = ['08001.json', '08031.json', '08069.json'].filter((f) => files.includes(f));
  assert.ok(sample.length > 0, 'none of the sampled digests exist');
  for (const f of sample) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const metrics = d.metrics || {};
    for (const key of ['recency_basis', 'recency_score', 'lihtc_in_boundary']) {
      assert.ok(Object.prototype.hasOwnProperty.call(metrics, key),
        `${f} has no ${key} — rebuild the digests after the index: `
        + 'npm run build:jurisdiction-metrics-digest');
    }
  }
});

/* ── the checker must agree that there are three producers ───────────────── */

test('check-ranking-index-fresh.py rebuilds with all three producers', () => {
  // This one is load-bearing in both directions. The checker compares a fresh
  // build against the committed file, so a checker that runs a SHORTER chain
  // does not merely miss the augmentation — it fails the moment anyone
  // restores it, and that is what kept the deletion in place from June to
  // September.
  const src = fs.readFileSync(CHECKER, 'utf8');
  for (const producer of [
    'build_ranking_index.py',
    'augment_ranking_index_recency.mjs',
    'augment_lihtc_by_geometry.mjs',
  ]) {
    const inChain = new RegExp(`CHAIN\\s*=\\s*\\[[\\s\\S]*?${producer.replace('.', '\\.')}[\\s\\S]*?\\]`);
    assert.ok(inChain.test(src),
      `${producer} is not in the checker's CHAIN — a rebuild that skips it would `
      + 'be declared fresh, and restoring it would be declared stale');
  }
});

/* ── the badge must not turn a missing record into a finding ─────────────── */

const renderer = fs.readFileSync(RENDERER, 'utf8');

test('the badge distinguishes "measured, never funded" from "not measured"', () => {
  // Source-pinned rather than executed: the badge is a closure inside the HNA
  // renderer module and needs the DOM, the map and a live fetch to reach. The
  // assertions below name the exact edit that would reintroduce the defect.
  assert.ok(/const measured\s*=\s*!!\(rec && rec\.recency_basis\)/.test(renderer),
    'the badge no longer establishes whether a recency record exists at all');
  assert.ok(/const neverFunded\s*=\s*measured && rec\.recency_basis === 'never_funded'/.test(renderer),
    "the badge no longer treats 'never_funded' as its own state");
});

test('the no-awards claim is made ONLY where it was measured', () => {
  // Match the RENDERED markup, not the prose: the comment above the badge
  // quotes the old message on purpose, to record what the bug looked like.
  const CLAIM = '<strong style="color:var(--text)">No CHFA LIHTC awards on record</strong>';
  const occurrences = renderer.split(CLAIM).length - 1;
  assert.strictEqual(occurrences, 1,
    `"${CLAIM}" appears ${occurrences} times; it is a finding and belongs in exactly one branch`);

  // Positional rather than a fixed look-behind window: the branch is long
  // enough that a character count would be measuring formatting.
  const at = renderer.indexOf(CLAIM);
  const neverBranch = renderer.indexOf('if (neverFunded) {');
  const afterBranch = renderer.indexOf('if (rec.latest_lihtc_year == null) {');
  assert.ok(neverBranch >= 0, 'the neverFunded branch is gone');
  assert.ok(afterBranch > neverBranch, 'the branch that follows neverFunded is gone');
  assert.ok(at > neverBranch && at < afterBranch,
    'the no-awards claim is no longer inside the neverFunded branch — it is '
    + 'being asserted from something other than a measured never_funded basis');

  // And the not-measured branch must not make it.
  const notMeasured = renderer.indexOf('if (!measured) {');
  assert.ok(notMeasured >= 0, 'the not-measured branch is gone');
  const branch = renderer.slice(notMeasured, notMeasured + 1200);
  assert.ok(!branch.includes('No CHFA LIHTC awards on record'),
    'the not-measured branch asserts "no awards on record" from an absent record');
  assert.ok(!/maximum opportunity/.test(branch),
    'the not-measured branch still awards a maximum opportunity score for data '
    + 'that was never measured');
});

test('a never-funded basis beside mapped projects is reported as a disagreement', () => {
  // Name matching misses awards filed under a neighbouring city or an
  // unincorporated address — F191 exists because of it. Printing "no awards"
  // over the top of visible project markers is the version of this bug that
  // survives having the data.
  assert.ok(/No CHFA award matched to this jurisdiction by name/.test(renderer),
    'the name-match disagreement case is gone; a jurisdiction with projects '
    + 'inside its boundary can be told it has no awards');
});

console.log(failures === 0
  ? '  ranking-index-augmentation-present: PASS'
  : `  ranking-index-augmentation-present: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
