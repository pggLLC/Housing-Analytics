/**
 * js/hna/hna-controller.js
 * Responsibility: Initialization, geography selection, map management, LIHTC overlays, and the main update/event loop.
 * Dependencies: window.__HNA_STATE (_S), window.__HNA_UTILS (_U), window.__HNA_RENDERERS (_R)
 * Exposes: window.__HNA_renderFastTrack, window.__HNA_generateComplianceReport,
 *          window.__HNA_getJurisdictionCompliance, window.__HNA_calculateFastTrackTimeline,
 *          window.__HNA_renderProjectionChart, window.__HNA_renderScenarioComparison,
 *          window.__HNA_renderHouseholdDemand, window.__HNA_PROJECTION_SCENARIOS,
 *          window.__HNA_renderEmploymentTrend, window.__HNA_renderWageTrend,
 *          window.__HNA_renderIndustryAnalysis, window.__HNA_renderEconomicIndicators,
 *          window.__HNA_renderWageGaps, window.__HNA_renderFmrPanel,
 *          window.__HNA_renderChasAffordabilityGap, window.__HNA_LEHD_CACHE
 */
(function () {
  'use strict';
  var _S = window.__HNA_STATE;
  var _U = window.__HNA_UTILS;
  var _R = window.__HNA_RENDERERS;
  var _N = window.__HNA_NARRATIVES;

  // Alias for convenience in this module
  var fetchWithTimeout = _S.fetchWithTimeout || window.fetchWithTimeout;

  async function exportPdf(){
    // Delegate to the dedicated export module (js/hna-export.js).
    // Falls back to the print dialog if the module is not yet loaded.
    if (window.__HNA_exportPdf){
      return window.__HNA_exportPdf();
    }
    window.print();
  }

  async function fetchBoundary(geoType, geoid){
    // Use TIGERweb MapServer for geometry as GeoJSON
    // States:    TIGERweb/State_County MapServer/0
    // Counties:  TIGERweb/State_County MapServer/1
    // Places:    TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/4 (2025 vintage; was layer 2 pre-2025)
    // ConCities: TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/3 (consolidated cities fallback)
    // CDPs:      TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/5 (2025 vintage; was layer 4 pre-2025)

    const service = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
    const countyService = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer';
    const layer = geoType === 'state' ? 0 : geoType === 'county' ? 1 : geoType === 'place' ? 4 : geoType === 'cdp' ? 5 : 4;
    const svc   = (geoType === 'county' || geoType === 'state') ? countyService : service;
    const base  = `${svc}/${layer}`;

    const where = `GEOID='${geoid}'`;
    const params = new URLSearchParams({
      where,
      outFields: '*',
      f: 'geojson',
      outSR: '4326',
    });
    const url = `${base}/query?${params.toString()}`;
    const r = await fetchWithTimeout(url, {}, 15000);
    if (!r.ok) throw new Error(`Boundary fetch failed (${r.status})`);
    const gj = await r.json();
    if (!Array.isArray(gj?.features) || gj.features.length === 0) {
      // For places, fall back to Consolidated Cities layer (layer 3) before giving up.
      // Some Colorado municipalities (e.g. Broomfield) are classified as consolidated
      // cities in TIGERweb and are absent from the Incorporated Places layer (layer 4).
      if (geoType === 'place') {
        const fallbackUrl = `${service}/3/query?${params.toString()}`;
        const fallbackResp = await fetchWithTimeout(fallbackUrl, {}, 15000);
        if (fallbackResp.ok) {
          const fallbackGj = await fallbackResp.json();
          if (Array.isArray(fallbackGj?.features) && fallbackGj.features.length > 0) return fallbackGj;
        }
      }
      // For CDPs, fall back to Incorporated Places layer (layer 4) in case the
      // CDP GEOID also appears there (e.g. reclassification between Census vintages).
      if (geoType === 'cdp') {
        const fallbackUrl = `${service}/4/query?${params.toString()}`;
        const fallbackResp = await fetchWithTimeout(fallbackUrl, {}, 15000);
        if (fallbackResp.ok) {
          const fallbackGj = await fallbackResp.json();
          if (Array.isArray(fallbackGj?.features) && fallbackGj.features.length > 0) return fallbackGj;
        }
      }
      throw new Error(`No boundary found for ${geoType} ${geoid} in TIGERweb`);
    }
    return gj;
  }

  function ensureMap(){
    if (_S.map) return;

    // Fix vendored Leaflet marker icon paths
    if (window.L && L.Icon && L.Icon.Default) {
      L.Icon.Default.mergeOptions({
        iconUrl:       'js/vendor/images/marker-icon.png',
        iconRetinaUrl: 'js/vendor/images/marker-icon-2x.png',
        shadowUrl:     'js/vendor/images/marker-shadow.png',
      });
    }

    _S.map = L.map('hnaMap', { scrollWheelZoom: false });

    // --- Basemap tile providers ---
    const HNA_BASE_SESSION_KEY = 'hna-basemap';
    const BASEMAPS = {
      light:       L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }),
      dark:        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }),
      osm:         L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',             { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }),
      satellite:   L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 18 }),
      'esri-gray': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxZoom: 16 }),
    };
    const BASEMAP_LABELS = {
      light: 'Light (CARTO)', dark: 'Dark (CARTO)', osm: 'OpenStreetMap',
      satellite: 'Satellite (Esri)', 'esri-gray': 'Gray Canvas (Esri)',
    };

    // Determine initial basemap: session choice → auto (OS/site theme)
    function autoKey() {
      if (document.documentElement.classList.contains('dark-mode'))  return 'dark';
      if (document.documentElement.classList.contains('light-mode')) return 'light';
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    const storedBase = (function(){ try { return sessionStorage.getItem(HNA_BASE_SESSION_KEY); } catch(_){ return null; } })();
    let userOverride = !!(storedBase && BASEMAPS[storedBase]);
    let activeKey = userOverride ? storedBase : autoKey();
    let activeBase = BASEMAPS[activeKey].addTo(_S.map);

    function swapBase(key) {
      if (!BASEMAPS[key] || key === activeKey) return;
      try { _S.map.removeLayer(activeBase); } catch(e) {}
      activeBase = BASEMAPS[key].addTo(_S.map);
      activeKey = key;
      activeBase.bringToBack();
    }

    // Fall back to OSM Standard if the selected tile provider is unreachable
    activeBase.once('tileerror', function() {
      if (activeKey !== 'osm') swapBase('osm');
    });

    // --- Basemap selector Leaflet control (top-right corner of map) ---
    const BasemapControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-bar');
        div.style.cssText = 'background:var(--card,#fff);padding:4px 7px;border-radius:8px;' +
          'box-shadow:0 1px 5px rgba(0,0,0,.3);font-size:12px;line-height:1.4;';
        const lbl = L.DomUtil.create('label', '', div);
        lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:default;' +
          'white-space:nowrap;color:var(--text,#222);';
        lbl.innerHTML = '<span style="opacity:.65">Base:</span>';
        const sel = L.DomUtil.create('select', '', lbl);
        sel.style.cssText = 'font-size:11px;border:1px solid var(--border,#ccc);border-radius:5px;' +
          'background:var(--card,#fff);color:var(--text,#222);padding:1px 4px;cursor:pointer;';
        Object.keys(BASEMAPS).forEach(function(k) {
          const opt = document.createElement('option');
          opt.value = k; opt.textContent = BASEMAP_LABELS[k];
          if (k === activeKey) opt.selected = true;
          sel.appendChild(opt);
        });
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        sel.addEventListener('change', function() {
          swapBase(sel.value);
          userOverride = true;
          try { sessionStorage.setItem(HNA_BASE_SESSION_KEY, sel.value); } catch(_) {}
        });
        // Expose select for theme-sync updates
        div._sel = sel;
        return div;
      }
    });
    const basemapCtrl = new BasemapControl({ position: 'topright' });
    basemapCtrl.addTo(_S.map);

    // Auto-follow site dark/light theme when user hasn't manually chosen a basemap
    function syncTheme() {
      if (userOverride) return;
      const k = autoKey();
      if (k !== activeKey) {
        swapBase(k);
        if (basemapCtrl._container && basemapCtrl._container._sel) {
          basemapCtrl._container._sel.value = k;
        }
      }
    }
    if (window.MutationObserver) {
      new MutationObserver(syncTheme)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('theme:changed', syncTheme);

    _S.map.setView([39.0, -108.55], 9);

    // Ensure map renders correctly after container is visible
    setTimeout(function(){ _S.map.invalidateSize(); }, 300);
    window.addEventListener('resize', function(){ _S.map.invalidateSize(); });

    // Update "LIHTC projects in area" panel whenever the map view changes
    _S.map.on('moveend', updateLihtcInfoPanel);
  }

  // Boundary style tokens keyed by geoType — counties use a thinner/lighter stroke
  // so that municipality outlines (smaller areas) are visually distinct from county ones.
  const BOUNDARY_STYLES = {
    county: { weight: 2,   color: '#2b6cb0', fillOpacity: 0.06 },
    place:  { weight: 3,   color: '#096e65', fillOpacity: 0.10 },
    cdp:    { weight: 3,   color: '#7c3d00', fillOpacity: 0.10 },
    state:  { weight: 1.5, color: '#2b6cb0', fillOpacity: 0.04 },
  };

  function renderBoundary(geojson, geoType){
    ensureMap();
    if (_S.boundaryLayer) {
      _S.boundaryLayer.remove();
      _S.boundaryLayer = null;
    }
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (!features.length) return;
    const style = BOUNDARY_STYLES[geoType] || BOUNDARY_STYLES.county;
    _S.boundaryLayer = L.geoJSON(geojson, { style }).addTo(_S.map);
    try{
      _S.map.fitBounds(_S.boundaryLayer.getBounds(), {padding:[16,16]});
    }catch(e){
      // ignore
    }
  }

  // --- LIHTC / QCT / DDA helpers ---

  // Return LIHTC fallback features filtered to a county FIPS (or all if none specified)

  async function fetchLihtcProjects(countyFips5){
    // State-level request for Colorado: return all projects without county filtering.
    if (countyFips5 === '08') {
      try {
        const stateGj = await _U.loadJson('data/chfa-lihtc.json');
        if (stateGj && Array.isArray(stateGj.features) && stateGj.features.length > 0) {
          return { ...stateGj, _source: 'local', _fetchedAt: stateGj.fetchedAt || null };
        }
      } catch(e) {
        if (e.httpStatus !== 404) {
          console.warn('[HNA] data/chfa-lihtc.json unreadable:', e.message, '— using embedded fallback.');
          if (_S.els.lihtcMapStatus) {
            _S.els.lihtcMapStatus.textContent =
              'LIHTC data unavailable. Verify data/chfa-lihtc.json is deployed (check GitHub Actions output).';
          }
          return { ..._U.lihtcFallbackForCounty(null), _source: 'fallback' };
        }
        console.warn('[HNA] data/chfa-lihtc.json not found (404); trying CHFA ArcGIS.');
      }

      // Remote fallback: CHFA ArcGIS FeatureServer for all Colorado projects.
      const chfaParams = new URLSearchParams({
        where:   `Proj_St='CO'`,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 2000,
      });
      const chfaUrl = `${_S.SOURCES.chfaLihtcQuery}/query?${chfaParams}`;
      try {
        const r = await fetchWithTimeout(chfaUrl, {}, 15000);
        if (!r.ok) throw new Error(`CHFA LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
          return { ...gj, _source: 'CHFA' };
        }
        console.warn('[HNA] CHFA LIHTC returned no features; falling back to HUD.');
      } catch(e) {
        console.warn('[HNA] CHFA LIHTC ArcGIS API unavailable; falling back to HUD.', e.message);
      }

      // Final fallback: HUD ArcGIS FeatureServer for all Colorado projects.
      const hudParams = new URLSearchParams({
        where:   `HUD_ID LIKE '08%' OR STATE='CO' OR STATE='Colorado'`,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 2000,
      });
      const hudUrl = `${_S.SOURCES.hudLihtcQuery}/query?${hudParams}`;
      try {
        const r = await fetchWithTimeout(hudUrl, {}, 15000);
        if (!r.ok) throw new Error(`LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) return { ...gj, _source: 'HUD' };
      } catch(e) {
        console.warn('[HNA] LIHTC ArcGIS API unavailable; using embedded fallback.', e.message);
      }

      return { ..._U.lihtcFallbackForCounty(null), _source: 'fallback' };
    }

    if (countyFips5 && countyFips5.length === 5) {
      const stateFips  = countyFips5.slice(0, 2);
      const countyFips = countyFips5.slice(2);

      // Colorado: try county-specific cached file first, then canonical statewide file.
      if (stateFips === '08') {
        try {
          const localCounty = await _U.loadJson(_S.PATHS.lihtc(countyFips5));
          if (localCounty?.features?.length > 0) return { ...localCounty, _source: 'local' };
        } catch(_) { /* no county-specific cache */ }

        try {
          const stateGj = await _U.loadJson('data/chfa-lihtc.json');
          if (stateGj && Array.isArray(stateGj.features)) {
            // Filter to the requested county using the CNTY_FIPS field added by CI.
            const features = stateGj.features.filter(f =>
              (f.properties && f.properties.CNTY_FIPS === countyFips5) ||
              // Fallback: match by 3-digit county FIPS portion if full 5-digit is unavailable.
              (f.properties && (f.properties.COUNTYFP || '') === countyFips)
            );
            if (features.length > 0) {
              return { type: 'FeatureCollection', features, _source: 'local', _fetchedAt: stateGj.fetchedAt || null };
            }
            // File loaded but no features for this county — not a deployment error; fall through
            // to remote APIs in case the county has newer projects not yet in the local file.
            console.info('[HNA] data/chfa-lihtc.json has no features for county', countyFips5, '— trying CHFA ArcGIS.');
          }
        } catch(e) {
          if (e.httpStatus === 404) {
            // Local file not deployed — fall through to remote ArcGIS APIs.
            console.warn('[HNA] data/chfa-lihtc.json not found (404); trying CHFA ArcGIS.');
          } else {
            // File exists but is unreadable (empty, corrupt, etc.) — show clear message,
            // use embedded fallback without hitting remote APIs.
            console.warn('[HNA] data/chfa-lihtc.json unreadable:', e.message, '— using embedded fallback.');
            if (_S.els.lihtcMapStatus) {
              _S.els.lihtcMapStatus.textContent =
                'LIHTC data unavailable. Verify data/chfa-lihtc.json is deployed (check GitHub Actions output).';
            }
            return { ..._U.lihtcFallbackForCounty(countyFips5), _source: 'fallback' };
          }
        }

        // Remote fallback (only reached when local file is absent or has no county features):
        // try CHFA ArcGIS FeatureServer first (most current CO-specific data).
        const chfaParams = new URLSearchParams({
          where:   `STATEFP='${stateFips}' AND COUNTYFP='${countyFips}'`,
          outFields: '*',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: 1000,
        });
        const chfaUrl = `${_S.SOURCES.chfaLihtcQuery}/query?${chfaParams}`;
        try {
          const r = await fetchWithTimeout(chfaUrl, {}, 15000);
          if (!r.ok) throw new Error(`CHFA LIHTC HTTP ${r.status}`);
          const gj = await r.json();
          if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
            return { ...gj, _source: 'CHFA' };
          }
          console.warn('[HNA] CHFA LIHTC returned no features; falling back to HUD.');
        } catch(e) {
          console.warn('[HNA] CHFA LIHTC ArcGIS API unavailable; falling back to HUD.', e.message);
        }
      }

      // All states (and Colorado final fallback): HUD ArcGIS FeatureServer.
      const params = new URLSearchParams({
        where:   `CNTY_FIPS='${countyFips5}'`,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 1000,
      });
      const url = `${_S.SOURCES.hudLihtcQuery}/query?${params}`;
      try {
        const r = await fetchWithTimeout(url, {}, 15000);
        if (!r.ok) throw new Error(`LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) return { ...gj, _source: 'HUD' };
      } catch(e) {
        console.warn('[HNA] LIHTC ArcGIS API unavailable; using embedded fallback.', e.message);
      }
    }
    // Return embedded fallback filtered to county
    return { ..._U.lihtcFallbackForCounty(countyFips5), _source: 'fallback' };
  }

  // Fetch QCT census tracts from HUD ArcGIS service for the county
  async function fetchQctTracts(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const countyFips = countyFips5.slice(2);
    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await _U.loadJson('data/qct-colorado.json');
      if (localGj && Array.isArray(localGj.features)) {
        const features = localGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (f.properties?.COUNTY   === countyFips) ||
          (f.properties?.GEOID || '').startsWith(countyFips5)
        );
        if (features.length > 0) {
          console.info('[HNA] QCT loaded from local cache (data/qct-colorado.json).');
          return { ...localGj, features };
        }
      }
    } catch(_) {/* no local cache */}
    // Tier 2: live HUD ArcGIS API — use GEOID prefix filter for census tracts
    const params = new URLSearchParams({
      where:   `GEOID LIKE '${countyFips5}%'`,
      outFields: 'GEOID,TRACTCE,NAME,STATEFP,COUNTYFP',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: 500,
    });
    const url = `${_S.SOURCES.hudQctQuery}/query?${params}`;
    try {
      const r = await fetchWithTimeout(url, {}, 15000);
      if (!r.ok) throw new Error(`QCT HTTP ${r.status}`);
      const gj = await r.json();
      if (gj && Array.isArray(gj.features) && gj.features.length > 0) return gj;
    } catch(e) {
      console.warn('[HNA] QCT ArcGIS API unavailable; trying GitHub Pages backup.', e.message);
    }
    // Tier 3a: GitHub Pages backup (statewide QCT file, filtered to county)
    try {
      const backupGj = await _U.loadJson(`${_S.GITHUB_PAGES_BASE}/data/qct-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (f.properties?.COUNTY   === countyFips) ||
          (f.properties?.GEOID || '').startsWith(countyFips5)
        );
        if (features.length > 0) return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages QCT backup */}
    // Tier 3b: embedded fallback filtered to county
    const qctFeatures = _S.QCT_FALLBACK_CO.features.filter(f =>
      (f.properties?.COUNTYFP === countyFips) ||
      (f.properties?.COUNTY   === countyFips) ||
      (f.properties?.GEOID || '').startsWith(countyFips5)
    );
    if (qctFeatures.length > 0) return { ..._S.QCT_FALLBACK_CO, features: qctFeatures };
    return null;
  }

  // Fetch DDA polygons from HUD ArcGIS service for the county
  async function fetchDdaForCounty(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const countyFips = countyFips5.slice(2);
    // Use _S.CO_DDA lookup to get the expected HUD Metro FMR Area name for DDA_NAME matching.
    // The national HUD dataset (data/dda-colorado.json) uses ZCTA5-based features with a
    // DDA_NAME field and lacks COUNTYFP/COUNTIES. The COUNTYFP/COUNTIES checks are retained
    // for forward compatibility in case a future source (e.g. the live HUD API) returns those fields.
    const expectedArea = _S.CO_DDA[countyFips5]?.area;
    const ddaFilter = f =>
      (expectedArea && f.properties?.DDA_NAME === expectedArea) ||
      (f.properties?.COUNTYFP === countyFips) ||
      (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips));
    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await _U.loadJson('data/dda-colorado.json');
      if (localGj && Array.isArray(localGj.features)) {
        const features = localGj.features.filter(ddaFilter);
        if (features.length > 0) {
          console.info('[HNA] DDA loaded from local cache (data/dda-colorado.json).');
          return { ...localGj, features };
        }
      }
    } catch(_) {/* no local cache */}
    // Tier 2: live HUD ArcGIS API — DDA areas span multiple counties so fetch all, filter locally
    const params = new URLSearchParams({
      where:   '1=1',
      outFields: 'DDA_NAME,COUNTYFP,STATEFP,COUNTIES',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: 500,
    });
    const url = `${_S.SOURCES.hudDdaQuery}/query?${params}`;
    try {
      const r = await fetchWithTimeout(url, {}, 15000);
      if (!r.ok) throw new Error(`DDA HTTP ${r.status}`);
      const gj = await r.json();
      if (gj && Array.isArray(gj.features)) {
        const features = gj.features.filter(ddaFilter);
        return { ...gj, features };
      }
    } catch(e) {
      console.warn('[HNA] DDA ArcGIS API unavailable; trying GitHub Pages backup.', e.message);
    }
    // Tier 3a: GitHub Pages backup (statewide DDA file, filtered to county)
    try {
      const backupGj = await _U.loadJson(`${_S.GITHUB_PAGES_BASE}/data/dda-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(ddaFilter);
        return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages DDA backup */}
    // Tier 3b: embedded fallback filtered to county
    const ddaFeatures = _S.DDA_FALLBACK_CO.features.filter(ddaFilter);
    return { ..._S.DDA_FALLBACK_CO, features: ddaFeatures };
  }

  // Returns a human-readable label and badge color for a LIHTC data source identifier.
  function lihtcSourceInfo(source) {
    if (source === 'CHFA')  return { label: 'CHFA (Colorado Housing and Finance Authority)', color: '#0ea5e9' };
    if (source === 'local') return { label: 'Local CHFA data (chfa-lihtc.json)', color: '#16a34a' };
    if (source === 'HUD')   return { label: 'HUD LIHTC Database', color: '#6366f1' };
    return                         { label: 'HUD LIHTC Database (embedded)', color: '#6366f1' };
  }

  // Helper: build rich LIHTC popup HTML (mirrors colorado-deep-dive popup style)
  // source: 'CHFA' | 'HUD' | 'fallback' — indicates which data source provided this record
  function lihtcPopupHtml(p, source) {
    const safe = v => (v == null || v === '') ? '—' : String(v);
    const yn   = v => (v === 1 || v === '1' || v === 'Y' || v === true)
      ? '<span style="color:#34d399">Yes</span>'
      : '<span style="color:#94a3b8">No</span>';
    const addr = [p.STD_ADDR || p.PROJ_ADD, p.STD_CITY || p.PROJ_CTY, p.STD_ST || p.PROJ_ST, p.STD_ZIP5]
      .filter(Boolean).join(', ');
    const { label: srcLabel } = lihtcSourceInfo(source);
    return `<div style="min-width:220px;max-width:280px;font-size:13px">
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;line-height:1.3">${safe(p.PROJECT || p.PROJ_NM) || 'LIHTC Project'}</div>
      ${addr ? `<div style="margin-bottom:6px;opacity:.8">${addr}</div>` : ''}
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:2px 0;opacity:.7">Total units</td><td style="text-align:right;font-weight:700">${safe(p.N_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Low-income units</td><td style="text-align:right;font-weight:700">${safe(p.LI_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Placed in service</td><td style="text-align:right">${safe(p.YR_PIS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Credit type</td><td style="text-align:right">${safe(p.CREDIT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">QCT</td><td style="text-align:right">${yn(p.QCT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">DDA</td><td style="text-align:right">${yn(p.DDA)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">County</td><td style="text-align:right">${safe(p.CNTY_NAME || p.PROJ_CTY)}</td></tr>
        ${p.HUD_ID ? `<tr><td style="padding:2px 0;opacity:.7">HUD ID</td><td style="text-align:right;font-size:11px">${safe(p.HUD_ID)}</td></tr>` : ''}
      </table>
      <div style="margin-top:6px;font-size:11px;opacity:.55">Source: ${srcLabel}</div>
    </div>`;
  }

  // Build (or rebuild) the "LIHTC projects in area (top 10 by units)" info panel
  // using features that fall within the current map viewport bounds.
  function updateLihtcInfoPanel() {
    if (!_S.els.lihtcInfoPanel || !_S.allLihtcFeatures.length) return;
    const bounds = _S.map && _S.map.getBounds ? _S.map.getBounds() : null;
    let visible = _S.allLihtcFeatures;
    if (bounds) {
      visible = _S.allLihtcFeatures.filter(f => {
        if (!f.geometry || f.geometry.type !== 'Point') return false;
        const [lng, lat] = f.geometry.coordinates;
        return bounds.contains([lat, lng]);
      });
    }
    // safeCell: renders 0 correctly (unlike `|| '—'`) while still showing '—' for null/undefined
    const safeCell = v => (v != null && v !== '') ? String(v) : '—';
    const sorted = [...visible].sort((a,b) => (b.properties?.N_UNITS||0) - (a.properties?.N_UNITS||0));
    const rows = sorted.slice(0, 10).map(f => {
      const p = f.properties || {};
      return `<tr>
        <td style="padding:4px 6px">${safeCell(p.PROJECT || p.PROJ_NM)}</td>
        <td style="padding:4px 6px">${safeCell(p.PROJ_CTY || p.STD_CITY)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.N_UNITS)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.LI_UNITS)}</td>
        <td style="padding:4px 6px">${safeCell(p.YR_PIS)}</td>
        <td style="padding:4px 6px">${safeCell(p.CREDIT)}</td>
      </tr>`;
    }).join('');
    const sourceBadge = `<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:.75rem;font-weight:700;background:${lihtcSourceInfo(_S.lihtcDataSource).color};color:#fff;margin-left:8px">Source: ${_S.lihtcDataSource}</span>`;
    _S.els.lihtcInfoPanel.innerHTML = rows ? `
      <p style="margin:8px 0 4px;font-weight:700">LIHTC projects in area (top 10 by units):${sourceBadge}</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.83rem">
          <thead><tr style="color:var(--muted)">
            <th style="padding:4px 6px;text-align:left">Project</th>
            <th style="padding:4px 6px;text-align:left">City</th>
            <th style="padding:4px 6px;text-align:right">Total units</th>
            <th style="padding:4px 6px;text-align:right">LI units</th>
            <th style="padding:4px 6px">Year</th>
            <th style="padding:4px 6px">Credit</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<p>No LIHTC projects visible in current map area.</p>';
  }

  // Render LIHTC project markers on the map
  function renderLihtcLayer(geojson){
    ensureMap();
    if (_S.lihtcLayer) { _S.lihtcLayer.remove(); _S.lihtcLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (_S.els.statLihtcCount) _S.els.statLihtcCount.textContent = '0';
      if (_S.els.statLihtcUnits) _S.els.statLihtcUnits.textContent = '0';
      _S.allLihtcFeatures = [];
      return;
    }

    const dataSource = geojson._source || 'HUD';
    _S.allLihtcFeatures = geojson.features;
    _S.lihtcDataSource = dataSource;

    const lihtcIcon = L.divIcon({
      html: '<div style="width:11px;height:11px;border-radius:50%;background:#e84545;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      className: '',
      iconSize: [11, 11],
      iconAnchor: [5, 5],
    });

    _S.lihtcLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) => L.marker(latlng, { icon: lihtcIcon }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindPopup(lihtcPopupHtml(p, dataSource));
        layer.bindTooltip(p.PROJECT || p.PROJ_NM || 'LIHTC Project');
      },
    }).addTo(_S.map);

    // Visibility toggle
    if (_S.els.layerLihtc && !_S.els.layerLihtc.checked) _S.lihtcLayer.remove();

    // Update stats
    const count = geojson.features.length;
    const units = geojson.features.reduce((s, f) => s + (Number(f.properties?.N_UNITS) || 0), 0);
    if (_S.els.statLihtcCount) _S.els.statLihtcCount.textContent = count.toLocaleString();
    if (_S.els.statLihtcUnits) _S.els.statLihtcUnits.textContent = units.toLocaleString();

    // Build the info panel for the current viewport
    updateLihtcInfoPanel();
  }

  // Render QCT tract overlay on the map
  function renderQctLayer(geojson){
    ensureMap();
    if (_S.qctLayer) { _S.qctLayer.remove(); _S.qctLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (_S.els.statQctCount) _S.els.statQctCount.textContent = '0';
      return;
    }
    _S.qctLayer = L.geoJSON(geojson, {
      style: {
        weight: 2,
        color: '#388e3c',
        fillColor: '#4caf50',
        fillOpacity: 0.18,
      },
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindTooltip(`QCT Tract: ${p.NAME || p.GEOID || p.TRACTCE || '—'}`);
      },
    }).addTo(_S.map);

    if (_S.els.layerQct && !_S.els.layerQct.checked) _S.qctLayer.remove();
    if (_S.els.statQctCount) _S.els.statQctCount.textContent = geojson.features.length.toLocaleString();
  }

  // Render DDA overlay on the map (polygon if available) and info badge
  function renderDdaLayer(countyFips5, ddaGeojson){
    ensureMap();
    if (_S.ddaLayer) { _S.ddaLayer.remove(); _S.ddaLayer = null; }

    const ddaInfo = _S.CO_DDA[countyFips5] || null;

    if (ddaGeojson && ddaGeojson.features && ddaGeojson.features.length) {
      _S.ddaLayer = L.geoJSON(ddaGeojson, {
        style: {
          weight: 2,
          color: '#ff6f00',
          fillColor: '#ff9800',
          fillOpacity: 0.17,
          dashArray: '6 4',
        },
        onEachFeature: (f, layer) => {
          const p = f.properties || {};
          layer.bindTooltip(`DDA: ${p.DDA_NAME || 'Difficult Development Area'}`);
        },
      }).addTo(_S.map);
      if (_S.els.layerDda && !_S.els.layerDda.checked) _S.ddaLayer.remove();
    }

    // Always show DDA status from static lookup or fetched data
    const isDda = !!(ddaInfo?.status || (ddaGeojson?.features?.length));
    const areaName = ddaInfo?.area || (ddaGeojson?.features?.[0]?.properties?.DDA_NAME) || '';
    if (_S.els.statDdaStatus) _S.els.statDdaStatus.textContent = isDda ? 'Yes ✓' : 'No';
    if (_S.els.statDdaNote) _S.els.statDdaNote.textContent = isDda ? (areaName || 'HUD DDA') : 'Not designated';
  }

  // Wire layer visibility toggles
  function wireLayerToggles(){
    if (_S.els.layerLihtc) {
      _S.els.layerLihtc.addEventListener('change', () => {
        if (!_S.lihtcLayer) return;
        if (_S.els.layerLihtc.checked) _S.lihtcLayer.addTo(_S.map);
        else _S.lihtcLayer.remove();
      });
    }
    if (_S.els.layerQct) {
      _S.els.layerQct.addEventListener('change', () => {
        if (!_S.qctLayer) return;
        if (_S.els.layerQct.checked) _S.qctLayer.addTo(_S.map);
        else _S.qctLayer.remove();
      });
    }
    if (_S.els.layerDda) {
      _S.els.layerDda.addEventListener('change', () => {
        if (!_S.ddaLayer) return;
        if (_S.els.layerDda.checked) _S.ddaLayer.addTo(_S.map);
        else _S.ddaLayer.remove();
      });
    }
  }

  // Load and render all LIHTC/QCT/DDA overlays for the selected geography
  async function updateLihtcOverlays(countyFips5){
    // Increment the sequence counter. Any in-flight request for an older county
    // will see that its requestSeq no longer matches and will discard its result.
    const requestSeq = ++_S._lihtcRequestSeq;

    // Clear the previous county's LIHTC layer immediately so stale data is not shown
    // while the new county's data loads.
    if (_S.lihtcLayer) { _S.lihtcLayer.remove(); _S.lihtcLayer = null; }
    _S.allLihtcFeatures = [];

    if (_S.els.lihtcMapStatus) _S.els.lihtcMapStatus.textContent = 'Loading LIHTC data…';

    // LIHTC
    try {
      const lihtcData = await fetchLihtcProjects(countyFips5);
      if (requestSeq !== _S._lihtcRequestSeq) return; // county changed while fetching — discard
      renderLihtcLayer(lihtcData);
      if (_S.els.lihtcMapStatus) {
        const src = lihtcData && lihtcData._source;
        const fetchedAt = lihtcData && lihtcData._fetchedAt;
        let dateStr = '';
        if (fetchedAt) {
          try { dateStr = ` · cache: ${new Date(fetchedAt).toISOString().slice(0, 10)}`; } catch (_) { /* unparseable */ }
        }
        _S.els.lihtcMapStatus.textContent = src ? `Source: ${src}${dateStr}` : '';
      }
    } catch(e) {
      if (requestSeq !== _S._lihtcRequestSeq) return;
      console.warn('[HNA] LIHTC render failed', e);
      if (_S.els.statLihtcCount) _S.els.statLihtcCount.textContent = '—';
      if (_S.els.statLihtcUnits) _S.els.statLihtcUnits.textContent = '—';
      if (_S.els.lihtcMapStatus) _S.els.lihtcMapStatus.textContent = '';
    }

    // QCT
    try {
      const qctData = await fetchQctTracts(countyFips5);
      if (requestSeq !== _S._lihtcRequestSeq) return;
      if (qctData) {
        renderQctLayer(qctData);
      } else {
        if (_S.els.statQctCount) _S.els.statQctCount.textContent = '—';
      }
    } catch(e) {
      if (requestSeq !== _S._lihtcRequestSeq) return;
      console.warn('[HNA] QCT render failed', e);
      if (_S.els.statQctCount) _S.els.statQctCount.textContent = '—';
    }

    // DDA
    try {
      const ddaData = await fetchDdaForCounty(countyFips5);
      if (requestSeq !== _S._lihtcRequestSeq) return;
      renderDdaLayer(countyFips5, ddaData);
    } catch(e) {
      if (requestSeq !== _S._lihtcRequestSeq) return;
      console.warn('[HNA] DDA render failed', e);
      renderDdaLayer(countyFips5, null);
    }
  }

  async function update(){
    var ws = document.getElementById('hnaWaitingState');
    if (ws) ws.style.display = 'none';
    _R.showAllChartsLoading();
    const geoType = _S.els.geoType.value;
    const geoid = _S.els.geoSelect.value;

    const label = (()=>{
      if (geoType === 'state') return 'State of Colorado';
      const conf = window.__HNA_GEO_CONFIG;
      if (geoType==='county' && Array.isArray(conf?.counties)){
        const m = conf.counties.find(c=>c.geoid===geoid);
        return m?.label || geoid;
      }
      // Search all config arrays for the geography label
      const allEntries = [
        ...(conf?.featured || _S.FEATURED),
        ...(conf?.places   || []),
        ...(conf?.cdps     || []),
      ];
      const m = allEntries.find(x=>x.geoid===geoid);
      return m?.label || geoid;
    })();

    _R.setBanner('');

    // Clear stat cards immediately so users never see stale data from a previous geography.
    // Cards will be repopulated once the new profile data arrives.
    _R.clearStats();

    // Announce geography change to screen readers (WCAG 4.1.3 / Rule 11)
    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate(`Loading data for ${label}`);
    }

    // Load boundary
    let boundaryFailed = false;
    try{
      const gj = await fetchBoundary(geoType, geoid);
      renderBoundary(gj, geoType);
    }catch(e){
      console.warn(e);
      boundaryFailed = true;
      // Clear any stale boundary from a previous geography selection
      renderBoundary({ type: 'FeatureCollection', features: [] }, geoType);
      _R.setBanner('Boundary failed to load (TIGERweb). The rest of the page may still populate.', 'warn');
    }

    // Load cached summary (if present) else live ACS
    let profile=null, s0801=null;
    const cacheFlags = { summary:false, lehd:false, dola:false, projections:false, derived:false };

    try{
        const sum = await _U.loadJson(_S.PATHS.summary(geoid));
        if (sum && sum.acsProfile) {
          profile = sum.acsProfile;
          s0801 = sum.acsS0801;
          cacheFlags.summary = true;
          // Extract year and series from cached source endpoint URL if available
          const endpointMeta = (url) => {
            if (!url) return {};
            const m = url.match(/\/data\/(\d{4})\//);
            return { year: m ? parseInt(m[1], 10) : null, series: url.includes('/acs1/') ? 'acs1' : 'acs5' };
          };
          if (!profile._acsYear && sum.source?.acs_profile_endpoint) {
            const { year, series } = endpointMeta(sum.source.acs_profile_endpoint);
            if (year) profile._acsYear = year;
            profile._acsSeries = series;
          }
          if (s0801 && !s0801._acsYear && sum.source?.acs_s0801_endpoint) {
            const { year, series } = endpointMeta(sum.source.acs_s0801_endpoint);
            if (year) s0801._acsYear = year;
            s0801._acsSeries = series;
          }
        }
      }catch(_){/* ignore */}

    if (!profile){
      if (!_U.censusKey()) {
        _R.setBanner('Census API key not configured — live data requests may be rate-limited. ' +
          'Set CENSUS_API_KEY in js/config.js for full functionality.', 'warn');
      }
      try{
        profile = await _U.fetchAcsProfile(geoType, geoid);
      }catch(e){
        console.warn(e);
      }
    }
    // Attach geography metadata to profile and s0801 for source link generation
    if (profile) { profile._geoType = geoType; profile._geoid = geoid; }

    if (!s0801){
      try{
        s0801 = await _U.fetchAcsS0801(geoType, geoid);
      }catch(e){
        console.warn(e);
        // keep going
      }
    }

    if (!profile){
      // Build the ACS failure banner using DOM elements to avoid innerHTML/XSS risks
      const msgSpan = document.createElement('span');
      msgSpan.textContent = 'No ACS Census data could be found for this area. Diagnostics have been run and saved for support review. Please contact your manager or support and reference this log file. ';
      const dlLink = document.createElement('a');
      dlLink.href = _S.PATHS.acsDebugLog;
      dlLink.download = 'acs_debug_log.txt';
      dlLink.style.cssText = 'color:inherit;text-decoration:underline';
      dlLink.textContent = 'Download Debug Log';
      _S.els.banner.textContent = '';
      _S.els.banner.appendChild(msgSpan);
      _S.els.banner.appendChild(dlLink);
      _S.els.banner.classList.add('show');
    }

    if (profile){
      const prevProfile = _S.state.prevProfile[geoid] || null;
      _R.renderSnapshot(profile, s0801, label, prevProfile);
      _R.renderHousingCharts(profile);
      _R.renderAffordChart(profile);
      _R.renderRentBurdenBins(profile);
    }

    if (s0801){
      _R.renderModeShare(s0801);
    }

    // LEHD (cached)
    const contextCounty = _U.countyFromGeoid(geoType, geoid);
    let lehd=null;
    if (geoType === 'state'){
      // Load state-level aggregate LEHD file
      try{
        lehd = await _U.loadJson(_S.PATHS.lehd('08'));
        cacheFlags.lehd = true;
      }catch(e){
        console.warn(e);
      }
      if (lehd){
        _R.renderLehd(lehd, geoType, geoid);
      } else {
        _S.els.lehdNote.textContent = 'LEHD state aggregate not yet available. Run the HNA data build workflow to populate.';
      }
    } else {
      try{
        // Prefer county cache for county selections; for places/CDPs use containing county
        const lehdGeoid = geoType === 'county' ? geoid : contextCounty;
        lehd = await _U.loadJson(_S.PATHS.lehd(lehdGeoid));
        cacheFlags.lehd = true;
      }catch(e){
        console.warn(e);
      }
      if (lehd){
        _R.renderLehd(lehd, geoType, geoid);
      } else {
        _S.els.lehdNote.textContent = 'LEHD flow cache not yet available. Run the HNA data build workflow to populate.';
      }
    }

    // Labor Market section (uses LEHD + ACS profile)
    _R.renderLaborMarketSection(lehd, profile);

    // Economic indicators — trend charts and affordability gap table
    // For state type use '08'; for county use geoid; for places use contextCounty.
    const econGeoid = geoType === 'state' ? '08' : (geoType === 'county' ? geoid : contextCounty);
    if (!window.__HNA_LEHD_CACHE) window.__HNA_LEHD_CACHE = {};
    if (lehd && econGeoid) window.__HNA_LEHD_CACHE[econGeoid] = lehd;
    _R.renderEconomicIndicators(econGeoid);
    _R.renderEmploymentTrend(econGeoid);
    _R.renderWageTrend(econGeoid);
    _R.renderIndustryAnalysis(econGeoid);
    _R.renderWageGaps(econGeoid, profile);

    // CHAS affordability gap (county context; loaded once and cached on state object)
    if (!_S.state.chasData) {
      try {
        _S.state.chasData = await _U.loadJson(_S.PATHS.chasCostBurden);
      } catch (_) {
        _S.state.chasData = null;
      }
    }
    _R.renderChasAffordabilityGap(contextCounty, _S.state.chasData);

    // Prop 123 compliance section (uses ACS profile + geoType)
    _R.renderProp123Section(profile, geoType);

    // DOLA SYA (cached; county context)
    let dola=null;
    if (geoType === 'state'){
      // Load state-level aggregate DOLA SYA file
      try{
        dola = await _U.loadJson(_S.PATHS.dolaSya('08'));
        cacheFlags.dola = true;
      }catch(e){
        console.warn(e);
      }
      if (dola){
        _R.renderDolaPyramid(dola);
      } else {
        _S.els.seniorNote.textContent = 'DOLA/SDO state aggregate not yet available. Run the HNA data build workflow to populate.';
      }
    } else {
      try{
        dola = await _U.loadJson(_S.PATHS.dolaSya(contextCounty));
        cacheFlags.dola = true;
      }catch(e){
        console.warn(e);
      }
      if (dola){
        _R.renderDolaPyramid(dola);
      } else {
        _S.els.seniorNote.textContent = 'DOLA/SDO age data not yet available. Run the HNA data build workflow to populate.';
      }
    }

    // 20-year projections (cached; county context or state '08')
    _S.state.current = { geoType, geoid, label, contextCounty, profile };
    // Store profile for next refresh — enables YOY comparison on subsequent updates
    if (profile && geoid) _S.state.prevProfile[geoid] = profile;
    const projFips = geoType === 'state' ? '08' : contextCounty;
    const projRes = projFips
      ? await _R.renderProjections(projFips, _S.state.current)
      : _R.clearProjectionsForStateLevel();
    if (projRes?.ok) cacheFlags.projections = true;

    _R.renderLocalResources(geoType, geoid);

    const derivedEntry = _S.state.derived?.geos?.[geoid] || null;
    if (derivedEntry) cacheFlags.derived = true;

    _R.renderMethodology({
      geoType,
      geoid,
      geoLabel: label,
      usedCountyForContext: contextCounty,
      cacheFlags,
      derivedEntry,
      derivedYears: _S.state.derived?.acs5_years || null,
    });

    // LIHTC / QCT / DDA overlays (non-blocking; state FIPS '08' for statewide, county FIPS otherwise)
    updateLihtcOverlays(geoType === 'state' ? '08' : contextCounty).catch(e => console.warn('[HNA] LIHTC overlay error', e));

    // HUD FMR & Income Limits panel (non-blocking)
    _R.renderFmrPanel(geoType === 'county' ? contextCounty : null);

    // Update data freshness timestamp from manifest (populated by data-freshness.js)
    const tsEl = document.getElementById('hnaDataTimestamp');
    if (tsEl) {
      const generated = window.__dataFreshness && window.__dataFreshness.generated;
      if (generated && typeof window.__formatFreshnessDate === 'function') {
        tsEl.textContent = 'Data as of ' + window.__formatFreshnessDate(generated);
      } else {
        tsEl.textContent = 'Data as of ' + new Date().toLocaleDateString();
      }
    }

    // Announce completion to screen readers (WCAG 4.1.3 / Rule 11)
    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate(`Data loaded for ${label}`);
    }

    // If boundary failed but data loaded successfully, downgrade the banner to a
    // non-alarming informational note (the data is ready; only the map outline is missing).
    if (boundaryFailed) {
      _R.setBanner(`Map boundary unavailable — data for ${label} is shown below.`, 'info');
    }

    // Hide all chart loading overlays now that rendering is complete (Recommendation 3.1)
    _R.hideChartLoading();
  }

  async function init(){
    // Initialize shared DOM element refs
    _S.els = {
      geoType: document.getElementById('geoType'),
      geoSelect: document.getElementById('geoSelect'),
      btnRefresh: document.getElementById('btnRefresh'),
      btnPdf: document.getElementById('btnPdf'),
      btnCsv: document.getElementById('btnCsv'),
      btnJson: document.getElementById('btnJson'),
      banner: document.getElementById('hnaBanner'),
      geoContextPill: document.getElementById('geoContextPill'),
      execNarrative: document.getElementById('execNarrative'),
      statPop: document.getElementById('statPop'),
      statPopSrc: document.getElementById('statPopSrc'),
      statPopYoy: document.getElementById('statPopYoy'),
      statMhi: document.getElementById('statMhi'),
      statMhiSrc: document.getElementById('statMhiSrc'),
      statMhiYoy: document.getElementById('statMhiYoy'),
      statHomeValue: document.getElementById('statHomeValue'),
      statHomeValueSrc: document.getElementById('statHomeValueSrc'),
      statHomeValueYoy: document.getElementById('statHomeValueYoy'),
      statRent: document.getElementById('statRent'),
      statRentSrc: document.getElementById('statRentSrc'),
      statRentYoy: document.getElementById('statRentYoy'),
      statTenure: document.getElementById('statTenure'),
      statTenureSrc: document.getElementById('statTenureSrc'),
      statRentBurden: document.getElementById('statRentBurden'),
      statRentBurdenSrc: document.getElementById('statRentBurdenSrc'),
      statIncomeNeed: document.getElementById('statIncomeNeed'),
      statIncomeNeedNote: document.getElementById('statIncomeNeedNote'),
      statCommute: document.getElementById('statCommute'),
      statCommuteSrc: document.getElementById('statCommuteSrc'),
      localResources: document.getElementById('localResources'),
      affordAssumptions: document.getElementById('affordAssumptions'),
      methodology: document.getElementById('methodology'),
      lehdNote: document.getElementById('lehdNote'),
      lehdVintageBanner: document.getElementById('lehdVintageBanner'),
      lehdVintageYear: document.getElementById('lehdVintageYear'),
      seniorNote: document.getElementById('seniorNote'),
      statBaseUnits: document.getElementById('statBaseUnits'),
      statBaseUnitsSrc: document.getElementById('statBaseUnitsSrc'),
      statTargetVac: document.getElementById('statTargetVac'),
      statUnitsNeed: document.getElementById('statUnitsNeed'),
      statNetMig: document.getElementById('statNetMig'),
      needNote: document.getElementById('needNote'),
      assumpHorizon: document.getElementById('assumpHorizon'),
      assumpVacancy: document.getElementById('assumpVacancy'),
      assumpVacancyVal: document.getElementById('assumpVacancyVal'),
      statLihtcCount: document.getElementById('statLihtcCount'),
      statLihtcUnits: document.getElementById('statLihtcUnits'),
      statQctCount: document.getElementById('statQctCount'),
      statDdaStatus: document.getElementById('statDdaStatus'),
      statDdaNote: document.getElementById('statDdaNote'),
      lihtcInfoPanel: document.getElementById('lihtcInfoPanel'),
      lihtcMapStatus: document.getElementById('lihtcMapStatus'),
      layerLihtc: document.getElementById('layerLihtc'),
      layerQct: document.getElementById('layerQct'),
      layerDda: document.getElementById('layerDda'),
    };

    // Load geo config + resources if present
    try{ window.__HNA_GEO_CONFIG = await _U.loadJson(_S.PATHS.geoConfig); }catch(_){ window.__HNA_GEO_CONFIG = { featured: _S.FEATURED }; }
    try{ window.__HNA_LOCAL_RESOURCES = await _U.loadJson(_S.PATHS.localResources); }catch(_){ window.__HNA_LOCAL_RESOURCES = {}; }
    try{ _S.state.derived = await _U.loadJson(_S.PATHS.derived); }catch(_){ _S.state.derived = null; }

    // Wire up aria-live announcement helper for screen reader updates (Rule 11)
    const liveRegion = document.getElementById('hnaLiveRegion');
    if (liveRegion && typeof window.__announceUpdate !== 'function') {
      window.__announceUpdate = function(msg) {
        liveRegion.textContent = '';
        // Force re-announcement by toggling content after a microtask
        requestAnimationFrame(function() { liveRegion.textContent = msg; });
      };
    }

    // Populate full county list (small) if not present in repo cache
    if (!Array.isArray(window.__HNA_GEO_CONFIG.counties) || !window.__HNA_GEO_CONFIG.counties.length){
      try{
        window.__HNA_GEO_CONFIG.counties = await _U.fetchCoCountiesList();
      }catch(e){
        console.warn('County list fetch failed', e);
      }
    }

    // Set defaults
    _S.els.geoType.value = _S.DEFAULTS.geoType;
    _R.buildSelect();

    // For county type, ensure a county is selected (first in list when no match for DEFAULTS.geoId)
    if (_S.els.geoType.value === 'county' && !_S.els.geoSelect.value){
      const firstOpt = _S.els.geoSelect.options[0];
      if (firstOpt) _S.els.geoSelect.value = firstOpt.value;
    }

    _S.els.geoType.addEventListener('change', ()=>{
      _R.buildSelect();
      update();
    });
    _S.els.geoSelect.addEventListener('change', update);
    _S.els.btnRefresh.addEventListener('click', update);
    _S.els.btnPdf?.addEventListener('click', exportPdf);
    _S.els.btnCsv?.addEventListener('click', ()=>{
      if (window.__HNA_exportCsv){ window.__HNA_exportCsv(); }
    });
    _S.els.btnJson?.addEventListener('click', ()=>{
      if (window.__HNA_exportJson){ window.__HNA_exportJson(); }
    });

    // Projection assumptions controls
    const onAssumpChange = ()=>{ if(_S.state.lastProj && _S.state.current){ _R.applyAssumptions(_S.state.lastProj, _S.state.current); } };
    _S.els.assumpHorizon?.addEventListener('change', onAssumpChange);
    _S.els.assumpVacancy?.addEventListener('input', ()=>{ _S.els.assumpVacancyVal.textContent = `${Number(_S.els.assumpVacancy.value).toFixed(1)}%`; onAssumpChange(); });
    document.querySelectorAll('input[name="assumpHeadship"]').forEach(r=>r.addEventListener('change', onAssumpChange));

    // Re-render charts on theme toggle
    document.addEventListener('theme:changed', ()=>{ update(); });
    document.addEventListener('nav:rendered', ()=>{ /* no-op */ });

    // Wire manual checkbox clicks in the compliance checklist to persistence module
    const checklistEl = document.getElementById('prop123Checklist');
    if (checklistEl && window.ComplianceChecklist) {
      checklistEl.addEventListener('change', (e) => {
        const chk = e.target;
        if (chk.type !== 'checkbox') return;
        const li = chk.closest('[data-storage-key]');
        if (!li) return;
        const itemId = li.getAttribute('data-storage-key');
        window.ComplianceChecklist.updateChecklistItem(itemId, chk.checked, {
          date: new Date().toISOString(),
        });
        // Announce change to screen readers
        const announcer = document.getElementById('checklistAnnouncer');
        if (announcer) {
          const geoType = _S.els.geoType ? _S.els.geoType.value : 'county';
          const geoid   = _S.els.geoSelect ? _S.els.geoSelect.value : '';
          announcer.textContent = window.ComplianceChecklist.getNextAction(geoType, geoid);
        }
      });
    }

    // Sync checklist state to compliance-dashboard.html on unload
    window.addEventListener('beforeunload', () => {
      if (window.ComplianceChecklist && _S.state.current) {
        window.ComplianceChecklist.broadcastChecklistChange({
          geoType: _S.state.current.geoType,
          geoid:   _S.state.current.geoid,
        });
      }
    });

    wireLayerToggles();
    _R.wireScenarioControls();
    _R.updateScenarioDescription();
    ensureMap();
    update();
  }

  // Expose the same window.__HNA_* API as the original file for backward compatibility
  window.__HNA_renderFastTrack = _R.renderFastTrackCalculatorSection;
  window.__HNA_generateComplianceReport = _N.generateComplianceReport;
  window.__HNA_getJurisdictionCompliance = _N.getJurisdictionComplianceStatus;
  window.__HNA_calculateFastTrackTimeline = _N.calculateFastTrackTimeline;
  window.__HNA_renderProjectionChart = _R.renderProjectionChart;
  window.__HNA_renderScenarioComparison = _R.renderScenarioComparison;
  window.__HNA_renderHouseholdDemand = _R.renderHouseholdDemand;
  window.__HNA_PROJECTION_SCENARIOS = _S.PROJECTION_SCENARIOS;
  window.__HNA_renderEmploymentTrend = _R.renderEmploymentTrend;
  window.__HNA_renderWageTrend = _R.renderWageTrend;
  window.__HNA_renderIndustryAnalysis = _R.renderIndustryAnalysis;
  window.__HNA_renderEconomicIndicators = _R.renderEconomicIndicators;
  window.__HNA_renderWageGaps = _R.renderWageGaps;
  window.__HNA_renderFmrPanel = _R.renderFmrPanel;
  window.__HNA_renderChasAffordabilityGap = _R.renderChasAffordabilityGap;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
