<!-- sync-banner:start -->
> **⚠️ Superseded** — See [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md) for the authoritative data source audit.  
> *Auto-synced 2026-04-09 by `scripts/sync-docs.mjs` · 38 pages · 883 data files · 38 workflows*
<!-- sync-banner:end -->

> **Note:** For the authoritative and most current data source audit, see [`SITE_AUDIT_GIS.md`](SITE_AUDIT_GIS.md).

# Data Sources Audit

**Repository:** pggLLC/Housing-Analytics  
**Last updated:** 2026-03

This document inventories every external data source referenced in the codebase, notes which files use them, and identifies relevant sources that are not yet integrated.

---

## 1. Sources Already Implemented

### 1.1 Census API (api.census.gov)

| Source URL pattern | Files that use it | What it provides |
|---|---|---|
| `https://api.census.gov/data/…/acs/acs5` | `js/acs-data-loader.js`, `js/census-stats.js`, `scripts/hna/acs_etl.py`, `scripts/fetch_census_state_hna.py`, `scripts/build_market_data.py` | ACS 5-year tract/county estimates: tenure, rent, income, vacancy, cost-burden |
| `https://api.census.gov/data/…/acs/acs1` | `js/api-integrations.js` | ACS 1-year metro/state estimates |
| `https://api.census.gov/data/…/pep/population` | `js/housing-needs-assessment.js` | Census Population Estimates Program |
| Census TIGERweb ArcGIS REST | `js/prop123-map.js`, `js/co-lihtc-map.js`, `scripts/build_market_data.py` | Tract/county/place geometries and centroids |

**Key ACS table codes used:**
- `B25003` — housing tenure (owner/renter)
- `B25064` — median gross rent
- `B25070` — gross rent as % of household income (cost burden)
- `B19013` — median household income
- `B01003` — total population
- `B08301` — means of transportation to work (commute mode share)

### 1.2 HUD eGIS / ArcGIS FeatureServer

| URL | Files | What it provides |
|---|---|---|
| `services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer` | `js/co-lihtc-map.js`, `js/data-service.js`, `scripts/build_market_data.py` | HUD LIHTC project locations for Colorado |
| `services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer` | `js/co-lihtc-map.js`, `js/data-service.js` | CHFA LIHTC FeatureServer (all layers) |
| `hudgis.hud.opendata.arcgis.com/…/QCT` | `js/housing-needs-assessment.js`, `js/co-lihtc-map.js` | Qualified Census Tracts |
| `hudgis.hud.opendata.arcgis.com/…/DDA` | `js/housing-needs-assessment.js`, `js/co-lihtc-map.js` | Difficult Development Areas |
| `services.arcgis.com/…/OZ` | `js/data-service-portable.js` | Opportunity Zones |

### 1.3 HUD User API (huduser.gov)

| URL | Files | What it provides |
|---|---|---|
| `https://www.huduser.gov/hudapi/public/fmr/…` | `scripts/fetch_fmr_api.py` | Fair Market Rents by county/metro |
| `https://www.huduser.gov/hudapi/public/income/…` | `scripts/fetch_fmr_api.py` | HUD Income Limits (30%/50%/80% AMI) |

> **Credential requirement:** HUD User API requires a free API token. Set `HUD_API_TOKEN` environment variable before running `scripts/fetch_fmr_api.py`.

### 1.4 HUD CHAS (Comprehensive Housing Affordability Strategy)

| URL | Files | What it provides |
|---|---|---|
| `https://www.huduser.gov/portal/datasets/cp.html` (bulk download) | `scripts/fetch_chas.py` | Income/cost-burden cross-tabulations by tenure, race, family type |

**Status:** `scripts/fetch_chas.py` downloads the CHAS CSV archive and converts it to `data/chas_co.json`. The output file is not yet consumed by any dashboard — integration is a future enhancement.

### 1.5 NHPD (National Housing Preservation Database)

| URL | Files | What it provides |
|---|---|---|
| `https://preservationdatabase.org` | `scripts/fetch_nhpd.py` | Subsidised housing properties including expiring affordability |

**Status:** `scripts/fetch_nhpd.py` fetches the public API. Output is `data/nhpd_co.json`. No dashboard integration yet.

### 1.6 FRED (Federal Reserve Bank of St. Louis)

