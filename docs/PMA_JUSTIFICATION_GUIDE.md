# PMA Justification Guide

*Housing Analytics — Colorado LIHTC & Affordable Housing*

This guide explains how to use the automated PMA justification narrative generator, how to override automated boundaries with analyst rationale, and provides examples from Colorado LIHTC sites.

---

## 1. How the Automated Narrative Works

The `PMAJustification.generateNarrative(scoreRun)` function produces a plain-English rationale document in the following structure:

```
1. Boundary method + capture rate (LODES commuting data, if used)
2. Barrier exclusions (water, highways, land cover)
3. Employment center summary (top attractor + total count)
4. School district alignment (district count + avg performance)
5. Transit accessibility (score + walk score)
6. Opportunity Zone share + incentive eligibility
7. Infrastructure flags (flood risk, utility capacity, food access)
8. Data quality statement + run ID
```

**Target length:** ≤500 words. The narrative is designed to be pasted directly into a LIHTC or CHFA market study attachment.

**Example output (Denver LIHTC proposal):**

> This PMA boundary was delineated using LEHD/LODES commuting flow analysis (vintage 2021), capturing approximately 74 % of likely future residents from 1,847 workplace locations within the study area.
>
> The boundary excludes significant natural and manmade barriers, including 2 water feature(s) and 3 major highway segment(s), which prevent practical access for prospective residents.
>
> The PMA is served by 4 major employment center(s). The largest concentration (14,200 jobs) is in the Healthcare sector, making this location well-suited for workforce housing demand.
>
> The PMA boundary aligns with 3 school district(s), with an average performance score of 72 out of 100, supporting family-oriented demand for affordable housing in this area.
>
> Transit accessibility within the PMA is strong, with a composite score of 71/100 (walk score: 64).
>
> 32 % of the PMA falls within a federally designated Opportunity Zone, making the project potentially eligible for LIHTC basis step-down incentives and New Markets Tax Credits.
>
> Data vintage: ACS_2023_5YR. Analysis quality: HIGH. Run ID: pma-run-20260308-A3F2K.

---

## 2. Running the Analysis

### Via the UI (market-analysis.html)

1. Navigate to **Market Analysis → PMA Scoring Tool**.
2. Select a delineation method tab: **Commuting-based** or **Hybrid**.
3. Click anywhere on the map to place a site marker.
4. Click **Run Analysis** — the progress bar shows each step as it completes.
5. When complete, scroll to **PMA Justification Narrative** in the right panel.
6. Click **Export Audit Trail (JSON)** to download the full ScoreRun.

### Via JavaScript

```javascript
// Run the full pipeline
const runner = window.PMAAnalysisRunner;
runner.run(39.7392, -104.9847, {
  method: 'commuting',    // 'buffer' | 'commuting' | 'hybrid'
  bufferMiles: 5,
  proposedUnits: 100
})
.on('progress', function(step) {
  console.log(step.label, step.pct + '%');
})
.on('complete', function(scoreRun) {
  const narrative = window.PMAJustification.generateNarrative(scoreRun);
  console.log(narrative);

  const json = window.PMAJustification.exportToJSON(scoreRun);
  // Save as audit-trail.json
});
```

---

## 3. Overriding Automated Boundaries with Analyst Rationale

Analysts may override specific components using the `overrides` parameter to `synthesizePMA()`:

```javascript
const scoreRun = window.PMAJustification.synthesizePMA({
  // Override commuting data with analyst-verified figures
  commuting: {
    lodesWorkplaces: 2200,
    captureRate: 0.68,
    residentOriginZones: [
      { tractId: '08031001700', lat: 39.74, lon: -104.97, estimatedWorkers: 400 },
      // ...
    ]
  },
  // Override schools with manually verified data
  schools: {
    schoolDistrictsAligned: 2,
    averagePerformanceScore: 78,
    alignmentRationale: 'Site falls within Denver Public Schools attendance boundary (manual verification, March 2026).'
  }
});
```

The narrative generator will use the overridden values exactly as provided.

### Modifying the narrative after generation

The returned narrative is a plain string. Analysts can append analyst comments:

