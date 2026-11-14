/**
 * chfa-round-odds.js — how many of CHFA's competitive 9% (Round One) and
 * 4% + state credit (Round Two) applications were
 * funded, year by year, for the LIHTC guide's 4% or 9% decision tree and the
 * comparison table below it.
 *
 * Applications are the rows of each year's Round One applicant report
 * (data/policy/funding-awards/applicant-report-counts.json, the public copy of
 * the report counts that scripts/funding/build_lihtc_applications.py writes;
 * a report counts only when its rows add up to the totals it prints). The
 * full applications file is blocked from the public build, so reading it
 * left the guide's line frozen at its printed text. Awards are that year's 9%
 * award report rows (data/policy/funding-awards/ledger.json). A year missing
 * either report is left out, never shown as 0 awarded.
 *
 * Round Two (federal 4% credit paired with state credit, the competitive 4%
 * round) is counted the same way: rows of each year's Round Two applicant
 * report against that year's Round Two award report rows (ledger rows with
 * round 2 and a 4% federal credit). A year with an applicant report but no
 * award report yet is named as pending, never shown as 0 awarded.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ChfaRoundOdds = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var APPLICATIONS = 'data/policy/funding-awards/applicant-report-counts.json';
  var LEDGER = 'data/policy/funding-awards/ledger.json';

  var ROUND = {
    one: { label: /^(\d{4}) Round One$/, credit: '9%', award: function (a) { return a.federal_credit_type === '9%'; } },
    two: { label: /^(\d{4}) Round Two$/, credit: '4%', award: function (a) { return a.federal_credit_type === '4%' && a.round === 2; } }
  };

  function tally(applications, ledger, round) {
    var R = ROUND[round || 'one'];
    var docs = (applications && applications.meta && applications.meta.documents) || [];
    var applied = {};
    docs.forEach(function (d) {
      var m = R.label.exec(d.round_label || '');
      if (m && d.credit_type === R.credit && d.status === 'ok' && d.rows > 0) applied[m[1]] = d.rows;
    });
    var awarded = {};
    ((ledger && ledger.awards) || []).forEach(function (a) {
      if (R.award(a) && a.year) awarded[a.year] = (awarded[a.year] || 0) + 1;
    });
    return { applied: applied, awarded: awarded };
  }

  function rounds(applications, ledger, count, round) {
    var t = tally(applications, ledger, round);
    return Object.keys(t.applied).filter(function (y) { return t.awarded[y]; }).sort()
      .slice(-(count || 3))
      .map(function (y) { return { year: Number(y), awarded: t.awarded[y], applied: t.applied[y] }; });
  }

  // Years after the last one shown that have applications but no award report yet.
  function pending(applications, ledger, round) {
    var t = tally(applications, ledger, round);
    var shown = rounds(applications, ledger, 1, round);
    var last = shown.length ? shown[0].year : 0;
    return Object.keys(t.applied).filter(function (y) { return !t.awarded[y] && Number(y) > last; }).sort()
      .map(function (y) { return { year: Number(y), applied: t.applied[y] }; });
  }

  function phrase(list, waiting) {
    var text = list.map(function (r) { return r.awarded + ' of ' + r.applied + ' in ' + r.year; }).join(', ');
    (waiting || []).forEach(function (p) { text += '; ' + p.applied + ' applied in ' + p.year + ', awards pending'; });
    return text;
  }

  // Fills every [data-dg="awards"] with the phrase; on any failure the
  // printed text stays as it is.
  function fill(doc) {
    var spans = doc.querySelectorAll('[data-dg="awards"]');
    var spans2 = doc.querySelectorAll('[data-dg="awards2"]');
    if ((!spans.length && !spans2.length) || typeof fetch !== 'function') return Promise.resolve(null);
    function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
    return Promise.all([get(APPLICATIONS), get(LEDGER)]).then(function (d) {
      var list = rounds(d[0], d[1], 3);
      var text = list.length ? phrase(list) : null;
      if (text) spans.forEach(function (s) { s.textContent = text; });
      var list2 = rounds(d[0], d[1], 3, 'two');
      if (list2.length) {
        var text2 = phrase(list2, pending(d[0], d[1], 'two'));
        spans2.forEach(function (s) { s.textContent = text2; });
      }
      return text;
    }).catch(function () { return null; });
  }

  return { rounds: rounds, pending: pending, phrase: phrase, fill: fill, APPLICATIONS: APPLICATIONS, LEDGER: LEDGER };
}));
