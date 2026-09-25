'use strict';

/**
 * No page may present data/policy/chfa-awards-historical.json as CHFA's record.
 *
 * That file's meta.note says it was "synthesized from publicly available CHFA
 * award announcements". Until #1880 the site published it, or constants copied
 * from it, as fact: an awards-per-year chart (1–5 a year against the live
 * feed's 30–60), QAP scores and award rates, a "% estimated award likelihood"
 * and percentile on the Deal Calculator and Market Analysis, a winners-vs-losers
 * "scoring runway" on the Opportunity Finder, and five unnamed "failed
 * application attempts" with scores and reasons pinned to real counties on the
 * HNA pages.
 *
 * The derived figures were checked against CHFA's own 2025-26 QAP (full text in
 * data/audit/chfa-qap-watch.json): CHFA sets minimum scores of 130 / 115 / 95
 * points, not a 0–100 scale in six categories, so none of them could be kept.
 *
 * This guard scans every tracked page and client script and fails on:
 *   1. any reference to the synthesized file, outside a reasoned allowlist;
 *   2. the constants that carried it (82/74/65 thresholds, the winner/loser
 *      category averages) reappearing in client code;
 *   3. award-likelihood copy reappearing.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNTH = 'chfa-awards-historical';

// Each entry must say why the reference is not a presentation of the data.
const ALLOW = {
  'js/data-source-discovery.js':
    'file-registry checker: confirms the path is listed in data/manifest.json; never renders its contents',
};

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(html|js|mjs)$/.test(f))
  .filter((f) => !/^(test|tests|scripts|node_modules|docs|places)\//.test(f))
  .filter((f) => !/^js\/vendor\//.test(f));

// Non-vacuity: the scan covers the site, and the pages that used to carry the
// synthesized figures are in it.
assert(tracked.length > 200, `scan found only ${tracked.length} client files`);
[
  'historical-trends.html', 'js/historical-trends.js', 'deal-calculator.html',
  'market-analysis.html', 'js/market-analysis.js', 'js/lihtc-concept-card-renderer.js',
  'lihtc-opportunity-finder.html', 'js/lihtc-opportunity-finder.js',
  'housing-needs-assessment.html', 'hna-what-housing-exists.html',
].forEach((f) => assert(tracked.includes(f), `scan must include ${f}`));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// 1. No reference to the synthesized file.
const refs = tracked.filter((f) => read(f).includes(SYNTH) && !ALLOW[f]);
assert.deepStrictEqual(refs, [], `these files reference ${SYNTH}.json: ${refs.join(', ')}`);
Object.keys(ALLOW).forEach((f) => {
  assert(fs.existsSync(path.join(ROOT, f)), `allowlisted ${f} no longer exists — remove the entry`);
  assert(read(f).includes(SYNTH), `allowlisted ${f} no longer references the file — remove the entry`);
});

// 2. The constants that carried the sample into client code.
const CARRIERS = [
  [/avgWinner|avgLoser|AVG_WINNER_TOTAL|AVG_LOSER_TOTAL/, 'winner/loser category averages'],
  [/highLikelihood|moderateLikelihood|lowLikelihood/, 'the 82/74/65 likelihood thresholds'],
  [/geography:\s*16\.2|communityNeed:\s*20\.8|localSupport:\s*18\.5/, 'hardcoded "avg winner" category points'],
];
tracked.forEach((f) => {
  const src = read(f);
  CARRIERS.forEach(([re, what]) => assert(!re.test(src), `${f} reintroduces ${what}`));
});

// 3. Award-likelihood copy.
tracked.forEach((f) => {
  assert(!/award likelihood|awardLikelihood|percentile(Rank)? vs historical winners/i.test(read(f)),
    `${f} renders an award-likelihood figure; there is no verified source for one`);
});

console.log(`no-synthesized-chfa-awards: PASS (${tracked.length} client files scanned, ${Object.keys(ALLOW).length} reasoned exception)`);
