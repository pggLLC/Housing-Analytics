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

### `generateScenarios(acs, existingUnits, scenarioList)`

Run multiple what-if scenarios for different proposed unit counts.
@param {object} acs - aggregated ACS metrics
@param {number} existingUnits - existing LIHTC units in buffer
@param {Array}  scenarioList - array of {label, proposedUnits, amiMix}
@returns {Array} scenarioResults

### `exportWithMetadata(result, quality, scenarios, benchmark, pipeline)`

Build a comprehensive export object with full provenance.
@param {object} result   - lastResult from runAnalysis
@param {object} quality  - from calculateDataQuality
@param {Array}  scenarios - from generateScenarios
@param {object} benchmark - from benchmarkVsReference
@param {object} pipeline  - from analyzeCompetitivePipeline
@returns {object} exportPayload
