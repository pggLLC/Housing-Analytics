#!/usr/bin/env node
/**
 * F207b — Build the CHAS rent-burden crosscheck JSON.
 *
 * Phase C of the CHAS reliability spec. Fetches ACS B25070 detailed
 * tables (5-year 2018–2022 + 1-year 2023) for every CO geography we
 * have CHAS data for, computes rates + MOE per the Census proportion
 * formula, and cross-references against the existing CHAS county and
 * place data. The output drives js/rent-burden-reliability.js.
 *
 * Per the spec's QA review (Claude 2026-06-09):
 *   - ACS 5-year MUST match CHAS vintage (2018-2022) — definitional
 *     check, NOT a freshness check
 *   - ACS 1-year is the only genuinely newer source. For sub-65k
 *     geographies, falls back to containing county → state with a
 *     clear isProxy + proxyKind flag
 *   - MOE propagation via root-sum-of-squares (component cells) and
 *     the Census proportion formula (with RATIO fallback when the
 *     radicand goes negative)
 *
 * Usage:
 *   CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs
 *   CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs --dry
 *
 * Output: data/processed/rent_burden_crosscheck.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry");
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;
if (!CENSUS_API_KEY) {
  throw new Error("CENSUS_API_KEY required. Set in environment before running.");
}

const ACS5_YEAR = 2022;     // 5-year vintage matching CHAS (must stay locked per QA-FIX 1)
const ACS1_YEAR = 2023;     // Latest available 1-year release
const CHAS_VINTAGE = "2018-2022";

const CO_STATE_FIPS = "08";

const OUTPUT_PATH = path.join(REPO_ROOT, "data", "processed", "rent_burden_crosscheck.json");
// F214 fix — the original path pointed at data/market/chas_co.json which
// ships top-level {meta, records:[]} (not the .counties dict shape). The
// canonical county-CHAS file with the {counties: {FIPS: {...}}} structure
// lives at data/hna/chas_affordability_gap.json — same file the rest of
// the HNA + Compare pages read. That's the one to join against here so
// all 64 counties show up in the crosscheck output.
const CHAS_COUNTY_PATH = path.join(REPO_ROOT, "data", "hna", "chas_affordability_gap.json");
const PLACE_CHAS_PATH  = path.join(REPO_ROOT, "data", "hna", "place-chas.json");
const RANKING_INDEX_PATH = path.join(REPO_ROOT, "data", "hna", "ranking-index.json");

/* ── B25070 field map (confirmed in QA-OK against current Census metadata) ──
 * 001 Total renter-occupied units (universe)
 * 002–006 Under 30% bands (not used in burden math)
 * 007 30.0–34.9%
 * 008 35.0–39.9%
 * 009 40.0–49.9%
 * 010 50.0%+
 * 011 Not computed
 *
 * E = estimate, M = MOE (90% confidence)
 */
const B25070_VARS = [
  "B25070_001E", "B25070_001M",
  "B25070_007E", "B25070_007M",
  "B25070_008E", "B25070_008M",
  "B25070_009E", "B25070_009M",
  "B25070_010E", "B25070_010M",
  "B25070_011E", "B25070_011M",
];

/* ── Math helpers ── */

