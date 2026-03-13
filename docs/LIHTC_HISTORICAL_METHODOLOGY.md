# Colorado LIHTC Historical Allocations — Methodology Note

**Dataset:** `data/co-historical-allocations.json`  
**Coverage:** 1988–2024 (Colorado statewide)  
**Audience:** Developers, investors, syndicators, market analysts  
**Last revised:** March 2026

---

## Purpose

This document explains how `data/co-historical-allocations.json` was
constructed, what each field means, and the key caveats required to
interpret the data correctly. The dataset consolidates Colorado Low-Income
Housing Tax Credit (LIHTC) allocation history from multiple authoritative
sources into a single machine-readable file.

---

## Critical Distinction: Allocation Authority vs. Project Delivery

> **Allocation authority** (the dollar ceiling the IRS permits Colorado to
> award each year) is **not** the same as the number of units placed in service
> or the number of projects completed.

A single allocation cycle may span 3–5 years from IRS credit reservation to
building occupancy. Common gaps include:

| Phase | Typical duration |
|-------|-----------------|
| Credit reservation → financial closing | 6–18 months |
| Construction | 12–24 months |
| Certificate of occupancy → placed in service | 1–6 months |
| HUD database reporting lag | 12–24 months |

Use `allocationAuthority` figures for **trend and scale analysis** of the
state's affordable housing capacity. Use `liUnits` and `projects` figures
(derived from `YR_ALLOC` in the HUD database) as a **proxy for annual
production pipeline**, not a precise count of units available in a given year.

---

## Data Sources

### 1. HUD LIHTC Database (project-level fields)

- **URL:** <https://lihtc.huduser.gov/>
- **Local cache:** `data/chfa-lihtc.json`
- **Fields derived:** `projects`, `liUnits`, `totalUnits`, `credit9pct`,
  `credit4pct`, `creditBoth`, `nonProfit`, `qct`, `dda`, `hudDataStatus`
- **Year field used:** `YR_ALLOC` (the year credits were allocated, not the
  year placed in service). This matches the allocation-authority series.
- **Coverage:** Substantially complete through 2019. Years 2018–2019 may be
  slightly understated (`hudDataStatus: "partial"`). Years 2020+ reflect HUD's
  12–24 month reporting lag (`hudDataStatus: "incomplete"`).

### 2. IRS Section 42 Per-Capita Floor (allocation authority)

- **URL:** <https://www.irs.gov/credits-deductions/businesses/low-income-housing-credit>
- **Fields derived:** `irsPerCapita`, `allocationAuthority`,
  `perCapitaAuthority`, `authorityStatus`
- **Method:** Colorado allocation authority = IRS per-capita floor ×
  Colorado resident population estimate.
- **Confirmed figures** (marked `authorityStatus: "confirmed"`) are cross-
  checked against CHFA annual reports and HUD's state-level allocation tables
  for 2016–2022.
- **Estimated figures** (marked `authorityStatus: "estimated"`) apply the
  national per-capita floor to Colorado's Census Bureau intercensal population
  estimate. Actual CHFA award amounts may differ by ±2–5% due to carry-forward
  rules and state-specific adjustments.

### 3. Novogradac Annual Summaries (national context)

- **URL:** <https://www.novoco.com/resource-centers/affordable-housing-tax-credits>
- **Fields derived:** `nationalTotal`, `coShareOfNational`
- **Note:** National totals are approximate aggregates from Novogradac's
  annual state-by-state summaries. They represent the sum of state allocation
  authority, not actual credit awards.

---

## Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `year` | integer | Allocation year (IRS `YR_ALLOC` field) |
| `projects` | integer | LIHTC projects with credits allocated this year |
| `liUnits` | integer | Low-income units in those projects |
| `totalUnits` | integer | Total units (market + low-income) |
| `credit9pct` | integer | Projects using 9% (competitive) credit |
| `credit4pct` | integer | Projects using 4% (bond-financed) credit |
| `creditBoth` | integer | Projects using both credit types |
| `nonProfit` | integer | Projects with non-profit sponsor |
| `qct` | integer | Projects in Qualified Census Tracts |
| `dda` | integer | Projects in Difficult Development Areas |
| `hudDataStatus` | string | `"complete"` \| `"partial"` \| `"incomplete"` |
| `hudDataNote` | string | Explains incomplete/partial status (omitted when complete) |
| `irsPerCapita` | number | IRS per-capita floor ($/person) in effect |
| `allocationAuthority` | number | Colorado total allocation ceiling ($) |
| `population` | integer | CO population estimate used in authority calc |
| `perCapitaAuthority` | number | Colorado per-capita authority ($/person) |
| `authorityStatus` | string | `"confirmed"` \| `"estimated"` |
| `authorityNotes` | string | Explanation when estimated (omitted when confirmed) |
| `nationalTotal` | number | Approximate national LIHTC total ($) |
| `coShareOfNational` | number | Colorado % share of national total |
| `policyNote` | string | Significant federal policy event (omitted when none) |

---

## IRS Per-Capita Floor History

