#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INPUTS = {
  ranking: path.join(ROOT, 'data', 'hna', 'ranking-index.json'),
  acs: path.join(ROOT, 'data', 'market', 'acs_tract_metrics_co.json'),
  chfa: path.join(ROOT, 'data', 'chfa-lihtc.json'),
};

const OUTPUT = path.join(ROOT, 'data', 'home-snapshot.json');

function timestamp(value, source) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    ? { updated: value, source }
    : null;
}

export function buildSnapshot({ ranking, acs, chfa, now = new Date() }) {
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

  return {
    generated: now.toISOString(),
    values: {
      renter_cost_burden_pct: Number(((burdenSum / renterHouseholds) * 100).toFixed(1)),
      lihtc_property_count: features.length,
      average_lihtc_units_per_year: Math.round(totalLihtcUnits / unitsByYear.size),
    },
    lihtc_window: {
      start_year_exclusive: startYearExclusive,
      end_year_inclusive: currentYear,
      observed_years: unitsByYear.size,
    },
    source_vintages: {
      'data/hna/ranking-index.json': rankingVintage,
      'data/market/acs_tract_metrics_co.json': acsVintage,
      'data/chfa-lihtc.json': chfaVintage,
    },
  };
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function main() {
  const [ranking, acs, chfa] = await Promise.all([
    readJson(INPUTS.ranking),
    readJson(INPUTS.acs),
    readJson(INPUTS.chfa),
  ]);
  const snapshot = buildSnapshot({ ranking, acs, chfa });
  await writeFile(OUTPUT, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} (${Buffer.byteLength(JSON.stringify(snapshot))} bytes compact)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
