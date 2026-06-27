# HNA Commuter Score Re-rank Face-Validity Report

Generated for draft PR review on 2026-06-27. This compares `HEAD:data/hna/ranking-index.json` to the regenerated index on this branch.

## Scoring Change

- Percentile pools for `housing_gap_units`, `pct_cost_burdened`, and commuter pressure now run within `county`, `place`, and `cdp` groups instead of one mixed statewide pool.
- The headline weights remain 50/30/20.
- The 20% commuter term is now `0.5 * pctile(in_commuters) + 0.5 * pctile(commute_ratio)`, with both percentiles type-scoped.
- `commuter_pressure_score` is materialized in each ranking entry for reviewability.

## Summary

| Type | Entries | Moved >50 ranks |
| --- | --- | --- |
| county | 64 | 0 |
| place | 273 | 0 |
| cdp | 210 | 0 |

## Face-Validity Spot Checks

| New rank | Old rank | Δ rank | GEOID | Name | Type | New score | Old score | 30% gap | Cost burden % | In commuters | Commute ratio % | Commuter pressure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 210 | 210 | +0 | 0870195 | Silt (town) | place | 56.5 | 56.5 | 157 | 51.2 | 443 | 84.7 | 45.2 |
| 67 | 67 | +0 | 0820000 | Denver (city) | place | 75.8 | 75.8 | 46,291 | 49.5 | 381,335 | 69.9 | 58.8 |
| 43 | 43 | +0 | 08031 | Denver County | county | 78.9 | 78.9 | 15,979 | 49.5 | 381,335 | 69.9 | 97.6 |
| 6 | 6 | +0 | 0877290 | Thornton (city) | place | 85.6 | 85.6 | 5,524 | 67.8 | 31,420 | 81.7 | 63.8 |
| 33 | 33 | +0 | 0804000 | Aurora (city) | place | 81.1 | 81.1 | 24,026 | 57.0 | 120,994 | 74.5 | 60.3 |
| 8 | 8 | +0 | 0807850 | Boulder (city) | place | 85.1 | 85.1 | 10,622 | 63.4 | 73,952 | 81.4 | 64.3 |
| 65 | 65 | +0 | 0832155 | Greeley (city) | place | 76.3 | 76.3 | 6,293 | 54.1 | 26,657 | 59.8 | 50.5 |
| 34 | 34 | +0 | 0843000 | Lakewood (city) | place | 81.0 | 81.0 | 9,928 | 54.3 | 79,221 | 85.0 | 69.3 |

Notes: Silt rises modestly while retaining the count constraint; Denver city drops but stays well inside the top 100 overall; Denver County remains a high-need county and does not collapse.

## Top 20 Places Before

