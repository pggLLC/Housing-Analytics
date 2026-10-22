/**
 * js/components/resort-wfh.js — F145
 * ===================================
 * Renders resort workforce-housing program detail when the selected
 * jurisdiction is in a known resort housing authority's service area
 * (data/resort-workforce-housing-programs.json; every program quoted).
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
      '  border-radius:9px; font-size:.8125rem; font-weight:700;',
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
      '  font-size:.8125rem; font-weight:700; padding:1px 7px; border-radius:9px;',
      '  background:rgba(245,158,11,.15); color:#b45309;',
      '  border:1px solid rgba(245,158,11,.4);',
      '  text-transform:uppercase; letter-spacing:.03em;',
      '}',
      '.dark-mode .rw-program__type { background:rgba(245,158,11,.2); color:#fbbf24; }',
      '.rw-program__summary { font-size:.82rem; margin-top:.3rem; line-height:1.45; }',
      '.rw-program__mag {',
      '  font-size:.8125rem; margin-top:.25rem; padding:.2rem .5rem;',
      '  background:rgba(220,38,38,.1); color:#b91c1c;',
      '  border-left:3px solid #dc2626; border-radius:0 4px 4px 0;',
      '  display:inline-block; font-weight:600;',
      '}',
      '.dark-mode .rw-program__mag { background:rgba(248,113,113,.18); color:#fca5a5; }',
      '.rw-actions { margin-top:.6rem; padding:.5rem; background: color-mix(in oklab, var(--bg2,#f3f4f6) 50%, transparent); border-radius:6px; }',
      '.rw-actions__head { font-weight:700; font-size:.82rem; margin-bottom:.25rem; }',
      '.rw-actions ul { list-style:disc; padding-left:1.5rem; margin:0; font-size:.82rem; }',
      '.rw-actions li { margin-bottom:.2rem; line-height:1.4; }',
      '.rw-program__restriction { font-size:.8125rem; font-weight:600; margin-top:.25rem; }',
      '.rw-program__src { font-size:.8125rem; color:var(--muted); margin-top:.25rem; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // County FIPS arrive as 3 digits from some callers ("037") and 5 from
  // others ("08037"); the data uses 5. Normalize so a county match works.
  function _fips5(f) {
    if (!f) return null;
    f = String(f);
    return f.length === 3 ? '08' + f : f;
  }

  // A town page gets the authorities whose stated service area names it
  // (serves_place_geoids); nothing is inferred from the county alone, because
  // some county-based authorities serve one town (YVHA serves Steamboat
  // Springs, not Hayden). A county page gets every authority in the county.
  function _matchAuthority(authorities, opts) {
    if (!Array.isArray(authorities)) return [];
    var county = _fips5(opts.countyFips);
    return authorities.filter(function (a) {
      if (opts.placeGeoid) {
        return Array.isArray(a.serves_place_geoids) && a.serves_place_geoids.indexOf(opts.placeGeoid) !== -1;
      }
      return !!(county && a.county_fips === county);
    });
  }

  var RESTRICTION = {
    'occupancy-only': 'Occupancy only: keeps the home for local workers, does not cap its price',
    'price-capped': 'Price-capped resale',
    'either': 'Owner\'s choice: occupancy only (no price cap) or price-capped resale for a larger payment',
    'unverified': 'Restriction terms not confirmed'
  };

  function _source(p) {
    if (!p.source_url) return '';
    return '<div class="rw-program__src">Source: <a href="' + _esc(p.source_url) + '" target="_blank" rel="noopener">' +
      _esc(p.source_label || p.source_url) + '</a>' + (p.verified_on ? ', checked ' + _esc(p.verified_on) : '') + '</div>';
  }

  function _renderProgram(p) {
    var r = RESTRICTION[p.restriction_type];
    return '<li class="rw-program">' +
             '<div class="rw-program__head">' +
               '<span class="rw-program__name">' + _esc(p.name) + '</span>' +
               (p.type ? '<span class="rw-program__type">' + _esc(p.type.replace(/-/g, ' ')) + '</span>' : '') +
             '</div>' +
             (r ? '<div class="rw-program__restriction">' + _esc(r) + '</div>' : '') +
             (p.summary  ? '<div class="rw-program__summary">' + _esc(p.summary) + '</div>' : '') +
             (p.magnitude? '<div class="rw-program__mag">' + _esc(p.magnitude) + '</div>' : '') +
             _source(p) +
           '</li>';
  }

  // The source's own words, qualifier and noun included ("nearly 1,040",
  // "over 200 apartments"), never a bare number restated as exact.
  function _inventory(inv) {
    if (!inv || !Array.isArray(inv.display) || !inv.display.length) return '';
    return '<span class="rw-portfolio" title="' + _esc(inv.quote || '') + '">\u201c' +
      inv.display.map(_esc).join(' \u2026 ') + '\u201d' +
      (inv.year && /^\d{4}$/.test(String(inv.year)) ? ' (' + inv.year + ')' : '') + '</span>';
  }

  function _renderAuthority(a) {
    var programs = (a.key_programs || []).concat(a.funding || []);
    var programsHtml = programs.length
      ? '<ul class="rw-programs">' + programs.map(_renderProgram).join('') + '</ul>'
      : '';
    var open = Array.isArray(a.not_verified) && a.not_verified.length
      ? '<details class="rw-actions"><summary class="rw-actions__head">Not confirmed yet (' + a.not_verified.length + ')</summary><ul>' +
          a.not_verified.map(function (x) { return '<li>' + _esc(x.claim || x.name || '') + (x.reason ? ': ' + _esc(x.reason) : '') + '</li>'; }).join('') +
        '</ul></details>'
      : '';
    return '<div style="margin-bottom:1.2rem">' +
             '<h4 style="margin:.5rem 0 .15rem">' +
               (a.url
                 ? '<a href="' + _esc(a.url) + '" target="_blank" rel="noopener">' + _esc(a.name) + '</a>'
                 : _esc(a.name)) +
               _inventory(a.inventory) +
             '</h4>' +
             (a.service_area ? '<div style="font-size:.8125rem;color:var(--muted);margin-bottom:.3rem">' + _esc(a.service_area) + '</div>' : '') +
             programsHtml +
             open +
           '</div>';
  }

  function attach(container, opts) {
    if (!container) return Promise.resolve();
    opts = opts || {};
    _ensureStyles();
    return _load().then(function (data) {
      var matches = _matchAuthority(data.authorities, opts);
      if (!matches.length) {
        container.innerHTML = '';  // No-op for non-resort jurisdictions
        return;
      }
      var caption = '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
        'Resort towns and counties run their own workforce housing programs: buy-downs of deed restrictions, ' +
        'town-owned rentals, seasonal housing and mitigation rules. Each line below is checked against the program\'s own source. ' +
        '<a href="research-brief.html?id=workforce-housing-without-tax-credits-2026">How these compare with tax-credit housing</a>.' +
        '</p>';
      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        source:    'data/resort-workforce-housing-programs.json',
        sourceUrl: 'data/resort-workforce-housing-programs.json',
        vintage:   data.metadata && data.metadata.generated,
        method:    'Each program quoted from the housing authority, town or county\'s own pages, code or budget. Fees and limits change annually; check the source before underwriting.',
        confidence:'med'
      }) : '';
      container.innerHTML = caption + matches.map(_renderAuthority).join('') + mfHtml;
    });
  }

  function loadRoster() { return _load(); }

  global.ResortWfh = { attach: attach, loadRoster: loadRoster, _match: _matchAuthority };

})(typeof window !== 'undefined' ? window : globalThis);
