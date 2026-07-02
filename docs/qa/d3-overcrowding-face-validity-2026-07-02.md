# D-3 Overcrowding Face-Validity Report

Generated: 2026-07-02

Baseline: origin/main ranking-index (2026-06-30T02:49:09Z)
Candidate: D-3 regenerated ranking-index (2026-07-02T20:43:24Z)

## Coverage

| Check | Origin/main | D-3 candidate | Delta |
|---|---|---|---|
| Ranking entries | 547 | 547 | 0 |
| overcrowding_rate numeric coverage | 0 | 477 | 477 |
| overcrowding_score field populated | 0 | 477 | 477 |
| overcrowding_rate missing / excluded from core | 0 | 70 | 70 |
| hasIncompleteData entries | 330 | 330 | 0 |
| nullCriticalMetrics total | 333 | 333 | 0 |
| entries with imputed score factors | 330 | 330 | 0 |

Community-need contribution check: D-3 adds `overcrowding_score` to `COMMUNITY_NEED_WEIGHTS` at 0.10 and includes it in `community_need_core_score`. The rate has real denominator-qualified coverage for 477 geographies (up from 0). For the 70 geographies with missing or below-floor overcrowding data, the overcrowding term is passed to `_weighted_average` as `None`, so the core re-normalizes around the four present factors instead of treating missing data as a zero score.

Missing-data spot check: Parshall CDP (`0857850`) has `overcrowding_rate=n/a` and `overcrowding_score=n/a`, with community core 58.1 computed from the other present factors.

Data-quality note: `hasIncompleteData` did not drop in this rebuild (330 -> 330). The remaining flags are unchanged existing imputed score factors/null critical ACS fields, not the new overcrowding fields.

## Top 20 Counties

| # | Before | Rank | Score | After | Rank | Score | Crowd rate | Crowd score |
|---|---|---|---|---|---|---|---|---|
| 1 | Jefferson County | 10 | 84 | Jefferson County | 9 | 84 | 1.4 | 33.3 |
| 2 | Boulder County | 12 | 83.5 | Boulder County | 17 | 81.9 | 1.6 | 38.1 |
| 3 | Arapahoe County | 30 | 79.1 | Arapahoe County | 27 | 79.9 | 3.4 | 79.4 |
| 4 | Douglas County | 34 | 78.4 | Douglas County | 45 | 76.7 | 1.4 | 28.6 |
| 5 | Larimer County | 55 | 74.9 | Adams County | 49 | 76.3 | 4.2 | 93.7 |
| 6 | Adams County | 65 | 73.8 | Larimer County | 58 | 74.9 | 1.3 | 25.4 |
| 7 | Teller County | 67 | 73.1 | Weld County | 67 | 73.7 | 3 | 73 |
| 8 | Routt County | 72 | 72.4 | Eagle County | 70 | 73.3 | 3.9 | 90.5 |
| 9 | Broomfield County | 76 | 72.1 | Teller County | 78 | 71.4 | 1.1 | 22.2 |
| 10 | Eagle County | 83 | 70.9 | Broomfield County | 88 | 70.4 | 1.1 | 20.6 |
| 11 | Delta County | 89 | 70.1 | El Paso County | 94 | 69 | 1.9 | 44.4 |
| 12 | Weld County | 93 | 69.5 | Delta County | 98 | 68.4 | 1.6 | 39.7 |
| 13 | El Paso County | 98 | 69 | Routt County | 100 | 68.3 | 1 | 19 |
| 14 | Denver County | 105 | 67.1 | Denver County | 101 | 68 | 3.2 | 76.2 |
| 15 | La Plata County | 120 | 65.3 | La Plata County | 124 | 65.3 | 2 | 52.4 |
| 16 | Chaffee County | 126 | 64.4 | Mesa County | 127 | 64.3 | 1.9 | 46 |
| 17 | Mesa County | 131 | 63.5 | Chaffee County | 138 | 61.9 | 0.1 | 3.2 |
| 18 | Summit County | 150 | 60.3 | Summit County | 141 | 61.8 | 2.8 | 68.3 |
| 19 | Pueblo County | 169 | 57.5 | San Miguel County | 153 | 59.9 | 3.5 | 82.5 |
| 20 | Montrose County | 176 | 56.7 | Pueblo County | 169 | 57.5 | 2.2 | 61.9 |

