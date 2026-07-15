# Jurisdiction Metrics Digest Coverage

Date: 2026-06-30

B1 metric-digest data spine generated from the committed HNA ranking index and per-geography summaries. This is non-scoring and does not rewrite `data/hna/ranking-index.json`.

- Digest files: 547
- Total tagged metrics: 54700
- County-context metric tags: 6308
- Rate metrics with denominator metadata: 15863
- Min denominator floor: 50

## Geography-Level Tags

| geography_level | metric tags |
|---|---:|
| county | 6016 |
| county_context | 6308 |
| place | 42376 |

## Source Tags

| source_id | metric tags |
|---|---:|
| acs-b25003 | 547 |
| acs-b25075 | 1641 |
| acs-profile | 9846 |
| acs-profile-dp02 | 1094 |
| acs-profile-dp04 | 1103 |
| acs-profile-dp05 | 1094 |
| ami-gap-county-acs | 390 |
| ami-gap-place-acs | 2892 |
| county-housing-cost-trends-acs-cohorts | 2735 |
| dola-demographic-projections | 2188 |
| economic-housing-bridge | 4376 |
| hna-affordable-ownership-need | 6564 |
| hna-ranking-index-derived | 4923 |
| hud-chas-county | 906 |
| hud-chas-place-apportioned | 6752 |
| hud-qct-dda | 1641 |
| lehd-lodes-county | 742 |
| lehd-lodes-county-earnings-bin-estimate | 547 |
| lehd-lodes-place-apportioned | 1446 |
| opportunity-amenity-context | 2735 |
| zillow-zhvi-city-index | 528 |
| zillow-zhvi-county-adjusted | 10 |

## Notes

- `county_context` means the selected jurisdiction is a place/CDP but the metric is inherited from a county-level or county-apportioned source.
- Single-vintage ACS and source-cache values are tagged as `measure_type: level`, not trend.
- Future household/unit fields are tagged as `projection`; composite ranking fields are tagged as `derived`.
- B3 workforce-housing metrics are descriptive context only and do not change `data/hna/ranking-index.json`.
