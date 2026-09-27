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
 *     designationNote:      the sentence every rendered result must carry,
 *     mapPublished:         true once the status file says OEDIT has published
 *   }
 *
 * The '2' in 'within_2mi' is the radius in the status file; the name is kept
 * for its consumers, and test/transit-zone.test.js fails if the two differ.
 * nearestStop.distanceMiles is rounded to 0.01 mi but never across the
 * radius, so the figure shown always agrees with the status.
 *
 * Absence is never a "no": missing or stale stop data, or an unreadable
 * point, gives status 'unavailable' with the reason, not 'outside'.
 */
(function (root) {
  'use strict';

  var EARTH_RADIUS_MI = 3958.8;
  // The stop file's freshness SLA. The single definition is the
  // 'transit-stops-statewide-co' maxAgeDays in js/data-source-inventory.js;
  // this copy exists because the helper must work on pages that do not load
  // the inventory, and test/transit-zone.test.js fails if the two differ.
  var DEFAULT_MAX_AGE_DAYS = 16;
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

  // ── Which stops count as transit ─────────────────────────────────────────
  // The one JS copy of scripts/lib/transit_stops.py's rule, for every page
  // that reads data/amenities/transit_stops_statewide_co.geojson: the zone
  // screen below and the PMA transit score (js/pma-transit.js).
  //   * Private airport/hotel shuttle pickups are mapped but are not public
  //     transit, and on-demand (GTFS-Flex) stops are not a defined route
  //     (owner decision 2026-09-27): neither counts. service "unknown" still
  //     counts; unknown is not demand response.
  //   * A counted stop is also confirmed: published by CDOT, an agency GTFS
  //     feed, or both. OpenStreetMap-only stops are "unconfirmed".
  // test/pma-transit-stops.test.js runs this over the committed stop file
  // and compares the result with scripts/lib/transit_stops.py.
  function isPublicScheduledStop(props) {
    return !!props && props.operator !== 'private_shuttle' && props.service !== 'demand_response';
  }
  function countsAsConfirmedStop(props) {
    return isPublicScheduledStop(props) && props.reliability === 'confirmed';
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
                  'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

  // Every zone must be a Polygon/MultiPolygon whose rings are closed lists
  // of at least four numeric positions. One unreadable zone makes the whole
  // map unusable here: skipping it would label sites inside it "official_out".
  function zonesProblem(zones) {
    var feats = zones && Array.isArray(zones.features) ? zones.features : null;
    if (!feats || !feats.length) return 'OEDIT\u2019s zone map has no zones to check against.';
    var bad = 0;
    for (var f = 0; f < feats.length; f++) {
      var g = feats[f] && feats[f].geometry;
      var polys = !g ? null : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
      var ok = Array.isArray(polys) && polys.length > 0 && polys.every(function (poly) {
        return Array.isArray(poly) && poly.length > 0 && poly.every(function (ring) {
          return Array.isArray(ring) && ring.length >= 4 && ring.every(function (pt) {
            return Array.isArray(pt) && isNum(pt[0]) && isNum(pt[1]);
          });
        });
      });
      if (!ok) bad++;
    }
    return bad ? 'OEDIT\u2019s zone map could not be read (' + bad + ' of ' + feats.length + ' zones unusable).' : null;
  }

  // Colorado's boundary is (almost exactly) a latitude/longitude rectangle —
  // the same box scripts/market/fetch_gtfs_transit.py CO_BBOX uses, and the
  // same inclusive test as build_transit_stops_co.py in_colorado_bbox. The box
  // is already the state's outer extent, so there is no tolerance: a margin
  // would label a Kansas or Utah point just over the line as Colorado.
  var CO_BBOX = { minLon: -109.0603, minLat: 36.9924, maxLon: -102.0415, maxLat: 41.0034 };
  function inColorado(lat, lon) {
    return lon >= CO_BBOX.minLon && lon <= CO_BBOX.maxLon &&
           lat >= CO_BBOX.minLat && lat <= CO_BBOX.maxLat;
  }

  // ── Designation: what OEDIT's map says, or why we cannot say yet ────────
  function designationFor(lon, lat, mapStatus, zones, now, zoneProblem) {
    if (!mapStatus || !mapStatus.map_due_date) {
      return { designation: 'provisional',
               note: 'Provisional — reliability questionable. The status of OEDIT’s Transit and Housing Investment Zone map could not be read, so this is a screen only.' };
    }
    var due = formatDate(mapStatus.map_due_date) || mapStatus.map_due_date;
    if (mapStatus.status === 'published' && zones && zoneProblem) {
      return { designation: 'provisional',
               note: 'Provisional — reliability questionable. ' + zoneProblem + ' This is still the stop-based screen.' };
    }
    if (mapStatus.status === 'published' && zones && zones.features && zones.features.length) {
      var inside = inZones(lon, lat, zones);
      return { designation: inside ? 'official_in' : 'official_out',
               note: inside ? 'Inside a Transit and Housing Investment Zone on OEDIT’s published map.'
                            : 'Outside every Transit and Housing Investment Zone on OEDIT’s published map.' };
    }
    if (mapStatus.status === 'published') {
      return { designation: 'provisional',
               note: 'Provisional — reliability questionable. OEDIT has published its zone map, but it has not been loaded here yet, so this is still a screen.' };
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

  // Distance shown to 0.01 mi, rounded away from the zone boundary when
  // plain rounding would cross it. The status is decided on the exact
  // distance; the shown figure must never contradict it. A stop 2.004 mi away
  // is "outside", so it shows as 2.01 mi, not "2 mi — outside"; a stop inside
  // never shows a figure beyond the radius.
  function roundedDistance(d, radius) {
    var r = Math.round(d * 100) / 100;
    if (!isNum(radius)) return r;
    if (d > radius && r <= radius) return (Math.floor(radius * 100 + 1e-9) + 1) / 100;
    if (d <= radius && r > radius) return Math.floor(radius * 100 + 1e-9) / 100;
    return r;
  }

  function describe(stop, distanceMiles, radius) {
    var p = stop.properties || {};
    return { name: p.name || null, agency: p.agency || null, sources: p.sources || [],
             reliability: p.reliability || null, distanceMiles: roundedDistance(distanceMiles, radius) };
  }

  // The zone screening radius, from the status file (never hardcoded):
  // a positive number, or null when the file or the value is missing.
  function zoneRadiusMiles(mapStatus) {
    return mapStatus && isNum(mapStatus.zone_radius_miles) && mapStatus.zone_radius_miles > 0
      ? mapStatus.zone_radius_miles : null;
  }

  function create(opts) {
    opts = opts || {};
    var now = opts.now && typeof opts.now.getTime === 'function' ? opts.now : new Date();
    var mapStatus = opts.mapStatus || null;
    var zones = opts.zones || null;
    var zoneProblem = zones ? zonesProblem(zones) : null;
    // Once OEDIT publishes, only its map can open a funding path — even when
    // the map then fails to load here (see fundingPath).
    var mapPublished = !!(mapStatus && mapStatus.status === 'published');
    var maxAgeDays = isNum(opts.maxAgeDays) ? opts.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
    var radius = zoneRadiusMiles(mapStatus);

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
        // Private shuttles and demand-response stops never count toward the
        // zone screen (isPublicScheduledStop, the shared rule above). A stop
        // with no properties at all is kept, as it always was.
        if (feats[i].properties && !isPublicScheduledStop(feats[i].properties)) continue;
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
      // A location we cannot trust gets no designation at all: a missing
      // (0,0), swapped or out-of-state point would otherwise read "outside"
      // or "official_out" — a false negative, not an unknown.
      var located = isNum(lat) && isNum(lon) && inColorado(lat, lon);
      if (!located) {
        return { status: 'unavailable', radiusMiles: radius, nearestStop: null, nearestConfirmedStop: null, confirmedOnly: null,
                 unavailableReason: isNum(lat) && isNum(lon)
                   ? 'The site location is outside Colorado (or its coordinates are missing or swapped), so the Colorado transit screen does not apply.'
                   : 'The site location could not be read.',
                 designation: 'provisional',
                 designationNote: 'Designation unavailable (reliability questionable): the site location could not be placed in Colorado.',
                 mapPublished: mapPublished };
      }
      var des = designationFor(lon, lat, mapStatus, zones, now, zoneProblem);
      var base = { radiusMiles: radius, nearestStop: null, nearestConfirmedStop: null, confirmedOnly: null,
                   designation: des.designation, designationNote: des.note, mapPublished: mapPublished };
      if (dataProblem) {
        return Object.assign({ status: 'unavailable', unavailableReason: dataProblem }, base);
      }
      var n = nearest(lat, lon);
      base.nearestStop = n.any ? describe(n.any, n.dAny, radius) : null;
      base.nearestConfirmedStop = n.conf ? describe(n.conf, n.dConf, radius) : null;
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

  // Area-level designation (a whole place or county, not a point). Before
  // the map, and without one loaded, the note is the same as for a point.
  // Once OEDIT's map is loaded, an area share is still the stop-based
  // screen: only a specific site can be checked against the official zones.
  function designation(mapStatus, now) {
    var d = designationFor(null, null, mapStatus, null, now && typeof now.getTime === 'function' ? now : new Date());
    if (mapStatus && mapStatus.status === 'published') {
      return { designation: 'official_map_available',
               note: 'OEDIT has published its Transit and Housing Investment Zone map. This share is still the stop-based screen (reliability questionable); check a specific site against the official map.' };
    }
    return { designation: d.designation, note: d.note };
  }

  // ── The CHFA QAP transit-oriented (TOD) distance (#1961) ─────────────────
  // One value, in data: thiz-map-status.json qap_tod_distance, beside the
  // zone radius. The market analysis TOD ring and check, the needs
  // assessment's share tile, the recommendation and the HNA exports all read
  // it through this function, and every one of them prints `disclosure`
  // beside its result. The disclosure is built from the data's method fields,
  // so if the measure changes the wording follows it on every surface
  // (test/transit-zone.test.js and the surface tests fail otherwise).
  //
  // Returns null when the entry is missing or unreadable: callers show the
  // half-mile result as unavailable, never a figure from a fallback distance.
  var METERS_PER_MILE = 1609.344;
  var METHOD_WORDS = { straight_line: 'straight-line', walking: 'walking', street_network: 'street-network' };
  var FRACTIONS = { 0.25: ['\u00bc', '1/4'], 0.5: ['\u00bd', '1/2'], 0.75: ['\u00be', '3/4'] };
  function milesLabel(m, plain) {
    var f = FRACTIONS[m];
    if (f) return f[plain ? 1 : 0] + ' mile';
    return m + (m === 1 ? ' mile' : ' miles');
  }
  function qapTodDistance(mapStatus) {
    var q = mapStatus && mapStatus.qap_tod_distance;
    if (!q || !isNum(q.miles) || !(q.miles > 0)) return null;
    var measured = METHOD_WORDS[q.method];
    var scored = METHOD_WORDS[q.qap_method];
    var cite = typeof q.qap_citation === 'string' && q.qap_citation ? q.qap_citation : null;
    if (!measured || !scored || !cite) return null;
    var disclosure = q.method === q.qap_method
      ? 'Measured as ' + measured + ' distance, the way CHFA scores it (' + cite + ').'
      : 'Measured as ' + measured + ' distance; CHFA scores ' + scored + ' distance (' + cite +
        '), so confirm the ' + scored + ' route before counting QAP points.';
    return { miles: q.miles, meters: q.miles * METERS_PER_MILE, method: q.method, qapMethod: q.qap_method,
             citation: cite, label: milesLabel(q.miles, false), plainLabel: milesLabel(q.miles, true),
             disclosure: disclosure };
  }

  // ── Area summary: one geography's figures, for every surface ─────────────
  // The needs assessment panel, the for-sale study, the recommendation and
  // the HNA exports all show the same area figures from
  // data/hna/transit-zone-by-geography.json. They read them through this one
  // function, so the share, its rounding, the unavailable reasons and the
  // designation note cannot drift apart between surfaces (finish line PC-1,
  // #1937 T3). Pure: the caller supplies the files and the clock.
  //
  // A measured share never rounds to an absolute: 0.4% is "<1%" (not "0%",
  // which reads as no transit at all) and 99.6% is ">99%" (not "100%").
  function shareLabel(v) {
    if (!isNum(v)) return null;
    if (v > 0 && v < 0.005) return '<1%';
    if (v < 1 && v >= 0.995) return '>99%';
    return Math.round(v * 100) + '%';
  }

  function areaSummary(data, geoid, mapStatus, now) {
    now = now && typeof now.getTime === 'function' ? now : new Date();
    function unavailable(code, reason) {
      return { status: 'unavailable', unavailableCode: code, unavailableReason: reason, geoid: geoid || null };
    }
    if (!geoid) return unavailable('no_geography', 'No jurisdiction is selected, so there is no area to screen.');
    if (!data || !data.geographies) return unavailable('not_loaded', 'Transit zone data did not load.');
    var rec = data.geographies[geoid];
    if (!rec) return unavailable('not_covered', 'No transit zone figures for this geography.');
    if (rec.unavailableReason) return unavailable('geography', rec.unavailableReason);
    var stopsGenerated = (data.meta && data.meta.stops_generated) || null;
    var gen = Date.parse(stopsGenerated || '');
    if (!isNum(gen)) return unavailable('undated', 'The transit stop data has no build date, so its age cannot be confirmed.');
    var ageDays = Math.floor((now.getTime() - gen) / 86400000);
    if (ageDays > DEFAULT_MAX_AGE_DAYS) {
      return unavailable('stale', 'The transit stop data is ' + ageDays + ' days old (limit ' + DEFAULT_MAX_AGE_DAYS +
        '), so these figures may miss new or moved stops.');
    }
    var radius = data.meta && data.meta.radius_miles;
    var share = rec.share_within_radius_confirmed;
    var half = rec.share_within_half_mile_confirmed;
    if (!isNum(share) || !isNum(half) || !(radius > 0)) {
      return unavailable('incomplete', 'The transit zone figures for this geography are incomplete.');
    }
    var des = designation(mapStatus, now);
    // The half-mile share is shown only with its distance and disclosure, and
    // only when the file was built for the distance the status file now gives.
    var tod = qapTodDistance(mapStatus);
    var builtFor = data.meta && data.meta.qap_tod_miles;
    var halfReason = !tod
      ? 'The CHFA QAP transit-oriented distance and how it is measured could not be read from the zone-map status file.'
      : builtFor !== tod.miles
        ? 'These figures were built for a ' + (isNum(builtFor) ? builtFor + '-mile' : 'different') +
          ' transit-oriented distance, not the ' + tod.miles + '-mile distance the zone-map status file gives.'
        : null;
    // A sampled zero is only proven when the builder measured the exact
    // boundary distance (zero_is_exact). Otherwise part of an edge strip is
    // within the radius, so the share is "under 1%", not "none".
    var edgeOnly = share === 0 && rec.zero_is_exact === false;
    var shareAny = isNum(rec.share_within_radius_any) ? rec.share_within_radius_any : null;
    return {
      status: 'ok',
      unavailableCode: null,
      unavailableReason: null,
      geoid: geoid,
      name: rec.name || null,
      radiusMiles: radius,
      share: share,
      shareLabel: edgeOnly ? '<1%' : shareLabel(share),
      shareAny: shareAny,
      shareAnyLabel: shareLabel(shareAny),
      shareHalfMile: halfReason ? null : half,
      halfMileLabel: halfReason ? null : shareLabel(half),
      halfMile: halfReason ? null : tod,
      halfMileDisclosure: halfReason ? null : tod.disclosure,
      halfMileUnavailableReason: halfReason,
      edgeOnly: edgeOnly,
      noneWithinRadius: share === 0 && !edgeOnly,
      nearestConfirmedStop: rec.nearest_confirmed_stop || null,
      nearestToBoundaryMiles: isNum(rec.nearest_confirmed_stop_to_boundary_miles) ? rec.nearest_confirmed_stop_to_boundary_miles : null,
      stopsGenerated: stopsGenerated,
      ageDays: ageDays,
      designation: des.designation,
      designationNote: des.note
    };
  }

  // Whether a site result may point at the Transit Zone credit, and on what
  // basis. The gate and the deal calculator both ask this, so they cannot
  // disagree. OEDIT's published map outranks the stop screen both ways: a
  // site on it is "official" whatever the stops say, and a site it leaves
  // out gets no funding path even if a stop is within the radius. A map that
  // is published but could not be loaded or read here (mapPublished, with a
  // provisional designation) also gives no funding path: the act counts only
  // what OEDIT's map identifies, and the stop screen no longer stands in.
  function fundingPath(result) {
    if (!result) return null;
    if (result.designation === 'official_in') return 'official';
    if (result.designation === 'official_out') return null;
    if (result.mapPublished === true) return null;
    if (result.status === 'within_2mi' && result.confirmedOnly === true) return 'screen';
    return null;
  }

  var api = { create: create, designation: designation, fundingPath: fundingPath, areaSummary: areaSummary,
              qapTodDistance: qapTodDistance, shareLabel: shareLabel, MAX_AGE_DAYS: DEFAULT_MAX_AGE_DAYS, haversineMiles: haversineMiles,
              isPublicScheduledStop: isPublicScheduledStop, countsAsConfirmedStop: countsAsConfirmedStop,
              zoneRadiusMiles: zoneRadiusMiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TransitZone = api;
}(typeof window !== 'undefined' ? window : null));
