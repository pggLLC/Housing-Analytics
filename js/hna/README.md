# `js/hna/` — Housing Needs Assessment Browser Modules

`js/housing-needs-assessment.js` (originally 5,000+ lines) has been split into
five focused browser-script modules that each run as an immediately-invoked
function expression (IIFE) and communicate through shared `window.*` globals.

## Module overview

| File | `window` export | Responsibility |
|------|-----------------|----------------|
| `hna-utils.js` | `window.HNAUtils` | Constants, pure helpers, formatting, calculations |
| `hna-narratives.js` | `window.HNANarratives` | Narrative text builders and copy generation |
| `hna-renderers.js` | `window.HNARenderers` | DOM render functions (charts, maps, stat cards) |
| `hna-export.js` | `window.HNAExport` | PDF / CSV / JSON export thin-wrapper |
| `hna-controller.js` | `window.HNAController`, `window.HNAState` | Init, state management, data fetching, event orchestration |

## Required load order

Modules must be loaded in dependency order.  In
`housing-needs-assessment.html` the `<script defer>` tags appear as:

```
js/hna-export.js          ← actual export implementation (window.__HNA_exportPdf / Csv / Json)
js/hna/hna-utils.js
js/hna/hna-narratives.js  ← depends on HNAUtils
js/hna/hna-renderers.js   ← depends on HNAState, HNAUtils
js/hna/hna-export.js      ← thin wrapper that delegates to window.__HNA_* from hna-export.js
js/compliance-checklist.js
js/data-connectors/hud-fmr.js
js/hna/hna-controller.js  ← depends on HNAUtils, HNARenderers; sets up HNAState and HNAController
js/housing-needs-assessment.js  ← 38-line compatibility stub (warns if HNAController absent)
```

## Shared state

`hna-controller.js` initializes `window.HNAState` before any module method is
called.  Renderer and narrative helpers access it via the module-local
shorthand `S() → window.HNAState` and `U() → window.HNAUtils`.

## Compatibility stub

`js/housing-needs-assessment.js` is retained so that any legacy script tag or
dynamic `import()` of the original path still loads without a 404.  It emits a
`console.warn` if `window.HNAController` is not found and sets
`window.__HNA_STUB_LOADED = true` so automated tests can detect stub-only runs.

## Testing

`test/hna-functionality-check.js` concatenates all five module sources into a
single string and runs the full assertion suite against the combined text —
reproducing the same view the browser has after all `<script defer>` tags have
executed.
