#!/usr/bin/env node
/**
 * Backfill DP04_0080E .. DP04_0088E (home-value brackets) into
 * data/hna/summary/*.json acsProfile blocks. F160 home-value-distribution
 * chart needs every bracket; today most summary files only carry the
 * median (DP04_0089E).
 *
 * Usage:
 *   CENSUS_API_KEY=xxxxxx node scripts/backfill_dp04_value_brackets.mjs
 *   CENSUS_API_KEY=xxxxxx node scripts/backfill_dp04_value_brackets.mjs --dry
 *
 * One-off. Reads summary files, identifies which already carry
 * DP04_0083E in acsProfile (skip) vs. which need fill, calls the ACS
 * 5-year profile endpoint with the nine bracket vars + NAME, and
 * merges the values back into acsProfile (no other fields touched).
 *
 * Polite batching: max 4 concurrent requests, one retry on transient
 * error, summary report at end.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SUMMARY_DIR = path.join(REPO_ROOT, "data", "hna", "summary");

const DRY_RUN = process.argv.includes("--dry");
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;
if (!CENSUS_API_KEY) {
  throw new Error(
    "CENSUS_API_KEY is required. Set it in the environment before running."
  );
}

const VARS = [
  "DP04_0080E",
  "DP04_0081E",
  "DP04_0082E",
  "DP04_0083E",
  "DP04_0084E",
  "DP04_0085E",
  "DP04_0086E",
  "DP04_0087E",
  "DP04_0088E",
];
const SENTINEL = "DP04_0083E"; // used to detect already-filled files
const ACS_BASE = "https://api.census.gov/data/2023/acs/acs5/profile";
const MAX_CONCURRENT = 4;

/** Sleep helper. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the geoType + geoid for a given summary record. Prefers
 * acsProfile._geoType when present; falls back to sum.geo.type. Place
 * variants ("place" / "cdp" / "city") all map to the place endpoint.
 */
function resolveGeo(record) {
  const geoTypeRaw =
    record?.acsProfile?._geoType ??
    record?.geo?.type ??
    null;
  const geoid = record?.geo?.geoid ?? null;
  if (!geoTypeRaw || !geoid) {
    return { kind: null, geoid: null };
  }
  const t = String(geoTypeRaw).toLowerCase();
  if (t === "state") return { kind: "state", geoid };
  if (t === "county") return { kind: "county", geoid };
  if (t === "place" || t === "cdp" || t === "city" || t === "town") {
    return { kind: "place", geoid };
  }
  return { kind: null, geoid };
}

/**
 * Build the Census ACS 5-year profile URL for the bracket vars. Returns
 * null when the geoid shape doesn't match what we expect for the kind.
 */
function buildUrl(kind, geoid) {
  const getList = `${VARS.join(",")},NAME`;
  const params = new URLSearchParams();
  params.set("get", getList);

  if (kind === "state") {
    if (String(geoid).length !== 2) return null;
    params.set("for", `state:${geoid}`);
  } else if (kind === "county") {
    if (String(geoid).length !== 5) return null;
    const state = String(geoid).slice(0, 2);
    const county = String(geoid).slice(2, 5);
    params.set("for", `county:${county}`);
    params.set("in", `state:${state}`);
  } else if (kind === "place") {
    if (String(geoid).length !== 7) return null;
    const state = String(geoid).slice(0, 2);
    const place = String(geoid).slice(2, 7);
    params.set("for", `place:${place}`);
    params.set("in", `state:${state}`);
  } else {
    return null;
  }
  params.set("key", CENSUS_API_KEY);
  return `${ACS_BASE}?${params.toString()}`;
}

/**
 * Fetch the bracket vars for a given URL and return a plain
 * { DP04_0080E: ..., ... } object. One retry on transient errors.
 */
