# `js/pma-provenance.js`

js/pma-provenance.js
Scaffolding for PMA data provenance and fallback-mode disclosure.

This module provides lightweight helpers for tracking and communicating
the data-sourcing mode for each PMA factor.  Full integration with the
PMA confidence badge UI is deferred to a future PR.

Exposed as window.PMAProvenance.

TODO (Future PR): wire provenance records into the PMA confidence badge
  rendered by js/pma-confidence.js renderConfidenceBadge().  Integration
  point: call PMAProvenance.getRecord(runId) after PMAAnalysisRunner
  emits 'complete', then pass the record to renderConfidenceBadge().

@module pma-provenance

## Symbols

### `MODES`

Allowed provenance modes for a PMA factor.

'live'        — factor was computed from a live API call during this session
'cached'      — factor was loaded from a recently cached static JSON file
'synthetic'   — factor was estimated using a county-scaled or model-derived value
'placeholder' — factor is a hard-coded default; real data not yet available

### `CONFIDENCE`

Allowed confidence levels for a provenance record.

'high'   — primary data source, fresh vintage, full coverage
'medium' — cached or slightly stale but sufficient for planning
'low'    — synthetic / placeholder; treat output as preliminary only

### `_summarizeConfidence(modes)`

Derive a summary confidence level from an array of per-factor modes.
The weakest factor governs the overall level.

@param {string[]} modes - array of MODES values for all active factors
@returns {string} CONFIDENCE value

### `createRecord(runId, factors, lastUpdated)`

Create a new provenance record for a PMA run.

@param {string}   runId       - unique run identifier from PMAJustification
@param {object}   factors     - map of factor name → mode string
                                e.g. { commuting: 'live', schools: 'cached', … }
@param {string}   [lastUpdated] - ISO-8601 timestamp of the underlying data
@returns {object} provenance record

### `getRecord(runId)`

Retrieve a previously created provenance record.

@param {string} runId
@returns {object|null}

### `getDisclosureNote(record)`

Return a plain-English disclosure note suitable for display beneath the
PMA confidence badge.

@param {object} record - result of createRecord()
@returns {string}
