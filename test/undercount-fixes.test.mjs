#!/usr/bin/env node
/**
 * Undercount audit fixes (2026-11-06).
 * 1. data/hna/lehd/08.json, the Colorado view of the HNA, is the sum of the 64 county LEHD files:
 *    jobs by workplace and the live-and-work count are not the same-county-only figure the file
 *    used to hold (1,219,132 jobs for 2023 against 2.8 million in the county files), and
 *    cross-county commuting is not shown as people commuting into Colorado.
 * 2. data/affordable-housing/properties.json: every record with coordinates has a county code, so
 *    county rollups (data/multifamily-inventory-co.json) count CHFA preservation records too.
 * 3. HUD public housing and USDA Section 514 farm labor housing are in the inventory, without
 *    counting a building twice.
 * 4. Division of Housing awards from its FY2021-22 and FY2022-23 annual reports are in
 *    data/policy/funding-awards/dola-awards.json, each once, and Where the Money Goes maps them.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// 1. statewide LEHD
const dir = 'data/hna/lehd';
const counties = readdirSync(join(ROOT, dir)).filter((f) => /^08\d{3}\.json$/.test(f)).map((f) => read(dir + '/' + f));
const st = read(dir + '/08.json');
ok(counties.length === 64, '64 county LEHD files');
const sum = (f) => counties.reduce((a, c) => a + f(c), 0);
ok(st.within === sum((c) => c.within + c.inflow), 'statewide live-and-work = county within + county inflow');
ok(st.crossCountyCommuters === sum((c) => c.inflow), 'cross-county commuters published separately');
ok(st.inflow === null && st.outflow === null, 'out-of-state flows are null, not cross-county flows');
for (const y of Object.keys(st.annualEmployment)) {
  ok(st.annualEmployment[y] === sum((c) => c.annualEmployment[y]), 'jobs ' + y + ' = sum of counties');
}
const last = Math.max(...Object.keys(st.annualEmployment).map(Number));
ok(st.annualEmployment[last] > 2_000_000, 'statewide jobs are in the millions, not the same-county-only figure');
ok(/sum of the 64 Colorado county files/.test(st.source.dataset) && /auxiliary/.test(st.source.notes), 'source says how it is built and what is left out');
const ind = st.industries.reduce((a, i) => a + i.count, 0);
ok(ind === sum((c) => c.C000 || 0), 'industry counts add up to the jobs total');

// 2. county codes on every placed record; rollup adds up
const props = read('data/affordable-housing/properties.json');
const P = props.properties;
ok(P.filter((p) => Number.isFinite(p.lat) && !p.county_fips).length === 0, 'every record with coordinates has a county code');
ok(P.some((p) => p.county_fips_method === 'point-in-county'), 'county codes set from coordinates are marked');
const inv = read('data/multifamily-inventory-co.json');
const countyUnits = Object.values(inv.counties).reduce((a, c) => a + c.total_units, 0);
ok(countyUnits === inv.state.total_units, 'county subtotals add up to the statewide total');
ok(inv.counties['08031'].total_units > 35000, 'Denver counts its CHFA preservation records');

// 3. public housing and farm labor housing
const ph = read('data/affordable-housing/preservation/hud-public-housing.json');
ok(ph.features.length >= 60 && /Public_Housing_Developments/.test(ph.meta.source_url), 'HUD public housing file, with its source');
const phIn = P.filter((p) => p.program_type.includes('public-housing'));
ok(phIn.length > 0 && phIn.length + props.metadata.public_housing.already_listed === ph.features.length, 'each development is either added or left out as already on record');
const phNames = new Set(phIn.map((x) => x.property_name));
ok(!phNames.has('West Ridge Homes') && !phNames.has('Columbine Homes') && !phNames.has('Walsh Manor Annex'), 'Westridge, Columbine and Walsh Manor Annex (Denver) counted once');
ok(phNames.has('Walsh Manor') && phNames.has('Pueblo public housing (CO002000300)'), 'nearness alone does not drop a development (Walsh Manor; Pueblo mapped at one point)');
ok(/distinctive name word/.test(props.metadata.public_housing.rule), 'the matching rule is stated in the file');
const fl = read('data/affordable-housing/preservation/usda-farm-labor-housing.json');
ok(fl.features.length >= 10 && /sc\.egov\.usda\.gov/.test(fl.meta.file), 'USDA farm labor file, with its source');
ok(P.filter((p) => p.program_type.includes('usda-farm-labor')).length === fl.features.length, 'every farm labor project is in the inventory once (merged where already listed)');
ok(!JSON.stringify(fl).includes('Management_Name') && !JSON.stringify(ph).includes('PHONE'), 'no contact fields copied');

// 4. DOH annual reports FY2021-22 and FY2022-23
const dola = read('data/policy/funding-awards/dola-awards.json');
const early = dola.awards.filter((a) => /^fy(2122|2223)-/.test(a.id));
ok(early.filter((a) => a.year === 2021).length >= 80 && early.filter((a) => a.year === 2022).length >= 70, 'both fiscal years are read');
ok(early.every((a) => a.source_type === 'DOH annual report table row' && /content\.leg\.colorado\.gov/.test(a.source_url) && a.quote.includes(a.amount.toLocaleString('en-US'))), 'each row links its report and prints its amount');
for (const k of ['fy2122', 'fy2223']) {
  const ann = dola.meta.announcements.find((x) => x.source_type === 'DOH annual report to legislature (PDF)' && x.url.includes(k === 'fy2122' ? 'fy21-22' : 'fy22-23'));
  ok(ann && ann.stated_total > 2e8 && Math.abs(ann.rows_sum - ann.stated_total) / ann.stated_total < 0.01, k + ': rows add up to within 1% of the report total');
}
const byName = (n) => early.filter((a) => a.name === n);
ok(byName('CHFA SF Const AHIF¹').length === 1 && byName('CHFA CAHP AHIF¹').length === 1, 'two $5M CHFA awards with different homes both count');
const supp = early.filter((a) => /Supplemental funding/.test(a.note));
ok(supp.length > 0 && supp.every((a) => a.homes === 0), 'supplemental awards keep the printed 0 homes');
ok(!early.some((a) => /[a-z]Chrisman$/.test(a.name)) && byName('Sol').length === 1, 'project names as printed elsewhere (no run-on grantee, Sol not SOL)');
ok(/from July 2021/.test(dola.meta.coverage), 'coverage says awards start July 2021');
const fmap = read('data/derived/funding-map.json');
ok(fmap.awards.filter((a) => a.year === 2021 || a.year === 2022).filter((a) => a.agency === 'DOH').length >= 100, 'Where the Money Goes maps the earlier DOH awards');

console.log(`undercount-fixes: ${checks} checks passed`);
