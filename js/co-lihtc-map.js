/**
 * co-lihtc-map.js — Colorado Deep Dive Leaflet map (standalone, no bundler required)
 * Depends on: js/vendor/leaflet.js loaded before this script.
 * Exports: window.coLihtcMap — the Leaflet map instance (set after initialization).
 */
(function () {
  'use strict';

  // ── Layer references (for checkbox toggles) ──────────────────────────────────
  var lihtcLayerGroup = null;
  var ddaLayerGroup   = null;
  var qctLayerGroup   = null;

  // ── Fallback DDA polygon data ────────────────────────────────────────────────
  var FALLBACK_DDA = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Aurora Metro DDA',DDA_NAME:'Denver-Aurora-Lakewood HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-105.15,39.55],[-104.67,39.55],[-104.67,39.98],[-105.15,39.98],[-105.15,39.55]]]}},
    {type:'Feature',properties:{NAME:'Boulder-Broomfield DDA',DDA_NAME:'Boulder HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-105.35,39.95],[-104.98,39.95],[-104.98,40.15],[-105.35,40.15],[-105.35,39.95]]]}},
    {type:'Feature',properties:{NAME:'Fort Collins DDA',DDA_NAME:'Fort Collins HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-105.20,40.52],[-104.98,40.52],[-104.98,40.66],[-105.20,40.66],[-105.20,40.52]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs DDA',DDA_NAME:'Colorado Springs HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-105.19,38.69],[-104.60,38.69],[-104.60,39.08],[-105.19,39.08],[-105.19,38.69]]]}},
    {type:'Feature',properties:{NAME:'Greeley DDA',DDA_NAME:'Greeley HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-104.90,40.28],[-104.55,40.28],[-104.55,40.55],[-104.90,40.55],[-104.90,40.28]]]}},
    {type:'Feature',properties:{NAME:'Eagle County DDA',DDA_NAME:'Edwards HUD Metro FMR Area (Eagle County)'},geometry:{type:'Polygon',coordinates:[[[-107.18,39.44],[-106.29,39.44],[-106.29,39.74],[-107.18,39.74],[-107.18,39.44]]]}},
    {type:'Feature',properties:{NAME:'Summit County DDA',DDA_NAME:'Summit County HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-106.38,39.38],[-105.73,39.38],[-105.73,39.66],[-106.38,39.66],[-106.38,39.38]]]}},
    {type:'Feature',properties:{NAME:'Pitkin County DDA (Aspen)',DDA_NAME:'Aspen HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-107.26,39.12],[-106.68,39.12],[-106.68,39.38],[-107.26,39.38],[-107.26,39.12]]]}},
    {type:'Feature',properties:{NAME:'San Miguel County DDA (Telluride)',DDA_NAME:'San Miguel County HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-108.20,37.82],[-107.38,37.82],[-107.38,38.15],[-108.20,38.15],[-108.20,37.82]]]}},
    {type:'Feature',properties:{NAME:'Routt County DDA (Steamboat)',DDA_NAME:'Routt County HUD Metro FMR Area'},geometry:{type:'Polygon',coordinates:[[[-107.28,40.25],[-106.46,40.25],[-106.46,40.74],[-107.28,40.74],[-107.28,40.25]]]}},
  ]};

  // ── Fallback QCT polygon data ────────────────────────────────────────────────
  var FALLBACK_QCT = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Globeville QCT',GEOID:'08031006700'},geometry:{type:'Polygon',coordinates:[[[-105.000,39.772],[-104.940,39.772],[-104.940,39.790],[-105.000,39.790],[-105.000,39.772]]]}},
    {type:'Feature',properties:{NAME:'Denver-Five Points QCT',GEOID:'08031007700'},geometry:{type:'Polygon',coordinates:[[[-104.982,39.745],[-104.940,39.745],[-104.940,39.768],[-104.982,39.768],[-104.982,39.745]]]}},
    {type:'Feature',properties:{NAME:'Denver-Sun Valley QCT',GEOID:'08031006800'},geometry:{type:'Polygon',coordinates:[[[-105.010,39.720],[-104.975,39.720],[-104.975,39.740],[-105.010,39.740],[-105.010,39.720]]]}},
    {type:'Feature',properties:{NAME:'Denver-Montbello QCT',GEOID:'08031004601'},geometry:{type:'Polygon',coordinates:[[[-104.955,39.760],[-104.910,39.760],[-104.910,39.810],[-104.955,39.810],[-104.955,39.760]]]}},
    {type:'Feature',properties:{NAME:'Denver-Westwood QCT',GEOID:'08031007400'},geometry:{type:'Polygon',coordinates:[[[-105.050,39.680],[-104.995,39.680],[-104.995,39.718],[-105.050,39.718],[-105.050,39.680]]]}},
    {type:'Feature',properties:{NAME:'Aurora-Colfax QCT',GEOID:'08005011020'},geometry:{type:'Polygon',coordinates:[[[-104.900,39.720],[-104.840,39.720],[-104.840,39.750],[-104.900,39.750],[-104.900,39.720]]]}},
    {type:'Feature',properties:{NAME:'Aurora-East QCT',GEOID:'08005011800'},geometry:{type:'Polygon',coordinates:[[[-104.840,39.686],[-104.780,39.686],[-104.780,39.710],[-104.840,39.710],[-104.840,39.686]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs-Downtown QCT',GEOID:'08041003200'},geometry:{type:'Polygon',coordinates:[[[-104.851,38.820],[-104.800,38.820],[-104.800,38.858],[-104.851,38.858],[-104.851,38.820]]]}},
    {type:'Feature',properties:{NAME:'Pueblo-Downtown QCT',GEOID:'08101000300'},geometry:{type:'Polygon',coordinates:[[[-104.635,38.238],[-104.580,38.238],[-104.580,38.278],[-104.635,38.278],[-104.635,38.238]]]}},
    {type:'Feature',properties:{NAME:'Greeley QCT',GEOID:'08123000500'},geometry:{type:'Polygon',coordinates:[[[-104.730,40.404],[-104.670,40.404],[-104.670,40.440],[-104.730,40.440],[-104.730,40.404]]]}},
    {type:'Feature',properties:{NAME:'Grand Junction QCT',GEOID:'08077000200'},geometry:{type:'Polygon',coordinates:[[[-108.590,39.048],[-108.530,39.048],[-108.530,39.085],[-108.590,39.085],[-108.590,39.048]]]}},
    {type:'Feature',properties:{NAME:'Alamosa QCT',GEOID:'08003000600'},geometry:{type:'Polygon',coordinates:[[[-105.910,37.454],[-105.848,37.454],[-105.848,37.490],[-105.910,37.490],[-105.910,37.454]]]}},
    {type:'Feature',properties:{NAME:'Trinidad QCT',GEOID:'08071000500'},geometry:{type:'Polygon',coordinates:[[[-104.590,37.160],[-104.520,37.160],[-104.520,37.192],[-104.590,37.192],[-104.590,37.160]]]}},
    {type:'Feature',properties:{NAME:'Cañon City QCT',GEOID:'08043000500'},geometry:{type:'Polygon',coordinates:[[[-105.260,38.427],[-105.200,38.427],[-105.200,38.456],[-105.260,38.456],[-105.260,38.427]]]}},
  ]};

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

  // ── Render LIHTC markers as red circle markers ───────────────────────────────
  function renderData(map, data) {
    // Accept both GeoJSON FeatureCollection and plain arrays
    var features = (data && data.type === 'FeatureCollection' && Array.isArray(data.features))
      ? data.features
      : (Array.isArray(data) ? data : []);

    if (lihtcLayerGroup) { lihtcLayerGroup.clearLayers(); }
    else { lihtcLayerGroup = L.layerGroup(); }
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
        if (props.N_UNITS)   tooltip += ' \u2014 ' + props.N_UNITS + ' units';
        if (props.LI_UNITS && Number(props.LI_UNITS) !== Number(props.N_UNITS))
          tooltip += ' (' + props.LI_UNITS + ' low-income)';
        if (props.CREDIT)    tooltip += ' \u2022 ' + props.CREDIT + ' credit';
        if (props.YR_PIS)    tooltip += ' \u2014 ' + props.YR_PIS;
      }
      var safe = function(v) { return (v == null || v === '') ? '\u2014' : String(v); };
      var popupHtml = '<div style="min-width:200px;font-size:13px">' +
        '<div style="font-weight:700;margin-bottom:4px">' + safe(props.PROJECT) + '</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
        '<tr><td style="opacity:.7">City</td><td style="text-align:right">' + safe(props.PROJ_CTY) + '</td></tr>' +
        '<tr><td style="opacity:.7">County</td><td style="text-align:right">' + safe(props.CNTY_NAME) + '</td></tr>' +
        '<tr><td style="opacity:.7">Total units</td><td style="text-align:right">' + safe(props.N_UNITS) + '</td></tr>' +
        '<tr><td style="opacity:.7">LIHTC units</td><td style="text-align:right">' + safe(props.LI_UNITS) + '</td></tr>' +
        '<tr><td style="opacity:.7">Credit type</td><td style="text-align:right">' + safe(props.CREDIT) + '</td></tr>' +
        '<tr><td style="opacity:.7">Year placed in service</td><td style="text-align:right">' + safe(props.YR_PIS) + '</td></tr>' +
        '</table></div>';
      var marker = L.circleMarker(coords, {
        radius: 8,
        fillColor: '#e74c3c',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      });
      if (tooltip) marker.bindTooltip(tooltip);
      marker.bindPopup(popupHtml);
      lihtcLayerGroup.addLayer(marker);
    });

    var cbLihtc = document.getElementById('layerLIHTC') || document.getElementById('layerLihtc');
    var show = !cbLihtc || cbLihtc.checked !== false;
    if (show) lihtcLayerGroup.addTo(map);
  }

  // ── Render DDA (orange polygon) overlay ──────────────────────────────────────
  function renderDdaLayer(map, geojson) {
    if (ddaLayerGroup) { ddaLayerGroup.clearLayers(); }
    else { ddaLayerGroup = L.layerGroup(); }

    L.geoJSON(geojson, {
      style: {
        color: '#ff6f00',
        weight: 2,
        opacity: 0.8,
        fillColor: '#ff9800',
        fillOpacity: 0.17,
        dashArray: '6 4',
      },
      onEachFeature: function(f, layer) {
        var name = (f.properties && (f.properties.DDA_NAME || f.properties.NAME)) || 'Difficult Development Area';
        layer.bindTooltip('<strong>' + name + '</strong><br>30% basis boost eligible');
      },
    }).addTo(ddaLayerGroup);

    var cbDda = document.getElementById('layerDDA') || document.getElementById('layerDda');
    var show = !cbDda || cbDda.checked !== false;
    if (show) ddaLayerGroup.addTo(map);
  }

  // ── Render QCT (green polygon) overlay ───────────────────────────────────────
  function renderQctLayer(map, geojson) {
    if (qctLayerGroup) { qctLayerGroup.clearLayers(); }
    else { qctLayerGroup = L.layerGroup(); }

    L.geoJSON(geojson, {
      style: {
        color: '#388e3c',
        weight: 2,
        opacity: 0.8,
        fillColor: '#4caf50',
        fillOpacity: 0.17,
      },
      onEachFeature: function(f, layer) {
        var name = (f.properties && (f.properties.NAME || f.properties.GEOID)) || 'Qualified Census Tract';
        layer.bindTooltip('<strong>' + name + '</strong><br>QCT \u2014 30% basis boost eligible');
      },
    }).addTo(qctLayerGroup);

    var cbQct = document.getElementById('layerQCT') || document.getElementById('layerQct');
    var show = !cbQct || cbQct.checked !== false;
    if (show) qctLayerGroup.addTo(map);
  }

  // ── Wire layer toggle checkboxes ─────────────────────────────────────────────
  function wireToggles(map) {
    function bind(id, getLayer) {
      var cb = document.getElementById(id);
      if (!cb) return;
      cb.addEventListener('change', function() {
        var layer = getLayer();
        if (!layer) return;
        try {
          if (cb.checked && !map.hasLayer(layer)) { layer.addTo(map); }
          else if (!cb.checked && map.hasLayer(layer)) { map.removeLayer(layer); }
        } catch(e) { console.warn('[co-lihtc-map] Toggle failed:', e.message); }
      });
    }
    bind('layerLIHTC', function() { return lihtcLayerGroup; });
    bind('layerDDA',   function() { return ddaLayerGroup; });
    bind('layerQCT',   function() { return qctLayerGroup; });
    // filterQCT / filterDDA checkboxes — show only projects in QCT/DDA zones
    var cbFilterQct = document.getElementById('filterQCT');
    var cbFilterDda = document.getElementById('filterDDA');
    function applyProjectFilter() {
      if (!lihtcLayerGroup) return;
      var onlyQct = cbFilterQct && cbFilterQct.checked;
      var onlyDda = cbFilterDda && cbFilterDda.checked;
      lihtcLayerGroup.eachLayer(function(layer) {
        var p = (layer.feature && layer.feature.properties) || {};
        var inQct = Number(p.QCT) === 1;
        var inDda = Number(p.DDA) === 1;
        var visible = true;
        if (onlyQct && !inQct) visible = false;
        if (onlyDda && !inDda) visible = false;
        try {
          var el = layer.getElement ? layer.getElement() : null;
          if (el) el.style.display = visible ? '' : 'none';
        } catch(e) { /* ignore */ }
      });
    }
    if (cbFilterQct) cbFilterQct.addEventListener('change', applyProjectFilter);
    if (cbFilterDda) cbFilterDda.addEventListener('change', applyProjectFilter);
  }

  // ── Fetch data: local JSON (primary) → remote ArcGIS (only if local is missing/404) → embedded fallback ──
  function fetchData(map) {
    // Canonical local file — always tried first. Written by scripts/fetch-chfa-lihtc.js via CI.
    // resolveAssetUrl prepends the detected base path so the URL works on GitHub Pages sub-paths
    // (e.g. /Housing-Analytics/data/chfa-lihtc.json) as well as custom domains (/).
    var LOCAL_URL = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl('data/chfa-lihtc.json')
      : 'data/chfa-lihtc.json';

    // Remote ArcGIS endpoints — only attempted when the local file is absent (404).
    var CHFA_URL = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0/query';
    var HUD_URL  = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0/query';
    var CHFA_PARAMS = 'where=PROJ_ST%3D%27CO%27&outFields=*&f=geojson&outSR=4326&resultRecordCount=2000';
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

    // 1. Always try local data/chfa-lihtc.json first.
    fetchWithTimeout(LOCAL_URL, {}, 5000)
      .then(function (res) {
        // Attach HTTP status so the catch handler can distinguish 404 from other errors.
        if (!res.ok) {
          var err = new Error('Local HTTP ' + res.status);
          err.httpStatus = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (localData) {
        if (validateData(localData)) {
          renderData(map, localData);
          updateStatus('Source: local CHFA data');
        } else {
          // File exists but contains no features — likely an empty/incomplete CI run.
          // Do NOT fall back to remote; surface a clear message instead.
          console.warn('[co-lihtc-map] data/chfa-lihtc.json has no features. Check CI/deployment output.');
          updateStatus('LIHTC data file is empty. Check deployment — verify data/chfa-lihtc.json is populated.');
          useEmbedded();
        }
      })
      .catch(function (localErr) {
        if (localErr.httpStatus === 404) {
          // File not deployed yet — try remote ArcGIS APIs as fallback.
          console.warn('[co-lihtc-map] data/chfa-lihtc.json not found (404); trying CHFA ArcGIS.');
          return useCHFA();
        }
        // Any other error (network, parse, etc.) — the file may exist but be unreachable.
        // Surface a clear actionable message; do not attempt remote APIs.
        console.warn('[co-lihtc-map] Could not load data/chfa-lihtc.json:', localErr.message);
        updateStatus('LIHTC data unavailable. Verify data/chfa-lihtc.json is deployed (check GitHub Actions output).');
        useEmbedded();
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

      // Initialize layer groups
      lihtcLayerGroup = L.layerGroup();
      ddaLayerGroup   = L.layerGroup();
      qctLayerGroup   = L.layerGroup();

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);

      updateStatus('Map ready.');
      console.info('[co-lihtc-map] Map initialized on', mapEl.id || mapEl.tagName);

      // Expose map globally so map-overlay.js and other scripts can use it
      window.coLihtcMap = map;

      fetchData(map);
      renderDdaLayer(map, FALLBACK_DDA);
      renderQctLayer(map, FALLBACK_QCT);
      wireToggles(map);
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