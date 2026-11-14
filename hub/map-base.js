// Background map for every zoomable lab map (paul's map rule, 11 Nov 2026; map review, 14 Nov 2026).
// The lab draws its maps as SVG in its own frame, which left a zoomed-in map with dots and county lines on a blank
// background: no streets, roads or towns to find a site by. This file puts a real map under each one:
//
//   - the OpenStreetMap street map by default, credited and linked on the map;
//   - a Satellite choice (Esri World Imagery), and the choice holds across maps and visits;
//   - Esri World Street Map stands in for any street tile that fails to load;
//   - a scale bar in miles that follows the zoom.
//
// Tiles are HTML images laid under the SVG, not SVG images, so each one can carry referrerpolicy="origin": the
// member site sends no Referer by default, and OpenStreetMap refuses tiles without one. Street tiles use the one
// host OSM's tile policy names, tile.openstreetmap.org, which HA's _headers image policy allows for the member site.
//
// The tiles are Web Mercator and the lab's maps are plain equirectangular, so each tile is placed on its own
// corners. Inside one tile the two differ by a pixel or two, so streets sit under the dots they belong to at every
// zoom. A map says where it is with data-geo="west south east north" (degrees at its base viewBox corners); a map
// in the statewide frame from site/map-kit.js (720 x 531 from 0 0) needs nothing. site/map-zoom.js calls attach()
// for every map it makes zoomable, and fires 'mapzoom' on each zoom or pan, which redraws the tiles.
// It reads no data and changes no figures.
(function (global) {
  'use strict';

  var doc = global.document;
  var OSM_COPY = 'https://www.openstreetmap.org/copyright';
  var BASES = {
    street: {
      label: 'Streets',
      // OSM's tile policy asks for this one host (https://operations.osmfoundation.org/policies/tiles/).
      url: function (z, x, y) { return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png'; },
      credit: 'Map © <a href="' + OSM_COPY + '" rel="noopener">OpenStreetMap</a> contributors',
      max: 19
    },
    satellite: {
      label: 'Satellite',
      url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x; },
      // Credits are the services' own copyrightText (MapServer?f=json, read 14 Nov 2026).
      credit: 'Imagery © <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" rel="noopener">Esri</a>. Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      max: 19
    }
  };
  var BACKUP = {
    url: function (z, x, y) { return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/' + z + '/' + y + '/' + x; },
    credit: 'some tiles © <a href="https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af" rel="noopener">Esri</a>. Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community'
  };
  var KEY = 'coho-map-base';
  var MAX_TILES = 64;
  var maps = [];

  function chosen() {
    try { return global.localStorage.getItem(KEY) === 'satellite' ? 'satellite' : 'street'; } catch (_) { return 'street'; }
  }
  function remember(b) { try { global.localStorage.setItem(KEY, b); } catch (_) { /* the choice holds for this page only */ } }

  // ---------- where the map is ----------
  // B: the map's base viewBox { x, y, w, h }. Returns the lon/lat at its corners, or null for a map with no place.
  function geoOf(svg, B) {
    var a = (svg.getAttribute('data-geo') || '').trim().split(/[\s,]+/).map(Number);
    if (a.length === 4 && a.every(isFinite) && a[2] > a[0] && a[3] > a[1]) return { w: a[0], s: a[1], e: a[2], n: a[3] };
    var K = global.LabMap;
    if (K && B.x === 0 && B.y === 0 && Math.abs(B.w - K.W) < 0.01 && Math.abs(B.h - K.H) < 0.01) return { w: K.BOX.w, s: K.BOX.s, e: K.BOX.e, n: K.BOX.n };
    return null;
  }
  function toMap(m, lon, lat) {
    return [m.B.x + (lon - m.g.w) / (m.g.e - m.g.w) * m.B.w, m.B.y + (m.g.n - lat) / (m.g.n - m.g.s) * m.B.h];
  }
  function toLonLat(m, X, Y) {
    return [m.g.w + (X - m.B.x) / m.B.w * (m.g.e - m.g.w), m.g.n - (Y - m.B.y) / m.B.h * (m.g.n - m.g.s)];
  }

  // ---------- tiles ----------
  function mercY(lat, n) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n; }
  function tileLat(y, n) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI; }
  function tileLon(x, n) { return x / n * 360 - 180; }

  // The tiles covering view vb (viewBox units) drawn px screen pixels wide: the zoom whose tile pixels match the
  // screen's (at up to 2x for sharp screens), stepped down until no more than MAX_TILES cover the view.
  function tileSet(m, vb, px, ratio, top) {
    var a = toLonLat(m, vb.x, vb.y), b = toLonLat(m, vb.x + vb.w, vb.y + vb.h);
    a[1] = Math.min(85, a[1]); b[1] = Math.max(-85, b[1]);
    var lonPerPx = (b[0] - a[0]) / Math.max(1, px * (ratio || 1));
    var z = Math.max(3, Math.min(top || 19, Math.ceil(Math.log(360 / (256 * lonPerPx)) / Math.LN2)));
    var n, x0, x1, y0, y1;
    for (;; z--) {
      n = Math.pow(2, z);
      x0 = Math.floor((a[0] + 180) / 360 * n); x1 = Math.floor((b[0] + 180) / 360 * n);
      y0 = Math.floor(mercY(a[1], n)); y1 = Math.floor(mercY(b[1], n));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TILES || z <= 3) break;
    }
    var out = [];
    for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) {
      var p0 = toMap(m, tileLon(tx, n), tileLat(ty, n)), p1 = toMap(m, tileLon(tx + 1, n), tileLat(ty + 1, n));
      out.push({ z: z, x: tx, y: ty, x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1] });
    }
    return out;
  }

  // The SVG's drawn area inside its frame, in CSS pixels (the viewBox is fitted with xMidYMid meet).
  function area(m) {
    var r = m.svg.getBoundingClientRect(), f = m.frame.getBoundingClientRect(), vb = m.svg.viewBox.baseVal;
    if (!r.width || !vb || !vb.width) return null;
    var s = Math.min(r.width / vb.width, r.height / vb.height);
    var w = vb.width * s, h = vb.height * s;
    return { left: r.left - f.left + (r.width - w) / 2, top: r.top - f.top + (r.height - h) / 2, w: w, h: h, vb: { x: vb.x, y: vb.y, w: vb.width, h: vb.height } };
  }

  function draw(m) {
    var A = area(m);
    if (!A) return;
    var box = m.layer.style;
    box.left = A.left.toFixed(2) + 'px'; box.top = A.top.toFixed(2) + 'px';
    box.width = A.w.toFixed(2) + 'px'; box.height = A.h.toFixed(2) + 'px';
    var base = chosen(), B = BASES[base], vb = A.vb, kx = A.w / vb.w, ky = A.h / vb.h;
    var tiles = tileSet(m, vb, A.w, Math.min(2, global.devicePixelRatio || 1), B.max);
    var keep = {};
    tiles.forEach(function (t) {
      var id = base + '/' + t.z + '/' + t.x + '/' + t.y;
      keep[id] = true;
      var img = m.imgs[id];
      if (!img) {
        img = doc.createElement('img');
        img.className = 'mb-tile';
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'origin';
        img.setAttribute('referrerpolicy', 'origin');
        img.draggable = false;
        img.setAttribute('data-base', base);
        img.setAttribute('data-z', t.z); img.setAttribute('data-x', t.x); img.setAttribute('data-y', t.y);
        img.onerror = onError;
        img.src = B.url(t.z, t.x, t.y);
        m.imgs[id] = img;
        m.layer.appendChild(img);
      }
      // Half a pixel of overlap on each side hides hairline seams between tiles.
      var s = img.style;
      s.left = ((t.x0 - vb.x) * kx - 0.5).toFixed(2) + 'px';
      s.top = ((t.y0 - vb.y) * ky - 0.5).toFixed(2) + 'px';
      s.width = ((t.x1 - t.x0) * kx + 1).toFixed(2) + 'px';
      s.height = ((t.y1 - t.y0) * ky + 1).toFixed(2) + 'px';
    });
    Object.keys(m.imgs).forEach(function (id) {
      if (keep[id]) return;
      m.layer.removeChild(m.imgs[id]);
      delete m.imgs[id];
    });
    m.layer.setAttribute('data-base', base);
    scaleBar(m, A);
  }

  // A street tile that fails comes from Esri's World Street Map instead, and the credit says so.
  function onError() {
    var img = this;
    if (img.getAttribute('data-backup')) return;
    img.setAttribute('data-backup', '1');
    if (img.getAttribute('data-base') !== 'street') { img.style.visibility = 'hidden'; return; }
    img.src = BACKUP.url(+img.getAttribute('data-z'), +img.getAttribute('data-x'), +img.getAttribute('data-y'));
    var frame = img.closest('.pm-frame'), c = frame && frame.querySelector('.mb-credit');
    if (c && !c.getAttribute('data-backup')) { c.setAttribute('data-backup', '1'); c.innerHTML = BASES.street.credit + '; ' + BACKUP.credit; }
  }

  // ---------- scale bar ----------
  var STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200];
  function scaleBar(m, A) {
    var mid = toLonLat(m, A.vb.x + A.vb.w / 2, A.vb.y + A.vb.h / 2);
    var milesPerPx = (A.vb.w / A.w) / m.B.w * (m.g.e - m.g.w) * 69.17 * Math.cos(mid[1] * Math.PI / 180);
    var want = 90 * milesPerPx, pick = STEPS[0];
    STEPS.forEach(function (s) { if (s <= want) pick = s; });
    var px = pick / milesPerPx;
    m.scale.querySelector('.mb-scale-bar').style.width = px.toFixed(1) + 'px';
    m.scale.querySelector('.mb-scale-label').textContent = pick + (pick <= 1 ? ' mile' : ' miles');
  }

  // ---------- attach ----------
  function switchHtml() {
    var on = chosen();
    return Object.keys(BASES).map(function (k) {
      return '<button type="button" data-mb-base="' + k + '" aria-pressed="' + (k === on) + '">' + BASES[k].label + '</button>';
    }).join('');
  }

  // o.fixed: a map that does not zoom (the Denver close-up) gets the tiles, credit and scale bar but no switch of
  // its own; the switch on the state map above it changes both.
  function attach(svg, B, o) {
    if (!svg || svg.__mapBase) return null;
    var frame = svg.closest && svg.closest('.pm-frame');
    if (!frame) return null;
    B = B || (function (v) { return { x: v.x, y: v.y, w: v.width, h: v.height }; })(svg.viewBox.baseVal);
    var g = geoOf(svg, B);
    if (!g) return null;
    svg.__mapBase = true;
    var m = { svg: svg, frame: frame, B: B, g: g, imgs: {} };
    m.layer = doc.createElement('div');
    m.layer.className = 'mb-tiles';
    m.layer.setAttribute('aria-hidden', 'true');
    frame.insertBefore(m.layer, frame.firstChild);
    m.picker = doc.createElement('div');
    m.picker.className = 'mb-switch';
    m.picker.setAttribute('role', 'group');
    m.picker.setAttribute('aria-label', 'Background map');
    m.picker.innerHTML = switchHtml();
    if (o && o.fixed) m.picker.hidden = true;
    else frame.insertBefore(m.picker, svg);
    m.credit = doc.createElement('p');
    m.credit.className = 'mb-credit';
    m.credit.innerHTML = BASES[chosen()].credit;
    frame.appendChild(m.credit);
    m.scale = doc.createElement('div');
    m.scale.className = 'mb-scale';
    m.scale.setAttribute('aria-hidden', 'true');
    m.scale.innerHTML = '<span class="mb-scale-bar"></span><span class="mb-scale-label"></span>';
    frame.appendChild(m.scale);
    frame.classList.add('mb-frame');
    svg.classList.add('mb-on');
    maps.push(m);
    draw(m);
    if (typeof global.ResizeObserver === 'function') {
      var queued = false;
      new global.ResizeObserver(function () {
        if (queued) return; queued = true;
        (global.requestAnimationFrame || setTimeout)(function () { queued = false; draw(m); });
      }).observe(svg);
    }
    return m;
  }

  function redrawAll() {
    maps = maps.filter(function (m) { return m.svg.isConnected !== false && doc.contains(m.svg); });
    maps.forEach(function (m) {
      Object.keys(m.imgs).forEach(function (id) { m.layer.removeChild(m.imgs[id]); });
      m.imgs = {};
      m.credit.removeAttribute('data-backup');
      m.credit.innerHTML = BASES[chosen()].credit;
      Array.prototype.forEach.call(m.picker.querySelectorAll('[data-mb-base]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mb-base') === chosen())); });
      draw(m);
    });
  }

  if (doc && doc.addEventListener) {
    doc.addEventListener('mapzoom', function (ev) {
      var svg = ev.target;
      for (var i = 0; i < maps.length; i++) if (maps[i].svg === svg) { draw(maps[i]); return; }
    });
    // Street map or Satellite: every map on the page changes together, and the choice is kept for the next visit.
    doc.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-mb-base]');
      if (!b || !BASES[b.getAttribute('data-mb-base')]) return;
      remember(b.getAttribute('data-mb-base'));
      redrawAll();
    });
  }

  global.LabMapBase = { attach: attach, geoOf: geoOf, tileSet: tileSet, BASES: BASES, BACKUP: BACKUP, chosen: chosen, KEY: KEY };
})(typeof window !== 'undefined' ? window : this);
