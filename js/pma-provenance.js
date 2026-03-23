/**
 * js/pma-provenance.js
 * Scaffolding for PMA data provenance and fallback-mode disclosure.
 *
 * This module provides lightweight helpers for tracking and communicating
 * the data-sourcing mode for each PMA factor.  Full integration with the
 * PMA confidence badge UI is deferred to a future PR.
 *
 * Exposed as window.PMAProvenance.
 *
 * TODO (Future PR): wire provenance records into the PMA confidence badge
 *   rendered by js/pma-confidence.js renderConfidenceBadge().  Integration
 *   point: call PMAProvenance.getRecord(runId) after PMAAnalysisRunner
 *   emits 'complete', then pass the record to renderConfidenceBadge().
 *
 * @module pma-provenance
 */
(function () {
  'use strict';

  /* ── Data-sourcing modes ──────────────────────────────────────────── */

  /**
   * Allowed provenance modes for a PMA factor.
   *
   * 'live'        — factor was computed from a live API call during this session
   * 'cached'      — factor was loaded from a recently cached static JSON file
   * 'synthetic'   — factor was estimated using a county-scaled or model-derived value
   * 'placeholder' — factor is a hard-coded default; real data not yet available
   */
  var MODES = Object.freeze({
    LIVE:        'live',
    CACHED:      'cached',
    SYNTHETIC:   'synthetic',
    PLACEHOLDER: 'placeholder'
  });

  /**
   * Allowed confidence levels for a provenance record.
   *
   * 'high'   — primary data source, fresh vintage, full coverage
   * 'medium' — cached or slightly stale but sufficient for planning
   * 'low'    — synthetic / placeholder; treat output as preliminary only
   */
  var CONFIDENCE = Object.freeze({
    HIGH:   'high',
    MEDIUM: 'medium',
    LOW:    'low'
  });

  /* ── Internal record store ────────────────────────────────────────── */

  // Map of runId → provenance record (in-memory, cleared on page reload)
  var _store = Object.create(null);

  /* ── Helpers ──────────────────────────────────────────────────────── */

  function _ts() {
    return new Date().toISOString();
  }

  /**
   * Derive a summary confidence level from an array of per-factor modes.
   * The weakest factor governs the overall level.
   *
   * @param {string[]} modes - array of MODES values for all active factors
   * @returns {string} CONFIDENCE value
   */
  function _summarizeConfidence(modes) {
    if (!modes || !modes.length) return CONFIDENCE.LOW;
    if (modes.indexOf(MODES.PLACEHOLDER) !== -1) return CONFIDENCE.LOW;
    if (modes.indexOf(MODES.SYNTHETIC)   !== -1) return CONFIDENCE.MEDIUM;
    if (modes.indexOf(MODES.CACHED)      !== -1) return CONFIDENCE.MEDIUM;
    return CONFIDENCE.HIGH;
  }

  /* ── Public API ───────────────────────────────────────────────────── */

  /**
   * Create a new provenance record for a PMA run.
   *
   * @param {string}   runId       - unique run identifier from PMAJustification
   * @param {object}   factors     - map of factor name → mode string
   *                                 e.g. { commuting: 'live', schools: 'cached', … }
   * @param {string}   [lastUpdated] - ISO-8601 timestamp of the underlying data
   * @returns {object} provenance record
   */
  function createRecord(runId, factors, lastUpdated) {
    factors = factors || {};
    var modes = Object.keys(factors).map(function (k) { return factors[k]; });
    var confidence = _summarizeConfidence(modes);

    var record = {
      runId:       runId,
      createdAt:   _ts(),
      lastUpdated: lastUpdated || null,
      factors:     factors,
      confidence:  confidence,
      // Human-readable summary for UI disclosure
      summary:     _buildSummary(factors, confidence)
    };

    _store[runId] = record;
    return record;
  }

  /**
   * Retrieve a previously created provenance record.
   *
   * @param {string} runId
   * @returns {object|null}
   */
  function getRecord(runId) {
    return _store[runId] || null;
  }

  /**
   * Return a plain-English disclosure note suitable for display beneath the
   * PMA confidence badge.
   *
   * @param {object} record - result of createRecord()
   * @returns {string}
   */
  function getDisclosureNote(record) {
    if (!record) return '';
    var synth = Object.keys(record.factors).filter(function (k) {
      return record.factors[k] === MODES.SYNTHETIC ||
             record.factors[k] === MODES.PLACEHOLDER;
    });
    if (synth.length === 0) {
      return 'All PMA factors are sourced from live or recently cached data.';
    }
    return (
      'The following PMA factors use synthetic or placeholder values and ' +
      'should be treated as preliminary: ' + synth.join(', ') + '. ' +
      'Confidence level: ' + record.confidence + '.'
    );
  }

  /* ── Internal helpers ─────────────────────────────────────────────── */

  function _buildSummary(factors, confidence) {
    var factorList = Object.keys(factors).map(function (k) {
      return k + ' (' + factors[k] + ')';
    }).join(', ');
    return 'Confidence: ' + confidence +
           (factorList ? '. Factors: ' + factorList : '') + '.';
  }

  /* ── Export ───────────────────────────────────────────────────────── */

  window.PMAProvenance = {
    MODES:              MODES,
    CONFIDENCE:         CONFIDENCE,
    createRecord:       createRecord,
    getRecord:          getRecord,
    getDisclosureNote:  getDisclosureNote
  };

})();
