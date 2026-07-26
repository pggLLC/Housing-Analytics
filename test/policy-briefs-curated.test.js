'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const curatedPath = path.join(root, 'data', 'policy_briefs_curated.json');
const pagePath = path.join(root, 'policy-briefs.html');

assert.ok(fs.existsSync(curatedPath), 'curated policy brief feed must exist');

const payload = JSON.parse(fs.readFileSync(curatedPath, 'utf8'));
assert.ok(Array.isArray(payload.briefs), 'curated feed must expose a briefs array');

const hpop = payload.briefs.find((brief) => brief.id === 'minneapolis-fed-hpop-2026');
assert.ok(hpop, 'HPOP research brief must be present');
assert.strictEqual(hpop.is_curated, true, 'HPOP brief must be marked curated');
assert.strictEqual(hpop.source_reviewed, true, 'HPOP brief must be marked source-reviewed');
assert.match(hpop.summary, /53% of U\.S\. adults/);
// Corrected per source review (2026-07): the unverifiable "13.9%" figure was
// replaced with the verified ~12-point HPOP↔owner-occupancy gap, and the
// under-35 sentence now flags person-based vs household-based measures.
assert.match(hpop.summary, /about 12 points below/);
assert.match(hpop.summary, /adults under 35, HPOP was about 22%/);
assert.doesNotMatch(hpop.summary, /13\.9% of adults/, 'unverifiable 13.9% figure removed');
// Colorado detail (verified against Minneapolis Fed hpop_current.xlsx, 2024).
assert.match(hpop.summary, /Colorado, 2024 HPOP was 57\.2%/);
assert.match(hpop.summary, /Pueblo \(41\.5%\)/);
assert.match(hpop.summary, /not published for counties or places/);
assert.ok(
  hpop.articles.some((article) =>
    article.link === 'https://www.minneapolisfed.org/article/2026/new-homeownership-measure-puts-people-first'
  ),
  'HPOP brief must link the Minneapolis Fed primary article'
);
assert.ok(
  hpop.articles.some((article) =>
    article.link === 'https://www.minneapolisfed.org/community-development-and-engagement/data-and-resources/homeowners-to-population-data'
  ),
  'HPOP brief must link the Minneapolis Fed data and methodology page'
);

const claims = (hpop.title + ' ' + hpop.summary + ' ' + hpop.implications).toLowerCase();
[
  'true homeownership rate',
  'nearly 1 in 7',
  'guarantees a massive',
  'holding any ownership stake or title'
].forEach((unsupported) => {
  assert.ok(!claims.includes(unsupported), 'unsupported framing must not appear: ' + unsupported);
});

const page = fs.readFileSync(pagePath, 'utf8');
assert.match(page, /CURATED_BRIEFS_URL/);
assert.match(page, /data\/policy_briefs_curated\.json/);
assert.match(page, /brief\.is_curated/);
assert.match(page, /Source-reviewed/);
assert.match(page, /Promise\.all\(\[/);

console.log('policy briefs curated feed regression tests passed');
