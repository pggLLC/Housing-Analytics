#!/usr/bin/env node
/**
 * data/market/cbp-workplace-size.json (scripts/build_cbp_workplace_size.py): private workplaces by number of
 * employees for every Colorado county, from Census County Business Patterns.
 * Pins: all 64 counties; the source, year and what CBP leaves out (government) are stated; size classes never
 * exceed the total; "large" (100+) agrees with the classes; a withheld count is null with an upper bound, never 0;
 * and three counties match the CBP 2023 file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const P = read('data/market/cbp-workplace-size.json');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const m = P.meta;
ok(Number.isInteger(m.year) && m.year >= 2020, 'CBP year named');
ok(/County Business Patterns/.test(m.source.label) && /^https:\/\/www\.census\.gov\//.test(m.source.url) && /cbp\d\dco\.zip$/.test(m.source.file), 'source, page and file named');
ok(/Government/.test(m.excludes), 'says CBP leaves out government');
ok(/100 or more/.test(m.large_means), 'says what large means');

const want = read('data/hna/ranking-index.json').rankings.filter((g) => g.type === 'county').map((g) => g.geoid).sort();
ok(want.length === 64 && JSON.stringify(Object.keys(P.counties).sort()) === JSON.stringify(want), 'all 64 counties are keys');
const LARGE = ['100-249', '250-499', '500-999', '1,000 or more'];
for (const [f, c] of Object.entries(P.counties)) {
  ok(c && Number.isInteger(c.establishments) && c.establishments > 0, f + ' has an establishment total');
  const v = Object.values(c.by_size);
  ok(v.every((x) => x === null || (Number.isInteger(x) && x >= 0)), f + ' size classes are whole numbers or null');
  const known = v.filter((x) => x !== null).reduce((a, b) => a + b, 0);
  ok(known <= c.establishments, f + ' size classes do not exceed the total');
  if (v.every((x) => x !== null)) ok(known === c.establishments, f + ' complete size classes add up to the total');
  if (LARGE.every((k) => c.by_size[k] !== null)) ok(c.large === LARGE.reduce((a, k) => a + c.by_size[k], 0), f + ' large is the sum of the large classes');
  if (c.large === null) ok(Number.isInteger(c.large_at_most) && c.large_at_most >= 0, f + ' withheld large has an upper bound');
  else ok(Number.isInteger(c.large) && c.large >= 0 && c.large <= c.establishments, f + ' large is a count');
  const bySector = c.large_by_sector.reduce((a, s) => a + s.workplaces, 0);
  ok(c.large === null || bySector <= c.large, f + ' sector counts do not exceed large');
  ok(c.large_by_sector.every((s) => /^\d\d$/.test(s.naics) && s.sector && s.workplaces > 0), f + ' sectors are named');
}
// Spot counties copied from cbp23co.txt (naics ------).
if (m.year === 2023) {
  const d = P.counties['08031'];
  ok(d.by_size['100-249'] === 590 && d.by_size['1,000 or more'] === 33 && d.large === 823, 'Denver: 590 / 33 / 823');
  ok(P.counties['08081'].large === 4 && P.counties['08081'].establishments === 389, 'Moffat: 4 of 389');
  ok(P.counties['08077'].large === 71 && P.counties['08077'].by_size['500-999'] === 2, 'Mesa: 71, one 500-999 class read off the total');
  ok(P.counties['08009'].large === null && P.counties['08009'].large_at_most === 3, 'Baca: withheld, at most 3');
}
console.log(`cbp-workplace-size: PASS (${checks} checks)`);
