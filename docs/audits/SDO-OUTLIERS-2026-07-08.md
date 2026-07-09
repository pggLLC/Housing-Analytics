# SDO Projection Outliers Review

Date: 2026-07-08  
Superseded: 2026-07-09 by PR #1116  
Scope: Phase 4, DOLA warning deltas from `docs/qa/site-audit-2026-07/04-plan.md`

## Current Disposition

This note is retained as historical audit context, but its original conclusion is superseded.

The 2026-07-08 review reported 12 counties beyond the +/-5% warning threshold because `scripts/hna/check_dola_vintage.py` was comparing repo projections against `forecast1yrcounty.csv`, an older SDO file labeled `Vintage 2023 Prepared October 2024`.

PR #1116 updated the checker to compare against SDO's currently-published `components-change-county.csv`, labeled `Vintage 2024 Prepared March 2025`. That is also the source file used by the repo projection pipeline. Against that current SDO file, the repo projections match exactly at 2030.

Owner decision: no projection input refresh is needed for the former 12 warning counties. The prior warnings were an artifact of the stale comparison source, not genuine county trajectory divergence.

## Current Evidence

Command:

```bash
npm run check:dola-vintage
```

Result after PR #1116:

```text
SDO components-of-change file: Vintage 2024 Prepared March 2025
Comparing repo projections vs official data at 2030
64 counties compared; median diff +0.0%; 0 beyond +/-5% (warnings)
```

## Historical Finding

The superseded 2026-07-08 run compared against `forecast1yrcounty.csv` and reported:

```text
SDO official forecast: Vintage 2023 Prepared October 2024
Comparing repo projections vs official forecast at 2030
64 counties compared; median diff -1.4%; 12 beyond +/-5% (warnings)
```

The largest apparent deltas were Broomfield (-11.7%) and San Juan (+15.4%). PR #1116 showed both match the current SDO components-change file exactly at 2030:

| County | Repo 2030 | Current SDO 2030 | Current diff |
|---|---:|---:|---:|
| Broomfield | 85,261 | 85,261 | +0.0% |
| San Juan | 862 | 862 | +0.0% |

## Follow-Up

Keep `npm run check:dola-vintage` as a build-regression/data-staleness guard: it should catch projection caches drifting from SDO's current components-change file. Do not use the retired 12-county warning list for product methodology decisions.
