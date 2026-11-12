// How strong a place's survey data is: one line under the place header, from the margins of error the
// public site already stores (data/hna/acs-reliability.json, built by scripts/hna/build_acs_reliability.py).
// Each figure keeps the site's own tier: CV = (MOE / 1.645) / estimate; good up to 15%, fair 15-30%,
// use with caution over 30%. The Strong / Mixed / Thin line is a lab proposal (template plan, "How strong
// the data is"). It rates how certain the figures are, never the place, and feeds no ranking or score.
(function (global) {
  'use strict';

  var Shell = global.LabShell;
  var esc = Shell.esc;
  var VENDOR = global.LAB_VENDOR || '../vendor/housing-analytics/';
  var FILE = 'data/hna/acs-reliability.json';

  // The figures the file rates, in words. Codes are ACS data profile and subject table variables.
  var NAMES = {
    DP05_0001E: 'Population', DP03_0062E: 'Median household income', DP04_0001E: 'Housing units',
    DP04_0046E: 'Owner households', DP04_0046PE: 'Share who own', DP04_0047E: 'Renter households', DP04_0047PE: 'Share who rent',
    DP04_0089E: 'Median home value', median_home_value: 'Median home value (as shown)', DP04_0134E: 'Median gross rent',
    DP04_0141PE: 'Renters paying 30–35% of income', DP04_0142PE: 'Renters paying 35% or more', rent_burden_30plus: 'Renters paying 30% or more',
    S0801_C01_046E: 'Mean travel time to work'
  };
  var TIER = { good: 'Good', fair: 'Fair', use_with_caution: 'Use with caution', zero_in_sample: 'Zero in sample' };
  var state = { loading: false, file: null, error: null };

  function load() {
    if (state.file || state.loading || state.error) return state;
    state.loading = true;
    fetch(VENDOR + FILE).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { state.file = j; Shell.render(); })
      .catch(function (e) { state.error = e.message; Shell.render(); });
    return state;
  }

  // Counts each tier among the figures the file rates for this geography.
  function tally(geoid) {
    var rec = state.file && state.file.geos[geoid];
    if (!rec) return null;
    var rows = Object.keys(rec).map(function (k) { return { key: k, name: NAMES[k] || k, t: rec[k].t || null, cv: rec[k].cv, m: rec[k].m, e: rec[k].e, y: rec[k].y, s: rec[k].s, why: rec[k].why }; });
    var n = function (t) { return rows.filter(function (r) { return r.t === t; }).length; };
    return { rows: rows, total: rows.length, good: n('good'), fair: n('fair'), caution: n('use_with_caution') + n('zero_in_sample'), none: rows.filter(function (r) { return !TIER[r.t]; }).length };
  }

  // Proposed rule: Strong when no figure needs caution and at least three in four rate good; Thin when three
  // or more need caution or most have no published margin; Mixed otherwise.
  function grade(c) {
    if (!c || !c.total) return 'thin';
    if (c.caution >= 3 || c.none > c.total / 2) return 'thin';
    if (c.caution === 0 && c.good >= 0.75 * c.total) return 'strong';
    return 'mixed';
  }
  var WORD = { strong: 'Strong', mixed: 'Mixed', thin: 'Thin' };

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // o: { geoid, name, tracts, county: { name, href } }
  function line(o) {
    var s = load();
    if (s.error) return '<p class="note">Data strength: the margins file did not load (' + esc(s.error) + ').</p>';
    if (!s.file) return '<p class="note" role="status">Reading the survey margins…</p>';
    var c = tally(o.geoid), g = grade(c);
    var parts = [];
    if (c) {
      parts.push(c.good + ' of ' + plural(c.total, 'figure', 'figures') + ' good');
      if (c.fair) parts.push(c.fair + ' fair');
      if (c.caution) parts.push(c.caution + ' use with caution');
      if (c.none) parts.push(c.none + ' with no published margin');
    }
    var whose = o.tracts === 1 ? 'Figures shared out from tracts come from a single census tract.'
      : o.tracts > 1 ? 'Figures shared out from tracts draw on ' + o.tracts + ' tracts.' : '';
    var context = g !== 'strong' && o.county && o.county.href
      ? ' <a href="' + esc(o.county.href) + '">See ' + esc(o.county.name) + '\u2019s figures' + (o.county.live ? ' on cohoanalytics.com \u2197' : '') + '</a> for the wider picture.' : '';
    var table = c ? '<details class="strength-detail"><summary>See the margins</summary>' +
      '<div class="table-scroll" role="region" aria-label="Survey margins for ' + esc(o.name) + '" tabindex="0"><table><thead><tr><th scope="col">Figure</th><th scope="col" class="num">Estimate</th><th scope="col" class="num">Margin (90%)</th><th scope="col" class="num">CV</th><th scope="col">Rating</th></tr></thead><tbody>' +
      c.rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r.name) + '</th><td class="num">' + esc(r.e == null ? '—' : Number(r.e).toLocaleString('en-US')) + '</td>' +
          '<td class="num">' + esc(r.m == null ? '—' : '±' + Number(r.m).toLocaleString('en-US')) + '</td>' +
          '<td class="num">' + esc(r.cv == null ? '—' : (r.cv * 100).toFixed(1) + '%') + '</td>' +
          '<td><span class="tier tier-' + esc(r.t || 'none') + '">' + esc(TIER[r.t] || (r.why ? 'No margin: ' + r.why : 'No margin')) + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="note">CV is the margin of error divided by 1.645, then by the estimate. Good is up to 15%, fair 15 to 30%, use with caution over 30%. ' +
      'Source: U.S. Census Bureau, ACS ' + esc(String(state.file.meta.acs_year)) + ' 5-year estimates, checked ' + esc(String(state.file.meta.generated).slice(0, 10)) + '.</p></details>' : '';
    var mark = '<sup class="fn-mark"><a href="' + esc(location.hash.split('?')[0]) + '" data-jump="fn-strength" aria-label="Note 1: what this line means">1</a></sup>';
    // The line stays short (paul 10-26: "most of this text should be in linked footnote"); the counts,
    // tract note and county link go in the footnote the marker jumps to.
    note = (c ? esc(parts.join(', ')) + '. ' : 'No survey margins are published for this place. ') + esc(whose) + context;
    return '<div class="strength strength-' + g + '" role="note"><p><span class="strength-label">Data strength: ' + WORD[g] + mark + '</span></p>' +
      table + '</div>';
  }
  var note = '';

  // The page's footnote for the line's marker: this place's counts first, then what the rating means.
  function footnote() {
    return '<p class="footnote" id="fn-strength" tabindex="-1"><sup>1</sup> Data strength: ' + (note ? note + ' ' : '') +
      'Census survey samples shrink with population, so small places carry wider margins. The rating is about how certain the figures are, not about the place. It changes no figure and no ranking.</p>';
  }

  global.LabStrength = { line: line, footnote: footnote, tally: tally, grade: grade, load: load };
})(window);
