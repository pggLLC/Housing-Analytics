// test/agency-funding.test.mjs — the award view (js/agency-funding-model.js,
// js/agency-funding.js) and the files it reads.
//
// Each check pins an agreement, not a wording:
//   - every ledger award has its printed row in award-rows.json, under the key
//     both the Python reader and the page compute, so a ledger rebuilt without
//     the reader fails here rather than showing stale names;
//   - a quote carries the ledger's own amount, so a row matched to the wrong
//     award fails;
//   - tax credits and dollars are never added together;
//   - held-back rows and guard-blocked text never appear;
//   - the page's "About this data" names every award file the page reads.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = require(path.join(ROOT, 'js/agency-funding-model.js'));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

let failures = 0;
function ok(cond, msg) {
  if (!cond) { failures += 1; console.error('  FAIL ' + msg); }
}

const D = 'data/policy/funding-awards/';
const ledger = json(D + 'ledger.json');
const documents = json(D + 'documents.json');
const rows = json(D + 'award-rows.json');
const dola = json(D + 'dola-awards.json');
const aliases = json(D + 'developer-aliases.json');
const geo = json('data/boundaries/counties_co.geojson');
const demo = json('data/co-county-demographics.json').counties;
const counties = {};
geo.features.forEach((f) => { counties[f.properties.GEOID] = { name: f.properties.NAME, population: demo[f.properties.NAME] && demo[f.properties.NAME].population }; });

console.log('agency-funding');

// ── award-rows.json agrees with the ledger ──────────────────────────────────
const keys = M.ledgerKeys(ledger.awards);
ok(new Set(keys).size === keys.length, 'ledger keys are unique');
const byKey = new Map(rows.rows.map((r) => [r.key, r]));
ok(rows.rows.length > 0, 'award-rows.json has rows (scan found something to check)');
const missing = keys.filter((k) => !byKey.has(k) && !(rows.unmatched || []).some((u) => u.key === k));
ok(missing.length === 0, `every ledger award has a printed row or an unmatched reason; missing ${missing.length}, e.g. ${missing[0]} ` +
  '(run python3 scripts/funding/build_award_rows.py)');
const orphans = rows.rows.filter((r) => !keys.includes(r.key));
ok(orphans.length === 0, `award-rows.json has no row for an award the ledger no longer has; found ${orphans.length}, e.g. ${orphans[0] && orphans[0].key}`);

const money = (n) => '$' + Number(n).toLocaleString('en-US');
let quoted = 0;
ledger.awards.forEach((r, i) => {
  const row = byKey.get(keys[i]);
  if (!row || !row.quote) return;
  const amount = [r.amount_awarded, r.amount_requested, r.federal_credit, r.mihtc_credit].find((v) => v !== null && v !== undefined);
  if (amount === undefined) return;
  quoted += 1;
  ok(row.quote.includes(money(amount)), `${keys[i]}: the quote does not print the ledger amount ${money(amount)}`);
});
ok(quoted > 300, `quotes carrying an amount were checked (${quoted})`);

// Every DOLA amount is printed in its quote ("$3,250,000", "$3.25 million", "$650 thousand").
function amountsIn(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(million|thousand|m\b|k\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toLowerCase();
    found.add(Math.round(unit.startsWith('m') ? n * 1e6 : unit.startsWith('t') || unit === 'k' ? n * 1e3 : n));
  }
  return found;
}
let dolaChecked = 0;
dola.awards.forEach((a) => {
  if (a.amount === null || a.amount === undefined) return;
  dolaChecked += 1;
  ok(amountsIn(a.quote).has(Math.round(a.amount)), `DOLA ${a.name}: the quote does not print ${a.amount}`);
  ok(a.source_url && a.announced, `DOLA ${a.name}: has a source link and a date`);
});
ok(dolaChecked > 200, `DOLA amounts were checked against their quotes (${dolaChecked})`);

