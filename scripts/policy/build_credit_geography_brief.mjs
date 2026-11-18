#!/usr/bin/env node
// Builds the research brief "Where Colorado's housing tax credits go"
// (data/policy_briefs_curated.json, id co-tax-credit-geography-2016-2026) and its
// data file (data/policy/credit-geography.json) from:
//   data/policy/funding-awards/ledger.json   every CHFA 9% and 4% award, 2016-2026 (CHFA award reports)
//   data/co-county-demographics.json         renter households and renters paying 50%+ of income (ACS 5-year)
//   data/chfa-lihtc.json                     CHFA's region for each county, and 4% bond deals CHFA awards
//                                            outside its rounds (CHFA tax credit property list, matched to
//                                            the award reports by matchBondDeals, as Funding vs Need does)
//   data/boundaries/counties_co.geojson      the 64 county names
// It works in two steps, so a weekly data refresh cannot leave the brief stale:
//   --refresh  recomputes the dated snapshot data/policy/credit-geography.json from
//              the inputs above, with the awards and bond deals it counted listed in it;
//   (default)  builds the brief from that snapshot alone.
// Every number in the brief comes from the snapshot, and the words are written here.
// Refresh when CHFA announces a round or ACS publishes a new 5-year release.
//
// Usage:
//   node scripts/policy/build_credit_geography_brief.mjs --refresh   recompute the snapshot, then the brief
//   node scripts/policy/build_credit_geography_brief.mjs             rebuild the brief from the snapshot
//   node scripts/policy/build_credit_geography_brief.mjs --check     fail if the committed brief differs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchBondDeals, RETURNED } from '../funding/build_funding_vs_need.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRIEF_ID = 'co-tax-credit-geography-2016-2026';
export const FEED = 'data/policy_briefs_curated.json';
export const DATA = 'data/policy/credit-geography.json';
export const LEDGER = 'data/policy/funding-awards/ledger.json';
export const DEMO = 'data/co-county-demographics.json';
export const PROPS = 'data/chfa-lihtc.json';
export const COUNTIES = 'data/boundaries/counties_co.geojson';

// The four regions along the Front Range, as CHFA's property list names them.
export const FRONT_RANGE = ['Denver Metro', 'Larimer/Weld', 'El Paso/Teller', 'Pueblo'];
// Counties with no tax credit property on CHFA's list carry no region there;
// each is placed with the neighbouring CHFA region it borders most.
export const REGION_BY_GEOGRAPHY = {
  '08009': 'Southeast', '08011': 'Southeast', '08017': 'Southeast', '08025': 'Southeast', '08061': 'Southeast',
  '08039': 'Northeast', '08095': 'Northeast', '08115': 'Northeast', '08121': 'Northeast',
  '08023': 'San Luis Valley', '08079': 'San Luis Valley',
  '08033': 'Western Slope', '08053': 'Western Slope', '08081': 'Western Slope', '08103': 'Western Slope', '08111': 'Western Slope',
  '08057': 'Mountain Rural/Resort',
};
export const PERIODS = [[2016, 2018], [2019, 2021], [2022, 2024], [2025, 2026]];
// An index is shown for a county only when it has enough renters paying half
// their income for the ratio to mean something.
export const MIN_SEVERE = 500;

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
export const fmt = (n) => Number(n).toLocaleString('en-US');
export const musd = (n, d = 1) => '$' + (n / 1e6).toFixed(d) + 'M';
// County credit: under $1M in thousands, so no cell reads like an equity price ($0.80).
export const countyUsd = (n) => (!n ? '$0' : n < 1e6 ? '$' + Math.round(n / 1e3).toLocaleString('en-US') + 'K' : musd(n, 2));
const pct1 = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0.0') + '%';
const pct0 = (a, b) => (b ? Math.round((100 * a) / b) : 0) + '%';
const idx = (x) => x.toFixed(1);
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const say = (n) => (n <= 10 ? words[n] : String(n));
const list = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
const r1 = (x) => Math.round(x * 10) / 10;

export function regions(props, countyNames) {
  const votes = {};
  for (const f of props.features) {
    const p = f.properties;
    if (!p.CNTY_FIPS || !p.Region) continue;
    (votes[p.CNTY_FIPS] ||= {})[p.Region] = (votes[p.CNTY_FIPS][p.Region] || 0) + 1;
  }
  const out = {};
  for (const fips of Object.keys(countyNames)) {
    const v = votes[fips];
    if (v) out[fips] = { region: Object.entries(v).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], method: 'CHFA property list' };
    else out[fips] = { region: REGION_BY_GEOGRAPHY[fips], method: 'by geography (no tax credit property on CHFA list)' };
    if (!out[fips].region) throw new Error(`no region for ${fips} ${countyNames[fips]}`);
  }
  return out;
}

