const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const rankingIndex = readJson('data/hna/ranking-index.json');
const rankingCount = rankingIndex.rankings.length;
assert.equal(rankingIndex.metadata.totalEntries, rankingCount, 'ranking-index metadata total matches rows');

// The geography universe is geo-config.json; ranking-index is derived from it.
// These two drifted apart because geo-config carried a duplicate GEOID
// (0812900 appeared as both "Central (city)" and "Central City (city)"), so
// the site advertised 547 geographies while only 546 could ever be ranked.
// Assert the invariant rather than blacklisting the stale number.
const geoConfig = readJson('data/hna/geo-config.json');
const geoConfigRows = [
  ...(geoConfig.counties || []),
  ...(geoConfig.places || []),
  ...(geoConfig.cdps || []),
];
const geoConfigGeoids = geoConfigRows.map((row) => String(row.geoid));
const duplicateGeoids = [...new Set(geoConfigGeoids.filter((id, i) => geoConfigGeoids.indexOf(id) !== i))];
assert.deepEqual(duplicateGeoids, [], `geo-config.json has duplicate GEOIDs: ${duplicateGeoids.join(', ')}`);
assert.equal(
  geoConfigGeoids.length,
  rankingCount,
  `geo-config geography count ${geoConfigGeoids.length} matches ranking-index count ${rankingCount}`
);

const indexHtml = read('index.html');
const jurisdictionTokens = [...indexHtml.matchAll(/\ball\s+(\d+)\s+Colorado\s+(?:jurisdictions|geographies)\b/g)]
  .map((m) => Number(m[1]));
