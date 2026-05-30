#!/usr/bin/env node
/**
 * sync-manifest-mtimes.mjs — keep DATA-MANIFEST.json's `last_update`
 * fields synced to the real file mtimes on disk.
 *
 * Designed to run as a pre-commit / CI hook (and is also safe to run
 * by hand). Writes one ISO date per source whose on-disk file is
 * newer than the declared `last_update`, never moves a stamp backward.
 *
 * Exit status: 0 on success (even if nothing changed), 1 on any I/O
 * failure. CI can wire it as a non-blocking "fix-up" step that stages
 * the change automatically.
 *
 * Companion to scripts/audit/refresh-inventory-mtimes.mjs (same idea
 * applied to js/data-source-inventory.js).
 *
 * Usage:
 *   node scripts/audit/sync-manifest-mtimes.mjs            # write
 *   node scripts/audit/sync-manifest-mtimes.mjs --dry-run  # report only
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO     = path.resolve(__dirname, "..", "..");
const MANIFEST = path.join(REPO, "DATA-MANIFEST.json");

const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(MANIFEST)) {
  console.error("[sync-manifest-mtimes] DATA-MANIFEST.json not found at", MANIFEST);
  process.exit(1);
}

const raw = fs.readFileSync(MANIFEST, "utf8");
let json;
try {
  json = JSON.parse(raw);
} catch (e) {
  console.error("[sync-manifest-mtimes] manifest is not valid JSON:", e.message);
  process.exit(1);
}

const sources = Array.isArray(json.sources) ? json.sources : [];
console.log(`[sync-manifest-mtimes] checking ${sources.length} manifest sources`);

const updates = [];
for (const s of sources) {
  if (!s || !s.file_path) continue;
  const abs = path.join(REPO, s.file_path);
  if (!fs.existsSync(abs)) {
    // Manifest references a path that no longer exists; flag but don't change.
    updates.push({ file_path: s.file_path, action: "missing", was: s.last_update, mtime: null });
    continue;
  }
  const mtime = fs.statSync(abs).mtime;
  const mtimeIso = mtime.toISOString().replace(/\.\d+Z$/, "Z");
  const was = s.last_update || null;
  // Compare against the date portion — manifest stores full ISO timestamps.
  const wasDate = was ? was.slice(0, 10) : "";
  const mtimeDate = mtimeIso.slice(0, 10);
  if (mtimeDate > wasDate) {
    updates.push({ file_path: s.file_path, action: "bump", was, mtime: mtimeIso });
    s.last_update = mtimeIso;
  }
}

const bumps = updates.filter(u => u.action === "bump");
const missing = updates.filter(u => u.action === "missing");

if (bumps.length === 0 && missing.length === 0) {
  console.log("[sync-manifest-mtimes] all entries already in sync");
  process.exit(0);
}

if (bumps.length > 0) {
  console.log(`[sync-manifest-mtimes] ${bumps.length} entries to bump:`);
  for (const u of bumps) {
    console.log(`  ${u.file_path.padEnd(60)} ${u.was || "(null)"} → ${u.mtime}`);
  }
}
if (missing.length > 0) {
  console.log(`[sync-manifest-mtimes] ${missing.length} manifest entries point at missing files:`);
  for (const u of missing) console.log(`  ${u.file_path}`);
}

if (dryRun) {
  console.log("\n[sync-manifest-mtimes] --dry-run, no writes");
  process.exit(0);
}

// Bump the manifest's own `generated` stamp too so consumers know the
// version moved.
if (json.generated) json.generated = new Date().toISOString().replace(/\.\d+Z$/, "Z");

fs.writeFileSync(MANIFEST, JSON.stringify(json, null, 2) + "\n");
console.log(`\n[sync-manifest-mtimes] wrote ${bumps.length} updates to ${path.relative(REPO, MANIFEST)}`);
