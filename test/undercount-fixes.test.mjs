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
ok(phIn.length > 0 && phIn.length + props.metadata.public_housing.already_on_record_nearby === ph.features.length, 'each development is either added or left out as already on record');
const near = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
const others = P.filter((p) => !p.program_type.includes('public-housing') && Number.isFinite(p.lat));
ok(phIn.every((x) => others.every((o) => near(x, o) > 200)), 'no added public housing record sits within 200 m of another record');
const fl = read('data/affordable-housing/preservation/usda-farm-labor-housing.json');
ok(fl.features.length >= 10 && /sc\.egov\.usda\.gov/.test(fl.meta.file), 'USDA farm labor file, with its source');
ok(P.filter((p) => p.program_type.includes('usda-farm-labor')).length === fl.features.length, 'every farm labor project is in the inventory once (merged where already listed)');
ok(!JSON.stringify(fl).includes('Management_Name') && !JSON.stringify(ph).includes('PHONE'), 'no contact fields copied');

console.log(`undercount-fixes: ${checks} checks passed`);
