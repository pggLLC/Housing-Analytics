#!/usr/bin/env node
/**
 * refresh-inventory-mtimes.mjs — walk js/data-source-inventory.js,
 * cross-reference each source's `localFile:` against the file's real
 * mtime, and rewrite `lastUpdated:` to that mtime when the on-disk
 * file is newer than what the inventory declares.
 *
 * Why
 * ---
 * The dashboard's `Stale` count was dominated by inventory drift —
 * entries declaring `lastUpdated: '2024-08-30'` (or earlier) for files
 * that scripts refresh nightly. The dashboard treated them as overdue
 * even though the on-disk file was newer. This script syncs the
 * declared timestamp to the real one.
 *
 * Rules
 * -----
 *   - If localFile is null or the path doesn't exist on disk → skip
 *     (those are reference entries with no cached file).
 *   - If mtime is newer than the declared lastUpdated → update.
 *   - If mtime is *older* than the declared lastUpdated → leave alone
 *     (someone curated a manual date — don't overwrite it backward).
 *   - Always print a summary diff.
 *
 * Usage
 * -----
 *     node scripts/audit/refresh-inventory-mtimes.mjs
 *     node scripts/audit/refresh-inventory-mtimes.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO      = path.resolve(__dirname, "..", "..");
const INVENTORY = path.join(REPO, "js", "data-source-inventory.js");

const dryRun = process.argv.includes("--dry-run");

const src = fs.readFileSync(INVENTORY, "utf8");

// Parse each SOURCES entry to extract id, localFile, lastUpdated. The file
// is a JS module so we can't JSON.parse it; instead read the SOURCES block
// and split into per-entry chunks delimited by top-level `},` followed by
// `{` at indent 4 (the actual format).
const sourcesStart = src.indexOf("var SOURCES = [");
const sourcesEnd   = src.indexOf("\n  ];", sourcesStart);
if (sourcesStart < 0 || sourcesEnd < 0) {
  console.error("[refresh-mtimes] could not locate SOURCES array — bailing");
  process.exit(1);
}
const sourcesBlock = src.slice(sourcesStart, sourcesEnd);

// Match every `id: '...'` and the surrounding entry. Each entry is a top-
// level `{ ... }` inside the SOURCES array. The structure is regular enough
// that we can grab the lines for id, localFile, lastUpdated by line-scanning.
const lines = sourcesBlock.split("\n");
const entries = [];
let cur = null;
let braceDepth = 0;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  // Open of an entry: a line that's just `{` at indent 4
  if (/^\s{4}\{/.test(ln) && braceDepth === 0) {
    cur = { startLine: i, idLine: -1, localFileLine: -1, lastUpdatedLine: -1, id: null, localFile: null, lastUpdated: null };
    braceDepth = 1;
    continue;
  }
  if (cur) {
    // Count nested braces so we leave entry only at the matching `}`.
    for (const c of ln) {
      if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
    }
    let mi;
    if ((mi = ln.match(/^\s*id:\s*'([^']+)'/)))                 { cur.idLine = i; cur.id = mi[1]; }
    if ((mi = ln.match(/^\s*localFile:\s*('([^']*)'|null)/)))    { cur.localFileLine = i; cur.localFile = mi[2] || null; }
    if ((mi = ln.match(/^\s*lastUpdated:\s*('([^']*)'|null)/)))  { cur.lastUpdatedLine = i; cur.lastUpdated = mi[2] || null; }
    if (braceDepth === 0) {
      cur.endLine = i;
      if (cur.id) entries.push(cur);
      cur = null;
    }
  }
}

console.log(`[refresh-mtimes] parsed ${entries.length} inventory entries`);

const updates = [];
for (const e of entries) {
  if (!e.localFile) continue;
  const abs = path.join(REPO, e.localFile);
  if (!fs.existsSync(abs)) continue;
  const mtime = fs.statSync(abs).mtime;
  // Compare on the ISO date (YYYY-MM-DD) — the inventory's stored format.
  const mtimeIso = mtime.toISOString().slice(0, 10);
  if (!e.lastUpdated) {
    updates.push({ ...e, mtimeIso, action: "set" });
    continue;
  }
  // Only bump if mtime is strictly later — don't roll back a manually
  // curated "we know this hasn't changed yet" date.
  if (mtimeIso > e.lastUpdated) {
    updates.push({ ...e, mtimeIso, action: "bump" });
  }
}

if (updates.length === 0) {
  console.log("[refresh-mtimes] nothing to update");
  process.exit(0);
}

console.log(`[refresh-mtimes] ${updates.length} entries to refresh:`);
for (const u of updates) {
  console.log(`  ${u.id.padEnd(40)} ${u.lastUpdated || "(null)"} → ${u.mtimeIso}  (${u.localFile})`);
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

const newSourcesBlock = newLines.join("\n");
const newSrc = src.slice(0, sourcesStart) + newSourcesBlock + src.slice(sourcesEnd);
fs.writeFileSync(INVENTORY, newSrc);
console.log(`\n[refresh-mtimes] wrote ${updates.length} updates to ${path.relative(REPO, INVENTORY)}`);
