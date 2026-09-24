/**
 * Deal calculator: estimate gross building area from a bedroom mix (#1814).
 *
 * Pure functions, no DOM. The rules the UI relies on:
 *   - nothing is derived without an explicit reference standard;
 *   - a mix that has units of a bedroom type the standard does not size
 *     yields NO estimate (blank means blank, never a guess from partial data);
 *   - gross = net / efficiency, and the efficiency is an input the caller
 *     discloses, never a hidden constant.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DealCalcUnitSize = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BEDROOM_TYPES = ['studio', '1br', '2br', '3br', '4br'];
  var LABELS = { studio: 'Studio', '1br': '1BR', '2br': '2BR', '3br': '3BR', '4br': '4BR' };

  function count(v) {
    var n = parseInt(v, 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function derive(opts) {
    opts = opts || {};
    var standard = opts.standard;
    var mix = opts.mix || {};
    var efficiency = Number(opts.efficiency);
    if (!standard || !standard.sizes) return { status: 'no-standard' };
    if (!(efficiency > 0 && efficiency <= 1)) return { status: 'bad-efficiency' };
    var rows = [], missing = [], units = 0, net = 0;
    BEDROOM_TYPES.forEach(function (br) {
      var n = count(mix[br]);
      if (!n) return;
      var sf = Number(standard.sizes[br]);
      if (!(sf > 0)) { missing.push(br); return; }
      rows.push({ br: br, label: LABELS[br], units: n, sfPerUnit: sf, netSf: n * sf });
      units += n;
      net += n * sf;
    });
    if (missing.length) return { status: 'missing-size', missing: missing, missingLabels: missing.map(function (b) { return LABELS[b]; }) };
    if (!units) return { status: 'no-mix' };
    var gross = Math.round(net / efficiency);
    return {
      status: 'ok',
      standardId: standard.id || null,
      rows: rows,
      units: units,
      netSf: net,
      efficiency: efficiency,
      grossSf: gross,
      netPerUnit: Math.round(net / units),
      grossPerUnit: Math.round(gross / units)
    };
  }

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

  /** One-line working the UI shows beside the estimate, so the figure is never bare. */
  function workingText(result, standard) {
    if (!result) return '';
    switch (result.status) {
      case 'no-standard': return 'Choose a reference standard to see an estimate. Colorado has none of its own.';
      case 'bad-efficiency': return 'Enter an efficiency between 0 and 1 (net rentable area divided by gross building area).';
      case 'no-mix': return 'Enter units by AMI tier and bedroom type above; the estimate multiplies each by the reference size.';
      case 'missing-size': return 'No estimate: the selected reference gives no size for ' + result.missingLabels.join(', ') + ' units. Pick another reference or enter gross area directly.';
      case 'ok':
        return result.rows.map(function (r) { return r.units + ' × ' + r.label + ' @ ' + fmt(r.sfPerUnit) + ' SF'; }).join(' + ') +
          ' = ' + fmt(result.netSf) + ' net SF ÷ ' + result.efficiency + ' efficiency = ' + fmt(result.grossSf) + ' gross SF (' +
          fmt(result.grossPerUnit) + ' per unit)' + (standard && standard.jurisdiction ? '. Reference: ' + standard.label + ' (' + standard.jurisdiction + ', not a Colorado standard).' : '.');
      default: return '';
    }
  }

  return { BEDROOM_TYPES: BEDROOM_TYPES, LABELS: LABELS, derive: derive, workingText: workingText };
}));
