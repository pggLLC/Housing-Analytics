#!/usr/bin/env node
/**
 * acs-vintage-label-integrity — an ACS vintage label must be a real ACS range,
 * and must match the file it describes.
 *
 * This site legitimately runs two ACS vintages at once: the jurisdiction
 * digests and CHAS surfaces are on the 2020-2024 5-year release, while
 * data/market/acs_tract_metrics_co.json (vintage "2023") and
 * data/co-demographics.json (2019-2023) are on the prior one. That is fine --
 * a reader is told which, per chart. What is not fine is a label that names a
 * release nobody publishes.
 *
 * market-intelligence.html carried "ACS 2019-2024" against data whose own
 * source field says 2019-2023: not an ACS 5-year range at all, and it
 * overstated the data by a full release. Nothing caught it, because the
 * existing vintage gate checks specific known-stale strings rather than
 * whether a label is well formed.
 *
 * Two checks, both cheap:
 *   1. every ACS <start>-<end> label anywhere is a real 5-year span (end = start + 4)
 *   2. market-intelligence.html agrees with data/co-demographics.json's own
 *      declared source, since that file is its only data source
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\nACS vintage label integrity');

// ---- 1. every ACS year range must be a real 5-year span -------------------
const RANGE = /ACS[^<>"]{0,10}?(\d{4})\s*[–—-]\s*(\d{4})/g;
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'vendor') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (['js', 'css'].includes(e.name) || dir !== ROOT) walk(full); }
    else if (/\.(html|js|mjs)$/.test(e.name)) files.push(full);
  }
};
walk(ROOT);

let checked = 0;
const seen = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  RANGE.lastIndex = 0;
  while ((m = RANGE.exec(src)) !== null) {
    const [label, a, b] = [m[0], Number(m[1]), Number(m[2])];
    checked++;
    const rel = path.relative(ROOT, f);
    if (b - a !== 4) {
      fail(`${rel}: "${label.trim()}" is not an ACS 5-year range (${a}-${b} spans ${b - a + 1} years)`);
    } else {
      seen.set(`${a}-${b}`, (seen.get(`${a}-${b}`) || 0) + 1);
    }
  }
}
if (!failures) ok(`${checked} ACS year-range label(s) are well-formed 5-year spans`);
console.log(`    vintages in use: ${[...seen.entries()].map(([k, n]) => `${k} (${n})`).join(', ')}`);

// ---- 2. Market Intelligence must not overstate its own data ---------------
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co-demographics.json'), 'utf8'));
const declared = (String(demo.source || '').match(/(\d{4})\s*[–—-]\s*(\d{4})/) || []).slice(1);
if (declared.length !== 2) {
  fail('data/co-demographics.json no longer declares an ACS year range in `source`');
} else {
  const want = `${declared[0]}–${declared[1]}`;
  const mi = fs.readFileSync(path.join(ROOT, 'market-intelligence.html'), 'utf8');
  const labels = [...mi.matchAll(/ACS[^<>"]{0,10}?(\d{4})\s*[–—-]\s*(\d{4})/g)].map((m) => `${m[1]}–${m[2]}`);
  if (!labels.length) fail('market-intelligence.html states no ACS vintage at all');
  const wrong = labels.filter((l) => l !== want);
  if (wrong.length) {
    fail(`market-intelligence.html claims ACS ${[...new Set(wrong)].join(', ')} but its only data source `
       + `(data/co-demographics.json) declares ${want}`);
  } else {
    ok(`market-intelligence.html ACS ${want} matches data/co-demographics.json (${labels.length} label(s))`);
  }
}

if (failures) { console.error(`\nacs-vintage-label-integrity: FAIL (${failures})`); process.exit(1); }
console.log('acs-vintage-label-integrity: PASS');
