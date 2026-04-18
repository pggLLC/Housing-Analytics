# Market Intelligence Dashboard — Public Data Methodology

*Housing Analytics — Colorado LIHTC & Affordable Housing*  
*Last updated: 2026-03-03*

---

## 1. Purpose

The Market Intelligence page (`market-intelligence.html`) provides a statewide/county/tract-level affordable-housing market study dashboard built exclusively from **free, publicly accessible** data sources. It requires no API keys and works fully offline from data artifacts cached in `/data`.

---

## 2. Public Data Sources

| Dataset | Source | Variables Used | Refresh Cadence |
|---|---|---|---|
| ACS 5-Year Estimates | US Census Bureau (public) | B01003, B25003, B25004, B19013, B25064, B25070 | Annual |
| HUD LIHTC Database | HUD (public) | TOTAL_UNITS, PROJECT_NAME, geometry | Periodic |
| Prop 123 Commitments | Local JSON (`data/policy/prop123_jurisdictions.json`) | Name, kind, status, filing date | Manual update |
| Census TIGERweb | ArcGIS REST (public) | Tract centroids, county boundaries | Annual |

**Note:** The dashboard does NOT use Zillow, ESRI Business Analyst, CoStar, MLS, or any paid/subscription data.

---

## 3. Affordability Pressure Section

### Variables
- **Cost Burden Rate** — `B25070` series: percent of renter households paying ≥ 30% of income on rent  
  Formula: `(B25070_007E + B25070_008E + B25070_009E + B25070_010E) / B25070_001E`
- **Median Household Income** — `B19013_001E`
- **Median Gross Rent** — `B25064_001E`
- **Rent Pressure Index** — `median_gross_rent / ((0.30 × median_hh_income) / 12)`

### Interpretation
| Rent Pressure Index | Interpretation |
|---|---|
| ≥ 1.15 | Severely rent-burdened market |
| ≥ 1.00 | Rent exceeds 30% rule for median household |
| ≥ 0.90 | Approaching affordability stress |
| < 0.90 | Relatively affordable |

---

## 4. Housing Supply & Vacancy Section

- **Vacancy Rate** — derived from `B25004_001E` (vacant units) / (`B25003_001E` occupied + `B25004_001E` vacant)
- **Renter Households** — `B25003_003E`

### Vacancy Bands
| Vacancy Rate | Supply Constraint Signal |
|---|---|
| < 3% | Very tight; high constraint |
| 3–5% | Tight; moderate constraint |
| 5–8% | Balanced |
| > 8% | Loose; lower constraint |

---

## 5. Affordable Inventory Section

- **Source:** HUD LIHTC public dataset (`data/market/hud_lihtc_co.geojson`)
- Counts projects and total affordable units within selected geography
- Displayed as map overlay and summary cards
- **Limitation:** LIHTC dataset has a lag; does not capture PBRA or public housing without additional data

---

## 6. Capture / Penetration Analysis

Uses PMA scoring engine formulas (see `PMA_SITE_SELECTION.md`).

**Capture Rate** = `(existing_affordable_units + proposed_units) / qualified_renter_households`

Where `qualified_renter_households` = renter households × 0.30 (crude 30%-cost-burden proxy).

**Penetration Proxy** = `(existing_affordable_units + proposed_units) / (0.70 × renter_households)`

### Thresholds
| Capture Rate | Signal |
|---|---|
| < 12% | Low; favorable market |
| 12–15% | Acceptable |
| 15–20% | Monitor; moderate risk |
| 20–25% | High risk |
| ≥ 25% | Very high risk; market may not absorb |

---

## 7. Policy Section

- **Source:** `data/policy/prop123_jurisdictions.json` (local, no API call)
- Shows count of Prop 123 committed jurisdictions within selected geography
- Map overlay of committed municipalities and counties

---

## 8. Export Functionality

Users can export the current geography summary as:
- **JSON** — Full summary object with all metrics
- **CSV** — Key metrics in tabular format suitable for Excel

---

## 9. Data Limitations & Caveats

1. **ACS 5-year estimates** cover 2018–2022 (latest available vintage at build time). Refresh via `scripts/market/build_public_market_data.py`.
2. **Placeholder seed data** ships with 20 representative Colorado tracts. Production builds should run the build pipeline to populate all ~1,000+ Colorado tracts.
3. **HUD LIHTC** snapshot captures projects allocated through the latest available year; does not include pending allocations.
4. **Prop 123** list is manually curated; may not reflect real-time commitment status.
5. **All analysis is indicative**, not regulatory. Use certified market studies for tax credit applications.

---

## 10. Offline Operation

All sections function without live API calls when data artifacts are present:
- `data/market/acs_tract_metrics_co.json`
- `data/market/tract_centroids_co.json`
- `data/market/hud_lihtc_co.geojson`
- `data/policy/prop123_jurisdictions.json`

To refresh: run `python scripts/market/build_public_market_data.py` or trigger the GitHub Actions workflow `market_data_build.yml`.
