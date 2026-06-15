# `scripts/build_rent_burden_crosscheck.mjs`

## Symbols

### `B25070_VARS`

F207b — Build the CHAS rent-burden crosscheck JSON.

Phase C of the CHAS reliability spec. Fetches ACS B25070 detailed
tables (5-year 2018–2022 + 1-year 2023) for every CO geography we
have CHAS data for, computes rates + MOE per the Census proportion
formula, and cross-references against the existing CHAS county and
place data. The output drives js/rent-burden-reliability.js.

Per the spec's QA review (Claude 2026-06-09):
  - ACS 5-year MUST match CHAS vintage (2018-2022) — definitional
    check, NOT a freshness check
  - ACS 1-year is the only genuinely newer source. For sub-65k
    geographies, falls back to containing county → state with a
    clear isProxy + proxyKind flag
  - MOE propagation via root-sum-of-squares (component cells) and
    the Census proportion formula (with RATIO fallback when the
    radicand goes negative)

Usage:
  CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs
  CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs --dry

Output: data/processed/rent_burden_crosscheck.json
/

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
001 Total renter-occupied units (universe)
002–006 Under 30% bands (not used in burden math)
007 30.0–34.9%
008 35.0–39.9%
009 40.0–49.9%
010 50.0%+
011 Not computed

E = estimate, M = MOE (90% confidence)
