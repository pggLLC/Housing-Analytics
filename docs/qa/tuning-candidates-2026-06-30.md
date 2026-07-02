# HNA Ranking Tuning Candidate Reports

Date: 2026-06-30

This report is read-only analysis for owner tuning decisions. It was generated from throwaway builds off current `origin/main`; no ranking constants, `data/hna/ranking-index.json`, or generated ranking data are committed in this PR.

## Constants Checked

- `_MIN_RATE_DENOMINATOR = 50` in `scripts/hna/build_ranking_index.py`.
- Current `GAP_COUNT_WEIGHT / GAP_RATE_WEIGHT = 0.50 / 0.50`.
- Current `COMMUTER_AUGMENT_ALPHA = 0.15`.
- Overcrowding/backfill candidate D is not evaluated here; it needs the ACS backfill workflow run first and should be evaluated at the actual re-rank.

## Executive Read

- Moving the gap blend toward rate (`0.40/0.60` or `0.35/0.65`) produces material movement and should be an owner decision; it can lift small high-rate geographies, but the denominator floor prevents sub-1,000-pop CDPs from entering the very top.
- Changing commuter alpha from `0.15` to `0.10` or `0.20` is less disruptive than the gap blend and preserves the augment-only invariant in these runs.
- Denver remains high under all candidates; Baca/Sedgwick move only modestly in these candidate-only tests.

## Current baseline

Gap count/rate: `0.50/0.50`; commuter alpha: `0.15`.

- Commuter augment-only invariant: PASS (0 entries below core).
- Highest-ranked sub-1,000-pop CDP: Pine Brook Hill (CDP) (`0859240`), rank 68, population 543, score 73.1.
- Sub-1,000-pop CDPs in top 20: 0; in top 50: 0.

### Top 20 Places

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 1 | -- | Steamboat Springs (city) | `0873825` | 89.1 | place |
| 2 | -- | Boulder (city) | `0807850` | 88.7 | place |
| 3 | -- | Parker (town) | `0857630` | 88.4 | place |
| 6 | -- | Silverthorne (town) | `0870525` | 87.0 | place |
| 7 | -- | Lafayette (city) | `0841835` | 85.4 | place |
| 8 | -- | Fort Collins (city) | `0827425` | 84.5 | place |
| 11 | -- | Vail (town) | `0880040` | 83.7 | place |
| 13 | -- | Golden (city) | `0830835` | 83.5 | place |
| 14 | -- | Littleton (city) | `0845255` | 82.9 | place |
| 15 | -- | Avon (town) | `0804110` | 82.7 | place |
| 16 | -- | Glendale (city) | `0830340` | 82.5 | place |
| 18 | -- | Federal Heights (city) | `0826270` | 81.9 | place |
| 19 | -- | Thornton (city) | `0877290` | 81.2 | place |
| 20 | -- | Woodland Park (city) | `0886090` | 81.0 | place |
| 21 | -- | Longmont (city) | `0845970` | 80.6 | place |
| 23 | -- | Lakewood (city) | `0843000` | 80.2 | place |
| 25 | -- | Lone Tree (city) | `0845955` | 79.7 | place |
| 26 | -- | Centennial (city) | `0812815` | 79.3 | place |
| 27 | -- | Louisville (city) | `0846355` | 79.3 | place |
| 29 | -- | Frisco (town) | `0828690` | 79.2 | place |

### Top 20 Counties

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 10 | -- | Jefferson County | `08059` | 84.0 | county |
| 12 | -- | Boulder County | `08013` | 83.5 | county |
| 30 | -- | Arapahoe County | `08005` | 79.1 | county |
| 34 | -- | Douglas County | `08035` | 78.4 | county |
| 55 | -- | Larimer County | `08069` | 74.9 | county |
| 65 | -- | Adams County | `08001` | 73.8 | county |
| 67 | -- | Teller County | `08119` | 73.1 | county |
| 72 | -- | Routt County | `08107` | 72.4 | county |
| 76 | -- | Broomfield County | `08014` | 72.1 | county |
| 83 | -- | Eagle County | `08037` | 70.9 | county |
| 89 | -- | Delta County | `08029` | 70.1 | county |
| 93 | -- | Weld County | `08123` | 69.5 | county |
| 98 | -- | El Paso County | `08041` | 69.0 | county |
| 105 | -- | Denver County | `08031` | 67.1 | county |
| 120 | -- | La Plata County | `08067` | 65.3 | county |
| 126 | -- | Chaffee County | `08015` | 64.4 | county |
| 131 | -- | Mesa County | `08077` | 63.5 | county |
| 150 | -- | Summit County | `08117` | 60.3 | county |
| 169 | -- | Pueblo County | `08101` | 57.5 | county |
| 176 | -- | Montrose County | `08085` | 56.7 | county |