| New rank | Old rank | Δ rank | GEOID | Name | Type | New score | Old score | 30% gap | Cost burden % | In commuters | Commute ratio % | Commuter pressure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 5 | +0 | 0826270 | Federal Heights (city) | place | 85.7 | 85.7 | 1,515 | 67.3 | 2,551 | 96.1 | 78.3 |
| 6 | 6 | +0 | 0877290 | Thornton (city) | place | 85.6 | 85.6 | 5,524 | 67.8 | 31,420 | 81.7 | 63.8 |
| 8 | 8 | +0 | 0807850 | Boulder (city) | place | 85.1 | 85.1 | 10,622 | 63.4 | 73,952 | 81.4 | 64.3 |
| 14 | 14 | +0 | 0827865 | Fountain (city) | place | 83.8 | 83.8 | 1,457 | 71.0 | 6,046 | 84.9 | 62.4 |
| 17 | 17 | +0 | 0857630 | Parker (town) | place | 83.5 | 83.5 | 1,779 | 65.5 | 20,639 | 87.7 | 68.5 |
| 19 | 19 | +0 | 0854330 | Northglenn (city) | place | 83.3 | 83.3 | 1,916 | 61.6 | 8,661 | 92.4 | 75.5 |
| 21 | 21 | +0 | 0804110 | Avon (town) | place | 83.0 | 83.0 | 521 | 71.7 | 6,935 | 94.4 | 78.7 |
| 25 | 25 | +0 | 0846465 | Loveland (city) | place | 82.5 | 82.5 | 5,439 | 62.4 | 28,738 | 77.8 | 59.6 |
| 26 | 26 | +0 | 0845255 | Littleton (city) | place | 82.4 | 82.4 | 3,014 | 57.2 | 30,329 | 92.3 | 78.1 |
| 32 | 32 | +0 | 0869645 | Sheridan (city) | place | 81.2 | 81.2 | 486 | 65.1 | 7,815 | 98.8 | 87.3 |
| 33 | 33 | +0 | 0804000 | Aurora (city) | place | 81.1 | 81.1 | 24,026 | 57.0 | 120,994 | 74.5 | 60.3 |
| 34 | 34 | +0 | 0843000 | Lakewood (city) | place | 81.0 | 81.0 | 9,928 | 54.3 | 79,221 | 85.0 | 69.3 |
| 35 | 35 | +0 | 0827425 | Fort Collins (city) | place | 80.7 | 80.7 | 11,853 | 59.2 | 48,393 | 58.9 | 51.8 |
| 36 | 36 | +0 | 0824785 | Englewood (city) | place | 80.6 | 80.6 | 2,487 | 53.5 | 24,725 | 94.9 | 83.1 |
| 40 | 40 | +0 | 0884440 | Wheat Ridge (city) | place | 79.5 | 79.5 | 2,597 | 52.5 | 18,501 | 94.6 | 81.8 |
| 41 | 41 | +0 | 0885485 | Windsor (town) | place | 79.3 | 79.3 | 1,109 | 62.6 | 7,992 | 81.4 | 59.8 |
| 42 | 42 | +0 | 0845970 | Longmont (city) | place | 79.2 | 79.2 | 6,374 | 57.6 | 26,433 | 67.9 | 54.6 |
| 44 | 44 | +0 | 0803620 | Aspen (city) | place | 78.7 | 78.7 | 805 | 67.6 | 7,028 | 73.5 | 53.5 |
| 46 | 46 | +0 | 0816000 | Colorado Springs (city) | place | 78.4 | 78.4 | 26,927 | 54.6 | 103,081 | 45.5 | 50.8 |
| 49 | 49 | +0 | 0841835 | Lafayette (city) | place | 78.3 | 78.3 | 1,618 | 54.4 | 12,240 | 90.5 | 71.7 |

## Top 20 Places After

| New rank | Old rank | Δ rank | GEOID | Name | Type | New score | Old score | 30% gap | Cost burden % | In commuters | Commute ratio % | Commuter pressure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | 5 | +0 | 0826270 | Federal Heights (city) | place | 85.7 | 85.7 | 1,515 | 67.3 | 2,551 | 96.1 | 78.3 |
| 6 | 6 | +0 | 0877290 | Thornton (city) | place | 85.6 | 85.6 | 5,524 | 67.8 | 31,420 | 81.7 | 63.8 |
| 8 | 8 | +0 | 0807850 | Boulder (city) | place | 85.1 | 85.1 | 10,622 | 63.4 | 73,952 | 81.4 | 64.3 |
| 14 | 14 | +0 | 0827865 | Fountain (city) | place | 83.8 | 83.8 | 1,457 | 71.0 | 6,046 | 84.9 | 62.4 |
| 17 | 17 | +0 | 0857630 | Parker (town) | place | 83.5 | 83.5 | 1,779 | 65.5 | 20,639 | 87.7 | 68.5 |
| 19 | 19 | +0 | 0854330 | Northglenn (city) | place | 83.3 | 83.3 | 1,916 | 61.6 | 8,661 | 92.4 | 75.5 |
| 21 | 21 | +0 | 0804110 | Avon (town) | place | 83.0 | 83.0 | 521 | 71.7 | 6,935 | 94.4 | 78.7 |
| 25 | 25 | +0 | 0846465 | Loveland (city) | place | 82.5 | 82.5 | 5,439 | 62.4 | 28,738 | 77.8 | 59.6 |
| 26 | 26 | +0 | 0845255 | Littleton (city) | place | 82.4 | 82.4 | 3,014 | 57.2 | 30,329 | 92.3 | 78.1 |
| 32 | 32 | +0 | 0869645 | Sheridan (city) | place | 81.2 | 81.2 | 486 | 65.1 | 7,815 | 98.8 | 87.3 |
| 33 | 33 | +0 | 0804000 | Aurora (city) | place | 81.1 | 81.1 | 24,026 | 57.0 | 120,994 | 74.5 | 60.3 |
| 34 | 34 | +0 | 0843000 | Lakewood (city) | place | 81.0 | 81.0 | 9,928 | 54.3 | 79,221 | 85.0 | 69.3 |
| 35 | 35 | +0 | 0827425 | Fort Collins (city) | place | 80.7 | 80.7 | 11,853 | 59.2 | 48,393 | 58.9 | 51.8 |
| 36 | 36 | +0 | 0824785 | Englewood (city) | place | 80.6 | 80.6 | 2,487 | 53.5 | 24,725 | 94.9 | 83.1 |
| 40 | 40 | +0 | 0884440 | Wheat Ridge (city) | place | 79.5 | 79.5 | 2,597 | 52.5 | 18,501 | 94.6 | 81.8 |
| 41 | 41 | +0 | 0885485 | Windsor (town) | place | 79.3 | 79.3 | 1,109 | 62.6 | 7,992 | 81.4 | 59.8 |
| 42 | 42 | +0 | 0845970 | Longmont (city) | place | 79.2 | 79.2 | 6,374 | 57.6 | 26,433 | 67.9 | 54.6 |
| 44 | 44 | +0 | 0803620 | Aspen (city) | place | 78.7 | 78.7 | 805 | 67.6 | 7,028 | 73.5 | 53.5 |
| 46 | 46 | +0 | 0816000 | Colorado Springs (city) | place | 78.4 | 78.4 | 26,927 | 54.6 | 103,081 | 45.5 | 50.8 |
| 49 | 49 | +0 | 0841835 | Lafayette (city) | place | 78.3 | 78.3 | 1,618 | 54.4 | 12,240 | 90.5 | 71.7 |

