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
//   - the owner's own project and guard-blocked text never appear;
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

// ── guard-blocked text and the owner's own project ──────────────────────────
const patterns = [...read('scripts/lib/public-sensitive-patterns.mjs').matchAll(/regex:\s*\/((?:\\\/|[^/])+)\/([a-z]*)/g)]
  .map((m) => new RegExp(m[1], m[2].includes('i') ? 'i' : ''));
ok(patterns.length > 0, 'read the public-artifact guard patterns');
const publicText = [read(D + 'award-rows.json'), read(D + 'developer-aliases.json'), read(D + 'dola-awards.json')].join('\n');
patterns.forEach((p) => ok(!p.test(publicText), `the award files contain text the public build refuses: ${p}`));

const awards = M.normalise({ ledger, documents, rows, dola, aliases, counties });
ok(awards.length > 0, 'normalise produced awards');
ok(!awards.some((a) => /fruita mews (phase )?(ii|2)\b/i.test(a.name || '')), "the owner's own project is excluded");
const planted = M.normalise({
  ledger: { meta: {}, awards: [{ agency: 'CHFA', program: 'LIHTC 9% + state', year: 2026, name: 'Fruita Mews Phase II', source_file: 'x.pdf', federal_credit: 1, restricted_units: 1, county_fips: '08077' }] },
  documents, rows: { rows: [] }, dola: { awards: [{ name: 'Fruita Mews Phase 2', amount: 5, county_fips: '08077' }] }, aliases, counties,
});
ok(planted.length === 0, "a planted 'Fruita Mews Phase II' (ledger or DOLA) is excluded");

// ── units: credits and dollars stay apart ───────────────────────────────────
const s = M.summarise(awards);
const chfa = awards.filter((a) => a.agency === 'CHFA');
ok(chfa.length > 0 && chfa.every((a) => a.dollars === null), 'CHFA awards carry credits, never dollars');
ok(awards.filter((a) => a.agency !== 'CHFA').every((a) => a.credits === null), 'OEDIT and DOLA awards carry dollars, never credits');
ok(M.measureOf(s, 'ALL') === s.homes, 'all three agencies together are measured in homes');
ok(M.measureOf(s, 'CHFA') === s.credits && M.measureOf(s, 'OEDIT') === s.dollars, 'one agency is measured in its own unit');
const sumDollars = awards.reduce((t, a) => t + (a.dollars || 0), 0);
ok(s.dollars === sumDollars, 'summarised dollars equal the sum of award dollars (no credits mixed in)');
ok(M.perResident(100, 0) === null && M.perResident(null, 10) === null, 'per resident is null, not 0, with no population or no value');

// ── developer names ─────────────────────────────────────────────────────────
ok(M.developerKey('Gorman & Company, LLC') === M.developerKey('Gorman & Company'), 'a legal suffix does not split a developer');
ok(M.developerKey('Gorman & Company') !== M.developerKey('Gorman'), 'only a trailing legal form is dropped');
Object.entries(aliases.developers).forEach(([k, v]) => {
  ok(v.reason && v.reason.length > 10, `alias ${k} says why the names are one organisation`);
  ok(aliases.developers[v.key] && aliases.developers[v.key].key === v.key, `alias ${k} points at a key that is its own entry`);
});
ok(!awards.some((a) => a.developer && /^\d+$/.test(a.developer)), 'no developer is a bare number (a split cell)');

// ── the page that holds the view ────────────────────────────────────────────
// Colorado Deep Dive's Funding vs Need tab, until the reorg gives it a page.
const html = read('colorado-deep-dive.html');
const js = read('js/agency-funding.js');
ok(/<script[^>]+src="js\/vendor\/d3\.v7\.min\.js"/.test(html) && /<script[^>]+src="js\/agency-funding-model\.js"/.test(html) && /<script[^>]+src="js\/agency-funding\.js"/.test(html),
  'the page loads d3, the model and the view');
ok(/<link[^>]+css\/agency-funding\.css/.test(html), 'the page loads the view stylesheet');
const holder = (html.match(/<section[^>]*data-agency-funding[\s\S]*?<\/section>/) || [''])[0];
ok(/data-agency-funding-view/.test(holder), 'the page holds the view');
const panel = html.slice(html.lastIndexOf('<div role="tabpanel"', html.indexOf(holder)), html.indexOf(holder));
const tabId = (panel.match(/id="([^"]+)"/) || [])[1];
ok(tabId && new RegExp(`data-agency-funding-hash="${tabId}"`).test(holder), `the view keeps its tab (${tabId}) first in the URL`);
ok(/data-agency-funding-defer/.test(holder) && new RegExp(`targetId === '${tabId}' && window\\.AgencyFunding\\)[\\s\\S]{0,80}AgencyFunding\\.start\\(\\)`).test(html),
  'the view loads when its tab opens, not with the page');
const level = Number((holder.match(/data-agency-funding-level="(\d)"/) || [])[1]);
const outer = Number((holder.match(/<h(\d)/) || [])[1]);
ok(level === outer + 1, `the view's headings (h${level}) sit under the section heading (h${outer})`);
ok(/\.split\('&'\)\[0\]/.test(html), 'the tab switcher reads only the tab name from #tab&county=…');
const files = [...js.matchAll(/'(data\/[^']+\.(?:json|geojson))'/g)].map((m) => m[1]);
ok(files.length >= 5, 'found the data files the view reads');
const about = (js.match(/<details class=\\"hm-about\\"[\s\S]*?<\/details>/) || [''])[0];
files.filter((f) => !/boundaries|documents|award-rows|developer-aliases/.test(f))
  .forEach((f) => ok(about.includes(f), `"About this data" names ${f}, which the page reads`));
files.forEach((f) => ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`));
ok(about.includes('scripts/funding/build_funding_awards.py'), '"About this data" names the parser behind the ledger');
ok(about.length > 500, 'found "About this data" in the view');
const beforeAnswer = holder.slice(0, holder.indexOf('data-agency-funding-view')) + js.slice(js.indexOf('var MARKUP'), js.indexOf('data-hm-answer'));
ok(!/Screening tool only|disclaimer|informational only/i.test(beforeAnswer), 'no warning sits above the answer');

if (failures) {
  console.error(`agency-funding: ${failures} failed`);
  process.exit(1);
}
console.log('agency-funding: PASS');
