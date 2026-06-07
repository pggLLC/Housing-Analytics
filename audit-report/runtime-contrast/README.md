# Runtime contrast audit — backlog

Last full sweep: F132 (2026-06-07).

## Headline numbers

| Snapshot      | Failures | vs F128 baseline |
|---------------|----------|------------------|
| F128 baseline | **3,195** | — |
| F131          | 1,267 | -1,928 (-60%) |
| F132 wave 1   | 156   | -1,111 (-90%) |
| F132 wave 2   | 410   | (guard fix surfaced hidden backlog) |
| F132 wave 3   | 57    | -3,138 (-98.2%) |

The full per-page-per-mode JSON for the F132 stop-point is at
`F132-final-backlog.json`.

## Remaining 57 — categorized

Top patterns and where they live. Fix-by-fix grinding work; not blocking
public release because each is a small-count edge case in a specific
component, not a systemic issue.

| Count | Pattern | Location | Notes |
|-------|---------|----------|-------|
| 14 | `rgb(198,40,40) on rgb(13,30,48)` | `dashboard-data-sources-ui.html[dark]` SPAN elements | Hardcoded `#c62828` (light --bad) painted on dark navy. Inline `color:var(--bad)` somewhere is resolving as light-mode value. |
| 5 | `rgb(0,90,156) on dark` | `economic-dashboard.html[dark]` `A.contrast-guard-fixed` | Contrast-guard misfix surviving from earlier paint |
| 4 (light+dark) | `rgb(100,116,139) on bg2` | `indibuild-brief.html` CODE | `<code>` element styling — light --muted hardcoded |
| 3 | `rgb(229,231,235) on white` | `cra-expansion-analysis.html[light]` `SPAN.contrast-guard-fixed` | Contrast-guard misfix |
| 3 | `rgb(255,255,255) on bg2` | `cra-expansion-analysis.html[light]` DIV | White text on light bg2 (4.7:1 borderline) |
| 2 | `rgb(255,255,255) on rgb(255,255,255)` | `colorado-deep-dive.html[dark]` `BUTTON.map-reset-btn.leaflet-control` | Leaflet button with white-on-white in dark mode — genuine misfix from contrast-guard or theme cascade |
| 2 | `rgb(255,255,255) on rgb(15,212,207)` | `cra-expansion-analysis.html[dark]` DIV | White on accent cyan = 1.85:1 |
| 2 | `rgb(255,255,255) on rgb(52,211,153)` | `data-status.html[dark]` SPAN | White on dark-mode --good = 2:1 |
| 2 | `rgb(75,85,99) on dark` | `deal-calculator.html[light]` `DIV.qsim-gauge-marker-label` | Custom gauge component label |
| 2 | `rgba(190,210,235,.9) on rgb(228,240,252)` | `deal-calculator.html[dark]` `DIV.qsim-gauge-marker-label` | Same gauge in dark — light text on lighter bg |
| 2 | `rgb(255,255,255) on rgb(226,63,37)` | `housing-needs-assessment.html[light]` SPAN | White on bright red = 3.5:1 borderline |
| ~12 | Various single-digit | Various | Scatter |

## How to keep it from regrowing

1. **`npm run test:runtime-contrast`** — manual run when needed
2. Once the 57 hits 0, wire it into `npm run test:ci` so PRs can't add new failures
3. Static gates (`test:inline-contrast`, `test:inline-heading-typography`,
   `test:pill-contrast`) catch the source-pattern subset; runtime catches
   the cascade interactions the static gates structurally can't see.
