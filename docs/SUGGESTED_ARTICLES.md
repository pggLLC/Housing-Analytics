# Suggested Articles & Insights Queue

**Purpose:** Track emerging topics for new Insights page articles and analysis.  
**Owner:** COHO Analytics team  
**Last updated:** 2026-03-17

---

## Overview

This document serves as the editorial queue for the COHO Analytics Insights page.
New topics are added here when data signals warrant a fresh article. Topics progress
from **Proposed → In Progress → Published → Archived**.

For the framework governing Key Market Trends verification, see
`docs/MARKET_TRENDS_UPDATE_PROTOCOL.md`.

---

## Article Recommendation Queue

| Topic | Data Source | Trigger | Suggested Frequency | Status |
|-------|-------------|---------|-------------------|--------|
| **Monthly CAR Snapshot** | Colorado Association of REALTORS | New CAR release (1st of month) | Monthly | 🟡 Proposed |
| **LIHTC Pricing Trends** | Novogradac syndication reports | Quarterly releases | Quarterly | 🟡 Proposed |
| **Regional Housing Forecast Update** | Kalshi prediction markets + FRED | New forecasts available | As available | 🟡 Proposed |
| **CHFA Allocation Analysis** | CHFA announcements + HUD LIHTC DB | Annual allocations (Feb/Mar) | Annual | 🟡 Proposed |
| **Prop 123 Compliance Status** | CDOLA commitment portal | Quarterly updates | Quarterly | 🟡 Proposed |
| **Construction Cost Pressure Check** | AGC + BLS PPI | Monthly index release | Monthly | 🟡 Proposed |
| **Credit Pricing Deep Dive** | Novogradac + HUD pricing data | Significant moves (> $0.05/credit) | Ad hoc | 🟡 Proposed |
| **Labor Market Impact on LIHTC** | BLS employment data + CDLE job postings | Monthly BLS release | Monthly | 🟡 Proposed |
| **Metro-Specific Deep Dives** | CAR metro reports + Market Analysis PMA | Quarterly | Quarterly | 🟡 Proposed |
| **Policy Landscape Shift** | NCSHA alerts + 2026 Housing Legislation tracker | Legislative changes | Ad hoc | 🟡 Proposed |

**Status key:** 🟡 Proposed · 🔵 In Progress · ✅ Published · ⬛ Archived

---

## Detailed Topic Briefs

### 1. Monthly CAR Snapshot

**Description:** A one-page summary of the Colorado Association of REALTORS monthly
market report — statewide and key metro median prices, inventory days, and what the
numbers mean for LIHTC project feasibility and rental demand.

**Data sources:**
- `data/car-market-report-YYYY-MM.json` (automated monthly update)
- Colorado Association of REALTORS: <https://coloradorealtors.com/market-trends/>

