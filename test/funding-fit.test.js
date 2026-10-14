#!/usr/bin/env node
/**
 * Contract for the project finder: the `fit` tags on each program in
 * data/policy/co-developer-funding-guide.json and js/funding-fit.js, the matcher
 * the Funding Sources tab, the Opportunity Finder and Compare share.
 *
 * What it pins is agreement, not copy:
 *   - every tag rests on words in the program's own record: fit.basis holds them,
 *     and each must appear in the program's name, terms, considerations or quoted
 *     evidence. A tag nobody can point to fails;
 *   - a local program names real counties and places (data/hna/geo-config.json);
 *   - the finder's choices on the page come from the matcher's own vocabulary,
 *     and each page that lists "programs that fit" loads the matcher before
 *     the script that calls it;
 *   - the matcher screens as documented (deal type, project type, county, place,
 *     open rounds, non-capital help), and its URLs round-trip.
 * The sabotage half mutates a copy and proves each check fires, and that a
 * rewording which keeps a tag's words stays green.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GUIDE = JSON.parse(read('data/policy/co-developer-funding-guide.json'));
const GEO = JSON.parse(read('data/hna/geo-config.json'));
const F = require('../js/funding-fit.js');

const EXEC = new Set(F.EXECUTIONS.map((e) => e[0]));
const TYPES = new Set(F.PROJECT_TYPES.map((t) => t[0]));
const ROLES = new Set(['capital', 'rental-assistance', 'support']);
const SCOPES = new Set(['statewide', 'local', 'rural', 'designated-areas', 'non-entitlement', 'prop123-committed']);
const COUNTIES = new Set(GEO.counties.map((c) => c.geoid));
const PLACES = new Set(GEO.places.map((p) => p.geoid));

function recordText(p) {
  return [p.name, p.what_it_funds, p.eligible_projects, p.eligible_applicants, p.application_cycle,
    p.ami_restriction, p.award_size, ...(p.key_considerations || []), ...(p.evidence || []).map((e) => e.quote)]
    .filter((v) => typeof v === 'string').join('\n');
}

function check(g) {
  const errors = [];
  const err = (m) => errors.push(m);
  let bases = 0;
  for (const p of g.programs || []) {
    const at = `program ${p.id}`;
    const f = p.fit;
    if (!f) { err(`${at}: no fit tags`); continue; }
    const basis = f.basis || {};
    const text = recordText(p);
    for (const [k, words] of Object.entries(basis)) {
      bases++;
      if (typeof words !== 'string' || !words.trim() || !text.includes(words)) err(`${at}: fit.basis.${k} is not in the program's record: ${JSON.stringify(words)}`);
    }
    if (!ROLES.has(f.role)) err(`${at}: unknown role ${f.role}`);
    if (f.role !== 'capital' && !basis.role) err(`${at}: role ${f.role} has no basis`);
    for (const e of f.execution || []) if (!EXEC.has(e)) err(`${at}: unknown deal type ${e}`);
    for (const t of f.project_types || []) if (!TYPES.has(t)) err(`${at}: unknown project type ${t}`);
    if (f.role === 'support') {
      if ((f.execution || []).length) err(`${at}: support that is not project capital carries no deal types`);
    } else {
      if (!(f.execution || []).length) err(`${at}: names no deal type`);
      if (!basis.execution) err(`${at}: deal types have no basis`);
    }
    if ((f.project_types || []).length && !basis.project_types) err(`${at}: project types have no basis`);
    const geo = f.geography || {};
    if (!SCOPES.has(geo.scope)) err(`${at}: unknown geography scope ${geo.scope}`);
    if (geo.scope !== 'statewide' && !basis.geography) err(`${at}: geography ${geo.scope} has no basis`);
    if (geo.scope === 'local') {
      if (!(geo.counties || []).length) err(`${at}: a local program names its counties`);
      for (const c of geo.counties || []) if (!COUNTIES.has(c)) err(`${at}: county ${c} is not a Colorado county`);
      for (const pl of geo.places || []) if (!PLACES.has(pl)) err(`${at}: place ${pl} is not in geo-config`);
      if (!geo.label) err(`${at}: a local program says where it applies`);
    }
  }
  return { errors, bases };
}

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('funding-fit');

ok('every program in the committed guide carries fit tags its own record supports', () => {
  const r = check(GUIDE);
  assert.deepEqual(r.errors, []);
  // Non-vacuity on the scan: the basis check actually compared words for most programs.
  assert.ok(r.bases >= 80, `only ${r.bases} tag bases checked`);
  assert.ok(GUIDE.programs.every((p) => p.fit), 'every program tagged');
});

ok('the finder screens by deal type, project type, county, place, open rounds and role', () => {
  // INVENTED programs; no real program's terms.
  const g = { programs: [
    { id: 'a', status: 'open', fit: { role: 'capital', execution: ['9%'], project_types: ['new-construction'], geography: { scope: 'statewide' } } },
    { id: 'b', status: 'closed', fit: { role: 'capital', execution: ['9%', '4%'], project_types: [], geography: { scope: 'statewide' } } },
    { id: 'c', status: 'rounds', fit: { role: 'capital', execution: ['4%'], project_types: ['acq-rehab'], geography: { scope: 'local', counties: ['08999'], places: ['0899999'], label: 'Invented City only' } } },
    { id: 'd', status: 'open', fit: { role: 'support', execution: [], project_types: [], geography: { scope: 'statewide' } } },
    { id: 'e', status: 'watch', fit: { role: 'rental-assistance', execution: ['9%', '4%', 'rental'], project_types: ['supportive'], geography: { scope: 'rural' } } }
  ] };
  const ids = (q) => F.select(g, q).map((r) => r.program.id);
  assert.deepEqual(ids({}).sort(), ['a', 'b', 'c', 'e'], 'support is hidden unless asked for');
  assert.deepEqual(ids({ includeSupport: true }).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ execution: '9%' }), ['a', 'e', 'b'], 'open or scheduled first, then unknown, then closed');
  assert.deepEqual(ids({ execution: '4%', openOnly: true }), ['c'], 'closed and watch drop out of open-only');
  assert.deepEqual(ids({ projectType: 'acq-rehab' }).sort(), ['b', 'c'], 'an untyped program fits any project type');
  assert.deepEqual(ids({ county: '08001' }).sort(), ['a', 'b', 'e'], 'a city fund does not reach another county');
  assert.deepEqual(ids({ county: '8999' }).sort(), ['a', 'b', 'c', 'e'], 'a county code is padded to five digits');
  assert.deepEqual(ids({ county: '08999', place: '0811111' }).sort(), ['a', 'b', 'e'], 'nor another town in its own county');
  assert.deepEqual(F.match(g.programs[2], { county: '08999' }).notes, ['Invented City only.']);
  assert.match(F.match(g.programs[4], {}).notes.join(' '), /rural/i);
  assert.match(F.match(g.programs[4], {}).notes.join(' '), /not development capital/);
  assert.equal(F.availability({ status: 'rolling' }), 'open');
  assert.equal(F.availability({ status: 'annual' }), 'scheduled');
  assert.equal(F.availability({ status: null }), 'check', 'no status is "ask", never open');
});

ok('finder URLs round-trip and reject anything outside the vocabulary', () => {
  const q = { execution: '4%', projectType: 'preservation', county: '08077', openOnly: true, program: 'chfa-capable-bond-c2p' };
  const url = F.guideUrl(q);
  assert.match(url, /^colorado-deep-dive\.html\?.+#tab-funding$/);
  assert.deepEqual(F.parseQuery(url.slice(url.indexOf('?'), url.indexOf('#'))), q);
  assert.deepEqual(F.parseQuery('?exec=12%25&type=castle&county=abc&open=yes&program=%3Cx%3E'), {});
  assert.equal(F.guideUrl({}), 'colorado-deep-dive.html#tab-funding');
});

ok('the page offers the matcher\'s own choices and loads it before the renderer', () => {
  const page = read('colorado-deep-dive.html');
  const js = read('js/co-developer-funding.js');
  for (const id of ['dfFinder', 'dfFindExec', 'dfFindType', 'dfFindCounty', 'dfFindOpen', 'dfFindSupport', 'dfFindSummary', 'dfCompare', 'dfCompareTable']) {
    assert.ok(page.includes(`id="${id}"`), `page lacks #${id}`);
  }
  // Choices are built from FundingFit's lists, not a second copy in the page.
  assert.match(js, /options\(F\.EXECUTIONS,/);
  assert.match(js, /options\(F\.PROJECT_TYPES,/);
  assert.doesNotMatch(page, /<option value="9%"/);
  for (const [file, script] of [
    ['colorado-deep-dive.html', 'js/co-developer-funding.js'],
    ['lihtc-opportunity-finder.html', 'js/lihtc-opportunity-finder.js'],
    ['compare.html', 'js/compare.js']
  ]) {
    const html = read(file);
    const a = html.indexOf('src="js/funding-fit.js"');
    const b = html.indexOf(`src="${script}"`);
    assert.ok(a !== -1 && b !== -1 && a < b, `${file} loads js/funding-fit.js before ${script}`);
  }
  // The search records point at the same URL the matcher builds.
  const search = fs.readFileSync(path.join(ROOT, 'scripts/lib/search-index.mjs'), 'utf8');
  assert.ok(search.includes('colorado-deep-dive.html?program=${encodeURIComponent(p.id)}#tab-funding'));
  assert.equal(F.guideUrl({ program: 'x' }), 'colorado-deep-dive.html?program=x#tab-funding');
});

// ── Sabotage: each mutation must apply, and must be caught ──
const clone = () => JSON.parse(JSON.stringify(GUIDE));
const idx = (id) => GUIDE.programs.findIndex((p) => p.id === id);

function sabotage(name, mutate, expect) {
  ok('sabotage: ' + name, () => {
    const g = clone();
    const before = JSON.stringify(g);
    mutate(g);
    assert.notEqual(JSON.stringify(g), before, 'mutation applied');
    const { errors } = check(g);
    assert.ok(errors.some((e) => expect.test(e)), `expected ${expect}, got ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

sabotage('a tag whose words the record does not contain', (g) => {
  g.programs[idx('chfa-capable-bond-c2p')].fit.basis.execution = 'for 9% housing credit projects';
}, /chfa-capable-bond-c2p: fit\.basis\.execution is not in the program's record/);

sabotage('a record reworded so it no longer supports its tag', (g) => {
  const p = g.programs[idx('usda-538')];
  p.what_it_funds = p.what_it_funds.replace('eligible rural areas', 'anywhere in Colorado');
  p.eligible_projects = p.eligible_projects.replace('eligible rural areas', 'anywhere in Colorado');
  (p.evidence || []).forEach((e) => { e.quote = e.quote.replace(/eligible rural areas/g, 'anywhere'); });
}, /usda-538: fit\.basis\.geography/);

sabotage('a new deal type added with no basis', (g) => {
  const f = g.programs[idx('chfa-mihtc')].fit;
  f.execution.push('9%');
  delete f.basis.execution;
}, /chfa-mihtc: deal types have no basis/);

sabotage('a local fund pointed at a county that does not exist', (g) => {
  g.programs[idx('denver-host-gap')].fit.geography.counties = ['08999'];
}, /denver-host-gap: county 08999 is not a Colorado county/);

sabotage('support that is not project capital given a deal type', (g) => {
  g.programs[idx('nmtc')].fit.execution = ['9%'];
}, /nmtc: support that is not project capital carries no deal types/);

ok('sabotage: a rewording that keeps a tag\'s words stays green', () => {
  const g = clone();
  const p = g.programs[idx('chfa-capable-bond-c2p')];
  const before = p.what_it_funds;
  p.what_it_funds = 'Bond loan, construction through permanent: ' + before;
  assert.notEqual(p.what_it_funds, before, 'mutation applied');
  assert.deepEqual(check(g).errors, []);
});

console.log(`funding-fit: ${passed} passed`);