## Top 20 Counties Before

| New rank | Old rank | Δ rank | GEOID | Name | Type | New score | Old score | 30% gap | Cost burden % | In commuters | Commute ratio % | Commuter pressure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | +0 | 08001 | Adams County | county | 89.2 | 89.2 | 18,252 | 56.5 | 166,606 | 69.1 | 95.2 |
| 2 | 2 | +0 | 08005 | Arapahoe County | county | 88.9 | 88.9 | 23,437 | 53.8 | 228,413 | 67.8 | 95.2 |
| 4 | 4 | +0 | 08069 | Larimer County | county | 85.7 | 85.7 | 15,337 | 57.9 | 59,210 | 39.3 | 71.5 |
| 7 | 7 | +0 | 08013 | Boulder County | county | 85.1 | 85.1 | 11,433 | 56.8 | 107,946 | 58.5 | 88.1 |
| 9 | 9 | +0 | 08059 | Jefferson County | county | 84.9 | 84.9 | 28,514 | 51.7 | 155,760 | 62.7 | 91.2 |
| 28 | 28 | +0 | 08035 | Douglas County | county | 81.6 | 81.6 | 19,037 | 51.0 | 90,140 | 65.5 | 91.3 |
| 29 | 29 | +0 | 08041 | El Paso County | county | 81.6 | 81.6 | 27,429 | 54.4 | 67,829 | 24.8 | 50.0 |
| 43 | 43 | +0 | 08031 | Denver County | county | 78.9 | 78.9 | 15,979 | 49.5 | 381,335 | 69.9 | 97.6 |
| 45 | 45 | +0 | 08123 | Weld County | county | 78.4 | 78.4 | 12,878 | 52.4 | 44,786 | 43.0 | 74.6 |
| 53 | 53 | +0 | 08037 | Eagle County | county | 77.2 | 77.2 | 1,593 | 64.7 | 14,082 | 45.2 | 73.0 |
| 73 | 73 | +0 | 08101 | Pueblo County | county | 75.1 | 75.1 | 6,368 | 53.8 | 16,090 | 28.9 | 51.5 |
| 114 | 114 | +0 | 08029 | Delta County | county | 70.5 | 70.5 | 1,866 | 57.4 | 2,449 | 35.0 | 47.6 |
| 116 | 116 | +0 | 08015 | Chaffee County | county | 70.1 | 70.1 | 1,192 | 59.7 | 3,005 | 36.1 | 54.8 |
| 118 | 118 | +0 | 08119 | Teller County | county | 69.4 | 69.4 | 1,653 | 54.6 | 3,468 | 45.6 | 65.9 |
| 137 | 137 | +0 | 08077 | Mesa County | county | 67.4 | 67.4 | 6,000 | 51.8 | 12,415 | 20.1 | 41.3 |
| 139 | 139 | +0 | 08067 | La Plata County | county | 67.2 | 67.2 | 2,510 | 52.7 | 4,564 | 21.1 | 37.3 |
| 146 | 146 | +0 | 08014 | Broomfield County | county | 66.2 | 66.2 | 3,171 | 42.2 | 36,699 | 88.7 | 92.8 |
| 158 | 158 | +0 | 08097 | Pitkin County | county | 64.5 | 64.5 | 1,055 | 53.3 | 9,682 | 58.6 | 80.9 |
| 159 | 159 | +0 | 08083 | Montezuma County | county | 64.4 | 64.4 | 1,745 | 56.9 | 1,618 | 21.4 | 26.2 |
| 161 | 161 | +0 | 08087 | Morgan County | county | 64.0 | 64.0 | 2,238 | 51.3 | 3,938 | 32.9 | 52.3 |

