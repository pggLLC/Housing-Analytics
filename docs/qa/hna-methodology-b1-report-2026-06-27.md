# HNA Methodology B1 Face-Validity Report - 2026-06-27

Owner-gated draft. Baseline is `origin/main:data/hna/ranking-index.json` before Work Order A1/B1. Current output is regenerated from `scripts/hna/build_ranking_index.py` on branch `codex/hna-methodology-b1`.

## Method Change

B1 expands `overall_need_score` from three scored signals into five factor scores, all percentile-ranked within geography type (`county`, `place`, `cdp`):

- `gap_pressure_score` (35%): 50/50 blend of absolute 30% AMI unit gap and gap rate, where rate is `housing_gap_units / households <=30% AMI`. This avoids the rejected total-population per-capita inversion.
- `cost_burden_pressure_score` (25%): all-renter cost burden, severe renter burden, and deep-tier (`<=50% AMI`) burden.
- `affordability_intensity_score` (15%): median home value-to-income and median gross rent-to-income.
- `future_pressure_score` (15%): DOLA 20-year incremental unit need plus senior-share growth.
- `commuter_pressure_score` (10%): A1's count/ratio commuter blend.

Rates/ratios use a minimum denominator floor where available. Missing factors re-normalize around available inputs and are recorded in `dataQuality.imputed_score_factors`; approximated county inputs remain in `dataQuality.approximated_fields`. `score_confidence_multiplier` lightly down-weights those entries.

## Movement Summary

- Entries moving >50 ranks: 312 total (50 counties, 149 places, 113 CDPs).
- Entries marked `hasIncompleteData`: 305 / 547.
- Factor coverage: gap-rate 336/547, severe burden 515/547, deep-tier burden 248/547, home-value/income 450/547, rent/income 363/547, future units 537/547, senior growth 547/547.

## Spot Checks

| GEOID | Name | Type | Old rank/score | New rank/score | Move | Confidence | Notes |
|---|---|---|---:|---:|---:|---:|---|
| 0870195 | Silt (town) | place | 213 / 60.0 | 99 / 63.7 | +114 | 0.99 | gapScore 70.7; burden 60.7; afford 66.9; future 65.8; commute 45.2 |
| 0820000 | Denver (city) | place | 26 / 86.1 | 109 / 62.8 | -83 | 0.99 | gapScore 66.0; burden 49.5; afford 63.2; future 84.5; commute 58.8 |
| 08031 | Denver County | county | 32 / 85.3 | 106 / 62.9 | -74 | 0.98 | gapScore 46.8; burden 49.7; afford 88.1; future 82.6; commute 97.6 |
| 08059 | Jefferson County | county | 20 / 87.2 | 4 / 80.3 | +16 | 0.98 | gapScore 94.5; burden 68.7; afford 69.0; future 81.8; commute 91.2 |
| 08035 | Douglas County | county | 23 / 86.3 | 7 / 77.8 | +16 | 0.98 | gapScore 97.6; burden 63.3; afford 38.1; future 97.3; commute 91.3 |
| 0807850 | Boulder (city) | place | 2 / 92.2 | 2 / 82.7 | +0 | 0.99 | gapScore 82.0; burden 82.3; afford 92.8; future 92.9; commute 64.3 |
| 0826270 | Federal Heights (city) | place | 25 / 86.2 | 3 / 82.0 | +22 | 0.99 | gapScore 87.2; burden 78.3; afford 84.0; future 81.7; commute 78.3 |
| 0873825 | Steamboat Springs (city) | place | 44 / 83.3 | 8 / 76.9 | +36 | 0.99 | gapScore 83.6; burden 78.6; afford 79.7; future 81.3; commute 46.2 |
| 0850012 | Meridian (CDP) | cdp | 112 / 73.8 | 1 / 83.3 | +111 | 0.99 | gapScore 89.8; burden 75.1; afford 81.6; future 90.2; commute 81.3 |

## Top 20 Places - Before

| Rank | GEOID | Name | Score | Gap units | Cost burden % | In-commuters | Commute ratio |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 0877290 | Thornton (city) | 92.4 | 5524 | 67.8 | 31420 | 81.7 |
| 2 | 0807850 | Boulder (city) | 92.2 | 10622 | 63.4 | 73952 | 81.4 |
| 3 | 0827425 | Fort Collins (city) | 90.8 | 11853 | 59.2 | 48393 | 58.9 |
| 4 | 0846465 | Loveland (city) | 90.7 | 5439 | 62.4 | 28738 | 77.8 |
| 5 | 0804000 | Aurora (city) | 90.3 | 24026 | 57.0 | 120994 | 74.5 |
| 9 | 0816000 | Colorado Springs (city) | 89.3 | 26927 | 54.6 | 103081 | 45.5 |
| 10 | 0857630 | Parker (town) | 89.1 | 1779 | 65.5 | 20639 | 87.7 |
| 12 | 0827865 | Fountain (city) | 88.7 | 1457 | 71.0 | 6046 | 84.9 |
| 13 | 0845970 | Longmont (city) | 88.7 | 6374 | 57.6 | 26433 | 67.9 |
| 16 | 0843000 | Lakewood (city) | 87.9 | 9928 | 54.3 | 79221 | 85.0 |
| 17 | 0854330 | Northglenn (city) | 87.7 | 1916 | 61.6 | 8661 | 92.4 |
| 18 | 0862000 | Pueblo (city) | 87.7 | 8645 | 55.2 | 20006 | 49.0 |
| 19 | 0845255 | Littleton (city) | 87.6 | 3014 | 57.2 | 30329 | 92.3 |
| 21 | 0832155 | Greeley (city) | 86.6 | 6293 | 54.1 | 26657 | 59.8 |
| 25 | 0826270 | Federal Heights (city) | 86.2 | 1515 | 67.3 | 2551 | 96.1 |
| 26 | 0820000 | Denver (city) | 86.1 | 46291 | 49.5 | 381335 | 69.9 |
| 27 | 0885485 | Windsor (town) | 86.1 | 1109 | 62.6 | 7992 | 81.4 |
| 29 | 0812415 | Castle Rock (town) | 85.9 | 2085 | 56.6 | 18451 | 76.3 |
| 33 | 0803620 | Aspen (city) | 85.3 | 805 | 67.6 | 7028 | 73.5 |
| 34 | 0824785 | Englewood (city) | 84.9 | 2487 | 53.5 | 24725 | 94.9 |

## Top 20 Places - After