| Period | Floor ($/person) | Key legislation |
|--------|-----------------|-----------------|
| 1988–2000 | $1.25 | Tax Reform Act of 1986 |
| 2001 | $1.50 | Community Renewal Tax Relief Act of 2000 |
| 2002–2003 | $1.75 | Job Creation and Worker Assistance Act of 2002 |
| 2004 | $1.80 | Working Families Tax Relief Act of 2004 |
| 2005 | $1.85 | Energy Policy Act of 2005 (CPI indexing begins) |
| 2006 | $1.90 | CPI adjustment |
| 2007 | $1.95 | CPI adjustment |
| 2008–2009 | $2.00–$2.10 | Housing and Economic Recovery Act (HERA) |
| 2010–2024 | $2.10–$2.85 | Annual CPI adjustments |

*Starting in 2003, the floor is adjusted annually for inflation (CPI). Figures
above reflect published IRS Revenue Procedures for each year.*

---

## CREDIT Field Coding (HUD LIHTC Database)

The `CREDIT` attribute in the HUD database uses the following codes:

| Code | Meaning |
|------|---------|
| `1` | 9% credit (competitive, non-bond) |
| `2` | 4% credit (bond-financed) |
| `3` | Both 9% and 4% credits |

The 9% credit is awarded through CHFA's competitive Qualified Allocation Plan
(QAP). The 4% credit is available by right to projects financed with
tax-exempt private activity bonds issued under Colorado's bond cap.

---

## Data Quality and Limitations

### HUD Database Lag
The HUD LIHTC database is updated annually but typically reflects
allocations with a 12–24 month delay. Projects with `YR_ALLOC` in 2018–2019
may be understated, and 2020+ data should be treated as a floor estimate only.

### Allocation Authority vs. Awarded Credits
Colorado CHFA does not always award the full IRS ceiling. In years with fewer
competitive applications or slower bond issuance, actual credits awarded may be
10–20% below the authority ceiling. The `allocationAuthority` field represents
the **maximum permissible ceiling**, not actual awards.

### Carry-Forward Authority
States may carry forward up to three years of unused allocation authority.
Year-over-year changes in `allocationAuthority` therefore understate the
effective credit supply available to developers in any given year.

### QCT/DDA Designations
QCT and DDA designations change annually. The `qct` and `dda` counts in this
dataset reflect the designation **at time of allocation**. A project counted
as QCT in one year may lose that status by placed-in-service.

### Geographic Coverage
This dataset covers **Colorado statewide**. County-level project counts are
available separately in `data/lihtc-trends-by-county.json` (2015–2025, using
`YR_PIS`). Per-county project GeoJSON is available in `data/hna/lihtc/`.

---

## Related Files

| File | Description |
|------|-------------|
| `data/co-historical-allocations.json` | **This dataset** — state-level annual summary |
| `data/chfa-lihtc.json` | Project-level GeoJSON (HUD LIHTC database, CO only) |
| `data/lihtc-trends-by-county.json` | County project counts by year placed in service (2015–2025) |
| `data/hna/lihtc/{fips}.json` | Per-county LIHTC GeoJSON stubs |
| `data/market/hud_lihtc_co.geojson` | HUD LIHTC CO GeoJSON (market analysis layer) |
| `data/allocations.json` | Current-year (2026) all-states allocation data |
| `js/state-allocations-historical.js` | JS module — national and CO allocation authority (2010–2023) |
| `LIHTC-dashboard.html` | Interactive dashboard using this data |

---

## Suggested Uses

**Developers and syndicators:**
Use `allocationAuthority` and `irsPerCapita` to understand the dollar volume
of credits Colorado has historically made available. Combine with `credit9pct`
and `credit4pct` counts to assess competitive vs. bond-financed deal flow.

**Investors:**
Track `liUnits` over time to assess supply pipeline. Note the `hudDataStatus`
field — incomplete years should be treated as floor estimates when modeling
future inventory.

**Market analysts:**
Use `coShareOfNational` and `perCapitaAuthority` to benchmark Colorado against
other states. Cross-reference `policyNote` fields to understand how federal
legislative events have influenced Colorado's production cycles.

**Policy researchers:**
Compare `allocationAuthority` to `liUnits` to estimate utilization efficiency.
Large gaps between authorized credits and delivered units may indicate
financing gaps, land constraints, or construction cost pressures.

---

## Update Cadence

This dataset should be refreshed:
- **Annually** after HUD publishes its LIHTC database update (typically Q3–Q4
  of the following year)
- **Upon each CHFA QAP award cycle** (typically spring) to update
  `authorityStatus: "confirmed"` entries for the prior year
- **When IRS Revenue Procedures announce the new per-capita floor**
  (typically October–November preceding the allocation year)

Run `scripts/rebuild_manifest.py` after updating to keep `data/manifest.json`
current.

---

*Sources: HUD LIHTC Database, IRS Revenue Procedures (Section 42), CHFA Annual
Reports, Novogradac annual summaries, U.S. Census Bureau intercensal population
estimates. Methodology questions: see repository issue tracker.*
