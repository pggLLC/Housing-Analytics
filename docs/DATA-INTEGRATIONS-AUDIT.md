# Data integrations audit — May 2026

**Purpose.** Survey of every paid / external / non-default data source the
site is wired for, with status, what it would unlock, and whether it's
worth pursuing.

**Audience.** Developer + funder deciding where to spend an integration
budget.

---

## Summary

| Source | Status | Cost | What it would unlock | Recommend |
|---|---|---|---|---|
| **Bridge MLS** (RESO) | **Stub only** — `available: false` | $$$ (Realtor membership) | Live comparable sales + active listings for PMA rent + acquisition cost validation | **Hold** unless deal team commits to paying |
| **Regrid parcel API** | **Failing** — county ArcGIS fallback hit 0/8 success | $ (Regrid base tier ~$95/mo, $750/yr enterprise for full state) | Per-parcel zoning / vacancy / lot-area data for site selection; unlocks "is this parcel multifamily-zoned?" lookups in PMA | **Pursue** — biggest analytics ROI on this list |
| **LEHD LODES** | Working (using LODES8 path) | Free | Already powering PMA commute scoring. Audit script flags it broken because it points at stale `/r2022/` path | **Fix audit URL** (O4) |
| **kalshi.com** prediction markets | 429 rate-limited in audit | Free + paid | Speculative — was an experimental sentiment overlay. Not blocking | **Drop** — remove from `url-health-sweep` allow-list |
| **lhauthority.org** | Timeout | Free | One of ~185 local housing authority links; cross-referenced from local-resources | **Drop or replace** with jurisdiction search (memory: F35 pattern) |
| **CHAS HUD data** | Working (2014-2018 vintage) | Free | Place + tract-level affordability gap, drives HNA AMI panel | **Refresh to 2019-2023** — blocked by HUD WAF per project memory |
| **CHFA LIHTC ArcGIS** | Working — 926 features, latest YR_PIS 2025 | Free | Already powering OF, HNA, Multifamily Lens | None |
| **HUD FMR / Income Limits** | Working — 64 CO counties | Free | Powering Deal Calc + capture-advantage column | None |
| **Census ACS** | Working — DP04 cached at CI build (F86) | Free with key | Multifamily Lens + HNA demographics | None |
| **FRED** | Working with daily refresh | Free with key | Economic Dashboard rates / CPI / employment | None |

---

## Detailed assessment

### 1. Bridge MLS (`BRIDGE_BROWSER_TOKEN`)

**Current state.** Stub-only fallback at `data/market/bridge_co_market_summary.json`:

```json
{
  "_note": "Bridge MLS data requires a paid API subscription (BRIDGE_BROWSER_TOKEN). Set APP_CONFIG.BRIDGE_BROWSER_TOKEN in js/config.js to enable live market data. This stub prevents 404 errors on page load.",
  "available": false,
  "markets": {}
}
```

The site has full integration code ready:
- `js/data-connectors/bridge-listings.js` — active listings + recent sales near a lat/lng
- `js/data-connectors/bridge-parcels.js` — parcel records
- `js/data-connectors/bridge-market-summary.js` — pre-aggregated stats by submarket
- `scripts/aggregate-bridge-co.py` — CI-side region aggregator

**Cost.** Bridge Data Output requires an active Realtor / MLS membership in a participating MLS, plus a separate Bridge subscription. For CO, that's IRES (northern), REcolorado (metro), or CARETS. Typical: $50-150/mo MLS dues + Bridge fee. Some MLSs offer free Bridge access to members.

**What it would unlock.**
- **Comparable rents** for PMA "rent achievability check" — currently using FMR + LIHTC limits only. Real comps would let users see "actual market rent for 2BR in this submarket = $1,850 vs LIHTC 60% AMI cap of $1,862 → 0.6% advantage, weak" instead of relying on county-level FMR averages.
- **Acquisition cost** for Deal Calc TDC validation — currently TDC is a freeform input. Real comps would show "median per-unit acquisition cost in this submarket = $185K" as a benchmark.
- **Inventory pressure** — live listing count + days-on-market for Market Analysis vacancy context.

**Recommendation.** **Hold unless a deal team commits to paying.** This is a "for one developer who pays" feature, not a public-good feature. The site stays defensible without it. If pursued, add a clear "Member-only data" badge so other users understand why their view is missing comps.

---

### 2. Regrid parcel API (`REGRID_API_KEY`)

**Current state.** Cache shows `counties_attempted: 8, counties_successful: 0, coverage_pct: 0.0`. The fallback path (`scripts/market/fetch_parcel_data.py`) tries to scrape county-assessor ArcGIS REST endpoints directly — every county uses a different vendor and most endpoints either have rate limits, broken CORS, or undocumented field names. The fallback approach isn't viable; only Regrid will unlock parcel data at scale.

The integration code is built:
- `js/data-connectors/regrid-parcels.js` — radius query (`GET /api/v2/parcels/point`)
- `js/data-connectors/regrid-zoning.js` — zoning classification overlay
- Vacant + multifamily-compatible parcel classification helper

**Cost.** Regrid pricing (May 2026):
- **Free tier:** 1,000 parcel lookups/month — enough for development + small evaluation
- **Pro:** ~$95/mo — 50K lookups, statewide CO coverage
- **Enterprise:** ~$750/yr flat — unlimited + bulk download for CI prebuilds

**What it would unlock.**
- **Zoning suitability** — "is this parcel zoned for multifamily?" answer in PMA without requiring users to check 274 city zoning codes
- **Vacant / underutilized** flagging — identify infill candidates in resort + Western Slope markets where land scarcity is the binding constraint
- **Lot area** — real density calculations (units per acre by AMI band)
- **Owner** — surface public + nonprofit owners as preservation / disposition candidates

