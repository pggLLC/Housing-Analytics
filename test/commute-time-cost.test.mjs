#!/usr/bin/env node
/**
 * data/market/commute-time-cost.json, built by scripts/market/build_commute_time_cost.py, read by the
 * Commuting and jobs page (hub/commuting.js) for a picked town's travel-time card, drive-cost card and map.
 *
 * Pins:
 *   1. one entry per town in commute-strength.json, and its from/to rows are that file's rows, same order
 *      and counts (the time file adds minutes, road miles and a start point; it never changes a count);
 *   2. each ACS side (B08603 by workplace, B08303 by residence) has five bands that add to its total,
 *      with margins of error, from the 2024 5-year table-based summary file;
 *   3. every routed drive is plausible: minutes > 0, road miles at least the straight line between its two
 *      ends (a road cannot be shorter) and under 5.5 times it (Ouray to Telluride is 5 times: the road goes
 *      round by Ridgway), and an average speed of at least 12 mph over any drive of 3 miles or more and 20 mph over 10 miles or more
 *      (the builder leaves slower drives out as router detours and lists them in meta.not_shown_too_slow), and
 *      no more than 2.5 times the line when the ends are 20+ miles apart (meta.not_shown_detour);
 *   4. homes in another state start at the county's 2020 centre of population (San Juan County, NM);
 *   5. the meta names the router, the OSM licence and both ACS files.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const T = read('data/market/commute-time-cost.json');
const C = read('data/market/commute-strength.json');

// 1. Same towns, same rows.
ok(Object.keys(T.places).sort().join() === Object.keys(C.places).sort().join(), 'one entry per commute town');
for (const [g, e] of Object.entries(T.places)) {
  const p = C.places[g];
  for (const k of ['from', 'to']) {
    ok(e[k].length === p[k].length, `${g} ${k} row count`);
    e[k].forEach((r, i) => ok(r[0] === p[k][i][0] && r[1] === p[k][i][1] && r.length === 6, `${g} ${k} row ${i} is the commute file's row`));
  }
}
ok(T.meta.commute_generated === C.meta.generated && T.meta.lodes_year === C.meta.lodes_year, 'built from the current commute file');

// 2. ACS bands.
const KEYS = ['under_15', '15_29', '30_44', '45_59', '60_plus'];
ok(T.meta.acs.bands.map((b) => b[0]).join() === KEYS.join(), 'five bands in order');
let work = 0, home = 0;
for (const [g, e] of Object.entries(T.places)) {
  for (const side of ['work', 'home']) {
    const s = e[side];
    if (!s) continue;
    if (side === 'work') work++; else home++;
    ok(s.bands.map((b) => b[0]).join() === KEYS.join(), `${g} ${side} band keys`);
    ok(s.bands.reduce((t, b) => t + b[1], 0) === s.total[0], `${g} ${side} bands add to the total`);
    ok(s.bands.every((b) => Number.isInteger(b[1]) && b[1] >= 0 && (b[2] == null || b[2] >= 0)), `${g} ${side} counts and margins`);
  }
}
ok(work === T.meta.places_with_acs_work && home === T.meta.places_with_acs_home, 'meta counts match');
ok(work > 150 && home > 200, `ACS coverage work ${work}, home ${home}`);
ok(/acsdt5y2024-b08603\.dat$/.test(T.meta.acs.work.url) && /acsdt5y2024-b08303\.dat$/.test(T.meta.acs.home.url), 'ACS 2024 5-year files');
ok(T.meta.acs.work.table === 'B08603' && T.meta.acs.home.table === 'B08303', 'tables');

// 3. Drives are plausible.
const miles = (a, b) => {
  const R = 3958.8, r = (d) => d * Math.PI / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
let routed = 0;
for (const [g, e] of Object.entries(T.places)) {
  for (const k of ['from', 'to']) {
    for (const r of e[k]) {
      if (r[2] == null) { ok(r[3] == null, `${g} ${r[0]} unrouted has no miles`); continue; }
      routed++;
      const line = miles([r[4], r[5]], k === 'from' ? e.jobs_at : e.homes_at);
      ok(r[2] > 0 && r[3] > 0, `${g} ${r[0]} positive drive`);
      ok(r[3] >= line * 0.98 - 0.5, `${g} ${r[0]}: road ${r[3]} mi shorter than the straight line ${line.toFixed(1)}`);
      ok(r[3] < 3 || r[3] / (r[2] / 60) >= 12, `${g} ${r[0]}: ${r[3]} mi in ${r[2]} min is under 12 mph`);
      ok(r[3] < 10 || r[3] / (r[2] / 60) >= 20, `${g} ${r[0]}: ${r[3]} mi in ${r[2]} min is under 20 mph (the builder's slow rule)`);
      ok(line < 20 || r[3] <= line * 2.5, `${g} ${r[0]}: road ${r[3]} mi over 2.5 times a ${line.toFixed(1)}-mile line (the builder's detour rule)`);
      ok(line < 2 || r[3] <= line * 5.5, `${g} ${r[0]}: road ${r[3]} mi over 5.5 times the straight line ${line.toFixed(1)}`);
    }
  }
}
ok(routed > 2000, `routed drives ${routed}`);

// The Meeker-Rangely detour (139 road miles for about 60 by SH 64 and SH 13) is withheld, not published.
const mr = Object.values(T.places).flatMap((e) => e.from.concat(e.to)).filter((r) => /^(Meeker|Rangely) \(town\)$/.test(r[0]));
ok(mr.length > 0 && mr.every((r) => r[2] == null || r[3] < 80), 'Meeker-Rangely detour withheld');
ok(T.meta.not_shown_detour.some((r) => r[0] === 'Meeker (town)' && r[1] === 'Rangely (town)'), 'detour listed in meta');

// 4. Another state's county starts where its people live.
const sj = T.places['0822035'].from.find((r) => r[0] === 'San Juan County, NM');
ok(sj && Math.abs(sj[4] - 36.724) < 0.01 && Math.abs(sj[5] + 108.2202) < 0.01, 'San Juan County, NM 2020 centre of population');
ok(sj[2] > 45 && sj[2] < 90, `San Juan County, NM to Durango ${sj[2]} minutes`);

// 5. Meta.
ok(/OSRM/.test(T.meta.router.engine) && /Open Database License/.test(T.meta.router.odbl_notice), 'router and licence');
ok(/2024_Gaz_place_national/.test(T.meta.start_points.colorado) && /CenPop2020_Mean_CO/.test(T.meta.start_points.other_states), 'start points');

console.log(`commute-time-cost: ${checks} checks passed`);