export function compute(ledger, demo, props, counties) {
  const names = Object.fromEntries(counties.features.map((f) => [f.properties.GEOID, f.properties.NAME]));
  const reg = regions(props, names);
  const byFips = Object.fromEntries(Object.values(demo.counties).map((c) => [c.fips, c]));
  // A returned award built no homes (CHFA: "Project did not proceed. Award returned").
  const returned = ledger.awards.filter((a) => /^LIHTC (9|4)%/.test(a.program) && RETURNED.test(a.detail || ''));
  const awards = ledger.awards.filter((a) => /^LIHTC (9|4)%/.test(a.program) && !RETURNED.test(a.detail || ''));
  const skipped = awards.filter((a) => !a.county_fips || !names[a.county_fips]);
  const used = awards.filter((a) => a.county_fips && names[a.county_fips]);
  const kind = (a) => (a.program.startsWith('LIHTC 9%') ? '9' : '4');
  const homes = (a) => a.restricted_units ?? a.total_units ?? 0;

  const C = {};
  for (const fips of Object.keys(names).sort()) {
    const d = byFips[fips] || {};
    C[fips] = {
      fips, name: names[fips], region: reg[fips].region, region_method: reg[fips].method,
      renter_households: d.rent_burden_universe || 0, renters_paying_half: d.renters_burdened_50_plus || 0,
      awards_9: 0, homes_9: 0, credit_9: 0, awards_4: 0, homes_4_rounds: 0, bond_deals_outside_rounds: 0, homes_4_outside_rounds: 0, homes_4: 0, credit_4: 0, state_credit: 0, years_9: [],
    };
  }
  for (const a of used) {
    const c = C[a.county_fips], k = kind(a);
    c['awards_' + k] += 1; c['homes_' + k] += homes(a); c['credit_' + k] += a.federal_credit || 0; c.state_credit += a.state_credit || 0;
    if (k === '4') c.homes_4_rounds += homes(a);
    if (k === '9' && !c.years_9.includes(a.year)) c.years_9.push(a.year);
  }
  // 4% bond deals CHFA awards outside its rounds are not in the round reports.
  const span = [Math.min(...used.map((a) => a.year)), Math.max(...used.map((a) => a.year))];
  const bond = matchBondDeals(props.features.map((f) => f.properties || {}), ledger.awards.filter((a) => !RETURNED.test(a.detail || '')), { firstYear: span[0], lastYear: span[1] });
  const bondUsed = bond.added.filter((d) => C[d.county_fips]);
  for (const d of bondUsed) {
    const c = C[d.county_fips];
    c.bond_deals_outside_rounds += 1; c.homes_4_outside_rounds += d.homes || 0; c.homes_4 += d.homes || 0;
  }
  const sumKeys = ['renter_households', 'renters_paying_half', 'awards_9', 'homes_9', 'credit_9', 'awards_4', 'homes_4_rounds', 'bond_deals_outside_rounds', 'homes_4_outside_rounds', 'homes_4', 'credit_4', 'state_credit'];
  const add = (rows) => Object.fromEntries(sumKeys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)]));
  const T = add(Object.values(C));
  const index = (x) => (x.renters_paying_half ? (x.credit_9 / x.renters_paying_half) / (T.credit_9 / T.renters_paying_half) : 0);
  for (const c of Object.values(C)) { c.years_9.sort(); c.index_9 = r1(index(c)); }

  const regionNames = [...new Set(Object.values(C).map((c) => c.region))];
  const R = Object.fromEntries(regionNames.map((r) => {
    const rows = Object.values(C).filter((c) => c.region === r);
    const x = add(rows);
    return [r, { region: r, front_range: FRONT_RANGE.includes(r), counties: rows.map((c) => c.name), ...x, index_9: r1(index(x)) }];
  }));
  const regionOrder = Object.values(R).sort((a, b) => b.renters_paying_half - a.renters_paying_half).map((r) => r.region);
  const front = add(Object.values(R).filter((r) => r.front_range));
  const rest = add(Object.values(R).filter((r) => !r.front_range));

  const years = [...new Set(used.map((a) => a.year))].sort();
  const byYear = years.map((y) => {
    const ys = used.filter((a) => a.year === y);
    const out = { year: y, homes_9: 0, homes_9_outside_front_range: 0, homes_4: 0, homes_4_outside_front_range: 0, homes_9_by_region: {} };
    for (const a of ys) {
      const k = kind(a), h = homes(a), r = C[a.county_fips].region, outside = !FRONT_RANGE.includes(r);
      out['homes_' + k] += h;
      if (outside) out[`homes_${k}_outside_front_range`] += h;
      if (k === '9') out.homes_9_by_region[r] = (out.homes_9_by_region[r] || 0) + h;
    }
    for (const d of bondUsed.filter((d) => d.award_year === y)) {
      out.homes_4 += d.homes || 0;
      if (!FRONT_RANGE.includes(C[d.county_fips].region)) out.homes_4_outside_front_range += d.homes || 0;
    }
    out.counties_9 = new Set(ys.filter((a) => kind(a) === '9').map((a) => a.county_fips)).size;
    out.awards_9 = ys.filter((a) => kind(a) === '9').length;
    return out;
  });

  // How often a county outside the Front Range won a 9% award the year after one.
  const repeats = { county_years: 0, next_year: 0, cases: [], cases_since_2020: [] };
  for (const c of Object.values(C)) {
    if (FRONT_RANGE.includes(c.region)) continue;
    for (const y of c.years_9) {
      if (y >= years[years.length - 1]) continue;
      repeats.county_years += 1;
      if (c.years_9.includes(y + 1)) {
        repeats.next_year += 1; repeats.cases.push(`${c.name} ${y}-${y + 1}`);
        if (y >= 2020) repeats.cases_since_2020.push({ county: c.name, years: [y, y + 1] });
      }
    }
  }
  return { C, R, T, regionOrder, front, rest, byYear, repeats, skipped, returned, years, used, bond: { candidates: bond.candidates, matched: bond.matched.length, added: bondUsed, feedLastYear: Math.max(...props.features.map((f) => f.properties?.AwardYear).filter(Number.isInteger)) } };
}

