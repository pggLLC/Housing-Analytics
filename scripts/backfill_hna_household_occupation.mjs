#!/usr/bin/env node
/**
 * F169 — Backfill ACS DP02 / DP03 / DP05 variables that power the new
 * "Household composition, occupation & labor force" panel on the HNA page.
 *
 * Mirrors scripts/backfill_dp04_value_brackets.mjs in shape so the same
 * concurrency + retry behavior applies. Reads every cached summary at
 * data/hna/summary/*.json, fetches the new variables from ACS 5-year
 * profile endpoint, and merges them into acsProfile (no other fields
 * touched). Idempotent — already-filled summaries (DP02_0014E present)
 * are skipped.
 *
 * Usage:
 *   CENSUS_API_KEY=xxxxxx node scripts/backfill_hna_household_occupation.mjs
 *   CENSUS_API_KEY=xxxxxx node scripts/backfill_hna_household_occupation.mjs --dry
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, "..");
const SUMMARY_DIR = path.join(REPO_ROOT, "data", "hna", "summary");

const DRY_RUN = process.argv.includes("--dry");
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;
if (!CENSUS_API_KEY) {
  throw new Error("CENSUS_API_KEY is required. Set it in the environment before running.");
}

// Correct codes for the 2023 ACS 5Y Profile (DP02 table was re-indexed
// in the 2020+ vintage — older guides showing DP02_0034-0040E as 1-7+
// person household-size bins are obsolete; those slots are now
// marital/fertility variables in the current schema).
const VARS = [
  // DP02 household composition + averages
  "DP02_0001E", // Total households
  "DP02_0002E", // Married-couple households
  "DP02_0004E", // Cohabiting-couple households
  "DP02_0006E", // Male householder, no spouse/partner
  "DP02_0007E", // Male HH no spouse, with kids under 18 (single dad)
  "DP02_0008E", // Male HH no spouse, living alone
  "DP02_0010E", // Female householder, no spouse/partner
  "DP02_0011E", // Female HH no spouse, with kids under 18 (single mom)
  "DP02_0012E", // Female HH no spouse, living alone
  "DP02_0014E", // Households with one or more people under 18
  "DP02_0015E", // Households with one or more people 65+
  "DP02_0016E", // Average household size
  "DP02_0017E", // Average family size
  "DP02_0072E", // Civilian noninstitutionalized population with a disability
  // DP03 occupation (5 top-level OCC buckets)
  "DP03_0027E", // Management / business / science / arts
  "DP03_0028E", // Service
  "DP03_0029E", // Sales / office
  "DP03_0030E", // Natural resources / construction / maintenance
  "DP03_0031E", // Production / transportation / material moving
  // DP03 labor-force status
  "DP03_0002E", // In labor force (Pop 16+)
  "DP03_0005E", // Unemployed
  "DP03_0007E", // Not in labor force
];
// DP02_0017E (Average family size) is the F169-v2 sentinel — the first
// run used DP02_0014E with stale labels; this round adds the correct
// vars on top of any partial data already present.
const SENTINEL = "DP02_0017E";
const ACS_BASE = "https://api.census.gov/data/2023/acs/acs5/profile";
const MAX_CONCURRENT = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveGeo(record) {
  const geoTypeRaw = record?.acsProfile?._geoType ?? record?.geo?.type ?? null;
  const geoid = record?.geo?.geoid ?? null;
  if (!geoTypeRaw || !geoid) return { kind: null, geoid: null };
  const t = String(geoTypeRaw).toLowerCase();
  if (t === "state") return { kind: "state", geoid };
  if (t === "county") return { kind: "county", geoid };
  if (["place", "cdp", "city", "town"].includes(t)) return { kind: "place", geoid };
  return { kind: null, geoid };
}

function buildUrl(kind, geoid) {
  const getList = `${VARS.join(",")},NAME`;
  const params = new URLSearchParams();
  params.set("get", getList);
  if (kind === "state") {
    if (String(geoid).length !== 2) return null;
    params.set("for", `state:${geoid}`);
  } else if (kind === "county") {
    if (String(geoid).length !== 5) return null;
    params.set("for", `county:${String(geoid).slice(2, 5)}`);
    params.set("in", `state:${String(geoid).slice(0, 2)}`);
  } else if (kind === "place") {
    if (String(geoid).length !== 7) return null;
    params.set("for", `place:${String(geoid).slice(2, 7)}`);
    params.set("in", `state:${String(geoid).slice(0, 2)}`);
  } else {
    return null;
  }
  params.set("key", CENSUS_API_KEY);
  return `${ACS_BASE}?${params.toString()}`;
}

async function fetchVars(url, attempt = 0) {
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt === 0 && (res.status >= 500 || res.status === 429)) {
      await sleep(1500);
      return fetchVars(url, 1);
    }
    throw new Error(`Census API ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (!Array.isArray(body) || body.length < 2) {
    throw new Error("Unexpected Census response shape");
  }
  const headers = body[0];
  const row = body[1];
  const out = {};
  for (const v of VARS) {
    const idx = headers.indexOf(v);
    out[v] = idx === -1 ? null : (row[idx] === null || row[idx] === "" ? null : row[idx]);
  }
  return out;
}

async function processFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let record;
  try { record = JSON.parse(raw); }
  catch (err) { return { filePath, status: "errored", reason: `bad JSON: ${err.message}` }; }

  const acsProfile = record?.acsProfile;
  if (!acsProfile || typeof acsProfile !== "object") {
    return { filePath, status: "skipped", reason: "no acsProfile block" };
  }
  if (Object.prototype.hasOwnProperty.call(acsProfile, SENTINEL)) {
    return { filePath, status: "skipped", reason: "already has DP02_0014E" };
  }

  const { kind, geoid } = resolveGeo(record);
  if (!kind || !geoid) {
    return { filePath, status: "errored", reason: `unknown geo (kind=${kind}, geoid=${geoid})` };
  }
  const url = buildUrl(kind, geoid);
  if (!url) return { filePath, status: "errored", reason: `bad URL for ${kind} ${geoid}` };

  let vars;
  try { vars = await fetchVars(url); }
  catch (err) { return { filePath, status: "errored", reason: err.message }; }

  const merged = { ...acsProfile, ...vars };
  record.acsProfile = merged;

  if (DRY_RUN) return { filePath, status: "would-fill", count: Object.keys(vars).length };
  await fs.writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
  return { filePath, status: "filled", count: Object.keys(vars).length };
}

async function main() {
  const entries = (await fs.readdir(SUMMARY_DIR))
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(SUMMARY_DIR, f))
    .sort();

  console.log(`[backfill-hh-occ] ${entries.length} summary file(s) found`);

  let filled = 0, skipped = 0, errored = 0;
  const errors = [];
  let i = 0;

  async function worker() {
    while (i < entries.length) {
      const idx = i++;
      const fp = entries[idx];
      const out = await processFile(fp);
      if (out.status === "filled" || out.status === "would-fill") filled++;
      else if (out.status === "skipped") skipped++;
      else { errored++; errors.push(`${path.basename(fp)}: ${out.reason}`); }
      if (idx > 0 && idx % 25 === 0) {
        console.log(`[backfill-hh-occ] progress ${idx + 1}/${entries.length} (filled=${filled} skipped=${skipped} errored=${errored})`);
      }
    }
  }

  await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));

  console.log(`\n=== backfill-hh-occ summary ===`);
  console.log(`filled:  ${filled}`);
  console.log(`skipped: ${skipped}`);
  console.log(`errored: ${errored}`);
  if (errors.length) {
    console.log(`\nErrors:`);
    errors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
    if (errors.length > 20) console.log(`  … plus ${errors.length - 20} more`);
  }
  console.log(DRY_RUN ? "(dry run — no files written)" : "(files written)");
}

main().catch((e) => { console.error(e); process.exit(1); });
