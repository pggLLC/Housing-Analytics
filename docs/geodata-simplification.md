# Geodata simplification inventory

This inventory records the source schemas and runtime dependencies for the
large browser-delivered GeoJSON layers. Simplification must retain every
feature, preserve polygon topology, and preserve the fields listed as retained.
Sizes are the tracked-file sizes before Sprint 3A simplification.

| Layer | Before | Features | Source property fields | Runtime consumers and retained fields | Generator / committing workflow |
|---|---:|---:|---|---|---|
| `transit_routes_co.geojson` | 47,360,222 B | 1,703 | `agency`, `agency_id`, `route_name`, `route_type`, `shape_id` | `market-analysis.js` `LAYER_CONFIG.transit`; `data-service-portable.js` scoring reads `agency`, `route_type`, `shape_id`. Retain those three fields. | `scripts/market/fetch_gtfs_transit.py`; `.github/workflows/fetch-parcel-zoning-data.yml` and `scripts/market/build_public_market_data.py` via `.github/workflows/market_data_build.yml`. |
| `natural_barriers_co.geojson` | 29,087,494 B | 43,599 | `aadt`, `area_sqm`, `barrier_type`, `county_fips`, `linear_id`, `mtfcc`, `name`, `route`, `route_sign`, `source`, `source_route_sign`, `speed_limit`, `sub_type` | `market-analysis.js` `LAYER_CONFIG.barriers`; `pma-barriers.js`, `pma-barrier-aware.js`, and regression guards read `barrier_type`, `sub_type`, `name`, `route`, `route_sign`, `aadt`. Retain those six fields. | `scripts/market/fetch_natural_barriers.py`; no committing workflow currently invokes this generator directly. |
| `flood_zones_co.geojson` | 28,563,340 B | 12,537 | `FLD_ZONE`, `risk_category`, `sfha` | `market-analysis.js` `LAYER_CONFIG.flood` and environmental screening read `FLD_ZONE` and `sfha`; retain all three source fields for disclosure. | `scripts/market/fetch_flood_zones.py`; `scripts/market/build_public_market_data.py` via `.github/workflows/market_data_build.yml`. |
| `tract_boundaries_co.geojson` | 17,250,210 B | 1,447 | `AREALAND`, `AREAWATER`, `BASENAME`, `COUNTY`, `GEOID`, `INTPTLAT`, `INTPTLON`, `NAME`, `STATE`, `TRACT` | Not a `LAYER_CONFIG` toggle: `pma-tract-picker.js`, `colorado-deep-dive.js`, PMA display-geometry and developable-land builders consume it. Runtime identity requires `GEOID`; downstream builders also read `AREALAND` and `AREAWATER`. Retain those three fields. | `scripts/market/build_public_market_data.py`; `.github/workflows/market_data_build.yml` (including its bbox-fix job). |
| `opportunity_zones_co.geojson` | 10,606,819 B | 126 | `county_fips`, `county_name`, `designated`, `geoid`, `oz_type`, `source_vintage`, `state_fips` | `market-analysis.js` `LAYER_CONFIG.opportunities` (configured ArcGIS primary); Opportunity Finder and HNA use `county_fips`, `designated`, `geoid`. Retain those three fields. | `scripts/market/fetch_opportunity_zones.py`; `.github/workflows/fetch-parcel-zoning-data.yml` and `scripts/market/build_public_market_data.py` via `.github/workflows/market_data_build.yml`. |
| `landuse_zoning_proxy_co.geojson` | 7,185,121 B | 28,715 | `building`, `landuse`, `levels`, `mf_suitability`, `name`, `osm_id`, `osm_type`, `zone_proxy` | `market-analysis.js` `LAYER_CONFIG.parcelZoning` and `data-connectors/regrid-zoning.js` read `zone_proxy`, `mf_suitability`, `name`, `building`, `levels`. Retain those five fields. | `scripts/market/build_osm_landuse.py`; no committing workflow currently invokes this generator directly. |
| `cdphe_county_boundaries_co.geojson` | 5,999,267 B | 64 | `CENT_LAT`, `CENT_LONG`, `CNTY_FIPS`, `COUNTY`, `FULL`, `LABEL`, `NUM_FIPS`, `OBJECTID`, `US_FIPS`, `county_fips5`, `county_name` | Independent validation layer rather than a `market-analysis.js` `LAYER_CONFIG` toggle. Tests require county identity/count; retain `county_fips5` and `county_name`. | `scripts/market/fetch_cdphe_county_boundaries.py`; `.github/workflows/fetch-cdphe-boundaries.yml`. |

Top-level `meta`/`metadata` provenance objects are preserved by the wrapper even
though mapshaper operates on the FeatureCollection geometry and properties.
Simplification settings and measured results are recorded by the wrapper so the
same command can be used in refresh pipelines.

## Sprint 3A results

| Layer | Setting | After | Features retained |
|---|---:|---:|---:|
| Transit routes | 1.5%, no intersection repair | 4,878,138 B | 1,703 / 1,703 |
| Natural barriers | 5% | 10,799,317 B | 43,599 / 43,599 |
| Flood zones | 5% | 6,136,866 B | 12,537 / 12,537 |
| Tract boundaries | 20% | 3,501,244 B | 1,447 / 1,447 |
| Opportunity zones | 20% | 851,407 B | 126 / 126 |
| Land-use zoning proxy | 100% (point coordinates unchanged) | 4,902,125 B | 28,715 / 28,715 |
| CDPHE county boundaries | 20% | 1,186,881 B | 64 / 64 |

Mapshaper rejected 846 already-degenerate natural-barrier geometries and 5,694
flood geometries. The wrapper restored those source geometries verbatim rather
than removing their features. That feature-preservation requirement sets the
current 10.80 MB and 6.14 MB floors for those two layers; the CI guard gives
them explicit temporary ceilings instead of silently accepting arbitrary
growth.

The scheduled parcel/zoning, market-data, and CDPHE workflows run these same
commands only when their generator changes a target. `natural_barriers_co` and
`landuse_zoning_proxy_co` have no committing or scheduled generator today, so
there is no cron path to update; future automation for either file must invoke
the wrapper before committing.