**Recommendation.** **Pursue.** Of every item on this list, parcel data has the highest analytical leverage. Even the $95/mo Pro tier would meaningfully sharpen PMA + Site Selection. Suggested phasing:

1. **Phase 1 (free tier, week 1)** — Wire `REGRID_API_KEY` to localStorage via Data Quality Dashboard. Test against 50 sites to confirm classifier output is stable.
2. **Phase 2 (Pro tier, month 1-2)** — Run a CI script monthly that pre-aggregates Regrid by county into `data/market/parcel_aggregates_co.json` (replacing the failing fallback). All 64 CO counties.
3. **Phase 3 (live query)** — Add per-parcel PMA lookup at the centroid of any user-clicked site. Show zoning / vacancy / lot area in a Site Inputs panel.

---

### 3. LEHD LODES (`/data/lodes/`)

**Current state.** Production code uses `LODES_YEAR=2023` at `/data/lodes/LODES8/co/` — and that URL returns HTTP 200 today. **The integration is healthy.** The audit script (`scripts/audit/url-health-sweep.mjs`) is checking a stale `/data/co/r2022/` path that was abandoned years ago. False positive in the URL health monitor.

**Recommendation.** Fix the audit URL only — addressed in O4.

---

### 4. kalshi.com prediction markets

Experimental sentiment overlay from earlier. Returns HTTP 429 (rate-limited). Not used in production scoring. Audit flags it because it's still in `url-health-sweep` config.

**Recommendation.** Drop from the URL health monitor. If kept, mark as `expected-rate-limit` so it doesn't surface in the broken-link report.

---

### 5. lhauthority.org

Lake County Housing Authority. One of ~185 local-resources links healed in F35 to durable jurisdiction searches. This specific link is timing out (server down or DNS gone).

**Recommendation.** Replace with a jurisdiction search per the F35 pattern (memory: `local-resources links are direct + searches by design`). Search query: `"Lake County Housing Authority" Colorado site:colorado.gov OR site:.org`.

---

### 6. CHAS 2019-2023 vintage refresh

**Per project memory:** "HUD WAF blocks unauthenticated CHAS download". Current data is the 2014-2018 5-year vintage, which is increasingly stale for the 2024-25 affordability discussion.

**Recommendation.** Try one of these unblockers:
- **HUD UDS API** — the Uniform Data System sometimes serves CHAS as a side-effect; needs investigation
- **UC Berkeley / IPUMS mirror** — academic mirrors often re-host HUD tables
- **Direct contact with HUD CHAS team** — for a research/public-good use case, they sometimes provide an unauthenticated link

Until then, the current 2014-2018 data is clearly labeled in the HNA "CHAS vintage" callout (post-F32).

---

### 7. CO county zoning ordinances

**Not yet integrated.** Each CO city + county has its own zoning code. Currently we link to local-resources for users to look up themselves.

**Recommendation.** **Don't build.** This is a $50K+ data-engineering project (each ordinance is text + tables in a different format) with marginal ROI vs the Regrid zoning classification. Defer indefinitely.

---

### 8. Building permits

Currently using `data/co-housing-costs/permits_county.parquet` from BLS QCEW + Census BPS, refreshed monthly. Healthy.

---

## Recommended next steps (in priority order)

1. **Regrid Pro tier subscription** ($95/mo, ~$1,140/yr). Biggest analytics unlock. Path forward: Phase 1 (free) → Phase 2 (Pro). Wire to `data/market/parcel_aggregates_co.json` via monthly CI.

2. **Fix LEHD audit URL** + **drop kalshi from URL health monitor** + **replace lhauthority.org with jurisdiction search**. (O4 task — small, no recurring cost.)

3. **CHAS 2019-2023 refresh investigation**. Try UDS API + IPUMS mirror. If neither works in a week, accept staleness + extend the "CHAS vintage" callout to be more prominent.

4. **Bridge MLS — hold**. Re-evaluate when a deal team is willing to pay.

5. **CHFA preservation database expansion**. Phase 5 ingested 343 HUD MF + 116 USDA RD + 1,688 CHFA preservation candidates. Next gap: NHPD (National Housing Preservation Database) for compliance status across all federal programs — would let us age-out properties closer to refinancing windows.
   - **2026-05 update:** NHPD now requires user registration + email approval before any database download (the previous public CSV path 404s). Not a viable free integration anymore; either contact NHPD for research access or skip in favor of the per-source files (HUD MF + USDA RD) we already ingest.

6. **Census API key in production** (`CENSUS_API_KEY`). Currently every CI run uses the GitHub Actions secret. Add the same key to a deploy-time inject so the Multifamily Lens "Refresh ↻ Live" button works in production (currently only works locally if user has stored a key).

---

## Files / paths referenced

| Path | Role |
|---|---|
| `js/data-connectors/bridge-listings.js` | Bridge MLS Web API client |
| `js/data-connectors/bridge-parcels.js` | Bridge parcel records |
| `js/data-connectors/regrid-parcels.js` | Regrid v2 parcel query |
| `js/data-connectors/regrid-zoning.js` | Regrid zoning classification |
| `data/market/bridge_co_market_summary.json` | Stub for Bridge (`available: false`) |
| `data/market/parcel_aggregates_co.json` | Stub for Regrid (`counties_successful: 0`) |
| `scripts/aggregate-bridge-co.py` | CI Bridge aggregator |
| `scripts/market/fetch_parcel_data.py` | Failing county-ArcGIS fallback |
| `js/config.js` (lines 11-13, 23-25) | Env keys |
| `scripts/audit/url-health-sweep.mjs` | Audit script (false positives noted above) |
