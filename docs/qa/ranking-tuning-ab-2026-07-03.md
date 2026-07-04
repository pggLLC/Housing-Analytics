# Ranking Tuning A+B Face-Validity Report

Generated: 2026-07-03
Base: current `origin/main` before applying A+B tuning
Candidate: `GAP_COUNT_WEIGHT=0.40`, `GAP_RATE_WEIGHT=0.60`, `COMMUTER_AUGMENT_ALPHA=0.20`

## Summary

- Re-rank completed across 547 entries.
- No jurisdiction moved more than 50 ranks.
- The intended direction is visible but not destabilizing: high gap-rate / smaller places generally rise, while several large absolute-gap metros and large counties ease down.
- Boulder County moved down from #17 to #24, and La Plata County moved down from #124 to #132, matching the tuning-candidate expectation under the 0.40/0.60 gap blend.
- No absurd new top-of-list entries were observed; the top remains dominated by Boulder, Steamboat Springs, Parker, Silverthorne, Lafayette, Avon, Glendale, Littleton, and other previously high-need/high-opportunity jurisdictions.

## Top 20 Places After A+B

Global ranks are shown because the ranking index uses one statewide ordering across counties, places, and CDPs. Positive Move means the jurisdiction rose versus main.

| New rank | Main rank | Move | Jurisdiction | Score | Main score | Gap rate | Gap units | Commute ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | +1 | Boulder (city) | 88.4 | 88.4 | 86.9 | 10622 | 81.4 |
| 2 | 1 | -1 | Steamboat Springs (city) | 88.3 | 88.5 | 93.5 | 821 | 57.5 |
| 3 | 3 | 0 | Parker (town) | 88.2 | 88.2 | 98.2 | 1779 | 87.7 |
| 6 | 6 | 0 | Silverthorne (town) | 87.6 | 87.2 | 100 | 230 | 88 |
| 7 | 7 | 0 | Lafayette (city) | 86.1 | 86.1 | 85.2 | 1618 | 90.5 |
| 9 | 8 | -1 | Avon (town) | 84.9 | 85.5 | 75.6 | 521 | 94.4 |
| 11 | 10 | -1 | Glendale (city) | 83.7 | 83.9 | 87.5 | 490 | 99.1 |
| 13 | 13 | 0 | Littleton (city) | 82.9 | 83.1 | 83 | 3014 | 92.3 |
| 14 | 18 | +4 | Golden (city) | 82.5 | 81.9 | 85.8 | 1157 | 94.5 |
| 15 | 16 | +1 | Federal Heights (city) | 82.1 | 82.1 | 96.7 | 1515 | 96.1 |
| 16 | 14 | -2 | Fort Collins (city) | 81.7 | 82.5 | 78.2 | 11853 | 58.9 |
| 17 | 19 | +2 | Thornton (city) | 81.5 | 81.5 | 86.8 | 5524 | 81.7 |
| 18 | 15 | -3 | Vail (town) | 81.5 | 82.4 | 77.6 | 375 | 67 |
| 20 | 32 | +12 | Greenwood Village (city) | 80.9 | 79.6 | 92.1 | 701 | 98.5 |
| 21 | 22 | +1 | Woodland Park (city) | 80.4 | 80.6 | 100 | 370 | 76.9 |
| 23 | 31 | +8 | Lone Tree (city) | 80.3 | 79.9 | 100 | 525 | 97.2 |
| 25 | 20 | -5 | Lakewood (city) | 80.2 | 81.4 | 79.4 | 9928 | 85 |
| 28 | 35 | +7 | Louisville (city) | 79.9 | 79.3 | 90.7 | 903 | 93.5 |
| 30 | 29 | -1 | Englewood (city) | 79.5 | 79.9 | 79.6 | 2487 | 94.9 |
| 31 | 37 | +6 | Frisco (town) | 79.5 | 78.7 | 100 | 284 | 92.1 |

## Top 20 Counties After A+B