function num(v) {
  if (v == null || v === "" || v === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Census suppression sentinels appear as negative values (e.g. -666666666).
// We translate to null so downstream math drops them cleanly.
function moeOrNull(v) {
  const n = num(v);
  if (n == null) return null;
  return n < 0 ? null : n;
}

// MOE for a sum of cells, all 90% confidence: root-sum-of-squares.
function sumMoe(moes) {
  const finite = moes.filter(m => Number.isFinite(m));
  if (!finite.length) return null;
  let s = 0;
  for (const m of finite) s += m * m;
  return Math.sqrt(s);
}

// Proportion MOE (Census recommendation), p ⊆ denom:
//   moe_p = (1/denom) * sqrt(moe_num^2 - p^2 * moe_denom^2)
// Fallback to RATIO when radicand goes negative.
function propMoe(num, denom, moeNum, moeDenom) {
  if (denom == null || denom <= 0) return null;
  if (moeNum == null || moeDenom == null) return null;
  const p = num / denom;
  const radPropor = moeNum * moeNum - p * p * moeDenom * moeDenom;
  const rad = radPropor >= 0
    ? radPropor
    : (moeNum * moeNum + p * p * moeDenom * moeDenom);
  return Math.sqrt(rad) / denom;
}

/* ── Census API ── */

const ACS_BASE_5 = `https://api.census.gov/data/${ACS5_YEAR}/acs/acs5`;
const ACS_BASE_1 = `https://api.census.gov/data/${ACS1_YEAR}/acs/acs1`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url, attempt = 0) {
  const r = await fetch(url);
  if (!r.ok) {
    // 204 / 400 means "no data published at this geography level"
    // (e.g. ACS 1-year for a sub-65k place). Treat as null result.
    if (r.status === 204 || r.status === 400 || r.status === 404) return null;
    if (attempt === 0 && (r.status === 429 || r.status >= 500)) {
      await sleep(1500);
      return fetchJson(url, 1);
    }
    throw new Error(`Census API ${r.status} ${r.statusText} for ${url}`);
  }
  const text = await r.text();
  if (!text || text.trim() === "") return null;
  try { return JSON.parse(text); } catch (e) {
    throw new Error(`Bad JSON from ${url}: ${e.message}`);
  }
}

// Returns array of {geoid, raw}. raw is keyed by var name.
async function fetchAcs(base, varList, forParam, inParam) {
  const params = new URLSearchParams();
  params.set("get", `${varList.join(",")},NAME`);
  params.set("for", forParam);
  if (inParam) params.set("in", inParam);
  params.set("key", CENSUS_API_KEY);
  const j = await fetchJson(`${base}?${params.toString()}`);
  if (!j || !Array.isArray(j) || j.length < 2) return [];
  const headers = j[0];
  const idxByName = Object.create(null);
  headers.forEach((h, i) => { idxByName[h] = i; });
  const rows = j.slice(1);
  return rows.map(row => {
    // Build the geoid from the trailing geography columns
    let geoid = "";
    if (forParam.startsWith("place")) {
      const s = row[idxByName.state] || "";
      const p = row[idxByName.place] || "";
      geoid = String(s) + String(p);
    } else if (forParam.startsWith("county")) {
      const s = row[idxByName.state] || "";
      const c = row[idxByName.county] || "";
      geoid = String(s) + String(c);
    } else if (forParam.startsWith("state")) {
      geoid = String(row[idxByName.state] || "");
    }
    const raw = {};
    for (const v of varList) {
      raw[v] = row[idxByName[v]];
    }
    return { geoid, name: row[idxByName.NAME], raw };
  });
}

/* ── Compute reliability primitives per ACS row ── */

function rowToMetrics(raw) {
  // Renter-occupied with known gross-rent ratio
  const total      = num(raw.B25070_001E);
  const notComp    = num(raw.B25070_011E);
  const cb30Cells  = [num(raw.B25070_007E), num(raw.B25070_008E), num(raw.B25070_009E), num(raw.B25070_010E)];
  const cb50Cell   = num(raw.B25070_010E);

  if (total == null) return null;
  const denom = total - (notComp || 0);
  if (denom == null || denom <= 0) return null;

  const cb30Sum = cb30Cells.filter(v => v != null).reduce((a, b) => a + b, 0);
  const rate30  = cb30Sum / denom;
  const rate50  = cb50Cell != null ? (cb50Cell / denom) : null;

  // MOE propagation
  const m007 = moeOrNull(raw.B25070_007M);
  const m008 = moeOrNull(raw.B25070_008M);
  const m009 = moeOrNull(raw.B25070_009M);
  const m010 = moeOrNull(raw.B25070_010M);
  const m001 = moeOrNull(raw.B25070_001M);
  const m011 = moeOrNull(raw.B25070_011M);

  const moeNum30   = sumMoe([m007, m008, m009, m010]);
  const moeNum50   = m010 != null ? m010 : null;
  const moeDenom   = sumMoe([m001, m011]);

  const moe30 = propMoe(cb30Sum,  denom, moeNum30, moeDenom);
  const moe50 = rate50 != null ? propMoe(cb50Cell, denom, moeNum50, moeDenom) : null;

  return {
    cb30: { rate: rate30, denominator: denom, moe: moe30 },
    cb50: { rate: rate50, denominator: denom, moe: moe50 },
  };
}

/* ── CHAS block extraction ── */

function chasBlockCounty(chas) {
  if (!chas || !chas.summary) return null;
  const s = chas.summary;
  const denom = num(s.total_renter_hh);
  return {
    cb30: { rate: num(s.pct_renter_cb30), denominator: denom, moe: null, vintage: CHAS_VINTAGE },
    cb50: { rate: num(s.pct_renter_cb50), denominator: denom, moe: null, vintage: CHAS_VINTAGE },
  };
}
function chasBlockPlace(chas) {
  if (!chas || !chas.summary) return null;
  const s = chas.summary;
  const denom = num(s.total_renter_hh);
  return {
    cb30: { rate: num(s.renter_cb30_share), denominator: denom, moe: null, vintage: CHAS_VINTAGE },
    cb50: { rate: num(s.renter_cb50_share), denominator: denom, moe: null, vintage: CHAS_VINTAGE },
  };
}

/* ── Main ── */

async function main() {
  console.log("[F207b] Loading CHAS + ranking-index…");
  const [chasCountyJson, placeChasJson, rankingJson] = await Promise.all([
    fs.readFile(CHAS_COUNTY_PATH, "utf8").then(JSON.parse),
    fs.readFile(PLACE_CHAS_PATH, "utf8").then(JSON.parse),
    fs.readFile(RANKING_INDEX_PATH, "utf8").then(JSON.parse).catch(() => null),
  ]);

  // ── Build geoid → containingCounty map ──
  const containingCountyByPlace = {};
  if (rankingJson && Array.isArray(rankingJson.rankings)) {
    for (const r of rankingJson.rankings) {
      if (r && r.geoid && r.containingCounty) {
        containingCountyByPlace[r.geoid] = r.containingCounty;
      }
    }
  }

  // ── Fetch ACS 5-year (batched per geography level) ──
  console.log("[F207b] Fetching ACS 5-year B25070 batches…");
  const [acs5Counties, acs5Places, acs5State] = await Promise.all([
    fetchAcs(ACS_BASE_5, B25070_VARS, "county:*", `state:${CO_STATE_FIPS}`),
    fetchAcs(ACS_BASE_5, B25070_VARS, "place:*",  `state:${CO_STATE_FIPS}`),
    fetchAcs(ACS_BASE_5, B25070_VARS, `state:${CO_STATE_FIPS}`, null),
  ]);
  console.log(`  · counties: ${acs5Counties.length}`);
  console.log(`  · places:   ${acs5Places.length}`);
  console.log(`  · state:    ${acs5State.length}`);

  // ── Fetch ACS 1-year (only ≥65k geos returned) ──
  console.log("[F207b] Fetching ACS 1-year B25070 batches…");
  const [acs1Counties, acs1Places, acs1State] = await Promise.all([
    fetchAcs(ACS_BASE_1, B25070_VARS, "county:*", `state:${CO_STATE_FIPS}`).catch(() => []),
    fetchAcs(ACS_BASE_1, B25070_VARS, "place:*",  `state:${CO_STATE_FIPS}`).catch(() => []),
    fetchAcs(ACS_BASE_1, B25070_VARS, `state:${CO_STATE_FIPS}`, null).catch(() => []),
  ]);
  console.log(`  · counties: ${acs1Counties.length} (publishable subset)`);
  console.log(`  · places:   ${acs1Places.length} (publishable subset)`);
  console.log(`  · state:    ${acs1State.length}`);

  // ── Index ACS results by geoid ──
  function indexByGeoid(rows) {
    const m = Object.create(null);
    for (const r of rows) if (r.geoid) m[r.geoid] = r;
    return m;
  }
  const acs5C = indexByGeoid(acs5Counties);
  const acs5P = indexByGeoid(acs5Places);
  const acs5S = (acs5State[0] && rowToMetrics(acs5State[0].raw)) || null;
  const acs1C = indexByGeoid(acs1Counties);
  const acs1P = indexByGeoid(acs1Places);
  const acs1S = (acs1State[0] && rowToMetrics(acs1State[0].raw)) || null;

  // ── Build output keyed by geoid ──
  const geos = {};

  // Helper to assemble one geoid's record.
  function buildEntry({ geoid, name, geoType, chasBlock, acs5Row, acs1Row, proxyChain }) {
    const acs5Metrics = acs5Row ? rowToMetrics(acs5Row.raw) : null;
    const acs1Metrics = acs1Row ? rowToMetrics(acs1Row.raw) : null;

    // ACS 1-year proxy fallback chain — when null, fall back through
    // proxyChain (county → state) and tag isProxy.
    let acs1Use = acs1Metrics;
    let isProxy = false;
    let proxyKind = null;
    let proxyGeoid = null;
    if (!acs1Use && proxyChain && proxyChain.length) {
      for (const step of proxyChain) {
        if (step.metrics) {
          acs1Use = step.metrics;
          isProxy = true;
          proxyKind = step.kind;
          proxyGeoid = step.geoid || null;
          break;
        }
      }
    }

    function acs5Block(metrics) {
      if (!metrics) return null;
      return {
        cb30: { rate: metrics.cb30.rate, denominator: metrics.cb30.denominator, moe: metrics.cb30.moe, vintage: CHAS_VINTAGE },
        cb50: { rate: metrics.cb50.rate, denominator: metrics.cb50.denominator, moe: metrics.cb50.moe, vintage: CHAS_VINTAGE },
      };
    }
    function acs1Block(metrics) {
      if (!metrics) return null;
      return {
        cb30: {
          rate: metrics.cb30.rate, denominator: metrics.cb30.denominator, moe: metrics.cb30.moe,
          vintage: String(ACS1_YEAR),
          isProxy, proxyKind, proxyGeoid,
        },
        cb50: {
          rate: metrics.cb50.rate, denominator: metrics.cb50.denominator, moe: metrics.cb50.moe,
          vintage: String(ACS1_YEAR),
          isProxy, proxyKind, proxyGeoid,
        },
      };
    }

    const a5 = acs5Block(acs5Metrics);
    const a1 = acs1Block(acs1Use);

    geos[geoid] = {
      name,
      geoType,
      renter_cb30: {
        chas: chasBlock ? chasBlock.cb30 : null,
        acs5: a5 ? a5.cb30 : null,
        acs1: a1 ? a1.cb30 : null,
      },
      renter_cb50: {
        chas: chasBlock ? chasBlock.cb50 : null,
        acs5: a5 ? a5.cb50 : null,
        acs1: a1 ? a1.cb50 : null,
      },
    };
  }

  // ── State entry ──
  buildEntry({
    geoid: CO_STATE_FIPS,
    name: "Colorado",
    geoType: "state",
    chasBlock: null,  // No state-level CHAS in our pipeline today
    acs5Row: acs5State[0],
    acs1Row: acs1State[0],
    proxyChain: [],
  });

  // ── Counties ──
  const chasByCounty = chasCountyJson.counties || chasCountyJson || {};
  let countyN = 0;
  for (const geoid of Object.keys(chasByCounty)) {
    if (String(geoid).length !== 5) continue;
    const chas = chasByCounty[geoid];
    const acs5Row = acs5C[geoid];
    const acs1Row = acs1C[geoid];
    buildEntry({
      geoid,
      name: (chas && chas.summary && chas.summary.name) || `County ${geoid}`,
      geoType: "county",
      chasBlock: chasBlockCounty(chas),
      acs5Row,
      acs1Row,
      // County proxy fallback: state.
      proxyChain: [{ metrics: acs1S, kind: "state", geoid: CO_STATE_FIPS }],
    });
    countyN++;
  }

  // ── Places ──
  const placeChasMap = placeChasJson.places || {};
  let placeN = 0;
  for (const geoid of Object.keys(placeChasMap)) {
    if (String(geoid).length !== 7) continue;
    const chas = placeChasMap[geoid];
    const containingCounty = containingCountyByPlace[geoid] || null;
    const acs5Row = acs5P[geoid];
    const acs1Row = acs1P[geoid];
    const countyAcs1 = containingCounty && acs1C[containingCounty]
      ? rowToMetrics(acs1C[containingCounty].raw)
      : null;
    buildEntry({
      geoid,
      name: chas.name || `Place ${geoid}`,
      geoType: "place",
      chasBlock: chasBlockPlace(chas),
      acs5Row,
      acs1Row,
      // Place proxy fallback: containing county → state.
      proxyChain: [
        { metrics: countyAcs1, kind: "county", geoid: containingCounty },
        { metrics: acs1S, kind: "state", geoid: CO_STATE_FIPS },
      ],
    });
    placeN++;
  }

  const out = {
    meta: {
      generated_at: "2026-06-09",
      generated_by: "scripts/build_rent_burden_crosscheck.mjs",
      chas_vintage: CHAS_VINTAGE,
      acs5_vintage: CHAS_VINTAGE,
      acs1_vintage: String(ACS1_YEAR),
      counts: { counties: countyN, places: placeN, total: Object.keys(geos).length },
    },
    geos,
  };

  if (DRY_RUN) {
    console.log("\n[F207b] Dry run complete. Sample (Denver County 08031):");
    console.log(JSON.stringify(geos["08031"], null, 2));
    return;
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n[F207b] Wrote ${OUTPUT_PATH}`);
  console.log(`  · ${countyN} counties · ${placeN} places · 1 state · ${Object.keys(geos).length} total`);
}

main().catch(e => { console.error(e); process.exit(1); });
