# SDO Projection Outliers Review

Date: 2026-07-08  
Scope: Phase 4, DOLA warning deltas from `docs/qa/site-audit-2026-07/04-plan.md`

## Summary

`npm run check:dola-vintage` compares the repo's cached county projection series in `data/hna/projections/*.json` against the State Demography Office official county forecast file at `https://storage.googleapis.com/co-publicdata/forecast1yrcounty.csv`.

The 2026-07-08 run matched all 64 Colorado counties against the SDO official forecast, `Vintage 2023 Prepared October 2024`. Median 2030 difference was -1.4%, and 12 counties exceeded the script's +/-5% warning threshold.

This is not evidence of a statewide projection input failure. The 2024 baselines for the 12 warning counties are close to the official SDO series, ranging from -2.5% to +3.3%. The outliers are trajectory differences between the repo's components-of-change projection path and SDO's official 2030 county forecast.

## Warning Counties

| County | FIPS | Repo 2024 | SDO 2024 | 2024 diff | Repo 2030 | SDO 2030 | Abs. diff | 2030 diff | Repo 2024-2030 growth | SDO 2024-2030 growth | Disposition |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Broomfield | 08014 | 78,453 | 79,080 | -0.8% | 85,261 | 96,506 | -11,245 | -11.7% | +8.7% | +22.0% | Genuine trajectory divergence; highest-priority owner review because the absolute delta is large. |
| Custer | 08027 | 5,558 | 5,683 | -2.2% | 5,695 | 6,385 | -690 | -10.8% | +2.5% | +12.4% | Genuine trajectory divergence; small county, but SDO expects much faster growth. |
| Washington | 08121 | 4,773 | 4,883 | -2.3% | 4,581 | 4,992 | -411 | -8.2% | -4.0% | +2.2% | Genuine trajectory divergence; repo decline vs SDO mild growth. |
| Jackson | 08057 | 1,270 | 1,300 | -2.3% | 1,165 | 1,263 | -98 | -7.8% | -8.3% | -2.8% | Genuine trajectory divergence; small denominator amplifies percentage warning. |
| Hinsdale | 08053 | 754 | 773 | -2.5% | 730 | 783 | -53 | -6.8% | -3.2% | +1.3% | Genuine trajectory divergence; very small denominator. |
| Archuleta | 08007 | 14,137 | 14,264 | -0.9% | 14,323 | 15,207 | -884 | -5.8% | +1.3% | +6.6% | Genuine trajectory divergence; SDO growth faster than repo path. |
| Sedgwick | 08115 | 2,278 | 2,327 | -2.1% | 2,196 | 2,330 | -134 | -5.8% | -3.6% | +0.1% | Genuine trajectory divergence; repo decline vs SDO flat path. |
| Cheyenne | 08017 | 1,737 | 1,733 | +0.2% | 1,684 | 1,779 | -95 | -5.3% | -3.1% | +2.7% | Genuine trajectory divergence; baseline aligns, forecast direction differs. |
| San Miguel | 08113 | 7,802 | 7,922 | -1.5% | 8,022 | 8,458 | -436 | -5.2% | +2.8% | +6.8% | Genuine trajectory divergence; SDO growth faster than repo path. |
| Bent | 08011 | 5,744 | 5,653 | +1.6% | 5,773 | 5,496 | +277 | +5.0% | +0.5% | -2.8% | Genuine trajectory divergence; repo flat vs SDO decline. |
| Baca | 08009 | 3,398 | 3,347 | +1.5% | 3,392 | 3,205 | +187 | +5.8% | -0.2% | -4.2% | Genuine trajectory divergence; small county, repo decline slower than SDO. |
| San Juan | 08111 | 818 | 792 | +3.3% | 862 | 747 | +115 | +15.4% | +5.4% | -5.7% | Genuine trajectory divergence; very small denominator, but direction differs and should be owner-reviewed. |

## Interpretation

The repo projection inputs are broadly aligned with the current SDO official series at the base year. That makes a refresh of all projection inputs unnecessary based on this check alone.

The warnings should remain visible because they flag local trajectory differences that can matter in county narratives, production-vs-need comparisons, and place projections scaled from county paths. Broomfield is the only warning with a five-digit 2030 absolute delta and deserves separate owner attention. San Juan is the largest percentage warning, but the absolute 2030 difference is 115 people.

## Recommended Owner Decision

Accept the current warnings as calibration notes rather than blockers, with this Phase 4 disposition:

- Keep `check:dola-vintage` warning-only for counties beyond +/-5% when at least 60 counties match and statewide median drift remains low.
- Add Broomfield to the next projection-methodology review because its SDO 2024-2030 growth is much faster than the repo path.
- Treat San Juan, Hinsdale, Jackson, Sedgwick, Cheyenne, Baca, and other small-county warnings as public methodology caveats unless an owner has local knowledge that the repo path is wrong.
- Do not adjust projection data in this PR.

## Evidence

Command:

```bash
npm run check:dola-vintage
```

Result:

```text
SDO official forecast: Vintage 2023 Prepared October 2024
Comparing repo projections vs official forecast at 2030
64 counties compared; median diff -1.4%; 12 beyond +/-5% (warnings)
```

