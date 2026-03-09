/**
 * js/data-connectors/cdot-traffic.js
 * Colorado Department of Transportation traffic count accessor.
 *
 * Data source: data/market/cdot_traffic_co.json
 * Real data: https://www.codot.gov/programs/statewideplanning/traffic-data
 *
 * Exposed as window.CdotTraffic.
 */
(function () {
  'use strict';

  var _data     = null;  // raw loaded data
  var _stations = null;  // flat array of stations

  /* ── Haversine distance (miles) ────────────────────────────────── */
  function _haversine(lat1, lon1, lat2, lon2) {
    var R  = 3958.8;
    var dL = (lat2 - lat1) * Math.PI / 180;
    var dO = (lon2 - lon1) * Math.PI / 180;
    var a  = Math.sin(dL / 2) * Math.sin(dL / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dO / 2) * Math.sin(dO / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ── Load data ──────────────────────────────────────────────── */
  function loadMetrics() {
    var DS = window.DataService;
    if (!DS) return Promise.reject(new Error('DataService not available'));
    return DS.getJSON(DS.baseData('market/cdot_traffic_co.json'))
      .then(function (raw) {
        _data     = raw;
        _stations = (raw && raw.stations) ? raw.stations : [];
        return _data;
      })
      .catch(function (e) {
        console.warn('[cdot-traffic] Failed to load cdot_traffic_co.json:', e && e.message);
        _data     = { stations: [] };
        _stations = [];
        return _data;
      });
  }

  /* ── Find stations within radius ──────────────────────────────── */
  function getStationsInBuffer(lat, lon, miles) {
    if (!_stations) return [];
    return _stations.filter(function (s) {
      return _haversine(lat, lon, s.lat || 0, s.lon || 0) <= miles;
    });
  }

  /* ── Nearest station ───────────────────────────────────────────── */
  function getNearestStation(lat, lon) {
    if (!_stations || !_stations.length) return null;
    var best = null, bestDist = Infinity;
    _stations.forEach(function (s) {
      var d = _haversine(lat, lon, s.lat || 0, s.lon || 0);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    return best ? { station: best, distance_miles: Math.round(bestDist * 10) / 10 } : null;
  }

  /* ── Aggregate AADT for stations in buffer ─────────────────────── */
  function aggregateForBuffer(lat, lon, miles) {
    var stations = getStationsInBuffer(lat, lon, miles);
    if (!stations.length) {
      // Fall back to nearest station within 30 miles
      var nearest = getNearestStation(lat, lon);
      if (nearest && nearest.distance_miles <= 30) {
        stations = [nearest.station];
      }
    }
    if (!stations.length) return null;
    var maxAadt = 0, sumAadt = 0;
    stations.forEach(function (s) {
      sumAadt += s.aadt || 0;
      if ((s.aadt || 0) > maxAadt) maxAadt = s.aadt;
    });
    return {
      station_count: stations.length,
      max_aadt:      maxAadt,
      avg_aadt:      Math.round(sumAadt / stations.length),
      stations:      stations
    };
  }

  /**
   * Score traffic connectivity 0–100 for PMA workforce dimension.
   * Higher AADT = better regional connectivity = more workforce access.
   * Scale: 0→0, 10k→40, 30k→70, 60k→85, 100k→95, 150k+→100
   */
  function scoreTrafficConnectivity(agg) {
    if (!agg) return 40;   // neutral-low when no station nearby
    var aadt = agg.max_aadt || 0;
    if (aadt <= 0)      return 20;
    if (aadt < 5000)    return 30;
    if (aadt < 15000)   return 50;
    if (aadt < 30000)   return 65;
    if (aadt < 60000)   return 80;
    if (aadt < 100000)  return 90;
    return 100;
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.CdotTraffic = {
    loadMetrics:             loadMetrics,
    getStationsInBuffer:     getStationsInBuffer,
    getNearestStation:       getNearestStation,
    aggregateForBuffer:      aggregateForBuffer,
    scoreTrafficConnectivity: scoreTrafficConnectivity,
    /** @returns {object|null} raw loaded data */
    getData: function () { return _data; }
  };

}());
