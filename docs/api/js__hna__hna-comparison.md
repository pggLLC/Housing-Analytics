# `js/hna/hna-comparison.js`

js/hna/hna-comparison.js
Comparison workspace for hna-comparative-analysis.html
County context filtering + searchable dropdown jurisdiction selection

Depends on: js/hna/hna-ranking-index.js (window.HNARanking)
            js/site-state.js (window.SiteState) — optional

Strategy: Rather than duplicating row rendering from hna-ranking-index.js,
this module injects HNA link cells into existing rows via MutationObserver.
Jurisdiction A/B selection is done via searchable dropdown selectors in the
setup bar. County filtering hides/shows rows via CSS rather than rebuilding.

## Symbols

### `_calcPurchaseAmi(homeValue, ami, isOwner)`

Compute the annual household income required to purchase a home at a
given price, then express that as a percentage of Area Median Income.

For current homeowners, we estimate a reduced purchase price reflecting
existing equity (median equity ≈ 40% of home value per Fed data).

@param {number} homeValue  Median home value ($)
@param {number} ami        Area Median Income ($), approximated from median HH income
@param {boolean} isOwner   true = current homeowner (has equity)
@returns {{ amiPct: number, requiredIncome: number, monthlyPayment: number,
            downPayment: number, loanAmount: number }}

### `_chasSourcePill(source)`

Small pill rendering the data source for a CHAS column.
Mirrors the three-state machine on the single-jurisdiction HNA
page's chasProvenanceBadge:
  'place'  → green "Place" (TIGER 2024 place-level apportionment)
  'county' → amber "County" (parent county fallback)
  'none'   → muted "—" (no CHAS data)

### `_deriveBurdenTiersForEntry(entry)`

Compute per-place renter cost-burden rates by AMI tier from the
TIGER-apportioned place-CHAS dataset (data/hna/place-chas.json).
Falls back to the entry's county-derived metrics when no place
blob exists, so the section keeps working for the 31 places not
in the TIGER spatial join.

Output: { lte30, tier3150, tier5180, tier81100, tier100plus, source }

### `_deriveOwnerBurdenForEntry(entry, summary)`

Compute owner cost-burden % (≥30% of income on housing) for a
Compare entry. Prefer ACS DP04 SMOCAPI bins from the summary
(DP04_0114PE + DP04_0115PE) when available; fall back to
place-CHAS / county-CHAS owner_cb30_share when ACS is null
(small-N suppression hides SMOCAPI bins for most CDPs and small
places).

Returns { value: number|null, source: 'acs'|'place_chas'|'county_chas'|'none' }
