# Data Source Decisions

This doc captures decisions about which external data sources to pull
into the dashboard and which to skip — including the reasoning. The
goal: future-proof against repeating exploratory work and document why
not-yet-incorporated sources were considered.

Maintained by: anyone proposing a new data source. Add an entry whether
the decision was "yes ship it" or "decided not to."

---

## DOLA ACS spreadsheets — `demography.dola.colorado.gov/assets/html/acs_spreadsheets.html`

**Status:** ❌ **Decided not to pull**

**Considered:** 2026-05-08 (post-CHAS-Table-7 audit)

**What it offers:**
DOLA State Demography Office tabulates Census ACS data into Excel
spreadsheets organized by state/county/place/CCD/sub-county geographies.
The page hosts dozens of curated Excel files updated annually after
each ACS 5-year release.

**Why we considered it:**
The 2026-05-08 audit found that 31 of 513 Colorado places get suppressed
in our direct ACS API pull (places too small for reliable 5-year
estimates). DOLA's tabulations were proposed as a way to fill that gap.

**Why we decided NOT to pull:**

1. **DOLA's tabulations are NOT independent of Census ACS.** They
   re-format the same source data the Census ACS API publishes; they
   don't bypass Census's small-population suppression. A place that's
   suppressed in the API is also suppressed (or shown as ranges) in
   DOLA's spreadsheets.

2. **Excel scraping is fragile.** DOLA reorganizes the spreadsheets
   periodically; sheet names, header rows, and column layouts shift
   between releases. Maintaining a parser for ~20 Excel files vs. one
   API integration is a high-cost, high-fragility commitment.

3. **The 31 suppressed places are too small to materially affect rankings.**
   Each has population < 1,000 and contributes < 0.1% to any aggregate.
   The dashboard's primary use cases (LIHTC underwriting, market
   analysis) don't rely on these places.

