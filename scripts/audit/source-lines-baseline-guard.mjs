/**
 * source-lines-baseline-guard.mjs
 * The source-lines baseline may only go down. `source-lines-ratchet.mjs
 * --update` writes whatever the page shows today, so without this check a PR
 * could add unsourced figures, run --update, and pass.
 *
 * Compares scripts/audit/source-lines-baseline.json with the base branch's
 * copy (passed as a path; Site Audit writes it from `git show`) and fails when:
 *   - a page's unsourced or undated total went up,
 *   - a page enters the baseline with any misses,
 *   - an area that exists in both went up.
 * An area key that is new while its page's totals did not rise is a renamed
 * area (a same-kind box inserted ahead of it), and is allowed.
 *
 * Usage: node scripts/audit/source-lines-baseline-guard.mjs <base-baseline.json>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEAD = path.join(__dirname, 'source-lines-baseline.json');

const basePath = process.argv[2];
if (!basePath || !fs.existsSync(basePath) || !fs.statSync(basePath).size) {
  console.log('source-lines-baseline-guard: no baseline on the base branch yet; nothing to compare');
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(basePath, 'utf8')).pages || {};
const head = JSON.parse(fs.readFileSync(HEAD, 'utf8')).pages || {};

const raised = [];
for (const [page, h] of Object.entries(head)) {
  const b = base[page];
  if (!b) {
    if (h.unsourced || h.undated) raised.push(`${page}: new page enters with ${h.unsourced} unsourced, ${h.undated} undated`);
    continue;
  }
  if (h.unsourced > b.unsourced) raised.push(`${page}: unsourced ${b.unsourced} -> ${h.unsourced}`);
  if (h.undated > b.undated) raised.push(`${page}: undated ${b.undated} -> ${h.undated}`);
  const bAreas = b.areas || {};
  for (const [area, n] of Object.entries(h.areas || {})) {
    if (area in bAreas && n > bAreas[area]) raised.push(`${page}: ${area} ${bAreas[area]} -> ${n}`);
  }
}

if (raised.length) {
  console.error(`source-lines-baseline-guard: FAIL - the baseline went up:\n  ${raised.join('\n  ')}`);
  console.error('Source the new figures instead of raising the baseline; --update is only for lowering it.');
  process.exit(1);
}
console.log('source-lines-baseline-guard: PASS (baseline did not go up)');
