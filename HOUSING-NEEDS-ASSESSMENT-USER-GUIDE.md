# Housing Needs Assessment (HNA) Tool — User Guide

> **Version:** 2026-03 | **Data vintage:** ACS 2024 (primary), DOLA 2024 SYA, LEHD LODES 2023  
> **Page:** `housing-needs-assessment.html`

---

## Table of Contents

1. [Overview & Purpose](#1-overview--purpose)
2. [Quick Start](#2-quick-start)
3. [Section-by-Section Walkthrough](#3-section-by-section-walkthrough)
   - 3.1 [Executive Snapshot](#31-executive-snapshot)
   - 3.2 [Interactive Map](#32-interactive-map)
   - 3.3 [LIHTC, QCT & DDA Overlays](#33-lihtc-qct--dda-overlays)
   - 3.4 [Housing Stock & Affordability](#34-housing-stock--affordability)
   - 3.5 [Demographic Projections — Age Pyramid & Senior Pressure](#35-demographic-projections--age-pyramid--senior-pressure)
   - 3.6 [20-Year Population & Housing Need Forecast](#36-20-year-population--housing-need-forecast)
   - 3.7 [Scenario-Based Projections (5–10 Year Horizon)](#37-scenario-based-projections-510-year-horizon)
   - 3.8 [Labor Market Context](#38-labor-market-context)
   - 3.9 [Economic Indicators](#39-economic-indicators)
   - 3.10 [Prop 123 / HB 22-1093 Compliance Tracking](#310-prop-123--hb-22-1093-compliance-tracking)
4. [How to Use Scenario Projections](#4-how-to-use-scenario-projections)
5. [Prop 123 Compliance Tracking Workflow](#5-prop-123-compliance-tracking-workflow)
6. [Municipal-Level Assessments](#6-municipal-level-assessments)
7. [Data Update Frequency & Reliability](#7-data-update-frequency--reliability)
8. [Troubleshooting Guide](#8-troubleshooting-guide)
9. [FAQ](#9-faq)

---

## 1. Overview & Purpose

The Housing Needs Assessment (HNA) tool is an interactive, data-driven dashboard that helps planners, housing authorities, local governments, and researchers answer three core questions:

1. **How many housing units does a jurisdiction need** over a 5–20 year horizon?
2. **Who is being left behind** in affordability (by income tier, tenure, age)?
3. **Is the jurisdiction on track** with Prop 123 / HB 22-1093 affordable housing commitments?

The tool aggregates data from five primary sources:
- **U.S. Census Bureau ACS 5-Year Estimates** (population, households, housing stock, income, commuting)
- **Colorado State Demography Office (DOLA/SDO)** single-year-of-age (SYA) population files and 20-year county forecasts
- **LEHD LODES** (Longitudinal Employer-Household Dynamics — Local Origin-Destination Employment Statistics)
- **HUD LIHTC / CHFA** Low-Income Housing Tax Credit property database
- **DOLA Prop 123 Commitment Filings**

All analysis is performed client-side in your browser. No data is sent to a server.

---

## 2. Quick Start

### Step 1 — Select a Geography

At the top of the page, choose from the **Geography type** dropdown:
- **County** — full Colorado county coverage (all 64 counties)
- **Municipality** — incorporated cities and towns with population ≥ 1,000
- **Census-Designated Place (CDP)** — unincorporated communities with defined boundaries

Then choose a specific geography in the **Select geography** dropdown and click **Refresh**.

> **Default:** Mesa County is pre-selected on first load as a worked example.

### Step 2 — Review the Executive Snapshot

The first card (top of page) shows six key metrics:
- Housing units on record
- Median household income
- Homeownership rate
- Rental vacancy rate
- Affordability gap (income needed vs. actual median)
- Net migration (20-year estimate)

These update automatically when you change geographies.

### Step 3 — Deep Dive Into Sections

Scroll down to explore each analysis section. Each section includes:
- A description of what is shown
- Data source links (click the bracketed `[Source]` tags)
- Interactive charts (hover for tooltips, click legend items to toggle series)

---

## 3. Section-by-Section Walkthrough

### 3.1 Executive Snapshot

**Purpose:** At-a-glance housing market health metrics for the selected geography.

| Metric | Source | Notes |
|--------|--------|-------|
| Housing units | ACS DP04 | Total housing units (occupied + vacant) |
| Median HH income | ACS DP03 | Inflation-adjusted, most recent vintage |
| Owner-occupancy rate | ACS DP04 | % owner-occupied of occupied units |
| Rental vacancy rate | ACS DP04 | % vacant for rent / total rental units |
| Affordability gap | ACS DP03 / AFFORD model | Income to qualify for median home price; uses 6.5% rate, 10% down, 30% payment-to-income |
| Net migration (20y) | DOLA county forecasts | County-level; scaled by population share for municipalities |

### 3.2 Interactive Map

**Purpose:** Spatial context — shows the selected geography boundary.

- The map centers on the selected jurisdiction automatically.
- Toggle map layers using the **Show map layers** controls below the map:
  - **LIHTC sites** — Low-Income Housing Tax Credit developments (HUD / CHFA)
  - **QCT** — Qualified Census Tracts (HUD 2026)
  - **DDA** — Difficult Development Areas (HUD 2026)

> **Note:** LIHTC, QCT, and DDA layers load asynchronously. If they appear empty, wait a few seconds or click **Refresh**. All ArcGIS FeatureServer queries use `outSR=4326` (WGS84) as required.

### 3.3 LIHTC, QCT & DDA Overlays

**Purpose:** Policy map overlays for affordable housing site selection.

- **LIHTC sites** — Shows existing tax credit developments within ~25 miles. Click a marker for project details (name, units, credit type, year placed in service).
- **QCT (Qualified Census Tracts)** — Census tracts where ≥50% of households earn <60% AMI *or* the poverty rate is ≥25%. QCT status increases 9% LIHTC allocation by 30%.
- **DDA (Difficult Development Areas)** — High construction-cost metropolitan areas. Same 30% basis boost as QCT.

### 3.4 Housing Stock & Affordability

**Purpose:** Understand the composition and affordability of the existing stock.

**Charts included:**
- **Housing units by structure type** — Single-family attached/detached, 2–4 unit, 5–9 unit, 10–19, 20–49, 50+ unit buildings, mobile homes
- **Owner/renter tenure split** — Donut chart
- **Affordability** — Percentage of households paying >30% of income on housing (cost-burdened); >50% (severely cost-burdened)
- **Rent burden distribution** — ACS gross rent as a percentage of household income, displayed as a stacked bar by income tier
- **Commuting: mode share** — Drive alone, carpool, transit, walk, work from home

**Key interpretation guidance:**
- A cost-burden rate >30% among renters signals affordability pressure at the bottom of the income distribution
- >50% owner-occupied indicates a market that may be supply-constrained for rentals
- A high drive-alone share (>80%) suggests limited transit options, which affects where affordable housing can be effectively located

### 3.5 Demographic Projections — Age Pyramid & Senior Pressure

**Purpose:** Visualize the current age structure and identify near-term senior housing demand growth.

**Data source:** DOLA/SDO Single-Year-of-Age (SYA) county files — 2024 vintage.

**Charts:**
- **Age pyramid** — Population by 5-year age group and sex. A "top-heavy" pyramid (wider at ages 55–75) indicates an aging community with growing assisted-living and affordable senior housing need.
- **Senior growth pressure** — Projected % growth in the 65+ population over 10 years. >15% growth is a high-pressure signal.

> **Note:** Pyramid year is set to 2024. If you see "—" for senior pressure, the DOLA SYA file for this county has not been cached yet. Run the **Build HNA Data** GitHub Actions workflow to populate it.

### 3.6 20-Year Population & Housing Need Forecast

**Purpose:** Establish a long-run housing unit need estimate under two methodological assumptions.

**Two projection lines:**
1. **DOLA forecast** — Colorado State Demography Office official county-level forecast through 2041
2. **Historic-trend sensitivity** — Independently calculated using the county's 10-year compound annual growth rate (CAGR) as a cross-check

**Housing need calculation:**
The model computes:
```
HH(t) = Pop(t) × Headship_Rate(t)
Units_needed(t) = HH(t) / (1 − target_vacancy_rate)
Incremental_units = Units_needed(t) − Current_units
```

**Assumption controls (expandable):**
- **Horizon** — Planning window (5, 10, 15, or 20 years; default 20)
- **Target vacancy rate** — Healthy vacancy cushion (default loaded from projection file; typically 5–12%)
- **Headship mode** — *Hold constant* (conservative) or *trend* (adjusts for demographic shifts in household formation rates)

> **For municipalities:** Population and household counts are scaled from the containing county's DOLA forecast using each municipality's historical share of county population plus its relative CAGR.

### 3.7 Scenario-Based Projections (5–10 Year Horizon)

See [Section 4 — How to Use Scenario Projections](#4-how-to-use-scenario-projections) for the complete workflow.

**Summary of views:**
| View | Chart | What it shows |
|------|-------|---------------|
| Population | `chartScenarioComparison` | All three scenarios on one axis |
| Population | `chartProjectionDetail` | Selected scenario in detail |
| Households | `chartProjectedHH` | DOLA-based household projection |
| Housing demand | `chartHouseholdDemand` | Demand stacked by AMI tier (renter) |

### 3.8 Labor Market Context

**Purpose:** Connect housing demand to employment and wage realities.

**Data source:** LEHD LODES Workplace Area Characteristics (WAC) 2023 snapshot, loaded from pre-built county cache files.

**Metrics shown:**
- **Total jobs** in the geography's workplace area
- **Wage distribution** — CE01 (annual wage <$1,250/mo), CE02 ($1,251–$3,333/mo), CE03 (>$3,333/mo)
- **Top industries** — Employment by NAICS supersector
- **Commuting inflow/outflow** — Number of workers who live vs. work in the jurisdiction (origin-destination summary)

> **Wage band interpretation:** CE01 workers earning <$15,000/year need housing at ≤30% AMI. CE02 (~$15,000–$40,000) need 30–80% AMI units. CE03 (>$40,000) can typically access market-rate units in most Colorado markets.

### 3.9 Economic Indicators

**Purpose:** Context on employment cycles, wage growth, and industry trends that affect housing demand.

**Charts:**
- **Employment Trend** — Total non-farm employment trend for the region
- **Wage Trend** — Average weekly wages over time
- **Industry Analysis** — Employment composition by major sector
- **Wage Gaps** — Comparison of median wages across income quartiles

### 3.10 Prop 123 / HB 22-1093 Compliance Tracking

See [Section 5 — Prop 123 Compliance Tracking Workflow](#5-prop-123-compliance-tracking-workflow) for the complete workflow.

**Components:**
- **Eligibility check** — Is the jurisdiction eligible to opt in? (Municipalities ≥1,000 population; counties ≥5,000 population)
- **Baseline (60% AMI rentals)** — Current count of units at or below 60% AMI
- **3% Annual Growth Target** — Progress toward the required 3% annual increase
- **Fast-Track Approval Eligibility** — Streamlined permitting for qualifying affordable projects
- **Historical Compliance Chart** — Year-over-year tracking against 3% target
- **Fast-Track Timeline Calculator** — Estimates months to approval under fast-track vs. standard review
- **Compliance Checklist** — Five-step checklist for annual DOLA filing

---

## 4. How to Use Scenario Projections

The **Scenario-Based Projections (5–10 Year Horizon)** section lets you model how different demographic assumptions change housing demand over the near term.

### Step 1 — Choose a Scenario

Use the **Scenario** dropdown at the top of the section:

| Scenario | Description | Best for |
|----------|-------------|---------|
| **Baseline** | Moderate growth; fertility steady; migration reflects 2018–2023 average | General planning; capital improvement programs |
| **Low Growth** | Slowing in-migration (~50% of baseline); modest fertility decline; slightly elevated mortality | Conservative/risk-averse analysis; bond capacity analysis |
| **High Growth** | Accelerated in-migration (2× baseline); above-trend fertility; continued mortality improvement | Optimistic scenarios; growth-funded infrastructure |

The **scenario description** updates automatically when you change the selection.

### Step 2 — Switch Between Chart Views

Use the **Population / Households / Housing demand** radio buttons to switch between three chart panels:

- **Population** — Side-by-side charts: all scenarios on one axis (left) + selected scenario detail (right)
- **Households** — DOLA-based household projection for the selected geography
- **Housing demand** — Stacked bar chart showing projected renter demand broken out by AMI affordability tier

### Step 3 — Override Demographic Assumptions

Expand the **Projection assumption overrides** panel to fine-tune the underlying rates:

| Slider | Range | Baseline default | What it does |
|--------|-------|-----------------|--------------|
| **Fertility rate multiplier** | 0.5–2.0 | 1.00 | Scales births relative to scenario baseline |
| **Net migration (annual)** | −500 to 3,000 | 500 | Annual net in-migration persons |
| **Mortality rate multiplier** | 0.8–1.2 | 1.00 | 1.0 = no change; >1.0 = higher mortality |

Changes apply immediately to all projection charts.

### Step 4 — Save a Custom Scenario

Click **Save as custom scenario** to:
1. Store your current slider values as a "Custom" scenario
2. Add "Custom" to the scenario dropdown
3. Switch the selected scenario to "Custom"

This lets you compare your custom assumptions directly against the standard scenarios.

### Interpreting the Charts

**Scenario Comparison chart (left panel):**
- Three colored lines diverge from the current base year
- Wider divergence = higher uncertainty; plan for the range, not just the middle
- Use the gap between low and high growth lines as your planning uncertainty band

**Single-scenario detail chart (right panel):**
- Shows only the selected scenario
- Population values are labeled in the tooltip (hover over any year)

**Housing demand by AMI tier:**
- Each bar represents a future year
- Stacked segments show demand at each income tier (≤30% AMI, 31–50%, 51–80%, 81–100%, 101–120%, >120%)
- Focus on the ≤30% and 31–50% AMI segments — these are typically the most under-served
- Note: tier shares use statewide ACS CHAS approximations; county-level ETL data provides more precise splits when available

> **For municipal geographies:** All projections are scaled from the containing county's DOLA forecast using the municipality's population share and relative CAGR. The accuracy of municipal projections depends on the quality of the ETL-derived scaling factors in `data/hna/derived/geo-derived.json`.

---

## 5. Prop 123 Compliance Tracking Workflow

Proposition 123 (HB 22-1093) requires participating jurisdictions to commit to a 3% annual increase in affordable rental units (at or below 60% AMI) and to implement fast-track permitting for qualifying projects.

### Eligibility Check

The tool automatically evaluates eligibility:
- **Municipalities ≥1,000 population** — eligible
- **Counties ≥5,000 population** — eligible
- Below these thresholds — not required to participate

### Annual Compliance Workflow

1. **Establish Baseline** — Document the current number of units affordable to households at ≤60% AMI. This becomes the denominator for the 3% growth target.

2. **Set 3% Annual Growth Target** — The tool calculates `target_units = baseline × 1.03^years`. Track actual affordable unit additions against this trajectory.

3. **Review Fast-Track Eligibility** — Use the **Fast-Track Approval Timeline Calculator**:
   - Enter the project's number of affordable units and income level
   - Click **Calculate** to see estimated review timeline (standard vs. fast-track)
   - Fast-track qualification requires: ≥10% units at ≤60% AMI *or* 100% at ≤80% AMI

4. **File Annual Notice with DOLA** — **Deadline: January 31 each year**
   - Submit commitment notice at [DOLA Commitment Filings Portal](https://cdola.colorado.gov/commitment-filings)
   - Report actual unit counts and progress toward 3% target

5. **Annual Reporting** — File the full annual report with DOLA by the filing deadline

### Compliance Checklist

The five-item checklist in the tool tracks:
- [ ] Establish baseline (60% AMI rentals documented)
- [ ] Adopt 3% annual growth target
- [ ] Document fast-track approval process
- [ ] File notice with DOLA (annual deadline: January 31)
- [ ] Annual reporting filed with DOLA

Check items off as they are completed. Checked items are visually marked (strikethrough) to distinguish from pending items.

### Viewing the Full Compliance Dashboard

Click **View full compliance dashboard →** at the bottom of the Prop 123 section to open `compliance-dashboard.html`, which provides:
- Multi-jurisdiction comparison
- Historical year-over-year compliance tracking
- CSV export of all jurisdiction data

---

## 6. Municipal-Level Assessments

The HNA tool supports municipal-level analysis using a county-to-municipality scaling methodology
implemented in `js/municipal-analysis.js`.

### Supported Geographies

The tool includes **57 Colorado municipalities** (incorporated cities and towns) plus **CDPs**. The full list is in `data/hna/geo-config.json`.

**32 featured municipalities** with pre-computed ACS growth rates are listed in `data/hna/municipal/municipal-config.json`:
Denver, Colorado Springs, Aurora, Fort Collins, Lakewood, Thornton, Arvada, Westminster, Pueblo,
Centennial, Boulder, Greeley, Longmont, Loveland, Broomfield, Castle Rock, Commerce City, Parker,
Northglenn, Brighton, Littleton, Englewood, Wheat Ridge, Golden, Grand Junction, Durango,
Steamboat Springs, Montrose, Sterling, Glenwood Springs, Aspen, and Vail.

### Data Quality Badge

When you select a municipality, a **Data Quality Badge** appears next to the geography pill
in the Executive Snapshot header. It indicates how the displayed figures were derived:

| Badge | Color | Meaning |
|-------|-------|---------|
| **Direct** | 🟢 Green | ACS 5-year estimate directly for this municipality |
| **Interpolated** | 🔵 Blue | Scaled from county data using ACS growth rates (population ≥ 2,500) |
| **Estimated** | 🟡 Amber | General statistical approximation, or scaled but population < 2,500 |
| **Unavailable** | ⬜ Grey | No usable data source for this metric |

### Municipal vs. County Comparison Panel

When a municipality is selected, a **Municipal vs. County Context** panel appears below
the headline statistics. It shows:

- **Population share of county** — the municipality's current share of its containing county's population
- **Estimated housing units** — derived using the best available method (direct → household-ratio → population-share)
- **Rent adjustment factor** — `municipalRent / countyRent`, clamped to [0.5, 2.0]; used to redistribute AMI tiers
- **Estimated jobs** — county LEHD employment × population share

The **Interpolation methodology** accordion within the panel explains the formulas used.
The panel is hidden for county-level selections.

### Methodology: Municipal Scaling

Because DOLA forecasts are county-level only, municipal projections are derived as follows:

```
municipality_pop(t) = county_pop(t) × share(t)
share(t) = share₀ × exp(relativeLogGrowth × t)
```

Where:
- `share₀` = municipality's share of county population in the base year
- `relativeLogGrowth` = `ln(1 + municipalGrowthRate) − ln(1 + countyGrowthRate)`

Growth rates are sourced from `data/hna/municipal/growth-rates.json` (3/5/10-yr ACS CAGRs).
If ETL-derived inputs are available in `data/hna/derived/geo-derived.json`, those inputs
take precedence. Otherwise, the tool falls back to simple population share scaling.

See [docs/MUNICIPAL-ANALYSIS-METHODOLOGY.md](docs/MUNICIPAL-ANALYSIS-METHODOLOGY.md) for
the full technical specification including housing stock estimation, affordability scaling,
and employment estimation.

### Limitations at Municipal Level

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| No DOLA municipal-level projections | Less accurate long-run forecasts | Cross-check with local housing element data |
| Headship rate estimated from ACS 5-year | Less precise for small municipalities | Use ACS 1-year if available |
| LEHD WAC data aggregated to county | Job counts are workplace-area estimates | Note in reports as "county workplace area" |
| Prop 123 eligibility uses ACS population | Small error for rapidly growing places | Verify against DOLA OFM population estimates |
| Small-place uncertainty (< 2,500 pop) | High ACS CVs; badge downgrades to Estimated | Supplement with local census special tabulation |

---

## 7. Data Update Frequency & Reliability

| Data source | Update frequency | Lag | Reliability |
|-------------|-----------------|-----|-------------|
| ACS 5-Year Estimates | Annual (December) | ~18 months | High for areas ≥65,000 pop |
| DOLA SYA county files | Annual (released spring) | ~12 months | High (official CO estimates) |
| DOLA 20-year forecasts | ~Every 5 years | Varies | High for planning; check base year |
| LEHD LODES WAC | Annual (released ~18 months after reference year) | ~18 months | High |
| HUD LIHTC database | Annual | ~12 months | Medium (self-reported by allocating agencies) |
| QCT / DDA designations | Annual (October) | <2 months | High (HUD official) |
| Prop 123 commitments | As filed (DOLA updates regularly) | Days | Medium (voluntary filings) |

### Identifying Data Freshness

- The **data timestamp** badge below the page title shows when the cached HNA data files were last built
- The `[Source]` links next to each chart open the source data page
- Run the **Build HNA Data** GitHub Actions workflow to refresh all cached files

---

## 8. Troubleshooting Guide

### Charts show "—" or don't render

**Cause:** Projection or profile data files haven't been built for this geography yet.

**Fix:** Run the `build_hna_data.py` workflow via GitHub Actions (Actions → Build HNA Data → Run workflow). For county-level data, all 64 counties are included. For municipalities, verify that the place FIPS code is present in `data/hna/geo-config.json`.

---

### Scenario charts are empty after selecting a geography

**Cause:** The geography's projection file (`data/hna/projections/<FIPS>.json`) may be missing or have an empty `population_dola` array.

**Fix:**
1. Check the browser console (F12) for error messages
2. Verify the file exists: look for `data/hna/projections/08XYZ.json`
3. Confirm the file has a non-empty `years` and `population_dola` array
4. Re-run the Build HNA Data workflow to regenerate missing files

---

### Map doesn't show the geography boundary

**Cause:** The selected FIPS code may not match TIGERweb boundaries, or there may be a network timeout.

**Fix:**
1. Click **Refresh** — the map reloads independently of the data pane
2. Verify the FIPS code is 5 digits for counties (e.g., `08077`) or 7 digits for places (e.g., `0820000`)
3. Check your browser console for CORS or network errors

---

### Municipal projections appear much lower than expected

**Cause:** The municipality's population share is very small relative to its county. This is expected for very small municipalities within large counties.

**Fix:** Cross-check with the "Historic-trend sensitivity" series in Section 3.6. If there's a large discrepancy, it may indicate the municipality has grown faster than the county average — contact your regional planner to verify.

---

### Prop 123 compliance status shows "No data"

**Cause:** The selected jurisdiction does not appear in the DOLA commitment filings data (`data/prop123_jurisdictions.json`).

**Fix:**
1. Verify the jurisdiction has filed a Prop 123 commitment with DOLA
2. Check [DOLA Commitment Filings Portal](https://cdola.colorado.gov/commitment-filings)
3. Run `scripts/fetch-county-demographics.js` to update the data file

---

### Export (PDF/CSV/JSON) button doesn't work

**Cause:** The export module (`js/hna-export.js`) may not have loaded.

**Fix:**
1. Check that `js/hna-export.js` is included in the `<head>` of `housing-needs-assessment.html`
2. Open browser console and check for script load errors
3. Ensure the `window.__HNA_exportPdf`, `window.__HNA_exportCsv`, and `window.__HNA_exportJson` functions are defined

---

## 9. FAQ

**Q: How accurate are the municipal-level projections?**

A: Municipal projections are estimates derived by scaling county-level DOLA forecasts. They are most accurate for municipalities that represent ≥5% of their county population and have stable relative growth rates. For small, rapidly growing, or shrinking municipalities, treat the projections as order-of-magnitude estimates. Always cross-reference with local data (e.g., building permit trends, utility connection counts).

---

**Q: Can I use this tool for a housing element update?**

A: Yes, the tool is designed to support Colorado housing element preparation under HB 24-1313. The 20-year forecast section (Section 3.6) directly addresses the statutory requirement to project housing need by income category. For formal housing elements, supplement this tool with:
- Local housing surveys
- DOLA Housing Studies
- Regional planning commission data

---

**Q: What does "scaled from county" mean for municipal projections?**

A: DOLA only produces official forecasts at the county level. For municipalities, the tool estimates population by calculating the municipality's historical share of county population, then applying that share (adjusted for relative growth trends) to the county's future population. This is the same methodology used by most municipal planning departments before official sub-county forecasts are available.

---

**Q: Why are the Scenario-based charts different from the 20-year forecast charts?**

A: The 20-year charts (Section 3.6) use the official DOLA forecast and a 10-year CAGR sensitivity line — both are based on historical data with no user-adjustable assumptions.

The Scenario-based charts (Section 3.7) apply growth multipliers to the DOLA baseline to model divergent futures. They are designed for **what-if planning** (e.g., "What if in-migration drops by half?") rather than as official forecasts.

---

**Q: What is a QCT and why does it matter for affordable housing?**

A: A Qualified Census Tract (QCT) is a census tract where ≥50% of households earn below 60% AMI, or where the poverty rate is ≥25%. LIHTC projects in QCTs receive a 30% basis boost, which means developers can finance 30% more construction costs through tax credits. This makes it financially feasible to build in high-poverty, high-need areas where market rents alone can't support development costs.

---

**Q: How do I add a new municipality to the tool?**

A: Edit `data/hna/geo-config.json` and add an entry to the `places` array:
```json
{
  "type": "place",
  "geoid": "08XXXXXX",
  "label": "My City (city)",
  "containingCounty": "08XXX"
}
```

FIPS place codes for Colorado can be looked up at [Census TIGER/Line](https://www.census.gov/geo/maps-data/data/tiger.html). The `containingCounty` must be the 5-digit county FIPS code.

---

**Q: How do I update the data files?**

A: Run the **Build HNA Data** workflow in GitHub Actions:
1. Navigate to the repository on GitHub
2. Click **Actions** → **Build HNA Data**
3. Click **Run workflow**

This rebuilds projection files, DOLA SYA pyramids, LEHD snapshots, and the manifest. It requires Census API keys and DOLA data access configured in the repository secrets.

---

**Q: What is the difference between ACS 1-year and 5-year estimates?**

A: The tool uses **ACS 5-year estimates** as the primary source. They cover all geographies (including small municipalities) but represent a 5-year rolling average rather than a single year. For places with population ≥65,000, the ACS 1-year estimate (single-year, more current) is probed first — but most Colorado municipalities require the 5-year.

- **Use 5-year estimates for:** Planning, needs assessments, program eligibility
- **Use 1-year estimates for:** Year-over-year trend analysis in large metros (Denver, Colorado Springs, Aurora)

---

*Last updated: March 2026 | Maintained by pggLLC Housing Analytics*  
*Questions or issues: open a GitHub issue at [pggLLC/Housing-Analytics](https://github.com/pggLLC/Housing-Analytics)*
