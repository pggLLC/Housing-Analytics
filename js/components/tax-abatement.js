/**
 * js/components/tax-abatement.js — F141
 * ======================================
 * Renders the curated tax-abatement / PILOT / fee-waiver / linkage
 * inventory for a jurisdiction. Pulls from data/tax-abatement-inventory.json.
 *
 * Two-layer lookup:
 *   1. If the jurisdiction (by GEOID) has its own entry, render it.
 *   2. Otherwise render the statewide statutory baseline (C.R.S.
 *      §39-3-112.5 nonprofit exemption) so the developer always
 *      sees something defensible.
 *
 * Usage:
 *   TaxAbatement.attach(container, {
 *     geoKey:    'place:0830780',   // place or county geoKey
 *     jurisName: 'Glenwood Springs'
 *   });
 */
(function (global) {
  'use strict';
  if (global.TaxAbatement) return;

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
    _promise = fetch(_resolvePath('data/tax-abatement-inventory.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _data = d || { jurisdictions: [] }; return _data; })
      .catch(function (e) {
        console.warn('[TaxAbatement] fetch failed', e);
        return { jurisdictions: [] };
      });
    return _promise;
  }

  function _ensureStyles() {
    if (document.getElementById('ta-styles')) return;
    var st = document.createElement('style');
    st.id = 'ta-styles';
    st.textContent = [
      '.ta-list { list-style:none; padding-left:0; margin:.4rem 0; }',
      '.ta-item {',
      '  padding:.5rem .65rem; margin-bottom:.4rem;',
      '  border:1px solid var(--border, rgba(0,0,0,.08)); border-radius:6px;',
      '  background: color-mix(in oklab, var(--bg2, #f3f4f6) 60%, transparent);',
      '}',
      '.ta-item__head { display:flex; flex-wrap:wrap; gap:.4rem; align-items:baseline; }',
      '.ta-item__name { font-weight:700; font-size:.92rem; }',
      '.ta-item__cat {',
      '  font-size:.68rem; font-weight:700; padding:1px 7px; border-radius:9px;',
      '  background:rgba(245,158,11,.15); color:#b45309;',
      '  border:1px solid rgba(245,158,11,.4);',
      '  text-transform:uppercase; letter-spacing:.03em;',
      '}',
      '.dark-mode .ta-item__cat { background:rgba(245,158,11,.2); color:#fbbf24; }',
      '.ta-item__summary { font-size:.82rem; margin-top:.3rem; line-height:1.45; }',
      '.ta-item__mag {',
      '  font-size:.78rem; margin-top:.25rem; padding:.2rem .5rem;',
      '  background:rgba(16,185,129,.12); color:#047857;',
      '  border-left:3px solid #16a34a; border-radius:0 4px 4px 0;',
      '  display:inline-block; font-weight:600;',
      '}',
      '.dark-mode .ta-item__mag { background:rgba(16,185,129,.18); color:#34d399; }',
      '.ta-empty { color:var(--muted); font-size:.85rem; padding:.5rem 0; }',
      '.ta-baseline { font-size:.78rem; color:var(--muted); margin:.5rem 0 0; padding-left:.4rem; border-left:3px solid rgba(0,0,0,.1); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _renderProgram(p) {
    return '<li class="ta-item">' +
             '<div class="ta-item__head">' +
               (p.url
                 ? '<a href="' + _esc(p.url) + '" target="_blank" rel="noopener" class="ta-item__name">' + _esc(p.name) + '</a>'
                 : '<span class="ta-item__name">' + _esc(p.name) + '</span>') +
               (p.category ? '<span class="ta-item__cat">' + _esc(p.category.replace(/-/g, ' ')) + '</span>' : '') +
             '</div>' +
             (p.summary ? '<div class="ta-item__summary">' + _esc(p.summary) + '</div>' : '') +
             (p.magnitude ? '<div class="ta-item__mag">' + _esc(p.magnitude) + '</div>' : '') +
           '</li>';
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading tax abatement inventory…</p>';
    _load().then(function (data) {
      var entry = (data.jurisdictions || []).find(function (j) {
        return Array.isArray(j.geoKeys) && j.geoKeys.indexOf(opts.geoKey) !== -1;
      });

      var rendered = [];
      // 1. Specific jurisdiction programs
      if (entry && Array.isArray(entry.programs) && entry.programs.length) {
        rendered.push(
          '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
          'Curated for <strong>' + _esc(entry.name) + '</strong>. Verify before underwriting — programs change yearly.' +
          '</p>',
          '<ul class="ta-list">' + entry.programs.map(_renderProgram).join('') + '</ul>'
        );
      } else {
        rendered.push(
          '<p style="font-size:.82rem;color:var(--muted);margin:.2rem 0 .5rem">' +
            'No jurisdiction-specific abatement program on file for ' + _esc(opts.jurisName || 'this jurisdiction') + '. ' +
            'Statewide statutory exemption (below) is the operative tool.' +
          '</p>'
        );
      }

      // 2. State baseline (always shown as floor / fallback)
      if (data.metadata && data.metadata.state_baseline) {
        var sb = data.metadata.state_baseline;
        rendered.push(
          '<div class="ta-baseline">' +
            '<strong>Statewide baseline (default for 501(c)(3) ≤ 60% AMI):</strong> ' +
            (sb.url
              ? '<a href="' + _esc(sb.url) + '" target="_blank" rel="noopener">' + _esc(sb.note) + '</a>'
              : _esc(sb.note)) +
          '</div>'
        );
      }

      // 3. Methodology footer
      if (window.MethodFooter) {
        rendered.push(window.MethodFooter.html({
          source:    'data/tax-abatement-inventory.json (curated)',
          sourceUrl: 'https://github.com/pggLLC/Housing-Analytics/blob/main/data/tax-abatement-inventory.json',
          vintage:   data.metadata && data.metadata.generated,
          method:    'Curated from each jurisdiction\'s published affordable-housing ordinance, IGA, or property-tax abatement program page. Top 30 CO jurisdictions where affordable housing is actively developing.',
          confidence:'med'
        }));
      }

      container.innerHTML = rendered.join('');
    });
  }

  function loadRoster() { return _load(); }

  global.TaxAbatement = { attach: attach, loadRoster: loadRoster };
})(typeof window !== 'undefined' ? window : globalThis);
