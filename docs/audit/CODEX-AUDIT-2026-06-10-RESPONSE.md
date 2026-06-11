# Codex Audit Response — 2026-06-10

This document accompanies the original `CODEX-AUDIT-2026-06-10.md` audit in
this directory. It records what was applied, what was deferred, and what
the next audit cycle should look at.

The work below was applied across feature batches F254–F259, all committed
to `main` between 2026-06-10 18:00 UTC and 2026-06-11 02:00 UTC.

## Status of the 14 audit findings

| Finding | Topic | Status |
|---------|-------|--------|
| 1 | Homepage "COHO" branding in title/meta/eyebrow | Applied (F254) |
| 2 | Second-person "you/your" + "deal cockpit" framing on homepage | Applied (F254) |
| 3 | "Awards points" wording on QAP scoring rubric | Applied (F254) |
| 4 | "Target/deal cockpit" copy in indibuild-pipeline-public | Applied (F254) |
| 5 | "We/our/us" voice in HNA narrative | Applied (F254) |
| 6 | Methodology doc voice — "we" → reference voice | Applied (F254) |
| 7 | Methodology + opportunity finder weight-table consistency | Applied (F254) |
| 8 | Footer "About COHO" menu item | Applied (F254) |
| 9 | Navigation header "COHO Analytics / Colorado Housing Intelligence" | Applied (F254) |
| 10 | Mobile drawer + footer "COHO" residue | Applied (F254) |
| 11 | **4% scoring weight rebalance** (pop 0.30→0.20, need 0.25→0.30, recency 0.12→0.17) | Applied (F258) — confirmed Rifle vs New Castle: both 71 composite, New Castle rank 10, Rifle rank 12 |
| 12 | CHFA rural filter copy + checkbox label | Applied (F254) — renamed "rural set-aside" to "non-metro county priority" + QAP Section 5.B.3.b citation |
| 13 | Rural classification: add Clear Creek, Elbert, Gilpin, Park, Teller as metro/non-eligible | Applied (F254) — `METRO_COUNTY_FIPS` expanded to 17 counties |
| 14 | LIHTC supply layer scoping — clarify what shows | Applied (F254) |

All 14 findings were addressed. Finding 11 was held for confirmation before
applying; once Rifle vs New Castle re-rank confirmed the desired ordering,
it shipped in F258.

## Additional product work completed 2026-06-10 (F255–F259)

### F255 — New Castle & Pro Forma fixes (user-reported batch)

- PMA + HNA Total Population alignment for New Castle
- Strong Signal pill contrast regression (fixed to 12:1 light / 8.7:1 dark)
- AHCIA insight rewrite — reflects July 4, 2025 reconciliation bill that
  enacted Permanent +12% Housing Credit allocation + Permanent 25%
  private-activity-bond threshold
- Housing 21st Century / ROAD Act status — current as of May 20, 2026
- Deal Calculator AMI percentage explanation
- LIHTC Pro Forma & Capital Stack budget breakdown surface

### F256 — PMA CHFA Market Study Guide alignment

- Added Appendix A disclosure: "Radius boundaries are not allowed. The
  market boundary must include entire census tracts."
- Buffer dropdown reworked with place-type labels (1mi urban infill,
  2mi small city, 3mi default, 5mi rural ex-urban, 10mi rural, 15mi remote)
- Default buffer changed 5mi → 3mi

### F257 — Deal Calculator product enhancements

- "Pre-fill AMI mix from local need" button — proportional allocation
  from existing `_gapTrioFromRecord()` gap counts (30/50/60)
- Dev budget breakdown: acq 10% / hard 62% / soft 14% / cont 5% / fee 9%
- Adjustment guidance: >30% TDC gap triggers "deepen AMI / chase QCT-DDA
  / right-size" lever; 15-30% gap triggers DOH gap-funding suggestion
- Building-type / amenities / expense scoring note

### F258 — Finding 11 + Regrid shutdown

- 4% scoring rebalance (Finding 11 confirmed and shipped)
- Regrid v2 Parcels API workflow gracefully shut down — token expired
  + no free tier; workflow falls into existing no-key stub branch and
  emits clean "stub (no API key)" cache instead of 401 spam
- Re-enable path documented in `.github/workflows/fetch-parcel-zoning-data.yml`
  comment block

### F259 — Insight refresh, tract picker, audit handoff

#### Phase A — Insight article refresh

Four still-stale insight articles got a "current as of June 2026" callout
at the top so the historical analysis below stays useful but the lede
reflects today's read:

- `article-pricing.html`: Q1 2026 → Q2 2026 framing; pricing band widened
  to $0.70–$0.95 with mid-tier near $0.84–$0.87
