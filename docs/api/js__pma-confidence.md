# `js/pma-confidence.js`

js/pma-confidence.js
Heuristic confidence scoring for the PMA (Public Market Analysis) engine.

Computes a 0–100 confidence score from five independent factors:
  1. Data completeness  — % of tracts with non-null ACS metric values
  2. Temporal freshness — age of ACS vintage year vs. current date
  3. Geographic coverage — count of LIHTC projects vs. expected baseline
  4. Sample size adequacy — minimum tract count for stable aggregate
  5. Buffer proximity  — how many tracts fall within the analysis buffer

Confidence levels:
  🟢 High   (≥80) — Full confidence in PMA score
  🟡 Medium (60–79) — Moderate; recommend validation
  🔴 Low    (<60) — Sparse data; treat as preliminary

Exposed as window.PMAConfidence.

## Symbols

### `scoreCompleteness(acsTracts)`

Measures the proportion of required ACS fields that are non-null
across the loaded tracts.
@param {Array} acsTracts
@returns {number} 0–100

### `scoreFreshness(generatedYear)`

Penalises data older than the target vintage.
ACS releases a new 5-year dataset roughly every year.
@param {number|string} [generatedYear]  - Vintage year of the data (e.g. 2022)
@returns {number} 0–100

### `scoreLihtcCoverage(lihtcCount)`

Measures LIHTC project count relative to expected statewide baseline.
@param {number} lihtcCount
@returns {number} 0–100

### `scoreSampleSize(tractCount)`

Adequate total statewide tract count enables stable aggregate statistics.
@param {number} tractCount
@returns {number} 0–100

### `scoreBufferDepth(bufferTractCount)`

How many tracts fall within the analysis buffer.
Very few buffer tracts → unreliable local aggregate.
@param {number} bufferTractCount
@returns {number} 0–100

### `compute(params)`

Compute the overall heuristic confidence score (0–100).

@param {object} params
@param {Array}  params.acsTracts      - Loaded ACS tract records
@param {number} params.lihtcCount     - Number of LIHTC features loaded
@param {number} params.centroidCount  - Number of tract centroids loaded
@param {number} params.bufferTracts   - Number of tracts within the analysis buffer
@param {number} [params.acsVintage]   - ACS data vintage year (e.g. 2022)
@returns {{ score: number, level: string, color: string, factors: object }}

### `renderConfidenceBadge(elementId, result)`

Update a DOM element (by id) with the formatted confidence result.
@param {string} elementId
@param {{ score, level, color }} result
