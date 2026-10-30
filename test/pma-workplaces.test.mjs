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
  ok(/^08\d{9}$/.test(t) && r.workers >= named + r.no_town + r.other_states, `${t}: listed towns, no-town and other-state workers fit inside the total`);
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
const line = W.sentence(s);
ok(/^About [\d,]+ working residents live in the market area: \d+% work in Durango \(city\), /.test(line) && /in another state/.test(line) && /LODES 2023, primary jobs/.test(line), `the line reads plainly: ${line}`);

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
