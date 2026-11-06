#!/usr/bin/env node
/**
 * Undercount audit fixes (2026-11-06).
 * 1. data/hna/lehd/08.json, the Colorado view of the HNA, is the sum of the 64 county LEHD files:
 *    jobs by workplace and the live-and-work count are not the same-county-only figure the file
 *    used to hold (1,219,132 jobs for 2023 against 2.8 million in the county files), and
 *    cross-county commuting is not shown as people commuting into Colorado.
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

console.log(`undercount-fixes: ${checks} checks passed`);
