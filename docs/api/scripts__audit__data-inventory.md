# `scripts/audit/data-inventory.mjs`

## Symbols

### `inspectFile(filePath)`

scripts/audit/data-inventory.mjs

Inventories all local data files under data/ and maps/ and prints a
human-readable report plus a machine-readable JSON summary.

Usage:
  node scripts/audit/data-inventory.mjs [--json]

With --json, writes data/manifest.json and prints the JSON to stdout.
Without --json, prints a formatted table to stdout.

Reports:
 - File path, size (KB), type, feature/record count, geographic coverage
 - Flags placeholder files (0 features, stub metadata)
 - Summary totals
/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const MAPS_DIR = path.join(ROOT, 'maps');
const MANIFEST_OUT = path.join(ROOT, 'data', 'manifest.json');

const JSON_OUTPUT = process.argv.includes('--json');

// ── helpers ──────────────────────────────────────────────────────────────────

function walk(dir, ext = ['.json', '.geojson', '.csv', '.txt']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full, ext));
    } else if (ext.some(e => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

function sizeKb(filePath) {
  return (fs.statSync(filePath).size / 1024).toFixed(1);
}

/**
Returns { type, featureCount, recordCount, geoCoverage, placeholder, note }
by inspecting the file contents.
