// Where Should I Build? graphics (js/where-to-build-charts.js): the numbers behind each chart come from
// the scorer itself, so a chart can never disagree with the tiers beside it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../js/where-to-build.js');
const G = require('../js/where-to-build-charts.js');
let n = 0;
function ok(c, msg) { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } n++; }
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const docs = {
  ranking: json('data/hna/ranking-index.json'), prop123: json('data/policy/prop123_jurisdictions.json'),
  awards: json('data/policy/prop123-land-banking-awards.json'), lbStatus: json('data/policy/prop123-land-banking-status.json'),
  hud: json('data/hud-fmr-income-limits.json'), context: json('data/policy/where-to-build-context.json'),
  support: json('data/policy/local-support.json'), fees: json('data/policy/fee-reductions.json'),
  funds: json('data/policy/local-housing-funds.json'), coverage: json('data/policy/incentive-coverage.json'),
  commitment: json('data/policy/local-commitment.json'), jobs: json('data/policy/job-access.json'),
  commute: json('data/market/commute-strength.json')
};
const model = W.build(docs, '2026-11-04');
const weights = W.defaultWeights();
const rows = model.places.map((p) => ({ p, s: W.score(p, weights) })).sort((a, b) => b.s.score - a.s.score || a.p.name.localeCompare(b.p.name));

// Group split: segments add up to the base score (signals and flags are drawn separately).
for (const x of rows) {
  const sp = G.groupSplit(x.s);
  const sum = Object.values(sp).reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - x.s.base) < 0.2, `${x.p.name}: group segments sum to the base score (${sum.toFixed(1)} vs ${x.s.base})`);
  ok(Object.keys(sp).every((g) => Number(weights[g]) > 0 || sp[g] === 0), `${x.p.name}: a group at weight 0 earns nothing`);
}

// Rank range: one run per weighted group; the rank under full weights sits inside or near the range.
const top = rows.slice(0, 20).map((x) => x.p.geoid);
const rr = G.rankRange(W, model.places, weights, top);
const weighted = W.GROUPS.filter((g) => Number(weights[g.id]) > 0).length;
ok(rr.length === 20 && rr.every((r) => r.runs === weighted && r.best >= 1 && r.best <= r.worst && r.worst <= model.places.length), 'rank range: one run per weighted group, best <= worst');

// Coverage: matches the scorer's own "not yet checked" (points null), and never counts it as checked.
const cov = G.coverage(W, model.places);
const ids = W.GROUPS.flatMap((g) => g.factors);
ok(cov.length === ids.length, 'coverage: one row per factor');
for (const c of cov) {
  ok(c.of === model.places.length && c.checked === model.places.filter((p) => p.factors[c.id].points != null).length, `coverage ${c.id}: counts recorded values`);
  ok(c.label && c.label !== c.id, `coverage ${c.id}: plain label`);
}
ok(cov.some((c) => c.checked < model.places.length), 'coverage: some local factors are still partly checked');
ok(G.short('Silt (town)') === 'Silt' && G.short('Edwards (CDP)') === 'Edwards CDP', 'labels drop city/town, keep CDP');

// Page: the charts load after the scorer, carry ids for every figure and source line, no outside script.
const page = readFileSync('developer-where.html', 'utf8');
ok(page.indexOf('js/where-to-build.js') < page.indexOf('js/where-to-build-charts.js'), 'chart script loads after the scorer');
for (const id of ['wtbMap', 'wtbChecked', 'wtbGroups', 'wtbRange', 'wtbCoverage']) ok(page.includes(`id="${id}"`) && page.includes(`id="${id}Src"`), `page has ${id} and its source line`);
const js = readFileSync('js/where-to-build-charts.js', 'utf8');
ok(/'aria-label': label/.test(js) && /role: 'img'/.test(js), 'every chart is labelled for screen readers');
ok(!/#[0-9a-f]{6}\b/i.test(js), 'site palette only, no fixed colours');
ok(!/color-mix|--accent/.test(js) && /var\(--chart-1\)/.test(js), 'data marks use the approved --chart-1..7 tokens (Rule 10)');
// The rank range ranks each run the way the page does: whole-number score, then name.
{
  const g = W.GROUPS.find((x) => Number(weights[x.id]) > 0);
  const w2 = { ...weights, [g.id]: 0 };
  const order = model.places.map((p) => ({ p, s: W.score(p, w2).score })).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
  const one = G.rankRange(W, model.places, { ...w2, ...Object.fromEntries(W.GROUPS.filter((x) => x.id !== g.id).map((x) => [x.id, 0])), [g.id]: 0 }, [order[0].p.geoid]);
  ok(one[0].runs === 0, 'no weighted group means no runs');
  const solo = Object.fromEntries(W.GROUPS.map((x) => [x.id, 0])); solo[g.id] = weights[g.id];
  const other = W.GROUPS.find((x) => x.id !== g.id && Number(weights[x.id]) > 0); solo[other.id] = weights[other.id];
  const pick = order[5].p.geoid;
  const rr2 = G.rankRange(W, model.places, solo, [pick]);
  const byRun = [g.id, other.id].map((z) => { const w3 = { ...solo, [z]: 0 }; return model.places.map((p) => ({ p, s: W.score(p, w3).score })).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name)).findIndex((x) => x.p.geoid === pick) + 1; });
  ok(rr2[0].best === Math.min(...byRun) && rr2[0].worst === Math.max(...byRun), 'rank range matches the page comparator');
}
console.log(`where-to-build charts: ${n} checks passed`);
