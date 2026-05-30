#!/usr/bin/env node
/**
 * build-data-manifest.mjs — walk data/ and emit a manifest that the
 * data-explorer.html page reads to render a browsable file list with
 * size / mtime / light schema info per file.
 *
 * For each .json / .geojson / .csv file (under MAX_BYTES bytes) we capture:
 *   - relative path
 *   - size in bytes
 *   - mtime (ISO 8601)
 *   - kind: 'json' | 'geojson' | 'csv'
 *   - record_count: features.length for GeoJSON; array length / top-key counts
 *     for JSON; row count for CSV. Best-effort, parses cheaply.
 *   - schema: a short snapshot — top-level keys for objects, the keys of the
 *     first record for arrays-of-objects, or column names for CSV.
 *
 * Files larger than MAX_PARSE_BYTES are listed but their content isn't probed
 * (size / mtime only). Common excludes (.gitignore'd raw downloads, _manifest
 * itself) are skipped.
 *
 * Output: data/_manifest.json — read directly by data-explorer.html.
 *
 * Usage:
 *   node scripts/audit/build-data-manifest.mjs
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO  = path.resolve(__dirname, "..", "..");
const ROOT  = path.join(REPO, "data");
const OUT   = path.join(ROOT, "_manifest.json");

const EXCLUDE_DIRS = new Set(["lodes-raw", "node_modules", ".git"]);
const EXCLUDE_NAMES = new Set(["_manifest.json"]);

// Don't try to parse files larger than this — just list them.
const MAX_PARSE_BYTES = 25 * 1024 * 1024;

const exts = new Set([".json", ".geojson", ".csv"]);

function kindOf(p) {
  if (p.endsWith(".geojson")) return "geojson";
  if (p.endsWith(".csv"))     return "csv";
  if (p.endsWith(".json"))    return "json";
  return null;
}

async function walk(dir, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (EXCLUDE_DIRS.has(e.name)) continue;
    if (EXCLUDE_NAMES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && exts.has(path.extname(e.name))) {
      out.push(full);
    }
  }
}

function snippetTopLevel(obj) {
  if (Array.isArray(obj)) {
    return {
      shape: "array",
      length: obj.length,
      first_keys: obj.length && typeof obj[0] === "object" && obj[0] ? Object.keys(obj[0]).slice(0, 12) : null,
    };
  }
  if (obj && typeof obj === "object") {
    const keys = Object.keys(obj);
    // Find the largest nested array (often the records under "places", "counties", "features").
    let biggestArrayKey = null, biggestN = 0;
    for (const k of keys) {
      if (Array.isArray(obj[k]) && obj[k].length > biggestN) { biggestArrayKey = k; biggestN = obj[k].length; }
    }
    return {
      shape: "object",
      keys: keys.slice(0, 14),
      key_count: keys.length,
      primary_array_key: biggestArrayKey,
      primary_array_length: biggestArrayKey ? biggestN : null,
      primary_array_first_keys: biggestArrayKey && biggestN && typeof obj[biggestArrayKey][0] === "object"
        ? Object.keys(obj[biggestArrayKey][0]).slice(0, 12)
        : null,
    };
  }
  return { shape: typeof obj };
}

function snippetGeoJSON(obj) {
  if (!obj || typeof obj !== "object") return null;
  const feats = Array.isArray(obj.features) ? obj.features : [];
  const props = feats.length && feats[0] && feats[0].properties ? Object.keys(feats[0].properties).slice(0, 14) : null;
  const geomType = feats.length && feats[0] && feats[0].geometry ? feats[0].geometry.type : null;
  return { shape: "geojson", feature_count: feats.length, property_keys: props, geometry_type: geomType };
}

function snippetCSV(text) {
  const lines = text.split(/\r?\n/);
  const cols  = (lines[0] || "").split(",").map(s => s.trim()).slice(0, 16);
  // Count non-empty rows ex header
  let rows = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim()) rows++;
  return { shape: "csv", row_count: rows, columns: cols, column_count: cols.length };
}

async function probe(file) {
  const stat = await fsp.stat(file);
  const k = kindOf(file);
  const entry = {
    path: path.relative(ROOT, file).replaceAll("\\", "/"),
    kind: k,
    size_bytes: stat.size,
    mtime: stat.mtime.toISOString(),
  };
  if (stat.size > MAX_PARSE_BYTES) {
    entry.note = "too-large-to-parse";
    return entry;
  }
  try {
    if (k === "csv") {
      const txt = await fsp.readFile(file, "utf8");
      Object.assign(entry, snippetCSV(txt));
    } else {
      const raw = await fsp.readFile(file, "utf8");
      const obj = JSON.parse(raw);
      Object.assign(entry, k === "geojson" ? snippetGeoJSON(obj) : snippetTopLevel(obj));
    }
  } catch (e) {
    entry.error = String(e.message || e);
  }
  return entry;
}

async function main() {
  const files = [];
  await walk(ROOT, files);
  files.sort();
  const items = [];
  for (const f of files) {
    items.push(await probe(f));
  }
  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      root: "data/",
      file_count: items.length,
      total_size_bytes: items.reduce((s, x) => s + (x.size_bytes || 0), 0),
      kinds: items.reduce((acc, x) => { acc[x.kind] = (acc[x.kind] || 0) + 1; return acc; }, {}),
    },
    files: items,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`[data-manifest] wrote ${items.length} entries (${(out.meta.total_size_bytes / 1024 / 1024).toFixed(1)} MB) → ${path.relative(REPO, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
