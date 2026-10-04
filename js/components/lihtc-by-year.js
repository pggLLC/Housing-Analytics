/* CHFA reservation-year series. Award year is not placed-in-service year. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LihtcByYear = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  function creditBucket(credit) {
    var c = String(credit || '');
    var nine = c.indexOf('9%') !== -1, four = c.indexOf('4%') !== -1;
    return nine && !four ? 'nine' : four && !nine ? 'four' : 'other';
  }
  function positive(value) {
    return value != null && value !== '' && Number(value) > 0 ? Number(value) : null;
  }
  function projects(features) {
    return (features || []).map(function (f) {
      var p = f.properties || {};
      var year = Number(p.AwardYear || p.YR_ALLOC || p.YEAR_ALLOC);
      return {
        alloc: Number.isInteger(year) && year >= 1986 && year <= new Date().getFullYear() ? year : null,
        units: positive(p.N_UNITS || p.TOTAL_UNITS),
        liUnits: positive(p.LI_UNITS),
        county: String(p.CNTY_NAME || '').replace(/ County$/i, ''),
        bucket: creditBucket(p.CREDIT || p.TypeOfCredits)
      };
    });
  }
  function series(features, options) {
    var rows = projects(features).filter(function (r) { return r.alloc != null; });
    options = options || {};
    if (options.startYear != null) rows = rows.filter(function (r) { return r.alloc >= options.startYear; });
    if (options.endYear != null) rows = rows.filter(function (r) { return r.alloc <= options.endYear; });
    if (!rows.length) return { years: [], range: null, totals: null, credits: {}, counties: {}, unavailableReason: 'No dated CHFA projects in this window' };
    var lo = Math.min.apply(null, rows.map(function (r) { return r.alloc; }));
    var hi = Math.max.apply(null, rows.map(function (r) { return r.alloc; }));
    var years = [];
    for (var y = lo; y <= hi; y++) years.push(y);
    function bucket() { return { projects: years.map(function () { return 0; }), units: years.map(function () { return null; }), liUnits: years.map(function () { return null; }) }; }
    var totals = bucket(), credits = { nine: bucket(), four: bucket(), other: bucket() }, counties = {};
    rows.forEach(function (r) {
      var i = years.indexOf(r.alloc);
      if (r.county && !counties[r.county]) counties[r.county] = bucket();
      [totals, credits[r.bucket], r.county ? counties[r.county] : null].filter(Boolean).forEach(function (b) {
        b.projects[i] += 1;
        if (r.units != null) b.units[i] = (b.units[i] || 0) + r.units;
        if (r.liUnits != null) b.liUnits[i] = (b.liUnits[i] || 0) + r.liUnits;
      });
    });
    // An empty year has zero awards; a project with an unknown unit count does not.
    [totals].concat(Object.values(credits), Object.values(counties)).forEach(function (b) {
      years.forEach(function (_, i) { if (!b.projects[i]) { b.units[i] = 0; b.liUnits[i] = 0; } });
    });
    return { years: years, range: lo + '–' + hi, totals: totals, credits: credits, counties: counties };
  }
  function heading(element, label, result) {
    if (!element) return;
    element.textContent = label + (result.range ? ' (' + result.range + ')' : ' — unavailable');
    element.dataset.yearRange = result.range || '';
  }
  return { series: series, projects: projects, creditBucket: creditBucket, heading: heading };
});
