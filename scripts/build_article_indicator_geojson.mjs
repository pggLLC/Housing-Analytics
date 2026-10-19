#!/usr/bin/env node
/**
 * F208 — Join the article's county-indicator CSV with the county
 * boundaries GeoJSON so the data-map-browser can render the same
 * indicators that drive article-co-housing-costs.html as toggleable
 * choropleth layers.
 *
 * Inputs:
 *   data/co-county-boundaries.json
 *   assets/co-housing-costs/snapshots/co_county_indicators_full.csv
 *     (falls back to acs_county_latest.csv, the 4-indicator ACS snapshot)
 *
 * Output:
 *   data/processed/co_county_housing_indicators.geojson
 *
 * Each feature carries the standard TIGER properties (NAME, GEOID, ...)
 * PLUS the indicator columns from the CSV (the four ACS fields, FHFA HPI
 * 10-year change, QCEW construction wage, BPS permits per 1,000) and the
 * years each covers. The map browser renders one layer per indicator using
 * a choropleth tint and reads the years from these properties.
 *
 * Idempotent: run as often as the article CSV is regenerated.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const BOUNDARIES = path.join(REPO, "data", "co-county-boundaries.json");
// F214 — Prefer the full 7-indicator CSV when present (ACS + FHFA + QCEW + BPS).
// Falls back to the 4-indicator ACS-only snapshot for backwards compatibility.
const CSV_FULL   = path.join(REPO, "assets", "co-housing-costs", "snapshots", "co_county_indicators_full.csv");
const CSV_LEGACY = path.join(REPO, "assets", "co-housing-costs", "snapshots", "acs_county_latest.csv");
const OUT_PATH   = path.join(REPO, "data", "processed", "co_county_housing_indicators.geojson");

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  // Simple quoted-field CSV parser — enough for the article snapshot which
  // only quotes the county name column.
  function splitLine(line) {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  const headers = splitLine(lines[0]).map(s => s.trim());
  const rows = lines.slice(1).map(line => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i].trim() : ""; });
    return obj;
  });
  return { headers, rows };
}

function num(v) {
  if (v == null || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const boundariesText = await fs.readFile(BOUNDARIES, "utf8");
  // Prefer the F214 full CSV; fall back to the 4-indicator ACS snapshot.
  let csvText, csvSource;
  try {
    csvText = await fs.readFile(CSV_FULL, "utf8");
    csvSource = path.relative(REPO, CSV_FULL);
  } catch {
    csvText = await fs.readFile(CSV_LEGACY, "utf8");
    csvSource = path.relative(REPO, CSV_LEGACY);
  }
  const boundaries = JSON.parse(boundariesText);
  const csv = parseCsv(csvText);

  // Index CSV rows by county FIPS (5 digits, zero-padded).
  // Keep the newest acs_year per county. A plain last-wins assignment is a
  // silent hazard here: if a producer ever emits several ACS cohorts per
  // county, the oldest sorts last and would quietly become the rendered
  // vintage -- 2009 rents on a layer labelled current.
  const byFips = Object.create(null);
  for (const r of csv.rows) {
    const fips = String(r.county_fips || "").padStart(5, "0");
    const prev = byFips[fips];
    if (!prev) { byFips[fips] = r; continue; }
    const year = Number(r.acs_year);
    const prevYear = Number(prev.acs_year);
    if (Number.isFinite(year) && (!Number.isFinite(prevYear) || year > prevYear)) {
      byFips[fips] = r;
    }
  }

  let joined = 0;
  let missing = 0;
  const features = (boundaries.features || []).map(f => {
    const props = { ...(f.properties || {}) };
    const fips = props.GEOID || ((props.STATEFP || "") + (props.COUNTYFP || ""));
    const row = byFips[fips];
    if (!row) {
      missing++;
      return { ...f, properties: props };
    }
    joined++;
    // Carry the indicator values + their cohort year.
    props.median_gross_rent      = num(row.median_gross_rent);
    props.median_hh_income       = num(row.median_hh_income);
    props.vacancy_rate           = num(row.vacancy_rate);
    props.rent_burden_30_plus    = num(row.rent_burden_30_plus);
    props.acs_year               = num(row.acs_year);
    props.indicator_county_name  = row.county_name;
    // F214 — the optional FHFA / QCEW / BPS indicators are merged in
    // whenever the full CSV is available. Each remains null when the
    // legacy 4-indicator CSV is the input — downstream choropleth code
    // already handles missing values gracefully.
    props.fhfa_hpi_change_10y         = num(row.fhfa_hpi_change_10y);
    props.fhfa_base_year              = num(row.fhfa_base_year);
    props.fhfa_latest_year            = num(row.fhfa_latest_year);
    props.qcew_avg_annual_wage        = num(row.qcew_avg_annual_wage);
    props.qcew_year                   = num(row.qcew_year);
    props.bps_permits_per_1k_5yr_avg  = num(row.bps_permits_per_1k_5yr_avg);
    props.bps_first_year              = num(row.bps_first_year);
    props.bps_last_year               = num(row.bps_last_year);
    props.renter_households           = num(row.renter_households);
    props.renters_burdened_30_plus    = num(row.renters_burdened_30_plus);
    props.population                  = num(row.population);
    return { ...f, properties: props };
  });

  // Vintages come from the rows, never from this file: the layer labels and
  // the article both read them, and a year written here goes stale on the
  // next refresh. One value per field, or the build stops.
  const rows = Object.values(byFips);
  const only = (key) => {
    const seen = [...new Set(rows.map(r => num(r[key])).filter(v => v != null))];
    if (seen.length > 1) throw new Error(`${key} differs between counties: ${seen.join(", ")}`);
    return seen.length ? seen[0] : null;
  };
  const acsYear = only("acs_year");
  const hpiBase = only("fhfa_base_year"), hpiLatest = only("fhfa_latest_year");
  const qcewYear = only("qcew_year");
  const bpsFirst = only("bps_first_year"), bpsLast = only("bps_last_year");
  const acsLabel = acsYear ? `ACS ${acsYear - 4}–${acsYear} 5-year` : "ACS 5-year";

  // Statewide renter burden from the county counts. ACS county counts sum to
  // the state's, so this is the state figure, not an average of rates.
  const sum = (key) => rows.reduce((t, r) => (t == null || num(r[key]) == null ? null : t + num(r[key])), 0);
  const renters = sum("renter_households"), burdened = sum("renters_burdened_30_plus");

  const out = {
    type: "FeatureCollection",
    meta: {
      generated_by: "scripts/build_article_indicator_geojson.mjs",
      source_boundaries: "data/co-county-boundaries.json",
      source_indicators: csvSource,
      vintages: {
        acs: acsYear,
        fhfa_hpi: hpiBase && hpiLatest ? { base: hpiBase, latest: hpiLatest } : null,
        qcew: qcewYear,
        bps_permits: bpsFirst && bpsLast ? { first: bpsFirst, last: bpsLast } : null,
      },
      statewide: {
        renter_households: renters,
        renters_burdened_30_plus: burdened,
        rent_burden_30_plus: renters && burdened != null ? Math.round(burdened / renters * 10000) / 10000 : null,
      },
      indicators: [
        { key: "median_gross_rent",          label: "Median gross rent ($/mo)",            source: `${acsLabel}, B25064`, format: "currency" },
        { key: "rent_burden_30_plus",        label: "Rent burden ≥30% (share)",            source: `${acsLabel}, B25070`, format: "share" },
        { key: "vacancy_rate",               label: "Housing vacancy rate (share)",        source: `${acsLabel}, B25002`, format: "share" },
        { key: "median_hh_income",           label: "Median household income ($)",         source: `${acsLabel}, B19013`, format: "currency" },
        { key: "fhfa_hpi_change_10y",        label: "FHFA HPI 10-year change (decimal)",   source: `FHFA All-Transactions HPI, county, ${hpiBase}→${hpiLatest}`, format: "ratio" },
        { key: "qcew_avg_annual_wage",       label: "QCEW avg annual construction wage",   source: `BLS QCEW, NAICS 23, private, ${qcewYear}`, format: "currency" },
        { key: "bps_permits_per_1k_5yr_avg", label: "BPS permits per 1k people (5-yr avg)", source: `Census BPS ${bpsFirst}–${bpsLast} ÷ ${acsLabel} population`, format: "ratio" },
      ],
      join_stats: { matched: joined, unmatched: missing, total: features.length },
      note: "Rebuilt by update-co-housing-costs.yml after build_article_full_indicators.py regenerates the CSV. A null is a value the source does not publish (FHFA has no index where sales are few; BLS suppresses small counties), never a zero.",
    },
    features,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[F208] Wrote ${OUT_PATH}`);
  console.log(`  · joined ${joined} / ${features.length} counties (${missing} unmatched)`);
}

main().catch(e => { console.error(e); process.exit(1); });
