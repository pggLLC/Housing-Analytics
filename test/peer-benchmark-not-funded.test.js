'use strict';
// Peer benchmark on market-analysis.html, funded against not funded: the applications CHFA
// turned down are the real ones in its Applicant Reports, scored at every buffer like the funded
// set, and the page's "tells them apart" line is computed from both sides at the site's buffer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/market-analysis-enhancements.js'), 'utf8'), ctx);
const ENH = ctx.window.PMAEnhancements;
const refs = read('data/market/reference-projects.json');
const doc = read('data/market/unfunded-application-points.json');
const apps = read('data/jurisdiction-briefs/_lihtc-applications.json').applications;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// 1. Every point is a real not-funded application, and none is dropped silently.
const notAwarded = apps.filter((a) => a.outcome === 'not_awarded');
ok(doc.meta.applications === notAwarded.length && doc.points.length + doc.unmapped.length === notAwarded.length,
  `every not-funded application is mapped or listed as unmapped (${doc.points.length} + ${doc.unmapped.length} = ${notAwarded.length})`);
const key = (a) => [a.year, a.credit_type, a.name, a.city].join('|');
const src = new Map(notAwarded.map((a) => [key(a), a]));
for (const p of doc.points.concat(doc.unmapped)) {
  const a = src.get(key(p));
  ok(a && a.outcome === 'not_awarded' && p.outcome === 'not_awarded', `${p.name} ${p.year}: a not-funded application in the source`);
  ok(!('sponsor' in p), `${p.name}: no sponsor copied`);
}
for (const p of doc.points) {
  ok(Number.isFinite(p.lat) && Number.isFinite(p.lon) && /^(Exact|Non_Exact)$/.test(p.match), `${p.name}: a geocoded address match`);
  ok(p.lat > 36.9 && p.lat < 41.1 && p.lon > -109.1 && p.lon < -102.0, `${p.name}: inside Colorado`);
  for (const b of refs.meta.buffers) ok(b in p.pma_score_by_buffer, `${p.name}: scored at the ${b}-mile buffer`);
}
for (const u of doc.unmapped) ok(!('lat' in u) && u.why_unmapped, `${u.name}: unmapped, says why, and is not placed anywhere`);

// 2. The contrast is computed from both sides, same years, same buffer.
const kind = (s) => (/9%/.test(s || '') ? '9%' : /4%/.test(s || '') ? '4%' : s || null);
for (const b of refs.meta.buffers) {
  for (const k of [null, '9%', '4%']) {
    const f = refs.projects.filter((p) => p.year_alloc >= 2023 && p.year_alloc <= 2025 && (!k || kind(p.credit) === k)).map((p) => p.pma_score_by_buffer[b]).filter((v) => typeof v === 'number');
    const u = doc.points.filter((p) => p.year >= 2023 && p.year <= 2025 && (!k || kind(p.credit_type) === k)).map((p) => p.pma_score_by_buffer[b]).filter((v) => typeof v === 'number');
    const c = ENH.fundedVsNotFunded(Number(b), refs.projects, doc.points, k);
    if (f.length < 10 || u.length < 10) { ok(c === null, `buffer ${b} ${k || 'all'}: thin, so no line`); continue; }
    let w = 0;
    for (const x of f) for (const y of u) w += x > y ? 1 : x === y ? 0.5 : 0;
    const sep = Math.round((w / (f.length * u.length)) * 100) / 100;
    ok(c && c.funded === f.length && c.notFunded === u.length && c.separation === sep, `buffer ${b} ${k || 'all'}: ${f.length} funded, ${u.length} not funded, ${sep}`);
    ok(c.verdict === (sep >= 0.7 ? 'tells them apart' : sep >= 0.6 ? 'tells them apart a little' : 'does not tell them apart'), `buffer ${b} ${k || 'all'}: verdict follows the number`);
  }
}
// Sabotage: two identical sides are a coin toss, and a wholly higher funded side is 1.
const fake = refs.projects.filter((p) => p.year_alloc >= 2023 && p.year_alloc <= 2025).map((p) => ({ year: p.year_alloc, credit_type: p.credit, pma_score_by_buffer: p.pma_score_by_buffer }));
ok(ENH.fundedVsNotFunded(3, refs.projects, fake, null).separation === 0.5, 'identical sides read 0.5');
const low = fake.map((p) => ({ ...p, pma_score_by_buffer: { 3: -1 } }));
ok(ENH.fundedVsNotFunded(3, refs.projects, low, null).separation === 1 && ENH.fundedVsNotFunded(3, refs.projects, low, null).verdict === 'tells them apart', 'a lower not-funded side reads 1');
ok(ENH.fundedVsNotFunded(null, refs.projects, doc.points, null) === null, 'no buffer, no line');

// 3. The page loads the file and says it in words.
const page = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
ok(page.includes("market/unfunded-application-points.json") && /notFundedHtml\(result\.bufferMiles/.test(page), 'the benchmark loads and shows the not-funded line');
ok(/not as its chance of an award/.test(page) && /never built/.test(page), 'the line says what the rank is not, and names the supply difference');
console.log(`peer-benchmark-not-funded: ${checks} checks passed (${doc.points.length} mapped of ${doc.meta.applications}; 3-mile: ${JSON.stringify(ENH.fundedVsNotFunded(3, refs.projects, doc.points, null))})`);
