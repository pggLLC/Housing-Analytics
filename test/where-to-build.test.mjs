// Where Should I Build? (developer-where.html, js/where-to-build.js).
// paul 2026-10-22: the ranking must be transparent. Every row says why in a
// sentence, every factor shows its rule and source, "not yet checked" is
// never a zero, and there is no hidden multiplier.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../js/where-to-build.js');
let n = 0;
function ok(c, msg) { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } n++; }
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const TODAY = '2026-10-22';

const docs = {
  ranking: json('data/hna/ranking-index.json'),
  prop123: json('data/policy/prop123_jurisdictions.json'),
  awards: json('data/policy/prop123-land-banking-awards.json'),
  lbStatus: null,
  hud: json('data/hud-fmr-income-limits.json'),
  context: json('data/policy/where-to-build-context.json'),
  support: json('data/policy/local-support.json'),
  fees: json('data/policy/fee-reductions.json'),
  funds: json('data/policy/local-housing-funds.json'),
  coverage: json('data/policy/incentive-coverage.json')
};
const model = W.build(docs, TODAY);

// ---- 1. Every ranked place is scored, with a reason, not just the 33 in the policy file.
ok(model.places.length === docs.ranking.rankings.length && model.places.length > 500, `all ${model.places.length} ranked places are scored`);
const scored = model.places.map((p) => ({ p, s: W.score(p) }));
for (const { p, s } of scored) {
  ok(Number.isInteger(s.score) && s.score >= 0 && s.score <= 100, `${p.name} has a 0-100 score`);
  ok(/factors checked\.$/.test(s.reason) && s.reason.length > 30, `${p.name} has a one-sentence reason`);
  ok(['High', 'Medium', 'Low'].includes(s.confidence), `${p.name} has a confidence label`);
}
ok(scored.filter((x) => x.s.tier === 1).length >= 10, 'some places reach Target under the default weights');

// ---- 2. The score is exactly the printed formula: no hidden multiplier.
for (const { p, s } of scored.slice(0, 40)) {
  let num = 0, den = 0;
  for (const part of s.parts) if (part.weight > 0 && part.factor.points != null) { num += part.weight * part.factor.points; den += part.weight * 10; }
  const expect = Math.round(Math.max(0, Math.min(100, num / den * 100 + Math.min(10, p.signals.reduce((a, g) => a + g.points, 0)) - Math.min(30, p.flags.length * 15))));
  ok(s.score === expect, `${p.name}: score ${s.score} is the printed formula (${expect})`);
}

// ---- 3. Not yet checked is never a zero, and it lowers confidence.
{
  const base = model.places.find((p) => p.factors.approvals.points === 0 || p.factors.incentives.points === 0);
  ok(base, 'found a place with a checked zero');
  const unknown = JSON.parse(JSON.stringify(base));
  for (const id of ['approvals', 'incentives', 'localFund']) if (unknown.factors[id].points === 0) unknown.factors[id].points = null;
  const a = W.score(base), b = W.score(unknown);
  ok(b.score >= a.score, 'turning a checked zero into "not checked" never lowers the score');
  ok(b.checkedShare < a.checkedShare, '... and it lowers the checked share');
  const empty = JSON.parse(JSON.stringify(base));
  for (const id of Object.keys(empty.factors)) empty.factors[id].points = null;
  empty.factors.need.points = 10;
  const e = W.score(empty);
  ok(e.confidence === 'Low' && e.tier !== 1, 'a place resting on one factor is Low confidence and cannot be Target');
  ok(W.tierFor(95, 'Low') === 2 && W.tierFor(70, 'Medium') === 1 && W.tierFor(34, 'High') === null, 'tier cutoffs match the rules');
}

// ---- 4. Weights: zero drops a factor, and the presidential vote is off by default.
{
  const w = W.defaultWeights();
  ok(w.lean === 0, 'the 2024 presidential vote is off unless the reader turns it up');
  const p = model.places.find((x) => x.name === 'Durango (city)');
  ok(p, 'Durango is ranked');
  const s0 = W.score(p, w);
  ok(!s0.parts.some((x) => x.id === 'presVote' && x.weight > 0), 'a zero weight leaves the factor out');
  ok(W.score(p, { ...w, need: 0 }).parts.find((x) => x.id === 'need').weight === 0, 'turning need to 0 drops it');
  for (const k of Object.keys(W.PRESETS)) ok(W.GROUPS.every((g) => Number.isInteger(W.PRESETS[k].weights[g.id])), `preset ${k} sets every group`);
}

// ---- 5. Every factor has a written rule and a source, shown in Methods and the row breakdown.
for (const g of W.GROUPS) for (const id of g.factors) {
  ok(W.FACTORS[id] && W.FACTORS[id].rule.length > 20, `${id} has a rule`);
}
const page = readFileSync('developer-where.html', 'utf8');
ok(page.includes('js/where-to-build.js') && page.includes('js/local-support-data.js') && page.includes('data/policy/where-to-build-context.json'), 'the page loads the scorer and its data');
ok(page.includes('W.FACTORS') && page.includes('W.RULES.confidence') && page.includes('W.RULES.tiers'), 'Methods is printed from the scorer\'s own rules');
ok(!/Apartment List|ZORI|\* 1\.2/.test(page), 'no scraped rent source and no hidden stretch');
const ths = [...page.matchAll(/<th[\s>][^>]*>/g)].map((m) => m[0]);
ok(ths.length >= 10 && ths.every((t) => t.includes('data-tip=')), 'every table header carries a hover tip');
ok(page.indexOf('id="summary"') < page.indexOf('class="ib-filters"'), 'the executive line comes before the filters');

// ---- 6. County votes: official totals, and each town shows its county.
{
  const v = docs.context.votes;
  for (const key of ['prop123_2022', 'president_2024']) {
    const c = Object.values(v[key].counties);
    ok(c.length === 64, `${key}: 64 counties`);
    ok(c.every((r) => r.source_line && r.source_line.startsWith(r.county)), `${key}: each county keeps its source line`);
  }
  ok(Object.values(v.prop123_2022.counties).reduce((a, r) => a + r.yes, 0) === v.prop123_2022.statewide.yes, 'Prop 123 county yes votes add to the printed total');
  ok(Object.values(v.president_2024.counties).reduce((a, r) => a + r.harris, 0) === v.president_2024.statewide.harris, 'presidential county votes add to the printed total');
  ok(Math.abs(v.prop123_2022.statewide.yes_share - 0.526) < 0.002, 'Prop 123 passed statewide with about 52.6%');
  const durango = model.places.find((x) => x.name === 'Durango (city)');
  ok(durango.factors.prop123Vote.value.startsWith('La Plata County voted'), 'a town shows its county\'s vote');
}

// ---- 7. Red flags and signals are dated and sourced.
for (const p of model.places) {
  for (const g of p.signals) ok(/^\d{4}-\d{2}-\d{2}$/.test(g.date) && g.points > 0 && g.points <= 5, `${p.name} signal is dated and worth up to 5`);
  for (const f of p.flags) ok(f.date && f.text, `${p.name} red flag is dated`);
}
ok(model.places.some((p) => p.flags.length), 'recorded denials show as red flags');

console.log(`where-to-build: ${n} checks passed`);
