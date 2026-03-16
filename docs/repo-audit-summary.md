# Repository Audit Summary

**Date:** 2026-03-15  
**Branch:** `copilot/archive-aligned-cleanup-docs-pipeline`  
**Scope:** Archive-aligned cleanup, documentation, pipeline activation, and validation improvements

---

## Dead Code Findings

### ES Module Chain (js/app.js → js/data.js → js/metrics.js)

- `js/app.js` — 101-line ES module with `import` syntax. Has a syntax error on line 37
  (unclosed template literal). References DOM elements that do not exist on any active HTML page.
  No HTML file loads it.
- `js/data.js` — 9-line ES module. Calls `DataService.baseMaps("us-states.geojson")` —
  that file does not exist (repo uses `data/states-10m.json` TopoJSON). No HTML file loads it.
- `js/metrics.js` — 12-line ES module. Only imported by `js/app.js`. Uses `d3.sum`.

**Conclusion:** All three files are completely orphaned. They cannot execute even if loaded.

### Orphaned Service/Dashboard Files

- `js/data-service.js` — Exposes `window.LIHTCDataService`. Was loaded by `colorado-market.html`
  but the inline script on that page does not call `LIHTCDataService` — it uses Chart.js directly.
  No other active page loads it.
- `js/dashboard.js` — Expects `window.LIHTCDataService`. Was never loaded by `dashboard.html`,
  which uses a 310-line inline script with `window.StateAllocations2026` instead.

### Superseded Navigation Files

- `js/responsive-nav.js` — IIFE-style mobile nav. No HTML file loads it.
  All pages load `js/mobile-menu.js` instead.
- `css/responsive-nav.css` — Navigation styles paired with responsive-nav.js.
  No HTML file loads it. Superseded by `css/mobile-nav.css`.

---

## Quarantine Actions (→ `_tobedeleted/`)

| Source | Destination | Reason |
|--------|-------------|--------|
| `js/app.js` | `_tobedeleted/js/app.js` | Dead ES module chain |
| `js/data.js` | `_tobedeleted/js/data.js` | Dead ES module chain |
| `js/metrics.js` | `_tobedeleted/js/metrics.js` | Dead ES module chain |
| `js/data-service.js` | `_tobedeleted/js/data-service.js` | Orphaned — no active page loads it |
| `js/dashboard.js` | `_tobedeleted/js/dashboard.js` | Orphaned — dashboard.html uses inline script |
| `js/responsive-nav.js` | `_tobedeleted/js/responsive-nav.js` | Superseded by mobile-menu.js |
| `css/responsive-nav.css` | `_tobedeleted/css/responsive-nav.css` | Superseded by mobile-nav.css |
| `.env` | `_tobedeleted/root/.env` | Committed with personal email address |
| `CHANGED_FILES.txt` | `_tobedeleted/root/CHANGED_FILES.txt` | Build artifact — redundant with implementation-status.md |
| `DEPLOYMENT-GUIDE.txt` | `_tobedeleted/root/DEPLOYMENT-GUIDE.txt` | Superseded by docs/DEPLOYMENT_GUIDE.md |
| `DATA-SOURCES.md` | `_tobedeleted/root/DATA-SOURCES.md` | Superseded by docs/data-sources-audit.md + docs/DATA_SOURCES_TABLE.md |

The `_tobedeleted/` folder is excluded by `.gitignore` and will not be deployed to GitHub Pages.

---

## Pipeline Activation Status

### Alerts Pipeline (`scripts/fetch_google_alerts.py`)

| Item | Status |
|------|--------|
| Script | ✅ Production-ready (232 lines, dedup/prune/tagging) |
| `scripts/alert_feeds.txt` | ✅ Created (commented placeholder template) |
| `data/alerts/alerts_archive.json` | ✅ Seed file created (empty, correct schema) |
| Real RSS feed URLs | ⚠️ Not yet configured — manual step required |

**Next step:** Add real Google Alerts RSS URLs to `scripts/alert_feeds.txt`, then run
`python3 scripts/fetch_google_alerts.py` or let the scheduled GitHub Actions workflow run.

### Policy Briefs Pipeline (`scripts/generate_policy_briefs.py`)

| Item | Status |
|------|--------|
| Script | ✅ Production-ready (dual-mode: rule-based + GPT-4o-mini) |
| `data/policy_briefs.json` | ✅ Seed file created (empty, correct schema) |
| Input data | ⚠️ Awaits alerts pipeline data |

**Next step:** After alerts are flowing, run `python3 scripts/generate_policy_briefs.py`.
Set `OPENAI_API_KEY` secret in GitHub for LLM-assisted summaries.

---

## Allocation Architecture Summary

The Year dropdown on `dashboard.html` and `state-allocation-map.html` uses:

- `js/state-allocations-2026.js` — Real current-year national data
- `js/state-allocations-2026-actual.js` — Real confirmed awards
- `js/state-allocations-2025.js` — **Alias stub** (copies 2026 data)
- `js/state-allocations-2024.js` — **Alias stub** (copies 2026 data)
- `js/state-allocations-historical.js` — Rendering/helper layer

Stubs exist because Novogradac's per-state allocation pages require a paid subscription
when fetched programmatically (HTTP 402). The stubs prevent dropdown breakage.
See `docs/LIHTC_HISTORICAL_METHODOLOGY.md` for the full architecture.

---

## Documentation Fixes Applied

| Document | Change |
|----------|--------|
| `docs/QUICK-REFERENCE.md` | Replaced `responsive-nav.js/css` references with `mobile-menu.js` |
| `docs/IMPLEMENTATION-GUIDE.md` | Updated Quick Start and File Summary sections |
| `docs/DEPLOYMENT_GUIDE.md` | Removed `responsive-nav.css` from directory tree |
| `docs/implementation-status.md` | Marked `responsive-nav.css` as archived |
| `docs/LIHTC_HISTORICAL_METHODOLOGY.md` | Added canonical data flow table and architecture section |
| `README.md` | Updated `data-service.js` reference to `data-service-portable.js` |
| `policy-briefs.html` | Improved empty-state messages |
| `colorado-elections.html` | Added link to housing-legislation-2026.html |

---

## Security Note: `.env` Committed with Personal Email

The file `.env` was committed to the repository containing:
```
RECIPIENT_EMAIL="communityplanner@gmail.com"
```

**Actions taken:**
1. Moved to `_tobedeleted/root/.env` (excluded from tracking by `.gitignore`)
2. `.gitignore` already covered `.env` before this was committed

**Recommendation:** The email address remains in git history. If considered sensitive,
use `git filter-repo` or BFG Repo Cleaner to purge the historical commit, or rotate
the email address. See: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository

---

## Validation Script Updates

| Script | Change |
|--------|--------|
| `scripts/deploy-preflight.js` | Removed `js/app.js` and `js/dashboard.js` from `JS_FILES` |
| `test/pages-availability-check.js` | Removed `js/app.js` and `js/dashboard.js` from `JS_FILES` |

---

## Remaining Manual QA Needed

1. **Deploy preview smoke tests** — Load key pages and verify no console errors
2. **Alerts pipeline** — Add real RSS feeds to `scripts/alert_feeds.txt`
3. **Policy briefs** — Run `generate_policy_briefs.py` after feeds are active
4. **Browser DevTools console check** on `dashboard.html`, `colorado-deep-dive.html`,
   `housing-needs-assessment.html`, `LIHTC-dashboard.html`
5. **Verify fix scripts** — Run fix scripts marked as "Keep" in `docs/fix-scripts-audit.md`
   to confirm their target data is correct
