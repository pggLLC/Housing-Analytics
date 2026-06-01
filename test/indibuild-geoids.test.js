#!/usr/bin/env node
/**
 * test/indibuild-geoids.test.js
 * ===============================
 * Guard against the bug we shipped where 7 of 10 starter pipeline GEOIDs
 * were fabricated and resolved to wrong / non-existent Census places
 * (Carbondale was even mapped to Cañon City). Every geoid in the
 * IndiBuild CSV data + curated policy-progress dataset MUST resolve to
 * a real Census place whose name contains the jurisdiction string.
 *
 * Run via:  npm run test:indibuild-geoids
 * Wired in CI through package.json test scripts.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CENTROIDS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'co-place-centroids.json'), 'utf8')
).byGeoid;

let failures = 0;
let checks = 0;

function report(ok, msg) {
  checks++;
  if (ok) {
    process.stdout.write(`  ✅ PASS: ${msg}\n`);
  } else {
    failures++;
    process.stdout.write(`  ❌ FAIL: ${msg}\n`);
  }
}

function parseCSV(text) {
  // Same simple parser the page uses (handles quoted fields).
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c && c.trim()));
}

function csvRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {}; headers.forEach((h, i) => obj[h] = (r[i] || '').trim()); return obj;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Every place-geoid in pipeline/signal-log/anti-targets CSVs must:
//    (a) exist in co-place-centroids.json
//    (b) have a name that contains the jurisdiction string from the CSV
// ────────────────────────────────────────────────────────────────────────────
const csvFiles = [
  ['docs/indibuild-pipeline-prototype/01-signal-log.csv', 'signal-log'],
  ['docs/indibuild-pipeline-prototype/02-pipeline.csv', 'pipeline'],
  ['docs/indibuild-pipeline-prototype/03-anti-targets.csv', 'anti-targets'],
];
console.log('\n1. IndiBuild CSV geoids resolve to real Census places');

for (const [fp, label] of csvFiles) {
  const full = path.join(ROOT, fp);
  if (!fs.existsSync(full)) {
    report(false, `${label}: file missing at ${fp}`);
    continue;
  }
  const rows = csvRows(full);
  for (const row of rows) {
    const g = (row.geoid || '').trim();
    const j = (row.jurisdiction || '').trim();
    if (!g || !j) continue;
    if (g === '08' || /^EXAMPLE/i.test(j)) continue;   // statewide / template rows
    if (g.length === 5) continue;                       // county FIPS — different file
    const rec = CENTROIDS[g];
    if (!rec) {
      report(false, `${label}: ${j} (${g}) — geoid not in co-place-centroids.json`);
      continue;
    }
    // Match: any meaningful token from the jurisdiction name appears in the place name
    const tokens = j.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3);
    const placeNameLower = rec.name.toLowerCase();
    const matched = tokens.some(t => placeNameLower.includes(t));
    if (matched) {
      report(true, `${label}: ${j} (${g}) → ${rec.name}`);
    } else {
      report(false, `${label}: ${j} (${g}) → ${rec.name} — name mismatch`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Same for the curated policy-progress JSON.
// ────────────────────────────────────────────────────────────────────────────
console.log('\n2. Policy-progress dataset geoids resolve to real geography');
const progFile = path.join(ROOT, 'data', 'policy', 'jurisdiction-housing-progress.json');
if (fs.existsSync(progFile)) {
  const prog = JSON.parse(fs.readFileSync(progFile, 'utf8'));
  for (const [geoid, rec] of Object.entries(prog.by_geoid || {})) {
    const name = rec.name || '(unnamed)';
    if (geoid.length === 5) {
      // County FIPS — not in place centroids, but should be 08xxx
      const ok = /^08\d{3}$/.test(geoid);
      report(ok, `policy-progress (county): ${name} → ${geoid} ${ok ? '' : '(invalid CO FIPS)'}`);
      continue;
    }
    if (geoid.length === 7) {
      const place = CENTROIDS[geoid];
      if (!place) {
        report(false, `policy-progress: ${name} (${geoid}) — not in co-place-centroids.json`);
        continue;
      }
      const tokens = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length >= 3);
      const matched = tokens.some(t => place.name.toLowerCase().includes(t));
      report(matched, `policy-progress: ${name} (${geoid}) → ${place.name}`);
      continue;
    }
    report(false, `policy-progress: ${name} (${geoid}) — geoid not 5 or 7 digits`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n=============================================`);
console.log(`IndiBuild geoid guard: ${checks - failures} passed, ${failures} failed`);
if (failures > 0) {
  console.log('\nFix: look up the real Census place GEOID in data/co-place-centroids.json');
  console.log('     and update the offending CSV row(s) or policy-progress entry.');
  process.exit(1);
}
process.exit(0);
