/**
 * chfa-round-odds.js — how many of CHFA's competitive 9% applications were
 * funded, year by year, for the LIHTC guide's 4% or 9% decision tree and the
 * comparison table below it.
 *
 * Applications are the rows of each year's Round One applicant report
 * (data/jurisdiction-briefs/_lihtc-applications.json, a report counts only
 * when its rows add up to the totals it prints). Awards are that year's 9%
 * award report rows (data/policy/funding-awards/ledger.json). A year missing
 * either report is left out, never shown as 0 awarded.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChfaRoundOdds = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var APPLICATIONS = 'data/jurisdiction-briefs/_lihtc-applications.json';
  var LEDGER = 'data/policy/funding-awards/ledger.json';

  function rounds(applications, ledger, count) {
    var docs = (applications && applications.meta && applications.meta.documents) || [];
    var applied = {};
    docs.forEach(function (d) {
      var m = /^(\d{4}) Round One$/.exec(d.round_label || '');
      if (m && d.credit_type === '9%' && d.status === 'ok' && d.rows > 0) applied[m[1]] = d.rows;
    });
    var awarded = {};
    ((ledger && ledger.awards) || []).forEach(function (a) {
      if (a.federal_credit_type === '9%' && a.year) awarded[a.year] = (awarded[a.year] || 0) + 1;
    });
    return Object.keys(applied).filter(function (y) { return awarded[y]; }).sort()
      .slice(-(count || 3))
      .map(function (y) { return { year: Number(y), awarded: awarded[y], applied: applied[y] }; });
  }

  function phrase(list) {
    return list.map(function (r) { return r.awarded + ' of ' + r.applied + ' in ' + r.year; }).join(', ');
  }

  // Fills every [data-dg="awards"] with the phrase; on any failure the
  // printed text stays as it is.
  function fill(doc) {
    var spans = doc.querySelectorAll('[data-dg="awards"]');
    if (!spans.length || typeof fetch !== 'function') return Promise.resolve(null);
    function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
    return Promise.all([get(APPLICATIONS), get(LEDGER)]).then(function (d) {
      var list = rounds(d[0], d[1], 3);
      if (!list.length) return null;
      var text = phrase(list);
      spans.forEach(function (s) { s.textContent = text; });
      return text;
    }).catch(function () { return null; });
  }

  return { rounds: rounds, phrase: phrase, fill: fill, APPLICATIONS: APPLICATIONS, LEDGER: LEDGER };
}));
