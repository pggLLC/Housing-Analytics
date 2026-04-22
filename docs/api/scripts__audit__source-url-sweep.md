# `scripts/audit/source-url-sweep.mjs`

## Symbols

### `collectUrlsFromObject(obj, out = [])`

source-url-sweep.mjs — verify external source URLs cited across the site
are still reachable. Closes audit item #1 from the 2026-04-20 outstanding-
items review ("Broken source paths / 404 errors").

What it does:
  1. Collects external URLs from:
       - DATA-MANIFEST.json (data-pipeline endpoints)
       - js/citations.js     (industry-source registry)
       - *.html href= links  (user-facing citations in page copy)
  2. Dedupes + filters to http(s) URLs (skips mailto:, #anchors, relatives)
  3. Skips a known allow-list of URLs that fail HEAD but are known-good
     (e.g. Census Overpass API needs POST, not HEAD).
  4. HEAD-requests each with 10s timeout; if HEAD fails the server may
     just not allow it, so falls back to a small-range GET.
  5. Reports: OK, TIMEOUT, 404, 5xx, other-failure.

Exit code:
  0  — every URL resolved (including allow-listed)
  1  — at least one URL returned 404 or a hard failure
  2  — internal script error (bad inputs)

Usage:
  node scripts/audit/source-url-sweep.mjs
  node scripts/audit/source-url-sweep.mjs --quiet   (only print failures)
  node scripts/audit/source-url-sweep.mjs --json    (machine-readable)
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

const TIMEOUT_MS = 10_000;
const CONCURRENT = 8;

// URLs that are expected to fail HEAD/GET from a CI runner — either the
// server requires POST (APIs), blocks automated agents (403), or requires
// specific headers we won't reproduce. Listed here with a short
// justification so future failures get scrutinized.
const ALLOW_LIST = new Set([
  'https://overpass-api.de/api/interpreter', // POST-only API
  // The following return 403 to automated HEAD/GET but resolve fine in a
  // real browser. Checked manually 2026-04-20 — each is a legitimate
  // citation target and re-verified by hand.
  'https://www.novoco.com',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/qct-dda-mapping-tool',
  'https://www.ncsha.org',
  'https://www.ncsha.org/advocacy-issues/lihtc/',
  'https://www.congress.gov/',
  'https://www.congress.gov/bill/118th-congress/house-bill/6644',
  'https://www.cbre.com/insights',
  'https://www.cbre.com/insights/books/us-real-estate-market-outlook-2025/multifamily',
  'https://www.ffiec.gov/craadweb/main.aspx',
  'https://cdola.colorado.gov/commitment-filings',
  'https://cdola.colorado.gov/housing',
  'https://cdola.colorado.gov/prop123',
  'https://dlg.colorado.gov/news-article/final-housing-needs-assessment-methodology-and-displacement-risk-assessment-guidance',
]);

// Regex: skip patterns that clearly aren't source citations.
const SKIP_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /localhost/i,
  /^\/\//,                       // protocol-relative — resolve elsewhere
  /\$\{/,                        // unescaped JS template literal captured as URL
  /^https?:\/\/fonts\.googleapis\.com/i, // font CDN, not a citation target
  /^https?:\/\/fonts\.gstatic\.com/i,
  /^https?:\/\/cdn\.jsdelivr\.net/i,     // JS CDN, not a citation
  /^https?:\/\/unpkg\.com/i,
  /^https?:\/\/cdnjs\.cloudflare\.com/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet'),
    json:  args.includes('--json'),
  };
}

/** Walk an object and collect every string value that looks like an http(s) URL.

### `readCitations()`

Parse `js/citations.js` by regex (it's a plain object literal).

### `readHtmlUrls()`

Pull href= URLs from every HTML file at the repo root.
