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
 * A new area key with misses passes only as a rename: it must pair with an
 * area that left the baseline carrying at least as many misses (a same-kind
 * box inserted ahead of an id-less one renumbers it). Fixing misses in an
 * area that stays does not pay for a new unsourced card.
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
  const hAreas = h.areas || {};
  for (const [area, n] of Object.entries(hAreas)) {
    if (area in bAreas && n > bAreas[area]) raised.push(`${page}: ${area} ${bAreas[area]} -> ${n}`);
  }
  // Pair each new key with a departed one that held at least as many misses,
  // largest first; whatever is left over is new, unsourced content.
  const gone = Object.entries(bAreas).filter(([k]) => !(k in hAreas)).map(([, n]) => n).sort((x, y) => y - x);
  const fresh = Object.entries(hAreas).filter(([k, n]) => !(k in bAreas) && n > 0).sort((x, y) => y[1] - x[1]);
  for (const [area, n] of fresh) {
    const i = gone.findIndex((g) => g >= n);
    if (i === -1) raised.push(`${page}: new area ${area} with ${n}`);
    else gone.splice(i, 1);
  }
}

if (raised.length) {
  console.error(`source-lines-baseline-guard: FAIL - the baseline went up:\n  ${raised.join('\n  ')}`);
  console.error('Source the new figures instead of raising the baseline; --update is only for lowering it.');
  process.exit(1);
}
console.log('source-lines-baseline-guard: PASS (baseline did not go up)');
