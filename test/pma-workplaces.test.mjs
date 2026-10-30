// Market Analysis "Where residents work" (paul 2026-10-29, "add the commute line").
// The commuting fact a market study documents (NCHMA v3.1, III.F.8): where the market
// area's working residents work. Context only: it adds no demand and changes no score.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const W = require('../js/pma-workplaces.js');
const read = (p) => readFileSync(p, 'utf8');
const D = JSON.parse(read('data/market/tract-workplaces.json'));
let n = 0;
function ok(c, msg) { if (!c) { console.error('FAIL: ' + msg); process.exit(1); } n++; }

// ---- The file: every tract adds up, and the out-of-state count is in the total.
ok(D.meta.lodes_year === 2023 && /JT01/.test(D.meta.sources.flows), 'primary jobs (JT01), LODES 2023');
ok(Object.keys(D.tracts).length > 1300, 'every Colorado tract with working residents');
for (const [t, r] of Object.entries(D.tracts)) {
  const named = r.to.reduce((s, p) => s + p[1], 0);
  ok(/^08\d{9}$/.test(t) && r.workers === named + r.no_town + r.other_states, `${t}: every destination is kept, so the parts add up to the total`);
  for (const [g] of r.to) ok(D.names[g], `${t}: ${g} has a name`);
}

// ---- The summary: a tract counts by its share in the market area.
const t1 = '08067940300', t2 = '08067970602';
const a = D.tracts[t1], b = D.tracts[t2];
const s = W.summarize(D, [{ geoid: t1, share: 1 }, { geoid: t2, share: 0.5 }]);
ok(s.workers === Math.round(a.workers + 0.5 * b.workers), 'workers are weighted by the share in the market area');
const dur = (r) => (r.to.find((p) => p[0] === '0822035') || [0, 0])[1];
ok(s.top[0].name === 'Durango (city)' && s.top[0].workers === Math.round(dur(a) + 0.5 * dur(b)), 'Durango leads for the Bayfield area');
ok(s.otherStates === Math.round(a.other_states + 0.5 * b.other_states), 'other-state workers are weighted the same way');
// The printed line agrees with the figures behind it (counts, places, shares, vintage), whatever its wording.
const line = W.sentence(s);
const pctOf = (x) => Math.round(x / s.workers * 100) + '%';
ok(line.includes(s.workers.toLocaleString('en-US')), `the line prints the market area's working residents: ${line}`);
for (const p of s.top) ok(line.includes(Math.round(p.share * 100) + '%') && line.includes(p.name) && line.indexOf(p.name) > line.indexOf(Math.round(p.share * 100) + '%'), `the line prints ${p.name} with its share`);
ok(line.includes(pctOf(s.otherStates)), 'the line prints the other-state share');
ok(line.includes(String(D.meta.lodes_year)), 'the line prints the LODES year');
ok(s.top.every((p, i) => i === 0 || p.workers <= s.top[i - 1].workers), 'places are listed largest first');

// A town that is never a tract's leader can still lead the market area (ranked after weighting).
{
  const mk = (own) => ({ workers: 69, other_states: 0, no_town: 0, to: [[own + '1', 10], [own + '2', 10], [own + '3', 10], [own + '4', 10], [own + '5', 10], [own + '6', 10], ['S', 9]] });
  const fx = { meta: { lodes_year: 2023 }, names: {}, tracts: { '08000000001': mk('A'), '08000000002': mk('B') } };
  const r = W.summarize(fx, [{ geoid: '08000000001' }, { geoid: '08000000002' }]);
  ok(r.top[0].geoid === 'S' && r.top[0].workers === 18, 'a town shared by two tracts leads once the tracts are added');
}

// ---- Missing data is said, not guessed.
ok(W.summarize(null, [{ geoid: t1 }]) === null, 'no file, no figure');
ok(W.summarize(D, [{ geoid: '08999999999' }]) === null, 'no matching tract, no figure');
ok(W.summarize(D, [{ geoid: t1 }, { geoid: '08999999999' }]).tractsMissing === 1, 'a tract with no record is counted as missing');
ok(W.sentence(null) === null, 'no summary, no sentence');

// ---- The page shows it and exports it, and nothing scores it.
const page = read('market-analysis.html'), js = read('js/market-analysis.js');
ok(page.includes('id="pmaSumWorkplaces"') && page.includes('js/pma-workplaces.js') && /adds no demand and does not change any score/.test(page), 'the summary card has the row, its script and a no-score note');
ok(js.includes("workplaces: sumGet('pmaSumWorkplaces')") && js.includes('Where Residents Work (context, no score effect)'), 'the line goes into the JSON and CSV exports');
ok(!/workplaces[^\n]*(score|capture|demand)\s*[+*=]/i.test(js), 'no score, capture or demand reads it');
console.log(`pma-workplaces: ${n} checks passed`);
