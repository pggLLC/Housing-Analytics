# HNA Benchmark Ratios Review

Date: 2026-07-08  
Scope: Phase 4, HNA benchmark ratios from `docs/qa/site-audit-2026-07/04-plan.md`

## Summary

`npm run test:hna-benchmarks` compares selected repo HNA outputs against consultant housing-needs reports in `data/hna/benchmarks.json`. The harness is a calibration dashboard, not a pass/fail accuracy test: it exits nonzero only when a repo value cannot be resolved.

The 2026-07-08 run passed. Current ratios show several large differences, but the benchmark fixture's caveats explain most as expected method/vintage differences rather than model drift. No HNA data, formulas, generated artifacts, or UI should change in this Phase 4 PR.

## Current Benchmark Ratios

| Jurisdiction | Anchor | Repo | Consultant | Ratio | Disposition |
|---|---|---:|---:|---:|---|
| La Plata County | `rental_gap_lte50_ami` | 912 | 963 | 0.95 | Expected alignment. This is the resolved AMI rent-gap tenure-mixing check; repo methodology now calibrates closely to Root Policy. |
| La Plata County | `rental_gap_lte30_ami` | 1,328 | 651 | 2.04 | Expected method difference. The backlog explicitly records the <=30% tier as a documented concept difference, not a bug. |
| La Plata County | `keepup_units_5yr` | 705 | 1,550 | 0.45 | Expected vintage/forecast difference. Root used a hotter pre-revision SDO vintage (2030 pop 61,656); the current SDO forecast (Vintage 2024 components-of-change) puts 2030 pop at 58,370, an exact match to the repo's trajectory (corrected 2026-07-09, see PR #1116 and `docs/audits/SDO-OUTLIERS-2026-07-08.md`). |
| Pueblo County | `total_need_10yr` | 1,691 | 9,561 | 0.18 | Owner-methodology backlog, not an implementation regression. GG+A layers job-growth spillover, senior demand, and replacement need; repo's current anchor is structurally smaller. |
| City of Pueblo | `rental_deficit_deep` | 3,938 | 2,637 | 1.49 | Expected threshold difference. GG+A uses a 2019 rent cut below $375/month; repo uses the current 30% AMI rent threshold, so a larger repo count is expected. |
| Town of Milliken | `catchup_units` | 39 | 47-79 | 0.62 | Directional only. Ayres measures listing-market tightness, not affordability mismatch. Treat as context, not a model error. |
| Town of Milliken | `keepup_units_5yr` | 295 | 199-331 | 1.11 | Expected alignment. Repo's permit-share place downscaling sits within the consultant range. |
| City of Alamosa | `total_need_5yr` | 352 | 445-515 | 0.73 | Directional concept difference. Consultant number bundles current gaps and growth aspiration; repo value is a deep-affordability gap while county DOLA growth is near-flat. |
| Town of Erie | `unit_gap` | 119 | n/a | n/a | No comparable consultant unit-gap value by design. czbLLC declined to publish a unit-count gap; repo value can only be directionally compared to affordability/cost-burden findings. |

## Owner Decisions

Recommended Phase 4 disposition:

- Keep `test:hna-benchmarks` as a calibration dashboard and not a numeric pass/fail tolerance gate.
- Treat La Plata <=50%, Milliken keep-up, and the successful benchmark resolution itself as evidence that the current HNA pipeline can align with consultant practice where concepts match.
- Do not change La Plata <=30% in this work. It is already recorded as a concept difference.
- Do not use the Pueblo County 0.18 ratio as a bug report against current growth-only need. If the product should reproduce GG+A-style total need, the owner needs to prioritize a methodology enhancement for senior demand, replacement need, and employment-spillover demand.
- Keep Alamosa and Milliken catch-up as directional anchors only because the consultant concepts differ from the repo metric.
- Keep Erie in the dashboard as a "no comparable" guardrail so future reviewers do not fabricate a unit-gap consultant target.

## Evidence

Command:

```bash
npm run test:hna-benchmarks
```

Result:

```text
Jurisdiction            Anchor                  Repo        Consultant        Ratio
La Plata County         rental_gap_lte50_ami           912               963    0.95
La Plata County         rental_gap_lte30_ami         1,328               651    2.04
La Plata County         keepup_units_5yr               705             1,550    0.45
Pueblo County           total_need_10yr              1,691             9,561    0.18
City of Pueblo          rental_deficit_deep          3,938             2,637    1.49
Town of Milliken        catchup_units                   39             47-79    0.62
Town of Milliken        keepup_units_5yr               295           199-331    1.11
City of Alamosa         total_need_5yr                 352           445-515    0.73
Town of Erie            unit_gap                       119   n/a (by design)       -

Ratios are calibration signals, not error measurements -- read each caveat.
```