| Rank | GEOID | Name | Score | Gap units | Gap score | Burden score | Affordability score | Future score | Commute score |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2 | 0807850 | Boulder (city) | 82.7 | 10622 | 82.0 | 82.3 | 92.8 | 92.9 | 64.3 |
| 3 | 0826270 | Federal Heights (city) | 82.0 | 1515 | 87.2 | 78.3 | 84.0 | 81.7 | 78.3 |
| 6 | 0857630 | Parker (town) | 78.2 | 1779 | 89.4 | 78.3 | 44.1 | 97.6 | 68.5 |
| 8 | 0873825 | Steamboat Springs (city) | 76.9 | 821 | 83.6 | 78.6 | 79.7 | 81.3 | 46.2 |
| 10 | 0870525 | Silverthorne (town) | 76.8 | 230 | 84.5 | 91.4 | 53.1 | 74.9 | 59.5 |
| 11 | 0804000 | Aurora (city) | 76.4 | 24026 | 87.8 | 74.3 | 57.8 | 87.5 | 60.3 |
| 13 | 0877290 | Thornton (city) | 74.7 | 5524 | 80.6 | 75.2 | 57.9 | 89.5 | 63.8 |
| 14 | 0886090 | Woodland Park (city) | 74.6 | 370 | 88.2 | 78.4 | 60.9 | 70.7 | 51.5 |
| 16 | 0830835 | Golden (city) | 73.0 | 1157 | 76.0 | 66.7 | 77.1 | 71.5 | 81.5 |
| 17 | 0827425 | Fort Collins (city) | 72.9 | 11853 | 72.5 | 71.6 | 74.6 | 93.0 | 51.8 |
| 18 | 0845955 | Lone Tree (city) | 72.1 | 525 | 88.5 | 41.5 | 59.1 | 92.1 | 88.4 |
| 19 | 0837545 | Hotchkiss (town) | 72.0 | 94 | 74.3 | 90.1 | 86.7 | 58.2 | 47.1 |
| 23 | 0830340 | Glendale (city) | 71.7 | 490 | 74.3 | 70.5 | 62.8 | 70.0 | 88.4 |
| 24 | 0828360 | Frederick (town) | 71.4 | 290 | 82.7 | 69.1 | 40.2 | 84.4 | 71.7 |
| 25 | 0841835 | Lafayette (city) | 71.4 | 1618 | 76.1 | 69.1 | 53.2 | 86.9 | 71.7 |
| 26 | 0845255 | Littleton (city) | 71.4 | 3014 | 76.5 | 69.5 | 60.7 | 83.7 | 78.1 |
| 27 | 0855980 | Orchard City (town) | 71.3 | 213 | 74.0 | 84.4 | 73.6 | 65.3 | 42.1 |
| 29 | 0843000 | Lakewood (city) | 71.2 | 9928 | 73.5 | 66.8 | 68.4 | 82.3 | 69.3 |
| 30 | 0845970 | Longmont (city) | 71.2 | 6374 | 75.7 | 65.4 | 64.7 | 92.7 | 54.6 |
| 32 | 0812387 | Castle Pines (city) | 71.1 | 403 | 83.5 | 80.8 | 19.8 | 91.2 | 57.0 |

## Top 20 Counties - Before

| Rank | GEOID | Name | Score | Gap units | Cost burden % | In-commuters | Commute ratio |
|---:|---|---|---:|---:|---:|---:|---:|
| 6 | 08069 | Larimer County | 90.0 | 15337 | 57.9 | 59210 | 39.3 |
| 7 | 08001 | Adams County | 89.9 | 18252 | 56.5 | 166606 | 69.1 |
| 8 | 08013 | Boulder County | 89.4 | 11433 | 56.8 | 107946 | 58.5 |
| 11 | 08041 | El Paso County | 89.0 | 27429 | 54.4 | 67829 | 24.8 |
| 14 | 08005 | Arapahoe County | 88.4 | 23437 | 53.8 | 228413 | 67.8 |
| 15 | 08037 | Eagle County | 88.2 | 1593 | 64.7 | 14082 | 45.2 |
| 20 | 08059 | Jefferson County | 87.2 | 28514 | 51.7 | 155760 | 62.7 |
| 22 | 08123 | Weld County | 86.4 | 12878 | 52.4 | 44786 | 43.0 |
| 23 | 08035 | Douglas County | 86.3 | 19037 | 51.0 | 90140 | 65.5 |
| 28 | 08101 | Pueblo County | 86.0 | 6368 | 53.8 | 16090 | 28.9 |
| 32 | 08031 | Denver County | 85.3 | 15979 | 49.5 | 381335 | 69.9 |
| 36 | 08077 | Mesa County | 84.1 | 6000 | 51.8 | 12415 | 20.1 |
| 41 | 08015 | Chaffee County | 83.7 | 1192 | 59.7 | 3005 | 36.1 |
| 45 | 08029 | Delta County | 83.2 | 1866 | 57.4 | 2449 | 35.0 |
| 47 | 08067 | La Plata County | 82.8 | 2510 | 52.7 | 4564 | 21.1 |
| 48 | 08119 | Teller County | 82.4 | 1653 | 54.6 | 3468 | 45.6 |
| 51 | 08107 | Routt County | 81.8 | 933 | 57.0 | 4705 | 34.5 |
| 54 | 08083 | Montezuma County | 81.6 | 1745 | 56.9 | 1618 | 21.4 |
| 55 | 08087 | Morgan County | 81.2 | 2238 | 51.3 | 3938 | 32.9 |
| 58 | 08097 | Pitkin County | 81.0 | 1055 | 53.3 | 9682 | 58.6 |

## Top 20 Counties - After