### Baca / Sedgwick / Denver Lines

| Geography | GEOID | Current rank | Candidate rank | Δ | Current score | Candidate score |
|---|---|---:|---:|---:|---:|---:|
| Baca County | `08009` | 452 | 452 | +0 | 25.7 | 25.7 |
| Sedgwick County | `08115` | 325 | 325 | +0 | 39.2 | 39.2 |
| Denver County | `08031` | 105 | 105 | +0 | 67.1 | 67.1 |
| Denver city | `0820000` | 110 | 110 | +0 | 66.9 | 66.9 |

## Gap blend: count 0.40 / rate 0.60

Gap count/rate: `0.40/0.60`; commuter alpha: `0.15`.

- Commuter augment-only invariant: PASS (0 entries below core).
- Highest-ranked sub-1,000-pop CDP: Pine Brook Hill (CDP) (`0859240`), rank 70, population 543, score 72.9.
- Sub-1,000-pop CDPs in top 20: 0; in top 50: 0.

### Top 20 Places

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 1 | -- | Steamboat Springs (city) | `0873825` | 88.9 | place |
| 2 | -- | Boulder (city) | `0807850` | 88.4 | place |
| 3 | -- | Parker (town) | `0857630` | 88.2 | place |
| 5 | +1 | Silverthorne (town) | `0870525` | 87.2 | place |
| 7 | -- | Lafayette (city) | `0841835` | 84.6 | place |
| 10 | +3 | Golden (city) | `0830835` | 83.5 | place |
| 12 | -4 | Fort Collins (city) | `0827425` | 82.9 | place |
| 13 | -2 | Vail (town) | `0880040` | 82.7 | place |
| 14 | -- | Littleton (city) | `0845255` | 82.3 | place |
| 15 | +3 | Federal Heights (city) | `0826270` | 82.1 | place |
| 16 | -- | Glendale (city) | `0830340` | 81.7 | place |
| 17 | -2 | Avon (town) | `0804110` | 81.5 | place |
| 18 | +2 | Woodland Park (city) | `0886090` | 81.0 | place |
| 19 | -- | Thornton (city) | `0877290` | 80.9 | place |
| 20 | +5 | Lone Tree (city) | `0845955` | 80.3 | place |
| 23 | +6 | Frisco (town) | `0828690` | 79.6 | place |
| 24 | -1 | Lakewood (city) | `0843000` | 79.6 | place |
| 25 | -4 | Longmont (city) | `0845970` | 79.4 | place |
| 27 | +12 | Castle Pines (city) | `0812387` | 79.0 | place |
| 28 | -2 | Centennial (city) | `0812815` | 78.9 | place |

### Top 20 Counties

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 9 | +1 | Jefferson County | `08059` | 84.0 | county |
| 21 | -9 | Boulder County | `08013` | 80.2 | county |
| 26 | +4 | Arapahoe County | `08005` | 79.1 | county |
| 34 | -- | Douglas County | `08035` | 78.4 | county |
| 52 | +15 | Teller County | `08119` | 75.5 | county |
| 58 | -3 | Larimer County | `08069` | 74.1 | county |
| 67 | -2 | Adams County | `08001` | 73.0 | county |
| 68 | +8 | Broomfield County | `08014` | 72.9 | county |
| 81 | +2 | Eagle County | `08037` | 70.9 | county |
| 86 | +3 | Delta County | `08029` | 70.1 | county |
| 91 | +2 | Weld County | `08123` | 69.5 | county |
| 94 | -22 | Routt County | `08107` | 69.1 | county |
| 100 | -2 | El Paso County | `08041` | 68.2 | county |
| 110 | +16 | Chaffee County | `08015` | 66.9 | county |
| 132 | -27 | Denver County | `08031` | 63.0 | county |
| 133 | -2 | Mesa County | `08077` | 61.9 | county |
| 154 | -34 | La Plata County | `08067` | 60.3 | county |
| 160 | +27 | Clear Creek County | `08019` | 59.2 | county |
| 169 | -19 | Summit County | `08117` | 57.9 | county |
| 183 | -3 | San Miguel County | `08113` | 55.8 | county |

### Baca / Sedgwick / Denver Lines

