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
  lbStatus: json('data/policy/prop123-land-banking-status.json'),
  hud: json('data/hud-fmr-income-limits.json'),
  context: json('data/policy/where-to-build-context.json'),
  support: json('data/policy/local-support.json'),
  fees: json('data/policy/fee-reductions.json'),
  funds: json('data/policy/local-housing-funds.json'),
  coverage: json('data/policy/incentive-coverage.json'),
  commitment: json('data/policy/local-commitment.json')
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
  const r1 = (x) => Math.round(x * 10) / 10;
  const expect = Math.round(r1(Math.max(0, Math.min(100, r1(num / den * 100) + r1(Math.min(10, p.signals.reduce((a, g) => a + g.points, 0))) - Math.min(30, p.flags.length * 15)))));
  ok(s.score === expect, `${p.name}: score ${s.score} is the printed formula (${expect})`);
}

// The row's printed sum reconciles exactly: base + signals - flags = exact, which rounds to the score,
// under the default weights, every preset and a spread of custom slider settings.
{
  const weightSets = [W.defaultWeights(), ...Object.values(W.PRESETS).map((x) => x.weights),
    { build: 4, money: 5, land: 3, need: 1, rents: 1, rec: 1, vote: 3, lean: 4 }];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) % 6;
  for (let k = 0; k < 25; k++) weightSets.push(Object.fromEntries(W.GROUPS.map((g) => [g.id, rnd()])));
  for (const w of weightSets) {
    for (const p of model.places) {
      const s = W.score(p, w);
      const sum = Math.round(Math.max(0, Math.min(100, s.base + s.signalPoints - s.flagPoints)) * 10) / 10;
      ok(sum === s.exact && Math.round(s.exact) === s.score, `${p.name} @ ${JSON.stringify(w)}: printed ${s.base} + ${s.signalPoints} - ${s.flagPoints} = ${s.exact} rounds to ${s.score}`);
    }
  }
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

