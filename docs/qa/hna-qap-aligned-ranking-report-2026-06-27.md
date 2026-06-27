# QAP-Aligned HNA Ranking Face-Validity Report - 2026-06-27

Owner-gated draft. Baseline is `origin/main:data/hna/ranking-index.json`. This branch stacks on B1 (#997) and reuses its materialized need factors while replacing the final score with a QAP-aligned Community Need x Opportunity screen.

## Method Change

- Phase 1 adds opportunity metrics to `ranking-index.json`: Opportunity Insights mobility, EPA walkability/transit, centroid-radius amenity access, and QCT/DDA context. These are materialized as displayed metrics.
- Phase 2 performs the single rerank: `overall_need_score = (0.55 * community_need_score + 0.45 * opportunity_score) * score_confidence_multiplier`.
- Commuter pressure is no longer a standalone score weight. It is an augment-only multiplier on raw community need: `core * (1 + 0.15 * commuter_pressure_score / 100)` before re-percentiling by geography type.
- Overcrowding is optional because `DP04_0078E/DP04_0079E` are absent from the current summary cache; the factor re-normalizes out and is recorded in `dataQuality.imputed_score_factors`.
- QAP simulator remains unchanged; this is a jurisdiction screening index, not a per-project QAP point clone.

## Coverage

opportunity_mobility_score 437/547, walkability_score 438/547, amenity_access_score 547/547, qct_dda_score 547/547, opportunity_score 547/547, community_need_score 547/547, overcrowding_rate 0/547

## Movement Summary

- Entries moving >50 ranks vs origin/main: 329 total (52 counties, 152 places, 125 CDPs).
- Entries marked `hasIncompleteData`: 547 / 547.
- Opportunity aggregates cover every scoring entry via direct place, alias, or county-context aggregation.

## Spot Checks

| GEOID | Name | Type | Old rank/score | B1 rank/score | QAP rank/score | Move vs main | Notes |
|---|---|---|---:|---:|---:|---:|---|
| 0870195 | Silt (town) | place | 213 / 60.0 | 99 / 63.7 | 112 / 64.6 | +101 | need 78.7; opp 53.3; core 66.5; aug 71.0; commute 45.2 |
| 0820000 | Denver (city) | place | 26 / 86.1 | 109 / 62.8 | 110 / 64.8 | -84 | need 75.4; opp 57.8; core 64.0; aug 69.6; commute 58.8 |
| 08031 | Denver County | county | 32 / 85.3 | 106 / 62.9 | 106 / 65.0 | -74 | need 79.4; opp 61.7; core 60.5; aug 69.3; commute 97.6 |
| 08059 | Jefferson County | county | 20 / 87.2 | 4 / 80.3 | 10 / 81.1 | +10 | need 100.0; opp 75.9; core 81.0; aug 92.0; commute 91.2 |
| 08035 | Douglas County | county | 23 / 86.3 | 7 / 77.8 | 36 / 75.9 | -13 | need 98.4; opp 65.0; core 78.1; aug 88.8; commute 91.3 |
| 08007 | Archuleta County | county | 109 / 74.1 | 189 / 53.7 | 294 / 40.9 | -185 | need 58.7; opp 28.1; core 57.7; aug 60.1; commute 28.6 |
| 08009 | Baca County | county | 191 / 62.8 | 469 / 26.3 | 453 / 24.9 | -262 | need 7.9; opp 51.1; core 29.2; aug 29.5; commute 5.5 |
| 08115 | Sedgwick County | county | 168 / 65.8 | 353 / 37.5 | 325 / 37.9 | -157 | need 34.9; opp 49.9; core 41.2; aug 41.9; commute 11.9 |
| 0873825 | Steamboat Springs (city) | place | 44 / 83.3 | 8 / 76.9 | 1 / 86.4 | +43 | need 98.5; opp 79.6; core 81.2; aug 86.8; commute 46.2 |
| 0807850 | Boulder (city) | place | 2 / 92.2 | 2 / 82.7 | 2 / 86.0 | +0 | need 100.0; opp 76.9; core 85.7; aug 94.0; commute 64.3 |
| 0870525 | Silverthorne (town) | place | 86 / 77.2 | 10 / 76.8 | 5 / 84.2 | +81 | need 98.2; opp 87.9; core 79.6; aug 86.7; commute 59.5 |


### Rural Low-Commute Spotlight

Baca and Sedgwick still sit far below their origin/main ranks, but that drop is inherited from B1's richer need-factor rerank rather than caused by the QAP commuter/opportunity realignment. Relative to B1, Baca improves from rank 469 to 453 and Sedgwick improves from rank 353 to 325. The augment-only commuter rule does not subtract from their community-need core; it only adds a small positive adjustment.

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

| Rank | GEOID | Name | Score | Community Need | Opportunity | Confidence | Commute ctx |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | 0873825 | Steamboat Springs (city) | 86.4 | 98.5 | 79.6 | 0.96 | 46.2 |
| 2 | 0807850 | Boulder (city) | 86.0 | 100.0 | 76.9 | 0.96 | 64.3 |
| 3 | 0857630 | Parker (town) | 85.7 | 99.3 | 76.9 | 0.96 | 68.5 |
| 5 | 0870525 | Silverthorne (town) | 84.2 | 98.2 | 87.9 | 0.9 | 59.5 |
| 7 | 0841835 | Lafayette (city) | 82.8 | 93.8 | 77.1 | 0.96 | 71.7 |
| 8 | 0827425 | Fort Collins (city) | 82.2 | 96.3 | 72.6 | 0.96 | 51.8 |
| 11 | 0830835 | Golden (city) | 81.0 | 96.0 | 70.1 | 0.96 | 81.5 |
| 12 | 0880040 | Vail (town) | 81.0 | 83.5 | 85.4 | 0.96 | 49.0 |
| 14 | 0804110 | Avon (town) | 80.3 | 89.0 | 77.0 | 0.96 | 78.7 |
| 15 | 0845255 | Littleton (city) | 80.3 | 95.6 | 72.9 | 0.94 | 78.1 |
| 16 | 0830340 | Glendale (city) | 80.2 | 94.5 | 70.1 | 0.96 | 88.4 |
| 18 | 0826270 | Federal Heights (city) | 79.4 | 99.6 | 62.0 | 0.96 | 78.3 |
| 19 | 0877290 | Thornton (city) | 78.6 | 97.4 | 62.8 | 0.96 | 63.8 |
| 20 | 0886090 | Woodland Park (city) | 78.4 | 97.1 | 62.7 | 0.96 | 51.5 |
| 21 | 0845970 | Longmont (city) | 78.3 | 94.1 | 66.2 | 0.96 | 54.6 |
| 23 | 0843000 | Lakewood (city) | 77.7 | 92.6 | 66.7 | 0.96 | 69.3 |
| 25 | 0845955 | Lone Tree (city) | 77.1 | 95.2 | 62.2 | 0.96 | 88.4 |
| 27 | 0812815 | Centennial (city) | 76.9 | 85.3 | 73.8 | 0.96 | 77.4 |
| 28 | 0846355 | Louisville (city) | 76.9 | 80.9 | 79.1 | 0.96 | 78.5 |
| 29 | 0804000 | Aurora (city) | 76.8 | 97.8 | 58.3 | 0.96 | 60.3 |

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

| Rank | GEOID | Name | Score | Community Need | Opportunity | Confidence | Commute ctx |
|---:|---|---|---:|---:|---:|---:|---:|
| 10 | 08059 | Jefferson County | 81.1 | 100.0 | 75.9 | 0.91 | 91.2 |
| 13 | 08013 | Boulder County | 80.8 | 95.2 | 81.0 | 0.91 | 88.1 |
| 26 | 08005 | Arapahoe County | 76.9 | 96.8 | 69.4 | 0.91 | 95.2 |
| 36 | 08035 | Douglas County | 75.9 | 98.4 | 65.0 | 0.91 | 91.3 |
| 55 | 08069 | Larimer County | 72.9 | 88.9 | 69.3 | 0.91 | 71.5 |
| 66 | 08001 | Adams County | 71.5 | 92.1 | 62.0 | 0.91 | 95.2 |
| 69 | 08119 | Teller County | 70.7 | 90.5 | 62.1 | 0.91 | 65.9 |
| 74 | 08107 | Routt County | 70.1 | 74.6 | 79.9 | 0.91 | 57.9 |
| 77 | 08014 | Broomfield County | 69.8 | 82.5 | 69.5 | 0.91 | 92.8 |
| 83 | 08037 | Eagle County | 68.6 | 81.0 | 68.5 | 0.91 | 73.0 |
| 90 | 08029 | Delta County | 67.8 | 93.7 | 51.1 | 0.91 | 47.6 |
| 93 | 08123 | Weld County | 67.3 | 85.7 | 59.6 | 0.91 | 74.6 |
| 99 | 08041 | El Paso County | 66.8 | 84.1 | 60.4 | 0.91 | 50.0 |
| 106 | 08031 | Denver County | 65.0 | 79.4 | 61.7 | 0.91 | 97.6 |
| 122 | 08067 | La Plata County | 63.2 | 71.4 | 67.0 | 0.91 | 37.3 |
| 127 | 08015 | Chaffee County | 62.4 | 87.3 | 45.6 | 0.91 | 54.8 |
| 132 | 08077 | Mesa County | 61.5 | 68.3 | 66.7 | 0.91 | 41.3 |
| 154 | 08117 | Summit County | 58.2 | 50.8 | 90.1 | 0.85 | 79.4 |
| 172 | 08101 | Pueblo County | 55.6 | 73.0 | 46.6 | 0.91 | 51.5 |
| 177 | 08085 | Montrose County | 54.9 | 76.2 | 41.0 | 0.91 | 50.8 |

## Awarded-County Alignment

| Version | Awarded-county mean score | Non-awarded county mean score | Spread | Awarded n | Non-awarded n |
|---|---:|---:|---:|---:|---:|
| origin/main baseline | 85.1 | 69.7 | 15.4 | 15 | 49 |
| B1 (#997) | 65.9 | 43.8 | 22.1 | 15 | 49 |
| QAP-aligned | 67.1 | 38.4 | 28.7 | 15 | 49 |

Interpretation: the QAP-aligned score should not be read as a direct award predictor. It tracks screenable county-level conditions while awards also depend on site control, local support, execution, project type, QCT/DDA, developer capacity, and application timing.

## Entries Moving More Than 50 Ranks

| Move | GEOID | Name | Type | Old rank | New rank | Old score | New score |
|---:|---|---|---|---:|---:|---:|---:|
| -395 | 08105 | Rio Grande County | county | 142 | 537 | 69.4 | 14.8 |
| -310 | 08121 | Washington County | county | 218 | 528 | 59.6 | 16.1 |
| -307 | 08071 | Las Animas County | county | 102 | 409 | 74.9 | 29.5 |
| -301 | 08089 | Otero County | county | 106 | 407 | 74.5 | 29.8 |
| -299 | 08027 | Custer County | county | 152 | 451 | 67.7 | 25.1 |
| -296 | 08073 | Lincoln County | county | 194 | 490 | 62.2 | 21.0 |
| +292 | 0845680 | Loghill Village (CDP) | cdp | 411 | 119 | 32.5 | 63.5 |
| -286 | 08065 | Lake County | county | 120 | 406 | 72.3 | 30.1 |
| -280 | 08103 | Rio Blanco County | county | 190 | 470 | 63.0 | 22.9 |
| -278 | 08003 | Alamosa County | county | 125 | 403 | 71.7 | 30.4 |
| +276 | 0876190 | Tabernash (CDP) | cdp | 417 | 141 | 32.0 | 59.8 |
| -266 | 08081 | Moffat County | county | 151 | 417 | 67.8 | 29.0 |
| +265 | 0873943 | Sterling Ranch (CDP) | cdp | 435 | 170 | 28.2 | 55.8 |
| +263 | 0876325 | Tall Timber (CDP) | cdp | 472 | 209 | 18.2 | 50.9 |
| -263 | 08023 | Costilla County | county | 186 | 449 | 63.4 | 25.6 |
| -262 | 08009 | Baca County | county | 191 | 453 | 62.8 | 24.9 |
| -261 | 08033 | Dolores County | county | 275 | 536 | 51.5 | 14.8 |
| -261 | 08025 | Crowley County | county | 181 | 442 | 63.9 | 27.0 |
| -258 | 08017 | Cheyenne County | county | 251 | 509 | 55.0 | 19.3 |
| +254 | 0880370 | Valmont (CDP) | cdp | 445 | 191 | 25.5 | 53.4 |
| -253 | 0851635 | Monte Vista (city) | place | 236 | 489 | 57.0 | 21.1 |
| -247 | 08055 | Huerfano County | county | 133 | 380 | 70.6 | 33.0 |
| +245 | 0857445 | Paragon Estates (CDP) | cdp | 460 | 215 | 21.7 | 50.2 |
| +244 | 0853010 | Nathrop (CDP) | cdp | 437 | 193 | 27.4 | 53.2 |
| -240 | 08099 | Prowers County | county | 78 | 318 | 78.7 | 38.5 |
| -238 | 08095 | Phillips County | county | 209 | 447 | 60.3 | 25.8 |
| +235 | 0886200 | Woody Creek (CDP) | cdp | 433 | 198 | 29.3 | 52.2 |
| -235 | 08063 | Kit Carson County | county | 160 | 395 | 66.9 | 31.7 |
| -231 | 08021 | Conejos County | county | 166 | 397 | 66.5 | 31.6 |
| -226 | 08083 | Montezuma County | county | 54 | 280 | 81.6 | 42.4 |
| +225 | 0852820 | Mulford (CDP) | cdp | 459 | 234 | 21.8 | 47.4 |
| +225 | 0844270 | Lazy Acres (CDP) | cdp | 364 | 139 | 38.7 | 60.5 |
| +223 | 0874080 | Stonegate (CDP) | cdp | 240 | 17 | 56.5 | 79.6 |
| +219 | 0823630 | Eldorado Springs (CDP) | cdp | 449 | 230 | 24.1 | 48.2 |
| +217 | 0807410 | Blue River (town) | place | 382 | 165 | 36.5 | 56.9 |
| -216 | 0842110 | La Junta (city) | place | 180 | 396 | 64.0 | 31.7 |
| -212 | 0827040 | Florence (city) | place | 272 | 484 | 51.7 | 21.7 |
| -212 | 08125 | Yuma County | county | 115 | 327 | 72.9 | 37.8 |
| +210 | 0877757 | Todd Creek (CDP) | cdp | 413 | 203 | 32.3 | 51.3 |
| -208 | 0843110 | Lamar (city) | place | 114 | 322 | 73.2 | 38.3 |
| -208 | 08043 | Fremont County | county | 81 | 289 | 77.4 | 41.5 |
| +206 | 0812393 | Castle Pines Village (CDP) | cdp | 339 | 133 | 41.8 | 61.5 |
| -205 | 08053 | Hinsdale County | county | 337 | 542 | 41.9 | 11.9 |
| -203 | 08075 | Logan County | county | 87 | 290 | 77.0 | 41.5 |
| -202 | 08087 | Morgan County | county | 55 | 257 | 81.2 | 45.0 |
| +197 | 0874275 | Stonewall Gap (CDP) | cdp | 452 | 255 | 22.9 | 45.2 |
| -197 | 0882350 | Walsenburg (city) | place | 208 | 405 | 60.4 | 30.4 |
| +196 | 0822575 | East Pleasant View (CDP) | cdp | 424 | 228 | 31.1 | 48.3 |
| +195 | 0844695 | Leyner (CDP) | cdp | 528 | 333 | 6.7 | 37.2 |
| -195 | 08109 | Saguache County | county | 158 | 353 | 67.1 | 35.2 |
| +194 | 0854880 | Norwood (town) | place | 347 | 153 | 40.7 | 58.3 |
| +193 | 0837220 | Holly Hills (CDP) | cdp | 316 | 123 | 45.6 | 63.2 |
| +191 | 0828690 | Frisco (town) | place | 222 | 31 | 59.0 | 76.7 |
| -189 | 08051 | Gunnison County | county | 96 | 285 | 75.5 | 42.1 |
| -189 | 08011 | Bent County | county | 126 | 315 | 71.6 | 38.8 |
| +187 | 0867040 | St. Ann Highlands (CDP) | cdp | 474 | 287 | 17.9 | 42.0 |
| -185 | 08007 | Archuleta County | county | 109 | 294 | 74.1 | 40.9 |
| +183 | 0853945 | Norrie (CDP) | cdp | 521 | 338 | 8.8 | 36.4 |
| -183 | 0826765 | Flagler (town) | place | 324 | 507 | 43.8 | 19.8 |
| +181 | 0883500 | Westcreek (CDP) | cdp | 462 | 281 | 21.5 | 42.4 |
| +181 | 0869110 | Seven Hills (CDP) | cdp | 257 | 76 | 54.0 | 70.1 |
| +181 | 0863705 | Redvale (CDP) | cdp | 476 | 295 | 17.3 | 40.9 |
| +181 | 0838910 | Inverness (CDP) | cdp | 187 | 6 | 63.4 | 84.1 |
| +179 | 0845750 | Loma (CDP) | cdp | 396 | 217 | 34.6 | 49.9 |
| -178 | 0859830 | Pitkin (town) | place | 348 | 526 | 40.6 | 16.5 |
| -178 | 0812855 | Center (town) | place | 327 | 505 | 43.3 | 19.9 |
| +176 | 0844375 | Leadville North (CDP) | cdp | 368 | 192 | 38.4 | 53.2 |
| +175 | 0875585 | Sunshine (CDP) | cdp | 363 | 188 | 38.8 | 53.5 |
| +175 | 0838480 | Idledale (CDP) | cdp | 451 | 276 | 23.0 | 42.9 |
| +174 | 0859240 | Pine Brook Hill (CDP) | cdp | 228 | 54 | 58.1 | 73.2 |
| +172 | 0835070 | Hayden (town) | place | 300 | 128 | 48.2 | 62.2 |
| +172 | 0801740 | Altona (CDP) | cdp | 336 | 164 | 41.9 | 56.9 |
| -171 | 0834960 | Haxtun (town) | place | 184 | 355 | 63.6 | 34.8 |
| +169 | 0859520 | Pine Valley (CDP) | cdp | 514 | 345 | 10.4 | 36.0 |
| +169 | 0800320 | Acres Green (CDP) | cdp | 313 | 144 | 46.4 | 59.3 |
| +168 | 0852210 | Mountain Meadows (CDP) | cdp | 466 | 298 | 20.0 | 40.8 |
| +167 | 0879800 | Upper Witter Gulch (CDP) | cdp | 438 | 271 | 26.6 | 43.2 |
| +167 | 0876795 | Telluride (town) | place | 207 | 40 | 60.4 | 75.0 |
| +167 | 0806602 | Beulah Valley (CDP) | cdp | 398 | 231 | 34.4 | 48.1 |
| -165 | 0873330 | Springfield (town) | place | 259 | 424 | 53.8 | 28.5 |
| +162 | 0840550 | Keystone (CDP) | cdp | 230 | 68 | 57.8 | 70.8 |
| +162 | 0812945 | Chacra (CDP) | cdp | 409 | 247 | 32.8 | 46.0 |
| -162 | 0878610 | Trinidad (city) | place | 108 | 270 | 74.2 | 43.3 |
| +161 | 0870112 | Sierra Ridge (CDP) | cdp | 170 | 9 | 65.1 | 81.6 |
| +161 | 0841560 | Kremmling (town) | place | 239 | 78 | 56.6 | 69.8 |
| +161 | 0829625 | Genesee (CDP) | cdp | 205 | 44 | 60.8 | 74.7 |
| -160 | 08097 | Pitkin County | county | 58 | 218 | 81.0 | 49.7 |
| +159 | 0865685 | Rollinsville (CDP) | cdp | 442 | 283 | 25.9 | 42.3 |
| -159 | 08039 | Elbert County | county | 89 | 248 | 76.9 | 45.9 |
| +158 | 0858592 | Perry Park (CDP) | cdp | 403 | 245 | 33.3 | 46.1 |
| -157 | 08115 | Sedgwick County | county | 168 | 325 | 65.8 | 37.9 |
| +156 | 0886117 | Woodmoor (CDP) | cdp | 219 | 63 | 59.6 | 72.0 |
| -156 | 08111 | San Juan County | county | 305 | 461 | 47.3 | 24.4 |
| +155 | 0879785 | Upper Bear Creek (CDP) | cdp | 291 | 136 | 49.8 | 61.0 |
| +154 | 0885155 | Williamsburg (town) | place | 389 | 235 | 35.9 | 47.4 |
| -154 | 0827810 | Fort Morgan (city) | place | 107 | 261 | 74.2 | 44.8 |
| +153 | 0859885 | Placerville (CDP) | cdp | 455 | 302 | 22.8 | 40.4 |
| +153 | 0841065 | Kittredge (CDP) | cdp | 454 | 301 | 22.8 | 40.4 |
| -153 | 0809555 | Brush (city) | place | 110 | 263 | 74.0 | 44.6 |
| -153 | 08061 | Kiowa County | county | 286 | 439 | 50.5 | 27.3 |
| -153 | 08047 | Gilpin County | county | 150 | 303 | 67.8 | 40.3 |
| +152 | 0872320 | Southern Ute (CDP) | cdp | 484 | 332 | 15.5 | 37.3 |
| +152 | 0860765 | Portland (CDP) | cdp | 499 | 347 | 12.2 | 35.9 |
| +152 | 0850026 | Meridian Village (CDP) | cdp | 203 | 51 | 61.0 | 73.8 |
| +151 | 0881305 | Vineland (CDP) | cdp | 428 | 277 | 30.3 | 42.8 |
| +149 | 0853875 | No Name (CDP) | cdp | 422 | 273 | 31.2 | 43.1 |
| -145 | 0886310 | Wray (city) | place | 214 | 359 | 59.9 | 34.7 |
| -145 | 0817760 | Craig (city) | place | 175 | 320 | 64.4 | 38.3 |
| -144 | 08101 | Pueblo County | county | 28 | 172 | 86.0 | 55.6 |
| +141 | 0848940 | Marvel (CDP) | cdp | 489 | 348 | 14.5 | 35.8 |
| +140 | 0839800 | Johnson Village (CDP) | cdp | 446 | 306 | 24.6 | 39.7 |
| +139 | 0816385 | Columbine Valley (town) | place | 406 | 267 | 33.0 | 43.7 |
| -139 | 0820495 | Dinosaur (town) | place | 342 | 481 | 41.2 | 22.2 |
| -138 | 0865190 | Rocky Ford (city) | place | 171 | 309 | 64.7 | 39.5 |
| -138 | 0864255 | Rifle (city) | place | 174 | 312 | 64.6 | 39.1 |
| -137 | 0848115 | Mancos (town) | place | 237 | 374 | 56.9 | 33.4 |
| +135 | 0857850 | Parshall (CDP) | cdp | 304 | 169 | 47.4 | 56.4 |
| -135 | 0874485 | Stratton (town) | place | 290 | 425 | 49.8 | 28.4 |
| -135 | 0811260 | Calhan (town) | place | 254 | 389 | 54.6 | 32.4 |
| +134 | 0879105 | Twin Lakes CDP (Lake County) | cdp | 453 | 319 | 22.9 | 38.4 |
| +132 | 0883175 | Weldona (CDP) | cdp | 490 | 358 | 14.2 | 34.7 |
| +131 | 0858785 | Phippsburg (CDP) | cdp | 482 | 351 | 15.7 | 35.6 |
| -130 | 0807190 | Blanca (town) | place | 393 | 523 | 35.0 | 17.7 |
| +129 | 0885760 | Wolcott (CDP) | cdp | 470 | 341 | 18.5 | 36.3 |
| +129 | 0874980 | Sugarloaf (CDP) | cdp | 343 | 214 | 41.2 | 50.3 |
| -129 | 0839855 | Johnstown (town) | place | 135 | 264 | 70.5 | 44.1 |
| +127 | 0880040 | Vail (town) | place | 139 | 12 | 69.9 | 81.0 |
| -127 | 0821265 | Dove Creek (town) | place | 352 | 479 | 40.1 | 22.4 |
| +126 | 0875640 | Superior (town) | place | 197 | 71 | 61.6 | 70.3 |
| -126 | 0848060 | Manassa (town) | place | 274 | 400 | 51.7 | 30.7 |
| -126 | 0813460 | Cheraw (town) | place | 405 | 531 | 33.0 | 15.6 |
| -126 | 0808345 | Branson (town) | place | 401 | 527 | 33.4 | 16.3 |
| +125 | 0877235 | The Pinery (CDP) | cdp | 241 | 116 | 56.5 | 64.3 |
| -125 | 0811810 | Cañon City (city) | place | 118 | 243 | 72.7 | 46.6 |
| +124 | 0852570 | Mount Crested Butte (town) | place | 309 | 185 | 46.8 | 53.7 |
| +124 | 0850380 | Midland (CDP) | cdp | 450 | 326 | 23.8 | 37.9 |
| +124 | 0845530 | Lochbuie (town) | place | 279 | 155 | 51.0 | 57.9 |
| -124 | 0804165 | Avondale (CDP) | cdp | 414 | 538 | 32.2 | 14.6 |
| +123 | 0847345 | McCoy (CDP) | cdp | 525 | 402 | 7.7 | 30.5 |
| +122 | 0856420 | Ouray (city) | place | 302 | 180 | 47.8 | 54.2 |
| -121 | 0818530 | Cripple Creek (city) | place | 138 | 259 | 70.0 | 44.9 |
| -121 | 0803950 | Ault (town) | place | 216 | 337 | 59.7 | 36.5 |
| +120 | 0853175 | Nederland (town) | place | 299 | 179 | 48.3 | 54.2 |
| +119 | 0863650 | Redstone (CDP) | cdp | 488 | 369 | 14.6 | 33.6 |
| +118 | 0839745 | Joes (CDP) | cdp | 491 | 373 | 14.0 | 33.4 |
| +117 | 0864200 | Ridgway (town) | place | 247 | 130 | 55.8 | 61.6 |
| +117 | 0835400 | Heeney (CDP) | cdp | 355 | 238 | 39.8 | 46.9 |
| +117 | 0812470 | Cattle Creek (CDP) | cdp | 198 | 81 | 61.4 | 69.0 |
| +116 | 0850920 | Minturn (town) | place | 212 | 96 | 60.2 | 67.2 |
| +115 | 0808070 | Bow Mar (town) | place | 331 | 216 | 42.9 | 49.9 |
| -115 | 0851745 | Montrose (city) | place | 60 | 175 | 80.8 | 55.1 |
| +113 | 0828105 | Foxfield (town) | place | 295 | 182 | 49.0 | 54.0 |
| -113 | 0873935 | Sterling (city) | place | 95 | 208 | 76.0 | 50.9 |
| -113 | 0831550 | Granada (town) | place | 322 | 435 | 44.5 | 27.7 |
| -113 | 0817375 | Cortez (city) | place | 76 | 189 | 78.9 | 53.4 |
| +112 | 0845955 | Lone Tree (city) | place | 137 | 25 | 70.2 | 77.1 |
| -112 | 0831715 | Grand Lake (town) | place | 418 | 530 | 31.9 | 15.8 |
| -112 | 0819795 | Del Norte (town) | place | 248 | 360 | 55.5 | 34.5 |
| -112 | 08045 | Garfield County | county | 75 | 187 | 79.2 | 53.5 |
| +111 | 0860600 | Poncha Springs (town) | place | 395 | 284 | 34.9 | 42.2 |
| -111 | 0875970 | Swink (town) | place | 225 | 336 | 58.5 | 36.7 |
| -111 | 0803235 | Arriba (town) | place | 429 | 540 | 30.1 | 13.7 |
| -110 | 0837215 | Holly (town) | place | 284 | 394 | 50.6 | 31.8 |
| -110 | 0833310 | Grover (town) | place | 319 | 429 | 44.7 | 28.2 |
| -110 | 08085 | Montrose County | county | 67 | 177 | 80.1 | 54.9 |
| +109 | 0801145 | Alamosa East (CDP) | cdp | 285 | 176 | 50.5 | 55.0 |
| -109 | 0824235 | Ellicott (CDP) | cdp | 307 | 416 | 47.0 | 29.1 |
| -109 | 08019 | Clear Creek County | county | 77 | 186 | 78.8 | 53.5 |
| +108 | 0864870 | Rock Creek Park (CDP) | cdp | 485 | 377 | 15.1 | 33.2 |
| -108 | 08049 | Grand County | county | 103 | 211 | 74.8 | 50.4 |
| -106 | 0868105 | San Luis (town) | place | 361 | 467 | 39.1 | 23.9 |
| -106 | 0844980 | Limon (town) | place | 264 | 370 | 52.9 | 33.5 |
| -106 | 0812910 | Central City (city) | place | 223 | 329 | 58.5 | 37.7 |
| +105 | 0871625 | Smeltertown (CDP) | cdp | 371 | 266 | 37.9 | 43.8 |
| +105 | 0804935 | Basalt (town) | place | 189 | 84 | 63.0 | 68.6 |
| +104 | 0820440 | Dillon (town) | place | 262 | 158 | 53.3 | 57.6 |
| +103 | 0828250 | Franktown (CDP) | cdp | 457 | 354 | 22.1 | 34.9 |
| -103 | 0872395 | South Fork (town) | place | 436 | 539 | 28.0 | 14.4 |
| -103 | 0814175 | Cheyenne Wells (town) | place | 345 | 448 | 40.9 | 25.8 |
| -103 | 0807025 | Black Hawk (city) | place | 431 | 534 | 29.8 | 15.1 |
| +101 | 0870195 | Silt (town) | place | 213 | 112 | 60.0 | 64.6 |
| +101 | 0866995 | Saddle Ridge (CDP) | cdp | 479 | 378 | 16.6 | 33.2 |
| +101 | 0831935 | Grand View Estates (CDP) | cdp | 512 | 411 | 10.9 | 29.4 |
| +100 | 0860655 | Ponderosa Park (CDP) | cdp | 321 | 221 | 44.6 | 49.2 |
| +100 | 0856035 | Orchard Mesa (CDP) | cdp | 159 | 59 | 67.0 | 72.5 |
| +100 | 0821390 | Downieville-Lawson-Dumont (CDP) | cdp | 211 | 111 | 60.3 | 64.7 |
| +100 | 0810985 | Byers (CDP) | cdp | 399 | 299 | 34.4 | 40.7 |
| -100 | 0810600 | Burlington (city) | place | 288 | 388 | 50.3 | 32.5 |
| -100 | 0806530 | Bethune (town) | place | 359 | 459 | 39.3 | 24.5 |
| +99 | 0833502 | Gunbarrel (CDP) | cdp | 136 | 37 | 70.3 | 75.7 |
| +99 | 0813590 | Cherry Creek (CDP) | cdp | 161 | 62 | 66.9 | 72.1 |
| -99 | 0801090 | Alamosa (city) | place | 147 | 246 | 68.4 | 46.0 |
| +98 | 0866197 | Roxborough Park (CDP) | cdp | 202 | 104 | 61.2 | 65.5 |
| +98 | 0857025 | Palmer Lake (town) | place | 303 | 205 | 47.5 | 51.1 |
| +97 | 0885705 | Winter Park (town) | place | 280 | 183 | 51.0 | 53.9 |
| +97 | 0852350 | Mountain View (town) | place | 379 | 282 | 37.0 | 42.3 |
| +97 | 0849490 | Maysville (CDP) | cdp | 242 | 145 | 56.2 | 59.1 |
| +96 | 0823575 | Eldora (CDP) | cdp | 255 | 159 | 54.5 | 57.5 |
| -96 | 0842330 | Lake City (town) | place | 439 | 535 | 26.3 | 15.0 |
| -96 | 08077 | Mesa County | county | 36 | 132 | 84.1 | 61.5 |
| -95 | 0862000 | Pueblo (city) | place | 18 | 113 | 87.7 | 64.5 |
| +94 | 0839250 | Jansen (CDP) | cdp | 492 | 398 | 13.9 | 31.3 |
| +94 | 0823520 | Elbert (CDP) | cdp | 444 | 350 | 25.5 | 35.6 |
| -94 | 0800925 | Akron (town) | place | 268 | 362 | 52.5 | 34.3 |
| +92 | 0828800 | Fruitvale (CDP) | cdp | 199 | 107 | 61.4 | 64.9 |
| +91 | 0854495 | North La Junta (CDP) | cdp | 402 | 311 | 33.4 | 39.1 |
| -91 | 0855045 | Nunn (town) | place | 243 | 334 | 56.1 | 37.1 |
| -91 | 0800760 | Aguilar (town) | place | 420 | 511 | 31.7 | 19.0 |
| +90 | 0873925 | Stepping Stone (CDP) | cdp | 447 | 357 | 24.5 | 34.7 |
| +90 | 0851975 | Morgan Heights (CDP) | cdp | 511 | 421 | 11.0 | 28.7 |
| -90 | 0869040 | Seibert (town) | place | 430 | 520 | 29.9 | 18.0 |
| +89 | 0884042 | West Pleasant View (CDP) | cdp | 154 | 65 | 67.5 | 71.7 |
| +89 | 0821155 | Dotsero (CDP) | cdp | 468 | 379 | 18.7 | 33.1 |
| -89 | 0862880 | Rangely (town) | place | 325 | 414 | 43.8 | 29.2 |
| -88 | 08041 | El Paso County | county | 11 | 99 | 89.0 | 66.8 |
| +86 | 0871790 | Snyder (CDP) | cdp | 509 | 423 | 11.3 | 28.5 |
| -86 | 0837875 | Hugo (town) | place | 332 | 418 | 42.9 | 29.0 |
| -86 | 08015 | Chaffee County | county | 41 | 127 | 83.7 | 62.4 |
| +85 | 0854935 | Nucla (town) | place | 354 | 269 | 40.1 | 43.5 |
| -85 | 0842055 | La Jara (town) | place | 282 | 367 | 50.8 | 33.8 |
| -84 | 0820000 | Denver (city) | place | 26 | 110 | 86.1 | 64.8 |
| -84 | 08113 | San Miguel County | county | 97 | 181 | 75.3 | 54.0 |
| +83 | 0858510 | Peoria (CDP) | cdp | 388 | 305 | 35.9 | 40.1 |
| +83 | 0825550 | Fairmount (CDP) | cdp | 163 | 80 | 66.7 | 69.1 |
| -83 | 0878280 | Towaoc (CDP) | cdp | 377 | 460 | 37.2 | 24.5 |
| -83 | 0863045 | Raymer (New Raymer) (town) | place | 367 | 450 | 38.5 | 25.2 |
| -82 | 0869700 | Sheridan Lake (town) | place | 375 | 457 | 37.4 | 24.8 |
| +81 | 0886090 | Woodland Park (city) | place | 101 | 20 | 75.0 | 78.4 |
| +81 | 0884000 | Weston (CDP) | cdp | 500 | 419 | 12.1 | 29.0 |
| +81 | 0870525 | Silverthorne (town) | place | 86 | 5 | 77.2 | 84.2 |
| -81 | 0857300 | Paonia (town) | place | 261 | 342 | 53.5 | 36.1 |
| -80 | 0851800 | Monument (town) | place | 130 | 210 | 70.8 | 50.6 |
| -80 | 0837380 | Hooper (town) | place | 467 | 547 | 19.0 | 6.7 |
| -79 | 0827865 | Fountain (city) | place | 12 | 91 | 88.7 | 67.8 |
| -79 | 0814587 | Cimarron Hills (CDP) | cdp | 42 | 121 | 83.7 | 63.3 |
| -79 | 0808675 | Brighton (city) | place | 38 | 117 | 84.0 | 64.2 |
| +78 | 0869150 | Severance (town) | place | 256 | 178 | 54.2 | 54.9 |
| +78 | 0867142 | St. Mary's (CDP) | cdp | 317 | 239 | 45.4 | 46.9 |
| -78 | 0827700 | Fort Lupton (city) | place | 72 | 150 | 79.7 | 58.6 |
| -78 | 0819850 | Delta (city) | place | 59 | 137 | 80.8 | 60.8 |
| +77 | 0830340 | Glendale (city) | place | 93 | 16 | 76.2 | 80.2 |
| -77 | 0864090 | Rico (town) | place | 397 | 474 | 34.6 | 22.8 |
| -77 | 0839965 | Julesburg (town) | place | 215 | 292 | 59.8 | 41.4 |
| -77 | 0829680 | Genoa (town) | place | 400 | 477 | 34.2 | 22.7 |
| +76 | 0829185 | Garden City (town) | place | 250 | 174 | 55.1 | 55.4 |
| +76 | 0824950 | Erie (town) | place | 143 | 67 | 69.1 | 70.8 |
| -76 | 0861315 | Pritchett (town) | place | 346 | 422 | 40.9 | 28.6 |
| +75 | 0832650 | Green Mountain Falls (town) | place | 410 | 335 | 32.5 | 37.0 |
| +75 | 0813845 | Cherry Hills Village (city) | place | 167 | 92 | 66.1 | 67.4 |
| -75 | 0862660 | Ramah (town) | place | 315 | 390 | 46.0 | 32.4 |
| -75 | 0849875 | Meeker (town) | place | 296 | 371 | 49.0 | 33.5 |
| -75 | 08067 | La Plata County | county | 47 | 122 | 82.8 | 63.2 |
| +74 | 0856695 | Padroni (CDP) | cdp | 487 | 413 | 14.9 | 29.2 |
| -74 | 0881690 | Vona (town) | place | 469 | 543 | 18.6 | 11.1 |
| -74 | 08031 | Denver County | county | 32 | 106 | 85.3 | 65.0 |
| +73 | 0880755 | Vernon (CDP) | cdp | 506 | 433 | 11.6 | 27.9 |
| +73 | 0823795 | El Jebel (CDP) | cdp | 111 | 38 | 73.8 | 75.3 |
| +73 | 0815825 | Colona (CDP) | cdp | 538 | 465 | 3.4 | 24.0 |
| +73 | 0803840 | Atwood (CDP) | cdp | 539 | 466 | 3.2 | 23.9 |
| -73 | 0845695 | Log Lane Village (town) | place | 314 | 387 | 46.0 | 32.6 |
| +71 | 0834685 | Hasty (CDP) | cdp | 394 | 323 | 34.9 | 38.2 |
| -71 | 08123 | Weld County | county | 22 | 93 | 86.4 | 67.3 |
| +70 | 0840377 | Ken Caryl (CDP) | cdp | 94 | 24 | 76.2 | 77.3 |
| +70 | 0837655 | Howard (CDP) | cdp | 416 | 346 | 32.0 | 35.9 |
| -70 | 0856145 | Ordway (town) | place | 192 | 262 | 62.8 | 44.8 |
| +68 | 0871845 | Somerset (CDP) | cdp | 504 | 436 | 11.8 | 27.7 |
| +68 | 0843605 | La Salle (town) | place | 224 | 156 | 58.5 | 57.8 |
| +68 | 0840185 | Keenesburg (town) | place | 269 | 201 | 52.3 | 51.4 |
| +68 | 0804620 | Bark Ranch (CDP) | cdp | 505 | 437 | 11.7 | 27.6 |
| -68 | 0812900 | Central (city) | place | 260 | 328 | 53.6 | 37.7 |
| -68 | 08037 | Eagle County | county | 15 | 83 | 88.2 | 68.6 |
| +67 | 0843550 | Larkspur (town) | place | 323 | 256 | 44.0 | 45.1 |
| +67 | 0829955 | Gilcrest (town) | place | 233 | 166 | 57.6 | 56.9 |
| +67 | 0828305 | Fraser (town) | place | 311 | 244 | 46.6 | 46.6 |
| -67 | 0885045 | Wiley (town) | place | 426 | 493 | 30.5 | 20.9 |
| -67 | 0862220 | Pueblo West (CDP) | cdp | 100 | 167 | 75.0 | 56.8 |
| +66 | 0880095 | Valdez (CDP) | cdp | 465 | 399 | 20.9 | 31.2 |
| -66 | 0882460 | Walsh (town) | place | 320 | 386 | 44.7 | 32.7 |
| -66 | 0866895 | Rye (town) | place | 318 | 384 | 44.9 | 32.8 |
| -66 | 08117 | Summit County | county | 88 | 154 | 77.0 | 58.2 |
| -66 | 0807795 | Boone (town) | place | 390 | 456 | 35.5 | 24.8 |
| +65 | 0882130 | Walden (town) | place | 265 | 200 | 52.9 | 51.7 |
| +65 | 0812030 | Carbonate (town) | place | 540 | 475 | 2.8 | 22.7 |
| -65 | 0831660 | Grand Junction (city) | place | 50 | 115 | 81.9 | 64.3 |
| +64 | 0846355 | Louisville (city) | place | 92 | 28 | 76.4 | 76.9 |
| +64 | 0820275 | Derby (CDP) | cdp | 210 | 146 | 60.3 | 59.0 |
| +63 | 0852550 | Mountain Village (town) | place | 164 | 101 | 66.7 | 66.3 |
| -63 | 0817100 | Cope (CDP) | cdp | 365 | 428 | 38.6 | 28.2 |
| +62 | 0878335 | Towner (CDP) | cdp | 494 | 432 | 13.6 | 27.9 |
| +62 | 0863320 | Red Feather Lakes (CDP) | cdp | 434 | 372 | 28.4 | 33.5 |
| +62 | 0853120 | Naturita (town) | place | 182 | 120 | 63.8 | 63.5 |
| +62 | 0838810 | Indian Hills (CDP) | cdp | 353 | 291 | 40.1 | 41.5 |
| +62 | 0800620 | Aetna Estates (CDP) | cdp | 358 | 296 | 39.3 | 40.8 |
| -62 | 0885485 | Windsor (town) | place | 27 | 89 | 86.1 | 67.9 |
| -62 | 0843660 | Las Animas (city) | place | 145 | 207 | 68.6 | 50.9 |
| +61 | 0855870 | Ophir (town) | place | 385 | 324 | 36.2 | 38.2 |
| +61 | 0844595 | Lewis (CDP) | cdp | 516 | 455 | 10.0 | 24.9 |
| +61 | 0830350 | Glendale (CDP) | cdp | 533 | 472 | 5.0 | 22.8 |
| -61 | 0874815 | Sugar City (town) | place | 408 | 469 | 33.0 | 23.6 |
| -61 | 0848500 | Manzanola (town) | place | 412 | 473 | 32.4 | 22.8 |
| -61 | 0839195 | Jamestown (town) | place | 373 | 434 | 37.6 | 27.8 |
| +60 | 0839160 | Jackson Lake (CDP) | cdp | 301 | 241 | 48.1 | 46.7 |
| -60 | 0818750 | Crowley (town) | place | 380 | 440 | 36.8 | 27.1 |
| -60 | 0817925 | Crawford (town) | place | 423 | 483 | 31.1 | 21.8 |
| -60 | 08093 | Park County | county | 134 | 194 | 70.5 | 53.1 |
| -59 | 0815330 | Coal Creek (town) | place | 306 | 365 | 47.0 | 33.9 |
| -59 | 0806090 | Bennett (town) | place | 293 | 352 | 49.2 | 35.4 |
| -59 | 08001 | Adams County | county | 7 | 66 | 89.9 | 71.5 |
| +58 | 0882900 | Watkins (CDP) | cdp | 372 | 314 | 37.8 | 38.9 |
| +58 | 0830780 | Glenwood Springs (city) | place | 105 | 47 | 74.6 | 74.1 |
| +58 | 0800870 | Air Force Academy (CDP) | cdp | 229 | 171 | 57.8 | 55.6 |
| -58 | 0863265 | Red Cliff (town) | place | 334 | 392 | 42.3 | 32.1 |
| +57 | 0870360 | Silver Plume (town) | place | 461 | 404 | 21.5 | 30.4 |
| -57 | 0836610 | Hillrose (town) | place | 369 | 426 | 38.3 | 28.3 |
| -57 | 0822200 | Eagle (town) | place | 69 | 126 | 79.8 | 62.6 |
| +56 | 0844265 | Lazear (CDP) | cdp | 520 | 464 | 9.5 | 24.1 |
| +56 | 0833035 | Greenwood Village (city) | place | 90 | 34 | 76.7 | 76.0 |
| -56 | 0849325 | Maybell (CDP) | cdp | 374 | 430 | 37.6 | 28.1 |
| +55 | 0828830 | Fulford (CDP) | cdp | 531 | 476 | 5.2 | 22.7 |
| -55 | 0868930 | Sedgwick (town) | place | 443 | 498 | 25.8 | 20.4 |
| -54 | 0803620 | Aspen (city) | place | 33 | 87 | 85.3 | 68.3 |
| +53 | 0886475 | Yampa (town) | place | 370 | 317 | 38.3 | 38.6 |
| +53 | 0818585 | Crisman (CDP) | cdp | 419 | 366 | 31.8 | 33.8 |
| -53 | 0850480 | Milliken (town) | place | 146 | 199 | 68.6 | 51.7 |
| -53 | 0802355 | Antonito (town) | place | 310 | 363 | 46.6 | 34.1 |
| +52 | 0869480 | Shaw Heights (CDP) | cdp | 85 | 33 | 77.2 | 76.6 |
| +52 | 0855705 | Olney Springs (town) | place | 391 | 339 | 35.5 | 36.4 |
| +52 | 0830835 | Golden (city) | place | 63 | 11 | 80.4 | 81.0 |
| -52 | 0846465 | Loveland (city) | place | 4 | 56 | 90.7 | 72.8 |
