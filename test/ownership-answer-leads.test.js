#!/usr/bin/env node
/**
 * The Affordable Ownership Need panel must lead with its answer.
 *
 * The panel computed its conclusion — tenureMixRecommendation — and then
 * displayed it as the FOURTH of four cards, above 2,038 words across 22
 * headings. A planner asking "are ownership tools worth considering in my
 * town" had to read a consultant's report to reach the sentence answering it.
 *
 * Nothing about the computation changed. What changed is where the conclusion
 * sits and what is collapsed behind it: 2,038 rendered words became 336, and
 * 7,784px became 1,446px, with every figure still one click away.
 *
 * The risk this guards is not layout. It is that a restatement drifts from the
 * value it restates, or that an inconclusive result starts reading as a
 * finding. Both would be worse than the wall of text.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const R = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-renderers.js'), 'utf8');
const NEED = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-ownership-need.js'), 'utf8');
const PAGES = ['housing-needs-assessment.html', 'hna-what-to-do.html'];

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('ownership-answer-leads');

test('the answer has a mount above the section prose', () => {
  for (const page of PAGES) {
    const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const mount = src.indexOf('id="hnaOwnershipAnswer"');
    assert.ok(mount >= 0, `${page}: the answer mount is gone`);
    const intro = src.indexOf('This section helps identify where affordable homeownership');
    assert.ok(intro >= 0, `${page}: the intro paragraph moved; re-check the ordering`);
    assert.ok(mount < intro,
      `${page}: the answer renders BELOW the section's framing, which is where it started`);
    const detail = src.indexOf('id="hnaAffordableOwnershipNeed"');
    assert.ok(mount < detail, `${page}: the answer renders below the detail container`);
  }
});

test('the verdict is the recommendation, not a second opinion', () => {
  // Every plain-English phrase must be keyed off tenureMixRecommendation, and
  // the original term shown beside it, so the two cannot drift apart.
  assert.ok(/var recValue = result\.tenureMixRecommendation/.test(R),
    'the headline no longer reads from tenureMixRecommendation');
  assert.ok(/classified <strong[^>]*>' \+ escHtml\(recValue\)/.test(R),
    'the original recommendation term is no longer shown next to the plain-English '
    + 'restatement, so a drift between them would be invisible');
});

test('every recommendation the engine can produce has plain English', () => {
  // Scraped from the engine, not hardcoded here: a new recommendation added to
  // hna-ownership-need.js without a phrase would otherwise silently fall
  // through to "not enough local data" and hide a real finding.
  const produced = new Set();
  const re = /recommendation = '([^']+)'/g;
  let m;
  while ((m = re.exec(NEED)) !== null) produced.add(m[1]);
  for (const v of ['tenureMixRecommendation: \'', 'Insufficient data - verify locally']) {
    // also catch the no-data default declared as an object literal
  }
  const noData = /tenureMixRecommendation: '([^']+)'/.exec(NEED);
  if (noData) produced.add(noData[1]);
  assert.ok(produced.size >= 5, `only found ${produced.size} recommendation values; the scrape has drifted`);
  const missing = [...produced].filter((v) => !R.includes(`'${v}':`));
  assert.deepStrictEqual(missing, [],
    `these recommendations have no plain-English phrase, so they render as "not enough `
    + `local data" and a real finding disappears: ${missing.join(', ')}`);
});

test('an inconclusive result does not claim missing data', () => {
  // "Verify locally" is reached WITH data — Castle Rock hits it at High data
  // quality with all three driver counts populated. Reporting that as "not
  // enough local data" is a false statement about the data, which is the
  // defect class this repo keeps finding.
  assert.ok(/'Verify locally': 'No clear signal/.test(R),
    "'Verify locally' no longer has its own phrasing and will read as missing data");
  assert.ok(/'Insufficient data - verify locally': 'Not enough local data/.test(R),
    'the genuinely-no-data case lost its distinct phrasing');
});

test('the numbers under the answer are the ones that drove it', () => {
  for (const field of ['renterCostBurdened', 'ownerCostBurdened', 'moderateIncomeRenterHouseholds']) {
    assert.ok(new RegExp('result\\.' + field).test(R), `${field} is no longer shown under the answer`);
  }
  // Unavailable figures are dropped rather than printed as a blank or a zero.
  assert.ok(/d\.value !== 'Unavailable'/.test(R),
    'unavailable drivers are no longer filtered out, so an absent figure can render under the verdict');
});

test('the evidence is collapsed, not deleted', () => {
  for (const summary of [
    'How that was screened',
    'If you are taking this further',
    'Every indicator, with its source',
    'Full ownership strategy workup',
  ]) {
    const inR = R.includes(summary);
    const inPages = PAGES.some((p) => fs.readFileSync(path.join(ROOT, p), 'utf8').includes(summary));
    assert.ok(inR || inPages, `the "${summary}" section is gone entirely, not collapsed`);
  }
  // The detail itself must still be built.
  assert.ok(/cardHtml/.test(R) && /tableRows/.test(R), 'the cards or the indicator table were removed');
});

test('collapsing did not orphan the decision chain mount', () => {
  // OwnershipDecisionChain renders into #hnaOwnershipDecisionChain immediately
  // after innerHTML is set. Inside a closed <details> the node still exists,
  // so this works — but only while the id is actually emitted.
  assert.ok(/id="hnaOwnershipDecisionChain"/.test(R), 'the decision chain mount is gone');
  const mountAt = R.indexOf('id="hnaOwnershipDecisionChain"');
  const renderAt = R.indexOf('window.OwnershipDecisionChain.render');
  assert.ok(mountAt >= 0 && renderAt > mountAt,
    'the decision chain renders before its mount exists');
});

console.log(failures === 0
  ? '  ownership-answer-leads: PASS'
  : `  ownership-answer-leads: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
