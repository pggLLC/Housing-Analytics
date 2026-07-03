# Jurisdiction Metrics Digest Coverage

Date: 2026-06-30

B1 metric-digest data spine generated from the committed HNA ranking index and per-geography summaries. This is non-scoring and does not rewrite `data/hna/ranking-index.json`.

- Digest files: 547
- Total tagged metrics: 28991
- County-context metric tags: 1961
- Rate metrics with denominator metadata: 8752
- Min denominator floor: 50

## Geography-Level Tags

| geography_level | metric tags |
|---|---:|
| county | 3392 |
| county_context | 1961 |
| place | 23638 |

## Source Tags

| source_id | metric tags |
|---|---:|
| acs-profile | 6017 |
| acs-profile-dp04 | 556 |
| ami-gap-county-acs | 390 |
| ami-gap-place-acs | 2892 |
| dola-demographic-projections | 2188 |
| hna-ranking-index-derived | 4923 |
| hud-chas-county | 650 |
| hud-chas-place-apportioned | 4820 |
| hud-qct-dda | 1641 |
| lehd-lodes-county | 195 |
| lehd-lodes-place-apportioned | 1446 |
| opportunity-amenity-context | 2735 |
| zillow-zhvi-city-index | 528 |
| zillow-zhvi-county-adjusted | 10 |

## Notes

- `county_context` means the selected jurisdiction is a place/CDP but the metric is inherited from a county-level or county-apportioned source.
- Single-vintage ACS and source-cache values are tagged as `measure_type: level`, not trend.
- Future household/unit fields are tagged as `projection`; composite ranking fields are tagged as `derived`.