export function dataFile(x, ledger, demo, verified) {
  const y0 = x.years[0];
  const homes = (a) => a.restricted_units ?? a.total_units ?? 0;
  return {
    metadata: {
      verified,
      title: "Where Colorado's housing tax credits go, 2016-2026",
      generator: 'scripts/policy/build_credit_geography_brief.mjs',
      awards_source: LEDGER,
      awards_generated_at: ledger.meta.generated_at,
      need_source: DEMO,
      need_vintage: `ACS ${demo.meta?.dataset || '5-year'}`,
      acs_year: demo.statewide?.acs_year ?? null,
      feed_last_award_year: x.bond.feedLastYear,
      report_links_9pct: [...new Map(ledger.awards.filter((a) => /^LIHTC 9%/.test(a.program) && a.year >= y0).map((a) => [a.year, a.source_url])).entries()]
        .sort((a, b) => a[0] - b[0]).map(([year, link]) => ({ year, link })),
      region_source: PROPS,
      years: [x.years[0], x.years[x.years.length - 1]],
      index_note: "index_9 = a county's (or region's) share of Colorado's 9% federal credit divided by its share of Colorado renter households paying 50% or more of income for rent. 1.0 = the state rate.",
      credit_note: 'credit_9, credit_4 and state_credit are the yearly credit amounts CHFA prints, added up over every award; they are not 10-year totals.',
      homes_note: 'Homes are the income-restricted rental homes CHFA prints for each award (total homes where restricted is blank). homes_4 adds 4% bond deals CHFA awarded outside its rounds (homes_4_outside_rounds): properties on CHFA\'s tax credit list with a 4% award year in the window that no round award accounts for (matchBondDeals in scripts/funding/build_funding_vs_need.mjs). Those carry homes but no credit amount.',
      bond_match: { feed_4pct_properties_in_window: x.bond.candidates, matched_to_round_awards: x.bond.matched, added_outside_rounds: x.bond.added.length },
      returned_awards: x.returned.map((a) => ({ name: a.name, year: a.year, program: a.program, reason: 'award returned; no homes built' })),
      skipped_awards: x.skipped.map((a) => ({ name: a.name, year: a.year, program: a.program, reason: 'no county on the award report or CHFA list' })),
    },
    totals: x.T,
    front_range: x.front,
    rest_of_state: x.rest,
    regions: x.regionOrder.map((r) => x.R[r]),
    counties: Object.values(x.C),
    by_year: x.byYear,
    next_year_repeats_outside_front_range: x.repeats,
    awards_counted: x.used.map((a) => ({ name: a.name, year: a.year, round: a.round ?? null, program: a.program, county_fips: a.county_fips, homes: homes(a), federal_credit: a.federal_credit || 0, state_credit: a.state_credit || 0 })),
    bond_deals_outside_rounds: x.bond.added.map((d) => ({ name: d.name, county_fips: d.county_fips, award_year: d.award_year, homes: d.homes, chfa_record_id: d.chfa_record_id })),
  };
}

