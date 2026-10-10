#!/usr/bin/env node
/**
 * scripts/funding/build_funding_vs_need.mjs — where public housing subsidy has
 * gone, county by county, against the need and market the site measures.
 *
 * Reads the award ledger (scripts/funding/build_funding_awards.py), the county
 * rows of the ranking index, building permits against projected need, and
 * CHFA's 2026 rent limits. Writes data/derived/funding-vs-need.json, which the
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

export function build({ ledger, documents, ranking, permits, limits }) {
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
    const creditUnits = sum(credit.filter((a) => a.program.startsWith('LIHTC')), units);
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
      flags.push({ id: 'building-ahead', text: `Permits ${pv.permits_window} ran ${round(productionRatio, 1)}× DOLA's projected household growth` });
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
  for (const a of awards) {
    const y = (byYear[a.year] ||= { year: a.year, tax_credit_awards: 0, lihtc_units: 0, prop123_awards: 0, prop123_dollars: 0 });
    if (isCredit(a)) {
      y.tax_credit_awards += 1;
      if (a.program.startsWith('LIHTC')) y.lihtc_units += units(a) ?? 0;
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
      need_measure: 'housing_gap_units from the ranking index: the deficit of homes affordable at ≤30% AMI (HUD CHAS).',
      coverage_measure: 'LIHTC units awarded in the window (restricted units where the report prints them, else total units) per 100 households in the ≤30% AMI gap. LIHTC mostly serves 60% AMI, so this is a scale comparison, not a claim that each unit closes a ≤30% gap.',
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
      lihtc_units: awards.filter((a) => a.program.startsWith('LIHTC')).reduce((s, a) => s + (units(a) ?? 0), 0),
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
