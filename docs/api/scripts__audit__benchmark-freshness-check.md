# `scripts/audit/benchmark-freshness-check.mjs`

scripts/audit/benchmark-freshness-check.mjs — F(#1147)

Why this exists
----------------
The Deal Calculator cites two static market-benchmark snapshots:

  - data/market/novogradac-equity-pricing.json   (LIHTC equity pricing)
  - data/market/freddie-mac-multifamily-outlook.json (rates/cap-rate outlook)
  - data/market/tax-credit-transfer-pricing.json (tax-credit transfer pricing)
  - data/market/colorado-equity-pricing-factors.json (CO-specific LIHTC pricing factors)
  - data/policy/tax-credit-legislation.json (tax-credit legislation watchlist)
  - data/policy/homeownership-programs.json (consumer homebuyer program watchlist)
  - data/policy/lihtc-assumptions.json (predictor non-pricing assumptions)
  - data/market/colorado-foreclosure-performance.json (FHFA NMDB foreclosure performance)
  - data/market/hud_zip_tract_crosswalk_co.json (HUD-USPS ZIP-to-tract crosswalk)
  - data/market/fhfa_hpi_subcounty_co.json (FHFA tract-derived sub-county HPI)
  - data/market/redfin_place_market_tracker_co.json (Redfin ZIP-derived place market tracker)
  - data/market/developable_land_context_co.json (tract developable-land context)
  - data/market/travel_time_matrix_co.json (OSM-derived tract-to-regional-hub drive times)

Each was added in a one-time commit and has no refresh workflow. The UI
discloses the vintage honestly (shows `as_of` inline, links the source,
tells the user to verify before quoting), so a stale file is not a live
bug — but nothing surfaces staleness to a developer until a user notices.
This script makes it visible on demand.

NOT the same thing as scripts/audit/data-freshness-check.mjs: that script
enforces SLAs on pipeline-generated files (and fails CI when violated).
These two files are hand-captured external snapshots with a *stated
update cadence*; staleness here is advisory. Warn-only, always exits 0,
and deliberately NOT part of test:ci.

What it checks, per file:
  1. `review_by` dates (when present in meta or entries) have not passed.
  2. `meta.next_expected_update` (when present) has not passed.
  3. `meta.as_of` (falling back to `meta.vintage`) is not older than
     STALE_AFTER_DAYS (60 by default; annual sources can declare a longer cadence).

Date parsing accepts, in order:
  - ISO dates ("2026-07-01")
  - Month-name references ("early August 2026" → 2026-08-01)
  - Quarter strings ("2026-Q3" → end of that quarter, since an update
    "expected in Q3" isn't overdue until Q3 ends)

Usage:
  node scripts/audit/benchmark-freshness-check.mjs
  npm run audit:benchmark-freshness

## Symbols

### `parseWhen(raw)`

Best-effort parse of a "when" string into a Date, or null.
Order: ISO date → "Month YYYY" → "YYYY-Qn" (end of quarter).