**Trigger:** Publish within 5 business days of CAR monthly data availability (typically
the first week of each month for the prior month's data).

**Relevant COHO pages:** `colorado-deep-dive.html`, `market-analysis.html`

---

### 2. LIHTC Pricing Trends

**Description:** Quarterly tracking of 9% and 4% LIHTC equity pricing, investor appetite
signals, and implications for Colorado project feasibility and underwriting assumptions.

**Data sources:**
- Novogradac quarterly pricing surveys: <https://www.novoco.com/resource-centers/affordable-housing-tax-credits>
- COHO Insights article: `article-pricing.html` (update or companion piece)

**Trigger:** Novogradac Q1–Q4 report publication, or any quarter-over-quarter
pricing move ≥ $0.05 per credit.

**Relevant COHO pages:** `insights.html`, `article-pricing.html`

---

### 3. Regional Housing Forecast Update

**Description:** Forward-looking analysis combining Kalshi prediction market data with
FRED economic indicators to forecast Colorado rental demand, housing starts, and
LIHTC market conditions over the next 12–24 months.

**Data sources:**
- `data/kalshi-data.json` (weekly automated update, if API key configured)
- `data/fred-data.json` series: `HOUST5F`, `PERMIT5`, `MORTGAGE30US`, `UNRATE`
- COHO: `data-status.html` freshness report

**Trigger:** Significant new Kalshi market data or FRED housing starts report showing
≥ 10% monthly change.

**Relevant COHO pages:** `colorado-deep-dive.html`, `housing-needs-assessment.html`

---

### 4. CHFA Allocation Analysis

**Description:** Annual deep dive into CHFA's LIHTC award round — which projects
received 9% credits, where they are located (QCT/DDA status), how scoring priorities
shaped the portfolio, and what it means for the Colorado pipeline.

**Data sources:**
- CHFA award announcements: <https://www.chfainfo.com/arhtf/Awards>
- `data/chfa-lihtc.json` (weekly automated update)
- `data/hud_lihtc_co.geojson` or equivalent LIHTC map layer

**Trigger:** CHFA announces annual 9% credit awards (typically February–March).

**Relevant COHO pages:** `LIHTC-dashboard.html`, `colorado-deep-dive.html`

---

### 5. Prop 123 Compliance Status

**Description:** Colorado Proposition 123 (2022) requires participating municipalities
to increase affordable housing unit production at specified rates. This quarterly update
tracks commitment status and how compliance (or non-compliance) affects LIHTC project
viability in those jurisdictions.

**Data sources:**
- CDOLA commitment portal: <https://cdola.colorado.gov/prop-123>
- COHO HNA module: `housing-needs-assessment.html` (municipal analysis)
- `data/hna/municipal/municipal-config.json`

**Trigger:** CDOLA quarterly compliance report publication.

**Relevant COHO pages:** `housing-needs-assessment.html`, `compliance-dashboard.html`

---

### 6. Construction Cost Pressure Check

**Description:** Monthly snapshot of construction input costs and their impact on LIHTC
project pro formas — highlighting which cost categories are rising fastest and how
developers are responding (basis boosts, phasing, value engineering).

**Data sources:**
- AGC Construction Inflation Alert: <https://www.agc.org/learn/construction-data/construction-inflation-alert>
- BLS PPI: <https://www.bls.gov/ppi> (`WPUFD49207`, `WPU0811`, `WPU0812`, `WPU10170503`)
- `data/fred-data.json` — PPI series already fetched weekly

**Trigger:** Monthly BLS PPI release (typically second or third week of each month
for the prior month's data).

**Relevant COHO pages:** `construction-commodities.html`, `insights.html`

---

### 7. Credit Pricing Deep Dive

**Description:** An ad-hoc in-depth analysis when credit prices move significantly —
exploring the drivers (investor appetite, tax law changes, credit supply), where prices
may be headed, and how to model multiple pricing scenarios in project underwriting.

**Data sources:**
- Novogradac: <https://www.novoco.com/resource-centers/affordable-housing-tax-credits>
- HUD LIHTC pricing history
- COHO article: `article-pricing.html`

**Trigger:** Quarter-over-quarter move ≥ $0.05/credit (9% or 4% market).

**Relevant COHO pages:** `insights.html`, `cra-expansion-analysis.html`

---

### 8. Labor Market Impact on LIHTC

**Description:** Monthly analysis linking BLS employment data and CDLE job postings
to LIHTC development timelines — focusing on construction labor availability, wage
trends, and how labor market conditions are affecting project delivery and costs.

**Data sources:**
- BLS Employment Situation: <https://www.bls.gov/news.release/empsit.toc.htm>
- `data/fred-data.json` series: `CES2000000003`, `CES2000000008`, `JTSJOL`, `UNRATE`
- CDLE job postings (if configured): Colorado Department of Labor and Employment

**Trigger:** Monthly BLS Employment Situation release (first Friday of each month).

**Relevant COHO pages:** `housing-needs-assessment.html`, `construction-commodities.html`

---

### 9. Metro-Specific Deep Dives

**Description:** Quarterly rotating analysis of one of Colorado's major metro areas
(Denver, Colorado Springs, Boulder, Fort Collins, Pueblo, Grand Junction) — examining
local LIHTC pipeline, vacancy trends, AMI gaps, and market conditions using PMA data.

**Data sources:**
- `data/car-market-report-YYYY-MM.json` — metro area breakdowns
- `data/chfa-lihtc.json` — filtered by county
- COHO PMA tool: `market-analysis.html`
- COHO HNA: `housing-needs-assessment.html`

**Trigger:** Each quarter, rotate to the next metro region (Q1: Denver/Front Range,
Q2: Colorado Springs, Q3: Boulder/Fort Collins, Q4: Western Slope/Pueblo).

**Relevant COHO pages:** `market-analysis.html`, `regional.html`

---

### 10. Policy Landscape Shift

**Description:** Ad-hoc analysis when significant housing legislation advances, passes,
or fails — connecting the policy change to LIHTC market implications, developer
strategy shifts, and Colorado-specific impacts.

**Data sources:**
- NCSHA member news: <https://www.ncsha.org>
- Congress.gov: <https://www.congress.gov>
- Colorado General Assembly: <https://leg.colorado.gov>
- COHO articles: `housing-legislation-2026.html`, `lihtc-enhancement-ahcia.html`

**Trigger:** Legislation passes committee, reaches floor vote, is signed, or fails —
any stage with material market implications.

**Relevant COHO pages:** `insights.html`, `housing-legislation-2026.html`

---

## Published Articles (Archive)

| Article | Published | Notes |
|---------|-----------|-------|
| Housing for the 21st Century Act: Complete Legislative Analysis | Feb 13, 2026 | `housing-legislation-2026.html` |
| Tax Credit Pricing Reaches Historic Lows | Feb 8, 2026 | `article-pricing.html` |
| Colorado Market Analysis & Forecast | Feb 10, 2026 | `colorado-market.html` |
| CRA Expansion Impact: Pricing Forecasts | Feb 13, 2026 | `cra-expansion-analysis.html` |
| LIHTC Enhancement & AHCIA | Internal resource | `lihtc-enhancement-ahcia.html` |
| LIHTC Basics (Stakeholder Guide) | Reference guide | `lihtc-guide-for-stakeholders.html` |

---

## Article Proposal Template

To propose a new article, open a GitHub issue with the label `article-proposal`
and include:

```
**Proposed Title:** 
**Topic Category:** (Legislative / Market Data / Regional / Policy / Data Analysis)
**Data Sources:** 
**Trigger / Timeliness:** 
**Suggested COHO Pages to Link:** 
**Estimated Length:** (short ~3 min / medium ~6 min / long ~12 min)
**Priority:** (urgent / standard / backlog)
```

---

## Related Resources

- **Key Market Trends checklist:** `docs/MARKET_TRENDS_UPDATE_PROTOCOL.md`
- **Alerts pipeline:** `docs/alerts-pipeline.md`
- **Data freshness dashboard:** `data-status.html`
- **Policy Briefs:** `policy-briefs.html`
