/**
 * js/commuting.js
 * The public "Commuting and Jobs" page (commuting.html).
 *
 * Reads data/market/commute-strength.json (scripts/market/build_commute_strength.py,
 * LEHD LODES 2023) and data/market/principal-employers.json (curated from audit filings).
 * Towns are dots sized by jobs and shaded by the share of their jobs held by people who
 * drive 20 to 60 straight-line miles in. Tapping a town shows its numbers and draws lines
 * from the towns that send it the most workers.
 */
(function (global) {
  'use strict';

  var COMMUTE = 'data/market/commute-strength.json';
  var EMPLOYERS = 'data/market/principal-employers.json';
  var COUNTIES = 'data/co-county-boundaries.json';
  var CO_BOUNDS = [[36.99, -109.06], [41.0, -102.04]];

  // IRS standard mileage rate from 1 July 2026 (Announcement 2026-11). The full cost of a car,
  // so a cost built on it is the high end per mile; distances are straight-line, so the miles are a floor.
  var IRS_RATE = 0.76;
  var WORKDAYS = 240;

  // Share of a town's jobs held by people driving 20-60 miles in. Okabe-Ito order, light to strong.
  var BINS = [
    { max: 0.05, color: '#cfe8f3', label: 'Under 5%' },
    { max: 0.15, color: '#56b4e9', label: '5 to 15%' },
    { max: 0.25, color: '#e69f00', label: '15 to 25%' },
    { max: Infinity, color: '#d55e00', label: '25% or more' }
  ];

  var doc = global.document;
  function $(sel) { return doc.querySelector(sel); }
  function int(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function money(n) { return '$' + (Math.round(n / 10) * 10).toLocaleString('en-US'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(url) {
    return global.fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  }
  function farShare(p) { return p.jobs ? p.far / p.jobs : 0; }
  function binFor(share) { for (var i = 0; i < BINS.length; i++) if (share < BINS[i].max) return BINS[i]; return BINS[BINS.length - 1]; }

  /** One plain sentence for a town: the first useful answer. */
  function answer(p) {
    var s = esc(p.name) + ': ' + int(p.in_commuters) + ' of its ' + int(p.jobs) + ' jobs (' + pct(p.in_commuters, p.jobs) +
      ') are held by people who live somewhere else. ' + int(p.far) + ' of them live 20 to 60 miles away';
    if (p.median_far_miles) s += ', a drive that costs about ' + money(2 * p.median_far_miles * WORKDAYS * IRS_RATE) + ' a year at the typical distance';
    return s + '.';
  }

  function detail(p) {
    var cost = p.median_far_miles ? money(2 * p.median_far_miles * WORKDAYS * IRS_RATE) : null;
    var h = '<h3>' + esc(p.name) + '</h3><ul class="cj-stats">' +
      '<li><b>' + int(p.jobs) + '</b>jobs in town (primary jobs)</li>' +
      '<li><b>' + pct(p.in_commuters, p.jobs) + '</b>held by people who live elsewhere (' + int(p.in_commuters) + ')</li>' +
      '<li><b>' + int(p.far) + '</b>drive in from 20 to 60 miles; ' + int(p.far_low) + ' of them earn $3,333 a month or less</li>' +
      (cost ? '<li><b>' + cost + '</b>a year for a typical 20 to 60 mile commuter (' + p.median_far_miles + ' miles each way, straight line, 240 days, IRS rate)</li>' : '') +
      '<li><b>' + int(p.long) + '</b>recorded 60+ miles away; many are not daily trips, so they are not costed</li>' +
      '<li><b>' + pct(p.out_commuters, p.residents) + '</b>of working residents work in another Colorado town (' + int(p.out_commuters) + ' of ' + int(p.residents) + ')</li>' +
      '</ul><div class="cj-flows">' +
      '<div><h4>Where its in-commuters live</h4><ol>' + p.from.map(function (f) { return '<li>' + esc(f[0]) + ': ' + int(f[1]) + '</li>'; }).join('') + '</ol></div>' +
      '<div><h4>Where its residents work</h4><ol>' + p.to.map(function (f) { return '<li>' + esc(f[0]) + ': ' + int(f[1]) + '</li>'; }).join('') + '</ol></div>' +
      '</div>';
    return h;
  }

  function sourceLine(meta) {
    return 'Source: U.S. Census Bureau, LEHD LODES ' + esc(meta.lodes_year) + ' origin-destination file, primary jobs (<a href="' + esc(meta.source) +
      '">co_od_main_JT01_' + esc(meta.lodes_year) + '</a>), home block to work block; built ' + esc(meta.generated) + '. Straight-line miles. Cost at the IRS rate of 76 cents a mile from 1 July 2026, 240 workdays.';
  }

  function initMap(el) {
    var L = global.L;
    if (!L || !el) return null;
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 });
    map.fitBounds(CO_BOUNDS, { padding: [8, 8] });
    var dark = doc.documentElement.getAttribute('data-theme') === 'dark';
    var base = global.COHOBasemaps ? (dark ? global.COHOBasemaps.dark() : global.COHOBasemaps.light()) : null;
    if (base) base.addTo(map);
    if (typeof L.geoJSON === 'function') {
      getJSON(COUNTIES).then(function (gj) {
        L.geoJSON(gj, { interactive: false, style: { color: dark ? '#8b98a8' : '#6b7787', weight: 1, opacity: 0.7, fill: false } }).addTo(map);
      }).catch(function () { /* the dots still show without county lines */ });
    }
    // The box can settle after the first fit (fonts, phone toolbars). Refit to the state until the reader moves the map.
    var moved = false;
    map.on('mousedown touchstart', function () { moved = true; });
    map.markMoved = function () { moved = true; };
    if (typeof global.ResizeObserver === 'function') {
      try {
        new global.ResizeObserver(function () { map.invalidateSize(); if (!moved) map.fitBounds(CO_BOUNDS, { padding: [8, 8] }); }).observe(el);
      } catch (e) { /* first size kept */ }
    }
    return map;
  }

  function boot(data) {
    var places = data.places || {};
    var list = Object.keys(places).map(function (k) { var p = places[k]; p.geoid = k; return p; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var byName = {};
    list.forEach(function (p) { byName[p.name.toLowerCase()] = p; });
    // Names carry their kind, "Silverthorne (town)"; a reader who types "Silverthorne" still finds it.
    list.forEach(function (p) {
      var bare = p.name.replace(/\s*\([^)]*\)$/, '').toLowerCase();
      if (!(bare in byName)) byName[bare] = p;
    });

    $('[data-cj-source]').innerHTML = sourceLine(data.meta);
    $('[data-cj-legend]').innerHTML = '<span>Share of jobs held by people driving 20 to 60 miles in:</span>' +
      BINS.map(function (b) { return '<span><i style="background:' + b.color + '"></i>' + b.label + '</span>'; }).join('');
    $('#cjTowns').innerHTML = list.map(function (p) { return '<option value="' + esc(p.name) + '">'; }).join('');
    $('[data-cj-answer]').textContent = 'Tap a town, or search for one. ' + int(list.length) + ' towns with 200 or more jobs are shown.';

    var map = initMap($('#cjMap'));
    var L = global.L;
    var flowLayer = map ? L.layerGroup().addTo(map) : null;
    var detailEl = $('[data-cj-detail]');

    function select(p, fromMap) {
      $('[data-cj-answer]').textContent = answer(p);
      detailEl.innerHTML = detail(p);
      detailEl.hidden = false;
      if (!fromMap) $('#cjSearch').value = p.name;
      if (!flowLayer) return;
      flowLayer.clearLayers();
      var max = p.from.length ? p.from[0][1] : 1;
      p.from.forEach(function (f) {
        var o = byName[String(f[0]).toLowerCase()];
        if (!o) return;
        L.polyline([[o.lat, o.lon], [p.lat, p.lon]], { color: '#cc79a7', weight: 2 + 8 * f[1] / max, opacity: 0.85, interactive: false }).addTo(flowLayer);
      });
      map.markMoved();
      map.panTo([p.lat, p.lon]);
    }

    if (map) {
      list.slice().sort(function (a, b) { return b.jobs - a.jobs; }).forEach(function (p) {
        var b = binFor(farShare(p));
        L.circleMarker([p.lat, p.lon], {
          radius: Math.max(5, Math.min(18, 2 + Math.sqrt(p.jobs) / 18)),
          color: '#333', weight: 1, fillColor: b.color, fillOpacity: 0.9
        }).bindTooltip(esc(p.name)).on('click', function () { select(p, true); }).addTo(map);
      });
    }

    $('#cjSearch').addEventListener('change', function () {
      var p = byName[this.value.trim().toLowerCase()];
      if (p) select(p, false);
    });
  }

  function employers(data) {
    var areas = (data && data.areas) || [];
    var sel = $('[data-cj-area]');
    sel.innerHTML = areas.map(function (a, i) { return '<option value="' + i + '">' + esc(a.area) + ' (' + esc(a.as_of) + ')</option>'; }).join('');
    function show(i) {
      var a = areas[i];
      if (!a) return;
      $('[data-cj-emp]').innerHTML = a.rows.map(function (r) {
        return '<tr><td class="n">' + (r.rank == null ? '' : esc(r.rank)) + '</td><td>' + esc(r.employer) + '</td><td class="n">' + esc(r.employees) + '</td></tr>';
      }).join('');
      var s = a.source;
      $('[data-cj-emp-source]').innerHTML = 'Source: ' + esc(s.filer) + ', annual financial report filed with the Office of the State Auditor (' +
        '<a href="' + esc(s.url) + '">PDF</a>' + (s.pdf_page ? ', PDF page ' + esc(s.pdf_page) : '') + '), "Principal Employers", ' + esc(a.as_of) +
        '. Its source: ' + esc(a.stated_source) + '.';
    }
    sel.addEventListener('change', function () { show(Number(this.value)); });
    show(0);
  }

  function start() {
    if (!$('[data-commuting]')) return;
    getJSON(COMMUTE).then(boot).catch(function (e) {
      $('[data-cj-answer]').textContent = 'The commute data did not load. Reload the page to try again.';
      if (global.console) global.console.warn(e);
    });
    getJSON(EMPLOYERS).then(employers).catch(function () {
      $('[data-cj-emp]').innerHTML = '<tr><td colspan="3">The employer tables did not load.</td></tr>';
    });
  }

  if (typeof module === 'object' && module.exports) module.exports = { answer: answer, binFor: binFor, IRS_RATE: IRS_RATE, WORKDAYS: WORKDAYS };
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  }
}(typeof window !== 'undefined' ? window : this));
