/**
 * co-lihtc-map.js — Colorado Deep Dive Leaflet map (standalone, no bundler required)
 * Depends on: js/vendor/leaflet.js loaded before this script.
 * Exports: window.coLihtcMap — the Leaflet map instance (set after initialization).
 */
(function () {
  'use strict';

  // ── Fallback embedded data (used when HUD ArcGIS APIs are unreachable) ──────
  var FALLBACK_LIHTC = {type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9903,39.7392]},properties:{PROJECT:'Lincoln Park Apartments',PROJ_CTY:'Denver',N_UNITS:120,YR_PIS:2018,CREDIT:'9%',CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9748,39.7519]},properties:{PROJECT:'Curtis Park Lofts',PROJ_CTY:'Denver',N_UNITS:72,YR_PIS:2016,CREDIT:'9%',CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9875,39.7281]},properties:{PROJECT:'Baker Senior Residences',PROJ_CTY:'Denver',N_UNITS:55,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9620,39.7617]},properties:{PROJECT:'Five Points Commons',PROJ_CTY:'Denver',N_UNITS:96,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8851,39.6784]},properties:{PROJECT:'Aurora Family Commons',PROJ_CTY:'Aurora',N_UNITS:150,YR_PIS:2021,CREDIT:'4%',CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8325,39.6950]},properties:{PROJECT:'Aurora Senior Village',PROJ_CTY:'Aurora',N_UNITS:90,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2705,40.0150]},properties:{PROJECT:'Boulder Commons',PROJ_CTY:'Boulder',N_UNITS:100,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Boulder'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8214,38.8339]},properties:{PROJECT:'Springs Family Village',PROJ_CTY:'Colorado Springs',N_UNITS:130,YR_PIS:2018,CREDIT:'9%',CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0844,40.5853]},properties:{PROJECT:'Fort Collins Commons',PROJ_CTY:'Fort Collins',N_UNITS:104,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Larimer'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6914,40.4233]},properties:{PROJECT:'Greeley Flats',PROJ_CTY:'Greeley',N_UNITS:90,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6091,38.2544]},properties:{PROJECT:'Pueblo Senior Manor',PROJ_CTY:'Pueblo',N_UNITS:80,YR_PIS:2017,CREDIT:'9%',CNTY_NAME:'Pueblo'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5506,39.0639]},properties:{PROJECT:'Grand Junction Crossroads',PROJ_CTY:'Grand Junction',N_UNITS:85,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Mesa'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,39.6433]},properties:{PROJECT:'Eagle Valley Workforce Housing',PROJ_CTY:'Eagle',N_UNITS:50,YR_PIS:2022,CREDIT:'9%',CNTY_NAME:'Eagle'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8801,37.2753]},properties:{PROJECT:'Durango Commons',PROJ_CTY:'Durango',N_UNITS:62,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'La Plata'}},
  ]};

  // ── Status helper ────────────────────────────────────────────────────────────
  function updateStatus(message) {
    var el = document.getElementById('map-status') || document.getElementById('status');
    if (el) el.textContent = message;
  }

  // ── Fetch with timeout ───────────────────────────────────────────────────────
  function fetchWithTimeout(url, options, timeout) {
    timeout = timeout || 5000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeout);
    var merged = Object.assign({}, options || {}, { signal: ctrl.signal });
    return fetch(url, merged).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ── Data validation ──────────────────────────────────────────────────────────
  function validateData(data) {
    if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      return data.features.length > 0;
    }
    return Array.isArray(data) && data.length > 0;
  }

  // ── Render markers ───────────────────────────────────────────────────────────
  function renderData(map, data) {
    // Accept both GeoJSON FeatureCollection and plain arrays
    var features = (data && data.type === 'FeatureCollection' && Array.isArray(data.features))
      ? data.features
      : (Array.isArray(data) ? data : []);
    features.forEach(function (item) {
      var coords, props;
      if (item && item.type === 'Feature' && item.geometry && item.geometry.type === 'Point') {
        // GeoJSON: coordinates are [lng, lat]
        coords = [item.geometry.coordinates[1], item.geometry.coordinates[0]];
        props = item.properties || {};
      } else if (item && item.coordinates) {
        coords = item.coordinates;
        props = {};
      } else {
        console.warn('[co-lihtc-map] Invalid item (no coordinates):', item);
        return;
      }
      var tooltip = null;
      if (props.PROJECT) {
        tooltip = props.PROJECT;
        if (props.PROJ_CTY)  tooltip += ', ' + props.PROJ_CTY;
        if (props.CNTY_NAME && props.CNTY_NAME !== props.PROJ_CTY)
          tooltip += ' (' + props.CNTY_NAME + ' Co.)';
        if (props.N_UNITS)   tooltip += ' — ' + props.N_UNITS + ' units';
        if (props.LI_UNITS && Number(props.LI_UNITS) !== Number(props.N_UNITS))
          tooltip += ' (' + props.LI_UNITS + ' low-income)';
        if (props.CREDIT)    tooltip += ' \u2022 ' + props.CREDIT + ' credit';
        if (props.YR_PIS)    tooltip += ' \u2014 ' + props.YR_PIS;
      }
      var marker = L.marker(coords).addTo(map);
      if (tooltip) marker.bindTooltip(tooltip);
    });
  }

  // ── Fetch data: local JSON → CHFA ArcGIS → HUD ArcGIS → embedded fallback ──
  function fetchData(map) {
    // Local pre-fetched file (written by scripts/fetch-chfa-lihtc.js via CI).
    var LOCAL_URL = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl('data/chfa-lihtc.json')
      : 'data/chfa-lihtc.json';

    // Live ArcGIS endpoints — used only when the local file is absent/stale.
    var CHFA_URL = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0/query';
    var HUD_URL  = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0/query';
    // Filter to Colorado (PROJ_ST = 'CO') — the service holds national HUD data.
    var CHFA_PARAMS = 'where=PROJ_ST%3D%27CO%27&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000';
    // HUD dataset is national — filter to Colorado (FIPS 08).
    var HUD_PARAMS  = 'where=STATEFP%3D%2708%27&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000';

    updateStatus('Loading LIHTC data…');

    function useEmbedded() {
      renderData(map, FALLBACK_LIHTC);
      updateStatus('Source: embedded fallback');
    }

    function useHUD() {
      return fetchWithTimeout(HUD_URL + '?' + HUD_PARAMS, {}, 8000)
        .then(function (res) {
          if (!res.ok) throw new Error('HUD HTTP ' + res.status);
          return res.json();
        })
        .then(function (hudData) {
          if (validateData(hudData)) {
            renderData(map, hudData);
            updateStatus('Source: HUD ArcGIS');
          } else {
            console.warn('[co-lihtc-map] HUD returned no features; using embedded fallback.');
            useEmbedded();
          }
        })
        .catch(function (hudErr) {
          console.warn('[co-lihtc-map] HUD fetch also failed; using embedded fallback.', hudErr.message);
          useEmbedded();
        });
    }

    function useCHFA() {
      return fetchWithTimeout(CHFA_URL + '?' + CHFA_PARAMS, {}, 8000)
        .then(function (res) {
          if (!res.ok) throw new Error('CHFA HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (validateData(data)) {
            renderData(map, data);
            updateStatus('Source: CHFA ArcGIS');
          } else {
            console.warn('[co-lihtc-map] CHFA returned no features; trying HUD.');
            return useHUD();
          }
        })
        .catch(function (err) {
          console.warn('[co-lihtc-map] CHFA fetch failed; trying HUD.', err.message);
          return useHUD();
        });
    }

    // 1. Try local pre-fetched JSON first (avoids CORS / availability issues).
    fetchWithTimeout(LOCAL_URL, {}, 5000)
      .then(function (res) {
        if (!res.ok) throw new Error('Local HTTP ' + res.status);
        return res.json();
      })
      .then(function (localData) {
        if (validateData(localData)) {
          renderData(map, localData);
          updateStatus('Source: local CHFA data');
        } else {
          console.warn('[co-lihtc-map] Local file empty; trying CHFA ArcGIS.');
          return useCHFA();
        }
      })
      .catch(function (localErr) {
        console.warn('[co-lihtc-map] Local file unavailable; trying CHFA ArcGIS.', localErr.message);
        return useCHFA();
      });
  }

  // ── Map initialization ───────────────────────────────────────────────────────
  function initMap() {
    if (typeof L === 'undefined') {
      console.error('[co-lihtc-map] Leaflet (L) is not defined. Ensure js/vendor/leaflet.js loads before this script.');
      updateStatus('Map unavailable — Leaflet failed to load.');
      return null;
    }

    var mapEl = document.getElementById('coMap') || document.getElementById('map');
    if (!mapEl) {
      console.error('[co-lihtc-map] Map container element not found.');
      return null;
    }

    // Fix vendored marker icon paths
    if (L.Icon && L.Icon.Default) {
      L.Icon.Default.mergeOptions({
        iconUrl:       'js/vendor/images/marker-icon.png',
        iconRetinaUrl: 'js/vendor/images/marker-icon-2x.png',
        shadowUrl:     'js/vendor/images/marker-shadow.png'
      });
    }

    try {
      var map = L.map(mapEl).setView([39.5501, -105.7821], 7);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      updateStatus('Map ready.');
      console.info('[co-lihtc-map] Map initialized on', mapEl.id || mapEl.tagName);

      // Expose map globally so map-overlay.js and other scripts can use it
      window.coLihtcMap = map;

      fetchData(map);
      return map;
    } catch (err) {
      console.error('[co-lihtc-map] Map initialization error:', err);
      updateStatus('Map failed to initialize.');
      return null;
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMap);
  } else {
    initMap();
  }
}());