// One DOLA award reported by several sources (vote summary, release, table row)
// is counted once: no two awards share a project, an amount (within release
// rounding), and a year, from different sources.
const SUB = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', apartments: '', apartment: '', the: '', phase: 'ph', and: '' };
const toks = (t) => new Set((String(t || '').toLowerCase().match(/[a-z0-9]+/g) || []).map((w) => (w in SUB ? SUB[w] : w)).filter(Boolean));
const repeats = [];
dola.awards.forEach((a, i) => dola.awards.slice(i + 1).forEach((b) => {
  const ta = toks(a.name), tb = toks(b.name);
  if (!ta.size || !tb.size || a.amount == null || b.amount == null || a.source_url === b.source_url) return;
  const shared = [...ta].filter((w) => tb.has(w)).length;
  if (shared / Math.min(ta.size, tb.size) < 0.67) return;
  if (Math.abs(a.amount - b.amount) > 0.02 * Math.max(a.amount, b.amount)) return;
  if (a.year && b.year && Math.abs(a.year - b.year) > 1) return;
  if (a.homes && b.homes && a.homes !== b.homes) return;
  if (a.grantee && b.grantee && a.grantee !== b.grantee && !(a.homes && a.homes === b.homes) && shared / new Set([...ta, ...tb]).size < 0.6) return;
  repeats.push(`${a.id} / ${b.id} (${a.name})`);
}));
ok(repeats.length === 0, `each DOLA award is counted once; repeated: ${repeats.slice(0, 3).join('; ')}`);
const merged = dola.awards.filter((a) => (a.also_reported || []).length);
ok(merged.length > 0 && merged.every((a) => a.also_reported.every((x) => x.source_url && x.quote)), 'a merged award keeps every other source and its quote');

// A county read from the town only when the town lies wholly in one county.
const crossTowns = new Set(Object.values(json('data/hna/cross-county-places.json').places)
  .map((p) => p.name.replace(/\s*\((city|town|cdp|city and county)\)\s*$/i, '').toLowerCase()));
ok(crossTowns.has('longmont'), 'read the towns that straddle counties');
const straddled = dola.awards.filter((a) => a.county_fips && /^town as printed/.test(a.county_method || '') && crossTowns.has(String(a.town || '').toLowerCase()));
ok(straddled.length === 0, `no award is mapped to one county from a town in several; found ${straddled.map((a) => a.name).join(', ')}`);

// ── guard-blocked text and held-back rows ───────────────────────────────────
// A row the public lists hold back (encoded so the fixture names nothing).
const HELD = Buffer.from('RnJ1aXRhIE1ld3MgUGhhc2UgSUk=', 'base64').toString();
const HELD2 = Buffer.from('RnJ1aXRhIE1ld3MgUGhhc2UgMg==', 'base64').toString();
const patterns = [...read('scripts/lib/public-sensitive-patterns.mjs').matchAll(/regex:\s*\/((?:\\\/|[^/])+)\/([a-z]*)/g)]
  .map((m) => new RegExp(m[1], m[2].includes('i') ? 'i' : ''));
ok(patterns.length > 0, 'read the public-artifact guard patterns');
const publicText = [read(D + 'award-rows.json'), read(D + 'developer-aliases.json'), read(D + 'dola-awards.json')].join('\n');
patterns.forEach((p) => ok(!p.test(publicText), `the award files contain text the public build refuses: ${p}`));

const awards = M.normalise({ ledger, documents, rows, dola, aliases, counties });
ok(awards.length > 0, 'normalise produced awards');
ok(!awards.some((a) => M.isExcluded(a.name)), 'held-back rows are excluded');
const planted = M.normalise({
  ledger: { meta: {}, awards: [{ agency: 'CHFA', program: 'LIHTC 9% + state', year: 2026, name: HELD, source_file: 'x.pdf', federal_credit: 1, restricted_units: 1, county_fips: '08077' }] },
  documents, rows: { rows: [] }, dola: { awards: [{ name: HELD2, amount: 5, county_fips: '08077' }] }, aliases, counties,
});
ok(planted.length === 0, 'a planted held-back row (ledger or DOLA) is excluded');

