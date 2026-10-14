#!/usr/bin/env node
/**
 * Contract for the jurisdiction white paper (js/whitepaper/jurisdiction-whitepaper.js,
 * scripts/whitepaper/build-whitepaper.mjs, developer-whitepaper.html).
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

// ---- 5. Contacts: researched ones quote their source; search links never show.
{
  const dir = join(ROOT, 'data/jurisdiction-briefs/_contacts');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  ok(files.length >= 1, 'at least one researched contacts file');
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.equal(c.geoid + '.json', f, `${f}: geoid must match the file name`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.checked), `${f}: checked date`);
    for (const p of c.contacts) {
      assert.ok(p.name && /^https:\/\//.test(p.source_url) && p.source_quote && p.source_quote.length > 15, `${f}: ${p.name} needs a source URL and quote`);
      assert.ok(!WP._internal.isSearchLink(p.source_url), `${f}: ${p.name} cites a search page`);
    }
    const m = WP.buildModel(src, c.geoid, { FundingFit, contacts: c });
    ok(m.contacts.researched.length === c.contacts.length, `${f}: every contact reaches the paper`);
  }
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
  const page = read('developer-whitepaper.html');
  const i = (s) => page.indexOf(s);
  ok(i('js/developer-gate.js') > -1 && i('js/developer-gate.js') < i('js/whitepaper/jurisdiction-whitepaper.js'), 'the gate loads before the generator');
  ok(i('js/funding-fit.js') > -1 && i('js/funding-fit.js') < i('JurisdictionWhitepaper;'), 'the matcher loads before the page script');
  ok(/isSensitive: isSensitive/.test(page) && /isSensitive\(html\)/.test(page), 'the page passes the guard to buildModel and checks the finished HTML');
  ok(/did not load, so nothing was built/.test(page), 'the page refuses to build without the guard');
  for (const k of Object.keys(WP.SOURCE_FILES)) {
    if (!WP.isOptional(k)) ok(existsSync(join(ROOT, WP.sourcePath(k))), `${WP.sourcePath(k)} exists`);
  }
}

// ---- 7. Local landscape and deal dynamics agree with their files.
{
  const dir = join(ROOT, 'data/jurisdiction-briefs/_landscape');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  ok(files.length >= 1, 'at least one researched landscape file');
  for (const f of files) {
    const L = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.equal(L.geoid + '.json', f, `${f}: geoid must match the file name`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(L.researched), `${f}: researched date`);
    let entries = 0;
    for (const [key] of [['plans'], ['agencies'], ['state_funds'], ['task_forces'], ['people'], ['land'], ['lihtc_and_pipeline']]) {
      for (const e of L[key] || []) {
        entries++;
        assert.ok(/^https:\/\//.test(e.source_url) && e.source_quote && e.source_quote.length > 15, `${f}: ${key} entry needs a source URL and quote`);
        assert.ok(!WP._internal.isSearchLink(e.source_url), `${f}: ${key} entry cites a search page`);
      }
    }
    const m = WP.buildModel(src, L.geoid, { FundingFit, landscape: L, isSensitive });
    const shown = m.landscape.research.groups.reduce((n, g) => n + g.items.length, 0);
    ok(shown === entries && entries > 0, `${f}: every sourced entry reaches the paper`);
    ok(!isSensitive(WP.renderHtml(m)), `${f}: the paper passes the private-text guard`);
  }
  // Sabotage: an unsourced entry and the owner's project never print.
  const fake = { geoid: '0833640', researched: '2026-10-14', land: [{ name: 'Unsourced lot', acres: 5 }], lihtc_and_pipeline: [{ name: 'Fruita Mews Phase II', units: 40, source_url: 'https://example.org/x', source_quote: 'a quote long enough to pass the check' }] };
  const fm = WP.buildModel(src, '0833640', { FundingFit, landscape: fake });
  ok(fm.landscape.research.groups.every((g) => g.items.length === 0), 'sabotage: unsourced and excluded entries are dropped');
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
  ok(g.dynamics.equity9 === src.equityPricing.pricing.national_avg.credit_9pct, '9% equity price equals the Novogradac file');
  const noPab = clone(src); noPab.pab = null;
  ok(WP.buildModel(noPab, '0833640', { FundingFit }).dynamics.pab.length === 0, 'missing bond file: no allocation printed');
  const wa = WP.buildModel(src, '0833640', { FundingFit }).dynamics.localMoney;
  ok(wa.some((w) => /Land Banking/.test(w.program)), 'the Gunnison land-banking award reaches the landscape (non-vacuity)');
  const page = read('developer-whitepaper.html');
  ok(/WP\.landscapePath\(row\.geoid\)/.test(page) && /WP\.landscapePath\(row\.containingCounty\)/.test(page) && /landscape: extra\[3\]/.test(page), 'the page loads the town file, falls back to the county, and passes it on');
}

console.log(`jurisdiction-whitepaper: ${checks} checks passed`);