4. **The county-scaled fallback in `build_ranking_index.py` is honest
   for these cases.** The disclosure banner ("data inherited from
   containing county") is the correct UX response.

**If we revisit later:** look for a true microdata source like Census
PUMS (Public Use Microdata Sample) which provides individual-level
records and can be re-tabulated by household size for HUD-style AMI
calculations. PUMS is the canonical source for the place-level
cost-burden problem PR #769 attempted via tract aggregation.

**Reference:** `docs/CONTRIBUTING.md` for the data-source addition
checklist, if this decision is later reversed.

---

## data.colorado.gov broader catalog — Colorado Information Marketplace

**Status:** ❌ **Decided not to pull (broad catalog); already pull what's valuable**

**Considered:** 2026-05-08

**What's already pulled:**
- `data/market/childcare_co.geojson` (CDHS Licensed Child Care Facilities,
  resource ID `a9rr-k8mu`) — actively used by `js/...` for amenity proxies

**Why we considered broader pulls:**
The original audit floated "eviction filings, HMDA mortgage data" as
potential additions for LIHTC underwriting context.

**Why we decided NOT to pull broader catalog:**

1. **No CO-state eviction dataset exists on data.colorado.gov.** A
   search for "eviction" on the Socrata catalog returns only out-of-
   state matches (Maryland, Connecticut, Los Angeles). Colorado
   judicial branch eviction data is held by individual courts, not
   aggregated on the state open-data portal. Tracking eviction at the
   CO level would require pulling from each county's PACER docket — a
   different pipeline entirely.

2. **HMDA is a federal dataset.** Mortgage application data is published
   by the CFPB at `ffiec.cfpb.gov/data-publication/snapshot-national-loan-level-dataset`.
   It's already accessible via Census Bureau APIs we use; would be
   pulled via `scripts/...` rather than data.colorado.gov.

3. **The CO portal's catalog is dominated by demographics and CPW data
   we already have.** A catalog scan (2026-05-08) shows ~200 datasets
   across categories: most are Colorado Parks & Wildlife (game-management
   units, hunting boundaries) or demographics (re-tabulations of Census
   data we pull directly). High-value LIHTC-relevant datasets specific
   to data.colorado.gov: not found.

**If we revisit later:** specific high-value targets to add via the
existing Socrata pattern in `scripts/market/fetch_childcare.py`:
- Licensed Assisted Living Facilities (subset of senior-housing market)
- Recovery Housing & Sober Living Facilities (special-needs market)
- DOC Halfway Houses & Community Corrections (re-entry housing demand)

These are actionable additions when there's a use case. Not in scope
for the current dashboard.

---

## tax.colorado.gov GIS-API — Sales-tax-rate boundaries

**Status:** ⏸ **Deferred — low priority**

**Considered:** 2026-05-08

**What it offers:**
Colorado Department of Revenue publishes a GIS API for sales-tax-rate
boundaries (special districts, RTA zones, urban-renewal authorities).
Useful for site-selection scoring: development cost varies meaningfully
by special district.

**Why deferred:**
- The PMA scoring system already incorporates the dominant cost factors
  (FMR, ACS land value via Bridge data, basis-boost flags via
  QCT/DDA). Sales-tax variance is a second-order signal.
- No current consumer in `js/market-analysis/` uses or asks for this
  data.
- Would require a small but non-trivial addition: lookup at site
  point → enclosing district → tax rate.

**If we revisit later:** add a fetch script following the pattern in
`scripts/market/fetch_*` and a layer reader in
`js/market-analysis/pma-*.js`. The Socrata API pattern from
`fetch_childcare.py` applies directly.

---

## CDPHE Colorado Health Statistics Regions

**Status:** ⏸ **Deferred — useful adjacent data, low immediate ROI**

**Considered:** 2026-05-08

**What it offers:**
CDPHE divides Colorado into 21 Health Statistics Regions for public
health reporting. Layer is available on the same CDPHE Open Data Portal
that the County Boundaries dataset (PR #774) comes from. Useful for
healthcare-access proxies in PMA scoring, especially for rural CO.

**Why deferred:**
- PR #774 (CDPHE county boundaries) was scoped to county-level only
  to keep the diff small.
- Health regions are aggregations of multiple counties, less useful
  for site-level (sub-county) scoring.

**If we revisit later:** same fetch pattern as PR #774; add to
`scripts/market/fetch_cdphe_county_boundaries.py` or a sibling script
fetching the regions dataset.

---

## dlg.colorado.gov news articles — Local Government Resources

**Status:** ❌ **Not a data feed**

**Considered:** 2026-05-08

**Why not pulled:**
The DLG (Department of Local Government) news section is
human-authored policy updates, not structured data. Already linked
from `housing-needs-assessment.html` for users who want to read the
methodology guidance. Pulling article text would not surface useful
quantitative signal in the dashboard.

**If we revisit later:** an RSS subscription to DLG news could surface
methodology updates as alerts in `dashboard-data-quality.html`. Low
priority.

---

## What's actively pulled today (post-2026-05-08)

For reference, the inventory of external data sources currently
incorporated:

| Source | File | Purpose |
|---|---|---|
| Census ACS 5-year (B19001, B25003, B25063, B25074, DP04, DP05) | `data/hna/summary/*.json`, `data/co_ami_gap_by_place.json`, etc. | Income distribution, tenure, gross rent, housing profile |
| HUD CHAS | `data/hna/chas_affordability_gap.json` | Cost-burden by AMI tier (county-level) |
| HUD FMR | `data/hud-fmr-income-limits.json` | Fair market rents + income limits |
| HUD QCT/DDA | `data/qct-colorado.json`, `data/dda-colorado.json` | Basis-boost-eligible areas |
| HUD LIHTC database | `data/market/hud_lihtc_co.geojson` | Existing LIHTC properties |
| NHPD | `data/market/nhpd_co.geojson` | National Housing Preservation Database |
| FRED | `data/fred-data.json` | Economic indicators |
| BLS LAUS | `data/co-county-economic-indicators.json` | County employment |
| LEHD LODES | `data/hna/lehd/*.json` | Workforce commuting |
| DOLA SDO | `data/hna/dola_sya/*.json` | Population projections |
| CHFA | `data/chfa-lihtc.json` | CO LIHTC allocations |
| CO Demographics | `data/co-county-demographics.json` | County-level ACS rollup |
| CDHS Childcare Facilities (data.colorado.gov) | `data/market/childcare_co.geojson` | Childcare amenity layer |
| CDPHE Trauma Centers | (within `data/market/hospitals_co.geojson`) | Healthcare amenity layer |
| CDPHE County Boundaries | `data/market/cdphe_county_boundaries_co.geojson` | Independent boundary source for cross-validation |
| TIGER (Census Bureau boundaries) | `data/co-county-boundaries.json`, `data/boundaries/counties_co.geojson`, `data/market/tract_boundaries_co.geojson` | Primary boundary source |
| OpenStreetMap (via Overpass) | `data/amenities/*.geojson` | Grocery, healthcare, parks, retail nodes, schools, transit stops |
| Zillow ZHVI/ZORI | `data/zillow*.json` | Home value + rent indices |
| Bridge | (real-time API; no committed file) | Land cost / market velocity |

This catalog is the operative answer to "what data does the dashboard
incorporate?" The decisions above explain the gaps that exist on
purpose.
