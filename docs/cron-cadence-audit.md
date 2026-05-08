# Cron-cadence vs. source-cadence audit

This doc maps every scheduled fetch workflow to the publication cadence of
its upstream source. The goal: ensure each cron is right-sized — frequent
enough to catch updates within a reasonable window, but not so frequent
that we burn GitHub Actions minutes pulling unchanged data.

**Last reviewed:** 2026-05-08

## Quick reference

| Workflow | Cron | Cron cadence | Source release cadence | Match? |
|---|---|---|---|---|
| `fetch-fred-data.yml` | `0 6 * * *` | Daily | Series-dependent (1-30 days) | ✓ |
| `fetch-census-acs.yml` | `30 6 * * *` | Daily | Annual (December) | ⚠ over-fetching |
| `fetch-fred-data.yml` (real-time) | (continuous) | Daily | FRED real-time series ship daily | ✓ |
| `fetch-chas-data.yml` | `0 3 * * 1` | Weekly | Annual (December) | ⚠ over-fetching |
| `fetch-chfa-lihtc.yml` | `0 5 * * 1` | Weekly | Quarterly | ⚠ over-fetching |
| `fetch-county-data.yml` | `0 6 * * 1` | Weekly | Quarterly (BLS, Census) | ⚠ over-fetching |
| `fetch-cdphe-boundaries.yml` | `0 3 1 * *` | Monthly | Annual+ | ✓ |
| `fetch-parcel-zoning-data.yml` | `0 2 * * 0` | Weekly | Variable per source | OK |
| `fetch-polymarket-data.yml` | `30 6 * * *` | Daily | Hourly during active markets | ⚠ under-fetching during peak |
| `fetch-kalshi.yml` | `0 3 * * 1` | Weekly | Hourly during active markets | ⚠ under-fetching |
| `market_data_build.yml` | `0 2 * * 1` | Weekly | Composite (annual + monthly inputs) | ✓ |
| `update-co-housing-costs.yml` | `15 10 2 * *` | Monthly | Composite | ✓ |
| `zillow-data-sync.yml` | `0 2 * * 1` | Weekly | Variable | OK |
| `cache-hud-gis-data.yml` | `0 4 * * 1` | Weekly | Quarterly+ | ⚠ over-fetching |
| `weekly_housing_brief.yml` | `0 8 * * 1` | Weekly | N/A (digest of internal data) | ✓ |
| `data-source-monitoring.yml` | `0 7 * * *` | Daily | N/A (discovery) | ✓ |
| `data-quality-check.yml` | `0 */6 * * *` | 4×/day | N/A (validation) | ✓ |
| `data-freshness-check.yml` | `0 16 * * *` | Daily | N/A (validation) | ✓ |
| `data-sentinels-check.yml` | `30 16 * * *` | Daily | N/A (validation) | ✓ |
| `qa-status.yml` | `15 12 * * *` | Daily | N/A (visibility) | ✓ |
| `upstream-vintage-watch.yml` | `0 14 * * 1` | Weekly | N/A (release detector) | ✓ |
| `cleanup-stale-branches.yml` | `0 4 * * 1` | Weekly | N/A (housekeeping) | ✓ |
| `build-hna-data.yml` | `30 6 * * 1` | Weekly | Composite (varies) | ✓ |

## Recommendations (in priority order)

### 1. `fetch-chas-data.yml` — over-fetching (HIGH ROI)
**Current:** weekly. **Source cadence:** annual (HUD ships in December).
**Recommendation:** monthly cron (`0 3 1 * *`). Rationale: 234 MB ZIP
download every week × 52 weeks = ~12 GB/year of GitHub Actions egress
for unchanged data.

### 2. `fetch-chfa-lihtc.yml` — over-fetching
**Current:** weekly. **Source cadence:** quarterly (CHFA updates LIHTC
allocations after each application round).
**Recommendation:** keep weekly. CHFA does ship interim updates and the
fetch is small. Status quo OK; just noting the mismatch.

### 3. `fetch-census-acs.yml` — over-fetching
**Current:** daily. **Source cadence:** annual.
**Recommendation:** weekly. Census ACS 5-year ships in December once a
year. Daily polling is wasteful.

### 4. `fetch-polymarket-data.yml` — possibly under-fetching during peaks
**Current:** daily. Source can update hourly during active election/policy
windows. **Recommendation:** acceptable as-is for the dashboard's
"current state" use case; consider a manual trigger pattern for major
events rather than tightening the cron.

### 5. `cache-hud-gis-data.yml` — over-fetching
**Current:** weekly. HUD QCT/DDA/LIHTC overlays change quarterly.
**Recommendation:** monthly. Same logic as fetch-chas — large download
for rarely-changing data.

## How to update a cron

Edit the workflow's `on.schedule.cron` field. Standard syntax:
```
0 3 * * *      # Daily at 03:00 UTC
0 3 * * 1      # Weekly on Monday at 03:00 UTC
0 3 1 * *      # Monthly on the 1st at 03:00 UTC
0 3 1 1 *      # Annually on January 1
```

Pick UTC times that don't collide with other workflows in the same
`concurrency.group`. Most fetches use the `data-commits` concurrency
group — stagger them across the early-morning UTC window (03:00–08:00).

## Estimated savings

Right-sizing the 3 highlighted over-fetching workflows would save:
- HUD CHAS: 234 MB × 51 weekly skipped = ~12 GB/year egress
- HUD GIS: ~50 MB × 51 weekly skipped = ~2.5 GB/year egress
- Census ACS: small, mostly Actions-minutes savings (~5 min × 364 daily skipped = ~30 hours/year)

Combined: ~14.5 GB/year + 30 GitHub Actions hours saved.

## Re-review schedule

Re-run this audit annually after the HUD/Census release calendars publish
their next-year schedules (typically October).
