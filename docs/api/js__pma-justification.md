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

### `synthesizePMA(overrides)`

Synthesize all PMA component outputs into a single ScoreRun object.
Calls each module's justification accessor when available.

@param {object} [overrides] - manually supplied component data (optional)
@returns {object} ScoreRun

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
