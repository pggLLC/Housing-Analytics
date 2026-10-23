// Colorado detail in the guides: every Colorado figure typed into the LIHTC
// guide, the fair housing brief, resident services, the CRA page and the ROAD
// Act page must agree with the repo record it was copied from.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const usd = (n) => '$' + Number(n).toLocaleString('en-US');

const guide = read('lihtc-guide-for-stakeholders.html');
const fair = read('article-fair-housing-rollback.html');
const rs = read('resident-services.html');
const cra = read('cra-expansion-analysis.html');
const road = read('housing-legislation-2026.html');

// 1. Colorado's 2026 ceiling = IRS population x per-capita rate, as allocations.json records it.
const co = json('data/allocations.json').states.CO;
assert.equal(Math.floor(co.population * 3.416), co.allocation, 'allocations.json CO ceiling is population x $3.416');
for (const [name, page] of [['guide', guide], ['ROAD page', road]]) {
  assert.ok(page.includes(usd(co.allocation)), `${name} states Colorado's 2026 ceiling ${usd(co.allocation)}`);
}
assert.ok(guide.includes(co.population.toLocaleString('en-US') + ' residents'), 'guide states the IRS population');

// CHFA 2027 draft figures in the guide match the scoring record.
const sc = json('data/policy/chfa-2027-r1-scoring.json');
assert.equal(sc.status, 'draft', 'guide labels the 2027 figures draft; update the guide when CHFA adopts');
assert.ok(guide.includes(`${sc.minimum_score.points} points for any 9% application`), 'minimum score');
assert.ok(guide.includes(usd(sc.credit_caps.federal_9pct_annual)) && guide.includes(usd(sc.credit_caps.state_standard_with_9pct_annual)), 'per-project caps');
assert.ok(guide.includes(usd(sc.credit_caps.without_pilot.federal_9pct_annual)) && guide.includes(usd(sc.credit_caps.without_pilot.state_standard_with_9pct_annual)), '3.L.1 caps');
const g = sc.gap_pilot;
for (const n of [g.doh.per_unit, g.oedit.per_unit]) assert.ok(guide.includes(usd(n) + ' per unit'), `gap pilot ${usd(n)} per unit`);
assert.ok(guide.includes(`AMI midpoint of ${g.doh.midpoint_max}% or below`), 'DOH midpoint line');
const pts = Object.fromEntries(sc.lines.map((l) => [l.id, l.points]));
for (const [id, label] of [['5A2-extended-use', 'Extended use'], ['5B5-homeless', 'Homelessness or special populations'], ['5B3d-preservation', 'Preservation'], ['5B4b-pha', 'Colorado housing authority as general partner'], ['5B3b-nonmetro', 'Non-metro county'], ['5B2a-priority', 'Community priority']]) {
  const row = guide.match(new RegExp('<tr><td><strong>' + label + '</strong>[^<]*</td><td>([^<]+)</td>'));
  assert.ok(row, `points row for ${label}`);
  assert.ok(row[1].includes(String(pts[id])), `${label} shows ${pts[id]} points`);
}
assert.ok(guide.includes(`Up to ${sc.targeting.weights['40']}`), 'targeting maximum');
const pab = json('data/policy/pab-allocations.json').metadata;
assert.ok(guide.includes(usd(pab.stateVolumeCap)) && guide.includes(usd(pab.statewide.chfaPool)), 'bond cap figures');

// The Colorado market row is bound to the data file, never left as a stale figure.
assert.ok(/set\('lihtcGuideMktCo', co\.median_all_credits\)/.test(guide), 'Colorado market row reads the data file');

// 2. Deal-killers carry the Colorado rules with their sources.
for (const s of ['C.R.S. 29-20-303', 'Voluntary Cleanup Program', 'HB24-1175', 'HB26-1313', 'cdola.colorado.gov/commitment-filings']) {
  assert.ok(guide.includes(s), `guide deal-killers cite ${s}`);
}
const p123 = json('data/policy/prop123_jurisdictions.json').next_cycle;
assert.equal(p123.filing_deadline, '2026-11-01');
assert.ok(guide.includes('due November 1, 2026') && fair.includes('due 1 November 2026'), 'Prop 123 filing deadline');

// 3. Fair housing: Colorado law, and no unqualified 3% claim after HB26-1313.
for (const s of ['C.R.S. 24-34-502', 'HB20-1332', 'Colorado Civil Rights Division', 'within one year', 'HB26-1313']) {
  assert.ok(fair.includes(s), `fair housing brief cites ${s}`);
}
assert.ok(!/conditions state funding on a filed commitment to a 3% annual\s+increase/.test(fair), 'old 3% sentence removed');

// 4. Resident services: every Denver and DOH figure in the summary is in the records.
const recs = Object.fromEntries(json('data/policy/resident-services.json').entries.map((e) => [e.id, e.finding]));
for (const [fig, id] of [['77 percent', 'denver-sib-housing'], ['40 percent fewer arrests', 'denver-sib-justice'], ['27 percent fewer jail days', 'denver-sib-justice'], ['65 percent fewer detox visits', 'denver-sib-justice'], ['$6,876', 'denver-sib-offsets'], ['$7,200', 'cost-doh-minimum'], ['July 1, 2025', 'fund-medicaid-hrsn']]) {
  assert.ok(rs.includes(fig), `resident services states ${fig}`);
  assert.ok(recs[id].includes(fig), `${id} record contains ${fig}`);
}

// 5. CRA and ROAD pages carry a Colorado read-through.
assert.ok(cra.includes('What this means for a Colorado deal') && /data-co-median/.test(cra), 'CRA Colorado box bound to data');
assert.ok(road.includes('What It Means in Colorado') && road.includes('doh.colorado.gov/home-program'), 'ROAD Colorado section');

console.log(`colorado-guide-detail: PASS (Colorado 2026 ceiling ${usd(co.allocation)}; CHFA draft status ${sc.status})`);