// ── units: credits and dollars stay apart ───────────────────────────────────
const s = M.summarise(awards);
const chfa = awards.filter((a) => a.agency === 'CHFA');
ok(chfa.length > 0 && chfa.every((a) => a.dollars === null), 'CHFA awards carry credits, never dollars');
ok(awards.filter((a) => a.agency !== 'CHFA').every((a) => a.credits === null), 'OEDIT and DOLA awards carry dollars, never credits');
ok(M.measureOf(s, 'ALL') === s.homes, 'all three agencies together are measured in homes');
ok(M.measureOf(s, 'CHFA') === s.credits && M.measureOf(s, 'OEDIT') === s.dollars, 'one agency is measured in its own unit');
const sumDollars = awards.reduce((t, a) => t + (a.dollars || 0), 0);
ok(s.dollars === sumDollars, 'summarised dollars equal the sum of award dollars (no credits mixed in)');
// Bonds (a loan to the project) stay apart from credits and dollars.
ok(awards.filter((a) => a.agency !== 'CHFA').every((a) => a.bonds === null), 'only CHFA 4% awards carry bonds');
ok(chfa.filter((a) => a.bonds).every((a) => /4%/.test(a.program)), 'bonds appear only on 4% awards');
const ledgerBonds = ledger.awards.reduce((t, r) => t + (M.agencyOf(r.agency) === 'CHFA' && !M.isExcluded(r.name) ? (r.bond_amount || 0) : 0), 0);
ok(s.bonds === ledgerBonds && s.bonds > 0, `summarised bonds equal the ledger's bond amounts (${s.bonds} vs ${ledgerBonds})`);
// Prop 123 money splits by program and the parts add back to OEDIT's dollars.
const oedit = awards.filter((a) => a.agency === 'OEDIT');
ok(oedit.every((a) => a.oeditKind), 'every Prop 123 award has a program type (loans, equity, land, modular)');
const kinds = s.byAgency.OEDIT.byKind;
ok(Object.values(kinds).reduce((t, v) => t + v, 0) === s.byAgency.OEDIT.dollars, 'Prop 123 program columns add back to OEDIT dollars');
ok(kinds.loans > 0 && kinds.equity > 0 && kinds.land > 0, 'loans, equity and land banking each have money');
ok(M.perResident(100, 0) === null && M.perResident(null, 10) === null, 'per resident is null, not 0, with no population or no value');

// ── flow diagram: program to region, in homes ───────────────────────────────
const regionOf = Object.fromEntries(json('data/derived/funding-vs-need.json').counties.map((c) => [c.fips, c.region]));
ok(Object.keys(regionOf).length === 64, 'the flow reads a region for each of the 64 counties');
const fl = M.flows(awards, regionOf);
const drawn = awards.filter((a) => a.homes !== null && a.homes > 0);
const sum = (xs) => xs.reduce((t, x) => t + x.homes, 0);
ok(fl.homes === sum(drawn) && fl.homes === s.homes, 'the flow draws every home the awards name, and the answer sentence counts the same total');
ok(sum(fl.left) === fl.homes && sum(fl.right) === fl.homes && sum(fl.links) === fl.homes, 'each column and the bands add to the same homes');
ok(fl.withoutHomes === awards.length - drawn.length, 'awards with no home count are counted as left out, not dropped silently');
ok(fl.left.every((n) => n.agency in M.AGENCIES), 'every program node belongs to an agency');
ok(drawn.every((a) => M.programOf(a) !== null), 'every drawn award falls in a program group');
ok(M.programOf({ agency: 'DOLA', program: 'HOME (federal)' }).key === 'dola-federal', 'HOME (federal) is a federal grant, not a homeownership program');
ok(M.programOf({ agency: 'DOLA', program: 'Prop 123 homeownership (AHOP)' }).key === 'dola-123', 'AHOP is the Prop 123 support fund');
ok(M.programOf({ agency: 'DOLA', program: 'DLG incentive grant (HB21-1271)' }).key === 'dola-local', 'a Division of Local Government grant is not a Division of Housing program');
const boulder = M.flows([{ agency: 'CHFA', program: 'LIHTC 9% + state', homes: 10, countyFips: '08013' }, { agency: 'OEDIT', program: 'Prop 123 Modular Finance', homes: 5, countyFips: null }], regionOf);
ok(boulder.right.map((r) => r.key).join() === 'Front Range,_none', 'a county lands in its region and no county lands in "No single county printed", last');

// ── developer names ─────────────────────────────────────────────────────────
ok(M.developerKey('Gorman & Company, LLC') === M.developerKey('Gorman & Company'), 'a legal suffix does not split a developer');
ok(M.developerKey('Gorman & Company') !== M.developerKey('Gorman'), 'only a trailing legal form is dropped');
Object.entries(aliases.developers).forEach(([k, v]) => {
  ok(v.reason && v.reason.length > 10, `alias ${k} says why the names are one organisation`);
  ok(aliases.developers[v.key] && aliases.developers[v.key].key === v.key, `alias ${k} points at a key that is its own entry`);
});
ok(!awards.some((a) => a.developer && /^\d+$/.test(a.developer)), 'no developer is a bare number (a split cell)');
const owners = awards.filter((a) => a.developerRole === 'owner');
ok(owners.length > 0 && owners.every((a) => /owner/i.test((rows.rows.find((r) => r.quote === a.quote) || {}).sponsor_heading || '')),
  'a name read from an owner column is marked as an owner, and only then');
ok(/developerRole === 'owner'[\s\S]{0,80}owner as printed/.test(read('js/agency-funding.js')), 'the table tags an owner as printed');

