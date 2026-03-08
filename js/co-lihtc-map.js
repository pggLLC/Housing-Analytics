/**
 * co-lihtc-map.js — Colorado Deep Dive Leaflet map (standalone, no bundler required)
 * Depends on: js/vendor/leaflet.js loaded before this script.
 * Exports: window.coLihtcMap — the Leaflet map instance (set after initialization).
 */
(function () {
  'use strict';

  // ── Layer references (for checkbox toggles) ──────────────────────────────────
  var lihtcLayerGroup   = null;
  var ddaLayerGroup     = null;
  var qctLayerGroup     = null;
  var countyLayerGroup  = null;

  // ── Basemap tile layer reference ─────────────────────────────────────────────
  var currentTileLayer = null;

  // ── Basemap tile definitions ─────────────────────────────────────────────────
  var TILE_DEFS = {
    light:      { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',   attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>' },
    dark:       { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>' },
    osm:        { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',               attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
    satellite:  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '&copy; Esri, Maxar, Earthstar Geographics' },
    'esri-gray':{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', attr: '&copy; Esri, HERE, DeLorme' },
  };

  // ── All 64 Colorado counties ──────────────────────────────────────────────────
  var CO_COUNTIES = [
    'Adams','Alamosa','Arapahoe','Archuleta','Baca','Bent','Boulder','Broomfield',
    'Chaffee','Cheyenne','Clear Creek','Conejos','Costilla','Crowley','Custer',
    'Delta','Denver','Dolores','Douglas','Eagle','El Paso','Elbert','Fremont',
    'Garfield','Gilpin','Grand','Gunnison','Hinsdale','Huerfano','Jackson',
    'Jefferson','Kiowa','Kit Carson','La Plata','Lake','Larimer','Las Animas',
    'Lincoln','Logan','Mesa','Mineral','Moffat','Montezuma','Montrose','Morgan',
    'Otero','Ouray','Park','Phillips','Pitkin','Prowers','Pueblo','Rio Blanco',
    'Rio Grande','Routt','Saguache','San Juan','San Miguel','Sedgwick','Summit',
    'Teller','Washington','Weld','Yuma',
  ];

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

  // ── Fallback county boundary data (approximate bounding-box polygons) ────────
  // Used only when all dynamic sources (local cache, TIGERweb, Natural Earth) fail.
  var FALLBACK_COUNTY = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Adams'},geometry:{type:'Polygon',coordinates:[[[-105.05,39.74],[-104.66,39.74],[-104.66,40.00],[-105.05,40.00],[-105.05,39.74]]]}},
    {type:'Feature',properties:{NAME:'Arapahoe'},geometry:{type:'Polygon',coordinates:[[[-104.97,39.56],[-104.67,39.56],[-104.67,39.91],[-104.97,39.91],[-104.97,39.56]]]}},
    {type:'Feature',properties:{NAME:'Boulder'},geometry:{type:'Polygon',coordinates:[[[-105.69,39.94],[-105.06,39.94],[-105.06,40.26],[-105.69,40.26],[-105.69,39.94]]]}},
    {type:'Feature',properties:{NAME:'Denver'},geometry:{type:'Polygon',coordinates:[[[-105.11,39.61],[-104.60,39.61],[-104.60,39.91],[-105.11,39.91],[-105.11,39.61]]]}},
    {type:'Feature',properties:{NAME:'Douglas'},geometry:{type:'Polygon',coordinates:[[[-105.33,39.13],[-104.67,39.13],[-104.67,39.64],[-105.33,39.64],[-105.33,39.13]]]}},
    {type:'Feature',properties:{NAME:'El Paso'},geometry:{type:'Polygon',coordinates:[[[-105.19,38.69],[-104.06,38.69],[-104.06,39.13],[-105.19,39.13],[-105.19,38.69]]]}},
    {type:'Feature',properties:{NAME:'Jefferson'},geometry:{type:'Polygon',coordinates:[[[-105.65,39.56],[-105.05,39.56],[-105.05,39.98],[-105.65,39.98],[-105.65,39.56]]]}},
    {type:'Feature',properties:{NAME:'Larimer'},geometry:{type:'Polygon',coordinates:[[[-106.19,40.26],[-105.06,40.26],[-105.06,41.00],[-106.19,41.00],[-106.19,40.26]]]}},
    {type:'Feature',properties:{NAME:'Mesa'},geometry:{type:'Polygon',coordinates:[[[-109.05,38.83],[-107.43,38.83],[-107.43,39.64],[-109.05,39.64],[-109.05,38.83]]]}},
    {type:'Feature',properties:{NAME:'Pueblo'},geometry:{type:'Polygon',coordinates:[[[-105.05,37.64],[-104.06,37.64],[-104.06,38.52],[-105.05,38.52],[-105.05,37.64]]]}},
    {type:'Feature',properties:{NAME:'Weld'},geometry:{type:'Polygon',coordinates:[[[-105.06,39.91],[-104.06,39.91],[-104.06,41.00],[-105.06,41.00],[-105.06,39.91]]]}},
    {type:'Feature',properties:{NAME:'Broomfield'},geometry:{type:'Polygon',coordinates:[[[-105.17,39.90],[-105.02,39.90],[-105.02,40.03],[-105.17,40.03],[-105.17,39.90]]]}},
    {type:'Feature',properties:{NAME:'Eagle'},geometry:{type:'Polygon',coordinates:[[[-107.18,39.34],[-106.18,39.34],[-106.18,39.76],[-107.18,39.76],[-107.18,39.34]]]}},
    {type:'Feature',properties:{NAME:'La Plata'},geometry:{type:'Polygon',coordinates:[[[-108.21,37.00],[-107.00,37.00],[-107.00,37.68],[-108.21,37.68],[-108.21,37.00]]]}},
    {type:'Feature',properties:{NAME:'Summit'},geometry:{type:'Polygon',coordinates:[[[-106.44,39.34],[-105.72,39.34],[-105.72,39.76],[-106.44,39.76],[-106.44,39.34]]]}},
  ]};

  // ── Status helper ────────────────────────────────────────────────────────────
  function updateStatus(message) {
    var el = document.getElementById('map-status') || document.getElementById('status');
    if (el) el.textContent = message;
    // Update loading indicator panel if present
    var loadingEl = document.getElementById('mapLoadingIndicator');
    var loadingText = document.getElementById('mapLoadingText');
    var loadingSpinner = document.getElementById('mapLoadingSpinner');
    if (loadingEl && loadingText) {
      loadingText.textContent = message;
      // Hide the loading indicator when data is ready
      var done = /Source:|ready|unavailable|failed/i.test(message);
      if (done) {
        loadingSpinner && (loadingSpinner.style.display = 'none');
        loadingEl.style.opacity = '0';
        loadingEl.style.transition = 'opacity .4s';
        setTimeout(function () { loadingEl.style.display = 'none'; }, 450);
      }
    }
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

  // ── Render county boundary (dark outline, no fill) overlay ──────────────────
  function renderCountyLayer(map, geojson) {
    if (countyLayerGroup) { countyLayerGroup.clearLayers(); }
    else { countyLayerGroup = L.layerGroup(); }

    var style = getCountyBoundaryStyle();
    L.geoJSON(geojson, {
      style: style,
      onEachFeature: function(f, layer) {
        var name = (f.properties && (f.properties.NAME || f.properties.NAMELSAD)) || 'County';
        layer.bindTooltip(name, { sticky: true });
      },
    }).addTo(countyLayerGroup);

    var cbCounty = document.getElementById('layerCounties') || document.getElementById('layerCounty');
    var show = !cbCounty || cbCounty.checked !== false;
    if (show) countyLayerGroup.addTo(map);
  }

  /** Returns Leaflet path style options using CSS custom properties when available. */
  function getCountyBoundaryStyle() {
    var computed = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
    var color  = (computed && computed.getPropertyValue('--map-boundary-stroke').trim()) || '#334155';
    var weight = parseFloat((computed && computed.getPropertyValue('--map-boundary-weight').trim()) || '1.5') || 1.5;
    return { color: color, weight: weight, opacity: 0.85, fillOpacity: 0 };
  }

  /** Re-applies theme-correct styles to the county boundary layer without re-fetching data. */
  function updateCountyBoundaryTheme() {
    if (!countyLayerGroup) return;
    var style = getCountyBoundaryStyle();
    countyLayerGroup.eachLayer(function(layer) {
      if (typeof layer.setStyle === 'function') {
        try { layer.setStyle(style); } catch(e) { /* ignore */ }
      }
    });
  }

  // ── Basemap switch ───────────────────────────────────────────────────────────
  function applyBasemap(map, name) {
    var def = TILE_DEFS[name] || TILE_DEFS.osm;
    if (currentTileLayer) {
      try { map.removeLayer(currentTileLayer); } catch(e) { /* ignore */ }
    }
    currentTileLayer = L.tileLayer(def.url, { maxZoom: 19, attribution: def.attr });
    currentTileLayer.addTo(map);
    try { sessionStorage.setItem('co-map-basemap', name); } catch(e) { /* ignore */ }
  }

  function wireBasemap(map) {
    var sel = document.getElementById('basemapSelect');
    if (!sel) return;

    // Resolve the initial basemap: saved > auto (light/dark by theme) > osm
    var saved = null;
    try { saved = sessionStorage.getItem('co-map-basemap'); } catch(e) { /* ignore */ }
    var isDark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark-mode');
    var initial = saved || (isDark ? 'dark' : 'light');

    // Set the <select> to match; fall back to "auto"
    if (sel.querySelector('option[value="' + initial + '"]')) {
      sel.value = initial;
    } else {
      sel.value = 'auto';
    }
    applyBasemap(map, initial);

    sel.addEventListener('change', function () {
      var val = sel.value;
      if (val === 'auto') {
        val = (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-mode')) ? 'dark' : 'light';
      }
      applyBasemap(map, val);
    });

    // Keep in sync when the site-wide dark/light toggle fires
    document.addEventListener('theme:changed', function () {
      if (sel.value === 'auto') {
        var dark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-mode');
        applyBasemap(map, dark ? 'dark' : 'light');
      }
      updateCountyBoundaryTheme();
    });

    // MutationObserver fallback: restyle county boundaries when the <html> or
    // <body> class changes (covers dark-mode toggles that don't fire theme:changed).
    if (typeof MutationObserver !== 'undefined') {
      var _themeObserver = new MutationObserver(function() {
        updateCountyBoundaryTheme();
      });
      _themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      _themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ── County dropdown — populate & zoom handler ─────────────────────────────────
  function wireCountyDropdown(map) {
    var el = document.getElementById('countyGeoSelect');
    if (!el) return;

    // Populate with all 64 Colorado counties if the dropdown is empty (only "All Colorado")
    if (el.options.length <= 1) {
      CO_COUNTIES.forEach(function (name) {
        var opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name + ' County';
        el.appendChild(opt);
      });
    }

    el.addEventListener('change', function () {
      var county = el.value;
      if (!county) {
        map.setView([39.5501, -105.7821], 7);
        return;
      }
      // Use Nominatim to get county bounding box and zoom
      var url = 'https://nominatim.openstreetmap.org/search?q=' +
        encodeURIComponent(county + ' County, Colorado, USA') +
        '&format=json&limit=1&countrycodes=us';
      fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'HousingAnalyticsCO/1.0' } })
        .then(function (r) { return r.json(); })
        .then(function (results) {
          if (!results || !results.length) return;
          var bb = results[0].boundingbox;
          if (bb) {
            map.fitBounds([
              [parseFloat(bb[0]), parseFloat(bb[2])],
              [parseFloat(bb[1]), parseFloat(bb[3])],
            ]);
          } else {
            map.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 10);
          }
        })
        .catch(function (e) {
          console.warn('[co-lihtc-map] County zoom failed:', e.message);
        });
    });
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
    bind('layerLIHTC',   function() { return lihtcLayerGroup; });
    bind('layerDDA',     function() { return ddaLayerGroup; });
    bind('layerQCT',     function() { return qctLayerGroup; });
    bind('layerCounties', function() { return countyLayerGroup; });
    bind('layerCounty',  function() { return countyLayerGroup; });
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

  // ── Dynamic county boundary source selection ──────────────────────────────────
  // Evaluates three sources in parallel and selects the fastest one that returns
  // exactly 64 Colorado county features.  Falls back to FALLBACK_COUNTY if all
  // sources fail or exceed the 5 000 ms timeout.
  function loadCountyBoundariesDynamic(map, resolveUrl) {
    var EXPECTED_FEATURES = 64;
    var SOURCE_TIMEOUT    = 5000; // ms

    var evalStart = Date.now();

    // Build one promise per source; each resolves to {name, geojson, elapsed} or rejects.
    function makeSourcePromise(name, fetcher) {
      var t0 = Date.now();
      return fetcher().then(function(gj) {
        var elapsed = Date.now() - t0;
        if (!gj || !Array.isArray(gj.features) || gj.features.length !== EXPECTED_FEATURES) {
          throw new Error(name + ': got ' + (gj && gj.features ? gj.features.length : 0) + ' features (need ' + EXPECTED_FEATURES + ')');
        }
        return { name: name, geojson: gj, elapsed: elapsed };
      });
    }

    // Source 1 — local cache
    function fetchLocal() {
      return fetchWithTimeout(resolveUrl('data/co-county-boundaries.json'), {}, SOURCE_TIMEOUT)
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        });
    }

    // Source 2 — Census TIGERweb ArcGIS REST (State_County layer 1, Colorado STATEFP=08)
    // Responses are cached in localStorage for 24 hours to avoid redundant round-trips
    // when data/co-county-boundaries.json is absent or empty.
    var TIGERWEB_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';
    var TIGERWEB_PARAMS = 'where=STATEFP%3D%2708%27&outFields=NAME%2CNAMELSAD%2CSTATEFP%2CCOUNTYFP%2CGEOID&f=geojson&outSR=4326';
    var TIGERWEB_CACHE_KEY = 'co-lihtc-map:tigerweb-co-counties';
    var TIGERWEB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
    function tWebCacheGet() {
      try {
        var raw = localStorage.getItem(TIGERWEB_CACHE_KEY);
        if (!raw) return null;
        var entry = JSON.parse(raw);
        if (!entry || !entry.ts || !entry.data) return null;
        if ((Date.now() - entry.ts) > TIGERWEB_CACHE_TTL) {
          localStorage.removeItem(TIGERWEB_CACHE_KEY);
          return null;
        }
        // Evict cache entries that don't have exactly 64 county features
        if (!Array.isArray(entry.data.features) || entry.data.features.length !== EXPECTED_FEATURES) {
          localStorage.removeItem(TIGERWEB_CACHE_KEY);
          return null;
        }
        return entry.data;
      } catch(e) { return null; }
    }
    function tWebCacheSet(gj) {
      // Only cache responses that contain exactly 64 Colorado county features
      if (!gj || !Array.isArray(gj.features) || gj.features.length !== EXPECTED_FEATURES) return;
      try {
        localStorage.setItem(TIGERWEB_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: gj }));
      } catch(e) { /* quota exceeded — ignore */ }
    }
    function fetchTIGERweb() {
      var cached = tWebCacheGet();
      if (cached) {
        console.info('[co-lihtc-map] County boundaries: TIGERweb served from 24h localStorage cache');
        return Promise.resolve(cached);
      }
      return fetchWithTimeout(TIGERWEB_URL + '?' + TIGERWEB_PARAMS, {}, SOURCE_TIMEOUT)
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(gj) {
          tWebCacheSet(gj);
          return gj;
        });
    }

    // Source 3 — Natural Earth 10m admin-2 boundaries filtered to Colorado (ADM1_CODE contains US-CO)
    var NATURAL_EARTH_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_2_counties.geojson';
    function fetchNaturalEarth() {
      return fetchWithTimeout(NATURAL_EARTH_URL, {}, SOURCE_TIMEOUT)
        .then(function(res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function(gj) {
          // Filter to Colorado counties only
          var coFeatures = (gj && gj.features ? gj.features : []).filter(function(f) {
            var p = f.properties || {};
            // code_hasc for US admin-2 features follows 'US.CO.XX' (not 'US.CO')
            // fips may be stored as a 4-digit integer (e.g. 8001) — pad before slicing
            return p.iso_3166_2 === 'US-CO' ||
                   String(p.code_hasc || '').slice(0, 5) === 'US.CO' ||
                   String(p.fips || '').padStart(5, '0').slice(0, 2) === '08' ||
                   String(p.STATEFP || p.statefp || '').padStart(2, '0') === '08';
          });
          return { type: 'FeatureCollection', features: coFeatures };
        });
    }

    var sources = [
      makeSourcePromise('local-cache', fetchLocal),
      makeSourcePromise('TIGERweb',   fetchTIGERweb),
      makeSourcePromise('NaturalEarth', fetchNaturalEarth),
    ];

    // Race: use the first source that resolves with valid data.
    // Track all results so we can log metrics even after the winner is found.
    var results = [];
    var settled = 0;
    var rendered = false;

    function onResult(result) {
      results.push({ name: result.name, elapsed: result.elapsed, features: result.geojson.features.length, ok: true });
      if (!rendered) {
        rendered = true;
        var totalElapsed = ((Date.now() - evalStart) / 1000).toFixed(1);
        console.info('[co-lihtc-map] County boundaries: evaluated ' + sources.length + ' source(s) in ' + totalElapsed + 's; selected ' + result.name + ' (' + (result.elapsed / 1000).toFixed(1) + 's, ' + result.geojson.features.length + ' features)');
        renderCountyLayer(map, result.geojson);
      }
    }

    function onSourceFail(name, err) {
      results.push({ name: name, elapsed: null, features: 0, ok: false, error: err.message });
      console.warn('[co-lihtc-map] County source "' + name + '" failed:', err.message);
    }

    function checkAllSettled() {
      settled++;
      if (settled === sources.length && !rendered) {
        // All sources failed — use embedded fallback
        var totalElapsed = ((Date.now() - evalStart) / 1000).toFixed(1);
        console.warn('[co-lihtc-map] County boundaries: all ' + sources.length + ' sources failed in ' + totalElapsed + 's; using embedded FALLBACK_COUNTY (' + FALLBACK_COUNTY.features.length + ' of 64 counties — partial coverage)');
        renderCountyLayer(map, FALLBACK_COUNTY);
      }
    }

    sources.forEach(function(promise, i) {
      var sourceName = ['local-cache', 'TIGERweb', 'NaturalEarth'][i];
      promise.then(function(result) {
        onResult(result);
        checkAllSettled();
      }).catch(function(err) {
        onSourceFail(sourceName, err);
        checkAllSettled();
      });
    });
  }

  // ── Fetch overlay data: local JSON → remote ArcGIS → embedded fallback ────────
  // Tries to load the local QCT and DDA cached files (written by the
  // cache-hud-gis-data.yml CI workflow) and render them.  Falls back to the
  // embedded FALLBACK_* constants only when the local files are absent or empty.
  function loadLocalOverlays(map) {
    var resolveUrl = typeof window.resolveAssetUrl === 'function'
      ? window.resolveAssetUrl
      : function(p) { return p; };

    // County boundaries — dynamic multi-source selection
    loadCountyBoundariesDynamic(map, resolveUrl);

    // QCT — try local cache first
    fetchWithTimeout(resolveUrl('data/qct-colorado.json'), {}, 15000)
      .then(function(res) {
        if (!res.ok) throw new Error('QCT HTTP ' + res.status);
        return res.json();
      })
      .then(function(gj) {
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
          renderQctLayer(map, gj);
          console.info('[co-lihtc-map] QCT loaded from local cache (' + gj.features.length + ' features).');
        } else {
          renderQctLayer(map, FALLBACK_QCT);
          console.warn('[co-lihtc-map] Local qct-colorado.json empty; using embedded fallback.');
        }
      })
      .catch(function(err) {
        console.warn('[co-lihtc-map] Local QCT cache unavailable; using embedded fallback.', err.message);
        renderQctLayer(map, FALLBACK_QCT);
      });

    // DDA — try local cache first
    fetchWithTimeout(resolveUrl('data/dda-colorado.json'), {}, 15000)
      .then(function(res) {
        if (!res.ok) throw new Error('DDA HTTP ' + res.status);
        return res.json();
      })
      .then(function(gj) {
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
          renderDdaLayer(map, gj);
          console.info('[co-lihtc-map] DDA loaded from local cache (' + gj.features.length + ' features).');
        } else {
          renderDdaLayer(map, FALLBACK_DDA);
          console.warn('[co-lihtc-map] Local dda-colorado.json empty; using embedded fallback.');
        }
      })
      .catch(function(err) {
        console.warn('[co-lihtc-map] Local DDA cache unavailable; using embedded fallback.', err.message);
        renderDdaLayer(map, FALLBACK_DDA);
      });
  }

  // ── Fetch all pages from an ArcGIS FeatureServer endpoint ───────────────────
  function fetchAllPages(baseUrl, baseParams, timeout) {
    var allFeatures = [];
    var pageSize = 1000;

    function fetchPage(offset) {
      var url = baseUrl + '?' + baseParams +
        '&resultOffset=' + offset + '&resultRecordCount=' + pageSize;
      return fetchWithTimeout(url, {}, timeout || 15000)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var features = (data && Array.isArray(data.features)) ? data.features : [];
          allFeatures = allFeatures.concat(features);
          // Fetch next page if server signalled more records exist
          if (features.length === pageSize && data.exceededTransferLimit) {
            return fetchPage(offset + pageSize);
          }
          return { type: 'FeatureCollection', features: allFeatures };
        });
    }

    return fetchPage(0);
  }

  // ── Fetch LIHTC data: CHFA ArcGIS → HUD ArcGIS → local JSON → embedded fallback ──
  function fetchData(map) {
    // Canonical local file — used as tier-3 fallback when both remote ArcGIS services fail.
    // resolveAssetUrl prepends the detected base path so the URL works on GitHub Pages sub-paths
    // (e.g. /Housing-Analytics/data/chfa-lihtc.json) as well as custom domains (/).
    var LOCAL_URL = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl('data/chfa-lihtc.json')
      : 'data/chfa-lihtc.json';

    // Primary ArcGIS LIHTC FeatureServer — all layers, Colorado only.
    // The /layers endpoint is used first to discover every available layer so that
    // no data layer is inadvertently skipped.
    var LIHTC_BASE   = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer';
    var LIHTC_LAYERS = LIHTC_BASE + '/layers?f=json';
    // Fallback: secondary HUD properties service (also Colorado-only via Proj_St='CO').
    var HUD_URL  = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0/query';
    // Shared WHERE clause: matches Colorado records regardless of how the state is stored
    // (abbreviation 'CO', FIPS '08', or full name 'Colorado').  Kept in sync with
    // scripts/lihtc-co-query.json which uses the same filter for the CI data fetch.
    var LIHTC_WHERE = 'where=Proj_St%3D%27CO%27%20OR%20Proj_St%3D%2708%27%20OR%20Proj_St%3D%27Colorado%27';

    updateStatus('Loading LIHTC data…');

    function useEmbedded() {
      renderData(map, FALLBACK_LIHTC);
      updateStatus('Source: embedded fallback (' + FALLBACK_LIHTC.features.length + ' projects)');
    }

    // Tier-3 fallback: load the committed local JSON snapshot (data/chfa-lihtc.json).
    // Called only when both CHFA and HUD ArcGIS services are unreachable.
    function fetchLocalLihtc() {
      updateStatus('Trying local LIHTC data…');
      return fetchWithTimeout(LOCAL_URL, {}, 15000)
        .then(function (res) {
          if (!res.ok) {
            var err = new Error('Local HTTP ' + res.status);
            err.httpStatus = res.status;
            throw err;
          }
          return res.json();
        })
        .then(function (localData) {
          if (validateData(localData)) {
            var n = localData.features.length;
            renderData(map, localData);
            updateStatus('Source: local backup (' + n + ' projects)');
          } else {
            console.warn('[co-lihtc-map] Local LIHTC file has no features; using embedded fallback.');
            useEmbedded();
          }
        })
        .catch(function (localErr) {
          console.warn('[co-lihtc-map] Local LIHTC file unavailable; using embedded fallback.', localErr.message);
          useEmbedded();
        });
    }

    function useHUD() {
      updateStatus('Trying HUD ArcGIS…');
      return fetchAllPages(HUD_URL, LIHTC_WHERE + '&outFields=*&f=geojson&outSR=4326', 15000)
        .then(function (hudData) {
          if (validateData(hudData)) {
            var n = hudData.features.length;
            renderData(map, hudData);
            updateStatus('Source: HUD ArcGIS (' + n + ' projects)');
          } else {
            console.warn('[co-lihtc-map] HUD returned no features; trying local LIHTC file.');
            return fetchLocalLihtc();
          }
        })
        .catch(function (hudErr) {
          console.warn('[co-lihtc-map] HUD fetch also failed; trying local LIHTC file.', hudErr.message);
          return fetchLocalLihtc();
        });
    }

    /**
     * Fetch all Colorado LIHTC records from every layer of the FeatureServer.
     * First discovers available layers via the /layers endpoint, then queries
     * each layer using the shared LIHTC_WHERE clause to filter to Colorado only.
     */
    function useCHFA() {
      updateStatus('Fetching LIHTC layers…');
      return fetchWithTimeout(LIHTC_LAYERS, {}, 15000)
        .then(function (res) {
          if (!res.ok) throw new Error('Layers HTTP ' + res.status);
          return res.json();
        })
        .then(function (layersMeta) {
          var layers = (Array.isArray(layersMeta.layers) ? layersMeta.layers : []).concat(
            Array.isArray(layersMeta.tables) ? layersMeta.tables : []
          );
          if (!layers.length) {
            // Service didn't advertise layers — fall back to layer 0
            console.warn('[co-lihtc-map] /layers returned no layers; defaulting to layer 0.');
            layers = [{ id: 0 }];
          }
          var layerIds = layers.map(function (l) { return l.id; });
          console.info('[co-lihtc-map] LIHTC FeatureServer layers: ' + layerIds.join(', '));
          updateStatus('Loading ' + layerIds.length + ' LIHTC layer(s)…');

          // Fetch all layers in parallel, Colorado-only
          var promises = layerIds.map(function (id) {
            var url = LIHTC_BASE + '/' + id + '/query';
            return fetchAllPages(url, LIHTC_WHERE + '&outFields=*&f=geojson&outSR=4326', 15000)
              .catch(function (err) {
                console.warn('[co-lihtc-map] Layer ' + id + ' fetch failed:', err.message);
                return { type: 'FeatureCollection', features: [] };
              });
          });

          return Promise.all(promises).then(function (results) {
            var combined = [];
            results.forEach(function (fc) {
              if (fc && Array.isArray(fc.features)) {
                combined = combined.concat(fc.features);
              }
            });
            var data = { type: 'FeatureCollection', features: combined };
            if (validateData(data)) {
              renderData(map, data);
              updateStatus('Source: CHFA ArcGIS (' + combined.length + ' projects)');
            } else {
              console.warn('[co-lihtc-map] CHFA returned no features; trying HUD.');
              return useHUD();
            }
          });
        })
        .catch(function (err) {
          console.warn('[co-lihtc-map] CHFA fetch failed; trying HUD.', err.message);
          return useHUD();
        });
    }

    // 1. Try CHFA ArcGIS first (most current data), then HUD, then local file, then embedded.
    return useCHFA();
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

    // Fix vendored marker icon paths (use resolveAssetUrl for GitHub Pages sub-path support)
    if (L.Icon && L.Icon.Default) {
      var _resolve = (typeof window.resolveAssetUrl === 'function') ? window.resolveAssetUrl : function (p) { return p; };
      L.Icon.Default.mergeOptions({
        iconUrl:       _resolve('js/vendor/images/marker-icon.png'),
        iconRetinaUrl: _resolve('js/vendor/images/marker-icon-2x.png'),
        shadowUrl:     _resolve('js/vendor/images/marker-shadow.png')
      });
    }

    try {
      var map = L.map(mapEl).setView([39.5501, -105.7821], 7);

      // Initialize layer groups
      lihtcLayerGroup  = L.layerGroup();
      ddaLayerGroup    = L.layerGroup();
      qctLayerGroup    = L.layerGroup();
      countyLayerGroup = L.layerGroup();

      // Restrict pan/zoom to Colorado
      var coloradoBounds = L.latLngBounds(
        L.latLng(36.8, -109.1),
        L.latLng(41.1, -102.0)
      );
      map.setMaxBounds(coloradoBounds.pad(0.45));
      map.setMinZoom(6);

      // Apply tile layer from basemap selector (replaces hardcoded OSM)
      wireBasemap(map);

      updateStatus('Map ready.');
      console.info('[co-lihtc-map] Map initialized on', mapEl.id || mapEl.tagName);

      // Expose map globally so map-overlay.js and other scripts can use it
      window.coLihtcMap = map;

      fetchData(map);
      loadLocalOverlays(map);
      wireToggles(map);
      wireCountyDropdown(map);
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