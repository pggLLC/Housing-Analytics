/**
 * js/data-connectors/bridge-parcels.js
 * Bridge Data Output — Public Data connector for parcels & assessments.
 *
 * Uses Bridge's NO-AUTH public endpoints:
 *   GET https://api.bridgedataoutput.com/api/v2/pub/parcels
 *   GET https://api.bridgedataoutput.com/api/v2/pub/assessments
 *   GET https://api.bridgedataoutput.com/api/v2/pub/transactions
 *
 * These endpoints require your Browser Token as `access_token` query param.
 * No dataset code is needed — `pub` is a universal dataset.
 *
 * HOW TO ENABLE:
 *   1. Register at https://bridgedataoutput.com and copy your Browser Token
 *   2. Open the Data Quality Dashboard and paste the token into
 *      "Bridge Interactive Browser Token" — it will be saved to localStorage
 *      and loaded into window.APP_CONFIG.BRIDGE_BROWSER_TOKEN on every page.
 *
 * Public API (window.BridgeParcels):
 *   isAvailable()                              → boolean
 *   fetchParcelsNearPoint(lat, lon, miles)     → Promise<Feature[]>
 *   fetchAssessmentsNearPoint(lat, lon, miles) → Promise<object[]>
 *   fetchTransactionsNearPoint(lat, lon, miles)→ Promise<object[]>
 *   classifyParcel(feature)                    → {mfCompatible, vacant, isPrivate, score}
 *
 * All GeoJSON features use our normalized internal schema so they are
 * drop-in replacements for RegridParcels.fetchParcelsNearPoint().
 *
 * Bridge API reference:
 *   https://bridgedataoutput.com/docs/explorer/public-data
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var API_BASE  = 'https://api.bridgedataoutput.com/api/v2/pub';
  var MAX_LIMIT = 200;    // max records per request Bridge allows client-side

  /* ── Token helper ─────────────────────────────────────────────────── */
  function _token() {
    return (window.APP_CONFIG && window.APP_CONFIG.BRIDGE_BROWSER_TOKEN) || '';
  }

  function isAvailable() {
    return !!_token();
  }

  /* ── Geo helpers ──────────────────────────────────────────────────── */
  function _toRad(d) { return d * Math.PI / 180; }

  function _haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dL = _toRad(lat2 - lat1);
    var dO = _toRad(lon2 - lon1);
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Build a rough bounding-box string for Bridge's `near` filter.
   * Bridge supports: near=lat,lon&nearDistance=<miles>
   */
  function _nearParams(lat, lon, miles) {
    return 'near=' + encodeURIComponent(lat + ',' + lon) +
           '&nearDistance=' + encodeURIComponent((miles || 1).toFixed(2));
  }

  /* ── Parcel normalisation ─────────────────────────────────────────── */
  /**
   * Convert a Bridge /pub/parcels record into our internal GeoJSON Feature.
   * Bridge field names for public parcels come from the ATTOM / county data
   * standard. Adjust the map below if Bridge changes their schema.
   */
  function _normalizeParcel(rec) {
    var geo   = rec.geometry || null;
    var p     = rec.fields   || rec;   // Bridge returns fields under `fields` key

    // Determine lat/lon for point geometry fallback
    var lat = parseFloat(p.latitude  || p.CentroidLat || p.lat || 0);
    var lon = parseFloat(p.longitude || p.CentroidLon || p.lon || 0);

    if (!geo && lat && lon) {
      geo = { type: 'Point', coordinates: [lon, lat] };
    }

    return {
      type: 'Feature',
      geometry: geo,
      properties: {
        address:     p.UnparsedAddress || p.address || p.SitusAddress || null,
        owner:       p.OwnerName || p.owner_name || null,
        parcelId:    p.ParcelNumber || p.APN || p.apn || null,
        acres:       parseFloat(p.LotSizeAcres || p.lot_size_acres || 0) || null,
        landUseCode: p.LandUseCode || p.PropertyUseCode || p.land_use || null,
        zoning:      p.ZoningCode  || p.zoning || null,
        ownerType:   p.OwnerType   || p.owner_type || null,
        vacant:      p.IsVacant    || p.vacant || null,
        year_built:  parseInt(p.YearBuilt || p.year_built || 0, 10) || null,
        county:      p.CountyOrParish || p.county || null,
        state:       p.StateOrProvince || p.state || 'CO',
        // Bridge-specific extras kept under _bridge namespace
        _bridge: {
          id:          rec.Id || rec.id || null,
          modified:    rec.ModificationTimestamp || null,
          assessedVal: p.AssessedValue || null,
          landVal:     p.LandValue || null,
          improvVal:   p.ImprovementValue || null
        }
      }
    };
  }

  /* ── Parcel classification (same logic as regrid-parcels.js) ─────── */
  function classifyParcel(feature) {
    var p  = feature.properties || {};
    var lu = (p.landUseCode || '').toLowerCase();
    var oz = (p.zoning      || '').toLowerCase();
    var ot = (p.ownerType   || '').toLowerCase();

    var isPrivate = ot !== 'government' && ot !== 'institutional' &&
                    ot !== 'public' && ot !== 'nonprofit';

    var isVacant = p.vacant === true || p.vacant === '1' ||
                   lu.indexOf('vacant') !== -1 || lu.indexOf('undev') !== -1 ||
                   lu.indexOf('agric')  !== -1;

    var mfKeywords = [
      'rm', 'r-m', 'r2', 'r-2', 'r3', 'r-3', 'r4', 'r-4',
      'multi', 'apartment', 'mixed', 'mx', 'mu', 'urban',
      'pud', 'cmx', 'tmu', 'transit'
    ];
    var mfCompatible = mfKeywords.some(function (kw) {
      return oz.indexOf(kw) !== -1 || lu.indexOf(kw) !== -1;
    });

    return {
      mfCompatible:          mfCompatible,
      vacantOrUnderutilized: isVacant,
      isPrivate:             isPrivate,
      score:                 (mfCompatible ? 1 : 0) + (isPrivate ? 1 : 0) + (isVacant ? 1 : 0)
    };
  }

  /* ── Core fetch helper ────────────────────────────────────────────── */
  function _fetchEndpoint(endpoint, lat, lon, miles, extraParams) {
    var tok = _token();
    if (!tok) return Promise.resolve([]);

    var url = API_BASE + '/' + endpoint + '?' +
              _nearParams(lat, lon, miles || 1) +
              '&limit=' + MAX_LIMIT +
              '&access_token=' + encodeURIComponent(tok) +
              (extraParams ? '&' + extraParams : '');

    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Bridge API HTTP ' + r.status + ' (' + endpoint + ')');
        return r.json();
      })
      .then(function (data) {
        // Bridge returns { bundle: [...], total: N, ... }
        return Array.isArray(data.bundle) ? data.bundle : [];
      })
      .catch(function (err) {
        console.warn('[BridgeParcels] ' + endpoint + ' failed:', err && err.message);
        return [];
      });
  }

  /* ── Public methods ───────────────────────────────────────────────── */

  /**
   * Fetch parcels near a point.
   * Returns normalized GeoJSON Feature array — compatible with RegridParcels.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=1]
   * @returns {Promise<object[]>}
   */
  function fetchParcelsNearPoint(lat, lon, miles) {
    return _fetchEndpoint('parcels', lat, lon, miles || 1)
      .then(function (records) {
        return records.map(_normalizeParcel);
      });
  }

  /**
   * Fetch raw assessment records near a point.
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=1]
   * @returns {Promise<object[]>}  Raw Bridge records
   */
  function fetchAssessmentsNearPoint(lat, lon, miles) {
    return _fetchEndpoint('assessments', lat, lon, miles || 1);
  }

  /**
   * Fetch recent deed/sales transactions near a point.
   * Useful for comparable-sales data without MLS access.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=1]
   * @returns {Promise<object[]>}  Raw Bridge records
   */
  function fetchTransactionsNearPoint(lat, lon, miles) {
    // Limit to last 3 years of sales
    var threeYrsAgo = new Date();
    threeYrsAgo.setFullYear(threeYrsAgo.getFullYear() - 3);
    var since = threeYrsAgo.toISOString().slice(0, 10);
    return _fetchEndpoint(
      'transactions', lat, lon, miles || 1,
      'RecordingDateFrom=' + encodeURIComponent(since)
    );
  }

  /* ── Expose ───────────────────────────────────────────────────────── */
  window.BridgeParcels = {
    isAvailable:               isAvailable,
    fetchParcelsNearPoint:     fetchParcelsNearPoint,
    fetchAssessmentsNearPoint: fetchAssessmentsNearPoint,
    fetchTransactionsNearPoint: fetchTransactionsNearPoint,
    classifyParcel:            classifyParcel
  };

}());
