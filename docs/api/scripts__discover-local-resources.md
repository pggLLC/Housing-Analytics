# `scripts/discover-local-resources.mjs`

## Symbols

### `slugify(name)`

discover-local-resources.mjs  (F15b, 2026-05-27)

Active-discovery half of the freshness loop. Companion to:
  - scripts/audit/url-health-sweep.mjs (URL monitoring)
  - js/components/report-stale-link.js (user reporting)

For each Colorado incorporated place that has NOT yet been added to
data/hna/local-resources.json, this script:

  1. Ranks the place by HHs ≤100% AMI (proxy for renter scale).
  2. Generates standard city-website URL patterns from the place name.
  3. Probes each candidate URL (HEAD with GET fallback).
  4. For URLs that respond 200, fetches the home page and extracts
     the <title> + scans for housing-related keywords.
  5. Probes sub-paths likely to contain housing-plan, housing-
     authority, IZ ordinance, comp plan, etc.
  6. Writes data/hna/local-resources-candidates.json with the result.

The OUTPUT is candidate URLs for human review — never auto-merged
into local-resources.json. Maintainer reviews + PRs.

Why heuristic: we don't have a registry of "every CO city's official
.gov domain". Some are city-of-{name}.com, some are {name}.gov, some
use weird subdomains. This script just tries the common patterns and
surfaces what actually exists.

CLI:
  node scripts/discover-local-resources.mjs              # discover top 30 places
  node scripts/discover-local-resources.mjs --limit 50   # discover top 50
  node scripts/discover-local-resources.mjs --dry-run    # don't write output file

Exit codes:
  0 — completed (regardless of how many candidates found)
  2 — script-level failure
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'hna', 'local-resources-candidates.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;       // Be polite — these are .gov sites
const LIMIT_DEFAULT = 30;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) || LIMIT_DEFAULT : LIMIT_DEFAULT;
})();

/* ── Place name → URL-slug heuristic ────────────────────────────────
