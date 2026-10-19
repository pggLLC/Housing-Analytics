/**
 * whats-near.js — the "What's near this site" block on Market Analysis.
 *
 * Detail only: nothing here feeds the site score (site-selection-score.js
 * reads the nearest-distance inputs the controller builds, not this block).
 *
 * Two tables, both plain <table>s with one header row so the shared sorter
 * and header tips pick them up (column help is each <th>'s data-tip):
 *   - Jobs in the site's census tract and within 5 and 10 miles, from LEHD
 *     LODES 2023 workplace counts by census tract. A tract's jobs count when
 *     the tract's centre point (TIGER 2020 internal point) is inside the
 *     distance; the site's own tract always counts, however large it is.
 *   - Places near the site: nearest one by name and straight-line distance,
 *     and how many are within 1 and 3 miles, from the OsmAmenities records
 *     (OpenStreetMap, statewide transit stops, CDPHE hospitals, CDHS child
 *     care, HRSA community health centers).
 * Plus the USDA Food Access Research Atlas flag for the site's tract.
 *
 * API: window.WhatsNear.render(hostId, { lat, lon, tractGeoid })
 * The place rows draw at once; jobs and the food-access line fill in when
 * their files arrive. A later render() for another site wins: a slow load
 * for the previous site never overwrites it.
 */
