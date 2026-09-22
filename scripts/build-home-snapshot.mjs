#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INPUTS = {
  ranking: path.join(ROOT, 'data', 'hna', 'ranking-index.json'),
  acs: path.join(ROOT, 'data', 'market', 'acs_tract_metrics_co.json'),
  chfa: path.join(ROOT, 'data', 'chfa-lihtc.json'),
  // Basis for the "Annual deficit growth ≤60% AMI" card. Until 2026-09-22
  // js/index.js carried a literal 6,500 "new ≤60%-AMI households per year"
  // with no source; it is DOLA's projected statewide household growth per
  // year times the HUD CHAS share of all households at ≤60% AMI, and is
  // derived here so the number moves with the data it describes.
  projections: path.join(ROOT, 'data', 'hna', 'projections', '08.json'),
  amiGap: path.join(ROOT, 'data', 'co_ami_gap_by_county.json'),
  summary: path.join(ROOT, 'data', 'hna', 'summary', '08.json'),
};

const OUTPUT = path.join(ROOT, 'data', 'home-snapshot.json');

function timestamp(value, source) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? { updated: value, source }
    : null;
}

function firstTimestamp(obj, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    const stamp = timestamp(value, key);
    if (stamp) return stamp;
  }
  return null;
}

export function deriveLe60HouseholdGrowth({ projections, amiGap, summary }) {
  const years = projections && projections.years;
  const households = projections && projections.housing_need && projections.housing_need.households_dola;
  if (!Array.isArray(years) || !Array.isArray(households) || years.length < 2 || households.length !== years.length) {
    throw new Error('Cannot build homepage snapshot: DOLA household projection series (housing_need.households_dola) is missing');
  }
  const span = Number(years[years.length - 1]) - Number(years[0]);
  const growthPerYear = (Number(households[households.length - 1]) - Number(households[0])) / span;
  const totalHouseholds = Number(summary && summary.acsProfile && summary.acsProfile.DP02_0001E);
  const le60Households = Number(amiGap && amiGap.statewide && amiGap.statewide.all_households_le_ami_pct
    && amiGap.statewide.all_households_le_ami_pct['60']);
  if (!(span > 0) || !Number.isFinite(growthPerYear) || !(totalHouseholds > 0) || !(le60Households > 0)) {
    throw new Error('Cannot build homepage snapshot: ≤60%-AMI household-growth basis is incomplete (DOLA span, ACS DP02_0001E, CHAS all_households_le_ami_pct.60)');
  }
  const le60Share = le60Households / totalHouseholds;
  return {
    annual_le60_household_growth: Math.round(growthPerYear * le60Share),
    basis: {
      dola_household_growth_per_year: Math.round(growthPerYear),
      projection_years: [Number(years[0]), Number(years[years.length - 1])],
      le60_households_all_tenure: le60Households,
      total_households_acs: totalHouseholds,
      le60_share_all_tenure: Number(le60Share.toFixed(4)),
      tenure: 'all',
    },
  };
}

export function buildSnapshot({ ranking, acs, chfa, projections, amiGap, summary, now = new Date() }) {
  const tracts = Array.isArray(acs && acs.tracts) ? acs.tracts : [];
  let burdenSum = 0;
  let renterHouseholds = 0;
  for (const tract of tracts) {
    const renters = Number(tract && tract.renter_hh) || 0;
    const burdenRate = Number(tract && tract.cost_burden_rate) || 0;
    if (renters > 0 && burdenRate > 0) {
      burdenSum += burdenRate * renters;
      renterHouseholds += renters;
    }
  }
  if (renterHouseholds <= 0) {
    throw new Error('Cannot build homepage snapshot: ACS renter-household denominator is zero');
  }

  const features = Array.isArray(chfa && chfa.features) ? chfa.features : [];
  if (!features.length) {
    throw new Error('Cannot build homepage snapshot: CHFA LIHTC feature list is empty');
  }

  const currentYear = now.getUTCFullYear();
  const startYearExclusive = currentYear - 11;
  const unitsByYear = new Map();
  for (const feature of features) {
    const properties = feature && feature.properties || {};
    const placedInServiceYear = Number(properties.YR_PIS) || 0;
    if (placedInServiceYear <= startYearExclusive || placedInServiceYear > currentYear || placedInServiceYear === 8888) continue;
    const units = Number(properties.LI_UNITS) || Number(properties.N_UNITS) || 0;
    unitsByYear.set(placedInServiceYear, (unitsByYear.get(placedInServiceYear) || 0) + units);
  }
  if (!unitsByYear.size) {
    throw new Error('Cannot build homepage snapshot: no LIHTC observations fall in the current display window');
  }

  const totalLihtcUnits = Array.from(unitsByYear.values()).reduce((sum, units) => sum + units, 0);
  const rankingVintage = timestamp(ranking && ranking.metadata && ranking.metadata.generatedAt, 'metadata.generatedAt');
  const acsVintage = timestamp(acs && acs.meta && acs.meta.generated, 'meta.generated');
  const chfaVintage = timestamp(chfa && chfa.fetchedAt, 'fetchedAt');
  const growth = deriveLe60HouseholdGrowth({ projections, amiGap, summary });

  return {
    generated: now.toISOString(),
    values: {
      renter_cost_burden_pct: Number(((burdenSum / renterHouseholds) * 100).toFixed(1)),
      lihtc_property_count: features.length,
      average_lihtc_units_per_year: Math.round(totalLihtcUnits / unitsByYear.size),
      annual_le60_household_growth: growth.annual_le60_household_growth,
    },
    deficit_growth_basis: growth.basis,
    lihtc_window: {
      start_year_exclusive: startYearExclusive,
      end_year_inclusive: currentYear,
      observed_years: unitsByYear.size,
    },
    source_vintages: {
      'data/hna/ranking-index.json': rankingVintage,
      'data/market/acs_tract_metrics_co.json': acsVintage,
      'data/chfa-lihtc.json': chfaVintage,
      'data/hna/projections/08.json': timestamp(projections && projections.updated, 'updated'),
      'data/co_ami_gap_by_county.json': firstTimestamp(amiGap, ['meta.generated', 'meta.generated_at', 'meta.updated']),
      'data/hna/summary/08.json': firstTimestamp(summary, ['generated', 'updated', 'meta.generated']),
    },
  };
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function main() {
  const [ranking, acs, chfa, projections, amiGap, summary] = await Promise.all([
    readJson(INPUTS.ranking),
    readJson(INPUTS.acs),
    readJson(INPUTS.chfa),
    readJson(INPUTS.projections),
    readJson(INPUTS.amiGap),
    readJson(INPUTS.summary),
  ]);
  const snapshot = buildSnapshot({ ranking, acs, chfa, projections, amiGap, summary });
  await writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${Buffer.byteLength(JSON.stringify(snapshot))} bytes compact)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
