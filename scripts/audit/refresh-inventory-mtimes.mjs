#!/usr/bin/env node
/**
 * refresh-inventory-mtimes.mjs — walk js/data-source-inventory.js,
 * cross-reference each source's `localFile:` against the committed data
 * file, and rewrite two fields that otherwise rot:
 *
 *   - `lastUpdated:` → the file's real mtime, when on-disk is newer.
 *   - `features:`    → the actual record count in the file, for every
 *     source listed in JSON_COUNT_PATHS.
 *
 * Why
 * ---
 * The dashboard's `Stale` count was dominated by inventory drift —
 * entries declaring `lastUpdated: '2024-08-30'` (or earlier) for files
 * that scripts refresh nightly. The dashboard treated them as overdue
 * even though the on-disk file was newer. This script syncs the
 * declared timestamp to the real one.
 *
 * `features:` rotted the same way, but louder: nothing recomputed it, so
 * test/data-source-inventory-drift.test.js turned main red whenever an
 * append-only series grew. `fred-mortgage30` publishes one observation a
 * week, so it broke roughly weekly (2026-09-11) and was reconciled by
 * hand in PR #1569 and again in #1593. Now it's recomputed here, from the
 * same map the gate asserts against.
 *
 * Rules
 * -----
 *   - If localFile is null or the path doesn't exist on disk → skip
 *     (those are reference entries with no cached file).
 *   - If mtime is newer than the declared lastUpdated → update.
 *   - If mtime is *older* than the declared lastUpdated → leave alone
 *     (someone curated a manual date — don't overwrite it backward).
 *   - `features:` is synced in *both* directions — the gate asserts exact
 *     equality, so a count that shrank is drift just the same.
 *   - `features: null` entries are left alone. Those declare
 *     `featuresCountable: false` with no localFile; the count genuinely
 *     doesn't exist and must not be invented.
 *   - COUNTY_DIRECTORY_IDS are left alone too: they count per-county files
 *     present in a directory against data/hna/geo-config.json rather than
 *     a path inside one document, and a partial sync of that directory
 *     should surface as a failing gate, not get papered over here.
 *   - Always print a summary diff.
 *
 * Usage
 * -----
 *     node scripts/audit/refresh-inventory-mtimes.mjs
 *     node scripts/audit/refresh-inventory-mtimes.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { contentDate, isShallow } from "./content-date.mjs";
import { fileURLToPath } from "node:url";

import countPaths from "./inventory-count-paths.cjs";

const { JSON_COUNT_PATHS, valueAt, collectionCount, countFor } = countPaths;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO      = path.resolve(__dirname, "..", "..");
const INVENTORY = path.join(REPO, "js", "data-source-inventory.js");

const dryRun = process.argv.includes("--dry-run");

const src = fs.readFileSync(INVENTORY, "utf8");

// Parse each SOURCES entry to extract id, localFile, lastUpdated, features.
// The file is a JS module so we can't JSON.parse it. Instead we walk the
// SOURCES block tracking real brace depth: an entry is the object that takes
// depth 0 → 1, and its own fields are the keys sitting at depth 1. Keys at
// depth 2+ belong to a nested object and are none of our business.
//
// This used to key off fixed indentation (`^\s{4}\{` for the entry, `^\s{6}`
// for its fields), which is fragile in both directions: a loose anchor picks
// up nested keys and rewrites the wrong line, while a strict one silently
// drops any entry a reformat re-indents — and a dropped entry means a count
// that never gets reconciled, with nothing to say so. Depth doesn't care how
// the file is indented.
const sourcesStart = src.indexOf("var SOURCES = [");
const sourcesEnd   = src.indexOf("\n  ];", sourcesStart);
if (sourcesStart < 0 || sourcesEnd < 0) {
  console.error("[refresh-mtimes] could not locate SOURCES array — bailing");
  process.exit(1);
}
const sourcesBlock = src.slice(sourcesStart, sourcesEnd);

/**
 * Brace depth and string/comment masking for one line.
 *
 * `depths[i]` is the depth *before* consuming character i, so a key token's
 * depth is read at its first character. Braces inside quoted strings or after
 * a `//` comment don't move the depth, and `inert[i]` marks those regions so a
 * key-shaped substring inside a description string can't be mistaken for a
 * real field.
 */
