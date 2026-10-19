/**
 * js/components/second-homes-panel.js
 * ===================================
 * "Second homes, short-term rentals and lodging taxes" panel for one HNA
 * geography, read from data/hna/second-homes-str.json (built by
 * scripts/hna/build_second_homes_str.py).
 *
 * One panel on purpose: where second homes and short-term rentals take a
 * large share of the stock, the lodging or short-term rental tax that pays
 * for local housing and the town's seasonal or workforce housing programs
 * are the same discussion, so they are read together.
 *
 * Absence is said as absence. No license count is "not found yet", never 0;
 * no tax on record is "none on record", never "none".
 *
 * Usage:
 *   SecondHomesPanel.attach(container, { geoid: '0880040', geoType: 'place' });
 */
(function (global) {
  'use strict';
  if (global.SecondHomesPanel) return;

  var BRIEF_ID = 'workforce-housing-without-tax-credits-2026';
  var _promise = null;

  function _url(p) {
    return typeof global.resolveAssetUrl === 'function' ? global.resolveAssetUrl(p) : p;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _load() {
    if (!_promise) {
      _promise = fetch(_url('data/hna/second-homes-str.json'))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return _promise;
  }
  // Whole percents, except below 10% where a rounded 0% would read as none.
  function _pct(x) {
    return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
  }
  function _n(x) { return Number(x).toLocaleString('en-US'); }

  var STATUS = {
    adopted: 'In effect',
    ballot_failed: 'Failed at the ballot',
    on_ballot: 'On the ballot',
    proposed: 'Proposed',
  };
  function _status(s, date) {
    var label = STATUS[s] || String(s || '').replace(/_/g, ' ');
    if ((s === 'on_ballot' || s === 'proposed') && date) label += ' (' + date + ')';
    return label;
  }

  function _seasonal(rec, data) {
    var s = rec.seasonal_homes;
    if (!s) {
      return '<p class="shp-absent">' + _esc(rec.seasonal_homes_unavailable_reason || 'No ACS seasonal-home estimate for this geography.') + '</p>';
    }
    var release = (data.meta.acs_release && data.meta.acs_release.name) || 'ACS';
    if (s.reliability === 'zero_estimate') {
      return '<p data-shp="seasonal">' + _esc(release) + ' estimates <strong>0</strong> seasonal or occasional-use homes here ' +
        '(margin of error ±' + _n(s.moe) + '). In a small place that is a sample result, not proof there are none.</p>';
    }
    var share = s.share_of_housing_units;
    var head = share == null
      ? '<strong>' + _n(s.units) + '</strong> seasonal or occasional-use homes'
      : '<strong>' + _pct(share) + '</strong> of homes are seasonal or occasional-use (margin ±' + (s.share_moe * 100).toFixed(1) + ' points)';
    var detail = _n(s.units) + ' (±' + _n(s.moe) + ')' +
      (s.housing_units ? ' of ' + _n(s.housing_units) + ' housing units' : '') +
      ', ' + _esc(release) + '. These are homes nobody lives in for most of the year, which is how the Census counts second homes and many short-term rentals.';
    // The site's one reliability scale (js/acs-reliability.js): the data's
    // 'use_with_caution' (CV 15-30%) reads as fair, its 'unreliable' (CV over
    // 30%) as use with caution. CV is the standard error, the margin / 1.645,
    // so the margin itself is about 1.6 times the CV.
    var caution = '';
    if (s.reliability === 'unreliable') {
      caution = '<p class="shp-caution">Use with caution: the margin of error is about half the estimate or more, so treat this as a rough order of magnitude.</p>';
    } else if (s.reliability === 'use_with_caution') {
      caution = '<p class="shp-caution">Fair reliability: the margin of error is roughly a quarter to a half of the estimate.</p>';
    }
    if (share == null && rec.seasonal_homes_unavailable_reason) {
      caution += '<p class="shp-absent">' + _esc(rec.seasonal_homes_unavailable_reason) + '</p>';
    }
    return '<p class="shp-head" data-shp="seasonal">' + head + '</p><p class="shp-detail">' + detail + '</p>' + caution;
  }

  function _licenses(rec, data) {
    var l = rec.str_licenses;
    if (!l) {
      return '<p class="shp-absent" data-shp="str">' + _esc(data.meta.unavailable_reasons.str_licenses) + '</p>';
    }
    return '<p data-shp="str"><strong>' + _n(l.units) + '</strong> short-term rentals on the official license registry, as of ' + _esc(l.as_of) +
      ' (<a href="' + _esc(l.source_url) + '" target="_blank" rel="noopener">registry query</a>' +
      (l.scope === 'county' ? '; county count' : '') + '). ' +
      'A registry count is a different universe and date from the ACS figure, so the two are not added together.</p>' +
      (l.source_note ? '<details class="shp-detail"><summary>What this count is</summary>' + _esc(l.source_note) + '</details>' : '');
  }

  function _tax(t, scopeNote) {
    return '<li class="shp-item" data-shp-tax="' + _esc(t.id) + '">' +
      '<div class="shp-item__head"><strong>' + _esc(t.jurisdiction) + '</strong>' +
      (t.rate_text ? ' · ' + _esc(t.rate_text) : '') +
      ' <span class="shp-badge">' + _esc(_status(t.status)) + '</span>' +
      (scopeNote ? ' <span class="shp-scope">' + _esc(scopeNote) + '</span>' : '') + '</div>' +
      '<div class="shp-item__body">' + _esc(t.summary) + '</div>' +
      '<div class="shp-item__src">Source: ' +
        (t.source_url ? '<a href="' + _esc(t.source_url) + '" target="_blank" rel="noopener">' + _esc(t.source_label || t.source_url) + '</a>' : _esc(t.source_label || '')) +
        (t.checked ? ', checked ' + _esc(t.checked) : '') +
        (t.verification_level && t.verification_level !== 'primary' ? ' (press report, not the government\'s own text)' : '') +
      '</div></li>';
  }
  function _ballot(b, scopeNote) {
    return '<li class="shp-item" data-shp-ballot="' + _esc(b.id) + '">' +
      '<div class="shp-item__head"><strong>' + _esc(b.jurisdiction) + '</strong>' +
      (b.measure_number && b.measure_number !== 'Unassigned' ? ' · Measure ' + _esc(b.measure_number) : '') +
      ' <span class="shp-badge">' + _esc(_status(b.status, b.election_date)) + '</span>' +
      (scopeNote ? ' <span class="shp-scope">' + _esc(scopeNote) + '</span>' : '') + '</div>' +
      '<div class="shp-item__body">' + _esc(b.detail || b.title) + '</div>' +
      (b.source_url ? '<div class="shp-item__src">Source: <a href="' + _esc(b.source_url) + '" target="_blank" rel="noopener">official ballot text</a></div>' : '') +
      '</li>';
  }

  function _taxes(rec) {
    var items = [];
    (rec.lodging_taxes || []).forEach(function (t) { items.push(_tax(t)); });
    (rec.county_lodging_taxes || []).forEach(function (t) { items.push(_tax(t, 'county tax; its text says where it applies')); });
    (rec.places_with_lodging_taxes || []).forEach(function (t) { items.push(_tax(t, 'town in this county')); });
    (rec.ballot_measures || []).forEach(function (b) { items.push(_ballot(b)); });
    (rec.county_ballot_measures || []).forEach(function (b) { items.push(_ballot(b, 'county measure')); });
    (rec.places_with_ballot_measures || []).forEach(function (b) { items.push(_ballot(b, 'town in this county')); });
    if (!items.length) {
      return '<p class="shp-absent" data-shp="tax">No lodging or short-term rental tax for housing is on record here. ' +
        'That is not proof there is none: <a href="local-incentives.html">Local Housing Incentives</a> shows which jurisdictions this site has checked.</p>';
    }
    return '<ul class="shp-list" data-shp="tax">' + items.join('') + '</ul>';
  }

  function _programs(rec) {
    var list = rec.workforce_programs || [];
    if (!list.length) return '';
    return '<h3 class="shp-sub">Seasonal and workforce housing programs</h3><ul class="shp-list" data-shp="programs">' +
      list.map(function (a) {
        return '<li class="shp-item"><strong>' +
          (a.url ? '<a href="' + _esc(a.url) + '" target="_blank" rel="noopener">' + _esc(a.name) + '</a>' : _esc(a.name)) +
          '</strong>: ' + _esc(a.programs.join('; ')) + '</li>';
      }).join('') + '</ul>';
  }

  function _ensureStyles() {
    if (document.getElementById('shp-styles')) return;
    var st = document.createElement('style');
    st.id = 'shp-styles';
    st.textContent = [
      '.shp-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); gap:.8rem 1.2rem; margin:.4rem 0 .6rem; }',
      '.shp-sub { font-size:1rem; margin:.6rem 0 .3rem; }',
      '.shp-head { font-size:1.05rem; margin:.1rem 0 .2rem; }',
      '.shp-detail, .shp-absent, .shp-caution { font-size:.9rem; margin:.15rem 0; }',
      '.shp-absent { color: var(--muted); }',
      '.shp-caution { color: var(--warn, inherit); }',
      '.shp-list { list-style:none; padding:0; margin:.2rem 0; }',
      '.shp-item { padding:.45rem .6rem; margin-bottom:.4rem; border:1px solid var(--border); border-radius:6px; font-size:.9rem; line-height:1.45; }',
      '.shp-item__src { font-size:.8125rem; color: var(--muted); margin-top:.2rem; }',
      '.shp-badge { font-size:.8125rem; font-weight:700; padding:1px 7px; border-radius:9px; border:1px solid var(--border-strong, var(--border)); }',
      '.shp-scope { font-size:.8125rem; color: var(--muted); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function render(rec, data) {
    return '<p style="margin:.2rem 0 .5rem">Where second homes and short-term rentals take a large share of the stock, ' +
      'the people who work there compete with visitors for the same homes. This panel puts the size of that pressure next to ' +
      'what the town or county taxes to answer it and the programs it runs.</p>' +
      '<div class="shp-grid">' +
        '<div><h3 class="shp-sub">Second homes</h3>' + _seasonal(rec, data) + '</div>' +
        '<div><h3 class="shp-sub">Short-term rentals</h3>' + _licenses(rec, data) + '</div>' +
      '</div>' +
      '<h3 class="shp-sub">Lodging and short-term rental taxes for housing</h3>' + _taxes(rec) +
      _programs(rec) +
      '<p style="font-size:.9rem;margin:.5rem 0 0">How resort towns house their workers without tax credits: ' +
        '<a id="hnaSecondHomesBrief" href="research-brief.html?id=' + BRIEF_ID + '">Local workforce housing without tax credits</a>.</p>' +
      (global.MethodFooter ? global.MethodFooter.html({
        sources: [
          { label: 'ACS B25004 + B25001 (' + ((data.meta.acs_release && data.meta.acs_release.years) || '') + ')', url: 'https://censusreporter.org/tables/B25004/' },
          { label: 'data/hna/second-homes-str.json', url: 'data/hna/second-homes-str.json' }
        ],
        vintage: (data.meta.acs_release && data.meta.acs_release.name) || '',
        method: data.meta.method,
        confidence: rec.seasonal_homes && rec.seasonal_homes.reliability === 'reliable' ? 'high' : 'med'
      }) : '');
  }

  function attach(container, opts) {
    if (!container) return Promise.resolve();
    opts = opts || {};
    _ensureStyles();
    if (!opts.geoid || opts.geoType === 'state') {
      container.innerHTML = '<p class="shp-absent">Choose a county or town to see its second homes, short-term rentals and lodging taxes.</p>';
      return Promise.resolve();
    }
    return _load().then(function (data) {
      var rec = data && data.geographies && data.geographies[opts.geoid];
      if (!rec) {
        container.innerHTML = '<p class="shp-absent">The second homes data did not load for this geography.</p>';
        return;
      }
      container.innerHTML = render(rec, data);
    });
  }

  global.SecondHomesPanel = { attach: attach, render: render, BRIEF_ID: BRIEF_ID };
})(typeof window !== 'undefined' ? window : globalThis);