## Top 20 Places

| # | Before | Rank | Score | After | Rank | Score | Crowd rate | Crowd score |
|---|---|---|---|---|---|---|---|---|
| 1 | Steamboat Springs (city) | 1 | 89.1 | Steamboat Springs (city) | 1 | 88.5 | 0.8 | 41.5 |
| 2 | Boulder (city) | 2 | 88.7 | Boulder (city) | 2 | 88.4 | 1.1 | 46.1 |
| 3 | Parker (town) | 3 | 88.4 | Parker (town) | 3 | 88.2 | 2.1 | 64 |
| 4 | Silverthorne (town) | 6 | 87 | Silverthorne (town) | 6 | 87.2 | 3.4 | 76.7 |
| 5 | Lafayette (city) | 7 | 85.4 | Lafayette (city) | 7 | 86.1 | 2.8 | 69.8 |
| 6 | Fort Collins (city) | 8 | 84.5 | Avon (town) | 8 | 85.5 | 5.3 | 86.8 |
| 7 | Vail (town) | 11 | 83.7 | Glendale (city) | 10 | 83.9 | 3.8 | 79.8 |
| 8 | Golden (city) | 13 | 83.5 | Littleton (city) | 13 | 83.1 | 1.7 | 56.2 |
| 9 | Littleton (city) | 14 | 82.9 | Fort Collins (city) | 14 | 82.5 | 0.9 | 43 |
| 10 | Avon (town) | 15 | 82.7 | Vail (town) | 15 | 82.4 | 1.8 | 57.8 |
| 11 | Glendale (city) | 16 | 82.5 | Federal Heights (city) | 16 | 82.1 | 8.2 | 93.4 |
| 12 | Federal Heights (city) | 18 | 81.9 | Golden (city) | 18 | 81.9 | 0.9 | 43.4 |
| 13 | Thornton (city) | 19 | 81.2 | Thornton (city) | 19 | 81.5 | 3.4 | 77.1 |
| 14 | Woodland Park (city) | 20 | 81 | Lakewood (city) | 20 | 81.4 | 2.7 | 69.4 |
| 15 | Longmont (city) | 21 | 80.6 | Woodland Park (city) | 22 | 80.6 | 0.6 | 38.4 |
| 16 | Lakewood (city) | 23 | 80.2 | Longmont (city) | 25 | 80.2 | 2.1 | 62.8 |
| 17 | Lone Tree (city) | 25 | 79.7 | Aurora (city) | 28 | 79.9 | 5.2 | 85.3 |
| 18 | Centennial (city) | 26 | 79.3 | Englewood (city) | 29 | 79.9 | 2.5 | 67.1 |
| 19 | Louisville (city) | 27 | 79.3 | Lone Tree (city) | 31 | 79.9 | 2.1 | 62.4 |
| 20 | Frisco (town) | 29 | 79.2 | Greenwood Village (city) | 32 | 79.6 | 2.9 | 70.5 |

## Movers Greater Than 50 Ranks