| Geography | GEOID | Current rank | Candidate rank | Δ | Current score | Candidate score |
|---|---|---:|---:|---:|---:|---:|
| Baca County | `08009` | 452 | 450 | +2 | 25.7 | 26.5 |
| Sedgwick County | `08115` | 325 | 322 | +3 | 39.2 | 39.2 |
| Denver County | `08031` | 105 | 132 | -27 | 67.1 | 63.0 |
| Denver city | `0820000` | 110 | 114 | -4 | 66.9 | 65.7 |

### Movers Greater Than 50 Ranks

| Δ ranks | Current rank | Candidate rank | Name | GEOID | Type | Current score | Candidate score |
|---:|---:|---:|---|---|---|---:|---:|
| +55 | 290 | 235 | Mineral County | `08079` | county | 42.5 | 48.9 |

## Gap blend: count 0.35 / rate 0.65

Gap count/rate: `0.35/0.65`; commuter alpha: `0.15`.

- Commuter augment-only invariant: PASS (0 entries below core).
- Highest-ranked sub-1,000-pop CDP: Pine Brook Hill (CDP) (`0859240`), rank 69, population 543, score 72.9.
- Sub-1,000-pop CDPs in top 20: 0; in top 50: 0.

### Top 20 Places

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 1 | -- | Steamboat Springs (city) | `0873825` | 88.9 | place |
| 2 | -- | Boulder (city) | `0807850` | 88.4 | place |
| 3 | -- | Parker (town) | `0857630` | 88.0 | place |
| 5 | +1 | Silverthorne (town) | `0870525` | 87.4 | place |
| 7 | -- | Lafayette (city) | `0841835` | 84.6 | place |
| 11 | -3 | Fort Collins (city) | `0827425` | 82.5 | place |
| 12 | +1 | Golden (city) | `0830835` | 82.5 | place |
| 13 | +5 | Federal Heights (city) | `0826270` | 82.1 | place |
| 14 | -- | Littleton (city) | `0845255` | 82.0 | place |
| 15 | +1 | Glendale (city) | `0830340` | 81.9 | place |
| 16 | -5 | Vail (town) | `0880040` | 81.2 | place |
| 17 | +3 | Woodland Park (city) | `0886090` | 81.2 | place |
| 18 | -3 | Avon (town) | `0804110` | 81.0 | place |
| 19 | -- | Thornton (city) | `0877290` | 80.9 | place |
| 20 | +9 | Frisco (town) | `0828690` | 80.4 | place |
| 21 | +4 | Lone Tree (city) | `0845955` | 80.3 | place |
| 24 | +15 | Castle Pines (city) | `0812387` | 79.2 | place |
| 25 | -2 | Lakewood (city) | `0843000` | 79.2 | place |
| 26 | -5 | Longmont (city) | `0845970` | 79.2 | place |
| 27 | +15 | Telluride (town) | `0876795` | 78.8 | place |

### Top 20 Counties

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 9 | +1 | Jefferson County | `08059` | 84.0 | county |
| 22 | -10 | Boulder County | `08013` | 80.2 | county |
| 32 | +2 | Douglas County | `08035` | 78.4 | county |
| 40 | -10 | Arapahoe County | `08005` | 77.5 | county |
| 47 | +20 | Teller County | `08119` | 76.3 | county |
| 59 | -4 | Larimer County | `08069` | 74.1 | county |
| 65 | -- | Adams County | `08001` | 73.0 | county |
| 68 | +8 | Broomfield County | `08014` | 72.9 | county |
| 81 | +8 | Delta County | `08029` | 70.8 | county |
| 90 | +3 | Weld County | `08123` | 69.5 | county |
| 93 | -21 | Routt County | `08107` | 69.1 | county |
| 99 | -1 | El Paso County | `08041` | 68.2 | county |
| 105 | -22 | Eagle County | `08037` | 67.5 | county |
| 110 | +16 | Chaffee County | `08015` | 66.9 | county |
| 136 | -5 | Mesa County | `08077` | 61.9 | county |
| 146 | -26 | La Plata County | `08067` | 61.2 | county |
| 151 | -46 | Denver County | `08031` | 60.6 | county |
| 156 | +31 | Clear Creek County | `08019` | 60.1 | county |
| 173 | -23 | Summit County | `08117` | 57.2 | county |
| 184 | -4 | San Miguel County | `08113` | 55.8 | county |

### Baca / Sedgwick / Denver Lines