| URL | Files | What it provides |
|---|---|---|
| `https://fred.stlouisfed.org/graph/fredgraph.csv?id=…` | `js/temporal-dashboard.js`, `js/fred-cards.js`, `js/fred-kpi-cards.js` | Mortgage rates, CPI, unemployment, housing starts |

Cached locally in `data/fred-data.json` by `.github/workflows/fetch-fred-data.yml`.

### 1.7 Colorado-specific sources

| Source | Files | What it provides |
|---|---|---|
| CHFA ArcGIS FeatureServer | `js/data-service.js`, `js/co-lihtc-map.js` | Colorado LIHTC projects (most current) |
| CAR (Colorado Association of Realtors) | `scripts/fetch-car-data.js` | Monthly market reports |
| DOLA SYA (State Demography Office) | `data/dola_sya/` | Single-year age pyramids by county |

---

## 2. Sources Not Yet Integrated

### 2.1 HUD LIHTC Historical Database (lihtc.huduser.gov)

The HUD LIHTC database spans 1987–present at the project level.

**Gap:** The current implementation uses the live ArcGIS FeatureServer for recent projects. The full historical database (CSV download) is not yet fetched or cached.

**Recommended approach:**
```python
# Example: download HUD LIHTC CSV for Colorado
import urllib.request, csv, json

URL = "https://lihtc.huduser.gov/api/lihtc.csv?state=CO"
# Or use the HUD API (free key required):
# https://www.huduser.gov/hudapi/public/lihtcpub?state=CO&limit=500&offset=0
with urllib.request.urlopen(URL, timeout=60) as resp:
    rows = list(csv.DictReader(resp.read().decode().splitlines()))
print(f"Downloaded {len(rows)} CO LIHTC projects from HUD")
```

### 2.2 HUD CHAS — Dashboard Integration

`scripts/fetch_chas.py` downloads CHAS data but it is not yet visualised.  
The `housing-needs-assessment.html` cost-burden section would benefit from CHAS cross-tabulations by race, income tier, and tenure.

### 2.3 BLS Local Area Unemployment Statistics (LAUS)

State/county unemployment and labour-force participation rates at monthly frequency.

```python
import urllib.request, json

# BLS Public Data API v2 (no key required for <= 50 series/day)
URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
payload = json.dumps({
    "seriesid": ["LAUCN080010000000003"],  # CO Adams County unemployment
    "startyear": "2020", "endyear": "2025"
}).encode()
req = urllib.request.Request(URL, data=payload,
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read())
```

### 2.4 HUD Multifamily Assisted Housing (LIHTC Allocation Tracker)

Annual LIHTC allocation tracking by state is available at:  
`https://www.huduser.gov/portal/datasets/lihtc.html`

This includes awarded units, project counts, and unit mix — more granular than the IRS per-capita authority used in the current historical files.

### 2.5 Colorado DOLA Population Projections (full series)

Full county-level population projections through 2050 are available from the Colorado State Demography Office via their public data API, but only partial files are currently in `data/dola_sya/`.

---

## 3. Summary Table

| Source | Implemented? | Dashboard integration | Notes |
|---|---|---|---|
| Census ACS (api.census.gov) | ✅ | HNA, Market Analysis | Tract + county |
| Census TIGERweb geometries | ✅ | Maps | Tracts, counties, places |
| HUD eGIS / LIHTC FeatureServer | ✅ | LIHTC map, HNA overlays | |
| HUD QCT / DDA | ✅ | HNA, LIHTC map | |
| HUD FMR API | ✅ scripts only | ❌ not shown | Needs UI integration |
| HUD CHAS | ✅ scripts only | ❌ not shown | Needs UI integration |
| NHPD | ✅ scripts only | ❌ not shown | Needs UI integration |
| FRED | ✅ | Economic Dashboard | Cached JSON |
| CHFA ArcGIS | ✅ | LIHTC map | Primary CO source |
| CAR market reports | ✅ | Deep Dive | Monthly, manual fetch |
| HUD LIHTC historical (CSV) | ❌ | ❌ | Future enhancement |
| BLS LAUS | ❌ | ❌ | Future enhancement |
| HUD Multifamily Allocation Tracker | ❌ | ❌ | Future enhancement |
| CO DOLA projections (full series) | partial | HNA | Partial files only |