| Rank | GEOID | Name | Score | Gap units | Gap score | Burden score | Affordability score | Future score | Commute score |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 4 | 08059 | Jefferson County | 80.3 | 28514 | 94.5 | 68.7 | 69.0 | 81.8 | 91.2 |
| 7 | 08035 | Douglas County | 77.8 | 19037 | 97.6 | 63.3 | 38.1 | 97.3 | 91.3 |
| 12 | 08005 | Arapahoe County | 75.5 | 23437 | 68.2 | 79.0 | 71.5 | 87.6 | 95.2 |
| 21 | 08013 | Boulder County | 71.8 | 11433 | 51.6 | 83.4 | 82.5 | 87.6 | 88.1 |
| 22 | 08001 | Adams County | 71.7 | 18252 | 64.3 | 74.6 | 61.1 | 88.5 | 95.2 |
| 28 | 08029 | Delta County | 71.2 | 1866 | 79.3 | 70.3 | 77.8 | 72.7 | 47.6 |
| 31 | 08119 | Teller County | 71.1 | 1653 | 79.4 | 66.6 | 80.2 | 63.0 | 65.9 |
| 33 | 08069 | Larimer County | 71.0 | 15337 | 58.8 | 80.3 | 76.2 | 88.1 | 71.5 |
| 40 | 08015 | Chaffee County | 69.8 | 1192 | 66.7 | 77.9 | 85.0 | 68.2 | 54.8 |
| 47 | 08123 | Weld County | 68.9 | 12878 | 77.0 | 63.1 | 41.3 | 92.7 | 74.6 |
| 56 | 08041 | El Paso County | 68.1 | 27429 | 67.5 | 76.9 | 67.5 | 76.7 | 50.0 |
| 59 | 08014 | Broomfield County | 67.7 | 3171 | 79.4 | 41.6 | 58.8 | 85.1 | 92.8 |
| 87 | 08037 | Eagle County | 64.4 | 1593 | 34.1 | 83.4 | 88.9 | 81.9 | 73.0 |
| 106 | 08031 | Denver County | 62.9 | 15979 | 46.8 | 49.7 | 88.1 | 82.6 | 97.6 |
| 125 | 08093 | Park County | 60.9 | 1591 | 80.2 | 32.4 | 72.2 | 58.9 | 62.7 |
| 129 | 08085 | Montrose County | 60.3 | 2302 | 65.9 | 52.9 | 53.2 | 81.3 | 50.8 |
| 132 | 08047 | Gilpin County | 59.7 | 408 | 57.9 | 63.3 | 69.0 | 42.4 | 81.0 |
| 134 | 08107 | Routt County | 59.6 | 933 | 29.3 | 85.2 | 80.9 | 75.4 | 57.9 |
| 139 | 08101 | Pueblo County | 59.1 | 6368 | 54.0 | 67.8 | 55.6 | 73.3 | 51.5 |
| 144 | 08067 | La Plata County | 58.7 | 2510 | 48.5 | 62.6 | 73.8 | 83.5 | 37.3 |

## Rural County Behavior

Top rural/mountain county entries after B1. The goal is visibility, not rural dominance.

| Rank | GEOID | Name | Pop | Score | Confidence | Gap score | Future score | Commute score |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 28 | 08029 | Delta County | 31598 | 71.2 | 0.98 | 79.3 | 72.7 | 47.6 |
| 31 | 08119 | Teller County | 24825 | 71.1 | 0.98 | 79.4 | 63.0 | 65.9 |
| 40 | 08015 | Chaffee County | 20178 | 69.8 | 0.98 | 66.7 | 68.2 | 54.8 |
| 87 | 08037 | Eagle County | 55135 | 64.4 | 0.98 | 34.1 | 81.9 | 73.0 |
| 125 | 08093 | Park County | 17907 | 60.9 | 0.98 | 80.2 | 58.9 | 62.7 |
| 129 | 08085 | Montrose County | 43807 | 60.3 | 0.98 | 65.9 | 81.3 | 50.8 |
| 132 | 08047 | Gilpin County | 5901 | 59.7 | 0.98 | 57.9 | 42.4 | 81.0 |
| 134 | 08107 | Routt County | 25084 | 59.6 | 0.98 | 29.3 | 75.4 | 57.9 |
| 144 | 08067 | La Plata County | 56331 | 58.7 | 0.98 | 48.5 | 83.5 | 37.3 |
| 147 | 08077 | Mesa County | 161260 | 58.6 | 0.98 | 57.9 | 89.2 | 41.3 |

## Tiny CDP Behavior

Top CDPs under 1,000 population after B1. Confidence multipliers and count-weighted factors should keep tiny high-rate geographies from dominating solely on ratios.

| Rank | GEOID | Name | Pop | Score | Confidence | Gap score | Future score | Commute score |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 66 | 0859240 | Pine Brook Hill (CDP) | 543 | 66.8 | 0.88 | 62.7 | 60.9 | 60.8 |
| 69 | 0849490 | Maysville (CDP) | 235 | 66.2 | 0.88 | 76.3 | 49.7 | 61.5 |
| 91 | 0821390 | Downieville-Lawson-Dumont (CDP) | 345 | 64.1 | 0.93 | 69.0 | 35.1 | 54.3 |
| 107 | 0812470 | Cattle Creek (CDP) | 396 | 62.9 | 0.88 | 63.2 | 57.3 | 68.0 |
| 116 | 0869110 | Seven Hills (CDP) | 183 | 61.5 | 0.87 | 61.2 | 51.3 | 66.2 |
| 120 | 0844270 | Lazy Acres (CDP) | 778 | 61.2 | 0.91 | 78.4 | 65.8 | 41.9 |
| 131 | 0845680 | Loghill Village (CDP) | 618 | 59.8 | 0.91 | 76.8 | 52.1 | 31.8 |
| 149 | 0823575 | Eldora (CDP) | 465 | 58.4 | 0.88 | 75.3 | 57.9 | 27.0 |
| 152 | 0807245 | Blende (CDP) | 623 | 58.2 | 0.94 | 68.4 | 48.3 | 67.5 |
| 166 | 0801740 | Altona (CDP) | 587 | 56.3 | 0.91 | 34.9 | 60.1 | 65.8 |

## QAP / Award Cross-Check

`js/qap-simulator.js` still awards Community Need points from `metrics.housing_gap_units` thresholds (`gap > 200`), while B1's ranking score now blends gap with burden, affordability, future pressure, and commuter pressure. This PR does not alter the QAP simulator.

- Historical CHFA award file reports rural win rate: 0.18 and urban win rate: 0.55.
- Top-20 B1 places are located in counties with 18 historical award records in `data/policy/chfa-awards-historical.json`.
- Top-20 B1 counties account for 26 historical award records.
- QAP gap threshold (`housing_gap_units > 200`) is met by 19/20 top B1 places and 20/20 top B1 counties.

Interpretation: B1 is better as a need-screening index than as a direct QAP point clone. It surfaces high-need/high-pressure jurisdictions that may diverge from awards because awards also depend on site control, developer capacity, local support, QCT/DDA, and the documented rural win-rate constraint.

## Entries Moving More Than 50 Ranks

