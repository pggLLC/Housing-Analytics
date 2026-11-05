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

// 1. Every not-funded application is kept, or dropped with a reason; none disappears.
const notAwarded = apps.filter((a) => a.outcome === 'not_awarded');
const kept = doc.points.concat(doc.unmapped);
ok(doc.meta.applications === kept.length && kept.length + doc.dropped.length === notAwarded.length,
  `every not-funded application is kept or dropped with a reason (${kept.length} + ${doc.dropped.length} = ${notAwarded.length})`);
for (const d of doc.dropped) ok(typeof d.why_dropped === 'string' && d.why_dropped.length > 0, `${d.name} ${d.year}: dropped, says why`);
const key = (a) => [a.year, a.credit_type, a.name, a.city].join('|');
const src = new Map(notAwarded.map((a) => [key(a), a]));
for (const p of kept) {
  const a = src.get(key(p));
  ok(a && a.outcome === 'not_awarded' && p.outcome === 'not_awarded', `${p.name} ${p.year}: a not-funded application in the source`);
  ok(!('sponsor' in p), `${p.name}: no sponsor copied`);
}

// 1b. The disclosure ("not built with these credits", counted once at its latest application)
// agrees with the award data: no kept property, matched independently of the build script, ever
// applied again or appears among the funded properties.
const norm = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/street/g, 'st').replace(/avenue/g, 'ave').replace(/[^a-z0-9]/g, '');
const pkeys = (a) => [`n|${norm(a.name)}|${norm(a.city)}`].concat(a.address ? [`a|${norm(a.address)}|${norm(a.city)}`] : []);
const order = (a) => a.year * 10 + (/Round One/.test(a.round_label || '') ? 1 : /Round Two/.test(a.round_label || '') ? 2 : 3);
const same = (a, b) => pkeys(a).some((k) => pkeys(b).includes(k));
// One check, used on the real cohort and on synthetic sabotage below.
const reasons = (p, appList, refList) => {
  const again = appList.filter((b) => same(p, b) && order(b) >= order(p) && key(b) !== key(p));
  const won = refList.filter((r) => same(p, r));
  return again.map((b) => 'applied again ' + b.year + ' ' + b.outcome).concat(won.map((r) => 'funded ' + r.name + ' ' + r.year_alloc));
};
let scanned = 0;
for (const p of kept) {
  const why = reasons(p, apps, refs.projects);
  ok(why.length === 0, `${p.name} ${p.year}: not applied again and not among the funded properties (${why.join(', ')})`);
  scanned++;
}
ok(scanned === kept.length && scanned > 0, `the scan ran over every kept property (${scanned})`);
ok(new Set(kept.map((p) => pkeys(p)[0])).size === kept.length, 'each property counted once');
// Sabotage, with synthetic records so the test does not depend on a defect staying in the data:
// a made-up later winner, a made-up later application, and an address-only match are each rejected.
const probe = kept[0];
const fakeWin = { name: probe.name, city: probe.city, year_alloc: probe.year + 1 };
ok(reasons(probe, apps, refs.projects.concat([fakeWin])).some((r) => r.startsWith('funded ')), `a synthetic later winner is rejected (${probe.name})`);
const fakeAgain = { ...probe, year: probe.year + 1, outcome: 'awarded', round_label: '' };
ok(reasons(probe, apps.concat([fakeAgain]), refs.projects).some((r) => r.startsWith('applied again ')), `a synthetic later application is rejected (${probe.name})`);
const withAddr = kept.find((p) => p.address);
if (withAddr) {
  const fakeByAddr = { name: 'Renamed ' + withAddr.name, city: withAddr.city, address: withAddr.address.replace(/Street/, 'St'), year_alloc: withAddr.year + 1 };
  ok(reasons(withAddr, apps, refs.projects.concat([fakeByAddr])).length > 0, `a later winner under a new name but the same address is rejected (${withAddr.name})`);
}
// Accented and plain spellings are the same place (Cañon City and Canon City).
const plain = { ...probe, city: 'Cañon City', name: 'Viña Commons', year: probe.year, round_label: '' };
const plainLater = { ...plain, city: 'Canon City', name: 'Vina Commons', year: probe.year + 1, outcome: 'awarded' };
ok(reasons(plain, apps.concat([plainLater]), refs.projects).some((r) => r.startsWith('applied again ')), 'an accented and a plain spelling of the same property match');
ok(!kept.some((p) => /Ca[ñn]on City/i.test(p.city || '') && /GardenWalk/i.test(p.name)), 'GardenWalk of Cañon City (funded 2026) is out of the not-funded cohort');
ok(reasons(probe, apps, refs.projects).length === 0, 'the real record still passes once the synthetic ones are gone');

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
ok(/not as its chance of an award/.test(page) && /latest application/.test(page) && /not built with these credits/.test(page), 'the line says what the rank is not, how the cohort is drawn, and names the supply difference');
console.log(`peer-benchmark-not-funded: ${checks} checks passed (${doc.points.length} mapped of ${doc.meta.applications}, ${doc.dropped.length} dropped; 3-mile: ${JSON.stringify(ENH.fundedVsNotFunded(3, refs.projects, doc.points, null))})`);
