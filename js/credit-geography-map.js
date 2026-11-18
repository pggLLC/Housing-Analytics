/**
 * js/credit-geography-map.js — the county map in the research brief
 * "Where Colorado's housing tax credits go" (co-tax-credit-geography-2016-2026).
 *
 *   CreditGeographyMap.render(mountEl) → Promise<'ok' | 'unavailable'>
 *
 * Reads data/policy/credit-geography.json (built by
 * scripts/policy/build_credit_geography_brief.mjs) and
 * data/boundaries/counties_co.geojson. Shades each county by its index: its
 * share of Colorado's 9% credit divided by its share of renter households
 * paying 50%+ of income (1.0 = the state rate). Counties with fewer than
 * MIN_SEVERE such renters are hatched grey, because one award swings them.
 * Streets are OpenStreetMap with a Satellite switch (js/config/basemaps.js).
 * Absence is never a blank map: a missing file or Leaflet renders "Map unavailable".
 */
(function (root) {
  'use strict';

  var DATA = 'data/policy/credit-geography.json';
  var COUNTIES = 'data/boundaries/counties_co.geojson';
  var MIN_SEVERE = 500;
  // One hue, light to dark (colour-blind safe). Bins match the legend.
  var BINS = [
    { max: 0.0001, color: '#f1f5f9', label: 'No 9% award' },
    { max: 0.5, color: '#deebf7', label: 'Under 0.5' },
    { max: 1, color: '#9ecae1', label: '0.5 to 1' },
    { max: 2, color: '#6baed6', label: '1 to 2' },
    { max: 4, color: '#2171b5', label: '2 to 4' },
    { max: Infinity, color: '#08306b', label: '4 or more' }
  ];
  var SMALL = '#cbd5e1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function musd(n) { return '$' + (Number(n || 0) / 1e6).toFixed(2) + 'M'; }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function colorFor(c) {
    if (!c) return SMALL;
    if (c.renters_paying_half < MIN_SEVERE) return c.awards_9 ? SMALL : BINS[0].color;
    for (var i = 0; i < BINS.length; i++) if (c.index_9 < BINS[i].max) return BINS[i].color;
    return BINS[BINS.length - 1].color;
  }
  function tip(c) {
    if (!c) return '';
    return '<strong>' + esc(c.name) + ' County</strong> · ' + esc(c.region) + '<br>' +
      fmt(c.renters_paying_half) + ' renter households paying 50%+ of income<br>' +
      '9%: ' + fmt(c.awards_9) + ' awards, ' + fmt(c.homes_9) + ' homes, ' + musd(c.credit_9) + ' credit (yearly amounts)<br>' +
      '4%: ' + fmt(c.awards_4) + ' awards, ' + fmt(c.homes_4) + ' homes<br>' +
      (c.renters_paying_half >= MIN_SEVERE
        ? 'Index ' + Number(c.index_9).toFixed(1) + ' (Colorado = 1.0)'
        : 'Too few renters paying 50%+ for an index');
  }

  function unavailable(mount, why) {
    mount.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'brief-note';
    p.textContent = 'Map unavailable. ' + why + ' The county table below has every figure.';
    p.setAttribute('data-cgm-state', 'unavailable');
    mount.appendChild(p);
    return 'unavailable';
  }

  function render(mount) {
    var L = root.L;
    if (!mount) return Promise.resolve('unavailable');
    if (!L) return Promise.resolve(unavailable(mount, 'The map library did not load.'));
    return Promise.all([getJSON(DATA), getJSON(COUNTIES)]).then(function (d) {
      var data = d[0], shapes = d[1];
      var byFips = {};
      data.counties.forEach(function (c) { byFips[c.fips] = c; });
      var legend = BINS.map(function (b) {
        return '<li><span aria-hidden="true" style="display:inline-block;width:14px;height:12px;background:' + b.color +
          ';border:1px solid #94a3b8;margin-right:.35rem;vertical-align:-1px"></span>' + esc(b.label) + '</li>';
      }).join('') +
        '<li><span aria-hidden="true" style="display:inline-block;width:14px;height:12px;background:' + SMALL +
        ';border:1px solid #94a3b8;margin-right:.35rem;vertical-align:-1px"></span>Fewer than ' + fmt(MIN_SEVERE) + ' renters paying 50%+ (no index)</li>';
      mount.innerHTML =
        '<div class="cgm__map" role="region" aria-label="Map of Colorado counties shaded by 9% tax credit for each renter household paying half its income" ' +
          'style="height:min(70vh,460px);min-height:320px;width:100%;border-radius:8px;border:1px solid var(--border,#d0d7de);"></div>' +
        '<p class="brief-note" style="margin:.5rem 0 .25rem">Index: share of 9% credit divided by share of renters paying 50%+ of income (Colorado = 1.0)</p>' +
        '<ul class="cgm__legend" style="list-style:none;padding:0;margin:0;display:flex;gap:.75rem;flex-wrap:wrap;font-size:.9rem">' + legend + '</ul>';
      var el = mount.querySelector('.cgm__map');
      var map = L.map(el, { scrollWheelZoom: false, tap: false, zoomSnap: 0.25 });
      map.setView([39.0, -105.5], 6);
      if (root.COHOBasemaps && root.COHOBasemaps.standard) root.COHOBasemaps.standard(map);
      var drawn = 0;
      var layer = L.geoJSON(shapes, {
        style: function (f) {
          return { color: '#ffffff', weight: 1, opacity: 1, fillColor: colorFor(byFips[f.properties.GEOID]), fillOpacity: 0.85 };
        },
        onEachFeature: function (f, l) {
          var c = byFips[f.properties.GEOID];
          if (c) drawn++;
          l.bindTooltip(tip(c), { sticky: true, direction: 'top', opacity: 0.97 });
          l.bindPopup(tip(c), { maxWidth: 300 });
        }
      }).addTo(map);
      map.fitBounds(layer.getBounds().pad(0.02));
      if (root.ResizeObserver) new root.ResizeObserver(function () { map.invalidateSize(); }).observe(el);
      else setTimeout(function () { map.invalidateSize(); }, 0);
      mount.setAttribute('data-cgm-state', 'ok');
      mount.setAttribute('data-cgm-counties', String(drawn));
      return 'ok';
    }).catch(function (e) { return unavailable(mount, e.message + '.'); });
  }

  root.CreditGeographyMap = { render: render, DATA: DATA, MIN_SEVERE: MIN_SEVERE, colorFor: colorFor };
})(typeof window !== 'undefined' ? window : this);
