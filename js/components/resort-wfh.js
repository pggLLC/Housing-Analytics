/**
 * js/components/resort-wfh.js — F145
 * ===================================
 * Renders resort workforce-housing program detail when the selected
 * jurisdiction is in a known resort housing authority's service area
 * (APCHA, Vail InDEED, Eagle County, SCHA, Telluride, YVHA).
 *
 * For non-resort jurisdictions the component renders nothing — no
 * "no data" placeholder. The HNA + IC packet already explain general
 * tax abatement + capital partners; this is specifically the
 * negotiated resort-market mitigation + buy-down + linkage detail.
 *
 * Usage:
 *   ResortWfh.attach(container, {
 *     placeGeoid: '0803620',   // or
 *     countyFips: '097',
 *     jurisName:  'Aspen'
 *   });
 */
(function (global) {
  'use strict';
  if (global.ResortWfh) return;

  var _data    = null;
  var _promise = null;

  function _resolvePath(p) {
    if (typeof global.resolveAssetUrl === 'function') return global.resolveAssetUrl(p);
    return p;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _load() {
    if (_data) return Promise.resolve(_data);
    if (_promise) return _promise;
    _promise = fetch(_resolvePath('data/resort-workforce-housing-programs.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _data = d || { authorities: [] }; return _data; })
      .catch(function (e) {
        console.warn('[ResortWfh] fetch failed', e);
        return { authorities: [] };
      });
    return _promise;
  }

  function _ensureStyles() {
    if (document.getElementById('rw-styles')) return;
    var st = document.createElement('style');
    st.id = 'rw-styles';
    st.textContent = [
      '.rw-headline {',
      '  padding:.7rem .9rem; margin:.4rem 0 .7rem;',
      '  background: color-mix(in oklab, var(--bg2,#f3f4f6) 80%, rgba(99,102,241,.15));',
      '  border:1px solid rgba(99,102,241,.25); border-left:5px solid #4338ca;',
      '  border-radius:6px; font-size:.92rem; line-height:1.45;',
      '}',
      '.dark-mode .rw-headline { background: color-mix(in oklab, var(--bg2,#1e293b) 70%, rgba(165,180,252,.12)); border-color:rgba(165,180,252,.3); border-left-color:#a5b4fc; }',
      '.rw-portfolio {',
      '  display:inline-block; padding:.18rem .55rem; margin-left:.5rem;',
      '  background:rgba(16,185,129,.18); color:#047857; border:1px solid rgba(16,185,129,.4);',
      '  border-radius:9px; font-size:.78rem; font-weight:700;',
      '}',
      '.dark-mode .rw-portfolio { background:rgba(16,185,129,.2); color:#34d399; }',
      '.rw-programs { list-style:none; padding-left:0; margin:.4rem 0; }',
      '.rw-program {',
      '  padding:.5rem .65rem; margin-bottom:.4rem;',
      '  border:1px solid var(--border,rgba(0,0,0,.08)); border-radius:6px;',
      '  background: color-mix(in oklab, var(--bg2,#f3f4f6) 60%, transparent);',
      '}',
      '.rw-program__head { display:flex; flex-wrap:wrap; gap:.4rem; align-items:baseline; }',
      '.rw-program__name { font-weight:700; font-size:.92rem; }',
      '.rw-program__type {',
      '  font-size:.66rem; font-weight:700; padding:1px 7px; border-radius:9px;',
      '  background:rgba(245,158,11,.15); color:#b45309;',
      '  border:1px solid rgba(245,158,11,.4);',
      '  text-transform:uppercase; letter-spacing:.03em;',
      '}',
      '.dark-mode .rw-program__type { background:rgba(245,158,11,.2); color:#fbbf24; }',
      '.rw-program__summary { font-size:.82rem; margin-top:.3rem; line-height:1.45; }',
      '.rw-program__mag {',
      '  font-size:.78rem; margin-top:.25rem; padding:.2rem .5rem;',
      '  background:rgba(220,38,38,.1); color:#b91c1c;',
      '  border-left:3px solid #dc2626; border-radius:0 4px 4px 0;',
      '  display:inline-block; font-weight:600;',
      '}',
      '.dark-mode .rw-program__mag { background:rgba(248,113,113,.18); color:#fca5a5; }',
      '.rw-actions { margin-top:.6rem; padding:.5rem; background: color-mix(in oklab, var(--bg2,#f3f4f6) 50%, transparent); border-radius:6px; }',
      '.rw-actions__head { font-weight:700; font-size:.82rem; margin-bottom:.25rem; }',
      '.rw-actions ul { list-style:disc; padding-left:1.5rem; margin:0; font-size:.82rem; }',
      '.rw-actions li { margin-bottom:.2rem; line-height:1.4; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // Match a jurisdiction to its housing authority by place GEOID
  // (specific) OR county FIPS (regional).
  function _matchAuthority(authorities, opts) {
    if (!Array.isArray(authorities)) return null;
    var matches = [];
    authorities.forEach(function (a) {
      var hit = false;
      if (opts.placeGeoid && Array.isArray(a.place_geoids) && a.place_geoids.indexOf(opts.placeGeoid) !== -1) hit = true;
      if (!hit && opts.countyFips && a.county_fips && a.county_fips === opts.countyFips) hit = true;
      if (hit) matches.push(a);
    });
    return matches;
  }

  function _renderProgram(p) {
    return '<li class="rw-program">' +
             '<div class="rw-program__head">' +
               '<span class="rw-program__name">' + _esc(p.name) + '</span>' +
               (p.type ? '<span class="rw-program__type">' + _esc(p.type.replace(/-/g, ' ')) + '</span>' : '') +
             '</div>' +
             (p.summary  ? '<div class="rw-program__summary">' + _esc(p.summary) + '</div>' : '') +
             (p.magnitude? '<div class="rw-program__mag">' + _esc(p.magnitude) + '</div>' : '') +
           '</li>';
  }

  function _renderAuthority(a) {
    var portfolio = a.portfolio_size_units
      ? '<span class="rw-portfolio">' + a.portfolio_size_units.toLocaleString() + '+ units' +
        (a.portfolio_size_units_year ? ' (as of ' + a.portfolio_size_units_year + ')' : '') + '</span>'
      : '';
    var programsHtml = (Array.isArray(a.key_programs) && a.key_programs.length)
      ? '<ul class="rw-programs">' + a.key_programs.map(_renderProgram).join('') + '</ul>'
      : '';
    var actionsHtml = (Array.isArray(a.developer_actions) && a.developer_actions.length)
      ? '<div class="rw-actions">' +
          '<div class="rw-actions__head">Developer actions to know</div>' +
          '<ul>' + a.developer_actions.map(function (x) { return '<li>' + _esc(x) + '</li>'; }).join('') + '</ul>' +
        '</div>'
      : '';
    return '<div style="margin-bottom:1.2rem">' +
             '<h4 style="margin:.5rem 0 .15rem">' +
               (a.url
                 ? '<a href="' + _esc(a.url) + '" target="_blank" rel="noopener">' + _esc(a.name) + '</a>'
                 : _esc(a.name)) +
               portfolio +
             '</h4>' +
             (a.service_area ? '<div style="font-size:.78rem;color:var(--muted);margin-bottom:.3rem">' + _esc(a.service_area) + '</div>' : '') +
             (a.headline ? '<div class="rw-headline">' + _esc(a.headline) + '</div>' : '') +
             programsHtml +
             actionsHtml +
           '</div>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    _load().then(function (data) {
      var matches = _matchAuthority(data.authorities, opts);
      if (!matches || !matches.length) {
        container.innerHTML = '';  // No-op for non-resort jurisdictions
        return;
      }
      var caption = '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
        'Resort markets have their own housing-authority mitigation, buy-down, and linkage programs — ' +
        'often the most-negotiated piece of any new deal. Engaged early, these can turn from cost into capital.' +
        '</p>';
      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        source:    'data/resort-workforce-housing-programs.json (curated from each housing authority\'s site)',
        sourceUrl: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/resort-workforce-housing-programs.json',
        vintage:   data.metadata && data.metadata.generated,
        method:    'Curated cash-in-lieu rates, mitigation requirements, portfolio sizes from APCHA, Vail InDEED, Eagle County, SCHA, Telluride, YVHA. Rates change annually — verify on each authority\'s site.',
        confidence:'med'
      }) : '';
      container.innerHTML = caption + matches.map(_renderAuthority).join('') + mfHtml;
    });
  }

  function loadRoster() { return _load(); }

  global.ResortWfh = { attach: attach, loadRoster: loadRoster };
})(typeof window !== 'undefined' ? window : globalThis);
