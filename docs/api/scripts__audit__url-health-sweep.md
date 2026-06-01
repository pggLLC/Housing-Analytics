# `scripts/audit/url-health-sweep.mjs`

## Symbols

### `isHttpUrl(s)`

url-health-sweep.mjs  (F14, 2026-05-26)

Periodic URL health monitor. Distinct from `source-url-sweep.mjs` which
is a PR-time blocking check over changed files; this one runs on a cron,
sweeps ALL external URLs in the repo, and maintains a persistent
`data/url-health.json` cache used both for:

  1. Browser display — OF / Compare / HNA pages can show "verified
     YYYY-MM-DD" next to external resource links so users know the
     data is current.
  2. Weekly issue filing — diff vs. last sweep surfaces newly-broken
     URLs as a single GitHub issue for maintainer triage.

Scans:
  - data/hna/local-resources.json (every URL field)
  - data/policy/*.json
  - All root-level *.html (anchor hrefs)
  - docs/**\/*.md (markdown URL references)

Cache shape (data/url-health.json):
  {
    "lastSweepAt": "2026-05-26T...",
    "urlCount": 234,
    "byUrl": {
      "https://example.com/...": {
        "status": "ok" | "broken" | "auth" | "timeout" | "allow",
        "httpStatus": 200,
        "lastCheckedAt": "2026-05-26T...",
        "lastOkAt":       "2026-05-26T...",   // preserved if status !== ok
        "firstSeenAt":    "2026-05-26T...",   // preserved across sweeps
        "redirectTo":     "https://...",      // when applicable
        "consecutiveFailures": 0
      }
    }
  }

CLI:
  node scripts/audit/url-health-sweep.mjs                 # full sweep + write cache
  node scripts/audit/url-health-sweep.mjs --diff-only     # print newly-broken since last sweep
  node scripts/audit/url-health-sweep.mjs --dry-run       # probe + report, don't write cache

Exit codes:
  0 — sweep completed (regardless of how many URLs failed)
  2 — script-level failure (filesystem error, etc.)
/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_PATH = path.join(ROOT, 'data', 'url-health.json');

const TIMEOUT_MS = 10_000;
const CONCURRENT = 6;
const NOW = new Date().toISOString();

const DRY_RUN  = process.argv.includes('--dry-run');
const DIFF_ONLY = process.argv.includes('--diff-only');

// Re-use the allow-list from source-url-sweep — these are known-good URLs
// that block CI user-agents (DOL, BLS, CHFA QAP, etc.). Keep in sync.
const ALLOW_LIST = new Set([
  'https://overpass-api.de/api/interpreter',
  'https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations',
  'https://www.novoco.com/',
  'https://www.ncsha.org/',
  'https://www.congress.gov/',
  'https://www.cbre.com/insights',
  'https://www.ffiec.gov/craadweb/main.aspx',
  'https://www.dol.gov/agencies/whd/government-contracts/construction',
  'https://cdola.colorado.gov/commitment-filings',
  'https://cdola.colorado.gov/housing',
  'https://cdola.colorado.gov/prop123',
  'https://cdola.colorado.gov/prop-123',
  'https://cdola.colorado.gov/proposition-123',
  'https://cdola.colorado.gov/division-of-housing',
  'https://demography.dola.colorado.gov/population/population-totals-colorado-counties/',
  'https://demography.dola.colorado.gov/population/population-change-components/',
  // P5: removed 'https://trading-api.kalshi.com/trade-api/v2' — experimental
  // sentiment overlay not used in production scoring; the endpoint rate-limits
  // anonymous requests to 429 which polluted the broken-URL report.
  'https://www.chfainfo.com/multifamily/QAP',
  'https://www.chfainfo.com/multifamily/qap',
  'https://www.bls.gov/cew/',
  'https://www.bls.gov/ppi/',
  'https://www.bls.gov/ppi',
  'https://www.bls.gov/cps',
  'https://www.bls.gov/jlt',
  'https://www.bls.gov/lau/',
  'https://www.bls.gov/data/',
  'https://dlg.colorado.gov/',
  'https://lehd.ces.census.gov/data/lodes/LODES8/',
  'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf',
  'https://www.jchs.harvard.edu/',
  'https://www.fema.gov/flood-maps',
  'https://www.hud.gov/program_offices/comm_planning/environment_energy/nepa'
]);

/* ── URL collection ─────────────────────────────────────────────────

### `probeUrl(url)`

/*.md (markdown URL refs, link refs, and bare URLs)
  async function walkMd(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkMd(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const src = await fs.readFile(p, 'utf8');
        const rx = /https?:\/\/[^\s"'`<>)\]]+/g;
        let m;
        while ((m = rx.exec(src)) !== null) {
          urls.add(normalizeUrl(m[0]));
        }
      }
    }
  }
  await walkMd(path.join(ROOT, 'docs'));

  return [...urls].sort();
}

/* ── Probe ──────────────────────────────────────────────────────────