```javascript
let narrative = window.PMAJustification.generateNarrative(scoreRun);
narrative += '\n\nAnalyst note: The eastern boundary has been manually adjusted to exclude the I-70 corridor based on field observation and community input (March 2026).';
```

---

## 4. ScoreRun Audit Trail Fields

The `generateAuditTrail()` function returns:

| Field | Type | Description |
|---|---|---|
| `run_id` | string | Unique run identifier (e.g. `pma-run-20260308-A3F2K`) |
| `generated_at` | ISO-8601 | Timestamp of audit trail generation |
| `schema_version` | string | ScoreRun schema version (currently `2.0`) |
| `data_vintage` | string | ACS vintage (e.g. `ACS_2023_5YR`) |
| `lodes_vintage` | string | LODES data year (e.g. `2021`) |
| `narrative` | string | Full plain-text narrative |
| `layers` | string[] | Ordered list of decision factor layers |
| `component_weights` | object | Data sources used per component |
| `data_quality` | `HIGH` / `MEDIUM` / `LOW` | Based on proportion of components with real data |
| `alternative_pmas` | array | Analyst-supplied alternative boundary descriptions |

**Data quality tiers:**
- `HIGH` — 5 of 5 primary components populated with real API data
- `MEDIUM` — 3–4 of 5 components populated
- `LOW` — 0–2 components populated (fallback/stub data only)

---

## 5. Colorado LIHTC Examples

### Example A: Urban infill — Denver (High Opportunity)

- **Method:** Hybrid (commuting + school alignment)
- **Capture rate:** 74 % of 1,847 workplace locations
- **Barriers excluded:** South Platte River, I-25 corridor
- **School alignment:** DPS Curtis Park Elementary (score: 82)
- **Transit score:** 79/100 (RTD light rail within 0.4 miles)
- **OZ share:** 0 % (outside designated zones)
- **Flood risk:** 8 % (South Platte floodplain, AE zone)
- **Incentives:** None (high-opportunity area; standard LIHTC basis)

### Example B: Rural — Alamosa County (Distressed)

- **Method:** Commuting-based (small rural labor shed)
- **Capture rate:** 82 % of 240 workplace locations
- **Barriers excluded:** Rio Grande River corridor
- **School alignment:** Alamosa School District (score: 58)
- **Transit score:** 12/100 (no fixed-route transit; car-share recommended)
- **OZ share:** 41 % (large QOZ in San Luis Valley)
- **Flood risk:** 22 % (river floodplain)
- **Incentives:** LIHTC basis step-down (>20 % OZ), NMTC eligible (distressed community), federal preference points

### Example C: Suburban — Lakewood (Moderate Opportunity)

- **Method:** Buffer-based (5 miles, legacy — commuting data not available)
- **Barriers excluded:** None identified
- **School alignment:** Jefferson County (score: 71)
- **Transit score:** 42/100 (RTD bus routes, 20-min headways)
- **OZ share:** 12 % (partial overlap)
- **Flood risk:** 3 %
- **Incentives:** NMTC eligible (partial OZ overlap)

---

## 6. PDF Export

To generate a PDF justification report ("Score Breakdown"):

1. Run the analysis as described in Section 2.
2. Click **Explain Score** — the audit trail is logged to the browser console.
3. Use the browser's **Print → Save as PDF** feature on the Market Analysis page.
4. The exported PDF includes: justification narrative, dimension scores radar chart, LIHTC supply data, competitive set, and incentive badges.

> **Planned enhancement:** A dedicated PDF export button using `window.__HNA_exportPdf` is on the roadmap (Phase 5).

---

## 7. Backward Compatibility

- **Buffer-based mode is preserved** — selecting the "Buffer-based (legacy)" tab uses the original `tractsInBuffer()` → `computePma()` pipeline unchanged.
- **ScoreRun versioning** — new fields (`commuting`, `barriers`, `schools`, etc.) are all additive; existing `PMAEngine` consumers are not affected.
- **API fallback** — all eight PMA modules degrade gracefully to neutral stub data when external APIs are unavailable. The ACS-based scoring always runs regardless of API availability.
