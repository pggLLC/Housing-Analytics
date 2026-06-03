/**
 * js/components/mhi-ami-clarifier.js — F159
 * ===============================================================
 * Surfaces both *Median Household Income* (ACS, place-level) and
 * *HUD Area Median Income* (county-level program limit) side-by-side
 * so they're not conflated. The conceptual confusion that produced
 * COHO's New Castle bug report — chat answer said "~\$95K AMI" while
 * the HNA showed \$80K MHI — is the most common housing-data error.
 *
 * Usage:
 *   MhiAmiClarifier.attach(container, {
 *     placeGeoid: '0853395',           // optional
 *     placeName:  'New Castle',
 *     countyFips: '08045',
 *     countyName: 'Garfield County',
 *     placeMhi:   80084                 // optional: pass-through to avoid re-fetch
 *   });
 *
 * Returns silently with an explainer if no data available. Always
 * labels the source + the program it's used for.
 */
(function (global) {
  'use strict';
  if (global.MhiAmiClarifier) return;

  var ACS_SUMMARY_URL = function (geoid) { return 'data/hna/summary/' + geoid + '.json'; };
  var FMR_URL = 'data/hud-fmr-income-limits.json';

  var _fmrCache = null;
  function _loadFmr() {
    if (_fmrCache) return _fmrCache;
    _fmrCache = fetch(FMR_URL, { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .catch(function () { _fmrCache = null; return null; });
    return _fmrCache;
  }

  function _loadAcsPlace(geoid) {
    if (!geoid) return Promise.resolve(null);
    return fetch(ACS_SUMMARY_URL(geoid), { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
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
    if (document.getElementById('maa-styles')) return;
    var st = document.createElement('style');
    st.id = 'maa-styles';
    st.textContent = [
      '.maa-wrap {',
      '  background: var(--bg2, #f3f4f6);',
      '  border: 1px solid var(--border, rgba(0,0,0,.08));',
      '  border-left: 3px solid var(--accent, #096e65);',
      '  border-radius: 6px;',
      '  padding: .65rem .85rem;',
      '  font-size: .85rem;',
      '  color: var(--text);',
      '}',
      '.maa-headline { font-weight: 700; margin: 0 0 .4rem; font-size: .92rem; }',
      '.maa-grid {',
      '  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));',
      '  gap: .65rem; margin: .25rem 0 .35rem;',
      '}',
      '.maa-card {',
      '  background: var(--card, #fff);',
      '  border: 1px solid var(--border, rgba(0,0,0,.08));',
      '  border-radius: 5px; padding: .55rem .65rem;',
      '}',
      '.maa-card__label {',
      '  font-size: .68rem; font-weight: 700; letter-spacing: .04em;',
      '  text-transform: uppercase; color: var(--muted); margin-bottom: .15rem;',
      '}',
      '.maa-card__value { font-size: 1.05rem; font-weight: 700; color: var(--text); }',
      '.maa-card__source { font-size: .7rem; color: var(--muted); margin-top: .1rem; }',
      '.maa-card__desc { font-size: .75rem; color: var(--muted); margin-top: .35rem; line-height: 1.45; }',
      '.maa-footnote {',
      '  font-size: .76rem; color: var(--muted);',
      '  margin: .35rem 0 0; line-height: 1.5;',
      '  padding-top: .4rem;',
      '  border-top: 1px solid color-mix(in oklab, var(--border, rgba(0,0,0,.08)) 60%, transparent 40%);',
      '}',
      '.maa-footnote strong { color: var(--text); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  function attach(container, opts) {
    if (!container) return;
    opts = opts || {};
    _ensureStyles();

    var placeGeoid = opts.placeGeoid || null;
    var placeName  = opts.placeName  || null;
    var countyFips = opts.countyFips || null;
    var countyName = opts.countyName || null;
    var passedMhi  = (typeof opts.placeMhi === 'number') ? opts.placeMhi : null;

    var countyFips5 = countyFips
      ? (String(countyFips).length === 5 ? String(countyFips) : '08' + String(countyFips).slice(-3))
      : null;

    container.innerHTML = '<p style="font-size:.82rem;color:var(--muted);font-style:italic">Loading income reference…</p>';

    Promise.all([
      passedMhi != null ? Promise.resolve(null) : _loadAcsPlace(placeGeoid),
      _loadFmr()
    ]).then(function (parts) {
      var acs = parts[0], fmr = parts[1];

      // Pull MHI: prefer passed-in value, else ACS profile DP03_0062E
      var mhi = passedMhi;
      var mhiVintage = '';
      if (mhi == null && acs && acs.acsProfile) {
        mhi = acs.acsProfile.DP03_0062E || null;
        mhiVintage = acs.acsProfile._acsSeries === 'acs1'
          ? 'ACS 1-yr ' + (acs.acsProfile._acsYear || '')
          : 'ACS 5-yr ' + (acs.acsProfile._acsYear || acs.updated || '');
      }

      // Pull HUD AMI (4-person) from FMR file
      var amiByCounty = null, fmrFy = '';
      if (fmr && Array.isArray(fmr.counties) && countyFips5) {
        for (var i = 0; i < fmr.counties.length; i++) {
          if (fmr.counties[i].fips === countyFips5) { amiByCounty = fmr.counties[i]; break; }
        }
        fmrFy = (fmr.meta && fmr.meta.fiscal_year) ? 'FY' + fmr.meta.fiscal_year : 'FY2025';
      }
      var ami4 = amiByCounty && amiByCounty.income_limits ? amiByCounty.income_limits.ami_4person : null;

      if (mhi == null && ami4 == null) {
        container.innerHTML = '<p style="font-size:.82rem;color:var(--muted);font-style:italic">' +
          'No income reference data available for this jurisdiction.</p>';
        return;
      }

      var jurisLabel = placeName || countyName || 'this jurisdiction';
      var headlineHtml = '<div class="maa-headline">' +
        'Local incomes vs. HUD program limits' +
        '<span style="font-weight:400;color:var(--muted);margin-left:.4rem">— two different numbers</span>' +
        '</div>';

      var deltaHtml = '';
      if (mhi != null && ami4 != null && mhi !== ami4) {
        var delta = ami4 - mhi;
        var deltaPct = Math.round((delta / mhi) * 100);
        var direction = delta > 0 ? 'above' : 'below';
        deltaHtml = '<p style="margin:0 0 .35rem;font-size:.85rem;color:var(--text)">' +
          'HUD 4-person AMI is <strong>' + _fmtMoney(Math.abs(delta)) + ' (' + Math.abs(deltaPct) + '%) ' +
          direction + '</strong> the local median household income — quoting one when the other is wanted is the single most common housing-data error.' +
          '</p>';
      }

      var cards = '<div class="maa-grid">';

      cards += '<div class="maa-card">' +
        '<div class="maa-card__label">Median Household Income · <em>' + _esc(jurisLabel) + '</em></div>' +
        '<div class="maa-card__value">' + _fmtMoney(mhi) + '</div>' +
        '<div class="maa-card__source">Census ACS B19013 / DP03_0062E · ' + _esc(mhiVintage || 'place-level') + '</div>' +
        '<div class="maa-card__desc">What the typical household here actually earns. Use this for ' +
        'cost-burden math, council memos, and questions about local affordability stress.</div>' +
        '</div>';

      cards += '<div class="maa-card">' +
        '<div class="maa-card__label">HUD Area Median Income · 4-person · <em>' + _esc(countyName || amiByCounty && amiByCounty.county_name || 'county') + '</em></div>' +
        '<div class="maa-card__value">' + _fmtMoney(ami4) + '</div>' +
        '<div class="maa-card__source">HUD published income limit · ' + _esc(fmrFy) + '</div>' +
        '<div class="maa-card__desc">Federal program eligibility benchmark. Always county-level by federal definition. ' +
        'LIHTC, HOME, voucher, and CDBG eligibility tiers (30% / 50% / 60% / 80% AMI) are all percentages of <em>this</em> number, not the local median.</div>' +
        '</div>';

      cards += '</div>';

      var footnote = '<p class="maa-footnote">' +
        '<strong>Quick check:</strong> "What does our community earn?" → use MHI. ' +
        '"Who qualifies for LIHTC or a voucher?" → use HUD AMI. ' +
        'They diverge most in resort-adjacent and high-cost markets where HUD\'s county-level limit reflects the metro\'s' +
        ' upper income while the local median tracks the workforce.' +
        '</p>';

      container.innerHTML = '<div class="maa-wrap">' + headlineHtml + deltaHtml + cards + footnote + '</div>';
    }).catch(function () {
      container.innerHTML = '';
    });
  }

  global.MhiAmiClarifier = { attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