(function () {
  'use strict';

  // 0 = the census tract the site is in. Tract-level jobs can't support a
  // 1-mile figure: a rural tract can be 30 miles across.
  var JOB_RADII = [0, 5, 10];
  var NEAR = 1;
  var FAR = 3;

  var HOSPITAL_KIND = {
    CAH:  'critical access hospital',
    CCEC: 'community clinic and emergency center'
  };

  // Group, row label, OsmAmenities type, header-free help shown on the row.
  var PLACE_ROWS = [
    { group: 'Health care', label: 'Clinic or doctor',         type: 'healthcare',
      tip: 'Clinic, doctor’s office, urgent care or hospital (OpenStreetMap). Dentists, pharmacies and alternative medicine are not counted.' },
    { group: 'Health care', label: 'Community health center',  type: 'health_center',
      tip: 'Federally funded health center or look-alike: takes Medicaid and uninsured patients on a sliding fee (HRSA). Permanent sites only; school-based and mobile sites are not counted.' },
    { group: 'Health care', label: 'Pharmacy',                 type: 'pharmacy',
      tip: 'Pharmacy or chemist (OpenStreetMap).' },
    { group: 'Health care', label: 'Hospital',                 type: 'hospital',
      tip: 'Licensed hospital, critical access hospital or community clinic and emergency center (CDPHE). Not every licensed hospital has an emergency room (a surgical hospital counts here), so check before citing one.' },
    { group: 'Recreation',  label: 'Park',                     type: 'park',
      tip: 'Named park or open space (OpenStreetMap). Parks are points, so a pocket park and a regional park count the same.' },
    { group: 'Daily needs', label: 'Full grocery store',       type: 'grocery',
      tip: 'Supermarket or grocer (OpenStreetMap). Convenience and general stores are counted separately.' },
    { group: 'Daily needs', label: 'Convenience or general store', type: 'convenience',
      tip: 'Convenience or general store (OpenStreetMap). In some small towns the only grocer is tagged this way.' },
    { group: 'Transit',     label: 'Transit stop',             type: 'transit_stop',
      tip: 'Public transit stop from agency schedules; OpenStreetMap-only stops are used only where no agency stop is within 2 miles.' },
    { group: 'Schools and child care', label: 'School',        type: 'school',
      tip: 'School (OpenStreetMap).' },
    { group: 'Schools and child care', label: 'Child care center', type: 'childcare',
      tip: 'Licensed child care facility (Colorado licensed child care facilities report, data.colorado.gov).' }
  ];

  var files = {};
  var renderToken = 0;
  // Set when neighborhood_access.json fails or is empty (market-analysis.js),
  // so the places table says so instead of "still loading" forever.
  var placesUnavailableReason = null;
  var redraw = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function fmtInt(n) {
    return typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  }

  function fmtMi(d) {
    if (typeof d !== 'number' || !isFinite(d)) { return '—'; }
    return d < 0.05 ? 'under 0.1 mi' : d.toFixed(1) + ' mi';
  }

  function roughly(n) {
    var step = n >= 1000 ? 100 : 10;
    return Math.round(n / step) * step;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 3958.8;
    var p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    var dp = p2 - p1, dl = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** One fetch per file per page; a failed load is not cached. */
  function load(path) {
    if (files[path]) { return files[path]; }
    var DS = window.DataService;
    var p = DS && typeof DS.getJSON === 'function'
      ? DS.getJSON(DS.baseData ? DS.baseData(path) : 'data/' + path)
      : fetch('data/' + path).then(function (r) {
          if (!r.ok) { throw new Error('HTTP ' + r.status); }
          return r.json();
        });
    files[path] = p.catch(function (e) { delete files[path]; throw e; });
    return files[path];
  }

  function th(label, tip, numeric) {
    return '<th scope="col" data-tip="' + esc(tip) + '"' +
      (numeric ? ' style="text-align:right;"' : '') + '>' + esc(label) + '</th>';
  }

  var TABLE_STYLE = 'width:100%;border-collapse:collapse;font-size:.85rem;';
  var NUM = ' style="text-align:right;font-variant-numeric:tabular-nums;"';

  /* ── Places ───────────────────────────────────────────────────────── */

  function placeRow(osm, lat, lon, row) {
    var nearest = osm.getNearestByType(lat, lon, row.type);
    var hits = osm.getWithinRadius(lat, lon, row.type, FAR) || [];
    if (row.type === 'transit_stop') {
      // Count the same stop set the nearest stop came from, so an
      // OpenStreetMap-only stop is never counted beside agency stops.
      var basis = nearest && nearest.transitStopBasis === 'openstreetmap_unconfirmed'
        ? 'openstreetmap_unconfirmed' : 'confirmed';
      hits = hits.filter(function (h) { return (h.transitStopBasis || 'confirmed') === basis; });
    }
    var near = hits.filter(function (h) { return h.distanceMiles <= NEAR; }).length;
    var name = nearest ? nearest.name : '';
    if (nearest && row.type === 'hospital' && HOSPITAL_KIND[nearest.hospitalType]) {
      name += ' (' + HOSPITAL_KIND[nearest.hospitalType] + ')';
    }
    if (nearest && row.type === 'transit_stop' && nearest.transitStopBasis === 'openstreetmap_unconfirmed') {
      name += ' (OpenStreetMap only; confirm service with the agency)';
    }
    return {
      group: row.group, label: row.label, tip: row.tip, type: row.type,
      name: name,
      distance: nearest ? nearest.distanceMiles : null,
      near: near,
      far: hits.length
    };
  }

  function placesTable(rows) {
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td title="' + esc(r.tip) + '">' + esc(r.label) + '</td>' +
        '<td' + NUM + (r.distance == null ? '' : ' data-sort-value="' + r.distance + '"') + '>' + fmtMi(r.distance) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.near) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.far) + '</td>' +
        '<td>' + (r.name ? esc(r.name) : '<span style="color:var(--muted);">None found</span>') + '</td>' +
        '<td>' + esc(r.group) + '</td>' +
      '</tr>';
    }).join('');
    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;">' +
      '<table class="whats-near-table" style="' + TABLE_STYLE + '">' +
        '<caption style="text-align:left;font-weight:600;padding:.25rem 0 .5rem;">Places near this site</caption>' +
        '<thead><tr>' +
          th('Place', 'The kind of place. Rest the pointer on a row’s place for what is and isn’t counted.') +
          th('Distance', 'Straight-line miles to the nearest one, not driving or walking distance.', true) +
          th('Within 1 mi', 'How many are within 1 mile in a straight line.', true) +
          th('Within 3 mi', 'How many are within 3 miles in a straight line.', true) +
          th('Nearest', 'The nearest one by name. Critical access hospitals and community clinic and emergency centers are marked as such.') +
          th('Group', 'What the place is for: health care, recreation, daily needs, transit, or schools and child care.') +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ── Jobs ─────────────────────────────────────────────────────────── */

  function inRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function inPolygon(lon, lat, rings) {
    if (!rings || !rings.length || !inRing(lon, lat, rings[0])) { return false; }
    for (var h = 1; h < rings.length; h++) {
      if (inRing(lon, lat, rings[h])) { return false; }
    }
    return true;
  }

  /** GEOID of the 2020 tract containing the point, or '' (TIGER display geometry). */
  function tractAt(lat, lon, geometry) {
    var feats = (geometry && geometry.features) || [];
    for (var i = 0; i < feats.length; i++) {
      var g = feats[i].geometry;
      if (!g || !g.coordinates) { continue; }
      var hit = g.type === 'Polygon' ? inPolygon(lon, lat, g.coordinates)
        : g.type === 'MultiPolygon' ? g.coordinates.some(function (p) { return inPolygon(lon, lat, p); })
        : false;
      if (hit) { return String((feats[i].properties || {}).GEOID || ''); }
    }
    return '';
  }

  function jobsWithin(lat, lon, centroids, lodes, siteTract) {
    var byGeoid = {};
    (lodes.tracts || []).forEach(function (t) { byGeoid[t.geoid] = t; });
    var out = JOB_RADII.map(function (r) {
      return { radius: r, total: 0, low: 0, goods: 0, trade: 0, service: 0, tracts: 0 };
    });
    (centroids.tracts || []).forEach(function (c) {
      var t = byGeoid[c.geoid];
      if (!t || typeof c.lat !== 'number' || typeof c.lon !== 'number') { return; }
      var own = !!siteTract && c.geoid === siteTract;
      var d = haversine(lat, lon, c.lat, c.lon);
      out.forEach(function (o) {
        if (o.radius === 0 ? !own : (d > o.radius && !own)) { return; }
        o.total   += t.totalJobs   || 0;
        o.low     += t.low_wage    || 0;
        o.goods   += t.goodsJobs   || 0;
        o.trade   += t.tradeJobs   || 0;
        o.service += t.serviceJobs || 0;
        o.tracts++;
      });
    });
    return out;
  }

  function jobsTable(rows, vintage) {
    var body = rows.map(function (r) {
      return '<tr>' +
        '<td data-sort-value="' + r.radius + '">' + (r.radius ? r.radius + ' miles' : 'This census tract') + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.total) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.low) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.goods) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.trade) + '</td>' +
        '<td' + NUM + '>' + fmtInt(r.service) + '</td>' +
      '</tr>';
    }).join('');
    return '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;">' +
      '<table class="whats-near-table" style="' + TABLE_STYLE + '">' +
        '<caption style="text-align:left;font-weight:600;padding:.25rem 0 .5rem;">Jobs near this site (LODES ' + esc(vintage) + ')</caption>' +
        '<thead><tr>' +
          th('Area', 'The census tract the site is in, then straight-line distances from the site. A tract\u2019s jobs count when the tract\u2019s centre point is inside the distance; the site\u2019s own tract always counts, so in a large rural tract these include jobs farther away.') +
          th('All jobs', 'Jobs located in those tracts (LEHD LODES workplace counts, all jobs).', true) +
          th('Low-wage jobs', 'Jobs paying $1,250 a month or less (LODES lowest earnings tier), the jobs tax-credit tenants most often hold.', true) +
          th('Goods-producing', 'Agriculture, mining, construction and manufacturing.', true) +
          th('Trade and transport', 'Utilities, wholesale, retail, transportation and warehousing.', true) +
          th('Services', 'All other services: health care, education, food service, offices, government and the rest (LODES all other services).', true) +
        '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ── Summary sentence ─────────────────────────────────────────────── */

  function summary(places, jobs) {
    var parts = [];
    var five = jobs && jobs.filter(function (j) { return j.radius === 5; })[0];
    if (five) {
      parts.push(five.total
        ? 'about ' + fmtInt(roughly(five.total)) + ' jobs in census tracts within 5 miles, ' +
          fmtInt(roughly(five.low)) + ' of them low-wage'
        : 'no jobs counted within 5 miles');
    }
    function nearestText(type, label) {
      var r = places.filter(function (p) { return p.type === type; })[0];
      if (!r) { return; }
      parts.push(r.distance == null ? 'no ' + label + ' found' : label + ' ' + fmtMi(r.distance));
    }
    nearestText('grocery', 'full grocery store');
    nearestText('healthcare', 'clinic or doctor');
    nearestText('health_center', 'community health center');
    nearestText('hospital', 'hospital');
    var park = places.filter(function (p) { return p.type === 'park'; })[0];
    if (park) {
      parts.push(park.near
        ? park.near + (park.near === 1 ? ' park' : ' parks') + ' within 1 mile'
        : 'nearest park ' + fmtMi(park.distance));
    }
    if (!parts.length) { return ''; }
    var s = parts.join('; ') + '.';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function foodLine(food, tractGeoid) {
    var t = food && food.tracts && tractGeoid ? food.tracts[tractGeoid] : null;
    if (!t) { return ''; }
    var text = t.foodDesert
      ? 'This census tract is a USDA low-income, low-access tract (a "food desert": most residents are more than 1 mile from a supermarket in a city, or 10 miles in the country).'
      : t.lowAccess1mi
        ? 'This census tract is not a USDA food desert, but USDA counts it as low-access: many residents live more than 1 mile from a supermarket.'
        : 'This census tract is not a USDA food desert.';
    return '<p style="margin:.5rem 0 0;font-size:var(--small);">' + esc(text) +
      ' <span style="color:var(--muted);">USDA Food Access Research Atlas, 2019.</span></p>';
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render(hostId, site) {
    var host = document.getElementById(hostId);
    if (!host || !site || typeof site.lat !== 'number' || typeof site.lon !== 'number') { return; }
    var token = ++renderToken;
    var lat = site.lat, lon = site.lon;
    var osm = window.OsmAmenities;
    if (!osm) { placesUnavailableReason = 'the amenity connector did not load.'; }

    var places = osm && osm.isLoaded()
      ? PLACE_ROWS.map(function (row) { return placeRow(osm, lat, lon, row); })
      : null;
    var state = { jobs: null, jobsNote: 'Loading jobs…', food: '' };

    function draw() {
      if (token !== renderToken) { return; }
      var sentence = summary(places || [], state.jobs);
      host.innerHTML =
        '<h3 style="margin:0 0 .5rem;font-size:1rem;font-weight:700;color:var(--text);">What’s near this site</h3>' +
        (sentence ? '<p style="margin:0 0 .75rem;font-size:1rem;line-height:1.45;">' + esc(sentence) + '</p>' : '') +
        (state.jobs ? jobsTable(state.jobs, state.vintage)
                    : '<p style="color:var(--muted);font-size:var(--small);">' + esc(state.jobsNote) + '</p>') +
        '<div style="height:.75rem;"></div>' +
        (places ? placesTable(places)
                : '<p style="color:var(--muted);font-size:var(--small);">' +
                  (placesUnavailableReason
                    ? 'Nearby places are unavailable: ' + esc(placesUnavailableReason)
                    : 'Nearby places are still loading.') + '</p>') +
        state.food +
        '<p style="margin:.5rem 0 0;color:var(--muted);font-size:.8125rem;line-height:1.4;">' +
          'Distances are straight-line miles. Places: © OpenStreetMap contributors; CDPHE hospitals; ' +
          'Colorado licensed child care; HRSA health center sites; statewide transit stops. ' +
          'Jobs: U.S. Census Bureau LEHD LODES. Shown for detail only; the site score does not use these counts.' +
        '</p>';
    }

    redraw = draw;
    draw();

    var tract = site.tractGeoid || '';
    Promise.all([
      load('market/tract_centroids_co.json'),
      load('market/lodes_co.json'),
      load('market/pma_tract_display_geometry.geojson').catch(function () { return null; })
    ])
      .then(function (r) {
        tract = tractAt(lat, lon, r[2]) || tract;
        state.vintage = (r[1] && r[1].meta && r[1].meta.vintage) || '';
        state.jobs = jobsWithin(lat, lon, r[0], r[1], tract);
      })
      .catch(function () { state.jobsNote = 'Jobs data did not load.'; })
      .then(function () {
        draw();
        if (!tract) { return; }
        return load('market/food_access_co.json')
          .then(function (food) { state.food = foodLine(food, tract); draw(); })
          .catch(function () { /* the food-access line is optional */ });
      });
  }

  /** Mark nearby places unavailable and redraw the current site's block. */
  function setPlacesUnavailable(reason) {
    placesUnavailableReason = String(reason || 'the amenity data did not load.');
    if (redraw) { redraw(); }
  }

  window.WhatsNear = {
    render: render,
    setPlacesUnavailable: setPlacesUnavailable,
    // exposed for tests
    _jobsWithin: jobsWithin,
    _tractAt: tractAt,
    _summary: summary
  };
}());