| New rank | Main rank | Move | Jurisdiction | Score | Main score | Gap rate | Gap units | Commute ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 9 | -1 | Jefferson County | 84 | 84 | 54.7 | 28514 | 62.7 |
| 24 | 17 | -7 | Boulder County | 80.2 | 81.9 | 39.7 | 11433 | 58.5 |
| 27 | 27 | 0 | Arapahoe County | 79.9 | 79.9 | 45.2 | 23437 | 67.8 |
| 39 | 45 | +6 | Douglas County | 77.5 | 76.7 | 73 | 19037 | 65.5 |
| 52 | 49 | -3 | Adams County | 75.4 | 76.3 | 45.1 | 18252 | 69.1 |
| 58 | 58 | 0 | Larimer County | 74.1 | 74.9 | 43.2 | 15337 | 39.3 |
| 64 | 67 | +3 | Weld County | 73.7 | 73.7 | 48.7 | 12878 | 43 |
| 68 | 70 | +2 | Eagle County | 73.3 | 73.3 | 31.4 | 1593 | 45.2 |
| 69 | 78 | +9 | Teller County | 73.1 | 71.4 | 60.9 | 1653 | 45.6 |
| 84 | 88 | +4 | Broomfield County | 71.3 | 70.4 | 51.6 | 3171 | 88.7 |
| 93 | 98 | +5 | Delta County | 69.2 | 68.4 | 53.7 | 1866 | 35 |
| 100 | 94 | -6 | El Paso County | 68.2 | 69 | 45.1 | 27429 | 24.8 |
| 119 | 101 | -18 | Denver County | 65.5 | 68 | 23.1 | 15979 | 69.9 |
| 122 | 100 | -22 | Routt County | 65 | 68.3 | 34.7 | 933 | 34.5 |
| 131 | 138 | +7 | Chaffee County | 62.8 | 61.9 | 50.9 | 1192 | 36.1 |
| 132 | 124 | -8 | La Plata County | 62.8 | 65.3 | 40.4 | 2510 | 21.1 |
| 137 | 127 | -10 | Mesa County | 61.9 | 64.3 | 44.1 | 6000 | 20.1 |
| 138 | 153 | +15 | San Miguel County | 61.5 | 59.9 | 45.1 | 549 | 46.1 |
| 145 | 141 | -4 | Summit County | 61 | 61.8 | 20.1 | 601 | 54 |
| 168 | 189 | +21 | Clear Creek County | 58.4 | 54.3 | 51.6 | 583 | 70.2 |

## All Movers Over 50 Ranks

None. The largest upward move was Gilpin County (+39); the largest downward move was Logan County (-42).

## Largest Risers

These rows help confirm the rate-weight shift and commuter augment are acting as expected.

| Type | New rank | Main rank | Move | Jurisdiction | Score | Main score | Gap rate | Gap units | Population | Commute ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| county | 285 | 324 | +39 | Gilpin County | 42.9 | 39 | 62.7 | 408 | 5901 | 80.7 |
| place | 133 | 158 | +25 | Gilcrest (town) | 62.2 | 59.4 | 100 | 53 | 1026 | 97.2 |
| county | 439 | 462 | +23 | Custer County | 27.5 | 24.5 | 61 | 569 | 5247 | 41.8 |
| county | 500 | 522 | +22 | Cheyenne County | 20.6 | 18.1 | 51.9 | 203 | 1741 | 43 |
| county | 168 | 189 | +21 | Clear Creek County | 58.4 | 54.3 | 51.6 | 583 | 9262 | 70.2 |
| place | 345 | 366 | +21 | Eckley (town) | 36.8 | 35.3 |  | 28 | 332 | 100 |
| place | 176 | 196 | +20 | Palmer Lake (town) | 56.3 | 53.8 | 100 | 84 | 2623 | 96.2 |
| place | 352 | 372 | +20 | Otis (town) | 36.3 | 35 | 98.1 | 51 | 521 | 91.8 |
| place | 187 | 206 | +19 | Mount Crested Butte (town) | 54.7 | 52.7 | 100 | 62 | 823 | 95.3 |
| cdp | 50 | 68 | +18 | Meridian Village (CDP) | 75.8 | 73.5 | 100 | 62 | 2699 | 97.5 |
| place | 264 | 282 | +18 | Mead (town) | 45.3 | 43.6 | 88.6 | 70 | 5919 | 94.6 |
| place | 175 | 192 | +17 | Winter Park (town) | 56.9 | 54.1 | 100 | 76 | 844 | 91.5 |
| cdp | 341 | 358 | +17 | Wolcott (CDP) | 37.2 | 35.8 |  | 0 | 0 | 100 |
| county | 138 | 153 | +15 | San Miguel County | 61.5 | 59.9 | 45.1 | 549 | 7968 | 46.1 |
| county | 245 | 260 | +15 | Jackson County | 47.6 | 45.9 | 55.8 | 230 | 1372 | 23.2 |

