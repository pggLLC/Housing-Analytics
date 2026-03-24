/**
 * js/public-land-overlay.js
 * Public Lands & CLT Overlay — Phase 2.1
 *
 * Detects public land ownership and Community Land Trust (CLT) presence
 * for a site (lat/lon or county FIPS), using preloaded county assessor data.
 * Estimates financial benefit of public land deals for affordable housing.
 *
 * Non-goals:
 *   - Does NOT perform real-time GIS queries (data is preloaded)
 *   - Does NOT guarantee ownership — verify with county assessor
 *   - Does NOT assess zoning or entitlement status
 *
 * Usage:
 *   PublicLandOverlay.load(countyOwnershipData).then(function () {
 *     var result = PublicLandOverlay.assess('08013');
 *     // or: PublicLandOverlay.assess(null, '08013');
 *   });
 *
 * Exposed as window.PublicLandOverlay (browser) and module.exports (Node).
 *
 * @typedef {Object} LandAssessResult
 * @property {string}       ownership      — owner name or 'Private'
 * @property {string}       ownerType      — 'county'|'municipal'|'housing-authority'|'clt'|'federal'|'tribal'|'private'
 * @property {boolean}      isCLT          — true if CLT organization present in county
 * @property {string|null}  cltName        — CLT org name if present
 * @property {boolean}      isFederal      — federal land flag
 * @property {boolean}      isTribal       — tribal land flag
 * @property {string}       opportunity    — 'strong'|'moderate'|'none'
 * @property {string}       narrative      — human-readable summary
 * @property {Object}       financialBenefit — { subsidy, explanation }
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PublicLandOverlay = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Internal state ─────────────────────────────────────────────── */
  var _countyData = {};
  var _loaded     = false;

  /* ── Constants ───────────────────────────────────────────────────── */
  var SUBSIDY_BY_OWNER = {
    'county':           { base: 500000, explanation: 'County-owned parcel — eligible for housing trust fund layering and deferred land cost.' },
    'municipal':        { base: 400000, explanation: 'City/town-owned parcel — may qualify for reduced land cost and local housing programs.' },
    'housing-authority':{ base: 600000, explanation: 'Housing authority site — strongest affordability potential; deferred land + operating subsidy.' },
    'clt':              { base: 450000, explanation: 'CLT-held land — permanent affordability possible; ground lease reduces acquisition cost.' },
    'federal':          { base: 200000, explanation: 'Federal surplus land — Section 538 or surplus property program may apply.' },
    'tribal':           { base: 300000, explanation: 'Tribal land — requires tribal council partnership; unique financing structures.' },
    'private':          { base: 0,      explanation: 'Private ownership — standard market acquisition required.' }
  };

  /* ── Opportunity classification ──────────────────────────────────── */
  function _classifyOpportunity(ownerType, isCLT) {
    if (ownerType === 'housing-authority') return 'strong';
    if (ownerType === 'county' || ownerType === 'municipal') return 'strong';
    if (ownerType === 'clt' || isCLT) return 'strong';
    if (ownerType === 'federal') return 'moderate';
    if (ownerType === 'tribal') return 'moderate';
    return 'none';
  }

  /* ── Narrative generator ────────────────────────────────────────── */
  function _buildNarrative(ownerType, ownership, opportunity, cltName) {
    if (opportunity === 'strong') {
      if (ownerType === 'housing-authority') {
        return 'Housing authority–owned site — strongest subsidy layering potential; deferred land cost and operating support likely available.';
      }
      if (ownerType === 'clt' || cltName) {
        return (cltName || 'CLT') + ' — ground lease structure enables permanent affordability with reduced acquisition cost.';
      }
      return (ownership || 'Public') + ' — eligible for deep subsidy layering via local housing trust fund.';
    }
    if (opportunity === 'moderate') {
      return (ownership || 'Public entity') + ' — federal or tribal ownership may unlock surplus property programs; partnership required.';
    }
    return 'Private ownership — no public land discount available; standard acquisition required.';
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Load county ownership data.
   * @param {Object} countyOwnershipData — parsed county-ownership.json content
   * @returns {Promise<void>}
   */
  function load(countyOwnershipData) {
    if (countyOwnershipData && countyOwnershipData.counties) {
      _countyData = countyOwnershipData.counties;
    }
    _loaded = true;
    return Promise.resolve();
  }

  /**
   * Assess public land opportunity for a county.
   *
   * @param {number|null}  lat           - Latitude (reserved for future parcel-level lookup)
   * @param {number|null}  lon           - Longitude (reserved for future parcel-level lookup)
   * @param {string}       countyFips    - 5-digit county FIPS code (e.g. '08013')
   * @returns {LandAssessResult}
   */
  function assess(lat, lon, countyFips) {
    // Support legacy single-arg call: assess('08013')
    if (typeof lat === 'string' && !lon && !countyFips) {
      countyFips = lat;
      lat = null;
      lon = null;
    }

    var fips = typeof countyFips === 'string' ? countyFips.padStart(5, '0') : null;
    var countyEntry = (fips && _countyData[fips]) ? _countyData[fips] : null;

    var ownerType = 'private';
    var ownership = 'Private';
    var isCLT     = false;
    var cltName   = null;
    var isFederal = false;
    var isTribal  = false;

    if (countyEntry) {
      var parcels = countyEntry.publicParcels || [];
      var clts    = countyEntry.cltOrganizations || [];

      if (parcels.length > 0) {
        ownerType = parcels[0].ownerType || 'county';
        ownership = parcels[0].owner || countyEntry.county + ' County';
      }

      if (clts.length > 0) {
        isCLT   = true;
        cltName = clts[0].name || null;
      }
    }

    var opportunity = _classifyOpportunity(ownerType, isCLT);
    var subsidyInfo = SUBSIDY_BY_OWNER[ownerType] || SUBSIDY_BY_OWNER['private'];
    var narrative   = _buildNarrative(ownerType, ownership, opportunity, cltName);

    return {
      ownership:    ownership,
      ownerType:    ownerType,
      isCLT:        isCLT,
      cltName:      cltName,
      isFederal:    isFederal,
      isTribal:     isTribal,
      opportunity:  opportunity,
      narrative:    narrative,
      financialBenefit: {
        subsidy:     subsidyInfo.base,
        explanation: subsidyInfo.explanation
      }
    };
  }

  /**
   * Returns true if data has been loaded via load().
   * @returns {boolean}
   */
  function isLoaded() {
    return _loaded;
  }

  /**
   * List all CLT organizations across loaded counties.
   * @returns {Array<Object>} array of { county, fips, name, type, contactUrl }
   */
  function listCLTs() {
    var result = [];
    Object.keys(_countyData).forEach(function (fips) {
      var entry = _countyData[fips];
      var clts  = entry.cltOrganizations || [];
      clts.forEach(function (clt) {
        result.push({
          county:    entry.county,
          fips:      fips,
          name:      clt.name,
          type:      clt.type,
          contactUrl: clt.contactUrl || null
        });
      });
    });
    return result;
  }

  return {
    load:     load,
    assess:   assess,
    listCLTs: listCLTs,
    isLoaded: isLoaded,
    /* Exposed for testing */
    _classifyOpportunity: _classifyOpportunity
  };
}));