## Top 20 Counties After

| New rank | Old rank | Δ rank | GEOID | Name | Type | New score | Old score | 30% gap | Cost burden % | In commuters | Commute ratio % | Commuter pressure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | +0 | 08001 | Adams County | county | 89.2 | 89.2 | 18,252 | 56.5 | 166,606 | 69.1 | 95.2 |
| 2 | 2 | +0 | 08005 | Arapahoe County | county | 88.9 | 88.9 | 23,437 | 53.8 | 228,413 | 67.8 | 95.2 |
| 4 | 4 | +0 | 08069 | Larimer County | county | 85.7 | 85.7 | 15,337 | 57.9 | 59,210 | 39.3 | 71.5 |
| 7 | 7 | +0 | 08013 | Boulder County | county | 85.1 | 85.1 | 11,433 | 56.8 | 107,946 | 58.5 | 88.1 |
| 9 | 9 | +0 | 08059 | Jefferson County | county | 84.9 | 84.9 | 28,514 | 51.7 | 155,760 | 62.7 | 91.2 |
| 28 | 28 | +0 | 08035 | Douglas County | county | 81.6 | 81.6 | 19,037 | 51.0 | 90,140 | 65.5 | 91.3 |
| 29 | 29 | +0 | 08041 | El Paso County | county | 81.6 | 81.6 | 27,429 | 54.4 | 67,829 | 24.8 | 50.0 |
| 43 | 43 | +0 | 08031 | Denver County | county | 78.9 | 78.9 | 15,979 | 49.5 | 381,335 | 69.9 | 97.6 |
| 45 | 45 | +0 | 08123 | Weld County | county | 78.4 | 78.4 | 12,878 | 52.4 | 44,786 | 43.0 | 74.6 |
| 53 | 53 | +0 | 08037 | Eagle County | county | 77.2 | 77.2 | 1,593 | 64.7 | 14,082 | 45.2 | 73.0 |
| 73 | 73 | +0 | 08101 | Pueblo County | county | 75.1 | 75.1 | 6,368 | 53.8 | 16,090 | 28.9 | 51.5 |
| 114 | 114 | +0 | 08029 | Delta County | county | 70.5 | 70.5 | 1,866 | 57.4 | 2,449 | 35.0 | 47.6 |
| 116 | 116 | +0 | 08015 | Chaffee County | county | 70.1 | 70.1 | 1,192 | 59.7 | 3,005 | 36.1 | 54.8 |
| 118 | 118 | +0 | 08119 | Teller County | county | 69.4 | 69.4 | 1,653 | 54.6 | 3,468 | 45.6 | 65.9 |
| 137 | 137 | +0 | 08077 | Mesa County | county | 67.4 | 67.4 | 6,000 | 51.8 | 12,415 | 20.1 | 41.3 |
| 139 | 139 | +0 | 08067 | La Plata County | county | 67.2 | 67.2 | 2,510 | 52.7 | 4,564 | 21.1 | 37.3 |
| 146 | 146 | +0 | 08014 | Broomfield County | county | 66.2 | 66.2 | 3,171 | 42.2 | 36,699 | 88.7 | 92.8 |
| 158 | 158 | +0 | 08097 | Pitkin County | county | 64.5 | 64.5 | 1,055 | 53.3 | 9,682 | 58.6 | 80.9 |
| 159 | 159 | +0 | 08083 | Montezuma County | county | 64.4 | 64.4 | 1,745 | 56.9 | 1,618 | 21.4 | 26.2 |
| 161 | 161 | +0 | 08087 | Morgan County | county | 64.0 | 64.0 | 2,238 | 51.3 | 3,938 | 32.9 | 52.3 |

## Entries Moving More Than 50 Overall Ranks

Total entries moving more than 50 ranks: 0.

### Counties

_None._

### Places

_None._

### CDPs

_None._
