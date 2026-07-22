const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const mod = require(path.join(ROOT, 'js', 'pma-commute-shaped.js'));
const odDoc = readJson('data/market/lodes_tract_od_co.json');
const travelDoc = readJson('data/market/travel_time_matrix_co.json');
const paramsFixture = readJson('test/fixtures/pma/commute-shed-params.fixture.json');
const centroids = readJson('data/market/tract_centroids_co.json');
const centroidByGeoid = new Map((centroids.tracts || []).map((t) => [t.geoid, t]));

function seedTracts(ids) {
  return ids.map((geoid) => ({
    ...(centroidByGeoid.get(geoid) || { geoid }),
    _bufferShare: 1
  }));
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

assert.equal(mod.MODE_LABEL, 'Commute-shaped PMA (beta)');
assert.deepEqual(mod.DEFAULT_PARAMS, paramsFixture.params, 'runtime beta params match the committed calibration fixture');
assert.equal(paramsFixture.production_use, 'beta');
assert.match(paramsFixture.calibration_note, /One-site beta calibration/);

const fixture = paramsFixture.fruita_acceptance;
const result = mod.buildModeData(
  seedTracts(fixture.seed_buffer_tracts),
  odDoc,
  travelDoc,
  paramsFixture.params,
  {
    site: fixture.site,
    siteTract: fixture.site.site_tract,
    calibration: fixture
  }
);

assert(result.state.enabled, 'commute-shaped mode enables with committed OD/travel artifacts');
assert.equal(result.state.mode_label, 'Commute-shaped PMA (beta)');
assert.match(result.state.disclosure, /LODES 2023 OD flows/);

const modeTracts = result.tracts.map((t) => t.geoid);
const professional = fixture.professional_tracts;
const captured = professional.filter((geoid) => modeTracts.includes(geoid));
assert(
  captured.length >= fixture.minimum_professional_captures,
  `Fruita gate captures ${captured.length}/${professional.length} professional tracts`
);
assert(
  jaccard(modeTracts, professional) >= fixture.minimum_jaccard,
  `Fruita gate Jaccard ${jaccard(modeTracts, professional).toFixed(3)}`
);
for (const geoid of fixture.must_not_include_east_grand_junction_tracts) {
  assert(!modeTracts.includes(geoid), `east Grand Junction must-not-include tract ${geoid} is absent`);
}

const range = result.state.outside_pma_demand_range;
assert(range, 'mode reports the professional outside-PMA demand benchmark range');
assert.match(range.source, /Professional market studies/);
assert.equal(result.state.validation.professional_capture_count, captured.length);
assert.equal(result.state.validation.must_not_include_hits.length, 0);
const impliedOutside = result.state.validation.implied_outside_pma_share;
assert(Number.isFinite(impliedOutside), 'validation computes implied outside-PMA demand share from OD flows');
assert(
  impliedOutside >= range.min && impliedOutside <= range.max,
  `computed implied outside-PMA demand share ${(impliedOutside * 100).toFixed(1)}% is inside the professional 40-56% band`
);
assert(result.state.validation.implied_outside_pma_numerator_jobs > 0, 'outside-PMA numerator is non-vacuous');
assert(result.state.validation.implied_outside_pma_denominator_jobs > result.state.validation.implied_outside_pma_numerator_jobs, 'outside-PMA denominator is larger than numerator');
assert.match(result.state.validation.implied_outside_pma_definition, /final commute-shaped PMA work tracts/);

const extensions = result.tracts.filter((t) => t._commuteShapedExtension);
assert(extensions.length > 0, 'mode adds non-vacuous OD-backed extension tracts');
for (const t of extensions) {
  assert(t._commuteFlowJobs >= paramsFixture.params.minimum_jobs_to_seed_work_tracts, `${t.geoid} meets absolute OD jobs threshold`);
  assert(t._commuteOrientationShare >= paramsFixture.params.minimum_orientation_share, `${t.geoid} meets orientation-share threshold`);
  assert.match(t._commuteShapeBadge, /jobs to seed PMA/);
  assert(!Object.prototype.hasOwnProperty.call(t, '_barrierCrossings'), 'D-F2 does not compose barrier logic in v1');
}

const noOrientationGate = mod.buildModeData(
  seedTracts(fixture.seed_buffer_tracts),
  odDoc,
  travelDoc,
  {
    minimum_jobs_to_seed_work_tracts: paramsFixture.params.minimum_jobs_to_seed_work_tracts,
    minimum_orientation_share: 0
  },
  { site: fixture.site, siteTract: fixture.site.site_tract }
);
assert(
  fixture.must_not_include_east_grand_junction_tracts.some((geoid) => noOrientationGate.tracts.map((t) => t.geoid).includes(geoid)),
  'sabotage proof: disabling orientation-share condition admits an east Grand Junction must-not-include tract'
);

const blocked = mod.buildModeData(seedTracts(fixture.seed_buffer_tracts), { meta: {}, pairs: [] }, travelDoc, paramsFixture.params, {});
assert.equal(blocked.state.blocked, true, 'empty OD artifact blocks the mode');
assert.equal(blocked.tracts.length, fixture.seed_buffer_tracts.length, 'blocked mode returns seed tracts unchanged');
assert.match(blocked.state.warning, /circular-buffer PMA in use/);

const html = readText('market-analysis.html');
const dom = new JSDOM(html);
const scripts = [...dom.window.document.querySelectorAll('script[src]')].map((script) => script.getAttribute('src'));
assert(!scripts.includes('js/pma-commute-shaped.js'), 'mode module is not fetched on default page load');
assert(html.includes('Commute-shaped PMA (beta)'), 'toggle label is present');
const shapedToggle = dom.window.document.getElementById('pmaCommuteShapedToggle');
assert(shapedToggle, 'commute-shaped toggle exists');
assert.equal(shapedToggle.checked, false, 'commute-shaped toggle is default off');

const marketSource = readText('js/market-analysis.js');
const scoringSource = readText('js/market-analysis-scoring.js');
assert(marketSource.includes("COMMUTE_SHAPED_MODULE_SRC = 'js/pma-commute-shaped.js'"), 'runtime lazy-loads the mode module only after toggle');
assert(!marketSource.includes('lodes_tract_od_co.json'), 'market-analysis.js does not directly fetch the OD artifact');
assert(!marketSource.includes('travel_time_matrix_co.json'), 'market-analysis.js does not directly fetch the travel matrix');
assert(!scoringSource.includes('PMACommuteShaped'), 'scoring module is untouched by commute-shaped mode');
assert(!scoringSource.includes('lodes_tract_od_co.json'), 'OD artifact is not wired into scoring');
assert(!scoringSource.includes('travel_time_matrix_co.json'), 'travel-time matrix is not wired into scoring');
assert(marketSource.includes("['PMA Mode', s.pmaMode]"), 'structured CSV export carries PMA mode');
assert(marketSource.includes("['pma_mode', r.commuteShapedPma"), 'legacy CSV export carries PMA mode');
assert(marketSource.includes('commuteShapedPma: r.commuteShapedPma'), 'structured JSON report carries commute-shaped metadata');
assert(marketSource.includes('pmaSumBoundary') && marketSource.includes('Commute-shaped PMA beta'), 'site summary carries the mode label');

console.log(`pma-commute-shaped: PASS (${modeTracts.length} tracts, ${captured.length}/${professional.length} professional captures)`);