## Largest Droppers

| Type | New rank | Main rank | Move | Jurisdiction | Score | Main score | Gap rate | Gap units | Population | Commute ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| county | 295 | 253 | -42 | Logan County | 42.2 | 47.2 | 42.9 | 1685 | 20892 | 31.7 |
| place | 211 | 182 | -29 | Montrose (city) | 52.3 | 55.3 | 65.2 | 1161 | 21044 | 60.7 |
| cdp | 203 | 177 | -26 | Penrose (CDP) | 53.3 | 55.7 | 94.5 | 207 | 4087 | 73 |
| place | 318 | 293 | -25 | Rifle (city) | 39.9 | 42.5 | 57.8 | 300 | 10570 | 71.6 |
| place | 383 | 360 | -23 | Walsenburg (city) | 33.6 | 35.7 | 39.4 | 111 | 3072 | 56.7 |
| county | 122 | 100 | -22 | Routt County | 65 | 68.3 | 34.7 | 933 | 25084 | 34.5 |
| place | 313 | 291 | -22 | Lamar (city) | 40.6 | 43 | 46.1 | 232 | 7611 | 44 |
| cdp | 442 | 420 | -22 | Towaoc (CDP) | 27.3 | 29.9 | 24.5 | 40 | 1078 | 70 |
| place | 164 | 143 | -21 | Delta (city) | 58.8 | 61.4 | 69.1 | 697 | 9421 | 75.8 |
| cdp | 250 | 229 | -21 | Idledale (CDP) | 47.4 | 49.7 | 50.9 | 28 | 297 | 100 |
| place | 284 | 263 | -21 | Rocky Ford (city) | 43 | 45.6 | 58.1 | 234 | 3815 | 65 |
| place | 376 | 355 | -21 | La Junta (city) | 34.4 | 35.9 | 40.5 | 244 | 7140 | 62.7 |
| cdp | 315 | 295 | -20 | Gold Hill (CDP) | 40.5 | 42.3 | 53.8 | 50 | 178 | 97.9 |
| cdp | 385 | 365 | -20 | Ellicott (CDP) | 33.4 | 35.5 | 55.4 | 87 | 1404 | 91.2 |
| cdp | 235 | 216 | -19 | Laporte (CDP) | 49.2 | 51.3 | 77.6 | 235 | 1771 | 92.6 |

## Required Spot Checks

| New rank | Main rank | Move | Jurisdiction | Score | Main score | Gap rate | Gap units | Commute ratio |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | 17 | -7 | Boulder County | 80.2 | 81.9 | 39.7 | 11433 | 58.5 |
| 132 | 124 | -8 | La Plata County | 62.8 | 65.3 | 40.4 | 2510 | 21.1 |
| 103 | 95 | -8 | Denver (city) | 67.7 | 68.9 | 72.5 | 46291 | 69.9 |
| 464 | 466 | +2 | Baca County | 24.1 | 24.1 | 50.7 | 374 | 18.8 |
| 331 | 335 | +4 | Sedgwick County | 38.3 | 37.5 | 47.6 | 331 | 28.5 |

## Face-Validity Notes

Small high-gap-rate jurisdictions rising include Gilcrest (+25, 100% gap rate), Palmer Lake (+20, 100%), Mount Crested Butte (+19, 100%), Winter Park (+17, 100%), New Castle (+14, 100%), Frederick (+14, 100%), and Telluride (+13, 92.4%). County risers also skew toward higher gap rates, led by Gilpin County (+39, 62.7%), Custer County (+23, 61.0%), Cheyenne County (+22, 51.9%), and Clear Creek County (+21, 51.6%).

Large metro / county easing is visible but bounded: Denver city moved -8, Denver County -18, Greeley -16, Boulder County -7, La Plata County -8, and El Paso County -6. The largest absolute move was still under 50 ranks, so the candidate does not appear to create a cliff effect.
