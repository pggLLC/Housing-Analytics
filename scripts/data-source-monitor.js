#!/usr/bin/env node
/**
 * scripts/data-source-monitor.js
 * Checks registered data sources for staleness and scans for unregistered data files.
 * Called by .github/workflows/data-source-monitoring.yml on a daily schedule.
 *
 * Output lines tagged for parsing by the workflow:
 *   STALE: <id>  <name>  <days>d  (file exists)
 *   AGING: <id>  <name>  <days>d
 *   NEW_FILE: <path>  (not in registry)
 *   OK: <id>  <name>  <score>%
 *   ERROR: <message>
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ── Load source registry ──────────────────────────────────────── */
let SOURCES = [];
try {
  // Use vm.runInNewContext to safely evaluate the IIFE in a sandbox
  const vm  = require('vm');
  const src = fs.readFileSync(path.join(ROOT, 'js/data-source-inventory.js'), 'utf8');
  const sandbox = { window: {}, console };
  vm.runInNewContext(src, sandbox);
  const inv = sandbox.window.DataSourceInventory;
  SOURCES = inv && inv.getSources ? inv.getSources() : [];
} catch (err) {
  console.error('ERROR: Could not load DataSourceInventory — ' + err.message);
  process.exit(1);
}

if (!SOURCES.length) {
  console.error('ERROR: No sources loaded from data-source-inventory.js');
  process.exit(1);
}

console.log('Loaded ' + SOURCES.length + ' registered sources.\n');

/* ── Staleness check ───────────────────────────────────────────── */
const MS_PER_DAY = 86400000;
const now = Date.now();
let staleCount = 0;
let agingCount = 0;
let okCount    = 0;

SOURCES.forEach(function (s) {
  if (!s.lastUpdated || !s.maxAgeDays) {
    console.log('UNKNOWN: ' + s.id + '\t' + s.name + '\t(no lastUpdated or maxAgeDays)');
    return;
  }
  const days = Math.floor((now - new Date(s.lastUpdated).getTime()) / MS_PER_DAY);
  const agingThreshold = Math.floor(s.maxAgeDays * 0.7);
  const score = Math.max(0, Math.round(100 * (1 - days / s.maxAgeDays)));

  if (days > s.maxAgeDays) {
    console.log('STALE: ' + s.id + '\t' + s.name + '\t' + days + 'd since update (max: ' + s.maxAgeDays + 'd, score: ' + score + '%)');
    staleCount++;
  } else if (days > agingThreshold) {
    console.log('AGING: ' + s.id + '\t' + s.name + '\t' + days + 'd since update (max: ' + s.maxAgeDays + 'd, score: ' + score + '%)');
    agingCount++;
  } else {
    console.log('OK: ' + s.id + '\t' + s.name + '\t' + score + '%');
    okCount++;
  }
});

console.log('\n── Staleness Summary ─────────────────────────────────────');
console.log('OK:    ' + okCount);
console.log('Aging: ' + agingCount);
console.log('Stale: ' + staleCount);

/* ── New file detection ────────────────────────────────────────── */
console.log('\n── Scanning for unregistered data files ──────────────────');

const registeredFiles = new Set(
  SOURCES
    .filter(function (s) { return s.localFile; })
    .map(function (s) { return path.resolve(ROOT, s.localFile); })
);

const DATA_DIRS = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'assets', 'data'),
].filter(function (d) { return fs.existsSync(d); });

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /archive\//,
  /private\//,
  /manifest\.json$/,   // auto-generated
  /insights-meta\.json$/,
  /policy_briefs\.json$/,
];

function shouldIgnore(filePath) {
  return IGNORE_PATTERNS.some(function (p) { return p.test(filePath); });
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(function (entry) {
    const fullPath = path.join(dir, entry.name);
    if (shouldIgnore(fullPath)) return;
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (/\.(json|geojson|csv)$/i.test(entry.name)) {
      const abs = path.resolve(fullPath);
      if (!registeredFiles.has(abs)) {
        const rel = path.relative(ROOT, abs);
        try {
          const stat = fs.statSync(abs);
          const ageDays = Math.floor((now - stat.mtimeMs) / MS_PER_DAY);
          console.log('NEW_FILE: ' + rel + '\t(size: ' + Math.round(stat.size / 1024) + 'KB, modified: ' + ageDays + 'd ago)');
        } catch (_) {
          console.log('NEW_FILE: ' + rel);
        }
      }
    }
  });
}

DATA_DIRS.forEach(scanDir);

/* ── Final exit code ───────────────────────────────────────────── */
console.log('\n── Monitor complete at ' + new Date().toISOString() + ' ──');

// Exit non-zero if there are stale sources (triggers workflow alert)
process.exit(staleCount > 0 ? 1 : 0);