// ── the page that holds the view ────────────────────────────────────────────
const PAGE = 'where-housing-money-goes.html';
const html = read(PAGE);
const js = read('js/agency-funding.js');
ok(/<script[^>]+src="js\/vendor\/d3\.v7\.min\.js"/.test(html) && /<script[^>]+src="js\/agency-funding-model\.js"/.test(html) && /<script[^>]+src="js\/agency-funding\.js"/.test(html),
  'the page loads d3, the model and the view');
ok(/<link[^>]+css\/agency-funding\.css/.test(html), 'the page loads the view stylesheet');
const holder = (html.match(/<article[^>]*data-agency-funding[\s\S]*?<\/article>/) || [''])[0];
ok(/data-agency-funding-view/.test(holder), 'the page holds the view');
ok(!/data-agency-funding-(defer|hash)/.test(holder), 'the page starts the view on load and owns its whole hash');
ok(/if \(perOk\) return g\.population \?[^;]*: NO_POP;/.test(js) && /perOk \? \(g\.population \?[^;]*: null\)/.test(js),
  'per resident without a population is shown as unavailable, never as the total');

// One name everywhere: every link to the page uses the page's own <h1>.
const h1 = ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').trim();
ok(h1.length > 10, 'found the page <h1>');
ok(new RegExp(`<title>${h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`).test(html), 'the <title> starts with the <h1>');
const nav = read('js/navigation.js');
const navLabel = (nav.match(/\{\s*label:\s*"([^"]+)",\s*href:\s*"where-housing-money-goes\.html"/) || [])[1];
ok(navLabel === h1, `the menu label (${navLabel}) is the page <h1> (${h1})`);
const unq = (s) => s.replace(/\\'/g, "'");
const linkers = ['colorado-deep-dive.html', 'sitemap.html', 'js/whitepaper/jurisdiction-whitepaper.js'];
linkers.forEach((f) => {
  const src = unq(read(f));
  // Plain links, sitemap cards (named by their site-card-name) and the report's built link.
  const anchors = [...src.matchAll(/<a\s[^>]*href="where-housing-money-goes\.html[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
  const built = [...src.matchAll(/esc\(F\.awardsHref\) \+ '">([^<]+)<\/a>/g)].map((m) => m[1]);
  const names = anchors.map((a) => ((a.match(/site-card-name">([^<]+)</) || [])[1] || a.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .concat(built.map((t) => t.trim()));
  ok(names.length >= 1 && names.every((t) => t === h1), `${f} links to the page by its name (${names.join(' | ') || 'no link'})`);
});
const report = read('js/whitepaper/jurisdiction-whitepaper.js');
ok(/'https:\/\/cohoanalytics\.com\/where-housing-money-goes\.html#county=' \+ county/.test(report) && /k === 'county'/.test(js),
  'the Jurisdiction Report opens the page on its county, a key the view reads');
const deep = read('colorado-deep-dive.html');
ok(!/data-agency-funding/.test(deep) && !/agency-funding\.js/.test(deep), 'Colorado Deep Dive links to the page instead of holding a second copy');
ok(/parts\[0\] === 'tab-need' && parts\.length > 1\)[\s\S]{0,80}location\.replace\('where-housing-money-goes\.html#' \+ parts\.slice\(1\)\.join\('&'\)\)/.test(deep),
  'links shared while the view was in the tab (#tab-need&county=…) go to the page with their search');
const files = [...js.matchAll(/'(data\/[^']+\.(?:json|geojson))'/g)].map((m) => m[1]);
ok(files.length >= 5, 'found the data files the view reads');
const about = (js.match(/<details class=\\"hm-about\\"[\s\S]*?<\/details>/) || [''])[0];
files.filter((f) => !/boundaries|documents|award-rows|developer-aliases/.test(f))
  .forEach((f) => ok(about.includes(f), `"About this data" names ${f}, which the page reads`));
files.forEach((f) => ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`));
ok(about.includes('scripts/funding/build_funding_awards.py'), '"About this data" names the parser behind the ledger');
ok(about.length > 500, 'found "About this data" in the view');
const beforeAnswer = html.slice(html.indexOf('<main'), html.indexOf('data-agency-funding-view')) + js.slice(js.indexOf('var MARKUP'), js.indexOf('data-hm-answer'));
ok(!/Screening tool only|disclaimer|informational only/i.test(beforeAnswer), 'no warning sits above the answer');

if (failures) {
  console.error(`agency-funding: ${failures} failed`);
  process.exit(1);
}
console.log('agency-funding: PASS');