function scanLine(line, startDepth) {
  const depths = new Array(line.length);
  const inert  = new Array(line.length).fill(false);
  let depth = startDepth;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    depths[i] = depth;
    if (quote) {
      inert[i] = true;
      if (c === "\\") {                       // escape: consume the next char too
        i += 1;
        if (i < line.length) { depths[i] = depth; inert[i] = true; }
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; inert[i] = true; continue; }
    if (c === "/" && line[i + 1] === "/") {   // line comment: rest is inert
      for (let j = i; j < line.length; j += 1) { depths[j] = depth; inert[j] = true; }
      break;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
  }
  return { depths, inert, endDepth: depth };
}

// Key → matcher. Global so one line can hold several fields; the depth check
// below decides which matches actually belong to the entry.
const FIELD_PATTERNS = [
  ["id",          /\bid:\s*'([^']*)'/g,                 (m) => m[1]],
  ["localFile",   /\blocalFile:\s*(?:'([^']*)'|null)/g, (m) => (m[1] === undefined ? null : m[1])],
  ["lastUpdated", /\blastUpdated:\s*(?:'([^']*)'|null)/g, (m) => (m[1] === undefined ? null : m[1])],
  ["features",    /\bfeatures:\s*(\d+|null)/g,          (m) => (m[1] === "null" ? null : Number(m[1]))],
];

const lines = sourcesBlock.split("\n");
const entries = [];
let cur = null;
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const { depths, inert, endDepth } = scanLine(ln, depth);

  // Depth 0 → 1 opens an entry.
  if (!cur && depth === 0 && endDepth > 0) {
    cur = {
      startLine: i, endLine: -1,
      idLine: -1, localFileLine: -1, lastUpdatedLine: -1, featuresLine: -1,
      id: null, localFile: null, lastUpdated: null, features: null,
    };
  }

  if (cur) {
    for (const [field, pattern, extract] of FIELD_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(ln)) !== null) {
        if (inert[m.index] || depths[m.index] !== 1) continue;  // nested, or inside a string
        cur[field] = extract(m);
        cur[`${field}Line`] = i;
      }
    }
  }

  depth = endDepth;

  if (cur && depth === 0) {
    cur.endLine = i;
    // Fail closed. A silently skipped entry is a count that never gets
    // reconciled and no signal that anything was missed — exactly the class
    // of bug the fixed-indent parser could cause.
    const missing = ["id", "localFile", "lastUpdated", "features"]
      .filter((field) => cur[`${field}Line`] < 0);
    if (missing.length > 0) {
      console.error(
        `[refresh-mtimes] entry at lines ${cur.startLine + 1}-${cur.endLine + 1} is missing ` +
        `required field(s): ${missing.join(", ")} — refusing to run against an inventory ` +
        "it cannot fully parse"
      );
      process.exit(1);
    }
    entries.push(cur);
    cur = null;
  }
}

if (cur) {
  console.error(
    `[refresh-mtimes] unterminated entry starting at line ${cur.startLine + 1} — bailing`
  );
  process.exit(1);
}

console.log(`[refresh-mtimes] parsed ${entries.length} inventory entries`);

const updates = [];
// Resolve shallowness once rather than shelling out per source.
const repoIsShallow = isShallow(REPO);
if (repoIsShallow) {
  console.warn(
    "[refresh-mtimes] shallow clone — cannot read real content dates, leaving lastUpdated untouched. " +
    "Set fetch-depth: 0 on the checkout."
  );
}
let skippedNoHistory = 0;
for (const e of entries) {
  if (!e.localFile) continue;
  const abs = path.join(REPO, e.localFile);
  if (!fs.existsSync(abs)) continue;

  // F1597 — was fs.statSync(abs).mtime. Git neither records nor restores
  // mtimes, and actions/checkout rewrites every tracked file, so on a runner
  // every data file's mtime is the checkout time: each scheduled run bumped
  // all 47 sources to the same date and nothing could ever read as stale.
  // The commit that last changed the file is the honest answer.
  const resolved = contentDate(REPO, e.localFile, { shallow: repoIsShallow });
  const mtimeIso = resolved.date;
  if (!mtimeIso) {
    skippedNoHistory += 1;
    continue;
  }

  if (!e.lastUpdated) {
    updates.push({ ...e, mtimeIso, action: "set" });
    continue;
  }
  // Unlike the old mtime rule this is a two-way sync. A stamp that is too NEW
  // is the defect being repaired here, so a correction backwards is exactly
  // what is wanted — the declared date should equal the content date, and any
  // difference in either direction is drift.
  if (mtimeIso !== e.lastUpdated) {
    updates.push({ ...e, mtimeIso, action: mtimeIso > e.lastUpdated ? "bump" : "correct" });
  }
}
if (skippedNoHistory) {
  console.warn(`[refresh-mtimes] ${skippedNoHistory} source(s) had no usable content date — left unchanged`);
}

