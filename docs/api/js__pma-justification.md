# `js/pma-justification.js`

js/pma-justification.js
Automated PMA justification narrative generation and audit trail export.

Responsibilities:
 - synthesizePMA(components) — combine all module outputs into a ScoreRun
 - generateNarrative(scoreRun) — plain-English justification (<500 words)
 - generateAuditTrail(scoreRun) — full audit metadata with data vintage
 - exportToJSON(scoreRun) — JSON export for audit trail
 - getLayerOrder() — ordered list of decision factor layers for map display

Depends on (all optional): PMACommuting, PMABarriers, PMASchools,
PMATransit, PMACompetitiveSet, PMAOpportunities, PMAInfrastructure.

Exposed as window.PMAJustification.

## Symbols

### `resolveDataVintage(overrides)`

ACS vintage label from the tract metrics metadata, e.g. 'ACS_2024_5YR'.
Source: overrides.acsMeta, else the page's cached tract metrics
(PMADataCache 'acsMetrics'). null when neither carries a vintage.

### `runVintage(scoreRun)`

The vintage to report for a run, which may be a saved one restored from
localStorage. Runs saved before 2026-10-17 carry a hard-coded label that
did not come from the data, so only a label marked as read from the tract
metadata is trusted. When the tract data loaded now is a different
vintage, the label stays the run's own and a note says to re-run.
@returns {{ label: (string|null), note: (string|null) }}

### `generateNarrative(scoreRun)`

Generate a plain-English justification narrative from a ScoreRun.
Target: ≤500 words, suitable for LIHTC/CHFA application attachments.

@param {object} [scoreRun] - defaults to lastScoreRun
@returns {string} narrative text

### `generateAuditTrail(scoreRun)`

Generate an audit trail object for regulatory compliance purposes.
@param {object} [scoreRun]
@returns {object}

### `exportToJSON(scoreRun)`

Export the full ScoreRun as a JSON string.
@param {object} [scoreRun]
@returns {string} JSON string

### `getLayerOrder()`

Return the ordered list of decision factor layers for the map picker.
@returns {Array.<string>}
