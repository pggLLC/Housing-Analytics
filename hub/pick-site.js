// Pick a site where you are, or by a tap on a map (paul, 14 Nov 2026: "I would like to be able to push a button on
// the phone to get my location and run a deal based on where I am, or select a point and run a deal").
// LabPickSite.open(callback, { mode: 'locate' | 'map', radius: 2 | 5 | 10 | 0 }) opens a dialog with two ways in:
// "Use my location" (the browser asks for the position once, only on that press) and "Pick on the map" (a street
// or satellite map; a tap drops a pin that can be dragged). The county, the town and the census tracts nearby are
// worked out here, in the browser, from COHO's own files (county and place boundaries, Census TIGER 2020 tract
// centres): no position is sent to COHO or to a lookup service. "Use this site" calls back with
//   { lat, lon, label, countyFips, countyName, placeGeoid, placeName, placeLabel, tracts, radiusMiles, areaLabel,
//     method, source }
// and Cancel (or Esc) calls back with null. A point outside Colorado is refused in plain words. No figure is made.
(function (global) {
  'use strict';

  var doc = global.document;
  var VENDOR = function () { return global.LAB_VENDOR; };
  var FILES = { counties: 'data/co-county-boundaries.json', places: 'data/co-place-boundaries.geojson', cent: 'data/market/tract_centroids_co.json' };
  var RADII = [2, 5, 10, 0];
  // The map's two base layers (the site's map rule: OpenStreetMap streets by default, credited and linked; Esri
  // World Imagery as Satellite).
  var OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 };
  var SAT = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics', maxZoom: 19 };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---- files, fetched once and kept ----
  var cache = {};
  function get(path) {
    if (!cache[path]) {
      cache[path] = fetch(VENDOR() + path).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
      cache[path].catch(function () { delete cache[path]; });
    }
    return cache[path];
  }
  function files() { return Promise.all([get(FILES.counties), get(FILES.places), get(FILES.cent)]); }

  // ---- where a point falls ----
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeom(lon, lat, g) {
    var polys = !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(function (p) { return p.length && inRing(lon, lat, p[0]) && !p.slice(1).some(function (h) { return inRing(lon, lat, h); }); });
  }
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // "Fruita city" → name "Fruita", label "Fruita (city)"; a CDP reads as unincorporated (LabPlaceList).
  function placeNames(f) {
    var raw = String(f.properties.name || '');
    var name = raw.replace(/\s+(city|town|CDP)$/, '').replace(/\s+CDP\s+\(.+\)$/, '');
    var PL = global.LabPlaceList;
    return { name: name, label: PL ? PL.label(raw, f.properties.type === 'cdp' ? 'cdp' : '') : raw };
  }

  // Everything the callback gets, from a point and a radius (0: the whole county).
  function describe(lat, lon, radius, source) {
    return files().then(function (all) {
      var counties = all[0], places = all[1], cent = all[2];
      var county = (counties.features || []).filter(function (f) { return inGeom(lon, lat, f.geometry); })[0];
      if (!county) return { outside: true, lat: lat, lon: lon };
      var hits = (places.features || []).filter(function (f) { return inGeom(lon, lat, f.geometry); });
      // A town over an unincorporated community, if the simplified shapes overlap at the edge.
      var place = hits.filter(function (f) { return f.properties.type !== 'cdp'; })[0] || hits[0] || null;
      var cp = county.properties, countyFips = String(cp.GEOID), countyName = cp.NAMELSAD || (cp.NAME + ' County');
      var pn = place ? placeNames(place) : null;
      var tracts = (cent.tracts || []).filter(function (t) {
        return t.lat != null && t.lon != null && (radius ? miles({ lat: lat, lon: lon }, t) <= radius : String(t.county_fips || t.geoid.slice(0, 5)) === countyFips);
      }).map(function (t) { return String(t.geoid); }).sort();
      var where = pn ? pn.name + ', ' + countyName : countyName + ', outside any town';
      return {
        lat: +lat.toFixed(5), lon: +lon.toFixed(5), label: 'a point in ' + where, source: source,
        countyFips: countyFips, countyName: countyName,
        placeGeoid: place ? String(place.properties.geoid) : null, placeName: pn ? pn.name : null, placeLabel: pn ? pn.label : null,
        tracts: tracts, radiusMiles: radius || null, method: radius ? 'tract-centroid-radius' : 'county',
        areaLabel: radius ? 'Census tracts whose centre is within ' + radius + ' miles of the site' : 'All of ' + countyName,
        tractSource: FILES.cent, boundarySource: [FILES.counties, FILES.places]
      };
    });
  }

  // ---- the map (Leaflet, the site's own copy, loaded on first use) ----
  var leaflet = null;
  function needLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    if (leaflet) return leaflet;
    leaflet = new Promise(function (resolve, reject) {
      if (!doc.querySelector('link[data-ps-leaflet]')) {
        var css = doc.createElement('link');
        css.rel = 'stylesheet'; css.href = VENDOR() + 'js/vendor/leaflet.css'; css.setAttribute('data-ps-leaflet', '');
        doc.head.appendChild(css);
      }
      var js = doc.createElement('script');
      js.src = VENDOR() + 'js/vendor/leaflet.js';
      js.onload = function () { global.L && global.L.map ? resolve(global.L) : reject(new Error('map code')); };
      js.onerror = function () { leaflet = null; reject(new Error('map code')); };
      doc.body.appendChild(js);
    });
    return leaflet;
  }

  // ---- the dialog ----
  var open = null;
  function build() {
    var d = doc.createElement('dialog');
    d.className = 'ps-dialog';
    d.setAttribute('aria-labelledby', 'ps-title');
    d.innerHTML = '<div class="ps-body">' +
      '<h2 id="ps-title">Pick a site</h2>' +
      '<p>Use where you are, or tap a point on the map. Colorado only.</p>' +
      '<div class="actions ps-ways"><button type="button" class="button-link" data-ps="locate">Use my location</button>' +
      '<button type="button" class="button-link secondary" data-ps="map">Pick on the map</button></div>' +
      '<div class="ps-map" hidden><div class="ps-map-canvas" role="application" aria-label="Map: tap or click a point to place the site; drag the pin to move it"></div>' +
      '<p class="note">Tap a point to place the site, then drag the pin to adjust it. Streets: OpenStreetMap. Satellite: Esri.</p></div>' +
      '<p class="ps-status" aria-live="polite"></p>' +
      '<fieldset class="ps-radius" hidden><legend>Market area</legend>' + RADII.map(function (m) {
        return '<label><input type="radio" name="ps-r" value="' + m + '"> ' + (m ? 'Census tracts whose centre is within ' + m + ' miles' : 'The whole county') + '</label>';
      }).join('') + '</fieldset>' +
      '<div class="actions"><button type="button" class="button-link" data-ps="use" disabled>Use this site</button>' +
      '<button type="button" class="button-link secondary" data-ps="cancel">Cancel</button></div>' +
      '<p class="note ps-privacy">Your location is read once, only when you press “Use my location”, and is never tracked. ' +
      'The county, town and nearby census tracts are worked out in this browser from COHO’s own files; the point is not sent to COHO or to a lookup service. ' +
      'Nothing is saved unless you use the site in a project. The map’s tiles come from OpenStreetMap or Esri, who can see roughly which area the map shows.</p>' +
      '</div>';
    doc.body.appendChild(d);
    return d;
  }

  function openPicker(callback, o) {
    o = o || {};
    if (open) open.finish(null);
    var d = build(), status = d.querySelector('.ps-status'), useBtn = d.querySelector('[data-ps="use"]');
    var radius = RADII.indexOf(+o.radius) > -1 ? +o.radius : 5, point = null, found = null, map = null, marker = null, done = false, seq = 0;
    d.querySelector('input[name="ps-r"][value="' + radius + '"]').checked = true;
    function say(t) { status.textContent = t; }
    function finish(result) {
      if (done) return;
      done = true;
      open = null;
      if (map) { try { map.remove(); } catch (e) { /* already gone */ } }
      if (d.open) d.close();
      if (d.parentNode) d.parentNode.removeChild(d);
      callback(result);
    }
    function show() {
      if (!point) return;
      var mine = ++seq;
      useBtn.disabled = true;
      say('Finding the county and town…');
      describe(point.lat, point.lon, radius, point.source).then(function (r) {
        if (mine !== seq || done) return;
        if (r.outside) { found = null; say('That point is outside Colorado. COHO covers Colorado only: pick a point inside the state.'); d.querySelector('.ps-radius').hidden = true; return; }
        found = r;
        d.querySelector('.ps-radius').hidden = false;
        say('Site: ' + (r.placeLabel ? r.placeLabel + ', ' : '') + r.countyName + (r.placeLabel ? '' : ', outside any town') + ' (' + r.lat.toFixed(5) + ', ' + r.lon.toFixed(5) + '). ' +
          r.areaLabel + ': ' + r.tracts.length + (r.tracts.length === 1 ? ' census tract.' : ' census tracts.') +
          (r.tracts.length ? '' : ' Choose a wider market area below.'));
        useBtn.disabled = !r.tracts.length;
      }, function () {
        if (mine !== seq || done) return;
        say('The boundary files did not load. Check the connection and try again.');
      });
    }
    function place(lat, lon, source, zoom) {
      point = { lat: lat, lon: lon, source: source };
      if (map) {
        if (marker) marker.setLatLng([lat, lon]); else addMarker(lat, lon);
        if (zoom) map.setView([lat, lon], Math.max(map.getZoom(), 13));
      }
      show();
    }
    function addMarker(lat, lon) {
      var L = global.L;
      marker = L.marker([lat, lon], { draggable: true, keyboard: true, title: 'Site', alt: 'Site pin',
        icon: L.divIcon({ className: 'ps-pin', html: '<span aria-hidden="true"></span>', iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(map);
      marker.on('dragend', function () { var p = marker.getLatLng(); point = { lat: p.lat, lon: p.lng, source: 'map' }; show(); });
    }
    function showMap() {
      var box = d.querySelector('.ps-map');
      box.hidden = false;
      if (map) { map.invalidateSize(); return Promise.resolve(); }
      say('Loading the map…');
      return needLeaflet().then(function (L) {
        if (done) return;
        map = L.map(box.querySelector('.ps-map-canvas'), { zoomControl: true, tap: true }).setView(point ? [point.lat, point.lon] : [39.0, -105.55], point ? 13 : 6);
        var streets = L.tileLayer(OSM.url, { attribution: OSM.attribution, maxZoom: OSM.maxZoom }).addTo(map);
        var sat = L.tileLayer(SAT.url, { attribution: SAT.attribution, maxZoom: SAT.maxZoom });
        L.control.layers({ Streets: streets, Satellite: sat }, null, { collapsed: false }).addTo(map);
        if (L.control.scale) L.control.scale({ imperial: true, metric: false }).addTo(map);
        if (point) addMarker(point.lat, point.lon);
        map.on('click', function (e) { place(e.latlng.lat, e.latlng.lng, 'map', false); });
        setTimeout(function () { if (map) map.invalidateSize(); }, 50);
        if (!point) say('Tap a point on the map.');
      }, function () { say('The map did not load. Use your location instead, or try again.'); });
    }
    function locate() {
      var geo = global.navigator && global.navigator.geolocation;
      if (!geo) { say('This browser cannot share a location. Pick on the map instead.'); return; }
      if (global.isSecureContext === false) { say('Location needs a secure (https) page. Pick on the map instead.'); return; }
      say('Asking this device for its location…');
      geo.getCurrentPosition(function (pos) {
        if (done) return;
        place(pos.coords.latitude, pos.coords.longitude, 'device', true);
      }, function (err) {
        if (done) return;
        say(err && err.code === 1 ? 'Location is blocked for this site. Allow it in the browser’s settings, or pick on the map.'
          : 'The location could not be read. Try again outside or near a window, or pick on the map.');
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    }
    d.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-ps]');
      if (!b) return;
      var what = b.getAttribute('data-ps');
      if (what === 'locate') locate();
      else if (what === 'map') showMap();
      else if (what === 'cancel') finish(null);
      else if (what === 'use' && found) finish(found);
    });
    d.addEventListener('change', function (ev) {
      if (ev.target.name !== 'ps-r') return;
      radius = +ev.target.value;
      show();
    });
    d.addEventListener('cancel', function (ev) { ev.preventDefault(); finish(null); });
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    open = { finish: finish };
    // Start loading the boundary files now, so the answer is quick once a point is placed.
    files().catch(function () { /* said when a point is placed */ });
    if (o.mode === 'locate') locate();
    else if (o.mode === 'map') showMap();
    return { close: function () { finish(null); } };
  }

  global.LabPickSite = { open: openPicker, describe: describe, inGeom: inGeom };
})(window);