// The brief reads only the snapshot.
export function buildBrief(D) {
  const M = D.metadata;
  const x = {
    C: Object.fromEntries(D.counties.map((c) => [c.fips, c])),
    R: Object.fromEntries(D.regions.map((r) => [r.region, r])),
    T: D.totals, front: D.front_range, rest: D.rest_of_state, byYear: D.by_year,
    repeats: D.next_year_repeats_outside_front_range, regionOrder: D.regions.map((r) => r.region),
    skipped: M.skipped_awards, years: D.by_year.map((y) => y.year), bond: { feedLastYear: M.feed_last_award_year },
  };
  const verified = M.verified;
  const { C, R, T, front, rest, byYear, repeats, regionOrder } = x;
  const ws = R['Western Slope'];
  const wsCounties = Object.values(C).filter((c) => c.region === 'Western Slope' && c.renters_paying_half >= MIN_SEVERE)
    .sort((a, b) => b.renters_paying_half - a.renters_paying_half);
  const wsTop = wsCounties[0];
  const wsHigh = [...wsCounties].sort((a, b) => b.index_9 - a.index_9).slice(0, 3);
  const ranked = Object.values(C).filter((c) => c.renters_paying_half >= MIN_SEVERE).sort((a, b) => b.index_9 - a.index_9);
  const none9 = Object.values(C).filter((c) => c.awards_9 === 0);
  const noneAny = Object.values(C).filter((c) => c.awards_9 === 0 && c.awards_4 === 0 && c.bond_deals_outside_rounds === 0);
  const noneBig = none9.filter((c) => c.renters_paying_half >= MIN_SEVERE).sort((a, b) => b.renters_paying_half - a.renters_paying_half);
  const restRegions = regionOrder.filter((r) => !R[r].front_range);
  const zero4 = restRegions.filter((r) => R[r].homes_4 === 0);
  const wsByYear = byYear.map((y) => ({ year: y.year, share: y.homes_9 ? (y.homes_9_by_region['Western Slope'] || 0) / y.homes_9 : 0 }));
  const wsMax = wsByYear.reduce((a, b) => (b.share > a.share ? b : a));
  const wsMin = wsByYear.reduce((a, b) => (b.share < a.share ? b : a));
  const y0 = x.years[0], y1 = x.years[x.years.length - 1];
  const awards9 = byYear.map((y) => y.awards_9), counties9 = byYear.map((y) => y.counties_9);
  const per1000 = (c) => (1000 * c.homes_9) / c.renter_households;
  const wsOther = { homes_9: ws.homes_9 - wsTop.homes_9, renter_households: ws.renter_households - wsTop.renter_households };
  const since2020 = repeats.cases_since_2020.map((c) => `${c.county} (${c.years.join(' and ')})`);

  const short = [
    `All of these homes are rentals with income limits. From ${y0} to ${y1}, CHFA awarded the competitive 9% credit to ${fmt(T.awards_9)} buildings with ${fmt(T.homes_9)} homes, and the 4% credit, paired with tax-exempt bonds, to ${fmt(T.awards_4 + T.bond_deals_outside_rounds)} deals with ${fmt(T.homes_4)} homes. ${fmt(T.bond_deals_outside_rounds)} of those 4% deals (${fmt(T.homes_4_outside_rounds)} homes) were bond deals CHFA awarded outside its two yearly rounds.`,
    `The 9% credit reaches well beyond the Front Range. The four Front Range regions have ${pct0(front.renters_paying_half, T.renters_paying_half)} of the renters who pay half their income or more for rent, and they received ${pct0(front.credit_9, T.credit_9)} of the 9% credit. The rest of Colorado has ${pct0(rest.renters_paying_half, T.renters_paying_half)} of those renters and received ${pct0(rest.credit_9, T.credit_9)}.`,
    `The 4% credit stays on the Front Range: ${pct0(front.homes_4, T.homes_4)} of its homes. Bond deals need enough homes to carry their fixed costs, so they rarely reach small towns. ${zero4.length ? `The ${list(zero4)} region${zero4.length > 1 ? 's' : ''} had no 4% homes at all.` : `The ${list(restRegions.filter((r) => R[r].homes_4 / T.homes_4 < 0.01))} regions each had under 1% of them.`}`,
    `The Western Slope has ${pct1(ws.renters_paying_half, T.renters_paying_half)} of these renters and received ${pct1(ws.credit_9, T.credit_9)} of the 9% credit, about ${idx(ws.index_9)} times the state rate.`,
    `Counties within a region differ a lot. ${wsTop.name}, the Western Slope's largest county, has ${pct0(wsTop.renters_paying_half, ws.renters_paying_half)} of the region's renters paying half their income and received ${pct0(wsTop.credit_9, ws.credit_9)} of its 9% credit, an index of ${idx(wsTop.index_9)}. ${list(wsHigh.map((c) => `${c.name} is at ${idx(c.index_9)}`))}.`,
    `${none9.length} of Colorado's 64 counties had no 9% award in these years, and ${noneAny.length} had no tax credit award at all. The largest without a 9% award ${noneBig.length === 1 ? 'is' : 'are'} ${list(noneBig.slice(0, 4).map((c) => `${c.name} (${fmt(c.renters_paying_half)} renter households paying half or more)`))}.`,
  ];

  const regionTable = {
    caption: `CHFA regions, awards ${y0} to ${y1}. Shares are of the Colorado total. Index: share of 9% credit divided by share of renters paying 50%+ of income (1.0 = state rate).`,
    columns: ['Region', 'Renter households', 'Renters paying 50%+ of income', '9% awards', '9% homes', '9% credit (yearly amounts, added up)', '4% homes', 'Index'],
    rows: regionOrder.map((r) => {
      const v = R[r];
      return [r, pct1(v.renter_households, T.renter_households), pct1(v.renters_paying_half, T.renters_paying_half), String(v.awards_9), pct1(v.homes_9, T.homes_9), pct1(v.credit_9, T.credit_9), pct1(v.homes_4, T.homes_4), idx(v.index_9)];
    }).concat([['Colorado', fmt(T.renter_households), fmt(T.renters_paying_half), fmt(T.awards_9), fmt(T.homes_9), musd(T.credit_9), fmt(T.homes_4), '1.0']]),
  };

  const countyRows = Object.values(C).sort((a, b) => b.renters_paying_half - a.renters_paying_half);
  const countyTable = {
    caption: `All 64 counties, largest need first. The index is left blank where fewer than ${fmt(MIN_SEVERE)} renter households pay 50%+ of income, because a single award swings it.`,
    columns: ['County', 'CHFA region', 'Renters paying 50%+ of income', '9% awards', '9% homes', '9% credit (yearly, added up)', '4% homes', 'Index'],
    rows: countyRows.map((c) => [c.name, c.region, fmt(c.renters_paying_half), String(c.awards_9), fmt(c.homes_9), countyUsd(c.credit_9), fmt(c.homes_4), c.renters_paying_half >= MIN_SEVERE ? idx(c.index_9) : '']),
  };

  const periodTable = {
    caption: 'Homes awarded by period. "Outside the Front Range" is every region except Denver Metro, Larimer/Weld, El Paso/Teller and Pueblo.',
    columns: ['Awards', '9% homes', 'Share outside the Front Range', 'Share on the Western Slope', '4% homes', 'Share outside the Front Range'],
    rows: PERIODS.map(([a, b]) => {
      const ys = byYear.filter((y) => y.year >= a && y.year <= b);
      const s = (k) => ys.reduce((t, y) => t + y[k], 0);
      const wsh = ys.reduce((t, y) => t + (y.homes_9_by_region['Western Slope'] || 0), 0);
      return [`${a} to ${b}`, fmt(s('homes_9')), pct0(s('homes_9_outside_front_range'), s('homes_9')), pct0(wsh, s('homes_9')), fmt(s('homes_4')), pct0(s('homes_4_outside_front_range'), s('homes_4'))];
    }),
  };

  const yearTable = {
    caption: 'The 9% round each year',
    columns: ['Year', '9% awards', 'Counties', '9% homes', 'Outside the Front Range', 'Western Slope'],
    rows: byYear.map((y) => [String(y.year), String(y.awards_9), String(y.counties_9), fmt(y.homes_9), pct0(y.homes_9_outside_front_range, y.homes_9), pct0(y.homes_9_by_region['Western Slope'] || 0, y.homes_9)]),
  };

  const reportLinks = M.report_links_9pct.map((r) => [r.year, r.link]);

  return {
    id: BRIEF_ID,
    title: "Where Colorado's housing tax credits go: awards against renter need, county by county",
    policy_topic: 'Colorado Housing Policy & LIHTC',
    is_curated: true,
    source_reviewed: true,
    generated: `${verified}T00:00:00Z`,
    verified,
    takeaway: `CHFA's competitive 9% tax credit reaches well beyond the Front Range: the rest of Colorado has ${pct0(rest.renters_paying_half, T.renters_paying_half)} of renters paying half their income for rent and received ${pct0(rest.credit_9, T.credit_9)} of the 9% credit from ${y0} to ${y1}. The 4% bond credit stays on the Front Range (${pct0(front.homes_4, T.homes_4)} of its homes). Within regions, counties differ a lot, and ${none9.length} counties had no 9% award.`,
    summary: `This brief adds up every CHFA housing tax credit award from ${y0} to ${y1}, ${fmt(T.awards_9)} 9% awards and ${fmt(T.awards_4 + T.bond_deals_outside_rounds)} 4% deals (${fmt(T.awards_4)} in CHFA's rounds and ${fmt(T.bond_deals_outside_rounds)} bond deals awarded outside them), by county and by CHFA region. It compares them with the renter households in each place that pay 50% or more of their income for rent (American Community Survey ${M.acs_year - 4}-${M.acs_year}, table B25070; renter households are those for which Census computes rent as a share of income). All of these homes are rentals with income limits; tax credits fund no homes for sale. An index of 1.0 means a place got the same share of 9% credit as its share of those renters.`,
    implications: `For a town outside the Front Range, the 9% round is the realistic path: 4% bond deals have rarely reached a small town. Because the 2027-28 plan has no regional set-asides, each year's result depends on who applies, so a region's share swings from year to year. For anyone reading the county table: a high index is not a sign of too much housing, and a low one is not a sign of neglect. A single 50-home award moves a small county a long way, and the index does not count homes funded before ${y0} or by other programs.`,
    related_data: DATA,
    sources: ['CHFA', 'U.S. Census Bureau, American Community Survey'],
    regions: ['Colorado', 'Statewide', ...regionOrder],
    sections: [
      { id: 'short', heading: 'The short version', items: short },
      {
        id: 'map', heading: 'The map',
        paragraphs: [`Each county is shaded by its index: its share of Colorado's 9% credit from ${y0} to ${y1}, divided by its share of renter households paying 50% or more of income. Darker means more 9% credit for its need. Tap or hover a county for its figures.`],
        map: 'credit-geography',
      },
      { id: 'regions', heading: 'By CHFA region', table: regionTable },
      {
        id: 'within', heading: 'Within a region',
        paragraphs: [
          `A region's total can hide large differences between its counties. On the Western Slope, ${wsTop.name} County received ${fmt(Math.round(per1000(wsTop)))} 9% homes for every 1,000 renter households, against ${fmt(Math.round((1000 * wsOther.homes_9) / wsOther.renter_households))} in the rest of the region and ${fmt(Math.round((1000 * T.homes_9) / T.renter_households))} in Colorado as a whole.`,
          `Of the ${ranked.length} counties with at least ${fmt(MIN_SEVERE)} renter households paying half their income, the highest index is ${ranked[0].name} (${idx(ranked[0].index_9)}) and the lowest with any 9% award is ${ranked.filter((c) => c.awards_9).slice(-1)[0].name} (${idx(ranked.filter((c) => c.awards_9).slice(-1)[0].index_9)}).`,
        ],
        table: countyTable,
      },
      {
        id: 'time', heading: 'Over time',
        paragraphs: [
          `CHFA funds ${Math.min(...awards9)} to ${Math.max(...awards9)} 9% buildings a year in ${Math.min(...counties9)} to ${Math.max(...counties9)} counties. The Western Slope's share of 9% homes ranged from ${pct0(wsMin.share, 1)} in ${wsMin.year} to ${pct0(wsMax.share, 1)} in ${wsMax.year}. CHFA held its 9% round in the second round of the year until 2019 and in Round One from 2020.`,
          `Back-to-back years are uncommon outside the Front Range. Of the ${repeats.county_years} times a county there won a 9% award, it won another the next year ${say(repeats.next_year)} times. Since 2020, ${since2020.length ? 'only ' + list(since2020) + (since2020.length === 1 ? ' has' : ' have') + ' done it' : 'none has'}.`,
        ],
        table: periodTable,
      },
      { id: 'years', heading: 'The 9% round by year', table: yearTable },
      {
        id: 'limits', heading: 'Limits of this brief',
        items: [
          'Counts are by county. A county total does not show which towns in it were served.',
          'Credit amounts are the yearly amounts CHFA prints at award, added up across awards. Later exchanges or changes are not shown. Awards CHFA reports as returned are left out.',
          `4% bond deals CHFA awarded outside its rounds are not in the round reports. They are the ${fmt(T.bond_deals_outside_rounds)} properties on CHFA's tax credit list with a 4% award year from ${y0} to ${y1} that no round award accounts for, matched the same way as the site's Funding vs Need tab. They count in 4% homes, with no credit amount.${x.bond.feedLastYear < y1 ? ` CHFA's list has no award year after ${x.bond.feedLastYear} yet, so bond deals outside the rounds after that are not counted.` : ''}`,
          'Renters paying 50% or more of income is one measure of need. It counts renters only; homeowners are not part of this comparison.',
          `Regions are as CHFA's tax credit property list groups counties. ${say(Object.values(C).filter((c) => c.region_method !== 'CHFA property list').length)[0].toUpperCase() + say(Object.values(C).filter((c) => c.region_method !== 'CHFA property list').length).slice(1)} counties with no property on that list were placed with the CHFA region they border.`,
          ...x.skipped.map((a) => `One ${a.year} award on CHFA's 9% report (${a.name}) has no county on CHFA's report and is left out.`),
          `The index covers ${y0} to ${y1} only. It does not count homes funded earlier, or by Proposition 123, HOME, Division of Housing or local money.`,
        ],
      },
    ],
    articles: [
      { title: 'Housing Tax Credit Awards (all years)', source: 'CHFA', date: verified, link: 'https://www.chfainfo.com/rental-housing/housing-credit/awards' },
      ...reportLinks.map(([y, link]) => ({ title: `${y} 9% Housing Tax Credit Award Report (read ${verified})`, source: 'CHFA', date: verified, link })),
      { title: `American Community Survey ${M.acs_year - 4}-${M.acs_year} 5-year, table B25070 (gross rent as a share of household income), read ${verified}`, source: 'U.S. Census Bureau', date: verified, link: 'https://data.census.gov/table/ACSDT5Y2024.B25070' },
    ],
    alert_count: 0,
  };
}