// ---- 6b. Land-bank land is scored by the status file: land with no developer on record scores highest.
{
  const st = docs.lbStatus.status;
  const ids = Object.keys(st);
  ok(ids.length === docs.awards.awards.length, 'every award has a status');
  // The rule as Methods prints it, written out here so a swapped score fails.
  const EXPECT = { seeking: 10, none_found: 10, none: 8, partner: 5, applied: 4, not_funded: 4, financed: 2 };
  ok(Object.keys(docs.lbStatus.meta.counts).every((k) => k in EXPECT), 'every status in the file has a written score');
  const seen = new Set();
  for (const p of model.places) {
    const f = p.factors.landBank;
    if (!f.awards) { ok(f.points === 0, `${p.name}: no award scores 0`); continue; }
    for (const a of f.awards) {
      ok(a.status === st[a.id].status && a.points === EXPECT[a.status], `${p.name}: award ${a.id} (${a.status}) scores ${EXPECT[a.status]} (${a.points})`);
      if (p.type !== 'county') seen.add(a.id);
    }
    ok(f.points === Math.max(...f.awards.map((a) => a.points)), `${p.name}: land-bank points are the best award's`);
    ok(!/status not loaded/.test(f.value), `${p.name}: the status file is read`);
    const top = f.awards.find((a) => a.points === f.points);
    const want = (st[top.id].sources || []).filter((x) => x && x.url).length;
    ok(f.evidence.length === want, `${p.name}: the status evidence is linked (${f.evidence.length} of ${want})`);
  }
  ok(model.places.some((p) => p.factors.landBank.evidence && p.factors.landBank.evidence.length), 'some land-bank rows link status evidence');
  // An award missing from the status file, or with a status the rule doesn't name, is unscored, not guessed.
  {
    const single = model.places.filter((p) => p.type !== 'county' && (p.factors.landBank.awards || []).length === 1);
    ok(single.length >= 2, 'two places with one land-bank award each');
    const [gone, odd] = single;
    const st2 = { ...st };
    delete st2[gone.factors.landBank.awards[0].id];
    st2[odd.factors.landBank.awards[0].id] = { ...st[odd.factors.landBank.awards[0].id], status: 'something_new' };
    const m = W.build({ ...docs, lbStatus: { ...docs.lbStatus, status: st2 } }, TODAY);
    for (const p0 of [gone, odd]) {
      const f = m.places.find((p) => p.geoid === p0.geoid && p.type === p0.type).factors.landBank;
      ok(f.points === null && /not scored/.test(f.value), `${p0.name}: an award with no known status is not scored (${f.points})`);
    }
    ok(m.places.every((p) => !p.factors.landBank.awards || p.factors.landBank.awards.every((a) => a.points === null || Object.values(EXPECT).includes(a.points))),
      'no land-bank award gets a score the rule does not print');
  }
  // A "seeking" signal takes its date and link from the status evidence, not the refresh date.
  {
    const award = docs.awards.awards.find((a) => model.places.some((p) => p.type !== 'county' && (p.factors.landBank.awards || []).some((x) => x.id === a.id)));
    const fake = (sources) => ({ ...docs.lbStatus, meta: { ...docs.lbStatus.meta, generated_from: { ...docs.lbStatus.meta.generated_from, research_checked: TODAY } },
      status: { ...st, [award.id]: { ...st[award.id], status: 'seeking', sources } } });
    const src = { title: 'Town RFP', url: 'https://example.org/rfp', date: '2026-06-01' };
    const m1 = W.build({ ...docs, lbStatus: fake([src]) }, TODAY);
    const sig = m1.places.flatMap((p) => p.signals).filter((g) => /seeking a developer/.test(g.text));
    ok(sig.length && sig.every((g) => g.date === src.date && g.url === src.url), 'a seeking signal is dated and linked from its status evidence');
    const m2 = W.build({ ...docs, lbStatus: fake([{ title: 'Undated page', url: 'https://example.org/x' }]) }, TODAY);
    ok(!m2.places.some((p) => p.signals.some((g) => /seeking a developer/.test(g.text))), 'a seeking status with no dated source adds no signal');
  }
  // Partial dates (YYYY, YYYY-MM), which the status builder accepts, read as the earliest day they allow.
  ok(W.fullDate('2026') === '2026-01-01' && W.fullDate('2026-06') === '2026-06-01' && W.fullDate('2026-06-15') === '2026-06-15' && W.fullDate('soon') === null, 'partial status dates are read conservatively');
  {
    const award = docs.awards.awards.find((a) => model.places.some((p) => p.type !== 'county' && (p.factors.landBank.awards || []).some((x) => x.id === a.id)));
    const lb = { ...docs.lbStatus, status: { ...st, [award.id]: { ...st[award.id], status: 'seeking',
      sources: [{ title: 'Exact', url: 'https://example.org/a', date: '2026-05-10' }, { title: 'Month only', url: 'https://example.org/b', date: '2026-07' }] } } };
    const sig = W.build({ ...docs, lbStatus: lb }, TODAY).places.flatMap((p) => p.signals).filter((g) => /seeking a developer/.test(g.text));
    ok(sig.length && sig.every((g) => g.date === '2026-07-01' && g.url === 'https://example.org/b'), 'a month-only source still makes a dated signal');
  }
  // A signal that has faded to 0 (a year old, or a day short of it) is not shown as "+0".
  for (const old of ['2025-10-22', '2025-10-23']) {
    const award = docs.awards.awards.find((a) => model.places.some((p) => p.type !== 'county' && (p.factors.landBank.awards || []).some((x) => x.id === a.id)));
    const lb = { ...docs.lbStatus, status: { ...st, [award.id]: { ...st[award.id], status: 'seeking', sources: [{ title: 'Old notice', url: 'https://example.org/old', date: old }] } } };
    const m = W.build({ ...docs, lbStatus: lb }, TODAY);
    ok(!m.places.some((p) => p.signals.some((g) => /seeking a developer/.test(g.text))), `a signal dated ${old} has faded and is not shown`);
  }
  const noModel = W.build({ ...docs, lbStatus: null }, TODAY);
  ok(noModel.missing.includes('prop123-land-banking-status.json') && noModel.places.every((p) => p.factors.landBank.points === null),
    'without the status file land is not checked (no fallback score) and the page names the file');
}

