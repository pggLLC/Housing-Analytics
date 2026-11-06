#!/usr/bin/env node
/**
 * scripts/funding/build_funding_vs_need.mjs — where public housing subsidy has
 * gone, county by county, against the need and market the site measures.
 *
 * Reads the award ledger (scripts/funding/build_funding_awards.py), the county
 * rows of the ranking index, building permits against projected need, CHFA's
 * 2026 rent limits, and CHFA's tax credit property list (data/chfa-lihtc.json).
 *
 * The ledger is built from CHFA's round award reports, and most 4% credits
 * paired with private activity bonds are awarded outside the rounds, so they
 * are not in it. The property list has them. Each 4% property on the list with
 * an award year in the ledger window is matched to the ledger (matchBondDeals);
 * the ones no round award accounts for are added to the county's tax credit
 * homes as bond deals outside the rounds. The round-report figures are kept
 * beside the totals. Writes data/derived/funding-vs-need.json, which the
 * Funding vs Need tab of colorado-deep-dive.html renders.
 *
 * It is a step of the derived chain (scripts/rebuild-derived.mjs) because it
 * reads the ranking index. Every measure that cannot be computed is null with
 * the reason beside it; nothing is defaulted to zero.
 *
 * Usage: node scripts/funding/build_funding_vs_need.mjs [--check]
 *   --check  exit 1 if the committed output differs from a fresh build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INPUTS = {
  ledger: path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json'),
  documents: path.join(ROOT, 'data', 'policy', 'funding-awards', 'documents.json'),
  ranking: path.join(ROOT, 'data', 'hna', 'ranking-index.json'),
  permits: path.join(ROOT, 'data', 'hna', 'permits.json'),
  limits: path.join(ROOT, 'data', 'chfa-income-rent-limits-2026.json'),
  feed: path.join(ROOT, 'data', 'chfa-lihtc.json'),
};
const OUTPUT = path.join(ROOT, 'data', 'derived', 'funding-vs-need.json');

// The site's active-market vacancy (ACS for-rent plus for-sale-only vacant
// units over all units, so seasonal homes do not count) is flagged when a
// county is in the loosest quarter of Colorado counties. Production is flagged
// when five years of permits ran at least twice DOLA's projected household
// growth. Both are relative signals, stated as such on the page.
export const VACANCY_QUANTILE = 0.75;
export const PRODUCTION_PACE = 2;

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

function median(values) {
  const v = values.filter((x) => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// ── Matching CHFA's property list to the round award ledger ──────────────
// Names differ between the two (a building number, "fka:", "Apartments",
// a placeholder address renamed at lease-up), so a feed property counts as
// already in the ledger when any of these holds, against a LIHTC award in the
// same county (or one the ledger could not place) awarded within two years:
//   1. names alike (similarity ≥ NAME_SURE);
//   2. names partly alike (≥ NAME_WITH_UNITS) sharing a distinctive word, in
//      the same town, award years within one, and restricted homes within
//      UNIT_TOLERANCE;
//   3. the same award year and town, names alike (≥ NAME_PART) sharing a
//      distinctive word, and fewer homes than the award (one building of a
//      multi-building award, e.g. "DHA 655 Broadway" in "DHA 655 Broadway/Studebaker");
//   4. otherwise, a 4% round award no feed property matched by name, in the same
//      county and town, award years within one, and homes within one (a renamed
//      deal), paired one to one, closest first.
// A scattered-site award's sites (printed in its detail) count as its names,
// and a site also matches by the homes the award prints for it.
// Names with different phase marks never match (Central Park III is not
// Central Park II), and a pair in different towns matches only on rule 1.
// Rules 1-3 may match several feed properties to one award; rule 4 never does.
// A feed property that matches nothing is a bond deal outside the rounds.
export const NAME_SURE = 0.8;
export const NAME_WITH_UNITS = 0.5;
export const NAME_PART = 0.6;
const STOP = new Set(['the', 'a', 'and', 'at', 'of', 'on', 'apartments', 'apartment', 'apts', 'apt', 'lp', 'llc', 'ltd', 'homes', 'residences', 'phase', 'senior', 'seniors']);
const GENERIC = new Set(['flats', 'village', 'villas', 'crossing', 'crossings', 'vista', 'view', 'commons', 'place', 'park', 'station', 'street', 'square', 'plaza', 'lofts', 'court', 'gardens', 'house', 'manor', 'ridge', 'creek', 'heights', 'north', 'south', 'east', 'west', 'avenue', 'building', 'redevelopment', 'community', 'family', 'housing']);
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));

function longestCommon(a, b) {
  let best = [0, 0, 0];
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best[2]) best = [i - cur[j], j - cur[j], cur[j]];
      }
    }
    prev = cur;
  }
  return best;
}
function matchingChars(a, b) {
  if (!a.length || !b.length) return 0;
  const [i, j, k] = longestCommon(a, b);
  if (!k) return 0;
  return k + matchingChars(a.slice(0, i), b.slice(0, j)) + matchingChars(a.slice(i + k), b.slice(j + k));
}
// Ratcliff/Obershelp similarity of two names (what Python's difflib.ratio computes)
export function nameSimilarity(x, y) {
  const a = words(x).join(' ');
  const b = words(y).join(' ');
  return a.length + b.length ? (2 * matchingChars(a, b)) / (a.length + b.length) : 0;
}
// "Remington fka: DMA Plaza Renovation" is two names for one deal, and a
// scattered-site award prints its sites in the detail ("scattered site:
// English Village (32), Laguna Place (8)"), each a property on CHFA's list
function altNames(a) {
  const names = String(a.name || '').split(/\bf\.?k\.?a\.?:?/i);
  const m = /scattered site:\s*(.*)$/i.exec(a.detail || '');
  if (m) names.push(...m[1].split(/,(?![^(]*\))/).map((x) => x.replace(/\([^)]*\)/g, '')));
  return names.map((x) => x.trim()).filter(Boolean);
}
// Phase marks ("II", "Phase 3", "Building 2"). CHFA's list ends a twin deal's
// names with its credit ("Sol 4", "Ives II 9"); that last 4 or 9 is not a phase.
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
function phases(name) {
  const w = String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (w.length > 1 && /^[49]$/.test(w[w.length - 1])) w.pop();
  const out = new Set();
  w.forEach((t, i) => {
    if (ROMAN[t] && i > 0) out.add(ROMAN[t]);
    else if (/^[1-9]$/.test(t) && i > 0) out.add(Number(t));
  });
  return out;
}
const phaseConflict = (x, y) => {
  const a = phases(x);
  const b = phases(y);
  return a.size > 0 && b.size > 0 && ![...a].some((v) => b.has(v));
};
// The ledger's location can name several towns ("Longmont, Boulder") or
// carry sponsor words ("Glenwood Springs CHFA"); a pair whose town is not in
// it is two deals in one county unless the names say otherwise
const town = (s) => ' ' + String(s || '').toLowerCase().replace(/\b(city|town) of\b/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
function townsDiffer(p, a) {
  const city = town(p.PROJ_CTY);
  const loc = town(a.location);
  return Boolean(city.trim() && loc.trim() && !loc.includes(city));
}
// a scattered-site award's sites with the homes it prints for each
function sites(a) {
  const m = /scattered site:\s*(.*)$/i.exec(a.detail || '');
  if (!m) return [];
  return m[1].split(/,(?![^(]*\))/).map((x) => {
    const h = /\((\d+)(?:\s*units?)?\)/i.exec(x);
    return { name: x.replace(/\([^)]*\)/g, '').trim(), homes: h ? Number(h[1]) : null };
  });
}

export function matchBondDeals(feedProps, awards, { firstYear, lastYear }) {
  const lihtc = awards.filter((a) => String(a.program || '').startsWith('LIHTC'));
  const homes = (a) => num(a.restricted_units) ?? num(a.total_units);
  const feedHomes = (p) => num(p.LI_UNITS) ?? num(p.N_UNITS);
  const close = (x, y, tol) => x !== null && y !== null && Math.abs(x - y) <= tol;
  const UNIT_TOLERANCE = (x, y) => Math.max(2, 0.05 * Math.max(x ?? 0, y ?? 0));
  const bond = feedProps.filter((p) => /^4%/.test(p.TypeOfCredits || '') && Number.isInteger(p.AwardYear) && p.AwardYear >= firstYear && p.AwardYear <= lastYear);

  const matched = [];
  const left = [];
  for (const p of bond) {
    const pw = words(p.ReportedName || p.PROJECT);
    const fu = feedHomes(p);
    let best = null;
    for (const a of lihtc) {
      if (a.county_fips && a.county_fips !== p.CNTY_FIPS) continue;
      const dy = Math.abs(p.AwardYear - a.year);
      if (dy > 2) continue;
      const au = homes(a);
      const elsewhere = townsDiffer(p, a);
      for (const alt of altNames(a)) {
        const pname = p.ReportedName || p.PROJECT;
        if (phaseConflict(pname, alt)) continue; // Central Park III is not Central Park II
        const r = nameSimilarity(pname, alt);
        const aw = words(alt);
        const shared = pw.some((w) => w.length >= 3 && !GENERIC.has(w) && aw.includes(w));
        const rule = r >= NAME_SURE ? 'name'
          : elsewhere || !shared ? null
            : r >= NAME_WITH_UNITS && dy <= 1 && close(fu, au, UNIT_TOLERANCE(fu, au)) ? 'name and homes'
              : r >= NAME_PART && dy === 0 && fu !== null && au !== null && fu < au ? 'one building of the award'
                : null;
        if (rule && (!best || r > best.r)) best = { a, r, rule };
      }
      // a site of a scattered-site award, by the homes the award prints for it
      // ("Renova 5 English Village", 32 homes = "Engish Village (32)")
      if (!best && dy <= 1 && !elsewhere) {
        const site = sites(a).find((x) => x.homes !== null && close(fu, x.homes, 1));
        if (site) best = { a, r: nameSimilarity(p.ReportedName || p.PROJECT, site.name), rule: 'site of a scattered-site award' };
      }
    }
    if (best) matched.push({ p, a: best.a, rule: best.rule, similarity: Math.round(best.r * 100) / 100 });
    else left.push(p);
  }

  // rule 4: renamed deals, one to one by homes and year
  const claimed = new Set(matched.map((m) => m.a));
  const open = lihtc.filter((a) => a.federal_credit_type === '4%' && !claimed.has(a));
  const pairs = [];
  for (const p of left) {
    for (const a of open) {
      if (a.county_fips !== p.CNTY_FIPS || townsDiffer(p, a) || phaseConflict(p.ReportedName || p.PROJECT, a.name)) continue;
      const dy = Math.abs(p.AwardYear - a.year);
      const fu = feedHomes(p);
      const au = homes(a);
      if (dy <= 1 && close(fu, au, 1)) pairs.push({ p, a, d: Math.abs(fu - au), dy });
    }
  }
  pairs.sort((x, y) => x.d - y.d || x.dy - y.dy || String(x.p.ReportedName).localeCompare(String(y.p.ReportedName)));
  const usedP = new Set();
  const usedA = new Set();
  for (const q of pairs) {
    if (usedP.has(q.p) || usedA.has(q.a)) continue;
    usedP.add(q.p); usedA.add(q.a);
    matched.push({ p: q.p, a: q.a, rule: 'homes and year (renamed)', similarity: Math.round(nameSimilarity(q.p.ReportedName || q.p.PROJECT, q.a.name) * 100) / 100 });
  }
  const added = left.filter((p) => !usedP.has(p)).map((p) => ({
    name: p.ReportedName || p.PROJECT,
    county_fips: p.CNTY_FIPS,
    city: p.PROJ_CTY || null,
    award_year: p.AwardYear,
    credit: p.TypeOfCredits,
    project_type: p.ProjectType || null,
    homes: feedHomes(p),
    chfa_record_id: p.CHFA_RecordID ?? null,
  })).sort((x, y) => x.award_year - y.award_year || x.name.localeCompare(y.name));
  return { candidates: bond.length, matched, added };
}

export function build({ ledger, documents, ranking, permits, limits, feed }) {
  const awards = ledger.awards;
  const years = awards.map((a) => a.year).filter(Number.isInteger);
  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const counties = ranking.rankings.filter((r) => r.type === 'county');
  const limitsByFips = Object.fromEntries((limits.counties || []).map((c) => [c.fips, c]));

  const isCredit = (a) => a.program.startsWith('LIHTC') || a.program === 'MIHTC';
  const isProp123 = (a) => a.program.startsWith('Prop 123') && a.program !== 'Prop 123 Modular Finance';
  const prop123Dollars = (a) => num(a.amount_awarded) ?? num(a.amount_requested);
  const units = (a) => num(a.restricted_units) ?? num(a.total_units);

  const feedProps = (feed?.features || []).map((f) => f.properties || {});
  const bond = matchBondDeals(feedProps, awards, { firstYear, lastYear });
  const bondByFips = {};
  for (const d of bond.added) (bondByFips[d.county_fips] ||= []).push(d);
  const feedLastYear = Math.max(...feedProps.map((p) => p.AwardYear).filter(Number.isInteger));

  const vacancies = counties.map((c) => num(c.metrics?.vacancy_rate_pct)).filter((v) => v !== null).sort((a, b) => a - b);
  const vacancyCut = vacancies.length ? vacancies[Math.floor(VACANCY_QUANTILE * (vacancies.length - 1))] : null;

  const rows = counties.map((c) => {
    const m = c.metrics || {};
    const fips = c.geoid;
    const mine = awards.filter((a) => a.county_fips === fips);
    const credit = mine.filter(isCredit);
    const p123 = mine.filter(isProp123);
    const sum = (list, f) => list.reduce((s, a) => s + (f(a) ?? 0), 0);

    const gap30 = num(m.housing_gap_units);
    const population = num(m.population);
    const roundUnits = sum(credit.filter((a) => a.program.startsWith('LIHTC')), units);
    const bondDeals = bondByFips[fips] || [];
    const bondUnits = bondDeals.reduce((s, d) => s + (d.homes ?? 0), 0);
    const creditUnits = roundUnits + bondUnits;
    const nineUnits = sum(credit.filter((a) => a.federal_credit_type === '9%'), units);
    const nineCredit = sum(credit.filter((a) => a.federal_credit_type === '9%'), (a) => num(a.federal_credit));

    const pv = permits.counties?.[fips]?.production_vs_need || {};
    const productionRatio = num(pv.ratio_recent_production_to_10yr_need);
    const vacancy = num(m.vacancy_rate_pct);

    const flags = [];
    if (vacancy !== null && vacancyCut !== null && vacancy >= vacancyCut && vacancy > 0) {
      flags.push({ id: 'high-vacancy', text: `Active-market vacancy ${vacancy}%, in the loosest quarter of Colorado counties (≥ ${vacancyCut}%)` });
    }
    if (productionRatio !== null && productionRatio >= PRODUCTION_PACE) {
      // How much of that building was tax credit homes: new-construction
      // low-income units CHFA awarded in the permit years, against the permits.
      // Award years run ahead of permits, so this is a share of scale, not a
      // match of the same homes.
      const win = /(\d{4})\D+(\d{4})/.exec(pv.permits_window || '');
      const permitsTotal = win && num(pv.permits_avg_annual_5yr) !== null ? pv.permits_avg_annual_5yr * (Number(win[2]) - Number(win[1]) + 1) : null;
      const creditHomes = win ? feedProps.filter((p) => p.CNTY_FIPS === fips && /^New Construction/.test(p.ProjectType || '')
        && p.AwardYear >= Number(win[1]) && p.AwardYear <= Number(win[2])).reduce((t, p) => t + (num(p.LI_UNITS) ?? 0), 0) : null;
      const share = permitsTotal ? creditHomes / permitsTotal : null;
      const base = `Permits ${pv.permits_window} ran ${round(productionRatio, 1)}× DOLA's projected household growth`;
      const pct = share === null ? null : Math.round(share * 100);
      const text = share === null ? base
        : share > 1 ? `${base}. CHFA awarded more tax credit homes in those years than the permits count, so the permit count looks short here`
          : share >= 0.25 ? `${base}. Tax credit homes awarded in those years equal ${pct}% of the permits, so much of this building is subsidized`
            : `${base}. ${pct === 0 ? 'None of it was' : `Only ${pct}% was`} tax credit homes, so it mainly softens the market above the 30% AMI gap; deed-restricted workforce homes built by towns and housing authorities are not counted here`;
      flags.push({ id: 'building-ahead', text, tax_credit_share_of_permits_pct: share === null ? null : round(share * 100) });
    }

    const lim = limitsByFips[fips]?.regular_tiers?.['60']?.max_rents || null;
    const row = {
      fips,
      name: c.name,
      region: c.region || null,
      population,
      need: {
        gap_units_30ami: gap30,
        gap_units_50ami: num(m.ami_gap_50pct),
        overall_need_score: num(m.overall_need_score),
        pct_renter_severe_burdened: num(m.pct_renter_severe_burdened),
        gap_per_1000_residents: gap30 !== null && population ? round((gap30 / population) * 1000) : null,
      },
      market: {
        active_market_vacancy_pct: vacancy,
        raw_rental_vacancy_pct: num(m.raw_rental_vacancy_rate_pct),
        seasonal_share_of_vacant_pct: num(m.seasonal_share_of_vacant),
        median_gross_rent_acs: num(m.gross_rent_median),
        permits_avg_annual_5yr: num(pv.permits_avg_annual_5yr),
        projected_need_annual_10yr: num(pv.annual_need_10yr_dola),
        production_to_need_ratio: productionRatio,
        chfa_60ami_max_rent_1br: num(lim?.['1br']),
        chfa_60ami_max_rent_2br: num(lim?.['2br']),
      },
      funding: {
        tax_credit_awards: credit.length,
        lihtc_units: creditUnits,
        round_report_lihtc_units: roundUnits,
        bond_deals_outside_rounds: bondDeals.length,
        bond_units_outside_rounds: bondUnits,
        lihtc_9pct_units: nineUnits,
        federal_9pct_credit_annual: nineCredit,
        federal_4pct_credit_annual: sum(credit.filter((a) => a.federal_credit_type === '4%'), (a) => num(a.federal_credit)),
        state_credit_annual: sum(credit, (a) => num(a.state_credit)),
        mihtc_credit_annual: sum(credit, (a) => num(a.mihtc_credit)),
        toc_credit_annual: sum(credit, (a) => num(a.toc_credit)),
        prop123_awards: p123.length,
        prop123_dollars: sum(p123, prop123Dollars),
        prop123_units: sum(p123, (a) => num(a.total_units)),
        prop123_mixed_income_dollars: sum(p123.filter((a) => /mixed-income/i.test(a.detail || '')), prop123Dollars),
        prop123_homeownership_dollars: sum(p123.filter((a) => /^homeownership$/i.test((a.detail || '').trim())), prop123Dollars),
      },
      flags,
    };

    const f = row.funding;
    if (gap30 === null) {
      f.lihtc_units_per_100_gap = null;
      f.lihtc_units_per_100_gap_unavailable_reason = 'no ≤30% AMI gap measured for this county';
    } else if (gap30 === 0) {
      f.lihtc_units_per_100_gap = null;
      f.lihtc_units_per_100_gap_unavailable_reason = 'the measured ≤30% AMI gap is zero';
    } else {
      f.lihtc_units_per_100_gap = round((creditUnits / gap30) * 100);
    }
    f.federal_9pct_credit_per_unit_annual = nineUnits > 0 ? Math.round(nineCredit / nineUnits) : null;
    if (nineUnits === 0) f.federal_9pct_credit_per_unit_unavailable_reason = 'no 9% awards in the window';
    return row;
  });

  // shares of the statewide gap and of the units funded
  const totalGap = rows.reduce((s, r) => s + (r.need.gap_units_30ami ?? 0), 0);
  const totalUnits = rows.reduce((s, r) => s + r.funding.lihtc_units, 0);
  for (const r of rows) {
    const g = r.need.gap_units_30ami;
    r.funding.share_of_state_lihtc_units = totalUnits ? round((r.funding.lihtc_units / totalUnits) * 100, 2) : null;
    r.need.share_of_state_gap = g !== null && totalGap ? round((g / totalGap) * 100, 2) : null;
  }

  // quadrant: need intensity against coverage, split at the county medians
  const medNeed = median(rows.map((r) => r.need.gap_per_1000_residents));
  const medCover = median(rows.map((r) => r.funding.lihtc_units_per_100_gap));
  for (const r of rows) {
    const n = r.need.gap_per_1000_residents;
    const cov = r.funding.lihtc_units_per_100_gap;
    if (n === null || cov === null || medNeed === null || medCover === null) {
      r.quadrant = null;
      r.quadrant_unavailable_reason = n === null ? 'need not measured' : (r.funding.lihtc_units_per_100_gap_unavailable_reason || 'coverage not computable');
      continue;
    }
    const highNeed = n >= medNeed;
    const highCover = cov >= medCover;
    r.quadrant = highNeed && !highCover ? 'underserved'
      : highNeed && highCover ? 'aligned'
        : !highNeed && highCover ? 'funded-above-need'
          : 'low-need-low-funding';
  }

  const unplaced = awards.filter((a) => !a.county_fips);
  const p123All = awards.filter(isProp123);
  const p123Total = p123All.reduce((s, a) => s + (prop123Dollars(a) ?? 0), 0);
  const byYear = {};
  const yearRow = (year) => (byYear[year] ||= { year, tax_credit_awards: 0, lihtc_units: 0, round_report_lihtc_units: 0, bond_deals_outside_rounds: 0, bond_units_outside_rounds: 0, prop123_awards: 0, prop123_dollars: 0 });
  for (const d of bond.added) {
    const y = yearRow(d.award_year);
    y.bond_deals_outside_rounds += 1;
    y.bond_units_outside_rounds += d.homes ?? 0;
    y.lihtc_units += d.homes ?? 0;
  }
  for (const a of awards) {
    const y = yearRow(a.year);
    if (isCredit(a)) {
      y.tax_credit_awards += 1;
      if (a.program.startsWith('LIHTC')) { y.lihtc_units += units(a) ?? 0; y.round_report_lihtc_units += units(a) ?? 0; }
    } else if (isProp123(a)) {
      y.prop123_awards += 1;
      y.prop123_dollars += prop123Dollars(a) ?? 0;
    }
  }
  const quadrantCounts = rows.reduce((o, r) => ((o[r.quadrant ?? 'not-computable'] = (o[r.quadrant ?? 'not-computable'] || 0) + 1), o), {});
  const softAndFunded = rows.filter((r) => r.flags.length === 2 && r.funding.lihtc_units > 0);

  const generatedAt = [ledger.meta?.generated_at, ranking.metadata?.generatedAt].filter(Boolean).sort().pop() || null;
  return {
    meta: {
      generatedAt,
      generator: 'scripts/funding/build_funding_vs_need.mjs',
      window: { first_year: firstYear, last_year: lastYear },
      inputs: Object.values(INPUTS).map((p) => path.relative(ROOT, p)),
      need_measure: 'housing_gap_units from the ranking index: renter households at or below 30% AMI minus rental homes priced affordable to them (ACS 5-year B25118 and B25063, with HUD income limits; data/co_ami_gap_by_county.json). Priced-affordable, not HUD CHAS affordable-and-available.',
      coverage_measure: 'LIHTC units awarded in the window per 100 households in the ≤30% AMI gap. Units are round award units (restricted units where the report prints them, else total units) plus the low-income units of 4% bond deals on CHFA\'s property list that no round award accounts for. LIHTC mostly serves 60% AMI, so this is a scale comparison, not a claim that each unit closes a ≤30% gap.',
      bond_deal_method: `CHFA's round award reports leave out most 4% credits paired with private activity bonds, which CHFA awards outside the rounds. Every 4% property on CHFA's tax credit property list (data/chfa-lihtc.json) with an award year from ${firstYear} to ${lastYear} is matched to the round award ledger: same county, award within two years, and alike names (or partly alike names with the same number of homes, or one building of a larger award, or the same homes and year when a deal was renamed). The ${bond.added.length} properties no round award accounts for add their low-income units (LI_UNITS) to their county. Matching errs toward a match, so a doubtful pair is not counted twice. From 2021 CHFA also prints bond-only deals in its federal 4% award report, which the ledger reads, so most added deals are from 2016 to 2022. The property list runs through ${feedLastYear}.`,
      bond_feed_last_year: Number.isFinite(feedLastYear) ? feedLastYear : null,
      bond_deals_checked: bond.candidates,
      bond_deals_matched_to_rounds: bond.matched.length,
      bond_deals_matched_by_rule: bond.matched.reduce((o, m) => ((o[m.rule] = (o[m.rule] || 0) + 1), o), {}),
      bond_deals_outside_rounds: bond.added,
      quadrant_split: { gap_per_1000_residents: round(medNeed), lihtc_units_per_100_gap: round(medCover) },
      quadrant_method: `Counties split at the median of need per 1,000 residents (${round(medNeed)}) and of LIHTC units per 100 gap households (${round(medCover)}).`,
      flag_method: `high-vacancy: active-market vacancy (ACS B25004 for-rent plus for-sale-only, over all units) at or above the county 75th percentile, ${vacancyCut}%. building-ahead: permits over the last five years at least ${PRODUCTION_PACE}× DOLA's projected annual household growth. Flags describe the market; they are not a judgment that any project was wasted.`,
      credit_note: 'Credit amounts are the ANNUAL credit CHFA awards (claimed over 10 years federally); Prop 123 amounts are dollars awarded, or requested where a preliminary selection list prints only the request.',
      unplaced_awards: unplaced.length,
      // their awards and dollars stand; their unit counts are null, so unit totals undercount them
      documents_units_withheld: (documents.documents || []).filter((d) => d.status === 'units_withheld').map((d) => ({ file: d.file, url: d.url })),
      lihtc_awards_without_units: awards.filter((a) => a.program.startsWith('LIHTC') && units(a) == null).length,
      documents_needing_review: (documents.documents || []).filter((d) => !['ok', 'no_total_line', 'accepted_by_review', 'units_withheld'].includes(d.status)).map((d) => ({ file: d.file, url: d.url, status: d.status })),
    },
    statewide: {
      tax_credit_awards: awards.filter(isCredit).length,
      // from every award, so units the ledger could not place in a county still count
      round_report_lihtc_units: awards.filter((a) => a.program.startsWith('LIHTC')).reduce((s, a) => s + (units(a) ?? 0), 0),
      bond_deals_outside_rounds: bond.added.length,
      bond_units_outside_rounds: bond.added.reduce((s, d) => s + (d.homes ?? 0), 0),
      lihtc_units: awards.filter((a) => a.program.startsWith('LIHTC')).reduce((s, a) => s + (units(a) ?? 0), 0)
        + bond.added.reduce((s, d) => s + (d.homes ?? 0), 0),
      prop123_awards: p123All.length,
      prop123_dollars: p123Total,
      prop123_mixed_income_share_pct: p123Total ? round((p123All.filter((a) => /mixed-income/i.test(a.detail || '')).reduce((s, a) => s + (prop123Dollars(a) ?? 0), 0) / p123Total) * 100) : null,
      prop123_homeownership_share_pct: p123Total ? round((p123All.filter((a) => /^homeownership$/i.test((a.detail || '').trim())).reduce((s, a) => s + (prop123Dollars(a) ?? 0), 0) / p123Total) * 100) : null,
      quadrants: quadrantCounts,
      counties_soft_and_funded: softAndFunded.map((r) => r.name),
      by_year: Object.values(byYear).sort((a, b) => a.year - b.year),
    },
    counties: rows,
  };
}

function main() {
  const inputs = Object.fromEntries(Object.entries(INPUTS).map(([k, p]) => [k, read(p)]));
  const out = JSON.stringify(build(inputs), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(OUTPUT, 'utf8'); } catch { /* missing */ }
    if (current !== out) {
      console.error(`${path.relative(ROOT, OUTPUT)} is stale — run node scripts/funding/build_funding_vs_need.mjs`);
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, OUTPUT)} is current`);
    return;
  }
  writeFileSync(OUTPUT, out);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
