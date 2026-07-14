#!/usr/bin/env node
/*
 * Warn-only calibration for the PMA STR seasonal-share discount (#1171).
 *
 * Licensed STR counts are not ACS vacant-for-rent units: they differ by
 * universe, date, and collection method. This script compares only the order
 * of magnitude of units removed by the seasonal-share proxy. It never fails
 * the build and must not be wired into test:ci.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function fmt(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

function loadAcsIndex() {
  const data = readJson('data/market/acs_tract_metrics_co.json');
  const idx = new Map();
  for (const tract of data.tracts || []) {
    idx.set(String(tract.geoid), tract);
  }
  return idx;
}

function countyRows(acsIdx, countyGeoid) {
  const rows = [];
  for (const [geoid, tract] of acsIdx.entries()) {
    if (geoid.startsWith(countyGeoid)) rows.push({ tract, share: 1 });
  }
  return rows;
}

function placeRows(acsIdx, memberships, placeGeoid) {
  const place = memberships.places && memberships.places[placeGeoid];
  if (!place || !Array.isArray(place.tracts)) return [];
  return place.tracts
    .map((member) => ({
      tract: acsIdx.get(String(member.tract_geoid)),
      share: Number(member.share_of_tract_area)
    }))
    .filter((row) => row.tract && Number.isFinite(row.share) && row.share > 0);
}

function aggregate(rows) {
  const totals = rows.reduce((acc, row) => {
    const t = row.tract;
    const share = row.share;
    acc.vacant += (Number(t.vacant) || 0) * share;
    acc.vacantSeasonal += (Number(t.vacant_seasonal) || 0) * share;
    acc.vacantForRent += (Number(t.vacant_for_rent) || 0) * share;
    acc.renterHh += (Number(t.renter_hh) || 0) * share;
    acc.rentedNotOccupied += (Number(t.rented_not_occupied) || 0) * share;
    return acc;
  }, {
    vacant: 0,
    vacantSeasonal: 0,
    vacantForRent: 0,
    renterHh: 0,
    rentedNotOccupied: 0
  });

  const seasonalShare = totals.vacant > 0
    ? Math.min(1, Math.max(0, totals.vacantSeasonal / totals.vacant))
    : 0;
  const removedUnits = totals.vacantForRent * seasonalShare;
  const rawUniverse = totals.renterHh + totals.vacantForRent + totals.rentedNotOccupied;
  const adjustedForRent = totals.vacantForRent - removedUnits;
  const adjustedUniverse = totals.renterHh + adjustedForRent + totals.rentedNotOccupied;

  return {
    ...totals,
    seasonalShare,
    removedUnits,
    rawRentalVacancy: rawUniverse > 0 ? totals.vacantForRent / rawUniverse : null,
    adjustedRentalVacancy: adjustedUniverse > 0 ? adjustedForRent / adjustedUniverse : null
  };
}

function main() {
  const benchmark = readJson('data/benchmarks/str-license-counts.json');
  const acsIdx = loadAcsIndex();
  const memberships = readJson('data/hna/place-tract-membership.json');
  const entries = benchmark.entries || [];
  const warnings = [];

  console.log('STR seasonal-discount calibration (warn-only)');
  console.log('Licensed STR counts != ACS vacant-for-rent units; compare order of magnitude only.');
  console.log('');
  console.log([
    'jurisdiction'.padEnd(22),
    'license'.padStart(8),
    'removed'.padStart(9),
    'ratio'.padStart(7),
    'seasonal'.padStart(9),
    'raw rv'.padStart(8),
    'adj rv'.padStart(8),
    'note'
  ].join('  '));

  for (const entry of entries) {
    const rows = entry.geography_level === 'county'
      ? countyRows(acsIdx, String(entry.geoid))
      : placeRows(acsIdx, memberships, String(entry.geoid));
    if (!rows.length) {
      warnings.push(`${entry.jurisdiction}: no tract rows found for ${entry.geoid}`);
      continue;
    }

    const result = aggregate(rows);
    const licensed = Number(entry.licensed_str_units);
    const ratio = licensed > 0 ? result.removedUnits / licensed : null;
    let note = 'ok';
    if (licensed > 0 && ratio > 1.5) {
      note = 'warn: removed >1.5x licenses';
      warnings.push(`${entry.jurisdiction}: removed ${fmt(result.removedUnits)} > 1.5x licensed ${licensed}`);
    } else if (licensed > 0 && result.seasonalShare >= 0.25 && ratio < 0.1) {
      note = 'warn: removed <0.1x licenses';
      warnings.push(`${entry.jurisdiction}: seasonal-dominated but removed ${fmt(result.removedUnits)} < 0.1x licensed ${licensed}`);
    }

    console.log([
      entry.jurisdiction.padEnd(22),
      String(licensed).padStart(8),
      fmt(result.removedUnits).padStart(9),
      (ratio == null ? 'n/a' : fmt(ratio, 2)).padStart(7),
      (fmt(result.seasonalShare * 100, 1) + '%').padStart(9),
      (fmt((result.rawRentalVacancy || 0) * 100, 1) + '%').padStart(8),
      (fmt((result.adjustedRentalVacancy || 0) * 100, 1) + '%').padStart(8),
      note
    ].join('  '));
  }

  if (warnings.length) {
    console.warn('');
    console.warn('Warnings:');
    warnings.forEach((warning) => console.warn(`- ${warning}`));
  }
  console.log('');
  console.log('Calibration complete: warn-only, exit 0.');
}

main();
