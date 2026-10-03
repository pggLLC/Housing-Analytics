/** Report disclosures from the page's existing provenance and methodology registries. */
(function (root) {
  'use strict';
  var LIMITATIONS = 'Screening only — not underwriting, an appraisal or a formal market study.';
  function present(value) { return value != null && String(value).trim() !== ''; }
  function text(value) { return present(value) ? String(value) : 'unavailable'; }
  function visible(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || root.getComputedStyle(node).display === 'none') return false;
    }
    return true;
  }
  function fieldValue(el) {
    if ('value' in el) return present(el.value) ? el.value : null;
    var copy = el.cloneNode(true);
    copy.querySelectorAll('.me-icon, .me-pop, .input-prov, [id$="-prov-detail"]').forEach(function (node) { node.remove(); });
    return copy.textContent.replace(/\s+/g, ' ').trim() || null;
  }
  function buildReportMeta() {
    var doc = root.document, scope = doc.getElementById('dealCalcMount') || doc;
    var report = { sources: [], assumptions: [], needsSource: [], methodology: [], limitations: LIMITATIONS, sharedUnverified: [] };
    var sourceIndex = new Map();
    scope.querySelectorAll('[data-provenance]').forEach(function (el) {
      var record = root.InputProvenance && root.InputProvenance.get(el);
      if (!record) return;
      var meta = record.origin.meta;
      var entry = root.DealCalculatorInputRegistry && root.DealCalculatorInputRegistry.get(el.id) || {};
      var field = { id: el.id, value: fieldValue(el), definition: entry.definition || meta.definition || el.id, status: record.status };
      if (record.sharedUnverified) {
        report.sharedUnverified.push(Object.assign({}, field, { verified: false, notice: 'From shared link — not re-checked here.', senderClaim: record.senderClaim || null,
          senderOriginalValue: record.senderOriginalValue == null ? null : record.senderOriginalValue }));
      }
      if (record.status === 'data' && !record.sharedUnverified) {
        var source = { source: meta.source, sourceUrl: meta.sourceUrl, vintage: meta.vintage, geography: meta.geography,
          effectiveDate: meta.effectiveDate || null, countyFips: meta.countyFips || null };
        var key = JSON.stringify(source);
        if (!sourceIndex.has(key)) {
          source.fields = []; sourceIndex.set(key, source); report.sources.push(source);
        }
        sourceIndex.get(key).fields.push(field);
      } else if (['assumption', 'illustrative', 'yours'].indexOf(record.status) !== -1) {
        report.assumptions.push(field);
      } else if (record.status === 'needs-source') {
        report.needsSource.push(Object.assign({}, field, { reason: meta.why || entry.why || 'A source has not been supplied.' }));
      }
    });
    if (!root.InputProvenance) report.needsSource.push({ id: 'input-provenance', value: null,
      definition: 'Input sources and assumptions', reason: 'The input provenance registry is unavailable.' });
    var registry = root.MethodologyExplainer && root.MethodologyExplainer.REGISTRY || {};
    doc.querySelectorAll('[data-methodology-key]').forEach(function (el) {
      if (!visible(el)) return;
      var key = el.dataset.methodologyKey, entry = registry[key] || {};
      var contextEl = el.methodologyContext ? el : doc.getElementById(entry.contextElementId) || el;
      var context = typeof contextEl.methodologyContext === 'function' ? contextEl.methodologyContext() : contextEl.methodologyContext;
      var calculation = entry.compute ? entry.compute(context) : null;
      var reason = calculation && calculation.unavailableReason || 'A current with-your-numbers explanation is not available for this figure.';
      var available = calculation && typeof calculation.result === 'number' && Number.isFinite(calculation.result) && !calculation.unavailableReason;
      report.methodology.push({ id: el.id || null, key: key, title: entry.title || key,
        what: entry.what || 'Explanation unavailable.', how: entry.how || 'Method unavailable.',
        source: entry.source || null, currentSource: context && context.sources || null,
        withYourNumbers: available ? { result: calculation.result, formattedResult: calculation.formattedResult, text: calculation.text, unavailableReason: null }
          : { result: null, formattedResult: null, text: 'unavailable — ' + reason, unavailableReason: reason } });
    });
    return report;
  }
  // Both text-PDF and print render this same ordered content, from one captured record.
  function sections(report) {
    function fieldLine(field) { return field.definition + ': ' + text(field.value) + ' [' + field.status + ']'; }
    return [
      { key: 'sources', heading: 'Sources & vintages', entries: report.sources.map(function (source) {
        return source.source + ' · ' + text(source.sourceUrl) + ' · Vintage: ' + text(source.vintage) +
          ' · Geography: ' + text(source.geography) + (source.effectiveDate ? ' · Effective: ' + source.effectiveDate : '') +
          ' · Fields: ' + source.fields.map(function (field) { return field.definition; }).filter(function (definition, index, all) { return all.indexOf(definition) === index; }).join('; ');
      }), empty: 'No source-confirmed fields are available.' },
      { key: 'assumptions', heading: 'Assumptions you should review', entries: report.assumptions.map(fieldLine).concat(report.sharedUnverified.map(function (field) {
        return fieldLine(field) + ' · ' + field.notice + ' Sender claimed source: ' + text(field.senderClaim) +
          (field.senderOriginalValue != null ? ' · Sender original value: ' + field.senderOriginalValue : '');
      })), empty: 'No assumptions, illustrative values or personal entries to review.' },
      { key: 'needsSource', heading: 'Missing sources', entries: report.needsSource.map(function (field) {
        return field.definition + ' — ' + field.reason;
      }), empty: 'No fields are waiting for a source.' },
      { key: 'methodology', heading: 'How each figure was calculated', entries: report.methodology.map(function (figure) {
        return figure.title + '\nWhat: ' + figure.what + '\nHow: ' + figure.how +
          '\nWith your numbers: ' + figure.withYourNumbers.text +
          (figure.currentSource || figure.source ? '\nInputs: ' + (figure.currentSource || figure.source) : '');
      }), empty: 'No figures with methodology are visible in this view.' },
      { key: 'limitations', heading: 'Limitations', entries: [report.limitations] }
    ];
  }
  root.DealCalculatorReportMeta = { buildReportMeta: buildReportMeta, sections: sections };
}(window));
