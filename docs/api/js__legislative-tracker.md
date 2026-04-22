# `js/legislative-tracker.js`

js/legislative-tracker.js
Legislative Bill Status Tracker — Phase 3 (Epic #444)

Tracks status and impact of key affordable housing bills:
  - H.R. 6644 (Housing for the 21st Century Act)
  - AHCIA (Affordable Housing Credit Improvement Act)
  - S.XXXX (Senate ROAD Act)
  - CRA Modernization provisions

Provides:
  - Bill status data with stage/timeline annotations
  - Impact scoring for LIHTC demand and investor base
  - CRA targeting signals by census tract category
  - Structured data for dashboard rendering

Exposed as window.LegislativeTracker (browser) and module.exports (Node/test).

## Symbols

### `getAllBills()`

Get all bills with computed status fields.
@returns {Object[]} Array of bill objects with computed fields

### `getBill(id)`

Get a single bill by ID.
@param {string} id — Bill ID (e.g. 'HR6644', 'AHCIA')
@returns {Object|null}

### `getBillsByTag(tag)`

Get bills filtered by tag.
@param {string} tag — Tag to filter by (e.g. 'LIHTC', 'CRA')
@returns {Object[]}

### `getMarketImpactSummary()`

Compute aggregate LIHTC and CRA market impact across all active bills.
@returns {Object} Aggregate impact summary

### `getCraTractTargeting(tractType)`

Get CRA tract targeting analysis for a given tract type.
@param {string} tractType — One of: lmi, distressed, rural, opportunity_zone, non_lmi
@returns {Object|null}

### `getLegislativeTimeline()`

Get legislative timeline events sorted chronologically.
@returns {Object[]} Timeline entries
