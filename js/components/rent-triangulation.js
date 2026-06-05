/**
 * js/components/rent-triangulation.js — F158
 * ===============================================================
 * Renders a per-jurisdiction rent panel showing three measurements
 * side-by-side so a council member, investor, or developer can see
 * which rent figure applies to which question:
 *
 *   • HUD FMR (2BR) — conservative voucher payment standard
 *   • ACS B25064 median gross rent — all occupied renter units, 5-yr smoothed
 *   • Zillow ZORI — asking rents on new leases (35-65th pct)
 *
 * Headline delta surfaces the gap between ACS (existing tenants) and
 * ZORI (new-lease asking) — the gap is the "lease-up premium," the
 * single most-misunderstood number in resort-adjacent CO markets.
 *
 * Usage:
 *   RentTriangulation.attach(container, {
 *     placeGeoid: '0853395',          // optional
 *     placeName:  'New Castle',       // for ZORI city-name fallback
 *     countyFips: '08045',            // required for ZORI county + HUD FMR
 *     countyName: 'Garfield County'
 *   });
 *
 * Returns silently with an explainer if no data is available for the
 * jurisdiction. Never shows "0" or a county figure under a place
 * header without a label change (avoids place-vs-county masking).
 */
(function (global) {
  'use strict';
  if (global.RentTriangulation) return;

  var ZORI_URL = 'data/market/zori_rents_co.json';
  var ACS_URL  = 'data/market/acs_median_rent_co.json';
  var FMR_URL  = 'data/hud-fmr-income-limits.json';

  // Per-page cache (avoid 3x re-fetch when mounted on multiple panels)
  var _cache = null;
  function _loadData() {
    if (_cache) return _cache;
    _cache = Promise.all([
      fetch(ZORI_URL, { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      fetch(ACS_URL,  { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      fetch(FMR_URL,  { cache: 'no-cache' }).then(function (r) { return r.json(); })
    ]).then(function (parts) {
      return { zori: parts[0], acs: parts[1], fmr: parts[2] };
    }).catch(function () {
      _cache = null;
      return null;
    });
    return _cache;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _fmtMoney(n) {
    if (n == null || !Number.isFinite(+n)) return '—';
    return '$' + Math.round(+n).toLocaleString('en-US');
  }

  function _ensureStyles() {
    if (document.getElementById('rt-styles')) return;
    var st = document.createElement('style');
    st.id = 'rt-styles';
    st.textContent = [
      '.rt-wrap {',
      '  background: var(--bg2, #f3f4f6);',
      '  border: 1px solid var(--border, rgba(0,0,0,.08));',
      '  border-radius: 6px;',
      '  padding: .65rem .8rem;',
      '  font-size: .85rem;',
      '  line-height: 1.5;',
      '  color: var(--text);',
      '}',
      '.rt-headline { font-weight: 700; margin: 0 0 .35rem; font-size: .92rem; }',
      '.rt-headline__lede { font-weight: 400; color: var(--muted); }',
      '.rt-table { width: 100%; border-collapse: collapse; margin-top: .25rem; }',
      '.rt-table th, .rt-table td {',
      '  text-align: left; padding: .35rem .4rem;',
      '  border-bottom: 1px solid color-mix(in oklab, var(--border, rgba(0,0,0,.08)) 60%, transparent 40%);',
      '  font-size: .82rem;',
      '}',
      '.rt-table th {',
      '  font-weight: 600; font-size: .7rem; color: var(--muted);',
      '  text-transform: uppercase; letter-spacing: .04em;',
      '}',
      '.rt-table td:last-child, .rt-table th:last-child { text-align: right; }',
      '.rt-source { font-weight: 700; }',
      '.rt-vintage { font-size: .68rem; opacity: .65; margin-left: .35rem; font-weight: 400; }',
      '.rt-measures { color: var(--muted); font-size: .75rem; line-height: 1.4; }',
      '.rt-value { font-weight: 700; font-size: .92rem; white-space: nowrap; }',
      '.rt-explainer {',
      '  margin-top: .55rem; padding-top: .5rem;',
      '  border-top: 1px solid color-mix(in oklab, var(--border, rgba(0,0,0,.08)) 60%, transparent 40%);',
      '  font-size: .78rem; color: var(--muted); line-height: 1.5;',
      '}',
      '.rt-explainer strong { color: var(--text); }',
      '.rt-empty { color: var(--muted); font-size: .82rem; font-style: italic; }',
      '.rt-scope-note { margin-top: .4rem; font-size: .75rem; color: var(--muted); line-height: 1.4; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _matchZoriCity(zori, placeGeoid, placeName) {
    if (!zori || !zori.cities) return null;
    // Try GEOID, then name (case-insensitive, strip type suffix)
    if (placeGeoid && zori.cities[placeGeoid]) return zori.cities[placeGeoid];
    if (!placeName) return null;
    var bare = placeName.replace(/\s*\(?(town|city|CDP)\)?\s*$/i, '').trim().toLowerCase();
    var keys = Object.keys(zori.cities);
    for (var i = 0; i < keys.length; i++) {
      var v = zori.cities[keys[i]];
      var name = (v && v.name) ? v.name.toLowerCase() : keys[i].toLowerCase();
      if (name === bare || name.indexOf(bare) === 0) return v;
    }
    return null;
  }

  function _matchAcsPlace(acs, placeGeoid) {
    return acs && acs.places && placeGeoid ? acs.places[placeGeoid] : null;
  }

  function _matchAcsCounty(acs, countyFips5) {
    return acs && acs.counties && countyFips5 ? acs.counties[countyFips5] : null;
  }

  function _matchZoriCounty(zori, countyFips5) {
    return zori && zori.counties && countyFips5 ? zori.counties[countyFips5] : null;
  }

  function _matchFmr(fmr, countyFips5) {
    if (!fmr || !Array.isArray(fmr.counties) || !countyFips5) return null;
    for (var i = 0; i < fmr.counties.length; i++) {
      if (fmr.counties[i].fips === countyFips5) return fmr.counties[i];
    }
    return null;
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();
    container.innerHTML = '<p class="rt-empty">Loading rent triangulation…</p>';

    _loadData().then(function (data) {
      if (!data) {
        container.innerHTML = '<p class="rt-empty">Rent data unavailable.</p>';
        return;
      }
      var placeGeoid = opts.placeGeoid || null;
      var placeName  = opts.placeName  || null;
      var countyFips = opts.countyFips || null;
      var countyName = opts.countyName || null;
      var countyFips5 = countyFips
        ? (String(countyFips).length === 5 ? String(countyFips) : '08' + String(countyFips).slice(-3))
        : null;

      // Pull each source — place-level when available, otherwise county
      var acsPlace = _matchAcsPlace(data.acs, placeGeoid);
      var acsCty   = _matchAcsCounty(data.acs, countyFips5);
      var zoriCity = _matchZoriCity(data.zori, placeGeoid, placeName);
      var zoriCty  = _matchZoriCounty(data.zori, countyFips5);
      var fmr      = _matchFmr(data.fmr, countyFips5);

      // Prefer place-level if available; flag the scope explicitly
      var acsRow  = acsPlace || acsCty;
      var acsScope = acsPlace ? 'place' : (acsCty ? 'county' : null);
      var zoriRow = zoriCity || zoriCty;
      var zoriScope = zoriCity ? 'place' : (zoriCty ? 'county' : null);

      var jurisLabel = placeName || countyName || 'this jurisdiction';
      var hasAny = acsRow || zoriRow || fmr;
      if (!hasAny) {
        container.innerHTML = '<p class="rt-empty">No rent data on file for ' + _esc(jurisLabel) + '.</p>';
        return;
      }

      // Compute headline delta: ZORI vs ACS gap = lease-up premium
      // Only valid when both sources are at the same geographic scope —
      // mixing place ACS with county ZORI (or vice versa) yields a
      // misleading "premium" that conflates scope drift with lease-up gap.
      var acsVal  = acsRow  && (acsRow.median_gross_rent || acsRow.rent || null);
      var zoriVal = zoriRow && (zoriRow.rent || null);
      var fmrVal  = fmr     && fmr.fmr     ? fmr.fmr.two_br : null;
      var scopesMatch = acsScope && zoriScope && acsScope === zoriScope;
      var gap = null, gapPct = null;
      if (acsVal && zoriVal && scopesMatch) {
        gap = zoriVal - acsVal;
        gapPct = Math.round((gap / acsVal) * 100);
      }

      var headlineHtml = '';
      if (gap != null && gap > 0) {
        headlineHtml = '<div class="rt-headline">Asking rents run ' +
          '<strong>' + _fmtMoney(gap) + '/mo (' + gapPct + '%)</strong> above the median lease — ' +
          '<span class="rt-headline__lede">a typical lease-up premium in ' + _esc(jurisLabel) + '</span></div>';
      } else if (acsVal || zoriVal) {
        headlineHtml = '<div class="rt-headline">Rent triangulation for <span class="rt-headline__lede">' +
          _esc(jurisLabel) + '</span></div>';
      }

      // Note when ACS and ZORI scopes differ — readers shouldn't subtract
      // them to infer a lease-up premium across mismatched geographies.
      var scopeMismatchNote = '';
      if (acsVal && zoriVal && !scopesMatch) {
        scopeMismatchNote =
          '<div class="rt-scope-note"><em>ACS at ' + _esc(acsScope) +
          ' level; ZORI at ' + _esc(zoriScope) +
          ' level; not directly comparable as a lease-up premium.</em></div>';
      }

      var rows = [];
      if (fmr) {
        rows.push({
          source:  'HUD FMR (2BR)',
          vintage: 'FY' + ((data.fmr.meta && data.fmr.meta.fiscal_year) || '2025'),
          measure: 'Gross rent w/ utilities; voucher payment standard. By county.',
          value:   _fmtMoney(fmrVal)
        });
      }
      if (acsRow) {
        var acsVintage = (data.acs.meta && data.acs.meta.vintage) || (acsRow.vintage || '2020-2024 5-yr');
        rows.push({
          source:  'ACS median gross rent',
          vintage: 'ACS ' + acsVintage + (acsScope === 'county' && placeName ? ' · county-level' : ''),
          measure: 'All occupied renter units, smoothed over 5 years. Census B25064.',
          value:   _fmtMoney(acsVal)
        });
      }
      if (zoriRow) {
        var zoriVintage = (data.zori.meta && data.zori.meta.vintage_month) || (zoriRow.vintage_month || 'current');
        rows.push({
          source:  'Zillow ZORI',
          vintage: zoriVintage + (zoriScope === 'county' && placeName ? ' · county-level' : ''),
          measure: '35-65th percentile asking rents on new leases. Smoothed, seasonally adjusted.',
          value:   _fmtMoney(zoriVal)
        });
      }

      var tableHtml =
        '<table class="rt-table">' +
          '<thead><tr><th>Source</th><th>What it measures</th><th>Value</th></tr></thead>' +
          '<tbody>' +
          rows.map(function (r) {
            return '<tr>' +
              '<td><span class="rt-source">' + _esc(r.source) + '</span>' +
              '<span class="rt-vintage">' + _esc(r.vintage) + '</span></td>' +
              '<td><span class="rt-measures">' + _esc(r.measure) + '</span></td>' +
              '<td><span class="rt-value">' + r.value + '</span></td>' +
              '</tr>';
          }).join('') +
          '</tbody>' +
        '</table>';

      var explainer =
        '<div class="rt-explainer">' +
          '<strong>How to choose:</strong> use <em>HUD FMR</em> for LIHTC + voucher underwriting, ' +
          '<em>ACS gross rent</em> for cost-burden math (the historical baseline a council member ' +
          'is comparing wages against), and <em>ZORI</em> for what a new tenant will actually pay. ' +
          'The gap between ACS and ZORI is the lease-up premium — high in resort-adjacent markets ' +
          'where long-tenured renters pay legacy rents while new leases reprice.' +
        '</div>';

      container.innerHTML = '<div class="rt-wrap">' + headlineHtml + tableHtml + scopeMismatchNote + explainer + '</div>';
    });
  }

  global.RentTriangulation = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