// ---- 6c. A Census community inherits its county's money, so it scores as county money (6), not its own (10).
for (const p of model.places) {
  if (p.type === 'cdp' && p.factors.localFund.points != null && /\(through /.test(p.factors.localFund.value)) {
    ok(p.factors.localFund.points === 6, `${p.name}: an inherited county fund scores 6 (${p.factors.localFund.points})`);
  }
}
ok(model.places.some((p) => p.type === 'cdp' && /\(through /.test(p.factors.localFund.value)), 'some communities inherit a county fund');
ok(page.includes('meta.parks_generated') && docs.context.meta.parks_generated, 'parks show the OpenStreetMap file date, not the vote date');

// ---- 6d. A file that fails to load leaves its factors unchecked, never a zero for every place.
for (const [key, ids] of [['prop123', ['prop123']], ['awards', ['landBank']], ['lbStatus', ['landBank']], ['support', ['approvals']], ['context', ['parks', 'prop123Vote', 'presVote']], ['funds', ['localFund']], ['commitment', ['hna', 'planGoal', 'authority']]]) {
  const m = W.build({ ...docs, [key]: null }, TODAY);
  ok(m.missing.length === 1, `${key} missing is reported (${m.missing})`);
  ok(m.places.every((p) => ids.every((id) => p.factors[id].points === null && /did not load/.test(p.factors[id].value))), `${key} missing: ${ids.join(', ')} show as not checked`);
  const i = model.places.findIndex((p) => ids.some((id) => p.factors[id].points != null && W.defaultWeights()[W.GROUPS.find((g) => g.factors.includes(id)).id] > 0));
  const before = W.score(model.places[i]), after = W.score(m.places[i]);
  ok(after.checkedShare < before.checkedShare, `${key} missing lowers confidence instead of scoring zero`);
}
ok(model.missing.length === 0, 'every file loads in the test set');
ok(page.includes('model.missing'), 'the page says which files did not load');

// ---- 6e. Approvals count only actions on a specific project, never a policy or code adoption.
{
  const PROJECT = new Set(['project_approval', 'rezoning_approval', 'funding_award', 'land_contribution', 'fee_waiver_approval']);
  const byGeoid = Object.fromEntries(docs.support.jurisdictions.map((j) => [j.geoid, j]));
  for (const p of model.places) {
    const a = p.factors.approvals;
    if (a.points === 10) {
      const titles = docs.support.jurisdictions.flatMap((j) => j.items).filter((i) => PROJECT.has(i.type)).map((i) => i.title);
      ok(titles.some((t) => a.value.startsWith(t)), `${p.name}: the approval shown is a project action (${a.value})`);
    }
    for (const g of p.signals.filter((x) => x.text.startsWith('Approved: '))) {
      const item = docs.support.jurisdictions.flatMap((j) => j.items).find((i) => 'Approved: ' + i.title === g.text);
      ok(item && PROJECT.has(item.type), `${p.name}: approval signal "${g.text}" is a project action`);
    }
  }
  const bv = model.places.find((x) => x.name === 'Buena Vista (town)');
  ok(bv && bv.factors.approvals.points === 0 && !bv.signals.some((g) => /expedited review/i.test(g.text)),
    'Buena Vista: its Prop 123 code adoption and recommendation do not count as project approvals');
  void byGeoid;
}

// ---- 7. Red flags and signals are dated and sourced.
for (const p of model.places) {
  for (const g of p.signals) ok(/^\d{4}-\d{2}-\d{2}$/.test(g.date) && g.points > 0 && g.points <= 5, `${p.name} signal is dated and worth up to 5`);
  for (const f of p.flags) ok(f.date && f.text, `${p.name} red flag is dated`);
}
ok(model.places.some((p) => p.flags.length), 'recorded denials show as red flags');
// A denial stops counting once its research row passes review_by, the same as approvals.
{
  const isDenial = (i) => i.type === 'denial' || i.outcome === 'denied' || i.outcome === 'recommended_denial';
  const rows = docs.support.jurisdictions.filter((j) => j.items.some(isDenial));
  ok(rows.length, 'a research row with a denial exists');
  const titles = new Set(rows.flatMap((j) => j.items.filter(isDenial).map((i) => i.title)));
  const hit = (m) => m.places.filter((p) => p.flags.some((f) => [...titles].some((t) => f.text.startsWith(t))));
  ok(hit(model).length, 'those denials are red flags while the rows are current');
  const expired = { ...docs.support, jurisdictions: docs.support.jurisdictions.map((j) => (rows.includes(j) ? { ...j, review_by: '2026-10-21' } : j)) };
  const stale = hit(W.build({ ...docs, support: expired }, TODAY));
  ok(!stale.length, `denials stop counting once review_by passes (${stale.map((p) => p.name).join(', ')})`);
}
// ---- 8. Local commitment (paul 2026-10-22: HNAs, comp plans, housing authorities).
{
  const byName = (nm) => model.places.find((p) => p.name === nm);
  const lm = byName('Longmont (city)');
  ok(lm.factors.hna.points === 10 && lm.factors.authority.points >= 8,
    `Longmont: own HNA and an authority with deals (${lm.factors.hna.points}/${lm.factors.authority.points})`);
  // Longmont's 12% goal is quoted from its HNA, not yet from an adopted plan, so it is not scored.
  ok(lm.factors.planGoal.points === null, `Longmont: a goal seen only in an HNA is not scored (${lm.factors.planGoal.points})`);
  const bo = byName('Boulder (city)');
  ok(bo.factors.planGoal.points === 10 && /Boulder Valley Comprehensive Plan/.test(bo.factors.planGoal.value) && bo.factors.planGoal.quote,
    'Boulder: the quoted 15% goal in the Boulder Valley Comprehensive Plan scores 10');
  // Every specific or general goal names the adopted plan it comes from.
  for (const [g, rec] of Object.entries(docs.commitment.goals)) {
    if (rec.status === 'specific' || rec.status === 'general') ok(rec.plan, `${g}: a scored goal names its adopted plan`);
  }
  ok(byName('Frisco (town)').factors.planGoal.points === 2, 'Frisco: a need estimate in its plan is not a goal (2)');
  ok(byName('Greeley (city)').factors.planGoal.points === null, 'Greeley: an expired all-housing target is not an affordable goal');
  // A town or community is covered by its county's assessment at the regional rule (6 at most), never its own 10.
  for (const p of model.places) {
    const h = p.factors.hna;
    if (/^Covered by /.test(h.value)) ok(h.points <= 6, `${p.name}: an inherited county HNA scores 6 at most (${h.points})`);
    ok(h.points == null || [10, 6, 3, 2].includes(h.points), `${p.name}: HNA points follow the rule (${h.points})`);
    ok(p.factors.planGoal.points == null || [10, 5, 2, 0].includes(p.factors.planGoal.points), `${p.name}: goal points follow the rule`);
    ok(p.factors.authority.points == null || (p.factors.authority.points >= 2 && p.factors.authority.points <= 10), `${p.name}: authority points follow the rule`);
  }
  ok(model.places.some((p) => /^Covered by /.test(p.factors.hna.value)), 'some towns inherit a county HNA');
  // An assessment older than five years scores 2, however it is labeled.
  const wal = byName('Walsenburg (city)');
  ok(wal.factors.hna.points === 2, `Walsenburg: its 2019 assessment is older than 5 years (${wal.factors.hna.points})`);
  // A town never inherits its county's plan goal; a Census community (unincorporated) does.
  for (const p of model.places) {
    if (p.type === 'place' && /\(through /.test(p.factors.planGoal.value)) ok(false, `${p.name}: a town does not inherit a county plan goal`);
  }
  ok(model.places.some((p) => p.type === 'cdp' && /\(through /.test(p.factors.planGoal.value)), 'a Census community uses its county plan goal');
  // No authority on record is "not checked", never a zero (some authorities run no HUD programs).
  const none = model.places.filter((p) => p.factors.authority.points == null);
  ok(none.length && none.every((p) => /Not yet checked/.test(p.factors.authority.value)), 'no authority on record is not checked, not zero');
  // Award counts use roles in the deal itself: a voucher contract or management alone does not count.
  for (const a of docs.commitment.authorities) {
    for (const d of a.deals) ok(!/^(voucher provider|property manager|waitlist)/i.test(d.role), `${a.name}: ${d.slug} counts a deal role (${d.role})`);
  }
  const dha = docs.commitment.authorities.find((a) => a.id === 'CO001');
  ok(dha && dha.deals.length > 0 && dha.hud.total > 10000, 'Denver Housing Authority has HUD homes and counted awards');
  // Sabotage: if the authorities list went missing for one place, it would be unchecked, not zero.
  const stripped = { ...docs.commitment, authorities: docs.commitment.authorities.filter((a) => a.id !== 'CO070') };
  const lm2 = W.build({ ...docs, commitment: stripped }, TODAY).places.find((p) => p.geoid === lm.geoid);
  ok(lm2.factors.authority.points !== 0, 'removing Longmont\'s authority never scores it zero');
  // Every HNA, goal and award links to its source.
  for (const p of model.places) {
    if (p.factors.hna.points != null) ok(/^https?:\/\//.test(p.factors.hna.url || ''), `${p.name}: HNA links to its source`);
    if (p.factors.planGoal.points != null) ok(/^https?:\/\//.test(p.factors.planGoal.url || ''), `${p.name}: plan goal links to its source`);
    for (const e of p.factors.authority.evidence || []) ok(/^deal-summary\.html\?d=[a-z0-9-]+$/.test(e.url), `${p.name}: award links to its summary`);
  }
  // A DOLA approval of the place's own HNA in the last 12 months is a dated signal.
  ok(model.places.some((p) => p.signals.some((g) => /approved by DOLA/.test(g.text))), 'a recent DOLA HNA approval is a signal');
  ok(page.includes('data/policy/local-commitment.json'), 'the page loads the local commitment file');
}
console.log(`where-to-build: ${n} checks passed`);
