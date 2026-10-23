# Jurisdiction Metrics Digest Coverage

Date: 2026-06-30

B1 metric-digest data spine generated from the committed HNA ranking index and per-geography summaries. This is non-scoring and does not rewrite `data/hna/ranking-index.json`.

- Digest files: 546
- Total tagged metrics: 81350
- County-context metric tags: 7134
- Rate metrics with denominator metadata: 15834
- Min denominator floor: 50

## Geography-Level Tags

| geography_level | metric tags |
|---|---:|
| county | 9024 |
| county_context | 7134 |
| place | 65192 |

## Source Tags

| source_id | metric tags |
|---|---:|
| acs-b25003 | 546 |
| acs-b25075 | 1638 |
| acs-grapi-and-hud-chas-blend | 546 |
| acs-profile | 9828 |
| acs-profile-dp02 | 1092 |
| acs-profile-dp04 | 1088 |
| acs-profile-dp04-grapi | 546 |
| acs-profile-dp05 | 1092 |
| ami-gap-county-acs | 516 |
| ami-gap-place-acs | 3852 |
| chfa-2026-r1-awards | 546 |
| chfa-lihtc-and-2026-r1-awards | 2184 |
| chfa-lihtc-properties | 10370 |
| county-housing-cost-trends-acs-cohorts | 2730 |
| dola-demographic-projections | 2194 |
| dola-projections-plus-lodes-incommuters | 536 |
| economic-housing-bridge | 4368 |
| hna-affordable-ownership-need | 6552 |
| hna-ranking-index-derived | 12558 |
| hud-chas-county | 768 |
| hud-chas-place-apportioned | 5784 |
| hud-qct-dda | 1638 |
| lehd-lodes-county | 738 |
| lehd-lodes-county-earnings-bin-estimate | 546 |
| lehd-lodes-place-apportioned | 1446 |
| lehd-lodes-wac-county | 66 |
| lehd-lodes-wac-place | 480 |
| lodes-incommuters-acs-pums | 1638 |
| opportunity-amenity-context | 2730 |
| workforce-gap-renters-incommuters-vs-ami-gap | 2184 |
| zillow-zhvi-city-index | 540 |
| zillow-zhvi-county-adjusted | 10 |

## Notes

- `county_context` means the selected jurisdiction is a place/CDP but the metric is inherited from a county-level or county-apportioned source.
- Single-vintage ACS and source-cache values are tagged as `measure_type: level`, not trend.
- Future household/unit fields are tagged as `projection`; composite ranking fields are tagged as `derived`.
- B3 workforce-housing metrics are descriptive context only and do not change `data/hna/ranking-index.json`.
