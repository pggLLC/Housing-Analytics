/**
 * js/components/chfa-award-history.js — F148
 * ============================================
 * Renders a per-jurisdiction CHFA LIHTC award timeline showing every
 * reservation year + credit type + units. Pulls from properties.json
 * (deduped 5-source dataset). Useful IC-packet context: "what does
 * this market's LIHTC pipeline actually look like over time?"
 *
 * Usage:
 *   ChfaAwardHistory.attach(container, {
 *     placeGeoid: '0830780',   // optional
 *     countyFips: '045',       // optional
 *     cityName:   'Glenwood Springs'  // fallback match by city
 *   });
 */
(function (global) {
  'use strict';
  if (global.ChfaAwardHistory) return;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _ensureStyles() {
    if (document.getElementById('cah-styles')) return;
    var st = document.createElement('style');
    st.id = 'cah-styles';
    st.textContent = [
      '.cah-list { list-style:none; padding-left:0; margin:.3rem 0; }',
      '.cah-item {',
      '  padding:.3rem .55rem; margin-bottom:.25rem;',
      '  border:1px solid var(--border, rgba(0,0,0,.08)); border-radius:5px;',
      '  background: color-mix(in oklab, var(--bg2,#f3f4f6) 60%, transparent);',
      '  display:flex; flex-wrap:wrap; gap:.35rem .6rem; align-items:baseline;',
      '  font-size:.82rem;',
      '}',
      '.cah-item__year { font-weight:700; min-width:60px; }',
      '.cah-item__name { flex:1 1 200px; }',
      '.cah-item__name a { color:inherit; text-decoration:underline dotted; text-underline-offset:2px; }',
      '.cah-item__name a:hover { color:var(--accent,#096e65); text-decoration-style:solid; }',
      '.cah-item__juris { color:var(--muted); font-size:.74rem; white-space:nowrap; }',
      '.cah-item__units { font-weight:600; color:var(--muted); }',
      '.cah-item__credit {',
      '  font-size:.66rem; font-weight:700; padding:1px 6px; border-radius:9px;',
      '  background:rgba(99,102,241,.12); color:#4338ca;',
      '  border:1px solid rgba(99,102,241,.3); white-space:nowrap;',
      '}',
      '.dark-mode .cah-item__credit { background:rgba(99,102,241,.18); color:#a5b4fc; }',
      '.cah-summary { font-size:.82rem; color:var(--muted); margin:.3rem 0; }',
      '.cah-summary strong { color:var(--text); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading CHFA award history…</p>';
    if (!window.AffordableHousingLayer || !window.AffordableHousingLayer.loadProperties) {
      container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
        'Affordable-housing layer not available.</p>';
      return;
    }
    window.AffordableHousingLayer.loadProperties().then(function (props) {
      // Filter to CHFA LIHTC records for this jurisdiction
      // Strip place-type suffix in any form: "Durango city", "Durango (city)",
      // "Acres Green (CDP)" all reduce to the bare city/place name so the
      // filter matches properties.json `city` (which is unsuffixed).
      var cityNoSuffix = (opts.cityName || '').replace(/\s*\(?(town|city|CDP)\)?\s*$/i, '').trim().toLowerCase();
      var countyFips5 = opts.countyFips ? ('08' + String(opts.countyFips).slice(-3)) : null;
      var rows = props.filter(function (p) {
        if (!(p.program_type || []).some(function (t) { return t.indexOf('lihtc-') === 0; })) return false;
        // Match by city OR county_fips
        if (cityNoSuffix && (p.city || '').toLowerCase().trim() === cityNoSuffix) return true;
        if (countyFips5 && p.county_fips === countyFips5) return true;
        return false;
      }).filter(function (p) {
        return p.award_year || p.year_placed_in_service || p.latest_year;
      });
      // Sort newest first
      rows.sort(function (a, b) {
        var ay = a.award_year || a.year_placed_in_service || a.latest_year || 0;
        var by = b.award_year || b.year_placed_in_service || b.latest_year || 0;
        return by - ay;
      });
      if (!rows.length) {
        container.innerHTML = '<p style="color:var(--muted);font-size:.85rem">' +
          'No CHFA LIHTC awards on file for this jurisdiction.</p>';
        return;
      }
      // Summary stats
      var totalUnits = rows.reduce(function (s, r) { return s + (r.total_units || r.assisted_units || 0); }, 0);
      var ninePct = rows.filter(function (r) { return (r.program_type || []).indexOf('lihtc-9pct') !== -1; }).length;
      var fourPct = rows.filter(function (r) { return (r.program_type || []).indexOf('lihtc-4pct') !== -1; }).length;
      var summary = '<div class="cah-summary">' +
        '<strong>' + rows.length + '</strong> award' + (rows.length === 1 ? '' : 's') + ' · ' +
        '<strong>' + totalUnits.toLocaleString() + '</strong> LIHTC units · ' +
        ninePct + ' × 9% · ' + fourPct + ' × 4%' +
        '</div>';
      var listHtml = '<ul class="cah-list">' + rows.slice(0, 20).map(function (r) {
        var yr = r.award_year || r.year_placed_in_service || r.latest_year || '—';
        var credit = r.type_of_credits || '—';
        var units = r.total_units || r.assisted_units || 0;
        var name = r.property_name || 'Unnamed';
        var city = r.city || '';
        // Per-row source link: scoped Google search against chfainfo.com
        // for this property name (and city, when present). Durable per the
        // repo's link-hygiene convention — no deep guesses that rot.
        var srchTerms = '"' + name + '"' + (city ? ' "' + city + '"' : '') + ' Colorado';
        var srcUrl = 'https://www.google.com/search?q=' +
                     encodeURIComponent('site:chfainfo.com ' + srchTerms);
        var nameHtml = '<a href="' + srcUrl + '" target="_blank" rel="noopener" ' +
                       'title="Look up this property on chfainfo.com">' + _esc(name) + '</a>';
        return '<li class="cah-item">' +
                 '<span class="cah-item__year">' + yr + '</span>' +
                 '<span class="cah-item__name">' + nameHtml + '</span>' +
                 (city ? '<span class="cah-item__juris">' + _esc(city) + '</span>' : '') +
                 (units ? '<span class="cah-item__units">' + units + 'u</span>' : '') +
                 (credit !== '—' ? '<span class="cah-item__credit">' + _esc(credit) + '</span>' : '') +
               '</li>';
      }).join('') + '</ul>';
      var truncated = rows.length > 20
        ? '<p style="font-size:.78rem;color:var(--muted);margin:.2rem 0 0">Showing 20 of ' + rows.length + ' — see CHFA Tax Credit Property Portfolio for the full list.</p>'
        : '';
      var mfHtml = window.MethodFooter ? window.MethodFooter.html({
        source:    'data/affordable-housing/properties.json (deduped from CHFA LIHTC)',
        sourceUrl: 'https://co.chfainfo.com/find-a-tax-credit-property',
        vintage:   'live CHFA ArcGIS feed',
        method:    'Filtered to LIHTC records (lihtc-* program_type) matching jurisdiction by city or county_fips. Sorted by award_year newest first. Each property name links to a chfainfo.com-scoped search for that record.',
        confidence:'high'
      }) : '';
      container.innerHTML = summary + listHtml + truncated + mfHtml;
    });
  }

  global.ChfaAwardHistory = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
