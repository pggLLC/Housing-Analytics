#!/usr/bin/env node
/**
 * Contract for the jurisdiction white paper (js/whitepaper/jurisdiction-whitepaper.js,
 * scripts/whitepaper/build-whitepaper.mjs, and the Jurisdiction Report page developer-brief.html,
 * which merged the old brief and white paper on 2026-10-14).
 *
 * What it pins is agreement, not copy:
 *   - every figure in the need and rent sections equals the file it cites
 *     (ranking-index metrics, CHFA rent limits, HUD FMR), for every jurisdiction
 *     the scan builds, and the scan builds something;
 *   - an unmeasured value prints "Not available", never 0, including the
 *     ranking builder's all-zero AMI gap fallback;
 *   - the owner's own project and text the public-artifact guard blocks never
 *     reach the document; search-engine links never appear as contacts, and every
 *     researched contact quotes the page it came from;
 *   - the page stays private: the public build and the artifact guard both
 *     exclude it, and the page loads the module it calls.
 * Sabotage cases mutate copies and prove each check fires.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
const FundingFit = require(join(ROOT, 'js/funding-fit.js'));
const MixCheck = require(join(ROOT, 'js/mix-check.js'));
const { isSensitive } = await import(join(ROOT, 'scripts/lib/public-sensitive-patterns.mjs'));
const { loadSources, build } = await import(join(ROOT, 'scripts/whitepaper/build-whitepaper.mjs'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const src = loadSources();
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ---- 1. Figures agree with the files they cite.
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function figuresAgree(sources, geoid) {
  const row = sources.rankingIndex.rankings.find((r) => r.geoid === geoid);
  const m = WP.buildModel(sources, geoid, { FundingFit, today: '2026-10-14' });
  const html = WP.renderHtml(m);
  const problems = [];
  const pop = row.metrics.population;
  if (typeof pop === 'number' && !html.includes('<th scope="row">Population</th><td>' + fmt(pop) + '</td>')) problems.push('population');
  const rent = row.metrics.gross_rent_median;
  if (typeof rent === 'number' && rent > 0 && !html.includes('<th scope="row">Median gross rent</th><td>$' + fmt(rent) + '</td>')) problems.push('median rent');
  const county = row.type === 'county' ? row.geoid : row.containingCounty;
  const lim = sources.rentLimits.counties.find((c) => c.fips === county);
  const r60 = lim && lim.regular_tiers['60'] && lim.regular_tiers['60'].max_rents['2br'];
  if (r60 && !html.includes('<td>60% AMI</td><td class="n">$' + fmt(r60) + '</td>')) problems.push('60% rent limit');
  const fmr = sources.fmr.counties.find((c) => c.fips === county);
  if (fmr && fmr.fmr.two_br > 0 && !html.includes('$' + fmt(fmr.fmr.two_br))) problems.push('FMR');
  return problems;
}
const SAMPLE = ['0833640', '0822035', '0828745', '0820000', '08051', '08045', '08001'];
for (const g of SAMPLE) ok(figuresAgree(src, g).length === 0, `${g}: figures disagree with their sources: ${figuresAgree(src, g)}`);
ok(SAMPLE.length >= 5, 'the agreement scan must build several jurisdictions');
{
  // Sabotage: the paper must follow the data, so a changed population shows up.
  const s = clone(src);
  const row = s.rankingIndex.rankings.find((r) => r.geoid === '0833640');
  const before = WP.renderHtml(WP.buildModel(s, '0833640', { FundingFit }));
  row.metrics.population = 123457;
  const after = WP.renderHtml(WP.buildModel(s, '0833640', { FundingFit }));
  ok(before !== after && after.includes('123,457'), 'mutating the ranking index must change the paper');
}

// ---- 2. Every jurisdiction builds, and none prints a guarded pattern.
let built = 0;
for (const r of src.rankingIndex.rankings) {
  const m = WP.buildModel(src, r.geoid, { FundingFit, isSensitive });
  assert.ok(!m.error, m.error);
  const html = WP.renderHtml(m);
  assert.ok(!/NaN|undefined|\[object Object\]/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), `${r.geoid}: stray NaN/undefined/object in output`);
  built++;
}
ok(built === src.rankingIndex.rankings.length && built > 500, `built ${built} white papers`);

// ---- 3. Absence prints "Not available", never 0.
{
  const s = clone(src);
  const row = s.rankingIndex.rankings.find((r) => r.geoid === '0833640');
  row.metrics.median_hh_income = null;
  row.metrics.gross_rent_median = null;
  const html = WP.renderHtml(WP.buildModel(s, '0833640', { FundingFit }));
  ok(html.includes('<th scope="row">Median household income</th><td>Not available</td>'), 'null income must print Not available');
  ok(!html.includes('<th scope="row">Median gross rent</th><td>$0'), 'null rent must not print $0');
  // The ranking builder's no-data fallback writes 0 to all three gap bands.
  Object.assign(row.metrics, { ami_gap_30pct: 0, ami_gap_50pct: 0, ami_gap_60pct: 0, pct_burdened_lte30: null });
  const m = WP.buildModel(s, '0833640', { FundingFit });
  ok(m.need.gap30 === null && m.deal.mix === null, 'all-zero gap fallback with no band burden must be unknown, not zero');
  row.metrics.pct_burdened_lte30 = 40;
  ok(WP.buildModel(s, '0833640', { FundingFit }).need.gap30 === 0, 'a measured zero gap stays zero');
}

// ---- 3b. AMI gaps are cumulative thresholds (build_place_ami_gap.py), never summed.
{
  const row = src.rankingIndex.rankings.find((r) => r.geoid === '0833640');
  const [g30, g50, g60] = ['ami_gap_30pct', 'ami_gap_50pct', 'ami_gap_60pct'].map((k) => row.metrics[k]);
  const html = WP.renderHtml(WP.buildModel(src, '0833640', { FundingFit }));
  ok(html.includes('<td>At or below 60% AMI</td><td class="n">' + fmt(g60) + '</td>'), 'the 60% row shows the cumulative 60% value');
  ok(!html.includes(fmt(g30 + g50 + g60) + ' rental homes'), 'the three thresholds are never added');
  const s = clone(src);
  Object.assign(s.rankingIndex.rankings.find((r) => r.geoid === '0833640').metrics, { ami_gap_30pct: 100, ami_gap_50pct: 150, ami_gap_60pct: 200, pct_burdened_lte30: 50 });
  ok(WP.renderHtml(WP.buildModel(s, '0833640', { FundingFit })).includes('<td>At or below 60% AMI</td><td class="n">200</td>'), 'sabotage: the row follows the data');
}

// ---- 3c. A city that spans counties keeps its records from every county.
{
  const props = src.chfaLihtc.features.map((f) => f.properties || f);
  const outside = props.filter((p) => p.PROJ_CTY === 'Aurora' && p.CNTY_FIPS !== '08005');
  ok(outside.length > 0, 'non-vacuity: Aurora has tax-credit properties outside Arapahoe County');
  const m = WP.buildModel(src, '0804000', { FundingFit });
  ok(outside.every((p) => m.lihtc.properties.some((x) => x.name === p.PROJECT)), 'Aurora keeps its Adams/Douglas County properties');
  ok(m.lihtc.properties.every((x) => x.city === 'Aurora'), 'and only Aurora properties');
}

// ---- 4. The owner's project and guarded text never reach the paper.
{
  const s = clone(src);
  s.applications = { meta: {}, applications: [{ name: 'Fruita Mews Phase II', place_geoids: ['0828745'], county_fips: '08077', year: 2025, outcome: 'not_awarded' },
    { name: 'Control Project', place_geoids: ['0828745'], county_fips: '08077', year: 2025, outcome: 'awarded' }] };
  s.awards = clone(src.awards); s.awards.awards.push({ name: 'Fruita Mews Phase 2', county_fips: '08077', location: 'Fruita', year: 2026, agency: 'CHFA', program: 'LIHTC 9%' });
  const html = WP.renderHtml(WP.buildModel(s, '0828745', { FundingFit }));
  ok(html.includes('Control Project'), 'the scan must print applications (non-vacuity)');
  ok(!/Fruita Mews Phase (II|2)/i.test(html), "the owner's own project must not appear");
  const brief = JSON.parse(read('data/jurisdiction-briefs/0828745.json'));
  const withGuard = WP.buildModel(src, '0828745', { FundingFit, brief, isSensitive });
  ok(!isSensitive(WP.renderHtml(withGuard)), 'guarded text must be dropped from the brief');
  const withoutGuard = WP.renderHtml(WP.buildModel(src, '0828745', { FundingFit, brief }));
  ok(isSensitive(withoutGuard) && withGuard.brief.dropped > 0, 'sabotage: without the guard the Fruita brief trips it, so the drop is real');
  ok(build('Fruita', { today: '2026-10-14' }).html.length > 1000, 'the CLI builds Fruita with the guard on');
}

// Synthetic researched files. The real ones live in the private coho-backend repo,
// whose build checks every entry's source; these prove the paper prints them.
const Q = 'a quote long enough to pass the source check';
const FIXTURE_CONTACTS = { geoid: '0833640', name: 'City of Gunnison', checked: '2026-10-14', contacts: [
  { name: 'Test Director', role: 'Community Development Director', org: 'City of Gunnison', source_url: 'https://example.org/minutes', source_quote: Q },
  { name: 'Test Manager', role: 'City Manager', org: 'City of Gunnison', source_url: 'https://example.org/staff', source_quote: Q }
] };
const FIXTURE_LANDSCAPE = { geoid: '0833640', researched: '2026-10-14',
  plans: [{ title: 'Test housing plan', year: '2024', finding: 'Finds a shortage', source_url: 'https://example.org/plan', source_quote: Q }],
  agencies: [{ name: 'Test housing fund', role: 'Funder', source_url: 'https://example.org/fund', source_quote: Q }],
  state_funds: [{ program: 'Test state program', recipient: 'Test housing fund', amount: '$1', date: '2026-01-01', source_url: 'https://example.org/award', source_quote: Q }],
  task_forces: [{ name: 'Test task force', members_public: 'Not published', source_url: 'https://example.org/tf', source_quote: Q }],
  people: [{ name: 'Test Person', public_role: 'Developer', housing_involvement: 'Built homes', source_url: 'https://example.org/news', source_quote: Q }],
  land: [{ name: 'Test parcel', acres: '5', owner: 'City', status: 'Vacant', source_url: 'https://example.org/land', source_quote: Q }],
  lihtc_and_pipeline: [{ name: 'Test apartments', units: '36', status: 'Built', source_url: 'https://example.org/lihtc', source_quote: Q }] };

// ---- 5. Contacts: researched ones quote their source; search links never show.
{
  const c = FIXTURE_CONTACTS;
  ok(!existsSync(join(ROOT, 'data/jurisdiction-briefs/_contacts')), 'researched contacts stay out of the public repo (they live in coho-backend)');
  const cmod = WP.buildModel(src, c.geoid, { FundingFit, contacts: c });
  ok(cmod.contacts.researched.length === c.contacts.length, 'every researched contact reaches the paper');
  const bad = { ...c, contacts: [{ ...c.contacts[0], source_url: 'https://www.google.com/search?q=x' }] };
  ok(WP._internal.isSearchLink(bad.contacts[0].source_url), 'sabotage: a search page is recognised as one');
  // Curated brief sources: search links never print, here or in any brief.
  for (const f of readdirSync(join(ROOT, 'data/jurisdiction-briefs')).filter((n) => /^\d+\.json$/.test(n))) {
    const brief = JSON.parse(readFileSync(join(ROOT, 'data/jurisdiction-briefs', f), 'utf8'));
    const out = WP.renderHtml(WP.buildModel(src, brief.geoid, { FundingFit, brief, isSensitive }));
    assert.ok(!/google\.[a-z.]+\/search/.test(out), `${f}: a search link reached the white paper`);
  }
  ok((read('data/jurisdiction-briefs/0803620.json').match(/google\.[a-z.]+\/search/g) || []).length > 0, 'non-vacuity: a brief with search links exists');
  const lr = JSON.parse(read('data/hna/local-resources.json'));
  const m = WP.buildModel(src, '0833640', { FundingFit, localResources: lr });
  const html = WP.renderHtml(m);
  ok(m.contacts.orgs.length > 0, 'organisation links found (non-vacuity)');
  ok(!/google\.[a-z.]+\/search/.test(html), 'no search-engine link in the paper');
  const s = { 'place:0833640': { housingLead: { name: 'Search result', url: 'https://www.google.com/search?q=x' } } };
  ok(WP.buildModel(src, '0833640', { FundingFit, localResources: s }).contacts.orgs.length === 0, 'sabotage: a search link is dropped');
}

// ---- 6. The page stays private and loads what it calls.
{
  const pub = read('scripts/build-public-site.mjs');
  const guard = read('scripts/audit/public-artifact-guard.mjs');
  ok(/PRIVATE_ROOT_HTML = new Set\(\[[^\]]*'developer-whitepaper\.html'/.test(pub), 'public build must exclude developer-whitepaper.html');
  ok(/'js\/whitepaper'/.test(pub) && /'js\/whitepaper'/.test(guard), 'public build and guard must exclude js/whitepaper');
  ok((guard.match(/'developer-whitepaper\.html'/g) || []).length >= 2, 'guard forbids the page as a path and as a link');
  ok(/PRIVATE_ROOT_HTML = new Set\(\[[^\]]*'developer-brief\.html'/.test(pub), 'public build must exclude developer-brief.html');
  const page = read('developer-brief.html');
  const i = (s) => page.indexOf(s);
  ok(i('js/developer-gate.js') > -1 && i('js/developer-gate.js') < i('js/whitepaper/jurisdiction-whitepaper.js'), 'the gate loads before the generator');
  ok(i('js/funding-fit.js') > -1 && i('js/funding-fit.js') < i('window.JurisdictionWhitepaper;'), 'the matcher loads before the page script');
  ok(/isSensitive\b/.test(page.slice(page.indexOf('WP.buildModel'))) && /isSensitive\(html\)/.test(page), 'the page passes the guard to buildModel and checks the finished HTML');
  // The old white paper address forwards to the report, keeping the jurisdiction.
  const old = read('developer-whitepaper.html');
  ok(/location\.replace\('developer-brief\.html'/.test(old) && /\?geoid=' \+ g/.test(old), 'developer-whitepaper.html forwards to the report with its geoid');
  ok(/did not load, so nothing was built/.test(page), 'the page refuses to build without the guard');
  for (const k of Object.keys(WP.SOURCE_FILES)) {
    if (!WP.isOptional(k)) ok(existsSync(join(ROOT, WP.sourcePath(k))), `${WP.sourcePath(k)} exists`);
  }
}

// ---- 7. Local landscape and deal dynamics agree with their files.
{
  const L = FIXTURE_LANDSCAPE;
  ok(!existsSync(join(ROOT, 'data/jurisdiction-briefs/_landscape')), 'researched landscape stays out of the public repo (it lives in coho-backend)');
  const entries = ['plans', 'agencies', 'state_funds', 'task_forces', 'people', 'land', 'lihtc_and_pipeline'].reduce((n, k) => n + L[k].length, 0);
  const lm = WP.buildModel(src, L.geoid, { FundingFit, landscape: L, isSensitive });
  const shownCount = lm.landscape.research.groups.reduce((n, g) => n + g.items.length, 0);
  ok(shownCount === entries && entries === 7, 'every sourced entry reaches the paper');
  ok(!isSensitive(WP.renderHtml(lm)), 'the paper passes the private-text guard');
  // Sabotage: an unsourced entry and the owner's project never print.
  const fake = { geoid: '0833640', researched: '2026-10-14', land: [{ name: 'Unsourced lot', acres: 5 }], lihtc_and_pipeline: [{ name: 'Fruita Mews Phase II', units: 40, source_url: 'https://example.org/x', source_quote: 'a quote long enough to pass the check' }] };
  const fm = WP.buildModel(src, '0833640', { FundingFit, landscape: fake });
  ok(fm.landscape.research.groups.every((g) => g.items.length === 0), 'sabotage: unsourced and excluded entries are dropped');
  // The owner's project is caught in any field, including plan findings and open questions.
  const fake2 = { geoid: '0833640', researched: '2026-10-14', plans: [{ title: 'A plan', finding: 'mentions Fruita Mews Phase II', source_url: 'https://example.org/p', source_quote: 'a quote long enough to pass the check' }], not_found: ['Status of Fruita Mews Phase 2', 'Who bought the land'] };
  const f2 = WP.renderHtml(WP.buildModel(src, '0833640', { FundingFit, landscape: fake2 }));
  ok(!/fruita\s+mews/i.test(f2) && /Who bought the land/.test(f2), 'sabotage: the owner\'s project is dropped from any field, other open questions stay');
  // Stewardship roles: only those the provider record marks verified.
  const hr = src.stewardship.providers.find((p) => (p.counties_served || []).includes('08051'));
  const shown = WP.buildModel(src, '0833640', { FundingFit }).landscape.stewards[0].roles;
  ok(hr && hr.role_evidence.verify_with_provider.length > 0 && hr.role_evidence.verify_with_provider.every((r) => !shown.includes(r.replace(/_/g, ' '))), 'unverified provider roles never print');
  // A county file stands in for a town without its own, and says so.
  const cm = WP.buildModel(src, '0833640', { FundingFit, landscape: { ...fake, geoid: '08051' } });
  ok(cm.landscape.research && cm.landscape.research.countyLevel, 'county research stands in for the town');
  ok(/Researched for Gunnison County as a whole/.test(WP.renderHtml(cm)), 'the paper says the research is county-level');
  // A file for another place is ignored.
  ok(WP.buildModel(src, '0833640', { FundingFit, landscape: { ...fake, geoid: '0818310' } }).landscape.research === null, 'research for another place is ignored');
  // Housing authorities come from the resort programs file and match the town.
  const cb = WP.buildModel(src, '0818310', { FundingFit });
  const auth = src.resortPrograms.authorities.filter((a) => (a.serves_place_geoids || []).includes('0818310'));
  ok(auth.length > 0 && cb.landscape.authorities.length === auth.length, 'Crested Butte lists its housing authority (non-vacuity)');
  ok(WP.buildModel(src, '0820000', { FundingFit }).landscape.authorities.every((a) => !/Crested Butte/.test(a.name)), 'another town\'s authority never leaks into Denver');
  // Deal dynamics: bond cap and equity price equal their files.
  const g = WP.buildModel(src, '0833640', { FundingFit });
  const pabCounty = src.pab.allocations['08051'];
  ok(pabCounty && g.dynamics.pab.some((x) => x.amount === pabCounty.directAllocation), 'bond cap equals pab-allocations.json');
  ok(new RegExp(`initial ${src.pab.metadata.year} direct allocation`).test(WP.renderHtml(g)) && !/ holds \$/.test(WP.renderHtml(g)), 'the local bond figure is labelled an initial allocation, not available cap');
  ok(g.dynamics.equity9 === src.equityPricing.pricing.national_avg.credit_9pct, '9% equity price equals the Novogradac file');
  const noPab = clone(src); noPab.pab = null;
  ok(WP.buildModel(noPab, '0833640', { FundingFit }).dynamics.pab.length === 0, 'missing bond file: no allocation printed');
  const wa = WP.buildModel(src, '0833640', { FundingFit }).dynamics.localMoney;
  ok(wa.some((w) => /Land Banking/.test(w.program)), 'the Gunnison land-banking award reaches the landscape (non-vacuity)');
  const page = read('developer-brief.html');
  ok(/WP\.landscapePath\(geoid\)/.test(page) && /WP\.relatedGeoids\(SOURCES, geoid\)/.test(page) && /related\.map\(g => softJson\(WP\.landscapePath\(g\)\)\)/.test(page) && /relatedContacts, relatedLandscape/.test(page), 'the page loads the place file and its related files, and passes them on');
}

// ---- 8. The merged report: community profile, market rents, all properties, policy
// markers. Each figure equals the file it comes from; a missing value never prints 0.
{
  const sum = JSON.parse(read(WP.summaryPath('0833640')));
  const p = sum.acsProfile;
  const m = WP.buildModel(src, '0833640', { FundingFit, summary: sum });
  const html = WP.renderHtml(m);
  ok(m.community && m.community.people.population === p.DP05_0001E, 'population equals the ACS profile');
  // DP04_0005E is a published rate. The old brief divided it by total units and printed 0.0%.
  ok(m.community.stock.rentalVacancyPct === p.DP04_0005E && html.includes('<th scope="row">Rental vacancy rate</th><td>' + p.DP04_0005E.toFixed(1) + '%</td>'), 'rental vacancy prints the published rate');
  const nullVac = clone(sum); nullVac.acsProfile.DP04_0005E = null;
  ok(WP.renderHtml(WP.buildModel(src, '0833640', { FundingFit, summary: nullVac })).includes('<th scope="row">Rental vacancy rate</th><td>Not available</td>'), 'sabotage: a missing vacancy rate prints Not available, not 0');
  const incomeTotal = m.community.people.income.reduce((a, r) => a + r.count, 0);
  ok(incomeTotal === p.DP02_0001E, 'income bins add up to the households they divide (non-vacuity)');
  // The home value agrees with the ranking index, which every other page uses.
  const row = src.rankingIndex.rankings.find((r) => r.geoid === '0833640');
  ok(m.community.stock.homeValue.value === row.metrics.median_home_value, 'home value equals the ranking index');
  ok(html.includes('$' + fmt(row.metrics.median_home_value) + '</div><div class="wp-tile-l">Median home value'), 'the first screen shows the same home value');
  ok(html.includes('<div class="wp-tile-v">' + fmt(m.need.gap30) + '</div><div class="wp-tile-l">Rental homes short, 30% AMI or less'), 'the first screen shows the need section\'s 30% shortfall');
  // A profile for another place is ignored rather than printed under this name.
  ok(WP.buildModel(src, '0822035', { FundingFit, summary: sum }).community === null, 'another place\'s profile is ignored');
  // The need score is explained in the builder's own words, carried in the data file.
  const desc = src.rankingIndex.metrics.find((x) => x.id === 'overall_need_score').description;
  ok(html.includes(desc.replace(/&/g, '&amp;')), 'the need-score explanation is the ranking index\'s own description');
  const reworded = clone(src); reworded.rankingIndex.metrics.find((x) => x.id === 'overall_need_score').description = 'Sabotage wording.';
  ok(WP.renderHtml(WP.buildModel(reworded, '0833640', { FundingFit })).includes('Sabotage wording.'), 'sabotage: reword the data and the report follows');
  // Market rents equal their files.
  // Zillow drops thin counties some months (Gunnison left the September 2026 file):
  // a published county shows its rent, an unpublished one shows no Zillow row at all.
  const z = src.zori.counties['08051'];
  const gz = m.market.filter((x) => /ZORI/.test(x.source));
  ok(z ? gz.length === 1 && gz[0].all === z.rent : gz.length === 0, 'Zillow rent equals the ZORI file, or is absent when the file has none');
  const withZ = clone(src); withZ.zori.counties['08051'] = { name: 'Gunnison County', rent: 2475, vintage_month: '2026-08-31' };
  ok(WP.buildModel(withZ, '0833640', { FundingFit }).market.some((x) => /ZORI/.test(x.source) && x.all === 2475), 'sabotage: a county in the ZORI file gets its rent');
  const noZ = clone(withZ); delete noZ.zori.counties['08051'];
  ok('08051' in withZ.zori.counties && !('08051' in noZ.zori.counties), 'the removal mutation applied');
  ok(!WP.buildModel(noZ, '0833640', { FundingFit }).market.some((x) => /ZORI/.test(x.source)), 'sabotage: a county dropped from the ZORI file gets no Zillow row, not $0');
  const den = WP.buildModel(src, '0820000', { FundingFit });
  // Every county the file publishes shows its own rent; the scan must find some.
  const zCounties = Object.keys(src.zori.counties || {});
  ok(zCounties.length > 0, 'the ZORI file publishes counties to check (non-vacuity)');
  ok(zCounties.every((f) => WP.buildModel(src, f, { FundingFit }).market.some((x) => /ZORI/.test(x.source) && x.all === src.zori.counties[f].rent)), 'every published county\'s Zillow rent equals the ZORI file');
  ok(den.market.some((x) => /Apartment List/.test(x.source) && x.br2 === src.apartmentList.cities.denver.rent_2br), 'Apartment List 2BR equals its file');
  ok(!m.market.some((x) => /Apartment List/.test(x.source)), 'no Apartment List row for a city it does not cover');
  // Every assisted property in the town, and nothing from another county's same-named town.
  const inv = m.inventory.properties;
  const want = src.properties.properties.filter((q) => (q.city || '').toLowerCase() === 'gunnison' && !/fruita\s+mews/i.test(q.property_name || ''));
  ok(inv.length === want.length && inv.length > 0, 'the property list matches the inventory file for the town');
  const withOwner = clone(src); withOwner.properties.properties.push({ property_name: 'Fruita Mews Phase II', city: 'Gunnison', county_fips: '08051', program_type: ['lihtc-9pct'] });
  ok(WP.buildModel(withOwner, '0833640', { FundingFit }).inventory.properties.length === inv.length, 'sabotage: the owner\'s project never enters the property list');
  // Policy markers equal the scorecard; an unassessed marker is not a No.
  const sc = src.scorecard.scores['0833640'];
  ok(m.civic.total === sc.totalScore && html.includes('<th scope="row">Has Housing Needs Assessment</th><td>Not assessed</td>'), 'policy markers equal the scorecard, unknown stays unknown');
  // The PAB source is linked only when the data names the DOLA page.
  ok(src.pab.metadata.sourceUrl && html.includes('href="' + src.pab.metadata.sourceUrl + '"'), 'the bond allocation links the page the data was read from');
  const noUrl = clone(src); noUrl.pab.metadata.sourceUrl = 'https://example.localhost/old';
  ok(WP.renderHtml(WP.buildModel(noUrl, '0833640', { FundingFit })).includes('DOLA allocation page not on record'), 'sabotage: an unknown source is marked, not linked');
  ok(!html.includes('cdola.colorado.gov/private-activity-bonds'), 'the retired DOLA bond page is never linked');
}

// ---- 9. One menu for every gated page.
{
  const Nav = require(join(ROOT, 'js/whitepaper/developer-nav.js'));
  const gated = readdirSync(ROOT).filter((f) => /^developer.*\.html$/.test(f) && f !== 'developer-whitepaper.html');
  ok(gated.length >= 4, 'the scan finds the gated pages');
  for (const f of gated) {
    const s = read(f);
    ok(s.includes('<nav id="devNav" class="ib-section-nav"></nav>') && s.includes('js/whitepaper/developer-nav.js'), `${f} uses the shared menu`);
    ok(!/<nav[^>]*>\s*<a href="developer/.test(s), `${f} writes no menu of its own`);
  }
  const listed = Nav.PAGES.map((p) => p.href);
  ok(gated.every((f) => listed.includes(f)), 'the menu lists every gated page');
  ok(listed.every((h) => existsSync(join(ROOT, h))), 'every menu entry exists');
  ok(/aria-current="page"[^>]*>Jurisdiction reports/.test(Nav.html('/developer-whitepaper.html')), 'the old white paper address marks the reports entry');
  ok(Nav.html('/developer.html').includes('<a href="dossiers/">Dossiers</a>'), 'the menu links the private dossier list');
}

// ---- 10. Codex review of #2232: multi-county cities, income universes, blank cells.
{
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Aurora spans Arapahoe, Adams and Douglas; every Aurora property is listed, whatever its county.
  const aurora = src.properties.properties.filter((p) => norm(p.city) === 'aurora');
  const counties = new Set(aurora.map((p) => p.county_fips));
  const am = WP.buildModel(src, '0804000', { FundingFit });
  ok(counties.size > 1 && am.inventory.properties.length === aurora.length, `Aurora lists all ${aurora.length} of its properties across ${counties.size} counties`);
  // Shares of a binned table add to 100% of that table's own households, for every place with a profile.
  let scanned = 0;
  for (const r of src.rankingIndex.rankings) {
    if (!existsSync(join(ROOT, WP.summaryPath(r.geoid)))) continue;
    const sum = JSON.parse(read(WP.summaryPath(r.geoid)));
    const inc = WP.buildModel(src, r.geoid, { FundingFit, summary: sum }).community?.people?.income;
    if (!inc || inc.some((b) => b.count === null) || inc.every((b) => b.count === 0)) continue;
    scanned++;
    const total = inc.reduce((s, b) => s + b.pct, 0);
    assert.ok(Math.abs(total - 100) < 0.5, `${r.name}: income shares add to ${total.toFixed(1)}%`);
  }
  ok(scanned > 400, `income shares add to 100% for all ${scanned} places with a full income table`);
  // A missing unit count, year or market figure prints Not available, never a blank cell.
  const s2 = clone(src);
  s2.properties.properties.push({ property_id: 'test:1', property_name: 'Test Absent Units', city: 'Gunnison', county_fips: '08051', program_type: ['hud-multifamily'], total_units: null });
  const h2 = WP.renderHtml(WP.buildModel(s2, '0833640', { FundingFit }));
  ok(/Test Absent Units<\/td><td>Gunnison<\/td><td>HUD assisted<\/td><td class="n">Not available<\/td><td>Not available<\/td>/.test(h2), 'a property with no unit count or year prints Not available in both cells');
  const gm = WP.buildModel(src, '0833640', { FundingFit });
  const hasNullCell = (gm.market || []).some((x) => ['studio', 'br1', 'br2', 'br3', 'all'].some((k) => x[k] === null || x[k] === undefined));
  const gh = WP.renderHtml(gm);
  ok(hasNullCell && !/<td class="n"><\/td>/.test(gh), 'market rents the source does not publish print Not available, not a blank cell');
}

// ---- 11. Research stands in across levels: a county with none of its own shows its
// towns' researched contacts and landscape, labelled; a town borrows its county's.
{
  const cityContacts = clone(FIXTURE_CONTACTS);
  const cityLand = clone(FIXTURE_LANDSCAPE);
  ok(!existsSync(join(ROOT, WP.contactsPath('08051'))), 'Gunnison County has no contacts file of its own (the case paul hit)');
  ok(WP.relatedGeoids(src, '08051').includes('0833640') && WP.relatedGeoids(src, '0833640')[0] === '08051', 'related places: county to towns, town to county');
  const cm = WP.buildModel(src, '08051', { FundingFit, relatedContacts: [cityContacts], relatedLandscape: [cityLand] });
  const ch = WP.renderHtml(cm);
  ok(cm.contacts.related.length === 1 && cm.contacts.related[0].contacts.length === cityContacts.contacts.length && !cm.contacts.needsResearch, 'the county report carries every researched City of Gunnison contact');
  ok(ch.includes('Researched for City of Gunnison</h3>') && cityContacts.contacts.every((c) => ch.includes(c.name)) && !ch.includes('No named contacts have been researched'), 'the county report prints them under their own heading, not the not-researched note');
  ok(cm.landscape.research && cm.landscape.research.placeLevel && /Researched for Gunnison \(city\), a town in this county/.test(ch), 'the county report uses the town landscape and says whose it is');
  // A file for a place outside the county never stands in.
  const denver = clone(cityContacts); denver.geoid = '0820000';
  ok(WP.buildModel(src, '08051', { FundingFit, relatedContacts: [denver] }).contacts.related.length === 0, 'sabotage: another county\'s town file is ignored');
  // A town borrows its county's file.
  const county = clone(cityContacts); county.geoid = '08051'; county.name = 'Gunnison County';
  const cb = WP.buildModel(src, '0818310', { FundingFit, relatedContacts: [county] });
  ok(WP.relatedGeoids(src, '0818310')[0] === '08051' && cb.contacts.related.length === 1 && /researched for its county/.test(WP.renderHtml(cb)), 'a town with no file shows its county\'s researched contacts');
  // The town's own file still wins over related ones.
  const own = WP.buildModel(src, '0833640', { FundingFit, contacts: cityContacts, relatedContacts: [] });
  ok(own.contacts.researched.length === cityContacts.contacts.length && own.contacts.related.length === 0, 'a place with its own contacts shows them first');
}

// ---- 12. The old brief's "Local housing leadership" lists reach the report: offices,
// plans and partners from local-resources.json, the place's and its county's, every one.
{
  const res = JSON.parse(read('data/hna/local-resources.json'));
  let scanned = 0;
  for (const row of src.rankingIndex.rankings) {
    const keys = row.type === 'county' ? ['county:' + row.geoid] : ['place:' + row.geoid, 'county:' + row.containingCounty];
    const want = (k) => [...new Set(keys.flatMap((key) => ((res[key] || {})[k] || []).filter((x) => x && x.name).map((x) => x.name.toLowerCase())))];
    const plans = want('housingPlans'), partners = want('advocacy'), offices = want('contacts');
    if (!plans.length && !partners.length && !offices.length) continue;
    scanned++;
    const C = WP.buildModel(src, row.geoid, { FundingFit, localResources: res }).contacts;
    ok(C.plans.length === plans.length && C.partners.length === partners.length && C.offices.length === offices.length,
      `${row.geoid}: every plan, partner and office in local-resources.json reaches the report`);
  }
  ok(scanned > 50, `the scan found places with plans, partners or offices (${scanned})`);
  // An office known only by a search link prints without a link, and the search link never appears.
  const mesa = WP.buildModel(src, '08077', { FundingFit, localResources: res });
  const mh = WP.renderHtml(mesa);
  const searchOnly = (res['county:08077'].contacts || []).filter((c) => /google\.[a-z.]+\/search/.test(c.url));
  ok(searchOnly.length > 0 && searchOnly.every((c) => mh.includes(c.name)) && !/google\.[a-z.]+\/search/.test(mh), 'an office with only a search link is named, unlinked');
  ok(mh.includes('Plans and assessments on file') && res['county:08077'].housingPlans.every((p) => mh.includes(p.name)), 'Mesa County prints its plans');
  // Sabotage: drop the lists from the data and they vanish from the model.
  const bare = clone(res); delete bare['county:08077'].housingPlans; delete bare['county:08077'].advocacy;
  const mb = WP.buildModel(src, '08077', { FundingFit, localResources: bare }).contacts;
  ok(mb.plans.length < mesa.contacts.plans.length && mb.partners.length < mesa.contacts.partners.length, 'sabotage: the lists come from the data, not the template');
}

// ---- Contacts read on a phone: one card per person, phone and email as links.
{
  const fx = { geoid: '0833640', name: 'Gunnison', checked: '2026-10-01', contacts: [
    { name: 'Test Person', role: 'Planning Director', org: 'City of Gunnison', email: 'tp@example.org', phone: '970-555-0100 (front desk)', source_label: 'Staff page', source_url: 'https://example.org/staff', source_quote: 'Planning Director Test Person 970-555-0100' }
  ] };
  const h = WP.renderHtml(WP.buildModel(src, '0833640', { FundingFit, contacts: fx, relatedContacts: [] }));
  const who = h.slice(h.indexOf('id="contacts"'));
  ok(who.includes('<table class="wp-stack">') && /table\.wp-stack thead\{display:none\}/.test(h), 'the contacts table stacks into cards on a phone');
  ok(who.includes('<td data-label="Contact"><a href="mailto:tp@example.org">') && who.includes('<a href="tel:9705550100">970-555-0100 (front desk)</a>'), 'email and phone are tappable links');
  ok(/@media screen and \(max-width:560px\)\{\.wp table\.wp-stack/.test(h), 'the stacking is for screens only, so the PDF keeps the table');
  const brief = read('developer-brief.html');
  ok(/function publicFill\(rows, researched\)/.test(brief) && brief.includes('networkTable(mine.own.network, researched)') && brief.includes('(public record'),
    'a network contact with no phone or email borrows the researched one for the same person, marked as public record');
}

// ---- Deal shape reads the whole range of need, not only the homes-short counts.
{
  const BANDS = ['31to50', '51to80', '81to100'];
  for (const g of ['0833640', '0820000', '08045']) {
    const m = WP.buildModel(src, g, { FundingFit, MixCheck, today: '2026-10-18' });
    const rec = g.length === 5 ? src.countyChas.records.find((r) => r.fips === g) : src.placeChas.places[g];
    for (const k of BANDS) {
      const b = rec.renter_hh_by_ami[k];
      const want = Math.round(b.total * b.pct_cost_burdened_30);
      ok(m.deal.burden && m.deal.burden[k] && m.deal.burden[k].burdened === want, `${g} ${k}: burdened renters must equal CHAS total × burden share (${want})`);
    }
    const html = WP.renderHtml(m);
    ok(html.includes('Paying over 30% of income'), `${g}: the deal shape must show cost burden by band`);
    const n = m.need.need20yr;
    ok(n === null || m.deal.notes.some((x) => x.includes('20-year need (' + fmt(n) + ' homes) is one total')), `${g}: the 20-year need must be named as unsplit by income`);
  }
  // Gunnison: 0 short at 60% AMI but most 31–50% renters burdened, rural resort county.
  const gm = WP.buildModel(src, '0833640', { FundingFit, MixCheck, today: '2026-10-18' });
  ok(gm.deal.mix.le60 === 0 && gm.deal.notes.some((x) => /at 31–50% AMI .* pay more than 30% of income, though only/.test(x)),
    'a band counted 0 short whose renters are burdened must be called real need');
  ok(gm.deal.workforce && gm.deal.workforce.ruralResort && /Middle-income Housing Tax Credit/.test(gm.deal.notes.join(' ')),
    'a rural resort county must get the middle-income (80–120% AMI) lane');
  ok(gm.deal.notes.some((x) => /51–80% AMI .*Income averaging allows 70% and 80% AMI units/.test(x)), 'burdened 51–80% renters must raise income averaging');
  // Sabotage: with no burden at 31–80% the new notes must not fire.
  const quiet = clone(src);
  for (const k of BANDS) quiet.placeChas.places['0833640'].renter_hh_by_ami[k].pct_cost_burdened_30 = 0;
  const qm = WP.buildModel(quiet, '0833640', { FundingFit, MixCheck, today: '2026-10-18' });
  ok(!qm.deal.notes.some((x) => /pay more than 30% of income/.test(x)), 'with no burdened renters above 30% AMI no band note may fire');
  ok(qm.deal.workforce && qm.deal.workforce.burdened === 0, 'a rural resort county keeps the workforce lane even without 81–100% burden');
  // Pencil table: one row per CHFA tier, from the county's limits and CHFA's quoted assumptions.
  const lim = src.rentLimits.counties.find((c) => c.fips === '08051');
  ok(gm.deal.pencil.ok && gm.deal.pencil.tiers.length >= 4 && gm.deal.pencil.tiers.every((t) => t.rent === lim.regular_tiers[t.tier].max_rents['2br']),
    'the pencil table must price each tier at the county\'s CHFA two-bedroom limit');
  const gh = WP.renderHtml(gm);
  ok(gh.includes('Does each rent level pay its way?') && gh.includes('$4,500 operating cost'), 'the pencil table and its CHFA assumptions must print');
  const noRules = clone(src); delete noRules.underwritingRules;
  const nr = WP.buildModel(noRules, '0833640', { FundingFit, MixCheck, today: '2026-10-18' });
  ok(!nr.deal.pencil.ok && /not on file/.test(WP.renderHtml(nr)), 'without the CHFA underwriting rules the pencil table must say why it is missing, not print zeros');
}

console.log(`jurisdiction-whitepaper: ${checks} checks passed`);
