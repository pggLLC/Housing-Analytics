/**
 * js/transit-zone.js — HB26-1065 transit-zone screen (#1937 Phase 2).
 *
 * One answer to "is this point within 2 miles of transit, and is that
 * official?", for every page that asks (needs assessment, PMA, market study,
 * recommendation, exports), so they cannot disagree.
 *
 *   var zone = TransitZone.create({
 *     stops:     <data/amenities/transit_stops_statewide_co.geojson>,
 *     mapStatus: <data/policy/thiz-map-status.json>,
 *     zones:     <OEDIT zone polygons, once published; else null>,
 *     now:       new Date()          // optional, for tests
 *   });
 *   zone.status(lat, lon)  →  {
 *     status:               'within_2mi' | 'outside' | 'unavailable',
 *     unavailableReason:    string | null,
 *     radiusMiles:          number | null,  // from mapStatus, never hardcoded
 *     nearestStop:          { name, agency, sources, reliability, distanceMiles } | null,
 *     nearestConfirmedStop: same shape | null,
 *     confirmedOnly:        true when the answer does not rest on an
 *                           OpenStreetMap-only stop; null when unavailable,
 *     designation:          'provisional' | 'official_in' | 'official_out',
 *     designationNote:      the sentence every rendered result must carry
 *   }
 *
 * Absence is never a "no": missing or stale stop data, or an unreadable
 * point, gives status 'unavailable' with the reason, not 'outside'.
 */