// How often the homepage names the count, and in which sentence, is a copy
// choice (#1746 — it went from three routes to one on 2026-09-22). What must
// hold: every count it states is the canonical one, at least one link into
// the comparative page says how many geographies it opens (non-vacuity of
// the scan), and that page agrees — the loop below checks the target.
assert(jurisdictionTokens.length >= 1, 'homepage states the geography count at least once');
for (const count of jurisdictionTokens) {
  assert.equal(count, rankingCount, `homepage count ${count} matches ranking-index count ${rankingCount}`);
}
const comparativeLinks = [...indexHtml.matchAll(/<a\s+href="hna-comparative-analysis\.html"[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => m[1].replace(/\s+/g, ' ').trim());
assert(comparativeLinks.length >= 1, 'homepage links into the comparative page');
const countedLinks = comparativeLinks.filter((text) => /\ball\s+\d+\b/.test(text));
assert(countedLinks.length >= 1, 'a homepage link into the comparative page names how many geographies it opens');
for (const text of countedLinks) {
  assert.equal(Number(/\ball\s+(\d+)\b/.exec(text)[1]), rankingCount, `comparative link "${text}" names the canonical count`);
}
assert(!/all\s+645\s+Colorado\s+jurisdictions/.test(indexHtml), 'homepage no longer uses stale 645 jurisdiction count');

// Every other surface that advertises the geography universe must agree with
// the canonical count. (Previously only a stale-value blacklist guarded this,
// which let 547 survive everywhere except index.html and the Finder.)
for (const [relPath, pattern] of [
  ['js/navigation.js', /Rank (\d+) geographies by housing need/],
  ['select-jurisdiction.html', /Rank all (\d+) geographies by need/],
  ['hna-comparative-analysis.html', /Ranks all (\d+) Colorado geographies/],
  ['hna-comparative-analysis.html', /percentile scoring across all (\d+) geographies/],
  ['hna-scenario-builder.html', /Total: (\d+) entries/],
  ['hna-scenario-builder.html', /dumping all (\d+) entries into the DOM/],
]) {
  const match = read(relPath).match(pattern);
  assert(match, `${relPath} exposes a geography count matching ${pattern}`);
  assert.equal(
    Number(match[1]),
    rankingCount,
    `${relPath} count ${match[1]} matches canonical ranking count ${rankingCount}`
  );
}

const policyScorecard = readJson('data/policy/housing-policy-scorecard.json');
assert.equal(
  Object.keys(policyScorecard.scores).length,
  rankingCount,
  'policy scorecard covers the canonical geography universe'
);

const lofHtml = read('lihtc-opportunity-finder.html');
assert(
  lofHtml.includes(`policy scorecard (${rankingCount} Colorado jurisdictions × 7`) &&
    lofHtml.includes(`Housing policy scorecard — ${rankingCount} jurisdictions × 7`),
  'Opportunity Finder policy scorecard count matches canonical ranking count'
);

const lihtc = readJson('data/chfa-lihtc.json');
const affordableProperties = readJson('data/affordable-housing/properties.json').properties;
const normalizePropertyKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedNameAddress = affordableProperties.map((property) =>
  `${normalizePropertyKey(property.property_name)}|${normalizePropertyKey(property.address)}`
).filter((key) => key !== '|');
assert.equal(new Set(normalizedNameAddress).size, normalizedNameAddress.length, 'properties.json has no duplicate normalized name + address keys');
const independence = affordableProperties.filter((property) => /independence village/i.test(property.property_name || ''));
assert.equal(independence.length, 1, 'Independence Village is represented once');
assert.deepEqual(
  new Set(independence[0].merged_from),
  new Set(['CHFA PreservationProperties_Layer_Final_view_new', 'HUD MULTIFAMILY_PROPERTIES_ASSISTED']),
  'Independence Village retains both source attributions'
);
const dataQualitySrc = read('js/data-quality-check.js');
// The count must agree with the feed; the wording around it is free, except
// that it must not call award-year records placed in service (the feed has no
// such year — see test/lihtc-award-year-not-pis.test.js).
const coverageMatch = dataQualitySrc.match(/key:\s*"chfa-lihtc"[\s\S]*?coverageLabel:\s*"(\d+)\s[^"]*LIHTC projects[^"]*"/);
assert(coverageMatch, 'data quality check exposes CHFA LIHTC coverage label');
assert.equal(Number(coverageMatch[1]), lihtc.features.length, 'LIHTC coverage label matches chfa-lihtc feature count');
assert(!coverageMatch[0].includes('716'), 'LIHTC coverage label does not retain stale 716 count');
assert(!/placed[- ]in[- ]service/i.test(coverageMatch[0]), 'LIHTC coverage label does not call award-year records placed in service');

const methodologyHtml = read('hna-comparative-analysis.html');
const rankingJs = read('js/hna/hna-ranking-index.js');
for (const [label, source] of [
  ['comparative page', methodologyHtml],
  ['ranking tooltip', rankingJs],
]) {
  assert(source.includes('55%'), `${label} includes community-need weight`);
  assert(source.includes('45%'), `${label} includes opportunity weight`);
  assert(/augment(?:-only)?/.test(source), `${label} discloses commuter pressure as augment-only`);
  assert(!source.includes('50% unit gap'), `${label} no longer describes a 50% unit-gap weight`);
  assert(!source.includes('20% in-commuter'), `${label} no longer describes a 20% in-commuter weight`);
}

const regionalHtml = read('regional.html');
assert(!regionalHtml.includes('$12.8B'), 'regional first-paint fallback no longer uses stale $12.8B');
assert(!regionalHtml.includes('$3.75'), 'regional first-paint fallback no longer uses stale $3.75');
assert(regionalHtml.includes('$1.15B'), 'regional first-paint fallback uses $1.15B');
assert(regionalHtml.includes('$3.46'), 'regional first-paint fallback uses $3.46');

// Guided step 2: the opportunity finder's intro explains its score in words.
// Hold each explained fact to the weights the ranking actually runs, so the
// sentence and the code cannot drift apart. Reword freely; change the model
// and the claim it no longer supports fails here.
{
  const finderHtml = read('lihtc-opportunity-finder.html');
  const finderJs = read('js/lihtc-opportunity-finder.js');
  const weightsFor = (target) => {
    const m = finderJs.match(new RegExp(`'${target}':\\s*\\{([^}]*)\\}`));
    assert(m, `SCORE_WEIGHTS row for ${target} not found in lihtc-opportunity-finder.js`);
    return Object.fromEntries([...m[1].matchAll(/(\w+):\s*([\d.]+)/g)].map((x) => [x[1], Number(x[2])]));
  };
  const w9 = weightsFor('9pct');
  const w4 = weightsFor('4pct');
  const words = { three: 3, four: 4, five: 5, six: 6, seven: 7 };
  const factorClaim = finderHtml.match(/a score out of 100 from (\w+) things/);
  assert(factorClaim, 'the opportunity finder intro no longer says how many things the score combines');
  assert.equal(words[factorClaim[1]], Object.keys(w9).length,
    `intro says the score uses ${factorClaim[1]} things; the 9% weights have ${Object.keys(w9).length}`);
  assert.equal(Object.keys(w4).length, Object.keys(w9).length, '4% and 9% scores use the same factors');
  if (/9% credit<\/strong>, which favors places that\s+have not had a project recently/.test(finderHtml)) {
    assert(w9.recency > w4.recency, 'intro says the 9% score favors places without a recent project; its recency weight must exceed the 4% one');
  } else {
    assert.fail('the opportunity finder intro no longer says what the 9% score favors');
  }
  if (/4% credit<\/strong> paired with bond\s+financing, which favors larger places/.test(finderHtml)) {
    assert(w4.pop > w9.pop, 'intro says the 4% score favors larger places; its population weight must exceed the 9% one');
  } else {
    assert.fail('the opportunity finder intro no longer says what the 4% score favors');
  }
}

// Guided step 5: the scenario builder states its two housing assumptions in
// plain numbers. They must be the numbers the projection uses.
{
  const builderHtml = read('hna-scenario-builder.html');
  const builderJs = read('js/projections/scenario-builder.js');
  const headship = Number((builderJs.match(/headshipRate:\s*([\d.]+)/) || [])[1]);
  const vacancy = Number((builderJs.match(/vacancyTarget:\s*([\d.]+)/) || [])[1]);
  assert(Number.isFinite(headship) && Number.isFinite(vacancy), 'scenario-builder.js no longer sets headshipRate and vacancyTarget');
  const hh = builderHtml.match(/about (\d+) households for every 100\s+residents/);
  const vac = builderHtml.match(/(\d+)% of homes standing\s+empty/);
  assert(hh && vac, 'the scenario builder no longer states its household and vacancy assumptions');
  assert.equal(Number(hh[1]) / 100, headship, `page says ${hh[1]} households per 100 residents; the model uses ${headship} per person`);
  assert.equal(Number(vac[1]) / 100, vacancy, `page says ${vac[1]}% of homes empty; the model targets ${vacancy}`);
}

console.log(`public-facing-numbers: PASS (${rankingCount} jurisdictions, ${lihtc.features.length} LIHTC features)`);
