# PMA Confidence and Fallback Disclosure

This document describes how the Primary Market Analysis (PMA) tool computes confidence scores, discloses data provenance, and behaves when live data is unavailable.

---

## Confidence Scoring

The PMA confidence score (0–100) is computed by `js/pma-confidence.js` from five independent factors:

| Factor                 | Weight | Description                                              |
|------------------------|--------|----------------------------------------------------------|
| Data completeness      | 25%    | % of ACS fields that are non-null across buffer tracts   |
| Temporal freshness     | 20%    | Age of ACS vintage year vs. current date                 |
| LIHTC project coverage | 20%    | Count of LIHTC projects vs. statewide baseline (~500)    |
| Sample size adequacy   | 20%    | Buffer tract count vs. statewide baseline (~1,500 tracts)|
| Buffer proximity       | 15%    | Count of tracts within the analysis buffer               |

### Confidence Levels

| Level  | Score | Badge | Recommended Action                              |
|--------|-------|-------|-------------------------------------------------|
| High   | ≥ 80  | 🟢    | Proceed with confidence                         |
| Medium | 60–79 | 🟡    | Moderate confidence — recommend field validation |
| Low    | < 60  | 🔴    | Preliminary — treat as early-stage estimate      |

---

## Commuting Data Modes

The commuting module (`js/pma-commuting.js`) operates in three modes depending on data availability:

| Mode          | Description                                                      | UI Disclosure                              |
|---------------|------------------------------------------------------------------|--------------------------------------------|
| `live`        | LEHD/LODES data fetched successfully for the selected vintage    | No special label                           |
| `cached`      | Previously fetched LODES data served from local cache            | "Commuting model using cached data"        |
| `synthetic`   | No LODES data; commuting estimated from buffer-only assumptions  | "Commuting model using fallback data"      |
| `buffer-only` | Method is buffer-only; commuting flow analysis skipped           | "Buffer-only method: no commuting analysis"|

When commuting data falls back to synthetic mode, the PMA score remains valid but confidence is reduced. The confidence badge reflects this automatically through the `bufferDepth` factor.

---

## Hardcoded Neutral Values

Some PMA factor scores use hardcoded neutral values (e.g., 50/100) as placeholders when live data cannot be fetched. These are **documented as placeholders**, not measurements:

- `js/pma-opportunities.js` — Opportunity Zone overlay defaults to 50/100 when HUD OZ data is unavailable
- `js/pma-infrastructure.js` — Infrastructure feasibility defaults to 60/100 when FEMA flood data fails
- `js/pma-schools.js` — School quality defaults to 50/100 when CDE data cannot be fetched

These values are logged to the browser console and excluded from the "high confidence" threshold calculation.

---

## PMA Summary Section

The PMA results panel shows a compact summary including:
- **Selected PMA method** (buffer / commuting / hybrid)
- **Commuting data mode** (live / cached / synthetic / buffer-only)
- **Feasibility status** (preliminary / confirmed)
- **Major caveats** drawn from the confidence factor breakdown

---

## Validation

Run `pytest tests/test_pma_provenance.py` to verify:
- `js/pma-confidence.js` exposes `compute()` and `renderConfidenceBadge()`
- Confidence levels are properly ordered (High > Medium > Low thresholds)
- `js/utils/data-quality.js` exports `isMissingMetric`, `sanitizeNumber`, `formatMetric`
- `market-analysis.html` loads the confidence module and includes an `aria-live` region

---

## Future Enhancements

See `js/lihtc-deal-predictor.js` for planned deal-prediction scaffolding that will consume PMA confidence scores as an input to feasibility scoring.
