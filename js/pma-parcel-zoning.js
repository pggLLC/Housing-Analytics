/**
 * js/pma-parcel-zoning.js
 * Parcel and zoning overlay for identifying multifamily development sites.
 *
 * Loads pre-built data from:
 *   data/market/parcel_aggregates_co.json   — county-level parcel aggregates
 *   data/market/zoning_compat_index_co.json — multifamily zoning compatibility
 *
 * Color classification:
 *   ● Green  (compat ≥ 2.0, private, vacant/underutilized) — high MF opportunity
 *   ● Yellow (compat ≥ 1.0, low-density developed or infill) — moderate opportunity
 *   ● Gray   (compat < 1.0 or insufficient data) — limited/no MF opportunity
 *
 * Circle-marker radius is scaled by the number of developable parcels so that
 * large counties with many opportunities are visually prominent.
 *
 * Public API (window.PMAParcelZoning):
 *   loadParcelData()                           → Promise<{parcels, zoning}>
 *   renderParcelZoningLayer(map, lat, lon, mi) → void
 *   removeParcelLayer(map)                     → void
 *   getLoadedData()                            → {parcels, zoning} or null
 *
 * Degrades gracefully when the data files are stubs (empty arrays).
 */
(function () {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────── */
  var PARCEL_FILE    = 'market/parcel_aggregates_co.json';
  var ZONING_FILE    = 'market/zoning_compat_index_co.json';
  var EARTH_RADIUS   = 3958.8;   // miles

  var COMPAT_HIGH    = 2.0;   // >= GREEN  (MF-compatible, private, vacant)
  var COMPAT_MEDIUM  = 1.0;   // >= YELLOW (infill / low-density)

  var COLOR_HIGH     = '#16a34a';   // green-600
  var COLOR_MEDIUM   = '#ca8a04';   // yellow-600
  var COLOR_LOW      = '#6b7280';   // gray-500

  var RADIUS_BASE    = 6;      // minimum circle-marker radius (px)
  var RADIUS_SCALE   = 0.04;   // extra px per parcel count unit (clamped to 20px max)

  /* ── Module state ─────────────────────────────────────────────────── */
  var _parcels       = null;   // array from parcel_aggregates_co.json
  var _zoning        = null;   // array from zoning_compat_index_co.json
  var _loaded        = false;
  var _loadPromise   = null;   // deduplicate concurrent loads
  var _parcelMarkers = [];     // active Leaflet circle markers on the map

  /* ── Utility ──────────────────────────────────────────────────────── */

  function _toRad(deg) { return deg * Math.PI / 180; }

  function _haversine(lat1, lon1, lat2, lon2) {
    var dL = _toRad(lat2 - lat1);
    var dO = _toRad(lon2 - lon1);
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ── Load ─────────────────────────────────────────────────────────── */

  /**
   * Load parcel and zoning data (deduplicated — second call returns cached).
   * @returns {Promise<{parcels: object[], zoning: object[]}>}
   */
  function loadParcelData() {
    if (_loaded) {
      return Promise.resolve({ parcels: _parcels, zoning: _zoning });
    }
    if (_loadPromise) return _loadPromise;

    var DS = window.DataService;
    function fetchFile(path) {
      if (DS && typeof DS.getJSON === 'function' && typeof DS.baseData === 'function') {
        return DS.getJSON(DS.baseData(path)).catch(function () { return null; });
      }
      return fetch(path).then(function (r) {
        return r.ok ? r.json() : null;
      }).catch(function () { return null; });
    }

    _loadPromise = Promise.all([
      fetchFile(PARCEL_FILE),
      fetchFile(ZONING_FILE)
    ]).then(function (results) {
      var parcelData = results[0];
      var zoningData = results[1];

      _parcels = (parcelData && Array.isArray(parcelData.counties))
        ? parcelData.counties
        : [];
      _zoning  = (zoningData && Array.isArray(zoningData.jurisdictions))
        ? zoningData.jurisdictions
        : [];

      _loaded = true;
      _loadPromise = null;

      console.log('[PMAParcelZoning] loaded: ' + _parcels.length + ' counties, ' +
        _zoning.length + ' zoning jurisdictions');

      if (_parcels.length === 0 && _zoning.length === 0) {
        console.warn('[PMAParcelZoning] Both files are empty stubs. ' +
          'Run the "Fetch Parcel & Zoning Data" GitHub Actions workflow to populate them.');
      }

      return { parcels: _parcels, zoning: _zoning };
    });

    return _loadPromise;
  }

  /* ── Classify ─────────────────────────────────────────────────────── */

  /**
   * Classify a parcel county record + zoning entry into a color tier.
   * @param {object} parcel  — from parcel_aggregates_co.json counties[]
   * @param {object} zone    — from zoning_compat_index_co.json jurisdictions[]
   * @returns {{ color: string, tier: string, label: string }}
   */
  function _classify(parcel, zone) {
    var compat   = zone ? (parseFloat(zone.compat_score) || 0) : 0;
    var useClass = (parcel && (parcel.dominant_use || parcel.use_class || '')).toLowerCase();
    var ownership= (parcel && (parcel.ownership_type || '')).toLowerCase();

    var isPrivate  = !ownership || ownership === 'private' || ownership === 'fee-simple';
    var isVacant   = useClass.indexOf('vacant') !== -1 || useClass.indexOf('underutil') !== -1;
    var isLowDense = useClass.indexOf('low-density') !== -1 || useClass.indexOf('infill') !== -1 ||
                     useClass.indexOf('single') !== -1;

    if (compat >= COMPAT_HIGH && isPrivate && (isVacant || useClass === '')) {
      return { color: COLOR_HIGH,   tier: 'high',   label: 'High MF opportunity' };
    }
    if (compat >= COMPAT_HIGH && isPrivate) {
      return { color: COLOR_HIGH,   tier: 'high',   label: 'High MF opportunity' };
    }
    if (compat >= COMPAT_MEDIUM && (isVacant || isLowDense)) {
      return { color: COLOR_MEDIUM, tier: 'medium', label: 'Moderate MF opportunity' };
    }
    if (compat >= COMPAT_MEDIUM) {
      return { color: COLOR_MEDIUM, tier: 'medium', label: 'Moderate MF opportunity (infill)' };
    }
    return { color: COLOR_LOW,    tier: 'low',    label: 'Limited MF zoning' };
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  /**
   * Render parcel/zoning markers within `bufferMiles` of (lat, lon).
   * Call loadParcelData() first (or let it auto-load here).
   *
   * @param {L.Map}  map
   * @param {number} lat
   * @param {number} lon
   * @param {number} bufferMiles
   */
  function renderParcelZoningLayer(map, lat, lon, bufferMiles) {
    var L = window.L;
    if (!L || !map || typeof lat !== 'number' || typeof lon !== 'number') return;

    // Remove any existing markers first
    removeParcelLayer(map);

    loadParcelData().then(function (data) {
      var parcels = data.parcels;
      var zoning  = data.zoning;

      if (!parcels.length && !zoning.length) {
        console.warn('[PMAParcelZoning] No data to render.');
        return;
      }

      var miles    = typeof bufferMiles === 'number' ? bufferMiles : 5;
      var rendered = 0;

      // Build a quick lookup of zoning jurisdictions by county FIPS or name
      var zoningByFips = {};
      var zoningByName = {};
      zoning.forEach(function (z) {
        if (z.county_fips) zoningByFips[String(z.county_fips)] = z;
        if (z.county_name) zoningByName[z.county_name.toLowerCase()] = z;
        if (z.jurisdiction) zoningByName[z.jurisdiction.toLowerCase()] = z;
      });

      parcels.forEach(function (parcel) {
        // Each parcel entry needs lat/lon (county centroid)
        var pLat = parseFloat(parcel.lat || parcel.centroid_lat || parcel.latitude);
        var pLon = parseFloat(parcel.lon || parcel.centroid_lon || parcel.longitude);
        if (!isFinite(pLat) || !isFinite(pLon)) return;

        var dist = _haversine(lat, lon, pLat, pLon);
        if (dist > miles) return;

        // Find matching zoning entry
        var fips   = String(parcel.county_fips || parcel.fips || '');
        var cName  = (parcel.county_name || parcel.name || '').toLowerCase();
        var zone   = zoningByFips[fips] || zoningByName[cName] || null;

        var cls    = _classify(parcel, zone);
        var pCount = parseInt(parcel.developable_parcels || parcel.parcel_count || 0, 10) || 0;
        var radius = _clamp(RADIUS_BASE + pCount * RADIUS_SCALE, RADIUS_BASE, 20);

        var marker = L.circleMarker([pLat, pLon], {
          radius:      radius,
          color:       cls.color,
          fillColor:   cls.color,
          fillOpacity: 0.55,
          weight:      1.5
        }).addTo(map);

        var compatScore = zone ? (parseFloat(zone.compat_score) || 0).toFixed(1) : '—';
        var tipLines = [
          '<strong>' + (parcel.county_name || parcel.name || 'County') + '</strong>',
          cls.label,
          'MF compat score: ' + compatScore + ' / 2.5',
          pCount ? pCount.toLocaleString() + ' developable parcels' : '',
          dist.toFixed(1) + ' mi from site'
        ].filter(Boolean).join('<br>');

        marker.bindTooltip(tipLines, { sticky: true });
        _parcelMarkers.push(marker);
        rendered++;
      });

      if (rendered === 0 && parcels.length > 0) {
        console.warn('[PMAParcelZoning] No parcel entries within ' + miles + ' mi of site. ' +
          'Parcel data may lack lat/lon centroid fields — check parcel_aggregates_co.json schema.');
      } else {
        console.log('[PMAParcelZoning] Rendered ' + rendered + ' county markers within ' + miles + ' mi');
      }
    });
  }

  /**
   * Remove all parcel/zoning markers from the map.
   * @param {L.Map} map
   */
  function removeParcelLayer(map) {
    _parcelMarkers.forEach(function (m) {
      if (map) { try { map.removeLayer(m); } catch (e) {} }
    });
    _parcelMarkers = [];
  }

  /**
   * Return loaded data (or null if not yet loaded).
   */
  function getLoadedData() {
    return _loaded ? { parcels: _parcels, zoning: _zoning } : null;
  }

  /* ── Auto-wire parcel-zoning checkbox ─────────────────────────────── */

  function _getSiteCoords() {
    var eng = window.PMAEngine;
    if (eng && typeof eng._lastLat === 'number' && typeof eng._lastLon === 'number') {
      return { lat: eng._lastLat, lon: eng._lastLon };
    }
    var el = document.getElementById('pmaSiteCoords');
    if (el) {
      var m = (el.textContent || '').match(/([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    }
    return null;
  }

  function _getBufferMiles() {
    var sel = document.getElementById('pmaBufferSelect');
    return sel ? (parseInt(sel.value, 10) || 5) : 5;
  }

  function _initCheckboxListener() {
    var check = document.getElementById('pmaParcelZoningToggle');
    if (!check) return;
    check.addEventListener('change', function () {
      var map  = window.PMAEngine && window.PMAEngine._map();
      var site = _getSiteCoords();
      if (!map) return;
      if (check.checked) {
        renderParcelZoningLayer(map, site ? site.lat : null, site ? site.lon : null, _getBufferMiles());
      } else {
        removeParcelLayer(map);
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initCheckboxListener);
    } else {
      _initCheckboxListener();
    }
  }

  /* ── Expose ───────────────────────────────────────────────────────── */
  window.PMAParcelZoning = {
    loadParcelData:           loadParcelData,
    renderParcelZoningLayer:  renderParcelZoningLayer,
    removeParcelLayer:        removeParcelLayer,
    getLoadedData:            getLoadedData
  };

}());