| Move | GEOID | Name | Type | Old rank | New rank | Old score | New score |
|---:|---|---|---|---:|---:|---:|---:|
| -351 | 08105 | Rio Grande County | county | 142 | 493 | 69.4 | 22.5 |
| -299 | 08089 | Otero County | county | 106 | 405 | 74.5 | 33.1 |
| -293 | 08071 | Las Animas County | county | 102 | 395 | 74.9 | 34.0 |
| -286 | 08099 | Prowers County | county | 78 | 364 | 78.7 | 36.7 |
| +280 | 0845680 | Loghill Village (CDP) | cdp | 411 | 131 | 32.5 | 59.8 |
| -278 | 08009 | Baca County | county | 191 | 469 | 62.8 | 26.3 |
| -270 | 0843110 | Lamar (city) | place | 114 | 384 | 73.2 | 34.9 |
| -268 | 08121 | Washington County | county | 218 | 486 | 59.6 | 23.6 |
| -260 | 08081 | Moffat County | county | 151 | 411 | 67.8 | 32.1 |
| -259 | 08103 | Rio Blanco County | county | 190 | 449 | 63.0 | 28.0 |
| -254 | 0851635 | Monte Vista (city) | place | 236 | 490 | 57.0 | 22.8 |
| -248 | 0842110 | La Junta (city) | place | 180 | 428 | 64.0 | 30.5 |
| -245 | 08075 | Logan County | county | 87 | 332 | 77.0 | 38.7 |
| +244 | 0844270 | Lazy Acres (CDP) | cdp | 364 | 120 | 38.7 | 61.2 |
| -242 | 08003 | Alamosa County | county | 125 | 367 | 71.7 | 36.5 |
| -237 | 0834960 | Haxtun (town) | place | 184 | 421 | 63.6 | 31.3 |
| -236 | 08011 | Bent County | county | 126 | 362 | 71.6 | 36.8 |
| +234 | 0853010 | Nathrop (CDP) | cdp | 437 | 203 | 27.4 | 52.0 |
| -231 | 08063 | Kit Carson County | county | 160 | 391 | 66.9 | 34.5 |
| -230 | 0873330 | Springfield (town) | place | 259 | 489 | 53.8 | 22.9 |
| -229 | 08095 | Phillips County | county | 209 | 438 | 60.3 | 29.2 |
| -221 | 0878610 | Trinidad (city) | place | 108 | 329 | 74.2 | 39.4 |
| -221 | 08065 | Lake County | county | 120 | 341 | 72.3 | 38.1 |
| +219 | 0873943 | Sterling Ranch (CDP) | cdp | 435 | 216 | 28.2 | 50.2 |
| +217 | 0876325 | Tall Timber (CDP) | cdp | 472 | 255 | 18.2 | 46.3 |
| -215 | 0882350 | Walsenburg (city) | place | 208 | 423 | 60.4 | 31.0 |
| -212 | 08021 | Conejos County | county | 166 | 378 | 66.5 | 35.7 |
| -210 | 08017 | Cheyenne County | county | 251 | 461 | 55.0 | 27.3 |
| -206 | 0886310 | Wray (city) | place | 214 | 420 | 59.9 | 31.4 |
| -205 | 08033 | Dolores County | county | 275 | 480 | 51.5 | 24.8 |
| +204 | 0885155 | Williamsburg (town) | place | 389 | 185 | 35.9 | 54.3 |
| -200 | 08073 | Lincoln County | county | 194 | 394 | 62.2 | 34.4 |
| +196 | 0879105 | Twin Lakes CDP (Lake County) | cdp | 453 | 257 | 22.9 | 46.1 |
| +194 | 0883500 | Westcreek (CDP) | cdp | 462 | 268 | 21.5 | 45.2 |
| +194 | 0881305 | Vineland (CDP) | cdp | 428 | 234 | 30.3 | 47.9 |
| +194 | 0880370 | Valmont (CDP) | cdp | 445 | 251 | 25.5 | 46.6 |
| +192 | 0806602 | Beulah Valley (CDP) | cdp | 398 | 206 | 34.4 | 51.2 |
| -191 | 0837215 | Holly (town) | place | 284 | 475 | 50.6 | 25.7 |
| +187 | 0876190 | Tabernash (CDP) | cdp | 417 | 230 | 32.0 | 48.6 |
| -187 | 0865190 | Rocky Ford (city) | place | 171 | 358 | 64.7 | 37.2 |
| +186 | 0859885 | Placerville (CDP) | cdp | 455 | 269 | 22.8 | 45.0 |
| +185 | 0863705 | Redvale (CDP) | cdp | 476 | 291 | 17.3 | 43.2 |
| -185 | 08115 | Sedgwick County | county | 168 | 353 | 65.8 | 37.5 |
| +184 | 0852820 | Mulford (CDP) | cdp | 459 | 275 | 21.8 | 44.4 |
| -184 | 08055 | Huerfano County | county | 133 | 317 | 70.6 | 40.1 |
| -181 | 08125 | Yuma County | county | 115 | 296 | 72.9 | 42.3 |
| -180 | 08025 | Crowley County | county | 181 | 361 | 63.9 | 37.0 |
| -179 | 0827040 | Florence (city) | place | 272 | 451 | 51.7 | 28.0 |
| -179 | 0817760 | Craig (city) | place | 175 | 354 | 64.4 | 37.4 |
| +178 | 0823630 | Eldorado Springs (CDP) | cdp | 449 | 271 | 24.1 | 44.6 |
| -177 | 08083 | Montezuma County | county | 54 | 231 | 81.6 | 48.2 |
| -174 | 08087 | Morgan County | county | 55 | 229 | 81.2 | 48.9 |
| +173 | 0849490 | Maysville (CDP) | cdp | 242 | 69 | 56.2 | 66.2 |
| +172 | 0838910 | Inverness (CDP) | cdp | 187 | 15 | 63.4 | 73.2 |
| -171 | 0811810 | Cañon City (city) | place | 118 | 289 | 72.7 | 43.2 |
| +170 | 0876795 | Telluride (town) | place | 207 | 37 | 60.4 | 70.7 |
| +170 | 0807410 | Blue River (town) | place | 382 | 212 | 36.5 | 50.7 |
| +170 | 0801740 | Altona (CDP) | cdp | 336 | 166 | 41.9 | 56.3 |
| +169 | 0874275 | Stonewall Gap (CDP) | cdp | 452 | 283 | 22.9 | 43.8 |
| +169 | 0840550 | Keystone (CDP) | cdp | 230 | 61 | 57.8 | 67.7 |
| +168 | 0845750 | Loma (CDP) | cdp | 396 | 228 | 34.6 | 49.0 |
| +168 | 0812393 | Castle Pines Village (CDP) | cdp | 339 | 171 | 41.8 | 55.8 |
| -168 | 0873935 | Sterling (city) | place | 95 | 263 | 76.0 | 45.6 |
| -166 | 0827810 | Fort Morgan (city) | place | 107 | 273 | 74.2 | 44.5 |
| +165 | 0867040 | St. Ann Highlands (CDP) | cdp | 474 | 309 | 17.9 | 40.7 |
| -165 | 08043 | Fremont County | county | 81 | 246 | 77.4 | 46.8 |
| +163 | 0822575 | East Pleasant View (CDP) | cdp | 424 | 261 | 31.1 | 45.6 |
| +162 | 0859240 | Pine Brook Hill (CDP) | cdp | 228 | 66 | 58.1 | 66.8 |
| +162 | 0857445 | Paragon Estates (CDP) | cdp | 460 | 298 | 21.7 | 42.1 |
| +162 | 0837655 | Howard (CDP) | cdp | 416 | 254 | 32.0 | 46.4 |
| -162 | 08051 | Gunnison County | county | 96 | 258 | 75.5 | 45.9 |
| -161 | 0843660 | Las Animas (city) | place | 145 | 306 | 68.6 | 41.0 |
| +159 | 0837545 | Hotchkiss (town) | place | 178 | 19 | 64.3 | 72.0 |
| -159 | 0862880 | Rangely (town) | place | 325 | 484 | 43.8 | 23.7 |
| +158 | 0885760 | Wolcott (CDP) | cdp | 470 | 312 | 18.5 | 40.6 |
| +156 | 0852210 | Mountain Meadows (CDP) | cdp | 466 | 310 | 20.0 | 40.6 |
| +156 | 0804620 | Bark Ranch (CDP) | cdp | 505 | 349 | 11.7 | 37.7 |
| +153 | 0852570 | Mount Crested Butte (town) | place | 309 | 156 | 46.8 | 57.7 |
| +151 | 0850380 | Midland (CDP) | cdp | 450 | 299 | 23.8 | 42.0 |
| -151 | 0812855 | Center (town) | place | 327 | 478 | 43.3 | 25.2 |
| -151 | 0810600 | Burlington (city) | place | 288 | 439 | 50.3 | 29.2 |
| -151 | 08061 | Kiowa County | county | 286 | 437 | 50.5 | 29.2 |
| +149 | 0828690 | Frisco (town) | place | 222 | 73 | 59.0 | 65.7 |
| +148 | 0886200 | Woody Creek (CDP) | cdp | 433 | 285 | 29.3 | 43.5 |
| +148 | 0804935 | Basalt (town) | place | 189 | 41 | 63.0 | 69.8 |
| +147 | 0858592 | Perry Park (CDP) | cdp | 403 | 256 | 33.3 | 46.2 |
| -146 | 0864255 | Rifle (city) | place | 174 | 320 | 64.6 | 39.9 |
| -146 | 0814175 | Cheyenne Wells (town) | place | 345 | 491 | 40.9 | 22.6 |
| -146 | 08097 | Pitkin County | county | 58 | 204 | 81.0 | 51.6 |
| -145 | 08111 | San Juan County | county | 305 | 450 | 47.3 | 28.0 |
| +144 | 0844375 | Leadville North (CDP) | cdp | 368 | 224 | 38.4 | 49.4 |
| +143 | 0874080 | Stonegate (CDP) | cdp | 240 | 97 | 56.5 | 63.8 |
| +143 | 0823520 | Elbert (CDP) | cdp | 444 | 301 | 25.5 | 41.8 |
| +141 | 0869110 | Seven Hills (CDP) | cdp | 257 | 116 | 54.0 | 61.5 |
| -141 | 0839965 | Julesburg (town) | place | 215 | 356 | 59.8 | 37.4 |
| -141 | 0827975 | Fowler (town) | place | 232 | 373 | 57.7 | 35.8 |
| +138 | 0858785 | Phippsburg (CDP) | cdp | 482 | 344 | 15.7 | 37.9 |
| +138 | 0841560 | Kremmling (town) | place | 239 | 101 | 56.6 | 63.5 |
| +137 | 0877235 | The Pinery (CDP) | cdp | 241 | 104 | 56.5 | 63.4 |
| -137 | 0809555 | Brush (city) | place | 110 | 247 | 74.0 | 46.8 |
| +136 | 0839745 | Joes (CDP) | cdp | 491 | 355 | 14.0 | 37.4 |
| +135 | 0800870 | Air Force Academy (CDP) | cdp | 229 | 94 | 57.8 | 64.0 |
| -135 | 08023 | Costilla County | county | 186 | 321 | 63.4 | 39.8 |
| +134 | 0870112 | Sierra Ridge (CDP) | cdp | 170 | 36 | 65.1 | 71.0 |
| +133 | 0813845 | Cherry Hills Village (city) | place | 167 | 34 | 66.1 | 71.0 |
| +131 | 0875585 | Sunshine (CDP) | cdp | 363 | 232 | 38.8 | 48.1 |
| +131 | 0800620 | Aetna Estates (CDP) | cdp | 358 | 227 | 39.3 | 49.0 |
| -131 | 08117 | Summit County | county | 88 | 219 | 77.0 | 50.0 |
| -129 | 0849875 | Meeker (town) | place | 296 | 425 | 49.0 | 30.8 |
| -129 | 08027 | Custer County | county | 152 | 281 | 67.7 | 43.9 |
| +128 | 0864200 | Ridgway (town) | place | 247 | 119 | 55.8 | 61.3 |
| +128 | 0856420 | Ouray (city) | place | 302 | 174 | 47.8 | 55.6 |
| -128 | 0848060 | Manassa (town) | place | 274 | 402 | 51.7 | 33.4 |
| -128 | 0842055 | La Jara (town) | place | 282 | 410 | 50.8 | 32.3 |
| +126 | 0800320 | Acres Green (CDP) | cdp | 313 | 187 | 46.4 | 54.0 |
| -126 | 08053 | Hinsdale County | county | 337 | 463 | 41.9 | 27.1 |
| +125 | 0802905 | Arboles (CDP) | cdp | 292 | 167 | 49.6 | 56.2 |
| +124 | 0886117 | Woodmoor (CDP) | cdp | 219 | 95 | 59.6 | 64.0 |
| +124 | 0865685 | Rollinsville (CDP) | cdp | 442 | 318 | 25.9 | 40.1 |
| +124 | 0853120 | Naturita (town) | place | 182 | 58 | 63.8 | 67.9 |
| -124 | 0869700 | Sheridan Lake (town) | place | 375 | 499 | 37.4 | 22.0 |
| -123 | 0882460 | Walsh (town) | place | 320 | 443 | 44.7 | 28.8 |
| -123 | 08045 | Garfield County | county | 75 | 198 | 79.2 | 52.9 |
| +122 | 0854880 | Norwood (town) | place | 347 | 225 | 40.7 | 49.4 |
| +122 | 0812945 | Chacra (CDP) | cdp | 409 | 287 | 32.8 | 43.3 |
| +121 | 0841065 | Kittredge (CDP) | cdp | 454 | 333 | 22.8 | 38.7 |
| +121 | 0815302 | Coal Creek (CDP) | cdp | 341 | 220 | 41.4 | 49.8 |
| +120 | 0877757 | Todd Creek (CDP) | cdp | 413 | 293 | 32.3 | 42.9 |
| +120 | 0848940 | Marvel (CDP) | cdp | 489 | 369 | 14.5 | 36.5 |
| +120 | 0821390 | Downieville-Lawson-Dumont (CDP) | cdp | 211 | 91 | 60.3 | 64.1 |
| -120 | 0819795 | Del Norte (town) | place | 248 | 368 | 55.5 | 36.5 |
| -120 | 0801090 | Alamosa (city) | place | 147 | 267 | 68.4 | 45.3 |
| +119 | 0860655 | Ponderosa Park (CDP) | cdp | 321 | 202 | 44.6 | 52.3 |
| +119 | 0845955 | Lone Tree (city) | place | 137 | 18 | 70.2 | 72.1 |
| -116 | 0808345 | Branson (town) | place | 401 | 517 | 33.4 | 17.9 |
| +115 | 0839800 | Johnson Village (CDP) | cdp | 446 | 331 | 24.6 | 38.8 |
| -115 | 0875970 | Swink (town) | place | 225 | 340 | 58.5 | 38.2 |
| +114 | 0870195 | Silt (town) | place | 213 | 99 | 60.0 | 63.7 |
| -114 | 0861315 | Pritchett (town) | place | 346 | 460 | 40.9 | 27.4 |
| +113 | 0883175 | Weldona (CDP) | cdp | 490 | 377 | 14.2 | 35.8 |
| -113 | 0848115 | Mancos (town) | place | 237 | 350 | 56.9 | 37.7 |
| -113 | 0831660 | Grand Junction (city) | place | 50 | 163 | 81.9 | 56.9 |
| -112 | 0806530 | Bethune (town) | place | 359 | 471 | 39.3 | 26.1 |
| +111 | 0850026 | Meridian Village (CDP) | cdp | 203 | 92 | 61.0 | 64.1 |
| +111 | 0850012 | Meridian (CDP) | cdp | 112 | 1 | 73.8 | 83.3 |
| -111 | 08101 | Pueblo County | county | 28 | 139 | 86.0 | 59.1 |
| -111 | 08077 | Mesa County | county | 36 | 147 | 84.1 | 58.6 |
| +110 | 0832650 | Green Mountain Falls (town) | place | 410 | 300 | 32.5 | 41.9 |
| +109 | 0857025 | Palmer Lake (town) | place | 303 | 194 | 47.5 | 53.2 |
| +109 | 0829625 | Genesee (CDP) | cdp | 205 | 96 | 60.8 | 63.9 |
| -107 | 0822145 | Eads (town) | place | 360 | 467 | 39.3 | 26.4 |
| -107 | 0821265 | Dove Creek (town) | place | 352 | 459 | 40.1 | 27.4 |
| +106 | 0831935 | Grand View Estates (CDP) | cdp | 512 | 406 | 10.9 | 33.1 |
| +106 | 0823575 | Eldora (CDP) | cdp | 255 | 149 | 54.5 | 58.4 |
| -105 | 0831550 | Granada (town) | place | 322 | 427 | 44.5 | 30.5 |
| +104 | 0864970 | Rockvale (town) | place | 227 | 123 | 58.3 | 61.0 |
| -104 | 0851745 | Montrose (city) | place | 60 | 164 | 80.8 | 56.7 |
| -104 | 0808400 | Breckenridge (town) | place | 68 | 172 | 79.8 | 55.6 |
| +103 | 0863650 | Redstone (CDP) | cdp | 488 | 385 | 14.6 | 34.8 |
| +103 | 0855540 | Olathe (town) | place | 220 | 117 | 59.4 | 61.4 |
| +103 | 0844265 | Lazear (CDP) | cdp | 520 | 417 | 9.5 | 31.5 |
| -103 | 0820495 | Dinosaur (town) | place | 342 | 445 | 41.2 | 28.6 |
| +102 | 0882735 | Ward (town) | place | 312 | 210 | 46.5 | 51.0 |
| +102 | 0864870 | Rock Creek Park (CDP) | cdp | 485 | 383 | 15.1 | 35.1 |
| +102 | 0823795 | El Jebel (CDP) | cdp | 111 | 9 | 73.8 | 76.8 |
| -102 | 0817375 | Cortez (city) | place | 76 | 178 | 78.9 | 55.1 |
| +100 | 0853175 | Nederland (town) | place | 299 | 199 | 48.3 | 52.8 |
| +99 | 0874980 | Sugarloaf (CDP) | cdp | 343 | 244 | 41.2 | 47.1 |
| +99 | 0837220 | Holly Hills (CDP) | cdp | 316 | 217 | 45.6 | 50.1 |
| +97 | 0855980 | Orchard City (town) | place | 124 | 27 | 72.0 | 71.3 |
| -97 | 08067 | La Plata County | county | 47 | 144 | 82.8 | 58.7 |
| +96 | 0873925 | Stepping Stone (CDP) | cdp | 447 | 351 | 24.5 | 37.7 |
| +96 | 0869150 | Severance (town) | place | 256 | 160 | 54.2 | 57.3 |
| +96 | 0845530 | Lochbuie (town) | place | 279 | 183 | 51.0 | 54.5 |
| +95 | 0882900 | Watkins (CDP) | cdp | 372 | 277 | 37.8 | 44.3 |
| -95 | 0807190 | Blanca (town) | place | 393 | 488 | 35.0 | 23.1 |
| +94 | 0885705 | Winter Park (town) | place | 280 | 186 | 51.0 | 54.2 |
| +94 | 0879785 | Upper Bear Creek (CDP) | cdp | 291 | 197 | 49.8 | 53.0 |
| +94 | 0854935 | Nucla (town) | place | 354 | 260 | 40.1 | 45.9 |
| -94 | 0826765 | Flagler (town) | place | 324 | 418 | 43.8 | 31.4 |
| +93 | 0879800 | Upper Witter Gulch (CDP) | cdp | 438 | 345 | 26.6 | 37.9 |
| -93 | 08057 | Jackson County | county | 183 | 276 | 63.7 | 44.3 |
| +92 | 0856035 | Orchard Mesa (CDP) | cdp | 159 | 67 | 67.0 | 66.3 |
| +92 | 0853945 | Norrie (CDP) | cdp | 521 | 429 | 8.8 | 30.5 |
| +92 | 0828360 | Frederick (town) | place | 116 | 24 | 72.9 | 71.4 |
| -92 | 0885045 | Wiley (town) | place | 426 | 518 | 30.5 | 17.8 |
| -92 | 0874375 | Strasburg (CDP) | cdp | 113 | 205 | 73.8 | 51.3 |
| -92 | 0819850 | Delta (city) | place | 59 | 151 | 80.8 | 58.3 |
| -92 | 0808675 | Brighton (city) | place | 38 | 130 | 84.0 | 60.2 |
| +91 | 0835070 | Hayden (town) | place | 300 | 209 | 48.2 | 51.0 |
| +91 | 0812470 | Cattle Creek (CDP) | cdp | 198 | 107 | 61.4 | 62.9 |
| -91 | 0858235 | Peetz (town) | place | 381 | 472 | 36.6 | 26.1 |
| +90 | 0843550 | Larkspur (town) | place | 323 | 233 | 44.0 | 47.9 |
| +90 | 0835400 | Heeney (CDP) | cdp | 355 | 265 | 39.8 | 45.4 |
| -90 | 0872395 | South Fork (town) | place | 436 | 526 | 28.0 | 14.9 |
| -90 | 0838370 | Idaho Springs (city) | place | 273 | 363 | 51.7 | 36.8 |
| +89 | 0857850 | Parshall (CDP) | cdp | 304 | 215 | 47.4 | 50.2 |
| -89 | 0813460 | Cheraw (town) | place | 405 | 494 | 33.0 | 22.4 |
| -89 | 08049 | Grand County | county | 103 | 192 | 74.8 | 53.5 |
| -89 | 0803950 | Ault (town) | place | 216 | 305 | 59.7 | 41.1 |
| -89 | 0800760 | Aguilar (town) | place | 420 | 509 | 31.7 | 19.3 |
| +88 | 0886475 | Yampa (town) | place | 370 | 282 | 38.3 | 43.9 |
| +88 | 0859520 | Pine Valley (CDP) | cdp | 514 | 426 | 10.4 | 30.8 |
| +87 | 0886090 | Woodland Park (city) | place | 101 | 14 | 75.0 | 74.6 |
| +87 | 0829955 | Gilcrest (town) | place | 233 | 146 | 57.6 | 58.7 |
| -86 | 0864090 | Rico (town) | place | 397 | 483 | 34.6 | 23.8 |
| -86 | 0859830 | Pitkin (town) | place | 348 | 434 | 40.6 | 29.8 |
| -86 | 0839855 | Johnstown (town) | place | 135 | 221 | 70.5 | 49.6 |
| -86 | 0814587 | Cimarron Hills (CDP) | cdp | 42 | 128 | 83.7 | 60.4 |
| +85 | 0860765 | Portland (CDP) | cdp | 499 | 414 | 12.2 | 31.7 |
| -84 | 0840515 | Kersey (town) | place | 200 | 284 | 61.4 | 43.6 |
| +83 | 0818585 | Crisman (CDP) | cdp | 419 | 336 | 31.8 | 38.5 |
| -83 | 0844980 | Limon (town) | place | 264 | 347 | 52.9 | 37.8 |
| -83 | 0820000 | Denver (city) | place | 26 | 109 | 86.1 | 62.8 |
| -83 | 08107 | Routt County | county | 51 | 134 | 81.8 | 59.6 |
| +82 | 0844695 | Leyner (CDP) | cdp | 528 | 446 | 6.7 | 28.6 |
| -82 | 08019 | Clear Creek County | county | 77 | 159 | 78.8 | 57.4 |
| +80 | 0872320 | Southern Ute (CDP) | cdp | 484 | 404 | 15.5 | 33.4 |
| +80 | 0852550 | Mountain Village (town) | place | 164 | 84 | 66.7 | 64.6 |
| -80 | 0862000 | Pueblo (city) | place | 18 | 98 | 87.7 | 63.7 |
| -80 | 08113 | San Miguel County | county | 97 | 177 | 75.3 | 55.1 |
| -80 | 08007 | Archuleta County | county | 109 | 189 | 74.1 | 53.7 |
| +79 | 0870250 | Silver Cliff (town) | place | 221 | 142 | 59.4 | 58.9 |
| +78 | 0854495 | North La Junta (CDP) | cdp | 402 | 324 | 33.4 | 39.7 |
| +78 | 0840185 | Keenesburg (town) | place | 269 | 191 | 52.3 | 53.6 |
| -78 | 0852075 | Morrison (town) | place | 344 | 422 | 41.0 | 31.1 |
| -78 | 08109 | Saguache County | county | 158 | 236 | 67.1 | 47.7 |
| +77 | 0838480 | Idledale (CDP) | cdp | 451 | 374 | 23.0 | 35.8 |
| -77 | 0836940 | Hoehne (CDP) | cdp | 421 | 498 | 31.7 | 22.2 |
| +76 | 0870525 | Silverthorne (town) | place | 86 | 10 | 77.2 | 76.8 |
| +76 | 0867142 | St. Mary's (CDP) | cdp | 317 | 241 | 45.4 | 47.3 |
| +76 | 0821155 | Dotsero (CDP) | cdp | 468 | 392 | 18.7 | 34.5 |
| +76 | 0812635 | Cedaredge (town) | place | 127 | 51 | 71.6 | 68.5 |
| -76 | 0884770 | Wiggins (town) | place | 427 | 503 | 30.4 | 21.6 |
| -76 | 0868930 | Sedgwick (town) | place | 443 | 519 | 25.8 | 17.5 |
| -76 | 0862220 | Pueblo West (CDP) | cdp | 100 | 176 | 75.0 | 55.2 |
| -76 | 0842330 | Lake City (town) | place | 439 | 515 | 26.3 | 18.3 |
| +75 | 0866197 | Roxborough Park (CDP) | cdp | 202 | 127 | 61.2 | 60.6 |
| +75 | 0863320 | Red Feather Lakes (CDP) | cdp | 434 | 359 | 28.4 | 37.1 |
| +75 | 0818310 | Crested Butte (town) | place | 201 | 126 | 61.3 | 60.8 |
| +74 | 0871625 | Smeltertown (CDP) | cdp | 371 | 297 | 37.9 | 42.2 |
| +74 | 08079 | Mineral County | county | 253 | 179 | 54.7 | 54.9 |
| -74 | 08031 | Denver County | county | 32 | 106 | 85.3 | 62.9 |
| +72 | 0824950 | Erie (town) | place | 143 | 71 | 69.1 | 66.0 |
| +72 | 0810985 | Byers (CDP) | cdp | 399 | 327 | 34.4 | 39.6 |
| -72 | 0856145 | Ordway (town) | place | 192 | 264 | 62.8 | 45.5 |
| -72 | 08037 | Eagle County | county | 15 | 87 | 88.2 | 64.4 |
| +71 | 0828305 | Fraser (town) | place | 311 | 240 | 46.6 | 47.4 |
| -71 | 0836610 | Hillrose (town) | place | 369 | 440 | 38.3 | 29.0 |
| -71 | 0833310 | Grover (town) | place | 319 | 390 | 44.7 | 34.6 |
| -71 | 0803235 | Arriba (town) | place | 429 | 500 | 30.1 | 21.9 |
| +70 | 0883230 | Wellington (town) | place | 123 | 53 | 72.1 | 68.3 |
| +70 | 0860600 | Poncha Springs (town) | place | 395 | 325 | 34.9 | 39.7 |
| +70 | 0835860 | Hidden Lake (CDP) | cdp | 523 | 453 | 7.9 | 27.9 |
| +70 | 0830340 | Glendale (city) | place | 93 | 23 | 76.2 | 71.7 |
| -70 | 0870580 | Silverton (town) | place | 366 | 436 | 38.6 | 29.5 |
| -70 | 0837600 | Hot Sulphur Springs (town) | place | 407 | 477 | 33.0 | 25.4 |
| -70 | 0806255 | Berthoud (town) | place | 173 | 243 | 64.6 | 47.1 |
| -68 | 0822200 | Eagle (town) | place | 69 | 137 | 79.8 | 59.2 |
| +67 | 0826600 | Firestone (town) | place | 141 | 74 | 69.5 | 65.5 |
| -67 | 0874485 | Stratton (town) | place | 290 | 357 | 49.8 | 37.3 |
| -67 | 0841010 | Kit Carson (town) | place | 463 | 530 | 21.2 | 14.0 |
| -67 | 0837270 | Holyoke (city) | place | 276 | 343 | 51.4 | 37.9 |
| -66 | 0837380 | Hooper (town) | place | 467 | 533 | 19.0 | 13.9 |
| -65 | 0837875 | Hugo (town) | place | 332 | 397 | 42.9 | 33.9 |
| +64 | 0880040 | Vail (town) | place | 139 | 75 | 69.9 | 65.5 |
| +64 | 0844595 | Lewis (CDP) | cdp | 516 | 452 | 10.0 | 28.0 |
| +64 | 0834685 | Hasty (CDP) | cdp | 394 | 330 | 34.9 | 39.0 |
| +64 | 0815935 | Colorado City (CDP) | cdp | 153 | 89 | 67.5 | 64.2 |
| -64 | 08039 | Elbert County | county | 89 | 153 | 76.9 | 57.9 |
| -63 | 0885485 | Windsor (town) | place | 27 | 90 | 86.1 | 64.2 |
| -63 | 0834520 | Hartman (town) | place | 458 | 521 | 21.8 | 16.8 |
| +62 | 0859005 | Pierce (town) | place | 246 | 184 | 55.8 | 54.4 |
| +62 | 0843605 | La Salle (town) | place | 224 | 162 | 58.5 | 57.0 |
| -62 | 08085 | Montrose County | county | 67 | 129 | 80.1 | 60.3 |
| +61 | 0828830 | Fulford (CDP) | cdp | 531 | 470 | 5.2 | 26.2 |
| +61 | 0815330 | Coal Creek (town) | place | 306 | 245 | 47.0 | 47.0 |
| +60 | 0847345 | McCoy (CDP) | cdp | 525 | 465 | 7.7 | 27.0 |
| +60 | 0830350 | Glendale (CDP) | cdp | 533 | 473 | 5.0 | 25.9 |
| +60 | 0829185 | Garden City (town) | place | 250 | 190 | 55.1 | 53.7 |
| +60 | 08091 | Ouray County | county | 217 | 157 | 59.6 | 57.6 |
| +59 | 0839160 | Jackson Lake (CDP) | cdp | 301 | 242 | 48.1 | 47.2 |
| +59 | 0808070 | Bow Mar (town) | place | 331 | 272 | 42.9 | 44.5 |
| -59 | 0886750 | Yuma (city) | place | 176 | 235 | 64.4 | 47.8 |
| +58 | 0838810 | Indian Hills (CDP) | cdp | 353 | 295 | 40.1 | 42.8 |
| +58 | 0809115 | Brookside (town) | place | 404 | 346 | 33.1 | 37.8 |
| -58 | 0882130 | Walden (town) | place | 265 | 323 | 52.9 | 39.8 |
| -58 | 0819150 | Dakota Ridge (CDP) | cdp | 56 | 114 | 81.2 | 62.4 |
| +57 | 0857400 | Parachute (town) | place | 238 | 181 | 56.7 | 54.9 |
| +57 | 0855870 | Ophir (town) | place | 385 | 328 | 36.2 | 39.6 |
| +57 | 0828250 | Franktown (CDP) | cdp | 457 | 400 | 22.1 | 33.6 |
| -57 | 0873715 | Starkville (town) | place | 387 | 444 | 36.1 | 28.7 |
| +56 | 0828800 | Fruitvale (CDP) | cdp | 199 | 143 | 61.4 | 58.8 |
| -56 | 0834740 | Haswell (town) | place | 483 | 539 | 15.6 | 10.7 |
| +55 | 0824620 | Empire (town) | place | 266 | 211 | 52.8 | 50.9 |
| +55 | 0808620 | Briggsdale (CDP) | cdp | 456 | 401 | 22.2 | 33.4 |
| +55 | 0801420 | Allenspark (CDP) | cdp | 357 | 302 | 39.6 | 41.7 |
| -55 | 0856475 | Ovid (town) | place | 338 | 393 | 41.9 | 34.5 |
| -55 | 0812910 | Central City (city) | place | 223 | 278 | 58.5 | 44.2 |
| +54 | 0850920 | Minturn (town) | place | 212 | 158 | 60.2 | 57.5 |
| -53 | 0848555 | Marble (town) | place | 478 | 531 | 16.6 | 14.0 |
| +52 | 0880095 | Valdez (CDP) | cdp | 465 | 413 | 20.9 | 31.8 |
| +52 | 0825550 | Fairmount (CDP) | cdp | 163 | 111 | 66.7 | 62.6 |
| -52 | 0881030 | Vilas (town) | place | 486 | 538 | 15.1 | 11.7 |
| -52 | 0857245 | Paoli (town) | place | 475 | 527 | 17.6 | 14.6 |
| -52 | 0854750 | North Washington (CDP) | cdp | 121 | 173 | 72.3 | 55.6 |
| -52 | 0848445 | Manitou Springs (city) | place | 83 | 135 | 77.4 | 59.5 |
| -52 | 0804165 | Avondale (CDP) | cdp | 414 | 466 | 32.2 | 26.4 |
| -51 | 0881690 | Vona (town) | place | 469 | 520 | 18.6 | 17.3 |
| -51 | 0845695 | Log Lane Village (town) | place | 314 | 365 | 46.0 | 36.7 |
| -51 | 0845145 | Lincoln Park (CDP) | cdp | 156 | 207 | 67.3 | 51.2 |
| -51 | 0832155 | Greeley (city) | place | 21 | 72 | 86.6 | 65.9 |
