# `scripts/audit/verify-opportunity-finder.mjs`

## Symbols

### `C`

verify-opportunity-finder.mjs — QA/QC harness for the LIHTC Opportunity Finder.

Codex handoff target. Run this to verify the programming behind the
jurisdiction-level rollup that powers `lihtc-opportunity-finder.html`
and `js/lihtc-opportunity-finder.js`. The script independently re-implements
the rollup math in Node so it can detect regressions in:

  1. Data file integrity (all 10 source files load + have expected shape)
  2. QCT tract count (HUD 2025 publication)
  3. DDA county FIPS count (HUD 2025 publication — CO has 10 nonmetro)
  4. LIHTC project geometry filtering (drop YR_PIS=8888 placeholders)
  5. Place-tract membership rollup (TIGER 2024)
  6. Place→county containment (every place has a 5-digit county FIPS)
  7. Score weight invariants (each target's weights sum to 1.0)
  8. Composite score range (every output in [0, 100])
  9. Civic-capacity data joins (policy scorecard + local-resources + prop123)
 10. Known-case spot checks (Sugar City, Cortez, Crowley, Montezuma)
 11. Default-filter result count (QCT+DDA, no CDPs, 9% target → 5 jurisdictions)

USAGE
  node scripts/audit/verify-opportunity-finder.mjs
  node scripts/audit/verify-opportunity-finder.mjs --verbose
  node scripts/audit/verify-opportunity-finder.mjs --json

EXIT CODES
  0  — every check passed
  1  — at least one check failed (regression)
  2  — internal script error (e.g. a configured file is missing)

RELATED
  - js/lihtc-opportunity-finder.js   — the production rollup module
  - lihtc-opportunity-finder.html    — the UI consumer
  - test/qa-recent-changes.js        — broader QA harness (smoke / urls / schema)
  - docs/audits/                     — methodology audit docs

Updated 2026-05-25. Bump expectations only after intentional data-vintage
advances (e.g. HUD's 2026 QCT list publishes — adjust QCT count expectation).
/

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const ARGV      = new Set(process.argv.slice(2));
const VERBOSE   = ARGV.has('--verbose');
const JSON_OUT  = ARGV.has('--json');

const CURRENT_YEAR = 2026;

/* ── Score weights — extracted from production source ─────────────── */
// Keep the verifier structurally tied to js/lihtc-opportunity-finder.js.
// The browser module is an IIFE, so this script extracts the literals rather
// than maintaining a second copy that can drift.
export const EXPECTED_SCORE_TARGETS = ['9pct', '4pct', 'preservation', 'workforce_resort', 'prop123_local', 'any'];
export const EXPECTED_SCORE_FACTORS = ['need', 'recency', 'basis', 'pop', 'civic'];

function _extractBalancedLiteral(source, name) {
  const assignment = new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm');
  const match = assignment.exec(source);
  if (!match) throw new Error('Cannot find ' + name + ' assignment in js/lihtc-opportunity-finder.js');
  let i = match.index + match[0].length;
  while (/\s/.test(source[i])) i++;
  if (source[i] !== '{') {
    const scalar = /^[^;]+/.exec(source.slice(i));
    if (!scalar) throw new Error('Cannot parse scalar assignment for ' + name);
    return scalar[0].trim();
  }
  let depth = 0;
  let quote = null;
  for (let j = i; j < source.length; j++) {
    const ch = source[j];
    const prev = source[j - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(i, j + 1);
    }
  }
  throw new Error('Unbalanced object literal for ' + name);
}

function _evalLiteral(literal, name) {
  try {
    return vm.runInNewContext('(' + literal + ')', Object.create(null), { timeout: 1000 });
  } catch (err) {
    throw new Error('Cannot evaluate ' + name + ' literal: ' + err.message);
  }
}

export function extractOpportunityFinderConfig(source) {
  const weights = _evalLiteral(_extractBalancedLiteral(source, 'SCORE_WEIGHTS'), 'SCORE_WEIGHTS');
  const penalty = Number(_extractBalancedLiteral(source, 'CDP_PENALTY'));
  const penaltyTargetsObject = _evalLiteral(_extractBalancedLiteral(source, 'CDP_PENALTY_TARGETS'), 'CDP_PENALTY_TARGETS');
  const penaltyTargets = Object.keys(penaltyTargetsObject).filter((key) => penaltyTargetsObject[key]);

  if (!Number.isFinite(penalty)) throw new Error('CDP_PENALTY is not finite');
  for (const target of EXPECTED_SCORE_TARGETS) {
    if (!weights[target]) throw new Error('SCORE_WEIGHTS missing target ' + target);
    for (const factor of EXPECTED_SCORE_FACTORS) {
      if (!Number.isFinite(weights[target][factor])) {
        throw new Error('SCORE_WEIGHTS.' + target + '.' + factor + ' is not finite');
      }
    }
  }
  return {
    scoreWeights: JSON.parse(JSON.stringify(weights)),
    cdpPenalty: penalty,
    cdpPenaltyTargets: penaltyTargets,
  };
}

export function loadOpportunityFinderConfig(rootDir = ROOT) {
  const source = readFileSync(path.join(rootDir, 'js/lihtc-opportunity-finder.js'), 'utf8');
  return extractOpportunityFinderConfig(source);
}

const OPPORTUNITY_FINDER_CONFIG = loadOpportunityFinderConfig();
const SCORE_WEIGHTS = OPPORTUNITY_FINDER_CONFIG.scoreWeights;
const CDP_PENALTY = OPPORTUNITY_FINDER_CONFIG.cdpPenalty;
const CDP_PENALTY_TARGETS = new Set(OPPORTUNITY_FINDER_CONFIG.cdpPenaltyTargets);

/* ── Pretty printing ────────────────────────────────────────────────
