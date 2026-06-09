#!/usr/bin/env node
/**
 * F208 — Join the article's county-indicator CSV with the county
 * boundaries GeoJSON so the data-map-browser can render the same
 * indicators that drive article-co-housing-costs.html as toggleable
 * choropleth layers.
 *
 * Inputs:
 *   data/co-county-boundaries.json
 *   assets/co-housing-costs/snapshots/acs_county_latest.csv
 *
 * Output:
 *   data/processed/co_county_housing_indicators.geojson
 *
 * Each feature carries the standard TIGER properties (NAME, GEOID, ...)
 * PLUS the indicator columns from the CSV (median_gross_rent,
 * median_hh_income, vacancy_rate, rent_burden_30_plus). The map browser
 * renders one layer per indicator using a choropleth tint.
 *
 * Idempotent: run as often as the article CSV is regenerated.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const BOUNDARIES = path.join(REPO, "data", "co-county-boundaries.json");
const CSV_PATH   = path.join(REPO, "assets", "co-housing-costs", "snapshots", "acs_county_latest.csv");
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
  const [boundariesText, csvText] = await Promise.all([
    fs.readFile(BOUNDARIES, "utf8"),
    fs.readFile(CSV_PATH, "utf8"),
  ]);
  const boundaries = JSON.parse(boundariesText);
  const csv = parseCsv(csvText);

  // Index CSV rows by county FIPS (5 digits, zero-padded).
  const byFips = Object.create(null);
  for (const r of csv.rows) {
    const fips = String(r.county_fips || "").padStart(5, "0");
    byFips[fips] = r;
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
    return { ...f, properties: props };
  });

  const out = {
    type: "FeatureCollection",
    meta: {
      generated_at: "2026-06-09",
      generated_by: "scripts/build_article_indicator_geojson.mjs",
      source_boundaries: "data/co-county-boundaries.json",
      source_indicators: "assets/co-housing-costs/snapshots/acs_county_latest.csv",
      indicators: [
        { key: "median_gross_rent",   label: "Median gross rent ($/mo)",       source: "ACS B25064 (2020–2024)",  format: "currency" },
        { key: "rent_burden_30_plus", label: "Rent burden ≥30% (share)",       source: "ACS B25070 (2020–2024)",  format: "share" },
        { key: "vacancy_rate",        label: "Housing vacancy rate (share)",   source: "ACS B25002 (2020–2024)",  format: "share" },
        { key: "median_hh_income",    label: "Median household income ($)",    source: "ACS B19013 (2020–2024)",  format: "currency" },
      ],
      join_stats: { matched: joined, unmatched: missing, total: features.length },
      note: "Re-run after the article pipeline (build_co_housing_costs_insight.py) regenerates the CSV.",
    },
    features,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[F208] Wrote ${OUT_PATH}`);
  console.log(`  · joined ${joined} / ${features.length} counties (${missing} unmatched)`);
}

main().catch(e => { console.error(e); process.exit(1); });