| Geography | GEOID | Current rank | Candidate rank | Δ | Current score | Candidate score |
|---|---|---:|---:|---:|---:|---:|
| Baca County | `08009` | 452 | 450 | +2 | 25.7 | 26.5 |
| Sedgwick County | `08115` | 325 | 323 | +2 | 39.2 | 39.2 |
| Denver County | `08031` | 105 | 151 | -46 | 67.1 | 60.6 |
| Denver city | `0820000` | 110 | 115 | -5 | 66.9 | 65.1 |

### Movers Greater Than 50 Ranks

| Δ ranks | Current rank | Candidate rank | Name | GEOID | Type | Current score | Candidate score |
|---:|---:|---:|---|---|---|---:|---:|
| +60 | 290 | 230 | Mineral County | `08079` | county | 42.5 | 49.7 |
| +51 | 303 | 252 | Gilpin County | `08047` | county | 41.3 | 46.7 |

## Commuter alpha 0.10

Gap count/rate: `0.50/0.50`; commuter alpha: `0.10`.

- Commuter augment-only invariant: PASS (0 entries below core).
- Highest-ranked sub-1,000-pop CDP: Pine Brook Hill (CDP) (`0859240`), rank 68, population 543, score 73.1.
- Sub-1,000-pop CDPs in top 20: 0; in top 50: 0.

### Top 20 Places

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 1 | -- | Steamboat Springs (city) | `0873825` | 89.1 | place |
| 2 | -- | Boulder (city) | `0807850` | 88.7 | place |
| 3 | -- | Parker (town) | `0857630` | 88.2 | place |
| 6 | -- | Silverthorne (town) | `0870525` | 87.0 | place |
| 7 | -- | Lafayette (city) | `0841835` | 84.9 | place |
| 8 | -- | Fort Collins (city) | `0827425` | 84.5 | place |
| 11 | -- | Vail (town) | `0880040` | 83.7 | place |
| 12 | +1 | Golden (city) | `0830835` | 83.3 | place |
| 13 | +1 | Littleton (city) | `0845255` | 83.1 | place |
| 14 | +1 | Avon (town) | `0804110` | 82.1 | place |
| 17 | +1 | Federal Heights (city) | `0826270` | 81.9 | place |
| 18 | +2 | Woodland Park (city) | `0886090` | 81.2 | place |
| 19 | +2 | Longmont (city) | `0845970` | 81.0 | place |
| 20 | -4 | Glendale (city) | `0830340` | 80.9 | place |
| 21 | -2 | Thornton (city) | `0877290` | 80.9 | place |
| 23 | -- | Lakewood (city) | `0843000` | 79.8 | place |
| 26 | -- | Centennial (city) | `0812815` | 79.3 | place |
| 27 | +2 | Frisco (town) | `0828690` | 79.2 | place |
| 29 | +3 | Aurora (city) | `0804000` | 79.0 | place |
| 30 | -5 | Lone Tree (city) | `0845955` | 79.0 | place |

### Top 20 Counties

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 10 | -- | Jefferson County | `08059` | 84.0 | county |
| 16 | -4 | Boulder County | `08013` | 81.9 | county |
| 28 | +2 | Arapahoe County | `08005` | 79.1 | county |
| 33 | +1 | Douglas County | `08035` | 78.4 | county |
| 52 | +3 | Larimer County | `08069` | 75.8 | county |
| 59 | +8 | Teller County | `08119` | 74.7 | county |
| 72 | -7 | Adams County | `08001` | 72.2 | county |
| 76 | -- | Broomfield County | `08014` | 72.1 | county |
| 79 | -7 | Routt County | `08107` | 71.5 | county |
| 83 | -- | Eagle County | `08037` | 70.9 | county |
| 86 | +3 | Delta County | `08029` | 70.8 | county |
| 91 | +7 | El Paso County | `08041` | 69.9 | county |
| 98 | -5 | Weld County | `08123` | 68.7 | county |
| 107 | -2 | Denver County | `08031` | 67.1 | county |
| 110 | +10 | La Plata County | `08067` | 66.9 | county |
| 126 | -- | Chaffee County | `08015` | 64.4 | county |
| 127 | +4 | Mesa County | `08077` | 64.3 | county |
| 156 | -6 | Summit County | `08117` | 59.5 | county |
| 174 | +2 | Montrose County | `08085` | 56.7 | county |
| 175 | -6 | Pueblo County | `08101` | 56.6 | county |

### Baca / Sedgwick / Denver Lines

| Geography | GEOID | Current rank | Candidate rank | Δ | Current score | Candidate score |
|---|---|---:|---:|---:|---:|---:|
| Baca County | `08009` | 452 | 448 | +4 | 25.7 | 26.5 |
| Sedgwick County | `08115` | 325 | 325 | +0 | 39.2 | 39.2 |
| Denver County | `08031` | 105 | 107 | -2 | 67.1 | 67.1 |
| Denver city | `0820000` | 110 | 111 | -1 | 66.9 | 66.9 |