export function snapshot(verified) {
  const ledger = read(LEDGER), demo = read(DEMO);
  const x = compute(ledger, demo, read(PROPS), read(COUNTIES));
  return dataFile(x, ledger, demo, verified);
}

export function build({ refresh = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const D = refresh ? snapshot(today) : read(DATA);
  const feed = read(FEED);
  const brief = buildBrief(D);
  const i = feed.briefs.findIndex((b) => b.id === BRIEF_ID);
  if (i === -1) feed.briefs.unshift(brief); else feed.briefs[i] = brief;
  feed.meta.brief_count = feed.briefs.length;
  return {
    ...(refresh ? { [DATA]: JSON.stringify(D, null, 1) + '\n' } : {}),
    [FEED]: JSON.stringify(feed, null, 2) + '\n',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const files = build({ refresh: !check && process.argv.includes('--refresh') });
  let stale = 0;
  for (const [rel, body] of Object.entries(files)) {
    const full = join(ROOT, rel);
    let now = null;
    try { now = readFileSync(full, 'utf8'); } catch { /* new file */ }
    if (now === body) continue;
    if (check) { console.error(`${rel} is stale: run node scripts/policy/build_credit_geography_brief.mjs`); stale++; continue; }
    writeFileSync(full, body);
    console.log(`wrote ${rel}`);
  }
  if (stale) process.exit(1);
  if (check) console.log('Credit geography brief: up to date');
}
