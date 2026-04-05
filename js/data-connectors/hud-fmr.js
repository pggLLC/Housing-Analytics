/**
 * js/data-connectors/hud-fmr.js
 * HUD Fair Market Rents (FMR) and Income Limits connector.
 *
 * Loads FY2025 FMR and HUD income limits for all 64 Colorado counties from the
 * prebuilt static file at data/hud-fmr-income-limits.json.
 *
 * Exposes window.HudFmr with methods for use in HNA, market-analysis, and
 * feasibility-oriented pages.
 *
 * Usage:
 *   HudFmr.load().then(function () {
 *     var fmr = HudFmr.getFmrByFips('08031');
 *     // fmr.two_br → $1,802 (2-bedroom FMR, Denver County)
 *     var il  = HudFmr.getIncomeLimitsByFips('08031');
 *     // il.il50_4person → income limit at 50% AMI for a 4-person household
 *   });
 */
(function () {
  'use strict';

  /** @type {Array.<Object>} Loaded county records. */
  var _counties = [];

  /** @type {Object.<string, Object>} Index keyed by 5-digit FIPS string. */
  var _byFips = {};

  /** @type {Object|null} File-level metadata. */
  var _meta = null;

  /** @type {boolean} Whether data has been successfully loaded. */
  var _loaded = false;

  /** @type {Promise|null} In-flight or resolved load promise. */
  var _loadPromise = null;

  var DATA_PATH = 'data/hud-fmr-income-limits.json';

  /* ── Internal helpers ──────────────────────────────────────────── */

  /**
   * Normalise a FIPS code to a 5-digit zero-padded string.
   * @param {string|number} fips
   * @returns {string}
   */
  function normFips(fips) {
    return String(fips || '').padStart(5, '0');
  }

  /**
   * Format a dollar amount as a compact currency string (e.g. "$1,802").
   * @param {number|null|undefined} n
   * @returns {string}
   */
  function fmtDollar(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString();
  }

  /**
   * Index the loaded county array by FIPS for O(1) lookup.
   * @param {Array.<Object>} counties
   */
  function buildIndex(counties) {
    _byFips = {};
    for (var i = 0; i < counties.length; i++) {
      var c = counties[i];
      if (c && c.fips) {
        _byFips[normFips(c.fips)] = c;
      }
    }
  }

  /* ── Public API ────────────────────────────────────────────────── */

  /**
   * Load FMR + income limits data from the static JSON file.
   * Safe to call multiple times; subsequent calls return the cached promise.
   *
   * @returns {Promise<void>} Resolves when data is ready.
   */
  function load() {
    if (_loadPromise) return _loadPromise;

    var fetcher = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : function (path) {
          var url = (typeof window.resolveAssetUrl === 'function')
            ? window.resolveAssetUrl(path)
            : path;
          return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          });
        };

    _loadPromise = fetcher(DATA_PATH)
      .then(function (data) {
        if (!data || !Array.isArray(data.counties)) {
          throw new Error('[HudFmr] Unexpected data shape from ' + DATA_PATH);
        }
        _counties = data.counties;
        _meta = data.meta || null;
        buildIndex(_counties);
        _loaded = true;
        console.log('[HudFmr] Loaded ' + _counties.length + ' county FMR records');
        // Emit custom event so downstream modules (deal-calculator, etc.)
        // can react without polling.
        try { document.dispatchEvent(new CustomEvent('HudFmr:loaded')); }
        catch (_) { /* IE11 guard — polling fallback still works */ }
      })
      .catch(function (err) {
        console.warn('[HudFmr] Failed to load FMR data:', err);
        _loaded = false;
      });

    return _loadPromise;
  }

  /**
   * Returns true once data has been successfully loaded.
   * @returns {boolean}
   */
  function isLoaded() {
    return _loaded;
  }

  /**
   * Return the full county record for a given FIPS code.
   * @param {string|number} fips  5-digit county FIPS.
   * @returns {Object|null}
   */
  function getByFips(fips) {
    return _byFips[normFips(fips)] || null;
  }

  /**
   * Return the FMR object for a county.
   * Properties: efficiency, one_br, two_br, three_br, four_br (all in $USD/month).
   * @param {string|number} fips
   * @returns {{efficiency:number, one_br:number, two_br:number, three_br:number, four_br:number}|null}
   */
  function getFmrByFips(fips) {
    var rec = getByFips(fips);
    return (rec && rec.fmr) ? rec.fmr : null;
  }

  /**
   * Return the income limits object for a county.
   * Properties: ami_4person, il30_1person … il80_4person (all in $USD/year).
   * @param {string|number} fips
   * @returns {Object|null}
   */
  function getIncomeLimitsByFips(fips) {
    var rec = getByFips(fips);
    return (rec && rec.income_limits) ? rec.income_limits : null;
  }

  /**
   * Return the FMR area name for a county (e.g. "Denver-Aurora-Lakewood HUD Metro FMR Area").
   * @param {string|number} fips
   * @returns {string|null}
   */
  function getAreaNameByFips(fips) {
    var rec = getByFips(fips);
    return (rec && rec.fmr_area_name) ? rec.fmr_area_name : null;
  }

  /**
   * Compute the gross rent limit for a given %AMI and bedroom size.
   *
   * Uses HUD's standard formula: (AMI × pctAmi × 0.30) / 12.
   * When a county FIPS is provided, uses the county-specific 4-person AMI.
   * When no FIPS (or FIPS not found), returns null.
   *
   * @param {string|number} fips     5-digit county FIPS.
   * @param {number}        pctAmi   AMI percentage (e.g. 30, 50, 60, 80).
   * @returns {number|null}          Monthly gross rent limit in $USD, or null.
   */
  function getGrossRentLimit(fips, pctAmi) {
    var il = getIncomeLimitsByFips(fips);
    if (!il || !il.ami_4person) return null;
    return Math.round((il.ami_4person * (pctAmi / 100) * 0.30) / 12);
  }

  /**
   * Compute the ratio of a given market rent to the 2-bedroom FMR.
   * Used by the market-analysis subsidy scoring engine.
   *
   * @param {string|number} fips         5-digit county FIPS.
   * @param {number}        marketRent   Monthly market gross rent ($USD).
   * @returns {number|null}              Ratio (market / FMR 2BR), or null if unavailable.
   */
  function computeFmrRatio(fips, marketRent) {
    var fmr = getFmrByFips(fips);
    if (!fmr || !fmr.two_br || marketRent == null) return null;
    return marketRent / fmr.two_br;
  }

  /**
   * Return a summary object suitable for rendering in a UI card.
   * @param {string|number} fips
   * @returns {{
   *   county_name: string,
   *   fmr_area_name: string,
   *   fmr: {efficiency:number, one_br:number, two_br:number, three_br:number, four_br:number},
   *   income_limits: Object,
   *   ami_4person: number
   * }|null}
   */
  function getSummaryByFips(fips) {
    var rec = getByFips(fips);
    if (!rec) return null;
    return {
      county_name:   rec.county_name,
      fmr_area_name: rec.fmr_area_name,
      fmr_area_code: rec.fmr_area_code,
      fmr:           rec.fmr,
      income_limits: rec.income_limits,
      ami_4person:   rec.income_limits ? rec.income_limits.ami_4person : null
    };
  }

  /**
   * Return the file-level metadata object.
   * @returns {Object|null}
   */
  function getMeta() {
    return _meta;
  }

  /**
   * Return all loaded county records (for iteration / bulk display).
   * @returns {Array.<Object>}
   */
  function getAllCounties() {
    return _counties.slice();
  }

  /**
   * Build an HTML table string showing FMR values for a county.
   * Suitable for injection into a card element.
   * @param {string|number} fips
   * @returns {string} HTML string, or empty string if FIPS not found.
   */
  function renderFmrTable(fips) {
    var rec = getByFips(fips);
    if (!rec || !rec.fmr) return '';
    var f = rec.fmr;
    var rows = [
      ['Studio (0BR)',    f.efficiency],
      ['1 Bedroom',       f.one_br],
      ['2 Bedroom',       f.two_br],
      ['3 Bedroom',       f.three_br],
      ['4 Bedroom',       f.four_br]
    ];
    var html = '<table style="width:100%;border-collapse:collapse;font-size:var(--small);">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);">Bedroom Size</th>' +
        '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);">FY2025 FMR / mo</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      html += '<tr>' +
        '<td style="padding:3px 6px;">' + rows[i][0] + '</td>' +
        '<td style="text-align:right;padding:3px 6px;font-weight:600;">' + fmtDollar(rows[i][1]) + '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  /**
   * Build an HTML table string showing income limits for a county.
   * Renders 30%, 50%, 80% AMI for household sizes 1–4.
   * @param {string|number} fips
   * @returns {string} HTML string, or empty string if FIPS not found.
   */
  function renderIncomeLimitsTable(fips) {
    var il = getIncomeLimitsByFips(fips);
    if (!il) return '';
    var pcts = [30, 50, 80];
    var html = '<table style="width:100%;border-collapse:collapse;font-size:var(--small);">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);">AMI %</th>' +
        '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);">1-Person</th>' +
        '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);">2-Person</th>' +
        '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);">3-Person</th>' +
        '<th style="text-align:right;padding:3px 6px;border-bottom:1px solid var(--border);">4-Person</th>' +
      '</tr></thead><tbody>';
    for (var pi = 0; pi < pcts.length; pi++) {
      var pct = pcts[pi];
      html += '<tr>' +
        '<td style="padding:3px 6px;font-weight:600;">' + pct + '% AMI</td>' +
        '<td style="text-align:right;padding:3px 6px;">' + fmtDollar(il['il' + pct + '_1person']) + '</td>' +
        '<td style="text-align:right;padding:3px 6px;">' + fmtDollar(il['il' + pct + '_2person']) + '</td>' +
        '<td style="text-align:right;padding:3px 6px;">' + fmtDollar(il['il' + pct + '_3person']) + '</td>' +
        '<td style="text-align:right;padding:3px 6px;">' + fmtDollar(il['il' + pct + '_4person']) + '</td>' +
      '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  /* ── Expose ────────────────────────────────────────────────────── */

  window.HudFmr = {
    load:                    load,
    isLoaded:                isLoaded,
    getMeta:                 getMeta,
    getAllCounties:           getAllCounties,
    getByFips:               getByFips,
    getFmrByFips:            getFmrByFips,
    getIncomeLimitsByFips:   getIncomeLimitsByFips,
    getAreaNameByFips:       getAreaNameByFips,
    getGrossRentLimit:       getGrossRentLimit,
    computeFmrRatio:         computeFmrRatio,
    getSummaryByFips:        getSummaryByFips,
    renderFmrTable:          renderFmrTable,
    renderIncomeLimitsTable: renderIncomeLimitsTable
  };

}());