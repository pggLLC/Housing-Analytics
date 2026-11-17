/**
 * js/chfa-round-two-map.js — the map in the CHFA 2026 Round Two research brief.
 *
 *   ChfaRoundTwoMap.render(mountEl) → Promise<'ok' | 'unavailable'>
 *
 * Reads data/affordable-housing/chfa-awards/2026-round-two.json (awards and the
 * applications not awarded, each with its CHFA address point) and
 * data/boundaries/counties_co.geojson (county lines). Draws:
 *   - awards as filled dots, applications not awarded as dashed rings, sized by homes;
 *   - county lines, named on hover;
 *   - a tooltip on hover and a popup on tap for every dot, with the figures CHFA prints.
 * Streets are OpenStreetMap with a Satellite switch (js/config/basemaps.js).
 * Absence is never a blank map: a missing file or Leaflet renders "Map unavailable".
 */
(function (root) {
  'use strict';

  var DATA = 'data/affordable-housing/chfa-awards/2026-round-two.json';
  var COUNTIES = 'data/boundaries/counties_co.geojson';
  var AMI = ['30', '40', '50', '60', '70', '80'];
  var METRO = [[39.33, -105.36], [40.10, -104.70]];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function radius(units) { return Math.max(6, Math.sqrt(units) * 0.9); }
  function where(x) {
    return x.city === 'Denver' && x.county !== 'Denver'
      ? 'Denver address, ' + x.county + ' County'
      : x.city + ', ' + x.county + ' County';
  }

  function awardTip(a) {
    var state = (a.accelerated_state_credit || 0) + (a.standard_state_credit || 0) + (a.toc_credit || 0);
    var mix = AMI.filter(function (b) { return a.ami_mix && a.ami_mix[b]; })
      .map(function (b) { return a.ami_mix[b] + ' at ' + b + '%'; }).join(', ');
    return '<strong>' + esc(a.name) + '</strong><br>' +
      'Awarded · ' + esc(where(a)) + '<br>' +
      esc(a.total_units) + ' rental homes<br>' +
      'Income limits (AMI): ' + esc(mix) + '<br>' +
      'Federal 4% credit ' + usd(a.federal_4pct_credit) + ' a year · state credits ' + usd(state) + ' a year<br>' +
      'Sponsor: ' + esc(a.sponsor) +
      (a.earlier_tries ? '<br>' + esc(a.earlier_tries) + ' Won on reapplying.' : '');
  }
  function lostTip(a) {
    var asked = (a.accelerated_state_requested || 0) + (a.standard_state_requested || 0) + (a.toc_requested || 0);
    return '<strong>' + esc(a.name) + '</strong><br>' +
      'Not awarded · ' + esc(where(a)) + '<br>' +
      esc(a.total_units) + ' rental homes asked · ' + esc(a.building_type) + '<br>' +
      'Asked: federal 4% ' + usd(a.federal_4pct_requested) + ' a year · state credits ' + usd(asked) + ' a year<br>' +
      'Sponsor: ' + esc(a.sponsor) +
      (a.geo_precision === 'city_centroid' ? '<br>Placed at the town centre (address not matched).' : '') +
      (a.geo_precision === 'intersection' ? '<br>Placed at the intersection CHFA lists.' : '') +
      (a.earlier_tries ? '<br>' + esc(a.earlier_tries) : '');
  }

  function unavailable(mount, why) {
    mount.innerHTML = '';
    var p = document.createElement('p');
    p.className = 'brief-note';
    p.textContent = 'Map unavailable. ' + why + ' The tables below list every award and application.';
    p.setAttribute('data-crt-state', 'unavailable');
    mount.appendChild(p);
    return 'unavailable';
  }

  function render(mount) {
    var L = root.L;
    if (!mount) return Promise.resolve('unavailable');
    if (!L) return Promise.resolve(unavailable(mount, 'The map library did not load.'));
    return Promise.all([getJSON(DATA), getJSON(COUNTIES)]).then(function (d) {
      var data = d[0], counties = d[1];
      mount.innerHTML =
        '<div class="crt-tools" style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.25rem 0 .5rem">' +
          '<button type="button" class="btn btn-secondary" data-crt-view="state">All of Colorado</button>' +
          '<button type="button" class="btn btn-secondary" data-crt-view="metro">Metro Denver</button>' +
        '</div>' +
        '<div class="crt__map" role="region" aria-label="Map of CHFA 2026 Round Two awards and applications not awarded" ' +
          'style="height:min(70vh,460px);min-height:320px;width:100%;border-radius:8px;border:1px solid var(--border,#d0d7de);"></div>' +
        '<ul class="crt__legend" style="list-style:none;padding:0;margin:.5rem 0 0;display:flex;gap:1rem;flex-wrap:wrap;font-size:.9rem">' +
          '<li><span aria-hidden="true" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#0f6b5c;margin-right:.35rem;vertical-align:-1px"></span>Awarded (' + data.awards.length + ')</li>' +
          '<li><span aria-hidden="true" style="display:inline-block;width:12px;height:12px;border-radius:50%;border:2px dashed #8a5a00;margin-right:.35rem;vertical-align:-2px"></span>Applied, not awarded (' + data.not_awarded.length + ')</li>' +
          '<li><span aria-hidden="true" style="display:inline-block;width:18px;border-top:2px solid #334155;margin-right:.35rem;vertical-align:4px"></span>County line</li>' +
        '</ul>';
      var el = mount.querySelector('.crt__map');
      var map = L.map(el, { scrollWheelZoom: false, tap: false, zoomSnap: 0.25 });
      // A view first: Leaflet draws vector layers only on a map that has one.
      map.setView([39.0, -105.5], 6);
      if (root.COHOBasemaps && root.COHOBasemaps.standard) root.COHOBasemaps.standard(map);
      L.geoJSON(counties, {
        style: { color: '#334155', weight: 1.6, opacity: 0.8, fillColor: '#334155', fillOpacity: 0.02 },
        onEachFeature: function (f, layer) {
          layer.bindTooltip(esc((f.properties && f.properties.NAMELSAD) || ''), { sticky: true, direction: 'top', opacity: 0.9 });
        }
      }).addTo(map);
      var dots = [];
      function dot(x, html, awarded) {
        var m = L.circleMarker([x.lat, x.lon], awarded
          ? { radius: radius(x.total_units), color: '#ffffff', weight: 1.5, fillColor: '#0f6b5c', fillOpacity: 0.9 }
          : { radius: radius(x.total_units), color: '#8a5a00', weight: 2, dashArray: '4,3', fillColor: '#ffffff', fillOpacity: 0.55 });
        m.bindTooltip(html, { direction: 'top', opacity: 0.97 });
        m.bindPopup(html, { maxWidth: 300 });
        m.addTo(map);
        if (awarded) m.bringToFront();
        dots.push(m);
        return m;
      }
      data.not_awarded.forEach(function (a) { if (isFinite(a.lat) && isFinite(a.lon)) dot(a, lostTip(a), false); });
      data.awards.forEach(function (a) { if (isFinite(a.lat) && isFinite(a.lon)) dot(a, awardTip(a), true); });
      var all = L.featureGroup(dots).getBounds().pad(0.08);
      map.fitBounds(all);
      mount.querySelectorAll('[data-crt-view]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.getAttribute('data-crt-view') === 'metro') map.fitBounds(METRO); else map.fitBounds(all);
        });
      });
      mount.setAttribute('data-crt-state', 'ok');
      mount.setAttribute('data-crt-dots', String(dots.length));
      return 'ok';
    }).catch(function (e) { return unavailable(mount, e.message + '.'); });
  }

  root.ChfaRoundTwoMap = { render: render, DATA: DATA };
})(typeof window !== 'undefined' ? window : this);
