# LIHTC Deal Predictor

Recommends a credit-execution path (**9% competitive**, **4% PAB-financed**, or **Either**) for a proposed LIHTC deal, plus a concept-type suggestion, indicative unit/AMI mix, capital stack shape, and scenario sensitivity. Surfaces the reasoning and risks as plain-English rationale lines so the recommendation is inspectable, not a black box.

**Primary code**: [`js/lihtc-deal-predictor.js`](../../js/lihtc-deal-predictor.js)
**Tests**: [`test/lihtc-deal-predictor.test.js`](../../test/lihtc-deal-predictor.test.js) — 31 assertions covering every branch of the decision tree

---

## What it does

Given a set of deal inputs (proposed unit count, affordability gap context, competitive saturation, soft funding availability, PMA score, basis-boost designations), the predictor outputs a recommended execution path with:
- `recommendedExecution`: `'9%'` / `'4%'` / `'Either'`
- `conceptType`: housing-type concept (family / seniors / supportive / mixed)
- `suggestedUnitMix` and `suggestedAMIMix`
- `indicativeCapitalStack`: placeholder sources & uses
- `keyRationale`: ordered plain-English justifications for the chosen path
- `keyRisks`: concrete risks flagged against the recommendation
- `caveats`: data-quality notes (e.g. _"PMA score not provided — credit type recommendation uses defaults"_)
- `confidence`: `'low'` / `'medium'` / `'high'`, from how complete the inputs are
- `scenarioSensitivity`: what changes if key inputs (saturation, PMA score) shift

Exposed as `window.LIHTCDealPredictor.predictConcept(inputs)` in the browser and via `module.exports` for Node/tests.

---

## Inputs

Every field is optional. Missing fields fall through to defaults + a caveat.

| Field | Type | Default | Notes |
|---|---|---|---|
| `proposedUnits` | integer | 60 | Total units in the deal |
| `ami30UnitsNeeded` | integer | 0 | Units at ≤30% AMI the local HNA says are missing |
| `totalUndersupply` | integer | 0 | Total affordable unit gap (any tier) |
| `competitiveSetSize` | integer | 0 | Count of existing LIHTC projects within ~1 mile |
| `softFundingAvailable` | dollars | (default) | Soft / gap funding the developer has lined up |
| `pmaScore` | 0–100 | 50 | Primary Market Area composite score |
| `isQct` | boolean | false | Qualified Census Tract designation |
| `isDda` | boolean | false | Difficult Development Area designation |
| `pabCapAvailable` | boolean\|null | null | `true`/`false`/`null` (unknown). Gates the 4% path |
| `seniorsDemand` | boolean | false | Feeds concept-type selection |
| `supportiveNeed` | boolean | false | Feeds concept-type selection |

---

## Methodology

### Execution path (`_selectExecution`, lines 215–279)

The decision tree, in priority order:

1. **Oversaturated + no soft funding** → `Either`. Both paths face headwinds; risk surfaced explicitly.
2. **Market saturated (≥5 in buffer)** → saturation risk logged, but execution decision continues.
3. **Deep affordability + small + low saturation** → `9%`. \"Deep\" = more than 25% of units at ≤30% AMI. \"Small\" = fewer than 100 units. \"Low saturation\" = competitive set <3.
4. **Large scale (≥100 units) + soft funding** → `4%`. PAB cap status gates this: if explicitly `false`, downgrades to `Either` with a PAB-cap risk logged.
5. **Small scale fallback** → `9%`. The default for sub-100-unit deals with affordability pressure.
6. **Large scale without soft funding** → `Either` with an explicit \"coordinate PAB cap with CHFA\" risk.

### Saturation signalling (`_identifyRisks`, lines 415–443)

Two thresholds:
- **Medium threshold (≥3 in buffer)**: fires the line _\"Market saturation: N competitive LIHTC projects within the market area\"_
- **High threshold (≥5 in buffer)**: adds _\"Market saturation: N competitive LIHTC projects within 1 mile may limit absorption\"_ (in the execution-selection step)

Both surface as `keyRisks`. The simulator test file [`test/lihtc-deal-predictor.test.js`](../../test/lihtc-deal-predictor.test.js) locks in the two-threshold boundary explicitly so a future refactor can't silently collapse them.

### Basis-boost rationale
If `isQct` or `isDda` is true, a _\"…provides up to 30% basis boost — improves equity yield\"_ line is appended to `keyRationale`. Purely a signal to the reader; doesn't change the recommended execution path.

### Concept type (`_selectConceptType`, lines 283–306)
Choices: family, seniors, supportive, mixed. Driven by `seniorsDemand`, `supportiveNeed`, deep-affordability share, and PMA score.

### Confidence (`_computeConfidence`, lines 189–206)
Input-completeness score. `'high'` requires most inputs populated (HNA gap + PMA score + QCT/DDA + PAB cap status + soft funding). `'low'` means we defaulted most fields.

---

## Outputs

Interpret the fields as follows:

| Field | Interpretation |
|---|---|
| `recommendedExecution` | The path the tool thinks this deal should pursue, subject to `keyRisks` |
| `keyRationale` | Read top-to-bottom — strongest reason first |
| `keyRisks` | Concrete issues that could break the recommendation |
| `caveats` | What the tool didn't know; each caveat lists a specific missing input |
| `confidence` | How much the recommendation depends on defaults vs. real inputs |
| `scenarioSensitivity` | \"What changes if saturation moves ±2\" — ready for UI display |

The legacy `predict(inputs)` wrapper returns a simpler `{ feasibilityScore, recommendation, breakdown, disclaimer }` shape for callers that expected the pre-Phase-3 API.

---

## Limitations

| Limitation | Detail |
|---|---|
| Not a CHFA scoring model | This predicts *execution path*, not QAP points. Use the [QAP Simulator](./qap-simulator.md) for scoring |
| Absolute thresholds are heuristics | Saturation medium=3 / high=5 and deep-affordability=25% are defensible defaults, not CHFA policy |
| Historical patterns only | The model is calibrated against 2015–2025 allocation data. 2026 QAP changes may shift what actually wins |
| Unit / AMI mix are illustrative | The suggested breakdowns are starting points. Local market studies and the deal's actual targeting control the real mix |
| Capital stack is placeholder | Not a real pro-forma — see the [Pro Forma guide](./pro-forma.md) for that |

---

## Related

- [Pro Forma guide](./pro-forma.md) — operating pro forma for any concept the predictor suggests
- [QAP Simulator guide](./qap-simulator.md) — competitiveness scoring for the recommended path
- [Data Quality doc](../DATA_QUALITY.md) — staleness/corruption/schema signals that the predictor's inputs depend on

## Change log
- 2026-04-21: regression test shipped in [#667](https://github.com/pggLLC/Housing-Analytics/pull/667) — 31 assertions lock in execution-path branches, saturation thresholds, basis-boost rationale, caveat surfacing.