// Recount `features:` for every source whose count the drift gate derives
// from a dotted path into a single JSON document. Unlike lastUpdated this is
// a two-way sync: the gate asserts exact equality, so a shrunken collection
// is drift too.
const countUpdates = [];
for (const e of entries) {
  const dottedPath = JSON_COUNT_PATHS[e.id];
  if (!dottedPath) continue;
  // `features: null` means featuresCountable:false with no localFile — the
  // count doesn't exist upstream, so there is nothing to recompute.
  if (e.features === null || e.featuresLine < 0) continue;
  if (!e.localFile) continue;
  const abs = path.join(REPO, e.localFile);
  if (!fs.existsSync(abs)) continue;

  let counted;
  try {
    const data = JSON.parse(fs.readFileSync(abs, "utf8"));
      counted = countFor(e.id, data);
  } catch (err) {
    // Don't guess. Leave the declared count alone and let the drift gate
    // fail loudly on the real problem rather than writing a wrong number.
    console.warn(`[refresh-mtimes] ${e.id}: cannot count '${dottedPath}' in ${e.localFile} — ${err.message}`);
    continue;
  }

  if (counted !== e.features) {
    countUpdates.push({ ...e, counted });
  }
}

if (updates.length === 0 && countUpdates.length === 0) {
  console.log("[refresh-mtimes] nothing to update");
  process.exit(0);
}

if (updates.length > 0) {
  console.log(`[refresh-mtimes] ${updates.length} lastUpdated entries to refresh:`);
  for (const u of updates) {
    console.log(`  ${u.id.padEnd(40)} ${u.lastUpdated || "(null)"} → ${u.mtimeIso}  (${u.localFile})`);
  }
}

if (countUpdates.length > 0) {
  console.log(`[refresh-mtimes] ${countUpdates.length} features counts to reconcile:`);
  for (const u of countUpdates) {
    console.log(`  ${u.id.padEnd(40)} ${u.features} → ${u.counted}  (${u.localFile}:${JSON_COUNT_PATHS[u.id]})`);
  }
}

if (dryRun) {
  console.log("\n[refresh-mtimes] --dry-run, no writes");
  process.exit(0);
}

// Apply edits by line number. Sort descending so earlier-line edits don't
// shift later line numbers, but here we're editing in-place via string
// replacement on whole-line content — sorting isn't strictly needed.
const newLines = lines.slice();
for (const u of updates) {
  const ln = newLines[u.lastUpdatedLine];
  // Replace whatever lastUpdated value (string OR `null`) with the new ISO.
  newLines[u.lastUpdatedLine] = ln.replace(
    /lastUpdated:\s*('[^']*'|null)/,
    `lastUpdated: '${u.mtimeIso}'`
  );
}

for (const u of countUpdates) {
  const ln = newLines[u.featuresLine];
  newLines[u.featuresLine] = ln.replace(/features:\s*(\d+|null)/, `features: ${u.counted}`);
}

const newSourcesBlock = newLines.join("\n");
const newSrc = src.slice(0, sourcesStart) + newSourcesBlock + src.slice(sourcesEnd);
fs.writeFileSync(INVENTORY, newSrc);
console.log(
  `\n[refresh-mtimes] wrote ${updates.length} lastUpdated + ${countUpdates.length} features updates ` +
  `to ${path.relative(REPO, INVENTORY)}`
);