- `cra-expansion-analysis.html`: 2023 CRA modernization rule reached its
  January 1, 2026 applicability date for most provisions; scenarios below
  are now a counterfactual, not a forecast
- `colorado-deep-dive.html`: FHFA STHPI −2.4% YoY in Q1 2026 + 2026
  construction tariffs (10–50%) flowing into hard-cost estimates
- `article-co-housing-costs.html`: NLIHC Out of Reach 2025 — Colorado
  statewide 2BR FMR $1,913/mo, 2BR housing wage $36.79/hr

#### Phase B — CHFA-compliant tract picker for PMA tool

CHFA's Market Study Guide (Appendix A) requires the PMA to include
entire census tracts — radius boundaries are not allowed. The three
existing PMA modes (buffer / commuting / hybrid) all derive boundaries
from a radius or commute shed. F259-B adds a fourth mode:

- New module: `js/pma-tract-picker.js`
- Loads `tract_boundaries_co.geojson` + `tract_centroids_co.json`
- Renders nearby tracts (~12 mi) as click-toggleable Leaflet polygons
- Pre-selects tracts within 4 mi as a starting set
- `getBoundary()` returns convex hull of selected tract centroids as
  a GeoJSON Feature
- Analysis runner accepts `tractGeoids` + `tractBoundary` options; when
  `method === 'tract'`, skips LODES analysis and uses the explicit
  tract-set polygon
- Pre-flight blocks Run Analysis when picker is empty so empty submittals
  can't proceed silently
- Bbox widened to 15 mi in tract mode

Browser-verified at New Castle (39.57, -107.54): 31 tracts visible, 3
pre-selected, valid Polygon boundary computed, no console errors.

#### Phase C — Codex audit handoff

This document.

## Known data hygiene issue worth a follow-up

While building the tract picker, the following inconsistency surfaced in
`data/market/tract_centroids_co.json` and worth a clean audit:

- Tracts in the Garfield County area (around New Castle, Glenwood Springs;
  lat ~39.5, lon ~−107.5) carry GEOIDs starting with 08041 and
  `county_fips: "08041"`. By US Census FIPS, 08041 is El Paso County
  (Colorado Springs); Garfield's FIPS is 08045.
- The boundary file `data/market/tract_boundaries_co.geojson` uses the
  same GEOID stems, so the join is internally consistent. The tract
  picker UI works because it joins by GEOID and never relies on
  `county_name`.
- A separate background task has been spawned to trace the data lineage
  in `scripts/market/build_public_market_data.py` and decide whether to
  fix the `county_fips` / `county_name` labels or regenerate the file.

## What this audit cycle should check

1. **Voice + tone consistency** — confirm no residual "COHO," "we/our,"
   or "deal cockpit" framing on any rendered page (run a grep across
   `*.html`).
2. **4% scoring rebalance impact** — Rifle, Carbondale, New Castle, Rifle,
   Glenwood Springs jurisdictions: are the rankings sane after the F258
   weight change? Are there other rural jurisdictions that should now
   rank higher but don't?
3. **AHCIA enactment language** — `lihtc-enhancement-ahcia.html` claims
   provisions were enacted via the July 4, 2025 reconciliation bill;
   verify the specific provisions (Permanent +12% allocation, Permanent
   25% PAB threshold) are stated correctly. The remaining provisions
   should be framed as "pending" or "active in Congress" with current
   sponsor counts.
4. **Q2 2026 pricing band** — `article-pricing.html` cites a $0.70–$0.95
   range. Verify against current Novogradac quarterly pricing notes.
5. **CRA final rule applicability** — the article now treats the
   rule as in effect from January 1, 2026. Confirm via the Federal
   Reserve's 2025 CRA implementation FAQ.
6. **PMA tract picker** — exercise the new mode on 2–3 sites (urban,
   suburban, rural) and confirm:
   - Tracts visible match what a developer would expect to see
   - The pre-selected set is sensible
   - Selected GEOIDs flow into `pmaSupportSummary` correctly
   - The boundary polygon overlays the right area on the map
7. **Tract centroids county-FIPS discrepancy** — see "Known data hygiene
   issue" above; flag if scope changes since the spawned task was
   created.
8. **Place-vs-county masking** — recurring class of bug per memory note;
   audit place-level data wiring proactively when touching HNA / OF
   displays.

## Repo state at handoff

- Branch: `main`, clean working tree
- 0 open PRs
- CI: all green
- Live site current (deployed via `actions/deploy-pages@v5`)
- Last commit: F259-B tract picker commit on top of clean rebase

Audit handoff prepared 2026-06-10.