| Geography | Type | Old rank | New rank | Move | Old score | New score | Crowd rate | Crowd score |
|---|---|---|---|---|---|---|---|---|
| Manassa (town) (0848060) | place | 400 | 336 | +64 | 31.8 | 37.3 | 10 | 96.1 |
| Conejos County (08021) | county | 396 | 334 | +62 | 32.6 | 37.5 | 5.2 | 100 |
| Chacra (CDP) (0812945) | cdp | 241 | 299 | -58 | 47.7 | 42.1 | 0 | 7.2 |
| Crowley (town) (0818750) | place | 439 | 382 | +57 | 27.9 | 33.9 | 10.5 | 96.5 |
| Beulah Valley (CDP) (0806602) | cdp | 231 | 287 | -56 | 49.8 | 43.1 | 0 | 3.9 |
| Alma (town) (0801530) | place | 318 | 373 | -55 | 39.6 | 34.9 | 0 | 0 |
| Mineral County (08079) | county | 290 | 236 | +54 | 42.5 | 48.9 | 4.7 | 96.8 |
| Eckley (town) (0823025) | place | 420 | 366 | +54 | 29.5 | 35.3 | 7.6 | 91.5 |
| Granada (town) (0831550) | place | 431 | 377 | +54 | 28.6 | 34.3 | 13 | 98.1 |
| Aetna Estates (CDP) (0800620) | cdp | 294 | 241 | +53 | 42.2 | 48.5 | 25.5 | 99.3 |
| Segundo (CDP) (0868985) | cdp | 401 | 348 | +53 | 31.8 | 36.4 | 23.7 | 98.7 |
| Silver Plume (town) (0870360) | place | 403 | 351 | +52 | 31.4 | 36.1 | 7.8 | 91.9 |
| Gold Hill (CDP) (0830945) | cdp | 244 | 295 | -51 | 47.4 | 42.3 | 0 | 17.6 |
| Red Feather Lakes (CDP) (0863320) | cdp | 374 | 323 | +51 | 34.3 | 39.1 | 5 | 89.5 |

## Explicit Checks

| Geography | Type | Old rank | New rank | Move | Old score | New score | Crowd rate | Crowd score | Community core | Community axis | Incomplete? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baca County (08009) | county | 452 | 466 | -14 | 25.7 | 24.1 | 0.5 | 6.3 | 26.9 | 4.8 | no |
| Sedgwick County (08115) | county | 325 | 335 | -10 | 39.2 | 37.5 | 2.3 | 63.5 | 43.4 | 31.7 | no |
| Denver County (08031) | county | 105 | 101 | +4 | 67.1 | 68 | 3.2 | 76.2 | 62 | 81 | no |
| Denver (city) (0820000) | place | 110 | 95 | +15 | 66.9 | 68.9 | 3.2 | 73.6 | 65 | 79 | no |
| Parshall (CDP) (0857850) | cdp | 168 | 172 | -4 | 57.7 | 57 | n/a | n/a | 58.1 | 71.3 | yes |

## Highest Overcrowding Rates

| Geography | Type | Rank | Score | Crowd rate | Crowd score | Community core |
|---|---|---|---|---|---|---|
| Dinosaur (town) (0820495) | place | 427 | 29.1 | 67.7 | 100 | 36.8 |
| Coaldale (CDP) (0815440) | cdp | 472 | 23.2 | 30.4 | 100 | 40.5 |
| Hudson (town) (0837820) | place | 184 | 54.9 | 27.6 | 99.6 | 55.1 |
| Aetna Estates (CDP) (0800620) | cdp | 241 | 48.5 | 25.5 | 99.3 | 55.2 |
| Segundo (CDP) (0868985) | cdp | 348 | 36.4 | 23.7 | 98.7 | 37.4 |
| Idledale (CDP) (0838480) | cdp | 229 | 49.7 | 19.7 | 98 | 45.5 |
| Pitkin (town) (0859830) | place | 481 | 22.5 | 17.6 | 99.2 | 37.5 |
| Hooper (town) (0837380) | place | 544 | 9.3 | 16 | 98.8 | 20.8 |
| Hotchkiss (town) (0837545) | place | 140 | 61.9 | 14 | 98.4 | 80.1 |
| Empire (town) (0824620) | place | 180 | 55.3 | 13 | 97.7 | 55.9 |
