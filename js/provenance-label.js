/** Shared novice-facing provenance labels and markup. */
(function (root, factory) {
  'use strict';
  var label = factory();
  if (typeof module === 'object' && module.exports) module.exports = label;
  if (root) root.ProvenanceLabel = label;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function value(record, snake, camel) {
    return record && (record[snake] != null ? record[snake] : record[camel]);
  }

  function plain(value) {
    return String(value || '')
      .replace(/\bVERIFY\b/g, 'needs confirmation')
      .replace(/\bobserved\b/gi, 'source-reported')
      .replace(/\bmodeled\b/gi, 'calculated')
      .replace(/\buser_entered\b/gi, 'owner input')
      .replace(/\bnot_available\b/gi, 'unavailable')
      .replace(/\bhypothesis_to_test\b/gi, 'hypothesis to test')
      .replace(/\bowner_inputs_pending\b/gi, 'values still needed')
      .replace(/\bis_commitment\b/gi, 'commitment status')
      .replace(/\b(?:observation_class|evidence_basis)\b/gi, 'evidence status')
      .replace(/\bprimary_source\b/gi, 'primary source')
      .replace(/\bnamed_unretrieved\b/gi, 'named source awaiting review')
      .replace(/\bstated_method\b/gi, 'stated method')
      .replace(/\bmachine_inferred\b/gi, 'machine calculated')
      .replace(/\bhuman_verified\b/gi, 'human checked')
      .replace(/\bunverified\b/gi, 'not yet checked');
  }

  function provenanceLabel(record) {
    record = record || {};
    var classification = value(record, 'classification', 'classification');
    var observation = value(record, 'observation_class', 'observationClass');
    var evidence = value(record, 'evidence_basis', 'evidenceBasis');
    var sourceLink = value(record, 'source_url', 'sourceUrl') || null;
    var verifiedAt = value(record, 'last_verified', 'lastVerified') || null;
    var note = plain(value(record, 'source_note', 'sourceNote'));
    var method = plain(value(record, 'calculation_note', 'calculationNote') || value(record, 'method', 'method') || note);
    var state;

    if (classification === 'observed' && observation === 'human_verified' && evidence === 'primary_source') state = 'source';
    else if (classification === 'modeled' && observation === 'machine_inferred' && evidence === 'stated_method') state = 'calculated';
    else if (classification === 'not_available' && observation === 'unverified' && evidence === 'named_unretrieved') state = 'unretrieved';
    else if (classification === 'user_entered' && observation === 'unverified' && evidence === 'none') state = 'input';
    else if (classification === 'derived' || classification === 'modeled') state = 'calculated';
    else if (classification === 'observed' || (!classification && sourceLink && verifiedAt)) state = 'source';
    else if (classification === 'not_available' && (sourceLink || note)) state = 'unretrieved';
    else state = 'input';

    if (state === 'source') return {
      label: 'Source confirmed', tone: 'source',
      explanation: note || 'The cited primary source supports this value.',
      sourceLink: sourceLink, verifiedAt: verifiedAt, actionRequired: null
    };
    if (state === 'calculated') return {
      label: 'Calculated estimate', tone: 'calculated',
      explanation: method ? 'Method and assumptions: ' + method : 'Calculated from the stated screening method and its disclosed assumptions.',
      sourceLink: sourceLink, verifiedAt: verifiedAt, actionRequired: null
    };
    if (state === 'unretrieved') return {
      label: 'Not yet verified', tone: 'pending',
      explanation: note || 'A named document exists, but its applicable terms have not yet been retrieved and checked.',
      sourceLink: sourceLink, verifiedAt: verifiedAt,
      actionRequired: 'Retrieve and check the named document before relying on this value.'
    };
    return {
      label: 'Enter your value', tone: 'action',
      explanation: note || 'This is a screening placeholder without external evidence.',
      sourceLink: sourceLink, verifiedAt: verifiedAt,
      actionRequired: 'Replace this value with a project-specific owner input before use.'
    };
  }

  provenanceLabel.html = function (record, options) {
    var item = provenanceLabel(record);
    var opts = options || {};
    var source = item.sourceLink
      ? ' <a data-provenance-source href="' + esc(item.sourceLink) + '" target="_blank" rel="noopener">' + esc(opts.sourceText || 'View cited source') + '</a>' : '';
    var date = item.verifiedAt ? ' <span data-provenance-date>Checked ' + esc(item.verifiedAt) + '</span>' : '';
    var action = item.actionRequired ? ' <strong data-provenance-action>' + esc(item.actionRequired) + '</strong>' : '';
    return '<span class="provenance provenance--' + esc(item.tone) + '" data-provenance-label="' + esc(item.label) + '">' +
      '<span class="provenance__label">' + esc(item.label) + '</span>' +
      (opts.compact ? '' : '<span class="provenance__explanation"> — ' + esc(item.explanation) + action + source + date + '</span>') + '</span>';
  };

  return provenanceLabel;
}));
