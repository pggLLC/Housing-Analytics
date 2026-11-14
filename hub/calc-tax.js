// The Deal Calculator's property tax callout on the Financials page (calculator move, piece C, 14 Nov 2026): for the
// project's place, the local property tax exemption or PILOT on record, else the two statewide exemptions, with a
// button that sets the exemption only when the program states a percentage, and the verified local fee measures as
// context. It follows the live page's _dcEnsureAbatementBanner and _dcAppendFeeContext in js/deal-calculator.js and
// reads the same two files, data/tax-abatement-inventory.json and data/policy/fee-reductions.json. Nothing here
// changes a figure unless the reader presses the button. qa/calc-doh.test.js checks it.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var src = { started: false, tax: undefined, fees: undefined };
  function https(u) { try { return new URL(u).protocol === 'https:' ? u : ''; } catch (e) { return ''; } }
  function load() {
    if (src.started) return;
    src.started = true;
    var get = function (f) { return fetch(global.LAB_VENDOR + f).then(function (r) { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }); };
    get('data/tax-abatement-inventory.json').then(function (d) { src.tax = d; Shell.render(); }).catch(function () { src.tax = null; Shell.render(); });
    get('data/policy/fee-reductions.json').then(function (d) { src.fees = d; Shell.render(); }).catch(function () { src.fees = null; Shell.render(); });
  }
  // The live page's key for a place: "place:" or "county:" and its Census code.
  function geoKey(geoid) { return geoid ? (String(geoid).length === 5 ? 'county:' : 'place:') + geoid : null; }
  // What the live banner works out for a place: its entry, the exemption or PILOT program, and the percentage the
  // program states, if it states one. No percentage is assumed: the statewide exemptions cover only the project's
  // low-income share (C.R.S. 39-3-112(4), 29-4-227(1)(b)), which the page cannot know.
  function find(tax, geoid) {
    var key = geoKey(geoid);
    var entry = ((tax && tax.jurisdictions) || []).filter(function (j) { return Array.isArray(j.geoKeys) && j.geoKeys.indexOf(key) !== -1; })[0] || null;
    var exemption = entry && Array.isArray(entry.programs) ? entry.programs.filter(function (p) { return /property-tax-exemption|PILOT/i.test(p.category || ''); })[0] || null : null;
    var m = exemption && exemption.magnitude ? String(exemption.magnitude).match(/(\d+)\s*%/) : null;
    return { entry: entry, exemption: exemption, suggestedPct: m ? parseInt(m[1], 10) : null };
  }
  // The live button picks the closest of the exemption's own choices.
  function closest(options, pct) { return options.reduce(function (a, b) { return Math.abs(b - pct) < Math.abs(a - pct) ? b : a; }); }
  // The live page's fee context: this place's verified programs, not one-off project awards.
  function feesFor(fees, geoid) { return ((fees && fees.entries) || []).filter(function (e) { return e.geoid && e.geoid === geoid && (e.kind || 'program') === 'program'; }); }
  var MEASURE = { waived: 'waived', reduced: 'reduced', reimbursed: 'paid by another source or refunded', deferred: 'deferred (still owed)', rate_discount: 'monthly rate discount' };

  function callout(p, d) {
    var j = p && p.jurisdiction, geoid = j && j.geoid;
    if (!geoid) return '';
    load();
    if (src.tax === undefined) return '<div class="callout tax-callout" data-role="tax-callout"><p class="note">Loading the property tax programs on record…</p></div>';
    if (src.tax === null) return '<div class="callout tax-callout" data-role="tax-callout"><p class="note">The property tax programs on record did not load, so none is shown. This is not the same as none.</p></div>';
    var f = find(src.tax, geoid), sb = src.tax.metadata && src.tax.metadata.state_baseline, checked = src.tax.metadata && src.tax.metadata.generated;
    var headline = f.exemption ? '<strong>' + esc(f.entry.name) + ':</strong> ' + esc(f.exemption.name)
      : '<strong>Statewide exemptions:</strong> C.R.S. 39-3-112 (nonprofit charitable owner) and C.R.S. 29-4-227 (housing authority ownership interest)';
    var summary = f.exemption && f.exemption.summary ? f.exemption.summary
      : 'Neither is automatic: each exempts only the low-income share, 39-3-112 on application to the state property tax administrator, and 29-4-227 on the housing authority’s certification of that share. Confirm your structure qualifies before underwriting.';
    var url = f.exemption ? https(f.exemption.url) : sb && https(sb.url), when = f.exemption ? checked : sb && sb.checked;
    var options = [0, 50, 100], now = Number(d.fields['dc-tax-exempt']);
    var action = f.suggestedPct == null ? '<p><strong>Set the property tax exemption below to your project’s low-income share.</strong></p>'
      : now === closest(options, f.suggestedPct) ? '<p><strong>The property tax exemption below is set to ' + esc(String(now)) + '%.</strong></p>'
      : '<p><button type="button" class="button-link secondary" data-action="apply-abatement" data-pct="' + esc(String(closest(options, f.suggestedPct))) + '">Apply ' + esc(String(f.suggestedPct)) + '% to the property tax exemption</button></p>';
    var fees = '';
    if (src.fees) {
      var list = feesFor(src.fees, geoid);
      fees = !list.length ? '<p class="note" data-role="tax-fees">Local fee waivers: none verified yet for ' + esc(j.name || 'this place') + ' (not the same as none). Nothing is applied to your numbers.</p>'
        : '<div data-role="tax-fees"><p class="note">Verified local fee measures, for context only and not applied to any number. A waiver counts only once it is committed to this project; enter a deferral as an Impact Fee Loan source.</p><ul>' +
          list.slice(0, 4).map(function (e) {
            var u = https(e.source && e.source.url), c = e.verification && e.verification.checked;
            return '<li>' + esc(e.summary) + ' (' + esc(MEASURE[e.measure] || e.measure) + '; ' + esc(e.provider) + ')' +
              (u ? '<small class="tax-src"><a href="' + esc(u) + '">' + esc(e.source.label || 'Source') + ' ↗</a>' + (c ? ', checked ' + esc(c) : '') + '</small>' : '') + '</li>';
          }).join('') + '</ul>' +
          (list.length > 4 ? '<p class="note">' + (list.length - 4) + ' more under <a href="#/places/incentives/' + esc(geoid) + '">local housing incentives on record</a>.</p>' : '') + '</div>';
    } else if (src.fees === null) fees = '<p class="note" data-role="tax-fees">The verified fee measures did not load, so none is shown. This is not the same as none.</p>';
    return '<div class="callout tax-callout" data-role="tax-callout" data-key="' + esc(geoKey(geoid)) + '"><p>' + headline + '</p><p class="note">' + esc(summary) + '</p>' +
      '<p class="metric-source">' + (url ? '<a href="' + esc(url) + '">' + esc(f.exemption ? 'Program page' : 'Colorado Division of Property Taxation') + ' ↗</a>' : 'Source unavailable') + (when ? ', checked ' + esc(when) : '') + '</p>' +
      action + fees + '</div>';
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button[data-action="apply-abatement"]');
    if (!b || !global.LabFinancials || !global.LabProjects) return;
    var at = (location.hash || '').slice(2).split('?')[0].split('/'), p = global.LabProjects.get(at[1]);
    if (!p) return;
    var d = global.LabFinancials.draftFor(p, at[2]);
    d.fields['dc-tax-exempt'] = String(b.dataset.pct);
    global.LabProjects.setOverride(at[1], at[2], 'financialsDraft', d);
    Shell.render();
  });

  global.LabCalcTax = { callout: callout, find: find, feesFor: feesFor, closest: closest, geoKey: geoKey, _src: src };
})(typeof window !== 'undefined' ? window : globalThis);
