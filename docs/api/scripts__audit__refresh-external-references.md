# `scripts/audit/refresh-external-references.mjs`

## Symbols

### `fetchUpstream(url)`

scripts/audit/refresh-external-references.mjs

Refresh the external reference docs mirrored in docs/_external-references/.
Two responsibilities:

  1. **Fetch from upstream directly** with a browser-grade User-Agent so
     we don't depend on Wayback Machine. Several federal data publishers
     (HUD's CDN especially) gate downloads behind a WAF challenge for
     bot User-Agents but accept browser ones. The 2026-05-08 audit found
     the HUD CHAS data dictionary was effectively only fetchable via
     Wayback because the original urllib-based fetch returned HTTP 202
     with empty body. With `Mozilla/5.0 (...) Chrome/...` HUD ships the
     file directly.

  2. **Integrity check** — for each tracked reference, compute SHA-256
     of the upstream copy and compare against the pinned hash in
     `provenance.json`. When upstream ships a corrected version (rare
     but happens), this detects drift within 24 hours of the next cron run.

Behavior modes
--------------
  --check       (default)  fetch upstream, compare SHA-256 to pinned, exit 1 on drift
  --refresh                fetch upstream, replace local copy + provenance.json
  --pin                    fetch upstream, write provenance.json (initial setup)

Output: `docs/_external-references/<file>.provenance.json` per tracked file:
  {
    "source_url":   "...",
    "retrieved_at": "ISO timestamp",
    "sha256":       "...",
    "size_bytes":   N,
    "fetch_method": "https + browser User-Agent",
    "notes":        "..."
  }

Exit codes
----------
  0 — all checks pass (or refresh succeeded)
  1 — at least one reference drifted from pinned hash
  2 — internal error (network, file write)

Usage
-----
  node scripts/audit/refresh-external-references.mjs --check
  node scripts/audit/refresh-external-references.mjs --refresh
  node scripts/audit/refresh-external-references.mjs --pin
/

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const REFS_DIR = path.join(ROOT, 'docs', '_external-references');

// Browser-grade User-Agent that HUD's WAF accepts. Updated when major
// browsers bump versions; the WAF check is permissive on the browser
// detection so this doesn't need to track Chrome's release cadence.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// Tracked external references. Add a row when mirroring a new doc.
const TRACKED = [
  {
    name:        'HUD-CHAS-data-dictionary-2018-2022.xlsx',
    source_url:  'https://www.huduser.gov/portal/datasets/cp/CHAS-data-dictionary-18-22.xlsx',
    notes:       'HUD CHAS Table column → semantic mapping for 2018-2022 vintage. ' +
                 'Required reference for scripts/fetch_chas.py to interpret which ' +
                 'T7_estN column corresponds to which HAMFI tier × cost-burden cell. ' +
                 'HUD CDN gates direct downloads behind a WAF challenge for bot ' +
                 'User-Agents (returns HTTP 202 + empty body); using a browser UA ' +
                 'bypasses the gate cleanly.',
  },
  // Add more here as new pipelines mirror their reference docs.
];

const MODE_CHECK = '--check';
const MODE_REFRESH = '--refresh';
const MODE_PIN = '--pin';
const args = process.argv.slice(2);
const mode = args.find(a => [MODE_CHECK, MODE_REFRESH, MODE_PIN].includes(a)) || MODE_CHECK;

function log(...m) { console.log(...m); }
function err(...m) { console.error(...m); }


/**
Fetch a URL with a browser User-Agent. Returns { status, bytes, sha256 }.
Throws on non-2xx response.