(function (root) {
  'use strict';

  var EARTH_RADIUS_MI = 3958.8;
  var DEFAULT_MAX_AGE_DAYS = 16;   // matches the stop file's freshness SLA
  var CELL_DEG = 0.05;             // grid cell; ~3.5 mi, wider than the radius

  function toRad(d) { return d * Math.PI / 180; }

  function haversineMiles(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isNum(v) { return Number.isFinite(v); }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }

  // ── Official zones (once OEDIT publishes) ───────────────────────────────
  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inZones(lon, lat, zones) {
    var feats = (zones && zones.features) || [];
    for (var f = 0; f < feats.length; f++) {
      var g = feats[f] && feats[f].geometry;
      if (!g) continue;
      var polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (var p = 0; p < polys.length; p++) {
        var poly = polys[p];
        if (!poly || !poly.length || !inRing(lon, lat, poly[0])) continue;
        var inHole = false;
        for (var h = 1; h < poly.length; h++) if (inRing(lon, lat, poly[h])) { inHole = true; break; }
        if (!inHole) return true;
      }
    }
    return false;
  }

  // ── Designation: what OEDIT's map says, or why we cannot say yet ────────
  function designationFor(lon, lat, mapStatus, zones, now) {
    if (!mapStatus || !mapStatus.map_due_date) {
      return { designation: 'provisional',
               note: 'Provisional — the status of OEDIT’s Transit and Housing Investment Zone map could not be read, so this is a screen only.' };
    }
    var due = formatDate(mapStatus.map_due_date) || mapStatus.map_due_date;
    if (mapStatus.status === 'published' && zones && zones.features && zones.features.length) {
      var inside = inZones(lon, lat, zones);
      return { designation: inside ? 'official_in' : 'official_out',
               note: inside ? 'Inside a Transit and Housing Investment Zone on OEDIT’s published map.'
                            : 'Outside every Transit and Housing Investment Zone on OEDIT’s published map.' };
    }
    if (mapStatus.status === 'published') {
      return { designation: 'provisional',
               note: 'Provisional — OEDIT has published its zone map, but it has not been loaded here yet, so this is still a screen.' };
    }
    var dueTime = Date.parse(mapStatus.map_due_date + 'T23:59:59-06:00');
    if (isNum(dueTime) && now.getTime() > dueTime) {
      return { designation: 'provisional',
               note: 'Provisional — reliability questionable. OEDIT’s Transit and Housing Investment Zone map was due ' +
                     due + ' and has not been loaded here; check whether it has been released.' };
    }
    return { designation: 'provisional',
             note: 'Provisional — reliability questionable until OEDIT publishes the Transit and Housing Investment Zone map (due ' +
                   due + ').' };
  }

  function describe(stop, distanceMiles) {
    var p = stop.properties || {};
    return { name: p.name || null, agency: p.agency || null, sources: p.sources || [],
             reliability: p.reliability || null, distanceMiles: Math.round(distanceMiles * 100) / 100 };
  }

  function create(opts) {
    opts = opts || {};
    var now = opts.now instanceof Date ? opts.now : new Date();
    var mapStatus = opts.mapStatus || null;
    var zones = opts.zones || null;
    var maxAgeDays = isNum(opts.maxAgeDays) ? opts.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
    var radius = mapStatus && isNum(mapStatus.zone_radius_miles) && mapStatus.zone_radius_miles > 0
      ? mapStatus.zone_radius_miles : null;

    // Why the stop data cannot answer, if it cannot. Decided once.
    var dataProblem = null;
    var stops = opts.stops;
    var feats = stops && Array.isArray(stops.features) ? stops.features : null;
    if (!feats || !feats.length) {
      dataProblem = 'Transit stop data did not load, so distance to transit could not be checked.';
    } else if (radius === null) {
      dataProblem = 'The zone radius could not be read from the zone-map status file.';
    } else {
      var gen = Date.parse((stops.meta && stops.meta.generated) || '');
      if (!isNum(gen)) {
        dataProblem = 'The transit stop data has no build date, so its age cannot be confirmed.';
      } else {
        var ageDays = (now.getTime() - gen) / 86400000;
        if (ageDays > maxAgeDays) {
          dataProblem = 'The transit stop data is ' + Math.floor(ageDays) + ' days old (limit ' + maxAgeDays +
                        '), so a new or moved stop could be missed.';
        }
      }
    }

    var grid = {};
    if (!dataProblem) {
      for (var i = 0; i < feats.length; i++) {
        var c = feats[i] && feats[i].geometry && feats[i].geometry.coordinates;
        if (!c || !isNum(c[0]) || !isNum(c[1])) continue;
        var key = Math.floor(c[0] / CELL_DEG) + ',' + Math.floor(c[1] / CELL_DEG);
        (grid[key] = grid[key] || []).push(feats[i]);
      }
    }

    // Nearest stop overall and nearest confirmed stop, searching outward
    // until the ring distance exceeds the best found.
    function nearest(lat, lon) {
      var bestAny = null, dAny = Infinity, bestConf = null, dConf = Infinity;
      var cx = Math.floor(lon / CELL_DEG), cy = Math.floor(lat / CELL_DEG);
      var cellMiles = CELL_DEG * 69 * Math.cos(toRad(Math.min(Math.abs(lat), 80)));
      for (var r = 0; r <= 60; r++) {
        for (var dx = -r; dx <= r; dx++) {
          for (var dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            var cell = grid[(cx + dx) + ',' + (cy + dy)];
            if (!cell) continue;
            for (var k = 0; k < cell.length; k++) {
              var s = cell[k], sc = s.geometry.coordinates;
              var d = haversineMiles(lat, lon, sc[1], sc[0]);
              if (d < dAny) { dAny = d; bestAny = s; }
              var unconf = s.properties && s.properties.reliability === 'unconfirmed';
              if (!unconf && d < dConf) { dConf = d; bestConf = s; }
            }
          }
        }
        if (bestConf && dConf < (r - 1) * cellMiles) break;
      }
      return { any: bestAny, dAny: dAny, conf: bestConf, dConf: dConf };
    }

    function status(lat, lon) {
      var des = designationFor(lon, lat, mapStatus, zones, now);
      var base = { radiusMiles: radius, nearestStop: null, nearestConfirmedStop: null, confirmedOnly: null,
                   designation: des.designation, designationNote: des.note };
      if (!isNum(lat) || !isNum(lon)) {
        return Object.assign({ status: 'unavailable', unavailableReason: 'The site location could not be read.' }, base);
      }
      if (dataProblem) {
        return Object.assign({ status: 'unavailable', unavailableReason: dataProblem }, base);
      }
      var n = nearest(lat, lon);
      base.nearestStop = n.any ? describe(n.any, n.dAny) : null;
      base.nearestConfirmedStop = n.conf ? describe(n.conf, n.dConf) : null;
      if (n.conf && n.dConf <= radius) {
        base.confirmedOnly = true;
        return Object.assign({ status: 'within_2mi', unavailableReason: null }, base);
      }
      if (n.any && n.dAny <= radius) {
        base.confirmedOnly = false;   // only an OpenStreetMap-only stop is in range
        return Object.assign({ status: 'within_2mi', unavailableReason: null }, base);
      }
      base.confirmedOnly = true;
      return Object.assign({ status: 'outside', unavailableReason: null }, base);
    }

    return { status: status, radiusMiles: radius, dataProblem: dataProblem };
  }

  var api = { create: create, haversineMiles: haversineMiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TransitZone = api;
}(typeof window !== 'undefined' ? window : null));
