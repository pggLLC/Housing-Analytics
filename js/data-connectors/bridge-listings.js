/**
 * js/data-connectors/bridge-listings.js
 * Bridge Data Output — MLS listing connector for the PMA Comparables layer.
 *
 * Queries the Bridge Web API (JSON format) at:
 *   GET https://api.bridgedataoutput.com/api/v2/{dataset}/listings
 *
 * Requires two values in window.APP_CONFIG:
 *   BRIDGE_BROWSER_TOKEN — your browser-side access token
 *   BRIDGE_DATASET        — your assigned dataset slug (e.g. "ires_co")
 *
 * HOW TO ENABLE:
 *   1. Open the Data Quality Dashboard.
 *   2. Paste your Bridge Browser Token and Dataset Code.
 *   3. They are saved to localStorage and loaded into APP_CONFIG on every page.
 *
 * HOW TO FIND YOUR DATASET CODE:
 *   Log in at https://bridgedataoutput.com → API Dashboard → your dataset name
 *   appears in the URL or in the "Datasets" panel (e.g. "ires_co", "recolorado").
 *
 * Public API (window.BridgeListings):
 *   isAvailable()                               → boolean
 *   fetchActiveListingsNearPoint(lat, lon, miles, options)
 *                                               → Promise<Listing[]>
 *   fetchRecentSalesNearPoint(lat, lon, miles, options)
 *                                               → Promise<Listing[]>
 *   toGeoJsonFeature(listing)                   → GeoJSON Feature
 *   toMapMarker(listing)                        → {lat, lon, popup, icon}
 *
 * Bridge Web API reference:
 *   https://bridgedataoutput.com/docs/explorer/reso-web-api
 *   https://bridgedataoutput.com/docs/explorer/bridge-web-api
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var API_BASE  = 'https://api.bridgedataoutput.com/api/v2';
  var MAX_LIMIT = 200;

  /* ── Config helpers ───────────────────────────────────────────────── */
  function _token() {
    return (window.APP_CONFIG && window.APP_CONFIG.BRIDGE_BROWSER_TOKEN) || '';
  }

  function _dataset() {
    return (window.APP_CONFIG && window.APP_CONFIG.BRIDGE_DATASET) || '';
  }

  /**
   * Returns true when both token AND dataset code are configured.
   */
  function isAvailable() {
    return !!(  _token() && _dataset() );
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

  /* ── Core fetch ───────────────────────────────────────────────────── */
  /**
   * Fetch listings from Bridge Web API.
   *
   * @param {object} params — key/value pairs appended as query string
   * @returns {Promise<object[]>}
   */
  function _fetchListings(params) {
    var tok  = _token();
    var ds   = _dataset();
    if (!tok || !ds) {
      console.warn('[BridgeListings] Missing BRIDGE_BROWSER_TOKEN or BRIDGE_DATASET. ' +
                   'Add them via the Data Quality Dashboard.');
      return Promise.resolve([]);
    }

    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var url = API_BASE + '/' + ds + '/listings' +
              '?access_token=' + encodeURIComponent(tok) +
              '&' + qs;

    var doFetch = (typeof window.fetchWithTimeout === 'function')
      ? function () { return window.fetchWithTimeout(url); }
      : function () { return fetch(url); };

    return doFetch()
      .then(function (r) {
        if (r.status === 401) throw new Error('Unauthorized — check your Bridge Browser Token');
        if (r.status === 404) throw new Error('Dataset not found — check your BRIDGE_DATASET code');
        if (!r.ok)            throw new Error('Bridge API HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        return Array.isArray(data.bundle) ? data.bundle : [];
      })
      .catch(function (err) {
        console.warn('[BridgeListings] fetch failed:', err && err.message);
        window.dataFetchErrors = window.dataFetchErrors || [];
        window.dataFetchErrors.push({
          source: 'BridgeListings', url: url,
          error: (err && err.message) || String(err), ts: new Date().toISOString()
        });
        return [];
      });
  }

  /* ── Query builders ───────────────────────────────────────────────── */

  /**
   * Fetch ACTIVE residential listings within `miles` of a lat/lon.
   * Filters to apartments, condos, and multi-family units relevant to
   * LIHTC/affordable housing market analysis.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=1]        search radius
   * @param {object} [options]
   * @param {number} [options.limit]  max records (default 200)
   * @param {string} [options.types]  comma-separated property types
   * @returns {Promise<object[]>}
   */
  function fetchActiveListingsNearPoint(lat, lon, miles, options) {
    options = options || {};
    return _fetchListings({
      near:         lat + ',' + lon,
      nearDistance: (miles || 1).toFixed(2),
      limit:        Math.min(options.limit || MAX_LIMIT, MAX_LIMIT),
      fields:       _listingFields(),
      'StandardStatus.in': 'Active,ActiveUnderContract',
      'PropertyType.in':   options.types ||
                           'Residential,ResidentialIncome,MultifamilyResidential'
    });
  }

  /**
   * Fetch RECENTLY SOLD listings within `miles` of a lat/lon.
   * Defaults to the past 12 months.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {number} [miles=1]
   * @param {object} [options]
   * @param {number} [options.monthsBack=12]
   * @returns {Promise<object[]>}
   */
  function fetchRecentSalesNearPoint(lat, lon, miles, options) {
    options = options || {};
    var months = options.monthsBack || 12;
    var since  = new Date();
    since.setMonth(since.getMonth() - months);
    var sinceStr = since.toISOString().slice(0, 10);   // YYYY-MM-DD

    return _fetchListings({
      near:         lat + ',' + lon,
      nearDistance: (miles || 1).toFixed(2),
      limit:        Math.min(options.limit || MAX_LIMIT, MAX_LIMIT),
      fields:       _listingFields(),
      'StandardStatus': 'Closed',
      'CloseDate.gte':  sinceStr,
      'PropertyType.in': options.types ||
                         'Residential,ResidentialIncome,MultifamilyResidential'
    });
  }

  /**
   * The set of Bridge/RESO fields we request to keep payloads small.
   */
  function _listingFields() {
    return [
      'ListingId', 'ListingKey', 'StandardStatus', 'PropertyType', 'PropertySubType',
      'UnparsedAddress', 'City', 'StateOrProvince', 'PostalCode',
      'Latitude', 'Longitude',
      'ListPrice', 'ClosePrice', 'CloseDate',
      'BedroomsTotal', 'BathroomsTotalInteger',
      'LivingArea', 'LotSizeAcres',
      'YearBuilt', 'NumberOfUnitsTotal',
      'MlsStatus', 'PublicRemarks',
      'ModificationTimestamp'
    ].join(',');
  }

  /* ── Output converters ────────────────────────────────────────────── */

  /**
   * Convert a Bridge listing record to a GeoJSON Feature.
   * Geometry uses Latitude/Longitude fields from the RESO standard.
   *
   * @param {object} listing — raw Bridge API record
   * @returns {GeoJSON Feature}
   */
  function toGeoJsonFeature(listing) {
    var lat = parseFloat(listing.Latitude  || 0);
    var lon = parseFloat(listing.Longitude || 0);
    return {
      type: 'Feature',
      geometry: (lat && lon) ? { type: 'Point', coordinates: [lon, lat] } : null,
      properties: {
        id:           listing.ListingKey || listing.ListingId,
        status:       listing.StandardStatus,
        type:         listing.PropertyType,
        subtype:      listing.PropertySubType,
        address:      listing.UnparsedAddress,
        city:         listing.City,
        listPrice:    listing.ListPrice,
        closePrice:   listing.ClosePrice,
        closeDate:    listing.CloseDate,
        beds:         listing.BedroomsTotal,
        baths:        listing.BathroomsTotalInteger,
        sqft:         listing.LivingArea,
        units:        listing.NumberOfUnitsTotal,
        yearBuilt:    listing.YearBuilt,
        remarks:      listing.PublicRemarks
      }
    };
  }

  /**
   * Convert a listing to a lightweight map-marker descriptor for the PMA
   * Leaflet map layer.  Returns an object the PMA map code can consume
   * directly to place a circle marker with a popup.
   *
   * @param {object} listing
   * @returns {{ lat, lon, popup, icon }}
   */
  function toMapMarker(listing) {
    var lat  = parseFloat(listing.Latitude  || 0);
    var lon  = parseFloat(listing.Longitude || 0);
    var price = listing.ClosePrice || listing.ListPrice;
    var priceStr = price
      ? '$' + Number(price).toLocaleString()
      : 'Price N/A';
    var units = listing.NumberOfUnitsTotal > 1
      ? listing.NumberOfUnitsTotal + ' units'
      : (listing.BedroomsTotal || '?') + ' bd / ' + (listing.BathroomsTotalInteger || '?') + ' ba';

    var popup =
      '<strong>' + (listing.UnparsedAddress || 'Address N/A') + '</strong><br>' +
      (listing.PropertySubType || listing.PropertyType || '') + '<br>' +
      units + '<br>' +
      priceStr +
      (listing.CloseDate ? ' · closed ' + listing.CloseDate.slice(0, 10) : '');

    var isSale = listing.StandardStatus === 'Closed';
    return {
      lat:   lat,
      lon:   lon,
      popup: popup,
      icon:  isSale ? 'sale' : 'active'   // used by PMA map to pick marker color
    };
  }

  /* ── Expose ───────────────────────────────────────────────────────── */
  window.BridgeListings = {
    isAvailable:                  isAvailable,
    fetchActiveListingsNearPoint: fetchActiveListingsNearPoint,
    fetchRecentSalesNearPoint:    fetchRecentSalesNearPoint,
    toGeoJsonFeature:             toGeoJsonFeature,
    toMapMarker:                  toMapMarker
  };

}());
