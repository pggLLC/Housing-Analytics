# `js/workflow/recommendation-contract.js`

Step 7 — the recommendation, as data.

Every conclusion this repo can reach is computed somewhere: the HNA's short
answer, the AMI-gap module, the ownership screen, the deal calculator. None
of them are ever assembled on one screen, so the reader finishes the workflow
holding six separate pages and no answer.

This module is the assembly, and it is deliberately a DATA CONTRACT rather
than a harvest of the other pages' DOM. The workflow's own saved state is
already a DOM harvest — WorkflowState.setStep('hsa', …) stores
`costBurden: "49.5%"`, a formatted string scraped out of a <span> — and a
synthesis built on that inherits every one of its silences. A step that was
never opened and a step whose element was missing look identical.

So place conclusions come from data/hna/jurisdiction-metrics-digest/<geoid>.json,
which carries value, confidence, source_id, as_of, geography_level and the
denominator for every one of its 136 metrics. Project facts come from
WorkflowState and are quoted back as what the reader RECORDED, never
re-derived.

── Insufficient evidence is the normal case, not the error case ──

220 of 546 Colorado jurisdictions carry `confidence: "low"` on the core need
metrics, and 199 have a cost-burden rate computed on a denominator below the
floor. For CDPs it is 146 of 210. A page that only worked when the data was
good would be wrong for most of the state, so the insufficient state is a
first-class verdict here with its own text, not a hole where a verdict
should be.

The signal that matters most is not confidence but `geography_level`. A
small place's median home value often arrives as `county_context` — a real
number about the surrounding county, sitting in the place's record. Aetna
Estates (CDP) reports $52,038, which is Adams County's adjusted figure and
not any house in Aetna Estates. Presenting that as the place's answer is the
exact failure this page exists to stop, so a borrowed figure is always named
as borrowed.

Pure. No DOM, no fetch, no clock: everything arrives as arguments.

## Symbols

### `evidence(metrics, key, label, options)`

Read one digest metric into an evidence item, with its state and the
reason for that state.

Order matters: a metric can be several kinds of unusable at once, and the
reader needs the one that would change what they do. "We have no figure"
ranks above "the figure is about the next town over", which ranks above
"the figure rests on 40 households".

### `COMPUTED_AT`

Where each conclusion was computed.

#1620 §6 criterion 7 asks for "one screen, conclusion first, then evidence
links back to steps 2-6". Before this the evidence tables named their
source_id and nothing more, so a reader could see that a figure came from
`hud-chas-place-apportioned` and still had no way to reach the page that
shows the working.

Three of the five point at the same chapter. That is not laziness — "How
much of what, for whom, and what is already available" is the chapter that
carries the scorecard, the 20-year need and the ownership screen, and
sending the reader somewhere tidier would send them somewhere the number
is not.

The anchors are guarded: test:recommendation asserts each page exists and
actually contains that id, so a chapter that moves a section breaks the
build rather than shipping a link that scrolls nowhere.

### `headline(conclusions, geographyName)`

The headline.

It names a tenure strategy only when the ownership conclusion actually
reached one. Otherwise it says there is no recommendation and why, rather
than softening an absence into a hedge that reads like advice.

### `build(input)`

@param {Object} input.digest    parsed jurisdiction-metrics-digest/<geoid>.json
@param {Object} input.project   WorkflowState active project, or null
@param {string} input.generatedAt  ISO stamp supplied by the caller
