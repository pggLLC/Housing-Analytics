# `scripts/discover_agenda_urls.mjs`

## Symbols

### `slugify(name)`

discover_agenda_urls.mjs  (F169a, 2026-06-04)

Probes likely council-agenda URL patterns (Civic Plus / Granicus /
custom) for every curated jurisdiction in data/hna/local-resources.json
that still lacks a `council_agenda_url`. For each candidate URL it
issues a HEAD request (with GET fallback), follows redirects, and
accepts 200 / 301 / 302 as a "match".

Output:
  - data/agenda-url-discovery-report.json   (machine-readable)
  - Markdown summary table written to stdout / step summary

Companion to:
  - scripts/discover-local-resources.mjs   (probes top-level city sites)
  - .github/workflows/discover-agenda-urls.yml

The OUTPUT is candidate URLs for human review — never auto-merged into
local-resources.json. Maintainer reviews + PRs.

CLI:
  node scripts/discover_agenda_urls.mjs           # write report
  node scripts/discover_agenda_urls.mjs --dry     # don't write report file
  node scripts/discover_agenda_urls.mjs --limit 20

Exit codes:
  0 — completed (regardless of how many matches found)
  2 — script-level failure
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_RESOURCES = path.join(ROOT, 'data', 'hna', 'local-resources.json');
const CENTROIDS = path.join(ROOT, 'data', 'co-place-centroids.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'agenda-url-discovery-report.json');
const NOW = new Date().toISOString();

const TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;          // Be polite to .gov sites
const USER_AGENT =
  'CohoAgendaDiscoveryBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  if (i < 0) return Infinity;
  const n = parseInt(args[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

/* ── Slug helpers ───────────────────────────────────────────────────
