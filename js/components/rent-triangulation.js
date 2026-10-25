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
 * The rents are shown side by side and never subtracted or averaged:
 * ACS gross rent includes tenant-paid utilities and comes from surveys
 * two or more years older than ZORI's asking rents, which exclude them,
 * so their difference is not a lease-up premium.
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
  // Published ACS margins file: records which series (1-year or 5-year)
  // each stored estimate really came from.
  var REL_URL  = 'data/hna/acs-reliability.json';

  // Per-page cache (avoid 3x re-fetch when mounted on multiple panels)
  var _cache = null;
  function _loadData() {
    if (_cache) return _cache;
    _cache = Promise.all([
      fetch(ZORI_URL, { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      fetch(ACS_URL,  { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      fetch(FMR_URL,  { cache: 'no-cache' }).then(function (r) { return r.json(); }),
      (global.ACSReliability && typeof global.ACSReliability.load === 'function'
        ? Promise.resolve(global.ACSReliability.load())
        : fetch(REL_URL).then(function (r) { return r.ok ? r.json() : null; })
      ).catch(function () { return null; })
    ]).then(function (parts) {
      return { zori: parts[0], acs: parts[1], fmr: parts[2], rel: parts[3] };
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
      /* F254 — wrap the table in horizontal scroll on narrow viewports
         so long source labels + measure descriptions don't overflow the
         card container on mobile. Also relax the nowrap on rt-value at
         narrow widths so the rent number can wrap below the label
         instead of forcing horizontal scroll. */
      '.rt-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }',
      '.rt-table { width: 100%; border-collapse: collapse; margin-top: .25rem; min-width: 320px; }',
      '.rt-table th, .rt-table td {',
      '  text-align: left; padding: .35rem .4rem;',
      '  border-bottom: 1px solid color-mix(in oklab, var(--border, rgba(0,0,0,.08)) 60%, transparent 40%);',
      '  font-size: .82rem;',
      '  word-break: break-word;',
      '}',
      '@media (max-width: 600px) {',
      '  .rt-table th, .rt-table td { padding: .3rem .25rem; font-size: .8125rem; }',
      '  .rt-measures { font-size: .8125rem; }',
      '  .rt-value { white-space: normal; font-size: .82rem; }',
      '  .rt-vintage { display: block; margin: .05rem 0 0 0; }',
      '}',
      '.rt-table th {',
      '  font-weight: 600; font-size: .8125rem; color: var(--muted);',
      '  text-transform: uppercase; letter-spacing: .04em;',
      '}',
      '.rt-table td:last-child, .rt-table th:last-child { text-align: right; }',
      '.rt-source { font-weight: 700; }',
      '.rt-vintage { font-size: .8125rem; opacity: .65; margin-left: .35rem; font-weight: 400; }',
      '.rt-measures { color: var(--muted); font-size: .8125rem; line-height: 1.4; }',
      '.rt-value { font-weight: 700; font-size: .92rem; white-space: nowrap; }',
      '.rt-explainer {',
      '  margin-top: .55rem; padding-top: .5rem;',
      '  border-top: 1px solid color-mix(in oklab, var(--border, rgba(0,0,0,.08)) 60%, transparent 40%);',
      '  font-size: .8125rem; color: var(--muted); line-height: 1.5;',
      '}',
      '.rt-explainer strong { color: var(--text); }',
      '.rt-empty { color: var(--muted); font-size: .82rem; font-style: italic; }',
      '.rt-scope-note { margin-top: .4rem; font-size: .8125rem; color: var(--muted); line-height: 1.4; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _matchZoriCity(zori, placeGeoid, placeName) {
    if (!zori || !zori.cities) return null;
    // Try GEOID, then name (case-insensitive, strip type suffix)
    if (placeGeoid && zori.cities[placeGeoid]) return zori.cities[placeGeoid];
    if (!placeName) return null;
    var bare = placeName.replace(/\s*\(?(town|city|CDP)\)?\s*$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    var keys = Object.keys(zori.cities);
    for (var i = 0; i < keys.length; i++) {
      var v = zori.cities[keys[i]];
      var name = (v && v.name) ? v.name.toLowerCase() : keys[i].toLowerCase();
      if (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === bare) return v;
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
      // A caller that knows only the place GEOID (a shared link) gets the
      // place's own name and county from the ACS place record.
      if (acsPlace && !placeName && acsPlace.name) {
        placeName = String(acsPlace.name).replace(/\s*\((town|city|CDP)\)\s*$/i, '').trim();
      }
      if (acsPlace && !countyFips5 && /^08\d{3}$/.test(acsPlace.county_fips || '')) countyFips5 = acsPlace.county_fips;
      var acsCty   = _matchAcsCounty(data.acs, countyFips5);
      var zoriCity = _matchZoriCity(data.zori, placeGeoid, placeName);
      var zoriCty  = _matchZoriCounty(data.zori, countyFips5);
      var fmr      = _matchFmr(data.fmr, countyFips5);

      // Prefer place-level if available; flag the scope explicitly
      var acsRow  = acsPlace || acsCty;
      var acsScope = acsPlace ? 'place' : (acsCty ? 'county' : null);
      var zoriRow = zoriCity || zoriCty;
      var zoriScope = zoriCity ? 'place' : (zoriCty ? 'county' : null);

      if (!placeGeoid && !countyFips5) {
        // No geography chosen is not the same as no data for one.
        container.innerHTML = '<p class="rt-empty">Choose a county to compare local rents.</p>';
        return;
      }
      // A county known only by FIPS (a shared county link) is named from
      // its own FMR or ACS record.
      if (!countyName) countyName = (fmr && fmr.county_name) || (acsCty && acsCty.name) || null;
      var jurisLabel = placeName || countyName || 'this jurisdiction';
      var hasAny = acsRow || zoriRow || fmr;
      if (!hasAny) {
        container.innerHTML = '<p class="rt-empty">No rent data on file for ' + _esc(jurisLabel) + '.</p>';
        return;
      }

      // No difference or midpoint is computed: ACS gross rent includes
      // tenant-paid utilities and is two or more years older than ZORI's
      // asking rent, which excludes them, so a difference would mix
      // utilities and rent growth with any new-lease premium.
      var acsVal  = acsRow  && (Number.isFinite(acsRow.median_gross_rent) && acsRow.median_gross_rent > 0 ? acsRow.median_gross_rent : null);
      var zoriVal = zoriRow && (zoriRow.rent || null);
      var fmrVal  = fmr     && fmr.fmr     ? fmr.fmr.two_br : null;
      var scopesMatch = acsScope && zoriScope && acsScope === zoriScope;

      var headlineHtml = '';
      if (acsVal || zoriVal) {
        headlineHtml = '<div class="rt-headline">Rent triangulation for <span class="rt-headline__lede">' +
          _esc(jurisLabel) + '</span></div>';
      }

      // Say why the rows are not subtracted, and name a geography mismatch too.
      var scopeMismatchNote = '';
      if (acsVal && zoriVal) {
        scopeMismatchNote =
          '<div class="rt-scope-note"><em>' + (scopesMatch ? '' : 'ACS at ' + _esc(acsScope) + ' level; ZORI at ' + _esc(zoriScope) + ' level. ') +
          'These rents are measured differently, so their difference is not a lease-up premium: ' +
          'ACS gross rent includes tenant-paid utilities and comes from older surveys; ZORI is current asking rent without utilities.</em></div>';
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
        // D2 — The stored rent is the 1-year estimate for large geographies
        // (Mesa $1,259; its 5-year is $1,182). Label it with the series the
        // published margins file records for this exact figure.
        var relGeoid = acsScope === 'place' ? placeGeoid : countyFips5;
        var relGeo = data.rel && data.rel.geos ? data.rel.geos[String(relGeoid)] : null;
        var relE = relGeo && relGeo.DP04_0134E;
        var relMatch = relE && relE.e != null && Math.abs(Number(relE.e) - Number(acsVal)) < 0.5 ? relE : null;
        var acsYear = (relMatch && relMatch.y) || (data.acs.meta && data.acs.meta.acs_year) || 2024;
        var isOneYear = relMatch && relMatch.s === 'acs1';
        var acsVintage = relMatch
          ? (isOneYear ? acsYear + ' 1-year' : (acsYear - 4) + '–' + acsYear + ' 5-year')
          : String(acsYear);
        rows.push({
          source:  'ACS median gross rent',
          vintage: 'ACS ' + acsVintage + (acsScope === 'county' && placeName ? ' · county-level' : ''),
          measure: isOneYear
            ? 'All occupied renter units paying cash rent, surveyed in ' + acsYear + '. Census DP04.'
            : 'All occupied renter units paying cash rent, averaged over 5 years of surveys. Census DP04.',
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
        '<div class="rt-table-wrap">' +
        '<table class="rt-table">' +
          '<thead><tr>' +
            '<th data-tip="Who publishes the rent figure, and the year or period it covers.">Source</th>' +
            '<th data-tip="Which rents each source counts: existing leases, new leases, or a federal payment standard.">What it measures</th>' +
            '<th data-tip="Monthly rent in dollars for this area.">Value</th>' +
          '</tr></thead>' +
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
        '</table>' +
        '</div>';

      var explainer =
        '<div class="rt-explainer">' +
          '<strong>How to choose:</strong> use <em>CHFA’s published income-based limits</em> for LIHTC gross rent ceilings, ' +
          '<em>HUD FMR</em> as a voucher reference, ' +
          '<em>ACS gross rent</em> for cost-burden math (the historical baseline a council member ' +
          'is comparing wages against), and <em>ZORI</em> for what a new tenant is asked to pay before utilities. ' +
          'Do not subtract ACS from ZORI: the difference mixes utilities and two-plus years of rent growth with any new-lease premium.' +
        '</div>';

      container.innerHTML = '<div class="rt-wrap">' + headlineHtml + tableHtml + scopeMismatchNote + explainer + '</div>';
    });
  }

  global.RentTriangulation = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