async function fetchBrackets(url, attempt = 0) {
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt === 0 && (res.status >= 500 || res.status === 429)) {
      await sleep(1500);
      return fetchBrackets(url, 1);
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
    if (idx === -1) {
      out[v] = null;
    } else {
      const raw = row[idx];
      out[v] = raw === null || raw === "" ? null : raw;
    }
  }
  return out;
}

/** Process one summary file end-to-end. */
async function processFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    return { filePath, status: "errored", reason: `bad JSON: ${err.message}` };
  }

  const acsProfile = record?.acsProfile;
  if (!acsProfile || typeof acsProfile !== "object") {
    return {
      filePath,
      status: "skipped",
      reason: "no acsProfile block",
    };
  }
  if (Object.prototype.hasOwnProperty.call(acsProfile, SENTINEL)) {
    return { filePath, status: "skipped", reason: "already has DP04_0083E" };
  }

  const { kind, geoid } = resolveGeo(record);
  if (!kind || !geoid) {
    return {
      filePath,
      status: "errored",
      reason: `unknown geoType/geoid (kind=${kind}, geoid=${geoid})`,
    };
  }
  const url = buildUrl(kind, geoid);
  if (!url) {
    return {
      filePath,
      status: "errored",
      reason: `cannot build URL for ${kind} ${geoid}`,
    };
  }

  let brackets;
  try {
    brackets = await fetchBrackets(url);
  } catch (err) {
    return { filePath, status: "errored", reason: err.message };
  }

  // Merge bracket values into acsProfile; preserve all existing fields.
  const merged = { ...acsProfile, ...brackets };
  const updated = { ...record, acsProfile: merged };
  if (!DRY_RUN) {
    await fs.writeFile(
      filePath,
      JSON.stringify(updated, null, 2) + "\n",
      "utf8"
    );
  }
  return { filePath, status: "filled", reason: `${kind}:${geoid}` };
}

/** Drain a queue of tasks with a fixed concurrency. */
async function runQueue(tasks, concurrency, onResult) {
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const myIdx = idx++;
      const result = await tasks[myIdx]();
      onResult(result, myIdx);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

async function main() {
  const entries = await fs.readdir(SUMMARY_DIR);
  const jsonFiles = entries
    .filter((n) => n.toLowerCase().endsWith(".json"))
    .map((n) => path.join(SUMMARY_DIR, n))
    .sort();

  console.log(
    `[backfill-dp04] ${jsonFiles.length} summary files, ${
      DRY_RUN ? "DRY RUN" : "WRITE MODE"
    }, concurrency=${MAX_CONCURRENT}`
  );

  const results = { filled: 0, skipped: 0, errored: 0 };
  const errors = [];

  const tasks = jsonFiles.map((fp) => () => processFile(fp));
  let processed = 0;
  await runQueue(tasks, MAX_CONCURRENT, (r) => {
    processed++;
    results[r.status]++;
    if (r.status === "errored") {
      errors.push(`${path.basename(r.filePath)}: ${r.reason}`);
    }
    if (processed % 25 === 0 || processed === jsonFiles.length) {
      console.log(
        `[backfill-dp04] progress ${processed}/${jsonFiles.length} ` +
          `(filled=${results.filled} skipped=${results.skipped} errored=${results.errored})`
      );
    }
  });

  console.log("");
  console.log("=== backfill-dp04 summary ===");
  console.log(`filled:  ${results.filled}`);
  console.log(`skipped: ${results.skipped}`);
  console.log(`errored: ${results.errored}`);
  if (errors.length) {
    console.log("");
    console.log("Errors:");
    for (const e of errors.slice(0, 50)) {
      console.log(`  - ${e}`);
    }
    if (errors.length > 50) {
      console.log(`  ... and ${errors.length - 50} more`);
    }
  }
  console.log(DRY_RUN ? "(dry run; no files written)" : "(files written)");
}

main().catch((err) => {
  console.error("[backfill-dp04] fatal:", err);
  process.exit(1);
});