### Movers Greater Than 50 Ranks

None.

## Commuter alpha 0.20

Gap count/rate: `0.50/0.50`; commuter alpha: `0.20`.

- Commuter augment-only invariant: PASS (0 entries below core).
- Highest-ranked sub-1,000-pop CDP: Pine Brook Hill (CDP) (`0859240`), rank 70, population 543, score 73.1.
- Sub-1,000-pop CDPs in top 20: 0; in top 50: 0.

### Top 20 Places

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 1 | -- | Steamboat Springs (city) | `0873825` | 88.9 | place |
| 2 | -- | Boulder (city) | `0807850` | 88.7 | place |
| 3 | -- | Parker (town) | `0857630` | 88.4 | place |
| 6 | -- | Silverthorne (town) | `0870525` | 87.2 | place |
| 7 | -- | Lafayette (city) | `0841835` | 85.8 | place |
| 8 | -- | Fort Collins (city) | `0827425` | 84.1 | place |
| 11 | +2 | Golden (city) | `0830835` | 83.7 | place |
| 13 | -2 | Vail (town) | `0880040` | 83.3 | place |
| 14 | +1 | Avon (town) | `0804110` | 83.1 | place |
| 15 | -1 | Littleton (city) | `0845255` | 83.1 | place |
| 16 | -- | Glendale (city) | `0830340` | 82.7 | place |
| 18 | -- | Federal Heights (city) | `0826270` | 81.9 | place |
| 19 | -- | Thornton (city) | `0877290` | 81.2 | place |
| 20 | -- | Woodland Park (city) | `0886090` | 81.0 | place |
| 21 | +2 | Lakewood (city) | `0843000` | 80.8 | place |
| 24 | -3 | Longmont (city) | `0845970` | 80.0 | place |
| 25 | +2 | Louisville (city) | `0846355` | 79.9 | place |
| 26 | -1 | Lone Tree (city) | `0845955` | 79.7 | place |
| 27 | +4 | Englewood (city) | `0824785` | 79.5 | place |
| 28 | +1 | Frisco (town) | `0828690` | 79.5 | place |

### Top 20 Counties

| Rank | Δ vs current | Name | GEOID | Score | Type |
|---:|---:|---|---|---:|---|
| 9 | +1 | Jefferson County | `08059` | 84.0 | county |
| 12 | -- | Boulder County | `08013` | 83.5 | county |
| 30 | -- | Arapahoe County | `08005` | 79.1 | county |
| 35 | -1 | Douglas County | `08035` | 78.4 | county |
| 54 | +1 | Larimer County | `08069` | 75.8 | county |
| 60 | +5 | Adams County | `08001` | 74.7 | county |
| 66 | +1 | Teller County | `08119` | 73.9 | county |
| 72 | -- | Routt County | `08107` | 72.4 | county |
| 76 | -- | Broomfield County | `08014` | 72.1 | county |
| 82 | +1 | Eagle County | `08037` | 70.9 | county |
| 93 | -- | Weld County | `08123` | 69.5 | county |
| 97 | +1 | El Paso County | `08041` | 69.0 | county |
| 102 | -13 | Delta County | `08029` | 67.6 | county |
| 104 | +1 | Denver County | `08031` | 67.1 | county |
| 125 | +1 | Chaffee County | `08015` | 64.4 | county |
| 126 | -6 | La Plata County | `08067` | 64.4 | county |
| 133 | -2 | Mesa County | `08077` | 63.5 | county |
| 144 | +6 | Summit County | `08117` | 61.0 | county |
| 172 | +4 | Montrose County | `08085` | 56.7 | county |
| 174 | -5 | Pueblo County | `08101` | 56.6 | county |

### Baca / Sedgwick / Denver Lines

| Geography | GEOID | Current rank | Candidate rank | Δ | Current score | Candidate score |
|---|---|---:|---:|---:|---:|---:|
| Baca County | `08009` | 452 | 462 | -10 | 25.7 | 24.9 |
| Sedgwick County | `08115` | 325 | 328 | -3 | 39.2 | 38.3 |
| Denver County | `08031` | 105 | 104 | +1 | 67.1 | 67.1 |
| Denver city | `0820000` | 110 | 105 | +5 | 66.9 | 67.1 |

### Movers Greater Than 50 Ranks

None.

