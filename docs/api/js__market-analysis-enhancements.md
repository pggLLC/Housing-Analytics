# `js/market-analysis-enhancements.js`

js/market-analysis-enhancements.js
Enhanced PMA capabilities: peer benchmarking, pipeline analysis, scenario modeling.

Responsibilities:
 - benchmarkVsReference(score, result, referenceProjects) — percentile ranking
 - analyzeCompetitivePipeline(lihtcFeatures, lat, lon, miles) — pipeline analysis
 - generateScenarios(acs, existingUnits, scenarioList) — what-if modeling
 - exportWithMetadata(result, quality, scenarios) — full audit trail export

Exposed as window.PMAEnhancements.
Dependencies: PMAEngine (window.PMAEngine) must be loaded first.

## Symbols

### `classifyPipelineStage(p, now)`

Pipeline stage for one LIHTC record.

Only two CHFA statuses name a phase: "Pre-Compliance - Construction
Phase" is a project being built, and an extended-use status comes after
the 15-year compliance period, so that property has long been open.
"Active Compliance" does NOT prove a property is open: in the 2026-09
feed 26 of the 32 2025 awards already carry it (scripts/fetch-chfa-
lihtc.js). Treating it as operating would drop likely-forthcoming
competition from the pipeline, so an Active Compliance record, like one
with no status, is staged from its award year and marked an estimate.

YR_PIS is not used: in data/chfa-lihtc.json it is a copy of the award
year, so it cannot say whether a building is placed in service.

@param {object} p   - feature properties
@param {number} now - current year
@returns {{ stage: string, basis: string, estimated: boolean, status: string|null }}

### `stageLabel(c)`

Display text for a classified stage: an estimate says it is one.

### `benchmarkVsReference(score, result, referenceProjects)`

Rank the given score against a reference project set.
@param {number} score - overall PMA score (0–100)
@param {object} result - full PMA result from computePma
@param {Array}  referenceProjects - projects from reference-projects.json
@returns {object} benchmarkResult

### `analyzeCompetitivePipeline(lihtcFeatures, lat, lon, miles)`

Analyse LIHTC supply within buffer by year cohort to infer pipeline.
Uses year_alloc to classify projects into recency stages.
@param {Array}  lihtcFeatures - all LIHTC features
@param {number} lat
@param {number} lon
@param {number} miles - buffer radius
@returns {object} pipelineResult

### `generateScenarios(acs, existingUnits, scenarioList, denominator, scorer)`

Run multiple what-if scenarios for different proposed unit counts.
@param {object} acs - aggregated ACS metrics
@param {number} existingUnits - existing LIHTC units in buffer
@param {Array}  scenarioList - array of {label, proposedUnits, amiMix}
@param {number} [denominator] - the renter-household count the page's
  other capture rates divide by (market-analysis.js captureDenominator).
  Without it the table used ACS renter_hh while the headline and the
  simulator used CHAS LIHTC-eligible renters (audit F3).
@param {Function} [scorer] - units -> computePma result with the
  headline's inputs (market-analysis.js _scenarioScorer).
@returns {Array} scenarioResults

### `exportWithMetadata(result, quality, scenarios, benchmark, pipeline)`

Build a comprehensive export object with full provenance.
@param {object} result   - lastResult from runAnalysis
@param {object} quality  - from calculateDataQuality
@param {Array}  scenarios - from generateScenarios
@param {object} benchmark - from benchmarkVsReference
@param {object} pipeline  - from analyzeCompetitivePipeline
@returns {object} exportPayload
