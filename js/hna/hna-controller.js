/**
 * hna-controller.js
 * Responsibility: Init, state management, data fetching, event orchestration.
 * Dependencies: window.HNAUtils, window.HNARenderers
 * Exposes: window.HNAController, window.HNAState, window.__HNA_* globals
 */
(function () {
  'use strict';

  window.HNAState = {
    state: { current: null, lastProj: null, trendCache: {}, derived: null, prevProfile: {}, chasData: null },
    charts: {},
    map: null,
    boundaryLayer: null,
    lihtcLayer: null,
    qctLayer: null,
    ddaLayer: null,
    allLihtcFeatures: [],
    // F174 — populated by renderAffordableHousingLayer when properties.json
    // loads. Used by lihtcPopupHtml to surface preservation candidacy
    // inside the standard LIHTC tooltip so users don't need to toggle
    // a second layer to see if a deal is preservation-eligible.
    _preservationFeats: [],
    lihtcDataSource: 'HUD',
    _lihtcRequestSeq: 0,
    _censusApiWarnDone: false,
    els: null, // initialized in init() after DOM is ready
  };

  window.HNAState.els = {
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

    // LIHTC / QCT / DDA
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
    // F173 — non-LIHTC affordable property toggles (AHL sub-layers)
    layerHudMf: document.getElementById('layerHudMf'),
    layerUsdaRd: document.getElementById('layerUsdaRd'),
    layerPbv: document.getElementById('layerPbv'),
    layerPreservation: document.getElementById('layerPreservation'),

  };

  // Charts

  var fetchWithTimeout = window.fetchWithTimeout || function (url, options, timeoutMs) {
    // Minimal inline fallback in case fetch-helper.js is not loaded first.
    // Uses the same 15s default as the shared implementation in fetch-helper.js.
    timeoutMs = timeoutMs || 15000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var merged = Object.assign({}, options || {}, { signal: ctrl.signal });
    return fetch(url, merged).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  };


  async function exportPdf(){
    // Delegate to the dedicated export module (js/hna-export.js).
    // Falls back to the print dialog if the module is not yet loaded.
    if (window.__HNA_exportPdf){
      return window.__HNA_exportPdf();
    }
    window.print();
  }

  // --- Geography helpers ---

  function buildSelect(){
    const type = window.HNAState.els.geoType.value;
    window.HNAState.els.geoSelect.innerHTML='';
    const cfg = window.__HNA_GEO_CONFIG;

    // State of Colorado — single fixed option
    if (type === 'state') {
      const opt = document.createElement('option');
      opt.value = '08';
      opt.textContent = 'State of Colorado';
      opt.selected = true;
      window.HNAState.els.geoSelect.appendChild(opt);
      _announceGeoOptions(1, 'state');
      return;
    }

    // Prefer full list from config for each type; fall back to featured items
    if (type === 'county' && Array.isArray(cfg?.counties) && cfg.counties.length){
      for (const c of cfg.counties){
        const opt = document.createElement('option');
        opt.value = c.geoid;
        opt.textContent = c.label;
        if (c.geoid === window.HNAUtils.DEFAULTS.geoId) opt.selected = true;
        window.HNAState.els.geoSelect.appendChild(opt);
      }
      _announceGeoOptions(cfg.counties.length, 'county');
      return;
    }

    if (type === 'place'){
      // Combine incorporated places + CDPs into one sorted list so all
      // 263 Colorado municipalities are discoverable in a single dropdown.
      // Each option carries a data-subtype attribute ('place' or 'cdp') so
      // fetchBoundary() can select the correct TIGERweb layer.
      const combined = [];
      for (const p of (cfg?.places || [])) combined.push({ geoid: p.geoid, label: p.label, subtype: 'place' });
      for (const c of (cfg?.cdps  || [])) combined.push({ geoid: c.geoid, label: c.label, subtype: 'cdp'   });
      combined.sort((a, b) => a.label.localeCompare(b.label));
      for (const item of combined){
        const opt = document.createElement('option');
        opt.value = item.geoid;
        opt.textContent = item.subtype === 'cdp' ? item.label + ' (CDP)' : item.label;
        opt.setAttribute('data-subtype', item.subtype);
        window.HNAState.els.geoSelect.appendChild(opt);
      }
      if (!window.HNAState.els.geoSelect.value && combined[0]) window.HNAState.els.geoSelect.value = combined[0].geoid;
      _announceGeoOptions(combined.length, 'municipality');
      return;
    }

    if (type === 'cdp' && Array.isArray(cfg?.cdps) && cfg.cdps.length){
      for (const c of cfg.cdps){
        const opt = document.createElement('option');
        opt.value = c.geoid;
        opt.textContent = c.label;
        opt.setAttribute('data-subtype', 'cdp');
        window.HNAState.els.geoSelect.appendChild(opt);
      }
      if (!window.HNAState.els.geoSelect.value && cfg.cdps[0]) window.HNAState.els.geoSelect.value = cfg.cdps[0].geoid;
      _announceGeoOptions(cfg.cdps.length, 'census-designated place');
      return;
    }

    // Fall back to featured items filtered by type
    const list = (cfg?.featured || window.HNAUtils.FEATURED).filter(x => x.type === type);
    for (const g of list){
      const opt = document.createElement('option');
      opt.value = g.geoid;
      opt.textContent = g.label;
      if (g.geoid === window.HNAUtils.DEFAULTS.geoId) opt.selected = true;
      window.HNAState.els.geoSelect.appendChild(opt);
    }

    // Ensure something selected
    if (!window.HNAState.els.geoSelect.value && list[0]) window.HNAState.els.geoSelect.value = list[0].geoid;
    _announceGeoOptions(list.length, type);
  }

  /**
   * Update the #geoSelectHint element so screen readers know how many options
   * are available after the geography type changes (Recommendation 5.5).
   */

  function _announceGeoOptions(count, typeName) {
    var hint = document.getElementById('geoSelectHint');
    if (hint) {
      hint.textContent = count + ' ' + typeName + (count === 1 ? '' : 's') + ' available';
    }
  }


  async function fetchCoCountiesList(){
    // TIGERweb county layer (State_County MapServer/1) exposes the FIPS
    // field as STATE, not STATEFP. Querying STATEFP returns HTTP 400 —
    // the code path was silently erroring and the UI fell back to
    // a static county list.
    const base = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';
    const params = new URLSearchParams({
      where: `STATE='${window.HNAUtils.STATE_FIPS_CO}'`,
      outFields: 'NAME,GEOID',
      f: 'json',
      returnGeometry: 'false',
      orderByFields: 'NAME'
    });
    const url = `${base}?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Failed to fetch county list');
    const d = await r.json();
    const counties = (d.features || []).map(f => {
        const name = f.attributes.NAME || '';
        const label = name.toLowerCase().endsWith('county') ? name : `${name} County`;
        return { geoid: f.attributes.GEOID, label };
      });
    return counties;
  }


  async function loadJson(url){
    // Resolve local paths through APP_BASE_PATH so they work on GitHub Pages sub-paths
    // (e.g. /Housing-Analytics/data/...) and on custom domains (/).
    const resolvedUrl = (!/^https?:\/\//i.test(url) && typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(url)
      : url;
    // cache:'no-store' bypasses the browser HTTP cache entirely. The server
    // already sends Cache-Control: no-store, but a previously-cached entry can
    // still be served on default 'no-cache' mode (must-revalidate may return
    // 304 from an in-memory copy). no-store closes that gap so a freshly-built
    // JSON shows up on reload without a hard refresh.
    const r = await fetchWithTimeout(resolvedUrl, {cache:'no-store'}, 20000);
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} ${resolvedUrl}`);
      err.httpStatus = r.status;
      throw err;
    }
    const text = await r.text();
    if (!text.trim()) throw new Error(`Empty response: ${resolvedUrl}`);
    return JSON.parse(text);
  }

  // --- TIGERweb boundary ---

  async function fetchBoundary(geoType, geoid){
    // Use TIGERweb MapServer for geometry as GeoJSON
    // States:    TIGERweb/State_County MapServer/0
    // Counties:  TIGERweb/State_County MapServer/1
    // Places:    TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/4 (2025 vintage; was layer 2 pre-2025)
    // ConCities: TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/3 (consolidated cities fallback)
    // CDPs:      TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/5 (2025 vintage; was layer 4 pre-2025)

    const service = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
    const countyService = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer';
    // When geoType is 'place', check the selected option's data-subtype to distinguish
    // incorporated places (layer 4) from CDPs (layer 5) in the combined dropdown.
    let _effectiveType = geoType;
    if (geoType === 'place') {
      const selEl = window.HNAState.els.geoSelect;
      const selOpt = selEl && selEl.options && selEl.options[selEl.selectedIndex];
      const subtype = selOpt && selOpt.getAttribute('data-subtype');
      if (subtype === 'cdp') _effectiveType = 'cdp';
    }
    const layer = _effectiveType === 'state' ? 0 : _effectiveType === 'county' ? 1 : _effectiveType === 'place' ? 4 : _effectiveType === 'cdp' ? 5 : 4;
    const svc   = (_effectiveType === 'county' || _effectiveType === 'state') ? countyService : service;
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
    if (window.HNAState.map) return;

    // Fix vendored Leaflet marker icon paths
    if (window.L && L.Icon && L.Icon.Default) {
      L.Icon.Default.mergeOptions({
        iconUrl:       'js/vendor/images/marker-icon.png',
        iconRetinaUrl: 'js/vendor/images/marker-icon-2x.png',
        shadowUrl:     'js/vendor/images/marker-shadow.png',
      });
    }

    window.HNAState.map = L.map('hnaMap', { scrollWheelZoom: false });
    if (window.addMapHomeButton) { addMapHomeButton(window.HNAState.map, { center: [39.0, -105.5], zoom: 7 }); }

    // F100 — Decorative county + place + CDP boundary overlay so the
    // HNA map shows jurisdictional context (county at all zoom levels,
    // places at zoom ≥ 9, CDPs at zoom ≥ 10).
    if (window.JurisdictionBoundaries) {
      try {
        window.JurisdictionBoundaries.attach(window.HNAState.map, {
          showCounties: true, showPlaces: true, showCdps: true,
          placesMinZoom: 9, cdpsMinZoom: 10,
        });
      } catch (e) { console.warn('[hna] jurisdiction boundaries attach failed', e); }
    }

    // F119 — All affordable housing properties color-coded by program.
    if (window.AffordableHousingLayer) {
      try { window.AffordableHousingLayer.attach(window.HNAState.map, { showLegend: true }); }
      catch (e) { console.warn('[hna] affordable housing layer attach failed', e); }
    }

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
    let activeBase = BASEMAPS[activeKey].addTo(window.HNAState.map);

    function swapBase(key) {
      if (!BASEMAPS[key] || key === activeKey) return;
      try { window.HNAState.map.removeLayer(activeBase); } catch(e) {}
      activeBase = BASEMAPS[key].addTo(window.HNAState.map);
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
    basemapCtrl.addTo(window.HNAState.map);

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

    window.HNAState.map.setView([39.0, -108.55], 9);

    // Ensure map renders correctly after container is visible
    setTimeout(function(){ window.HNAState.map.invalidateSize(); }, 300);
    window.addEventListener('resize', function(){ window.HNAState.map.invalidateSize(); });

    // Update "LIHTC projects in area" panel whenever the map view changes
    window.HNAState.map.on('moveend', window.HNARenderers.updateLihtcInfoPanel);
  }

  // Boundary style tokens keyed by geoType — counties use a thinner/lighter stroke
  // so that municipality outlines (smaller areas) are visually distinct from county ones.

  async function fetchLihtcProjects(countyFips5){
    // State-level request for Colorado: return all projects without county filtering.
    if (countyFips5 === '08') {
      try {
        const stateGj = await loadJson('data/chfa-lihtc.json');
        if (stateGj && Array.isArray(stateGj.features) && stateGj.features.length > 0) {
          return { ...stateGj, _source: 'local', _fetchedAt: stateGj.fetchedAt || null };
        }
      } catch(e) {
        if (e.httpStatus !== 404) {
          console.warn('[HNA] data/chfa-lihtc.json unreadable:', e.message, '— using embedded fallback.');
          if (window.HNAState.els.lihtcMapStatus) {
            window.HNAState.els.lihtcMapStatus.textContent =
              'LIHTC data unavailable. Verify data/chfa-lihtc.json is deployed (check GitHub Actions output).';
          }
          return { ...window.HNAUtils.lihtcFallbackForCounty(null), _source: 'fallback' };
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
      const chfaUrl = `${window.HNAUtils.SOURCES.chfaLihtcQuery}/query?${chfaParams}`;
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

      // Final fallback: HUD ArcGIS FeatureServer for this county.
      // CNTY_FIPS is a string field — must be quoted in ArcGIS SQL to avoid HTTP 400.
      const hudParams = new URLSearchParams({
        where:   `CNTY_FIPS='${countyFips5}'`,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 2000,
      });
      const hudUrl = `${window.HNAUtils.SOURCES.hudLihtcQuery}/query?${hudParams}`;
      try {
        const r = await fetchWithTimeout(hudUrl, {}, 15000);
        if (!r.ok) throw new Error(`LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) return { ...gj, _source: 'HUD' };
      } catch(e) {
        console.warn('[HNA] LIHTC ArcGIS API unavailable; using embedded fallback.', e.message);
      }

      return { ...window.HNAUtils.lihtcFallbackForCounty(null), _source: 'fallback' };
    }

    if (countyFips5 && countyFips5.length === 5) {
      const stateFips  = countyFips5.slice(0, 2);
      const countyFips = countyFips5.slice(2);

      // Colorado: canonical statewide file is the source of truth. Try it first.
      // The per-county cache (data/hna/lihtc/<fips>.json) was historically an
      // HUD-ArcGIS snapshot that lagged CHFA by 2-3 years; reading those first
      // hid the most recent 2022-2025 awards on the HNA map. (F89.)
      if (stateFips === '08') {
        try {
          const stateGj = await loadJson('data/chfa-lihtc.json');
          if (stateGj && Array.isArray(stateGj.features)) {
            const features = stateGj.features.filter(f =>
              (f.properties && f.properties.CNTY_FIPS === countyFips5) ||
              (f.properties && (f.properties.COUNTYFP || '') === countyFips)
            );
            if (features.length > 0) {
              return { type: 'FeatureCollection', features, _source: 'local', _fetchedAt: stateGj.fetchedAt || null };
            }
            console.info('[HNA] data/chfa-lihtc.json has no features for county', countyFips5, '— falling back to county cache, then remote.');
          }
        } catch(e) {
          if (e.httpStatus === 404) {
            console.warn('[HNA] data/chfa-lihtc.json not found (404); trying county-specific cache, then CHFA ArcGIS.');
          } else {
            console.warn('[HNA] data/chfa-lihtc.json unreadable:', e.message);
          }
        }

        // Secondary: per-county cache (may be stale; only used when statewide
        // file is unavailable or has no features for this county).
        try {
          const localCounty = await loadJson(window.HNAUtils.PATHS.lihtc(countyFips5));
          if (localCounty?.features?.length > 0) {
            console.info('[HNA] Using per-county LIHTC cache for', countyFips5, '— may lag statewide file.');
            return { ...localCounty, _source: 'local-county' };
          }
        } catch(_) { /* no county-specific cache */ }

        // Remote fallback (only reached when local file is absent or has no county features):
        // The LIHTC ArcGIS service uses PROJ_ST (e.g. 'CO') and CURCNTY (integer, no leading zeros).
        const countyInt = parseInt(countyFips, 10);  // '001' → 1, '014' → 14
        const chfaParams = new URLSearchParams({
          where:   `PROJ_ST='CO' AND CURCNTY='${countyInt}'`,
          outFields: '*',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: 1000,
        });
        const chfaUrl = `${window.HNAUtils.SOURCES.chfaLihtcQuery}/query?${chfaParams}`;
        try {
          const r = await fetchWithTimeout(chfaUrl, {}, 15000);
          if (!r.ok) throw new Error(`CHFA LIHTC HTTP ${r.status}`);
          const gj = await r.json();
          if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
            return { ...gj, _source: 'CHFA' };
          }
          console.info('[HNA] CHFA LIHTC returned no features for county', countyFips5, '— using embedded fallback.');
        } catch(e) {
          console.info('[HNA] CHFA LIHTC ArcGIS unavailable:', e.message, '— using embedded fallback.');
        }
      }
    }
    // Return embedded fallback filtered to county
    return { ...window.HNAUtils.lihtcFallbackForCounty(countyFips5), _source: 'fallback' };
  }

  // Fetch QCT census tracts from HUD ArcGIS service for the county

  async function fetchQctTracts(countyFips5){
    if (!countyFips5) return null;
    const isState = countyFips5 === '08';
    if (!isState && countyFips5.length !== 5) return null;
    const countyFips = isState ? null : countyFips5.slice(2);

    // Filter: for state-level, return all features; for county, filter by FIPS.
    const matchCounty = f => {
      if (isState) return true;
      return (f.properties?.COUNTYFP === countyFips) ||
             (f.properties?.COUNTY   === countyFips) ||
             (f.properties?.GEOID || '').startsWith(countyFips5);
    };

    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await loadJson('data/qct-colorado.json');
      if (localGj && Array.isArray(localGj.features)) {
        const features = localGj.features.filter(matchCounty);
        if (features.length > 0) {
          console.info('[HNA] QCT loaded from local cache (data/qct-colorado.json).');
          return { ...localGj, features };
        }
      }
    } catch(_) {/* no local cache */}
    // Tier 2: live HUD ArcGIS API — use GEOID prefix filter for census tracts
    const params = new URLSearchParams({
      where:   isState ? `GEOID LIKE '08%'` : `GEOID LIKE '${countyFips5}%'`,
      outFields: 'GEOID,TRACTCE,NAME,STATEFP,COUNTYFP',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: isState ? 2000 : 500,
    });
    const url = `${window.HNAUtils.SOURCES.hudQctQuery}/query?${params}`;
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
      const backupGj = await loadJson(`${window.HNAUtils.GITHUB_PAGES_BASE}/data/qct-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(matchCounty);
        if (features.length > 0) return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages QCT backup */}
    // Tier 3b: embedded fallback filtered to county
    const qctFeatures = window.HNAUtils.QCT_FALLBACK_CO.features.filter(matchCounty);
    if (qctFeatures.length > 0) return { ...window.HNAUtils.QCT_FALLBACK_CO, features: qctFeatures };
    return null;
  }

  // Fetch DDA polygons from HUD ArcGIS service for the county

  async function fetchDdaForCounty(countyFips5){
    if (!countyFips5) return null;
    const isState = countyFips5 === '08';
    if (!isState && countyFips5.length !== 5) return null;
    const countyFips = isState ? null : countyFips5.slice(2);
    // Use window.HNAUtils.CO_DDA lookup to get the expected HUD Metro FMR Area name for DDA_NAME matching.
    // The national HUD dataset (data/dda-colorado.json) uses ZCTA5-based features with a
    // DDA_NAME field and lacks COUNTYFP/COUNTIES. The COUNTYFP/COUNTIES checks are retained
    // for forward compatibility in case a future source (e.g. the live HUD API) returns those fields.
    const expectedArea = isState ? null : (window.HNAUtils.CO_DDA[countyFips5]?.area);
    const ddaFilter = f => {
      if (isState) return true; // State-level: return all Colorado DDAs
      return (expectedArea && f.properties?.DDA_NAME === expectedArea) ||
             (f.properties?.COUNTYFP === countyFips) ||
             (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips));
    };
    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await loadJson('data/dda-colorado.json');
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
    const url = `${window.HNAUtils.SOURCES.hudDdaQuery}/query?${params}`;
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
      const backupGj = await loadJson(`${window.HNAUtils.GITHUB_PAGES_BASE}/data/dda-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(ddaFilter);
        return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages DDA backup */}
    // Tier 3b: embedded fallback filtered to county
    const ddaFeatures = window.HNAUtils.DDA_FALLBACK_CO.features.filter(ddaFilter);
    return { ...window.HNAUtils.DDA_FALLBACK_CO, features: ddaFeatures };
  }

  // Returns a human-readable label and badge color for a LIHTC data source identifier.

  function wireLayerToggles(){
    if (window.HNAState.els.layerLihtc) {
      window.HNAState.els.layerLihtc.addEventListener('change', () => {
        const on = window.HNAState.els.layerLihtc.checked;
        // F173 — drive BOTH the dedicated CHFA divIcon lihtcLayer AND
        // the AffordableHousingLayer LIHTC sub-categories so they
        // toggle together.
        if (window.HNAState.lihtcLayer) {
          if (on) window.HNAState.lihtcLayer.addTo(window.HNAState.map);
          else window.HNAState.lihtcLayer.remove();
        }
        if (window.AffordableHousingLayer && window.AffordableHousingLayer.setLihtcVisible) {
          window.AffordableHousingLayer.setLihtcVisible(window.HNAState.map, on);
        }
      });
    }
    if (window.HNAState.els.layerQct) {
      window.HNAState.els.layerQct.addEventListener('change', () => {
        if (!window.HNAState.qctLayer) return;
        if (window.HNAState.els.layerQct.checked) window.HNAState.qctLayer.addTo(window.HNAState.map);
        else window.HNAState.qctLayer.remove();
      });
    }
    if (window.HNAState.els.layerDda) {
      window.HNAState.els.layerDda.addEventListener('change', () => {
        if (!window.HNAState.ddaLayer) return;
        if (window.HNAState.els.layerDda.checked) window.HNAState.ddaLayer.addTo(window.HNAState.map);
        else window.HNAState.ddaLayer.remove();
      });
    }
    // F173 — Wire non-LIHTC affordable property toggles. Each drives a
    // single AffordableHousingLayer sub-layer. The AHL category visibility
    // calls are no-ops until properties.json finishes loading, so the
    // initial state of each checkbox (checked) matches AHL's default.
    const AHL_TOGGLES = [
      { el: 'layerHudMf',        key: 'hud_mf' },
      { el: 'layerUsdaRd',       key: 'usda_rd' },
      { el: 'layerPbv',          key: 'pbv_local' },
      { el: 'layerPreservation', key: 'preservation' },
    ];
    AHL_TOGGLES.forEach(({ el, key }) => {
      const node = window.HNAState.els[el];
      if (!node) return;
      node.addEventListener('change', () => {
        if (window.AffordableHousingLayer && window.AffordableHousingLayer.setCategoryVisible) {
          window.AffordableHousingLayer.setCategoryVisible(window.HNAState.map, key, node.checked);
        }
      });
    });
  }

  // Load and render all LIHTC/QCT/DDA overlays for the selected geography

  async function updateLihtcOverlays(countyFips5, geoType, geoLabel){
    // Increment the sequence counter. Any in-flight request for an older county
    // will see that its requestSeq no longer matches and will discard its result.
    const requestSeq = ++window.HNAState._lihtcRequestSeq;

    // Clear the previous county's LIHTC layer immediately so stale data is not shown
    // while the new county's data loads.
    if (window.HNAState.lihtcLayer) { window.HNAState.lihtcLayer.remove(); window.HNAState.lihtcLayer = null; }
    window.HNAState.allLihtcFeatures = [];

    if (window.HNAState.els.lihtcMapStatus) window.HNAState.els.lihtcMapStatus.textContent = 'Loading LIHTC data…';

    // LIHTC
    try {
      const lihtcData = await fetchLihtcProjects(countyFips5);
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return; // county changed while fetching — discard
      window.HNARenderers.renderLihtcLayer(lihtcData, { type: geoType, name: geoLabel });
      if (window.HNAState.els.lihtcMapStatus) {
        const src = lihtcData && lihtcData._source;
        const fetchedAt = lihtcData && lihtcData._fetchedAt;
        let dateStr = '';
        if (fetchedAt) {
          try { dateStr = ` · cache: ${new Date(fetchedAt).toISOString().slice(0, 10)}`; } catch (_) { /* unparseable */ }
        }
        // For place/CDP, note that LIHTC counts are for the containing county
        const scopeNote = (geoType === 'place' || geoType === 'cdp')
          ? ' · Stat splits jurisdiction vs. containing county; map shows the county.' : '';
        window.HNAState.els.lihtcMapStatus.textContent = src ? `Source: ${src}${dateStr}${scopeNote}` : '';
      }
    } catch(e) {
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return;
      console.warn('[HNA] LIHTC render failed', e);
      if (window.HNAState.els.statLihtcCount) window.HNAState.els.statLihtcCount.textContent = '—';
      if (window.HNAState.els.statLihtcUnits) window.HNAState.els.statLihtcUnits.textContent = '—';
      if (window.HNAState.els.lihtcMapStatus) window.HNAState.els.lihtcMapStatus.textContent = '';
    }

    // QCT
    try {
      const qctData = await fetchQctTracts(countyFips5);
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return;
      if (qctData) {
        window.HNARenderers.renderQctLayer(qctData);
      } else {
        if (window.HNAState.els.statQctCount) window.HNAState.els.statQctCount.textContent = '—';
      }
    } catch(e) {
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return;
      console.warn('[HNA] QCT render failed', e);
      if (window.HNAState.els.statQctCount) window.HNAState.els.statQctCount.textContent = '—';
    }

    // DDA
    try {
      const ddaData = await fetchDdaForCounty(countyFips5);
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return;
      window.HNARenderers.renderDdaLayer(countyFips5, ddaData, { type: geoType, name: geoLabel });
    } catch(e) {
      if (requestSeq !== window.HNAState._lihtcRequestSeq) return;
      console.warn('[HNA] DDA render failed', e);
      window.HNARenderers.renderDdaLayer(countyFips5, null, { type: geoType, name: geoLabel });
    }

    // Market-area LIHTC competition (place/CDP only). Counts LIHTC projects
    // within a radius of the jurisdiction centroid — a self-contained PMA
    // proxy since the HNA doesn't carry a delineated PMA. Refinable.
    const _cur = (window.HNAState && window.HNAState.state && window.HNAState.state.current) || {};
    renderLihtcMarketArea(geoType, _cur.geoid).catch(e => console.warn('[HNA] LIHTC market-area error', e));
  }

  // ── LIHTC market-area count (radius around place centroid) ──
  let _lihtcStateFeats = null;
  let _placeCentroids  = null;
  async function _loadLihtcMarketAreaData() {
    if (!_lihtcStateFeats) {
      try { const gj = await loadJson('data/market/hud_lihtc_co.geojson'); _lihtcStateFeats = (gj && gj.features) || []; }
      catch (_) { _lihtcStateFeats = []; }
    }
    if (!_placeCentroids) {
      try { const pc = await loadJson('data/co-place-centroids.json'); _placeCentroids = (pc && pc.byGeoid) || {}; }
      catch (_) { _placeCentroids = {}; }
    }
    return { features: _lihtcStateFeats, centroids: _placeCentroids };
  }
  function _miles(lat1, lon1, lat2, lon2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  async function renderLihtcMarketArea(geoType, geoid, radiusOverride) {
    const panel  = document.getElementById('lihtcPmaPanel');
    const textEl = document.getElementById('lihtcPmaText');
    if (!panel || !textEl) return;
    if (geoType !== 'place' && geoType !== 'cdp') { panel.hidden = true; return; }
    const { features, centroids } = await _loadLihtcMarketAreaData();
    const c = centroids[geoid];
    if (!c || c.lat == null || c.lng == null || !features.length) { panel.hidden = true; return; }
    // Expose the active jurisdiction centroid so renderers (info panel
    // per-row in/near chips) can compute distances without re-loading
    // the centroid file.
    window.HNAState._lihtcActiveCentroid = { geoid: geoid, lat: c.lat, lng: c.lng, name: c.name || null };
    const R = radiusOverride || window.HNAState._lihtcPmaR || 15;
    // F189 — Also collect the per-project list within R so we can show a
    // collapsible roster (project name + units + year + distance) below
    // the summary headline. Sort ascending by distance so nearest deals
    // appear first.
    const matches = [];
    for (const f of features) {
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) continue;
      const d = _miles(c.lat, c.lng, coords[1], coords[0]);
      if (d <= R) {
        const p = f.properties || {};
        const units = parseInt(p.LI_UNITS || p.li_units || 0, 10) || 0;
        matches.push({
          name: p.PROJECT || p.project || 'Unnamed project',
          city: p.PROJ_CTY || p.proj_cty || p.CITY || '',
          units,
          year: parseInt(p.YR_PIS || p.yr_pis || 0, 10) || null,
          credit: p.CREDIT || p.TypeOfCredits || p.type_of_credits || '',
          distance: d
        });
      }
    }
    matches.sort((a, b) => a.distance - b.distance);
    const n = matches.length;
    const u = matches.reduce((s, m) => s + m.units, 0);
    // Two-line headline: bold scope statement + subline with counts and
    // a "tax-credit deals only" qualifier so users don't conflate this
    // strip with the broader info-panel above. Tooltip explains the
    // underwriting use case + scope (LIHTC only, not HUD MF / USDA RD / PBV).
    const jurisLabel = c.name || 'this jurisdiction';
    const _escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const _escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tooltipMsg = 'For underwriting a new 9% or 4% deal. Includes only LIHTC projects within driving distance; does not include HUD MF, USDA RD, or PBV properties.';
    const headline = '<strong title="' + _escAttr(tooltipMsg) + '" style="cursor:help">'
      + 'LIHTC comparables within ' + R + ' mi of ' + _escText(jurisLabel) + '</strong>';
    const subline = '<div style="font-size:.74rem;color:var(--muted);margin-top:1px">'
      + n + ' project' + (n === 1 ? '' : 's') + ', '
      + u.toLocaleString() + ' low-income units, tax-credit deals only</div>';
    // F189 — Collapsible per-project list. Default-collapsed per F184
    // site-wide policy. Items: name · units · year · distance (nearest first).
    let listHtml = '';
    if (n > 0) {
      const rows = matches.map(m => {
        const meta = [
          m.units ? (m.units + ' LI units') : null,
          m.year ? ('PIS ' + m.year) : null,
          m.credit ? _escText(m.credit) : null,
          m.distance.toFixed(1) + ' mi'
        ].filter(Boolean).join(' · ');
        return '<li style="padding:.25rem 0;border-bottom:1px solid var(--border);font-size:.78rem">' +
                 '<strong>' + _escText(m.name) + '</strong>' +
                 (m.city ? ' <span style="opacity:.7">· ' + _escText(m.city) + '</span>' : '') +
                 '<div style="font-size:.72rem;color:var(--muted);margin-top:1px">' + meta + '</div>' +
               '</li>';
      }).join('');
      listHtml =
        '<details style="margin-top:.4rem">' +
          '<summary style="cursor:pointer;font-size:.78rem;font-weight:600;color:var(--text);padding:.25rem 0">' +
            'View all ' + n + ' project' + (n === 1 ? '' : 's') + ' (nearest first)' +
          '</summary>' +
          '<ul style="list-style:none;padding-left:0;margin:.3rem 0 0;max-height:340px;overflow-y:auto">' +
            rows +
          '</ul>' +
        '</details>';
    }
    textEl.innerHTML = headline + subline + listHtml;
    // active-radius styling
    Array.from(panel.querySelectorAll('.lihtc-pma-r')).forEach(a => {
      const rv = parseInt(a.getAttribute('data-r'), 10);
      const isActive = rv === R;
      a.style.fontWeight = isActive ? '700' : '400';
      a.style.textDecoration = isActive ? 'none' : 'underline';
      a.style.color = isActive ? 'var(--text)' : '';
    });
    // wire click handlers once (read current geo from state at click time)
    if (!panel.__pmaWired) {
      panel.addEventListener('click', (ev) => {
        const a = ev.target.closest('.lihtc-pma-r');
        if (!a) return;
        ev.preventDefault();
        const rv = parseInt(a.getAttribute('data-r'), 10);
        if (!rv) return;
        window.HNAState._lihtcPmaR = rv;
        const cur = (window.HNAState && window.HNAState.state && window.HNAState.state.current) || {};
        if (cur.geoType && cur.geoid) renderLihtcMarketArea(cur.geoType, cur.geoid, rv);
      });
      panel.__pmaWired = true;
    }
    panel.hidden = false;
  }

  // --- Census API (live fallback) ---

  function _censusApiWarn() {
    if (!window.HNAState._censusApiWarnDone && !window.HNAUtils.censusKey()) {
      window.HNAState._censusApiWarnDone = true;
      console.warn('[HNA] CENSUS_API_KEY is not configured — Census profile and subject ' +
        'table requests may be rate-limited or rejected for some geographies. ' +
        'Set window.APP_CONFIG.CENSUS_API_KEY or add it to js/config.js. ' +
        'Free key signup: https://api.census.gov/data/key_signup.html');
    }
  }

  // Fetch a Census API URL with timeout/retry (via fetchWithTimeout) and
  // detailed error logging.  Handles transient HTTP errors (408, 429, 5xx)
  // by waiting and retrying once.  Returns the Response object on any HTTP
  // reply (callers check resp.ok), or null on unrecoverable network failure.
  async function _fetchCensusUrl(url, contextLabel) {
    const safeUrl = window.HNAUtils.redactKey(url);
    const label = contextLabel || 'Census API';
    const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

    async function tryFetch(retries) {
      try {
        return await fetchWithTimeout(url, {}, 15000, retries);
      } catch (e) {
        console.warn('[HNA] ' + label + ' network error (' + safeUrl + '): ' + e.message);
        return null;
      }
    }

    let resp = await tryFetch(2);
    if (!resp) return null;

    // One additional retry on transient HTTP status codes
    if (!resp.ok && TRANSIENT.has(resp.status)) {
      const backoffMs = resp.status === 429 ? 3000 : 1000;
      if (window.HNAUtils.DEBUG_HNA) {
        console.warn('[HNA] ' + label + ' HTTP ' + resp.status + ' (transient); retrying in ' + backoffMs + 'ms (' + safeUrl + ')');
      }
      await new Promise(function (res) { setTimeout(res, backoffMs); });
      const retried = await tryFetch(1);
      if (retried) resp = retried;
    }

    if (!resp.ok) {
      let bodyExcerpt = '';
      try { bodyExcerpt = (await resp.text()).slice(0, 500); } catch (e) {
        console.warn('[HNA] ' + label + ' failed to read error response body: ' + e.message);
      }
      console.warn('[HNA] ' + label + ' HTTP ' + resp.status + ' for ' + safeUrl +
        (bodyExcerpt ? ': ' + bodyExcerpt : ''));
    }

    return resp;
  }


  async function fetchAcsProfile(geoType, geoid){
    // Use ACS 1-year profile tables for a fast report-like snapshot.
    // Falls back to ACS 5-year if the primary year is unavailable.

    _censusApiWarn();

    // Validate GEOID format before building Census API URLs.
    if (geoType === 'county' && !/^\d{5}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsProfile: county GEOID "' + geoid + '" is not 5 digits; Census API call may fail.');
    }
    if ((geoType === 'place' || geoType === 'cdp') && !/^\d{7}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsProfile: place GEOID "' + geoid + '" is not 7 digits; Census API call may fail.');
    }

    // Variables — ACS 2023 5-year DP04 codes (verified against
    // api.census.gov/data/2023/acs/acs5/profile/variables.json).
    // Pre-2026-05-10 build mislabeled DP04_0003E-0010E as structure
    // types; the actual structure-type codes are 0007E-0014E. Same
    // for tenure: 0046E/0047E are the COUNT codes (preferred for
    // chart rendering); the PE-suffixed versions are percentages.
    const vars = [
      // DP05 population
      'DP05_0001E',
      // DP02 households
      'DP02_0001E',
      // DP03 income
      'DP03_0062E',
      // DP04 housing — occupancy + tenure + key metrics
      'DP04_0001E',  // Total housing units
      'DP04_0002E',  // Occupied housing units (count)
      'DP04_0003E',  // Vacant housing units (count)
      'DP04_0046E',  // Owner-occupied (count)  ← needed by chartTenure
      'DP04_0046PE', // Owner-occupied (%)
      'DP04_0047E',  // Renter-occupied (count) ← needed by chartTenure
      'DP04_0047PE', // Renter-occupied (%)
      'DP04_0089E',  // Median home value (owner-occupied)
      // F160 — Owner-occupied home value distribution (DP04_0080-0088).
      // Used by chartHomeValue to render the bracket breakdown
      // (<$50K / $50-100K / $100-150K / $150-200K / $200-300K /
      // $300-500K / $500K-1M / $1M+). Without these the HNA only
      // shows the median, which hides the underlying skew.
      'DP04_0080E',  // Owner-occupied units (total — denominator)
      'DP04_0081E',  // Less than $50,000
      'DP04_0082E',  // $50,000 to $99,999
      'DP04_0083E',  // $100,000 to $149,999
      'DP04_0084E',  // $150,000 to $199,999
      'DP04_0085E',  // $200,000 to $299,999
      'DP04_0086E',  // $300,000 to $499,999
      'DP04_0087E',  // $500,000 to $999,999
      'DP04_0088E',  // $1,000,000 or more
      'DP04_0134E',  // Median gross rent
      // DP04 housing — structure type (UNITS IN STRUCTURE), ACS 2023
      'DP04_0007E', // 1-unit detached
      'DP04_0008E', // 1-unit attached
      'DP04_0009E', // 2 units
      'DP04_0010E', // 3 or 4 units
      'DP04_0011E', // 5 to 9 units
      'DP04_0012E', // 10 to 19 units
      'DP04_0013E', // 20 or more units
      'DP04_0014E', // Mobile home
      // Rent burden bins (GRAPI) — only DP04_0142PE and DP04_0143PE exist in
      // ACS 1-year profile across vintages 2020-2024.  The 25-29.9%, 30-34.9%,
      // and 35%+ bins (formerly DP04_0144PE through DP04_0146PE) were removed
      // from the DP04 profile table and are no longer valid ACS variables;
      // those values are derived from the B25070 B-series fallback instead.
      'DP04_0142PE', // <20%
      'DP04_0143PE', // 20-24.9%
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'state'
        ? `state:${window.HNAUtils.STATE_FIPS_CO}`
        : geoType === 'place'
          ? `place:${geoid.slice(2)}`
          : `place:${geoid.slice(2)}`;

    const inParam = geoType === 'state' ? null : `state:${window.HNAUtils.STATE_FIPS_CO}`;
    const key = window.HNAUtils.censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}`;
      if (inParam) qs += `&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    const url1 = buildUrl(window.HNAUtils.ACS_YEAR_PRIMARY,  'acs/acs1/profile');
    let r = await _fetchCensusUrl(url1, 'ACS1 profile ' + geoType + ':' + geoid + ' y=' + window.HNAUtils.ACS_YEAR_PRIMARY);
    let usedYear = window.HNAUtils.ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';
    let url2 = null;
    if (!r || !r.ok){
      // Probe vintages newest-first for ACS 1-year
      r = null;
      for (const v of window.HNAUtils.ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs1/profile');
        const resp = await _fetchCensusUrl(u, 'ACS1 profile ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
      }
    }
    if (!r || !r.ok){
      if (window.HNAUtils.DEBUG_HNA) console.warn('[HNA] fetchAcsProfile: ACS1 exhausted for ' + geoType + ':' + geoid + '; trying ACS5 profile');
      // Try ACS 5-year vintage probe
      for (const v of window.HNAUtils.ACS_VINTAGES) {
        url2 = buildUrl(v, 'acs/acs5/profile');
        const resp = await _fetchCensusUrl(url2, 'ACS5 profile ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
      if (window.HNAUtils.DEBUG_HNA) console.warn('[HNA] fetchAcsProfile: ACS5 profile exhausted for ' + geoType + ':' + geoid + '; falling back to B-series');
      // ACS profile/subject tables may not support this geography or these
      // variable codes for the requested year.  Fall back to ACS 5-year
      // B-series which covers all geography types (county, place, CDP) and
      // uses stable variable codes.
      return await fetchAcs5BSeries(geoType, geoid);
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
    out._acsYear = usedYear;
    out._acsSeries = usedSeries;
    return out;
  }


  /**
   * F185 — Fetch ACS 5-year B01001 (Sex by Age) for places/counties and bin
   * the 23 ACS age bands into the 18 standard 5-year cohorts used by the
   * DOLA pyramid. Returns null on any fetch failure.
   *
   * Output shape mirrors the DOLA SYA shape consumed by renderDolaPyramid,
   * but binned at cohort level (not single year of age):
   *   { cohorts: [{label, male, female}, ...], year, source }
   */
  async function fetchAcsB01001(geoType, geoid) {
    if (geoType !== 'place' && geoType !== 'cdp' && geoType !== 'county') return null;
    _censusApiWarn();
    const vars = ['NAME'];
    for (let i = 1; i <= 49; i++) vars.push('B01001_' + String(i).padStart(3, '0') + 'E');
    const forParam = (geoType === 'place' || geoType === 'cdp')
      ? 'place:' + geoid.slice(2)
      : 'county:' + geoid.slice(2, 5);
    const inParam = 'state:' + window.HNAUtils.STATE_FIPS_CO;
    const key = window.HNAUtils.censusKey();
    function buildUrl(year) {
      const base = 'https://api.census.gov/data/' + year + '/acs/acs5';
      let qs = 'get=' + encodeURIComponent(vars.join(','));
      qs += '&for=' + forParam + '&in=' + inParam;
      if (key) qs += '&key=' + encodeURIComponent(key);
      return base + '?' + qs;
    }
    // Try primary then fall back through known vintages
    let resp = null;
    let usedYear = null;
    const years = [window.HNAUtils.ACS_YEAR_PRIMARY].concat(window.HNAUtils.ACS_VINTAGES || []);
    for (const y of years) {
      const r = await _fetchCensusUrl(buildUrl(y), 'ACS5 B01001 ' + geoType + ':' + geoid + ' y=' + y);
      if (r && r.ok) { resp = r; usedYear = y; break; }
    }
    if (!resp) return null;
    let json;
    try { json = await resp.json(); } catch (_) { return null; }
    if (!Array.isArray(json) || json.length < 2) return null;
    const header = json[0];
    const row    = json[1];
    const v = (name) => {
      const i = header.indexOf(name);
      return i >= 0 ? (parseInt(row[i], 10) || 0) : 0;
    };
    // 5-year cohort bins aligned to DOLA pyramid labels.
    const BINS = [
      { label: '0–4',   m: ['003'],             f: ['027'] },
      { label: '5–9',   m: ['004'],             f: ['028'] },
      { label: '10–14', m: ['005'],             f: ['029'] },
      { label: '15–19', m: ['006','007'],       f: ['030','031'] },
      { label: '20–24', m: ['008','009','010'], f: ['032','033','034'] },
      { label: '25–29', m: ['011'],             f: ['035'] },
      { label: '30–34', m: ['012'],             f: ['036'] },
      { label: '35–39', m: ['013'],             f: ['037'] },
      { label: '40–44', m: ['014'],             f: ['038'] },
      { label: '45–49', m: ['015'],             f: ['039'] },
      { label: '50–54', m: ['016'],             f: ['040'] },
      { label: '55–59', m: ['017'],             f: ['041'] },
      { label: '60–64', m: ['018','019'],       f: ['042','043'] },
      { label: '65–69', m: ['020','021'],       f: ['044','045'] },
      { label: '70–74', m: ['022'],             f: ['046'] },
      { label: '75–79', m: ['023'],             f: ['047'] },
      { label: '80–84', m: ['024'],             f: ['048'] },
      { label: '85+',   m: ['025'],             f: ['049'] }
    ];
    const cohorts = BINS.map(b => ({
      label:  b.label,
      male:   b.m.reduce((s, k) => s + v('B01001_' + k + 'E'), 0),
      female: b.f.reduce((s, k) => s + v('B01001_' + k + 'E'), 0)
    }));
    return { cohorts: cohorts, year: usedYear, source: 'ACS 5-year B01001 ' + usedYear };
  }


  /**
   * F188 — Fetch ACS 5-year B25009 (Tenure by Household Size) for the
   * selected geography. Returns renter-household counts by household size
   * (1-person through 7+-person) which the renderer translates to bedroom
   * need via the HUD "max 2 people per bedroom" standard. Returns null
   * on any fetch failure — the panel will show a placeholder, nothing
   * downstream blocks.
   */
  async function fetchAcsB25009(geoType, geoid) {
    if (geoType !== 'place' && geoType !== 'cdp' && geoType !== 'county' && geoType !== 'state') return null;
    _censusApiWarn();
    // Renter universe: B25009_010 (total) + 011-017 (HH size 1–7+)
    const vars = ['NAME','B25009_001E','B25009_010E','B25009_011E','B25009_012E','B25009_013E','B25009_014E','B25009_015E','B25009_016E','B25009_017E'];
    const forParam = geoType === 'state'
      ? 'state:' + window.HNAUtils.STATE_FIPS_CO
      : (geoType === 'place' || geoType === 'cdp')
        ? 'place:' + geoid.slice(2)
        : 'county:' + geoid.slice(2,5);
    const inParam = geoType === 'state' ? null : ('state:' + window.HNAUtils.STATE_FIPS_CO);
    const key = window.HNAUtils.censusKey();
    function buildUrl(year) {
      const base = 'https://api.census.gov/data/' + year + '/acs/acs5';
      let qs = 'get=' + encodeURIComponent(vars.join(','));
      qs += '&for=' + forParam;
      if (inParam) qs += '&in=' + inParam;
      if (key) qs += '&key=' + encodeURIComponent(key);
      return base + '?' + qs;
    }
    let resp = null;
    const years = [window.HNAUtils.ACS_YEAR_PRIMARY].concat(window.HNAUtils.ACS_VINTAGES || []);
    for (const y of years) {
      const r = await _fetchCensusUrl(buildUrl(y), 'ACS5 B25009 ' + geoType + ':' + geoid + ' y=' + y);
      if (r && r.ok) { resp = r; break; }
    }
    if (!resp) return null;
    let json;
    try { json = await resp.json(); } catch (_) { return null; }
    if (!Array.isArray(json) || json.length < 2) return null;
    const header = json[0];
    const row    = json[1];
    const v = (name) => {
      const i = header.indexOf(name);
      return i >= 0 ? (parseInt(row[i], 10) || 0) : 0;
    };
    return {
      renterTotal: v('B25009_010E'),
      renterBySize: {
        1: v('B25009_011E'),
        2: v('B25009_012E'),
        3: v('B25009_013E'),
        4: v('B25009_014E'),
        5: v('B25009_015E'),
        6: v('B25009_016E'),
        '7+': v('B25009_017E')
      }
    };
  }


  async function fetchAcs5BSeries(geoType, geoid){
    // ACS 5-year B-series fallback for all geography types (county, place, CDP, state).
    // Profile (DP) and subject (S) tables may fail due to geography constraints
    // or variable numbering changes across ACS releases.  The B-series detailed
    // tables cover all geography types and use stable variable codes.
    // Maps B-series codes to DP-series names for UI compatibility.
    const isState = geoType === 'state';
    const forParam = geoType === 'county'
      ? `county:${geoid.slice(-3)}`
      : isState
        ? `state:${window.HNAUtils.STATE_FIPS_CO}`
        : `place:${geoid.slice(2)}`;
    const key = window.HNAUtils.censusKey();
    const bVars = [
      'B01003_001E', // total population        → DP05_0001E
      'B11001_001E', // total households         → DP02_0001E
      'B19013_001E', // median household income  → DP03_0062E
      'B25001_001E', // total housing units      → DP04_0001E
      'B25003_001E', // occupied housing units
      'B25003_002E', // owner-occupied
      'B25003_003E', // renter-occupied
      'B25077_001E', // median home value        → DP04_0089E
      'B25064_001E', // median gross rent        → DP04_0134E
      'B25024_002E', 'B25024_003E', 'B25024_004E', 'B25024_005E',
      'B25024_006E', 'B25024_007E', 'B25024_008E', 'B25024_009E',
      'B25024_010E', // housing structure types  → DP04_0003E–0010E
      'B25070_001E', // renter-occupied paying rent (GRAPI denominator)
      'B25070_006E', // 25–29.9%
      'B25070_007E', // 30–34.9%                → DP04_0145PE
      'B25070_008E', // 35–39.9%
      'B25070_009E', // 40–49.9%
      'B25070_010E', // 50%+
    ];

    // Probe vintages newest-first for ACS 5-year B-series
    let bResp = null;
    let bYear = window.HNAUtils.ACS_YEAR_FALLBACK;
    for (const v of window.HNAUtils.ACS_VINTAGES) {
      const base = `https://api.census.gov/data/${v}/acs/acs5`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      // For state-level queries omit the &in= parameter (it is not needed).
      let qs = `get=${encodeURIComponent(bVars.join(',') + ',NAME')}&for=${forParam}`;
      if (!isState) qs += `&in=state:${window.HNAUtils.STATE_FIPS_CO}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      const u = `${base}?${qs}`;
      const resp = await _fetchCensusUrl(u, 'ACS5 B-series ' + geoType + ':' + geoid + ' y=' + v);
      if (resp && resp.ok){ bResp = resp; bYear = v; break; }
    }
    if (!bResp){
      throw new Error(`ACS profile unavailable for this geography`);
    }
    const arr = await bResp.json();
    const header = arr[0];
    const row = arr[1] || [];
    const raw = {};
    header.forEach((h,i)=>{ raw[h]=row[i]; });

    const si = v => { const n=parseInt(v,10); return Number.isFinite(n) && n>=0 ? n : null; };
    const occ = si(raw.B25003_001E);
    const owner = si(raw.B25003_002E);
    const renter = si(raw.B25003_003E);
    const grapiTot = si(raw.B25070_001E);
    const pct = (n) => (grapiTot && n!==null) ? String(Math.round(n/grapiTot*10000)/100) : null;
    const b35 = [raw.B25070_008E,raw.B25070_009E,raw.B25070_010E].map(si).filter(n=>n!==null);
    const burden35 = b35.length ? b35.reduce((a,b)=>a+b,0) : null;
    const s20_49 = si(raw.B25024_008E);
    const s50p = si(raw.B25024_009E);
    const units20p = (s20_49!==null||s50p!==null) ? (s20_49||0)+(s50p||0) : null;

    // Map B-series codes to canonical ACS 2023 DP04 codes.
    //
    // Pre-fix mapping wrote B25024_002E (1-unit detached) to DP04_0003E
    // ("Vacant" in real ACS 2023). That broke chartStock + any consumer
    // that read DP04_0003E expecting "vacant" or "1-unit detached"
    // depending on which spec they followed.
    //
    // Now we emit the canonical 2023 codes:
    //   DP04_0007E - 0014E: structure types
    //   DP04_0002E:         occupied housing units
    //   DP04_0046E/0047E:   owner/renter counts
    //   DP04_0046PE/0047PE: owner/renter percentages
    return {
      DP05_0001E: raw.B01003_001E,
      DP02_0001E: raw.B11001_001E,
      DP03_0062E: raw.B19013_001E,
      DP04_0001E: raw.B25001_001E,
      DP04_0002E: occ !== null ? String(occ) : null,                  // occupied (B25003_001E)
      DP04_0046E:  owner  !== null ? String(owner)  : null,            // owner count (B25003_002E)
      DP04_0047E:  renter !== null ? String(renter) : null,            // renter count (B25003_003E)
      DP04_0046PE: (occ && owner!==null)  ? String(Math.round(owner/occ*1000)/10)  : null,
      DP04_0047PE: (occ && renter!==null) ? String(Math.round(renter/occ*1000)/10) : null,
      DP04_0089E:  raw.B25077_001E,
      DP04_0134E:  raw.B25064_001E,
      // Structure types — canonical 2023 codes (DP04_0007E-0014E)
      DP04_0007E:  raw.B25024_002E, // 1-unit detached
      DP04_0008E:  raw.B25024_003E, // 1-unit attached
      DP04_0009E:  raw.B25024_004E, // 2 units
      DP04_0010E:  raw.B25024_005E, // 3-4 units
      DP04_0011E:  raw.B25024_006E, // 5-9 units
      DP04_0012E:  raw.B25024_007E, // 10-19 units
      DP04_0013E:  units20p !== null ? String(units20p) : null,        // 20+ (sum 20-49 + 50+)
      DP04_0014E:  raw.B25024_010E, // mobile home
      DP04_0142PE: null,
      DP04_0143PE: null,
      DP04_0144PE: pct(si(raw.B25070_006E)),
      DP04_0145PE: pct(si(raw.B25070_007E)),
      DP04_0146PE: pct(burden35),
      NAME: raw.NAME,
      _acsYear: bYear,
      _acsSeries: 'acs5',
    };
  }


  async function fetchAcsS0801(geoType, geoid){
    // Subject table S0801: commuting characteristics

    _censusApiWarn();

    // Validate GEOID format before building Census API URLs.
    if (geoType === 'county' && !/^\d{5}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsS0801: county GEOID "' + geoid + '" is not 5 digits; Census API call may fail.');
    }
    if ((geoType === 'place' || geoType === 'cdp') && !/^\d{7}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsS0801: place GEOID "' + geoid + '" is not 7 digits; Census API call may fail.');
    }

    const vars = [
      'S0801_C01_001E', // total workers 16+ (count)
      'S0801_C01_002E', // car, truck, or van — total (parent; drove-alone + carpooled)
      'S0801_C01_003E', // drove alone (%)
      'S0801_C01_004E', // carpooled (%)
      'S0801_C01_005E', // public transportation (%)
      'S0801_C01_006E', // walked (%)
      'S0801_C01_007E', // taxicab, motorcycle, bicycle, or other means (%)
      'S0801_C01_008E', // worked at home (%)
      'S0801_C01_018E', // mean travel time to work (minutes)
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'state'
        ? `state:${window.HNAUtils.STATE_FIPS_CO}`
        : geoType === 'place'
          ? `place:${geoid.slice(2)}`
          : `place:${geoid.slice(2)}`;

    const inParam = geoType === 'state' ? null : `state:${window.HNAUtils.STATE_FIPS_CO}`;
    const key = window.HNAUtils.censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}`;
      if (inParam) qs += `&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    // ACS 1-year data is not published for geographic units with fewer than
    // 65,000 residents (CDPs are the main example in Colorado). For CDPs, skip
    // the ACS1 probe entirely and go directly to ACS 5-year subject tables,
    // avoiding up to 5 unnecessary failing requests.
    let r = null;
    let usedYear = window.HNAUtils.ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';

    if (geoType !== 'cdp') {
      const url1 = buildUrl(window.HNAUtils.ACS_YEAR_PRIMARY, 'acs/acs1/subject');
      r = await _fetchCensusUrl(url1, 'ACS1 S0801 ' + geoType + ':' + geoid + ' y=' + window.HNAUtils.ACS_YEAR_PRIMARY);
      if (!r || !r.ok){
        // Probe vintages newest-first for ACS 1-year
        r = null;
        for (const v of window.HNAUtils.ACS_VINTAGES) {
          const u = buildUrl(v, 'acs/acs1/subject');
          const resp = await _fetchCensusUrl(u, 'ACS1 S0801 ' + geoType + ':' + geoid + ' y=' + v);
          if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
        }
      }
    }
    if (!r || !r.ok){
      if (window.HNAUtils.DEBUG_HNA) console.warn('[HNA] fetchAcsS0801: ACS1 exhausted for ' + geoType + ':' + geoid + '; trying ACS5 subject');
      // Try ACS 5-year vintage probe
      for (const v of window.HNAUtils.ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs5/subject');
        const resp = await _fetchCensusUrl(u, 'ACS5 S0801 ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
      const msg = 'ACS S0801 failed for ' + geoType + ':' + geoid + ' (tried ACS1 and ACS5 across all vintages)';
      throw new Error(msg);
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
    out._acsYear = usedYear;
    out._acsSeries = usedSeries;
    return out;
  }

  // --- Computations ---

  // ---------------------------------------------------------------
  // Labor Market helpers
  // ---------------------------------------------------------------

  // NAICS 2-digit sector labels (LEHD WAC CNS01-CNS20)

  async function renderProjections(countyFips5, selection){
    try{
      const proj = await loadJson(window.HNAUtils.PATHS.projections(countyFips5));
      window.HNAState.state.lastProj = proj;

      // Initialize vacancy slider — prefer ACS active-market vacancy
      // (HUD-aligned 5-7% band) over the cached projection's target.
      // Pre-2026-05 projection caches were generated with a broken
      // methodology that pinned 40+ counties to the 12% slider cap by
      // using DOLA's total observed vacancy (which includes seasonal /
      // 2nd-home / "other vacant" categories) as the planning target.
      // Live override fixes that until the ETL re-runs.
      const lastProfile = window.HNAState.state.lastProfile;
      const vacInfo = window.HNAUtils.computeActiveMarketTargetVacancy
        ? window.HNAUtils.computeActiveMarketTargetVacancy(lastProfile)
        : null;
      let defaultVac = vacInfo ? vacInfo.target : null;
      const observedTotal = window.HNAUtils.safeNum(proj?.housing_need?.observed_total_vacancy);
      if (defaultVac == null) {
        defaultVac = window.HNAUtils.safeNum(proj?.housing_need?.target_vacancy);
      }
      if (window.HNAState.els.assumpVacancy && defaultVac != null) {
        const cur = Number(window.HNAState.els.assumpVacancy.value);
        if (!Number.isFinite(cur) || cur === 5) {
          window.HNAState.els.assumpVacancy.value = String(Math.round(defaultVac * 1000) / 10);
          window.HNAState.els.assumpVacancyVal.textContent = `${Number(window.HNAState.els.assumpVacancy.value).toFixed(1)}%`;
        }
      }
      if (window.HNAState.els.assumpVacancyVal){
        window.HNAState.els.assumpVacancyVal.textContent = `${Number(window.HNAState.els.assumpVacancy?.value || 5).toFixed(1)}%`;
      }

      // Render the "Observed vs Target" disclosure beneath the slider so
      // users can see WHY the target ended up where it did, especially
      // for resort/seasonal counties where the headline observed total
      // is much higher than the active-market subset.
      const sliderEl = window.HNAState.els.assumpVacancy;
      const sliderHost = sliderEl && sliderEl.closest('.span-4');
      if (sliderHost) {
        let note = document.getElementById('vacancyTargetMethodologyNote');
        const observedActive = vacInfo && vacInfo.observedActive;
        if (observedActive != null || observedTotal != null) {
          if (!note) {
            note = document.createElement('div');
            note.id = 'vacancyTargetMethodologyNote';
            note.style.cssText = 'margin-top:6px;font-size:.72rem;line-height:1.35;color:var(--muted);';
            sliderHost.appendChild(note);
          }
          const fmt = (v) => (v != null && Number.isFinite(v)) ? (v * 100).toFixed(1) + '%' : '—';
          const sourceLabel =
            vacInfo && vacInfo.source === 'acs-tenure-weighted' ? 'ACS active-market (for-sale + for-rent, tenure-weighted)' :
            vacInfo && vacInfo.source === 'acs-rental-only'     ? 'ACS rental vacancy (DP04_0005E)' :
                                                                   'HUD healthy-market default';
          note.innerHTML =
            '<div><strong>Observed active-market:</strong> ' + fmt(observedActive) +
            (observedTotal != null ? ' · <strong>DOLA total (incl. seasonal):</strong> ' + fmt(observedTotal) : '') +
            '</div>' +
            '<div style="margin-top:2px">Planning target = HUD 5% floor → 7% cap. Source: ' + sourceLabel + '.</div>';
        } else if (note) {
          note.remove();
        }
      }

      await applyAssumptions(proj, selection);

      // Clear any prior data-unavailable notice in the scenario section
      const scenNote = document.getElementById('scenarioProjectionsNote');
      if (scenNote) { scenNote.textContent = ''; scenNote.hidden = true; }

      return { ok:true, proj };
    }catch(e){
      // Log real error so browser console shows the actual failure, not just the generic message.
      console.error('[HNA] renderProjections failed — actual error:', e);
      window.HNAState.state.lastProj = null;
      // Clear projection stat cards gracefully (null-guarded to prevent crash on partial DOM)
      if (window.HNAState.els.statBaseUnits) window.HNAState.els.statBaseUnits.textContent = '—';
      if (window.HNAState.els.statBaseUnitsSrc) window.HNAState.els.statBaseUnitsSrc.textContent = '—';
      if (window.HNAState.els.statTargetVac) window.HNAState.els.statTargetVac.textContent = '—';
      if (window.HNAState.els.statUnitsNeed) window.HNAState.els.statUnitsNeed.textContent = '—';
      if (window.HNAState.els.statNetMig) window.HNAState.els.statNetMig.textContent = '—';
      if (window.HNAState.els.needNote) window.HNAState.els.needNote.textContent = 'Projections module not available yet (run the Build HNA data workflow).';
      // Show a visible notice in the scenario section so users know charts are unavailable
      const scenNote = document.getElementById('scenarioProjectionsNote');
      if (scenNote) {
        scenNote.textContent = 'Scenario projections are not available for this geography yet. Run the Build HNA data workflow to populate.';
        scenNote.hidden = false;
      }
      return { ok:false, err:String(e) };
    }
  }


  /**
   * fetchAcsExtended — supplemental ACS fetch for extended analysis variables.
   *
   * The cached summary files (data/hna/summary/*.json) store only ~22 snapshot
   * fields (population, income, home value, rent, tenure, structure type counts).
   * The extended analysis charts — Income Distribution, Age of Housing Stock,
   * Bedroom Mix, Owner Cost Burden, Housing Gap, Special Needs — require ~36
   * additional DP03/DP04/DP05/DP02 variables that are NOT in the cache.
   *
   * This function fetches those missing variables from the ACS 5-year profile API
   * and returns them as a flat object so they can be merged into the cached profile.
   * Uses ACS 5-year (acs5) for reliability across all Colorado geography sizes.
   *
   * Called from update() when a cached profile exists but lacks DP03_0052E
   * (the income bracket field that gates all extended chart rendering).
   */
  async function fetchAcsExtended(geoType, geoid) {
    // Split into two batches to stay well under the ACS profile API's 50-variable limit.
    // Batch A: Housing + income vars (DP03 + DP04) — 41 variables
    // Batch B: Special needs population vars (DP05 + DP02) — 9 variables
    // Each batch is fetched independently; a failure in one does not prevent the other
    // from returning data, so charts that depend on only one batch still render.

    var batchA = [
      // Income distribution (DP03 income brackets — renderIncomeDistribution,
      // AMI-tier proxies in renderHousingGapSummary)
      'DP03_0052E','DP03_0053E','DP03_0054E','DP03_0055E',
      'DP03_0056E','DP03_0057E','DP03_0058E','DP03_0059E','DP03_0060E',
      // Age of housing stock (DP04 YEAR STRUCTURE BUILT — renderHousingAgeChart)
      // ACS 5-year 2023: DP04_0017E (2020+) … DP04_0026E (pre-1940)
      // DP04_0027E–DP04_0032E are ROOMS variables — do NOT request them here
      'DP04_0017E','DP04_0018E','DP04_0019E','DP04_0020E','DP04_0021E',
      'DP04_0022E','DP04_0023E','DP04_0024E','DP04_0025E','DP04_0026E',
      // Bedroom mix detail (DP04 BEDROOMS — renderBedroomMixChart)
      // ACS 5-year 2023: DP04_0039E (no BR) … DP04_0044E (5+ BR)
      'DP04_0039E','DP04_0040E','DP04_0041E','DP04_0042E','DP04_0043E','DP04_0044E',
      // Structure type (ACS 2023: DP04_0007E=1-unit detached … DP04_0014E=mobile home)
      'DP04_0007E','DP04_0008E','DP04_0009E','DP04_0010E',
      'DP04_0011E','DP04_0012E','DP04_0013E','DP04_0014E',
      // F160 — Owner-occupied home value distribution (chartHomeValue).
      // DP04_0080E = total; 0081E-0088E = bracket counts (<\$50K → \$1M+).
      // The median (DP04_0089E) is in primary fetch; brackets ride here so
      // cached summaries still populate the chart via the supplement.
      'DP04_0080E','DP04_0081E','DP04_0082E','DP04_0083E',
      'DP04_0084E','DP04_0085E','DP04_0086E','DP04_0087E','DP04_0088E',
      // Owner cost burden bins (DP04 SMOCAPI — renderOwnerCostBurdenChart) ✅ stable codes
      'DP04_0111PE','DP04_0112PE','DP04_0113PE','DP04_0114PE','DP04_0115PE',
      // Renter HH count + GRAPI rent burden bins (renderHousingGapSummary)
      // DP04_0047E = renter-occupied count (confirmed ✅)
      // DP04_0141PE = 30–34.9%, DP04_0142PE = 35%+ (ACS 2023 confirmed codes)
      'DP04_0047E','DP04_0141PE','DP04_0142PE',
      // ── Tenure + occupancy supplement (2026-05-12 fix) ────────────────
      // Cached summary files (data/hna/summary/*.json) were built before
      // PR #796 wired these into fetchAcsProfile and don't contain them.
      // chartTenure needs DP04_0046E for the owner-slice count; chartStock
      // (post-PR #796 structure-type bars) doesn't need them but kept here
      // so any place/county selection that hits the cache + extended-fetch
      // path gets the full tenure picture without waiting for the next
      // CHAS/ACS data-refresh cron to regenerate every summary file.
      'DP04_0002E','DP04_0003E','DP04_0046E',
    ];                                                        // 44 variables (still <50 ACS limit)

    var batchB = [
      // Special needs population (renderSpecialNeedsPanel)
      'DP05_0016E', // 75–84 years (used to compute 75+ aggregate)
      'DP05_0017E', // 85 years and over
      'DP05_0019E', // Under 18 years
      'DP05_0024E', // 65 years and over (primary 65+ aggregate)
      'DP05_0029E', // 65 years and over (secondary/vintage fallback)
      'DP02_0003E', // family households
      'DP02_0009E', // male single-parent HH
      'DP02_0013E', // female single-parent HH
      'DP02_0072E', // with a disability
      // F169 — Household composition + occupation + labor-force status.
      // Powers the "Household composition, occupation & labor force"
      // panel: household type (married / cohabiting / single parent /
      // living alone / other), averages, occupation mix, retiree proxy.
      // NOTE: DP02_0034-0040E in 2023 vintage are marital/fertility, NOT
      // 1-7+ person household-size bins as older docs suggest; that
      // distribution lives in detail table B11016 (different endpoint),
      // so this panel reframes around household *type* instead of *size*.
      'DP02_0001E', // Total households
      'DP02_0002E', // Married-couple
      'DP02_0004E', // Cohabiting couple
      'DP02_0006E', // Male householder, no spouse/partner
      'DP02_0007E', // Male HH no spouse, with kids under 18 (single dad)
      'DP02_0008E', // Male HH living alone
      'DP02_0010E', // Female householder, no spouse/partner
      'DP02_0011E', // Female HH no spouse, with kids under 18 (single mom)
      'DP02_0012E', // Female HH living alone
      'DP02_0014E', // Households with one or more people under 18
      'DP02_0015E', // Households with one or more people 65+
      'DP02_0016E', // Average household size
      'DP02_0017E', // Average family size
      // Occupation (DP03 — 5 top-level OCC buckets, civilian employed 16+):
      'DP03_0027E', // Management / business / science / arts
      'DP03_0028E', // Service
      'DP03_0029E', // Sales / office
      'DP03_0030E', // Natural resources, construction, maintenance
      'DP03_0031E', // Production, transportation, material moving
      // Labor force status (DP03):
      'DP03_0002E', // Population 16+ in labor force
      'DP03_0005E', // Unemployed (civilian labor force)
      'DP03_0007E', // Not in labor force
      // F170 — Educational attainment (Population 25+):
      'DP02_0059E', // Total pop 25+
      'DP02_0060E', // Less than 9th grade
      'DP02_0061E', // 9th-12th grade, no diploma
      'DP02_0062E', // High school grad
      'DP02_0063E', // Some college, no degree
      'DP02_0064E', // Associate's degree
      'DP02_0065E', // Bachelor's degree
      'DP02_0066E', // Graduate or professional degree
      'DP02_0067E', // HS grad or higher (count)
      'DP02_0068E', // Bachelor's or higher (count)
      // F170 — Race / ethnicity (DP05 — all "alone" categories):
      'DP05_0033E', // Total population (RACE denominator)
      'DP05_0037E', // White alone
      'DP05_0038E', // Black or African American alone
      'DP05_0039E', // American Indian / Alaska Native alone
      'DP05_0047E', // Asian alone
      'DP05_0055E', // Native Hawaiian / Pacific Islander alone
      'DP05_0060E', // Some Other Race alone
      'DP05_0061E', // Two or more races
      'DP05_0076E', // Hispanic or Latino (any race)
      'DP05_0082E', // Not Hispanic, White alone
    ];                                                        // 50 variables

    var forParam = geoType === 'county'
      ? 'county:' + geoid.slice(2, 5)
      : geoType === 'state'
        ? 'state:' + window.HNAUtils.STATE_FIPS_CO
        : 'place:' + geoid.slice(2);
    var inParam  = geoType === 'state' ? null : 'state:' + window.HNAUtils.STATE_FIPS_CO;
    var key      = window.HNAUtils.censusKey();
    var year     = window.HNAUtils.ACS_YEAR_PRIMARY || 2023;

    function buildUrl(yr, vars) {
      var base = 'https://api.census.gov/data/' + yr + '/acs/acs5/profile';
      var qs   = 'get=' + encodeURIComponent(vars.join(',')) + '&for=' + forParam;
      if (inParam) qs += '&in=' + inParam;
      if (key)     qs += '&key=' + encodeURIComponent(key);
      return base + '?' + qs;
    }

    // Fetch one batch; returns a flat {varCode: value} object or {} on failure.
    async function fetchBatch(vars, label) {
      try {
        var r = await fetch(buildUrl(year, vars));
        if (!r.ok && year !== 2022) r = await fetch(buildUrl(2022, vars));
        if (!r.ok) {
          console.warn('fetchAcsExtended batch ' + label + ' HTTP ' + r.status + ' — skipping');
          return {};
        }
        var j   = await r.json();
        var hdr = j[0];
        var row = j[1] || [];
        var out = {};
        hdr.forEach(function(k, i) { out[k] = row[i]; });
        return out;
      } catch (e) {
        console.warn('fetchAcsExtended batch ' + label + ' error:', e);
        return {};
      }
    }

    // Run both batches concurrently; merge results (batchB wins on any overlap — none expected).
    var results = await Promise.all([
      fetchBatch(batchA, 'A (housing+income)'),
      fetchBatch(batchB, 'B (special-needs pop)'),
    ]);
    return Object.assign({}, results[0], results[1]);
  }


  async function fetchAcs5Trend(year, geoType, geoid){
    // Minimal ACS5 profile pull used for trend estimates (population + households).
    // This is only used for municipal scaling and headship trend when user selects "Trend".
    const vars = ['DP05_0001E','DP02_0001E'].join(',');
    const key = window.HNAUtils.censusKey();
    const stateF = geoid.slice(0,2);
    const code = geoid.slice(2);

    const dataset = `https://api.census.gov/data/${year}/acs/acs5/profile`;
    const forPart = (geoType==='county') ? `county:${code}` : `place:${code}`;
    const inPart = `state:${stateF}`;

    const keySuffix = key ? '&key=' + encodeURIComponent(key) : '';
    const url = `${dataset}?get=${encodeURIComponent(vars)}&for=${encodeURIComponent(forPart)}&in=${encodeURIComponent(inPart)}` + keySuffix;
    const r = await fetch(url);
    if (!r.ok){
      // For CDPs, ACS5 profile may not support CDP geography; fall back to B-series.
      if (geoType === 'cdp'){
        const bUrl = `https://api.census.gov/data/${year}/acs/acs5?get=${encodeURIComponent('B01003_001E,B11001_001E,NAME')}&for=` + encodeURIComponent('place:' + code) + `&in=${encodeURIComponent(inPart)}` + keySuffix;
        const rb = await fetch(bUrl);
        if (!rb.ok) throw new Error(`ACS5 trend HTTP ${rb.status}`);
        const jb = await rb.json();
        const hb = jb[0], rowb = jb[1] || [];
        const ob = {};
        hb.forEach((k,i)=> ob[k]=rowb[i]);
        return { pop: window.HNAUtils.safeNum(ob.B01003_001E), hh: window.HNAUtils.safeNum(ob.B11001_001E), year };
      }
      throw new Error(`ACS5 trend HTTP ${r.status}`);
    }
    const j = await r.json();
    const h = j[0], row = j[1] || [];
    const out = {};
    h.forEach((k,i)=> out[k]=row[i]);
    return { pop: window.HNAUtils.safeNum(out.DP05_0001E), hh: window.HNAUtils.safeNum(out.DP02_0001E), year };
  }


  async function applyAssumptions(proj, selection){
    if (!proj) return;

    const countyFips5 = proj?.countyFips || selection?.contextCounty || (selection?.geoType==='county' ? selection?.geoid : null);

    const years = proj?.years || [];
    const popCounty = (proj?.population_dola || []).map(window.HNAUtils.safeNum);
    const popCountyTrend = (proj?.population_trend || []).map(window.HNAUtils.safeNum);
    const baseYear = proj?.baseYear;
    const baseCountyPop = window.HNAUtils.safeNum(proj?.base?.population);

    const { horizon, targetVac, headshipMode } = window.HNARenderers.getAssumptions();

    // Determine selected-geo population series
    let popSel = popCounty;
    let popSelTrend = popCountyTrend;
    let baseUnits = window.HNAUtils.safeNum(proj?.base?.housing_units);
    let baseHouseholds = window.HNAUtils.safeNum(proj?.base?.households);
    let basePop = baseCountyPop;

    let headship0 = (baseHouseholds && basePop) ? (baseHouseholds/basePop) : null;
    let headshipSlope = 0; // annual delta, used in "trend"

    // If selection is a place/CDP, scale projections from containing county.
    // State-level: projections are loaded directly for '08', no scaling needed.
    if (selection && selection.geoType !== 'county' && selection.geoType !== 'state'){
      const placePopNow = window.HNAUtils.safeNum(selection.profile?.DP05_0001E);
      const placeHhNow = window.HNAUtils.safeNum(selection.profile?.DP02_0001E);
      const placeUnitsNow = window.HNAUtils.safeNum(selection.profile?.DP04_0001E);

      if (baseCountyPop && placePopNow){
        // Prefer ETL-derived inputs (transparent and repeatable). Fall back to simple share if missing.
        const d = window.HNAState.state.derived?.geos?.[selection.geoid]?.derived || null;
        const dAcs = window.HNAState.state.derived?.geos?.[selection.geoid]?.acs5 || null;

        const share0Raw = (d && typeof d.share0 === 'number') ? d.share0 : (placePopNow / baseCountyPop);
        const share0 = Math.min(0.98, Math.max(0.02, share0Raw));

        // relative_pop_cagr is an annual *rate*. Convert to log-diff so we can exponentiate over time.
        const relRate = (d && typeof d.relative_pop_cagr === 'number') ? d.relative_pop_cagr : 0;
        const diffLog = (relRate && Number.isFinite(relRate)) ? Math.log(1 + relRate) : 0;

        // Headship (households/pop) base + slope (optional) from ETL
        if (d && typeof d.headship_base === 'number' && Number.isFinite(d.headship_base)){
          headship0 = d.headship_base;
        } else {
          headship0 = (placeHhNow && placePopNow) ? (placeHhNow/placePopNow) : headship0;
        }
        headshipSlope = (d && typeof d.headship_slope_per_year === 'number' && Number.isFinite(d.headship_slope_per_year))
          ? d.headship_slope_per_year
          : 0;

        popSel = popCounty.map((p,i)=>{
          if (p===null) return null;
          const shareT = Math.min(0.98, Math.max(0.02, share0 * Math.exp(diffLog * i)));
          const v = p * shareT;
          return Math.min(v, p); // never exceed county
        });
        popSelTrend = popCountyTrend.map((p,i)=>{
          if (p===null) return null;
          const shareT = Math.min(0.98, Math.max(0.02, share0 * Math.exp(diffLog * i)));
          const v = p * shareT;
          return Math.min(v, p);
        });

        baseUnits = placeUnitsNow;
        baseHouseholds = placeHhNow;
        basePop = placePopNow;
        // headship0 was already set from derived data (lines above) — do not overwrite
        // with the simple ACS ratio here; that would discard the ETL-computed headship_base.
      }
    } else {
      // County headship slope (optional)
      try{
        const geoId = selection?.geoid || countyFips5;
        const d = geoId ? window.HNAState.state.derived?.geos?.[geoId]?.derived : null;
        if (d && typeof d.headship_slope_per_year === 'number' && Number.isFinite(d.headship_slope_per_year)){
          headshipSlope = d.headship_slope_per_year;
        } else {
          headshipSlope = 0;
        }
      }catch(_){ headshipSlope = 0; }
    }

    // Compute need at horizon
    const idx = years.findIndex(y => y === baseYear + horizon);
    const i = (idx>=0) ? idx : (years.length ? years.length-1 : -1);

    function headshipAt(step){
      if (headship0 === null) return null;
      if (headshipMode === 'trend'){
        const hs = headship0 + headshipSlope * step;
        return Math.max(0.05, Math.min(0.95, hs));
      }
      return headship0;
    }

    const popH = (i>=0) ? popSel[i] : null;
    const hsH = (i>=0) ? headshipAt(i) : null;
    const hhH = (popH!==null && hsH!==null) ? (popH * hsH) : null;
    const needUnits = (hhH!==null) ? (hhH / (1.0 - targetVac)) : null;
    const incUnits = (needUnits!==null && baseUnits!==null) ? (needUnits - baseUnits) : null;

    // Net migration scaled for places/CDPs (share of county base).
    // State-level projections are loaded directly for '08' — no scaling needed.
    let net20 = window.HNAUtils.safeNum(proj?.net_migration_20y);
    if (selection && selection.geoType !== 'county' && selection.geoType !== 'state' && baseCountyPop && basePop){
      const d = window.HNAState.state.derived?.geos?.[selection.geoid]?.derived || null;
      const share0 = Math.min(0.98, Math.max(0.02, (d && typeof d.share0 === 'number') ? d.share0 : (basePop / baseCountyPop)));
      net20 = (net20!==null) ? (net20 * share0) : null;
    }

    // Update cards
    window.HNAState.els.statBaseUnits.textContent = baseUnits !== null ? window.HNAUtils.fmtNum(baseUnits) : '—';
    window.HNAState.els.statBaseUnitsSrc.textContent = baseYear ? `Base (est.)` : 'Base';
    window.HNAState.els.statTargetVac.textContent = window.HNAUtils.fmtPct(targetVac * 100);
    window.HNAState.els.statUnitsNeed.textContent = incUnits !== null ? window.HNAUtils.fmtNum(Math.round(incUnits)) : '—';
    window.HNAState.els.statNetMig.textContent = net20 !== null ? window.HNAUtils.fmtNum(Math.round(net20)) : '—';

    const endYear = (i>=0 && years[i]) ? years[i] : (years.length ? years[years.length-1] : '');
    window.HNAState.els.needNote.textContent = (incUnits !== null)
      ? `Planning estimate: additional units needed by ${endYear} (horizon ${horizon}y), headship=${headshipMode}, vacancy target ${window.HNAUtils.fmtPct(targetVac*100)}.`
      : 'Projections loaded, but could not compute housing need (missing households/headship).';

    // Update projection chart for selected geography
    const t = window.HNARenderers.chartTheme();
    // Label prefix differs by jurisdiction type:
    //   county → "Population (DOLA forecast)"
    //   state  → "Population (statewide DOLA forecast)"
    //   place/CDP → "Population (scaled from county DOLA forecast)"
    let labelPrefix;
    if (!selection || selection.geoType === 'county') {
      labelPrefix = 'Population (';
    } else if (selection.geoType === 'state') {
      labelPrefix = 'Population (statewide ';
    } else {
      labelPrefix = 'Population (scaled from county ';
    }
    // Null-guard: canvas must exist before calling getContext. If the element is
    // missing for any reason, skip the chart rather than throwing and killing the
    // entire projection flow (which would trigger the catch block and show the
    // misleading "run the workflow" message).
    var projCanvas = document.getElementById('chartPopProj');
    if (projCanvas) {
      // Explicit dataset colors (2026-06-01) — F19 set Chart.defaults.color
      // and .borderColor to theme tokens for axis labels + gridlines, but
      // datasets without an explicit borderColor were falling back to the
      // same low-contrast --border token, making both lines unreadable in
      // dark mode. Use the chart-theme accent + warn colors so the
      // sensitivity-trend stays visually distinct from the DOLA baseline.
      var popBaselineColor = t.c1 || t.accent || '#0ea5e9';
      var popTrendColor    = t.c3 || '#d97706';
      window.HNARenderers.makeChart(projCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [
            {
              label: `${labelPrefix}DOLA forecast)`,
              data: popSel,
              borderColor: popBaselineColor,
              backgroundColor: popBaselineColor + '22',
              borderWidth: 2.5, pointRadius: 0, tension: 0.25,
            },
            {
              label: `${labelPrefix}historic-trend sensitivity)`,
              data: popSelTrend,
              borderColor: popTrendColor,
              backgroundColor: 'transparent',
              borderWidth: 2.5, pointRadius: 0, borderDash:[6,4], tension: 0.25,
            },
          ]
        },
        options: {
          responsive:true,
          maintainAspectRatio:false,
          plugins:{
            legend:{ labels:{ color:t.text } },
            tooltip:{ callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${window.HNAUtils.fmtNum(ctx.parsed.y)}` } }
          },
          scales:{
            x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
            y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          }
        }
      });
    }

    // ---- Scenario comparison charts (5–10 year horizon section) ----
    try {
      window.HNARenderers._renderScenarioSection(proj, popSel, years, baseYear, countyFips5, t);
    } catch(scErr) {
      console.error('[HNA] _renderScenarioSection failed:', scErr);
    }
  }

  /**
   * _renderScenarioSection — populate the three scenario-based projection charts
   * (population comparison, single-scenario detail, household projection, and
   * housing-demand-by-AMI-tier).  Called from applyAssumptions so all four
   * canvases update whenever the geography or assumptions change.
   */

  const scenarioState = {
    current: 'baseline',
  };


  function getSelectedScenario(){
    const el = document.getElementById('projScenario');
    return el ? el.value : 'baseline';
  }


  function getScenarioRateOverrides(){
    const fertility  = parseFloat((document.getElementById('scenFertility')  || {}).value);
    const migration  = parseFloat((document.getElementById('scenMigration')  || {}).value);
    const mortality  = parseFloat((document.getElementById('scenMortality')  || {}).value);
    return {
      fertilityMultiplier: Number.isFinite(fertility)  ? fertility  : 1.0,
      netMigrationAnnual:  Number.isFinite(migration)  ? migration  : 500,
      mortalityMultiplier: Number.isFinite(mortality)  ? mortality  : 1.0,
    };
  }


  function updateScenarioDescription(){
    const sc   = getSelectedScenario();
    const meta = window.HNAUtils.PROJECTION_SCENARIOS[sc];
    const el   = document.getElementById('scenarioDescription');
    if (el && meta) el.textContent = meta.description;
  }


  function wireScenarioControls(){
    const scenarioSel = document.getElementById('projScenario');
    if (scenarioSel){
      scenarioSel.addEventListener('change', () => {
        const sc   = scenarioSel.value;
        const meta = window.HNAUtils.PROJECTION_SCENARIOS[sc];
        if (!meta) return;
        // Pre-populate sliders with scenario defaults
        const defaults = {
          baseline:   { fertility: 1.0,  migration: 500,  mortality: 1.0  },
          low_growth: { fertility: 0.90, migration: 250,  mortality: 1.02 },
          high_growth:{ fertility: 1.05, migration: 1000, mortality: 0.98 },
        };
        const d = defaults[sc] || defaults.baseline;
        const fEl = document.getElementById('scenFertility');
        const mEl = document.getElementById('scenMigration');
        const rEl = document.getElementById('scenMortality');
        if (fEl){ fEl.value = d.fertility;  _updateSliderLabel('scenFertilityVal',  d.fertility.toFixed(2)); }
        if (mEl){ mEl.value = d.migration;  _updateSliderLabel('scenMigrationVal',  Math.round(d.migration)); }
        if (rEl){ rEl.value = d.mortality;  _updateSliderLabel('scenMortalityVal',  d.mortality.toFixed(2)); }
        updateScenarioDescription();
        // Re-render the projection charts if data is loaded
        if (window.HNAState.state.lastProj && window.HNAState.state.current){ applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current); }
      });
    }

    // Slider live-update labels
    // Debounce timer: chart re-renders are deferred 300 ms so rapid slider
    // drags don't trigger a repaint on every pixel move (performance).
    let _sliderDebounce = null;
    [
      ['scenFertility', 'scenFertilityVal', v => Number(v).toFixed(2)],
      ['scenMigration', 'scenMigrationVal', v => Math.round(Number(v)).toLocaleString()],
      ['scenMortality', 'scenMortalityVal', v => Number(v).toFixed(2)],
    ].forEach(([sliderId, labelId, fmt]) => {
      const slider = document.getElementById(sliderId);
      if (slider){
        slider.addEventListener('input', () => {
          _updateSliderLabel(labelId, fmt(slider.value));
          // Debounce chart re-render to avoid rapid repaints on slider drag
          clearTimeout(_sliderDebounce);
          _sliderDebounce = setTimeout(() => {
            if (window.HNAState.state.lastProj && window.HNAState.state.current){ applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current); }
          }, 300);
        });
      }
    });

    // Save custom scenario button
    const saveBtn = document.getElementById('btnSaveCustomScenario');
    if (saveBtn){
      saveBtn.addEventListener('click', () => {
        const overrides = getScenarioRateOverrides();
        const name = 'Custom: f×' + overrides.fertilityMultiplier.toFixed(2) +
                     ' mig ' + Math.round(overrides.netMigrationAnnual) +
                     ' mort×' + overrides.mortalityMultiplier.toFixed(2);
        window.HNAUtils.PROJECTION_SCENARIOS['custom'] = {
          label:       'Custom',
          description: name,
          color:       '#9c27b0',
        };
        const sel = document.getElementById('projScenario');
        if (sel){
          // Add custom option if not already present
          if (!sel.querySelector('option[value="custom"]')){
            const opt = document.createElement('option');
            opt.value = 'custom';
            opt.textContent = 'Custom';
            sel.appendChild(opt);
          }
          sel.value = 'custom';
        }
        updateScenarioDescription();
        if (window.HNAState.state.lastProj && window.HNAState.state.current){ applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current); }
        if (typeof window.__announceUpdate === 'function') {
          window.__announceUpdate('Custom scenario saved: ' + name);
        }
      });
    }

    // Reset to scenario defaults button
    const resetBtn = document.getElementById('btnResetScenarioDefaults');
    if (resetBtn){
      resetBtn.addEventListener('click', () => {
        const sc = getSelectedScenario();
        const defaults = {
          baseline:   { fertility: 1.0,  migration: 500,  mortality: 1.0  },
          low_growth: { fertility: 0.90, migration: 250,  mortality: 1.02 },
          high_growth:{ fertility: 1.05, migration: 1000, mortality: 0.98 },
          custom:     { fertility: 1.0,  migration: 500,  mortality: 1.0  },
        };
        const d = defaults[sc] || defaults.baseline;
        const fEl = document.getElementById('scenFertility');
        const mEl = document.getElementById('scenMigration');
        const rEl = document.getElementById('scenMortality');
        if (fEl){ fEl.value = d.fertility;  _updateSliderLabel('scenFertilityVal',  d.fertility.toFixed(2)); }
        if (mEl){ mEl.value = d.migration;  _updateSliderLabel('scenMigrationVal',  Math.round(d.migration).toLocaleString()); }
        if (rEl){ rEl.value = d.mortality;  _updateSliderLabel('scenMortalityVal',  d.mortality.toFixed(2)); }
        if (window.HNAState.state.lastProj && window.HNAState.state.current){ applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current); }
      });
    }

    // View toggle (population / household / housing demand)
    const viewToggle = document.querySelectorAll('input[name="projViewToggle"]');
    viewToggle.forEach(r => r.addEventListener('change', () => {
      const val = r.value;
      // Destroy Chart.js instances in all containers before hiding to prevent
      // double-initialization when the container is shown again (charts created
      // while hidden have 0x0 dimensions and may not resize correctly).
      ['projViewPop', 'projViewHH', 'projViewDemand'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (typeof Chart !== 'undefined') {
          el.querySelectorAll('canvas').forEach(canvas => {
            const ch = Chart.getChart(canvas);
            if (ch) ch.destroy();
          });
        }
        el.hidden = true;
      });
      const showId = val === 'population' ? 'projViewPop'
                   : val === 'household'  ? 'projViewHH'
                   : 'projViewDemand';
      const showEl = document.getElementById(showId);
      if (showEl) {
        showEl.hidden = false;
        // Re-render charts for the newly visible view. Using applyAssumptions
        // ensures charts are created while the container is visible, so they
        // get correct dimensions on first render.
        if (window.HNAState.state.lastProj && window.HNAState.state.current) {
          applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current).catch(e => {
            console.warn('[HNA] applyAssumptions error on view toggle', e);
          });
        }
        // Announce view change to screen readers (WCAG 4.1.3)
        const viewLabel = val === 'population' ? 'Population projection'
                        : val === 'household'  ? 'Household projection'
                        : 'Housing demand by AMI tier';
        if (typeof window.__announceUpdate === 'function') {
          window.__announceUpdate(`Scenario view changed to: ${viewLabel}`);
        }
      }
    }));

    // Export scenario CSV button
    const exportBtn = document.getElementById('btnExportScenario');
    if (exportBtn){
      exportBtn.addEventListener('click', () => {
        exportScenarioCSV();
      });
    }
  }

  /**
   * exportScenarioCSV — build a CSV of all scenario projection series and
   * trigger a browser download.  Falls back silently if no data is loaded.
   */
  function exportScenarioCSV(){
    const state = window.HNAState && window.HNAState.state;
    if (!state || !state.lastScenarioSeries) {
      if (typeof window.__announceUpdate === 'function') {
        window.__announceUpdate('No scenario data available to export. Select a geography first.');
      }
      return;
    }
    const series    = state.lastScenarioSeries;     // {scenarioKey: [{year, population}, ...]}
    const geoLabel  = state.lastGeoLabel || 'geography';
    const scenarios = Object.keys(series);
    if (!scenarios.length) return;

    // Build header row
    const header = ['Year', ...scenarios.map(sc => {
      const meta = (window.HNAUtils && window.HNAUtils.PROJECTION_SCENARIOS[sc]) || {};
      return meta.label || sc;
    })];

    // Collect all years across scenarios (sorted ascending)
    const allYears = [...new Set(scenarios.flatMap(sc => (series[sc] || []).map(p => p.year)))].sort((a,b) => a - b);

    const rows = [header];
    allYears.forEach(yr => {
      const row = [yr];
      scenarios.forEach(sc => {
        const pt = (series[sc] || []).find(p => p.year === yr);
        row.push(pt ? pt.population : '');
      });
      rows.push(row);
    });

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `hna-scenario-projections-${geoLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate('Scenario comparison exported to CSV.');
    }
  }


  function _updateSliderLabel(labelId, text){
    const el = document.getElementById(labelId);
    if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------------------
  // End demographic projection helpers
  // ---------------------------------------------------------------------------


  async function update(){
    var ws = document.getElementById('hnaWaitingState');
    if (ws) ws.style.display = 'none';
    window.HNARenderers.showAllChartsLoading();
    const geoType = window.HNAState.els.geoType.value;
    const geoid = window.HNAState.els.geoSelect.value;

    // Sync CHFA PMA checklist state: saves old geography's state and restores
    // saved state for the new geography (or defaults to all-unchecked).
    if (window.ChfaPmaChecklist) {
      window.ChfaPmaChecklist.initChfaChecklist(geoType, geoid);
    }

    const label = (()=>{
      if (geoType === 'state') return 'State of Colorado';
      const conf = window.__HNA_GEO_CONFIG;
      if (geoType==='county' && Array.isArray(conf?.counties)){
        const m = conf.counties.find(c=>c.geoid===geoid);
        return m?.label || geoid;
      }
      // Search all config arrays for the geography label
      const allEntries = [
        ...(conf?.featured || window.HNAUtils.FEATURED),
        ...(conf?.places   || []),
        ...(conf?.cdps     || []),
      ];
      const m = allEntries.find(x=>x.geoid===geoid);
      return m?.label || geoid;
    })();

    window.HNARenderers.setBanner('');

    // Clear stat cards immediately so users never see stale data from a previous geography.
    // Cards will be repopulated once the new profile data arrives.
    window.HNARenderers.clearStats();

    // Store geo label in state so CSV export can use it.
    window.HNAState.state.lastGeoLabel = label;

    // Announce geography change to screen readers (WCAG 4.1.3 / Rule 11)
    if (typeof window.__announceUpdate === 'function') {
      window.__announceUpdate(`Loading data for ${label}`);
    }

    // Load boundary
    let boundaryFailed = false;
    try{
      const gj = await fetchBoundary(geoType, geoid);
      window.HNARenderers.renderBoundary(gj, geoType);
    }catch(e){
      console.warn(e);
      boundaryFailed = true;
      // Clear any stale boundary from a previous geography selection
      window.HNARenderers.renderBoundary({ type: 'FeatureCollection', features: [] }, geoType);
      window.HNARenderers.setBanner('Boundary failed to load (TIGERweb). The rest of the page may still populate.', 'warn');
    }

    // Load cached summary (if present) else live ACS
    let profile=null, s0801=null;
    const cacheFlags = { summary:false, lehd:false, dola:false, projections:false, derived:false };

    try{
        const sum = await loadJson(window.HNAUtils.PATHS.summary(geoid));
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

    // Cached summary files only store ~22 snapshot fields. If the profile exists
    // but is missing extended analysis variables (income brackets, housing age bins,
    // bedroom mix detail, owner cost burden, rent burden bins, special needs population),
    // fetch them from the ACS 5-year profile API and merge into the cached profile.
    // This is non-fatal: if the supplemental fetch fails, basic snapshot cards still
    // display correctly and extended charts show a blank state.
    //
    // Trigger on EITHER the income-bracket batch (DP03_0052E) OR the SMOCAPI
    // owner-cost-burden bins (DP04_0111PE) being missing. Pre-existing caches
    // built before the ETL added owner cost burden (PR #884) have income
    // brackets but no SMOCAPI — without the second condition the live fetch
    // never fires for those caches and the Owner Housing Cost Burden chart
    // stays empty until every cache file is regenerated.
    const missingExtended = profile && (
      typeof profile.DP03_0052E === 'undefined' ||
      profile.DP04_0111PE == null ||
      // F160 — also trigger when the home-value bracket batch is missing.
      // Without this, caches that already have income brackets + SMOCAPI
      // still won't supply DP04_0080-0088 to chartHomeValue.
      typeof profile.DP04_0083E === 'undefined'
    );
    if (missingExtended) {
      try {
        const ext = await fetchAcsExtended(geoType, geoid);
        if (ext) {
          // Merge: cached fields take priority on any overlap (cache has authoritative
          // snapshot values like median income; extended fetch adds the missing variables)
          // Merge strategy: ext (fresh ACS 5-year fetch) takes priority over cached
          // profile for any overlapping keys. Rationale:
          //   1. Old cached files may store stale ACS codes (structure type in DP04 shifted
          //      in ACS 2023; old builds wrote DP04_0007E as "5–9 units", ACS 2023 is
          //      "1-unit detached") — ext always reflects current ACS 2023 codes.
          //   2. Old cached files may store Python None → JSON null for variables that
          //      were unavailable at build time; null should not overwrite a valid live value.
          // Non-extended cached fields (median income, tenure %, total population) are not
          // in extVars so they are preserved from the cache unchanged.
          const merged = Object.assign({}, profile, ext);
          // Safety: if ext has a null/undefined for a key the cache had a real value for,
          // keep the cached value (ext fetch may partially succeed for some vars).
          for (const k of Object.keys(ext)) {
            if ((ext[k] === null || ext[k] === undefined) && profile[k] != null) {
              merged[k] = profile[k];
            }
          }
          profile = merged;
        }
      } catch(e) {
        console.warn('[HNA] Extended ACS supplement failed — extended charts may show blank:', e.message);
      }
    }

    if (!profile){
      if (!window.HNAUtils.censusKey()) {
        window.HNARenderers.setBanner('Census API key not configured — live data requests may be rate-limited. ' +
          'Set CENSUS_API_KEY in js/config.js for full functionality.', 'warn');
      }
      try{
        profile = await fetchAcsProfile(geoType, geoid);
      }catch(e){
        console.warn(e);
      }
    }
    // Attach geography metadata to profile and s0801 for source link generation
    if (profile) { profile._geoType = geoType; profile._geoid = geoid; }

    if (!s0801){
      try{
        s0801 = await fetchAcsS0801(geoType, geoid);
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
      dlLink.href = window.HNAUtils.PATHS.acsDebugLog;
      dlLink.download = 'acs_debug_log.txt';
      dlLink.style.cssText = 'color:inherit;text-decoration:underline';
      dlLink.textContent = 'Download Debug Log';
      window.HNAState.els.banner.textContent = '';
      window.HNAState.els.banner.appendChild(msgSpan);
      window.HNAState.els.banner.appendChild(dlLink);
      window.HNAState.els.banner.classList.add('show');
    }

    if (profile){
      const prevProfile = window.HNAState.state.prevProfile[geoid] || null;
      window.HNARenderers.renderSnapshot(profile, s0801, label, prevProfile);
      window.HNARenderers.renderHousingCharts(profile);
      window.HNARenderers.renderAffordChart(profile);
      window.HNARenderers.renderRentBurdenBins(profile);
      // F169 — household composition + occupation + labor-force section
      if (window.HNARenderers.renderHouseholdCompositionPanel) {
        window.HNARenderers.renderHouseholdCompositionPanel(profile);
      }
      // F170 — Race / ethnicity panel (DP05 RACE + HISPANIC OR LATINO)
      if (window.HNARenderers.renderRaceEthnicityPanel) {
        window.HNARenderers.renderRaceEthnicityPanel(profile);
      }
      // F170 — Educational attainment panel (DP02 EDUCATIONAL ATTAINMENT, Pop 25+)
      if (window.HNARenderers.renderEducationPanel) {
        window.HNARenderers.renderEducationPanel(profile);
      }
      if (window.HNARenderers.renderExtendedAnalysis) {
        window.HNARenderers.renderExtendedAnalysis(profile, geoType);
      }
      if (window.HNARenderers.renderHousingTypeFeasibility) {
        window.HNARenderers.renderHousingTypeFeasibility(profile, geoType);
      }
      // F199 + F200 — Decade affordability trend + housing-type pace.
      // Both are county-level (ACS cohort + BPS permits aren't cached for
      // places); place selections render the containing county data with
      // an implicit "county-level" framing already in the panel copy.
      try {
        if (window.HNARenderers.renderDecadeAffordTrend) {
          window.HNARenderers.renderDecadeAffordTrend(geoType, geoid, contextCounty);
        }
        if (window.HNARenderers.renderHousingTypePace) {
          window.HNARenderers.renderHousingTypePace(geoType, geoid, contextCounty);
        }
      } catch (e) { console.warn('[HNA] F199/F200 trend renderers failed', e); }
    }

    if (s0801){
      window.HNARenderers.renderModeShare(s0801);
    }

    // LEHD (cached)
    const contextCounty = window.HNAUtils.countyFromGeoid(geoType, geoid);
    let lehd=null;
    if (geoType === 'state'){
      // Load state-level aggregate LEHD file
      try{
        lehd = await loadJson(window.HNAUtils.PATHS.lehd('08'));
        cacheFlags.lehd = true;
      }catch(e){
        console.warn(e);
      }
      if (lehd){
        window.HNARenderers.renderLehd(lehd, geoType, geoid);
      } else {
        window.HNAState.els.lehdNote.textContent = 'LEHD state aggregate not yet available. Run the HNA data build workflow to populate.';
      }
    } else {
      try{
        // Prefer county cache for county selections; for places/CDPs use containing county
        const lehdGeoid = geoType === 'county' ? geoid : contextCounty;
        lehd = await loadJson(window.HNAUtils.PATHS.lehd(lehdGeoid));
        cacheFlags.lehd = true;
      }catch(e){
        console.warn(e);
      }
    }

    // Place-level LEHD WAC (population-weighted apportionment of the
    // county blob through the TIGER place→tract spatial join). When the
    // user picked a place/cdp and a place blob exists, swap it in for
    // the entire labor-market / economic-indicators pipeline so every
    // card reflects the place rather than the parent county.
    // Init is idempotent; lookups are synchronous after the first await.
    let placeLehdUsed = false;
    let placeLehdConfidence = null;
    if ((geoType === 'place' || geoType === 'cdp')
        && window.PlaceLehd && typeof window.PlaceLehd.init === 'function') {
      try { await window.PlaceLehd.init(); }
      catch (_) { /* soft-fail — falls through to county data */ }
      const placeBlob = window.PlaceLehd.lookup(geoid);
      if (placeBlob) {
        lehd = placeBlob;
        placeLehdUsed = true;
        placeLehdConfidence = window.PlaceLehd.confidence(geoid);
      }
    }

    // Commute flow chart (uses LEHD object's within/inflow/outflow).
    // Rendered AFTER the place-LEHD swap so it picks up the apportioned
    // numbers when applicable.
    if (geoType !== 'state') {
      if (lehd) {
        window.HNARenderers.renderLehd(lehd, geoType, geoid);
      } else {
        window.HNAState.els.lehdNote.textContent = 'LEHD flow cache not yet available. Run the HNA data build workflow to populate.';
      }
    }

    // Labor Market section (uses LEHD + ACS profile)
    window.HNARenderers.renderLaborMarketSection(lehd, profile, geoType);

    // F198 — Wages vs Housing Affordability. Combines ACS median rent + home
    // value + median HHI + HUD AMI + LEHD wage tiers into a single panel that
    // answers: "what income does a worker need to afford median rent? to buy
    // the median home? to qualify for AMI-60% LIHTC? how many local workers
    // earn enough?" Renders inside the Labor Market section.
    try {
      var laCountyFips = (geoType === 'state') ? null
        : (geoType === 'county' ? geoid : contextCounty);
      window.HNARenderers.renderWageAffordability(profile, lehd, laCountyFips);
    } catch (e) { console.warn('[HNA] renderWageAffordability failed', e); }

    // Economic indicators — trend charts and affordability gap table.
    // Cache key: when place-LEHD is in play, use the place geoid so
    // renderers read the apportioned blob; otherwise use the county
    // fips so they read the raw county data.
    const econGeoid = placeLehdUsed
      ? geoid
      : (geoType === 'state' ? '08' : (geoType === 'county' ? geoid : contextCounty));
    if (!window.__HNA_LEHD_CACHE) window.__HNA_LEHD_CACHE = {};
    if (lehd && econGeoid) window.__HNA_LEHD_CACHE[econGeoid] = lehd;
    window.HNARenderers.renderEconomicIndicators(econGeoid);
    window.HNARenderers.renderEmploymentTrend(econGeoid);
    window.HNARenderers.renderWageTrend(econGeoid);
    window.HNARenderers.renderIndustryAnalysis(econGeoid);
    window.HNARenderers.renderWageGaps(econGeoid, profile);

    // ── County-scope disclosures ────────────────────────────────────
    // LEHD, DOLA SYA, and BLS QCEW are county-only datasets. When the
    // user picked a place/cdp, the charts above and below show their
    // containing-county's numbers — without a disclosure that reads as
    // misattribution. Inject a "County-level data" note on each affected
    // section so the chart's geographic scope is glance-able. Hides
    // itself on county / state selections.
    if (window.HNARenderers.renderCountyScopeNote) {
      // When place-LEHD apportioned the county blob into a place-level
      // estimate, surface the green "Place-apportioned" note instead of
      // the amber "County-level data" warning. Coverage confidence
      // (high/medium/low) flows through so users can spot low-confidence
      // apportionments (sliver places that don't cleanly map to tracts).
      var disclosureOpts = placeLehdUsed
        ? { mode: 'place-apportioned', confidence: placeLehdConfidence }
        : { mode: 'county' };
      window.HNARenderers.renderCountyScopeNote(
        'lehdCommuteCard', geoType, contextCounty,
        'LEHD LODES commute flows',
        disclosureOpts,
      );
      window.HNARenderers.renderCountyScopeNote(
        'labor-market-section', geoType, contextCounty,
        'LEHD WAC employment data',
        disclosureOpts,
      );
      window.HNARenderers.renderCountyScopeNote(
        'economicIndicatorsContainer', geoType, contextCounty,
        'LEHD trend + industry data',
        disclosureOpts,
      );
    }

    // CHAS affordability gap (county context; loaded once and cached on state object)
    if (!window.HNAState.state.chasData) {
      try {
        window.HNAState.state.chasData = await loadJson(window.HNAUtils.PATHS.chasCostBurden);
      } catch (_) {
        window.HNAState.state.chasData = null;
      }
    }
    // PR-C3: lazy-init the TIGER place-CHAS lookup so renderer can prefer
    // place-level data over the county fallback when applicable. init()
    // is idempotent — caches after first call.
    if (window.PlaceChas && typeof window.PlaceChas.init === 'function') {
      try { await window.PlaceChas.init(); } catch (_) { /* soft-fail */ }
    }
    // Phase 1 (PR #799): lazy-init the CHAS tier-share helper used by
    // chartHouseholdDemand to apportion HH growth across real per-county
    // AMI tier shares (replacing the statewide heuristic from PR #798).
    if (window.ChasTierShares && typeof window.ChasTierShares.init === 'function') {
      try { await window.ChasTierShares.init(); } catch (_) { /* soft-fail */ }
    }
    // ACS-derived AMI gap (households-at-AMI minus units-priced-affordable
    // at each band). Used by renderGapCoverageStats as a fallback when the
    // cached CHAS file's ≤30% AMI row is suspect for the selected county
    // (known ETL issue affecting ~25 rural CO counties — see fetch_chas.py
    // repair task). Loaded once and cached on state.
    if (!window.HNAState.state.acsAmiGapData) {
      try {
        window.HNAState.state.acsAmiGapData = await loadJson(window.HNAUtils.PATHS.acsAmiGap);
      } catch (_) {
        window.HNAState.state.acsAmiGapData = null;
      }
    }
    // F30: place-level AMI-gap so a selected place shows ITS shortfall, not
    // its county's (New Castle was showing Garfield County's 7,831).
    if (!window.HNAState.state.acsAmiGapPlaceData) {
      try {
        window.HNAState.state.acsAmiGapPlaceData = await loadJson('data/co_ami_gap_by_place.json');
      } catch (_) {
        window.HNAState.state.acsAmiGapPlaceData = null;
      }
    }
    // Pass the user's actual selection so the renderer can surface a
    // "scaled from county" disclosure when the user picked a place/CDP.
    // CHAS is published at county granularity; without this disclosure,
    // a place/CDP user sees county data labeled with the county name.
    window.HNARenderers.renderChasAffordabilityGap(
      contextCounty,
      window.HNAState.state.chasData,
      { type: geoType, geoid: geoid, name: label }
    );
    window.HNARenderers.renderGapCoverageStats(
      contextCounty,
      window.HNAState.state.chasData,
      window.HNAState.state.acsAmiGapData,
      { type: geoType, geoid: geoid, name: label },
      window.HNAState.state.acsAmiGapPlaceData,
      profile
    );

    // Re-render the Owner Housing Cost Burden chart now that CHAS data
    // is loaded. The first call in renderExtendedAnalysis (before CHAS
    // load) silently no-ops if ACS SMOCAPI bins aren't in the cached
    // profile AND CHAS isn't available yet. This second call activates
    // the CHAS 3-bin fallback path (always 100% county-covered).
    if (window.HNARenderers.renderOwnerCostBurdenChart) {
      window.HNARenderers.renderOwnerCostBurdenChart(profile);
    }

    // BLS Labour Market indicators (loaded once; keyed by county name)
    if (!window.HNAState.state.blsEconData) {
      try {
        window.HNAState.state.blsEconData = await loadJson(window.HNAUtils.PATHS.blsEconIndicators);
      } catch (_) {
        window.HNAState.state.blsEconData = null;
      }
    }
    window.HNARenderers.renderBlsLabourMarket(contextCounty, geoType, window.HNAState.state.blsEconData);

    // Prop 123 compliance section (uses ACS profile + geoType + county FIPS for regional factor)
    window.HNARenderers.renderProp123Section(profile, geoType, contextCounty);

    // Prop 123 baseline + fast-track eligibility cards. These containers
    // shipped with "Select a geography…" placeholders and no renderer —
    // even after the user picked one they sat on the placeholder text.
    if (window.HNARenderers.renderProp123BaselineAndFastTrack) {
      window.HNARenderers.renderProp123BaselineAndFastTrack(profile, geoType, label);
    }

    // Stash profile + contextCounty for Phase 2 panels (scorecard,
    // historical-section delegation, etc.) that need them without
    // re-fetching. Idempotent — overwritten on every render cycle.
    window.HNAState.state.lastProfile = profile;
    window.HNAState.state.contextCounty = contextCounty;

    // Housing Policy Commitment scorecard (loads scorecard JSON, non-blocking)
    window.HNARenderers.renderHnaScorecardPanel(geoid);

    // F185 — DOLA SYA (county/state) + live ACS B01001 (place) for dual-bar age charts.
    // DOLA SYA is published only at county/state level, so for places we add a
    // live ACS 5-year B01001 fetch and bin its 23 single+grouped age bands into
    // the same 18 five-year cohorts used by DOLA. Both feed renderDolaPyramid
    // and the charts render place + county side-by-side.
    let dola=null;
    let acsCohorts = null;
    if (geoType === 'state'){
      try{
        dola = await loadJson(window.HNAUtils.PATHS.dolaSya('08'));
        cacheFlags.dola = true;
      }catch(e){
        console.warn(e);
      }
      if (dola){
        // F186 — pass explicit geo context so the renderer doesn't read a stale
        // window.HNAState.state.current (which is set AFTER this call). Without
        // this, switching from Acres Green to Fruita rendered Fruita's data
        // under the label "Acres Green".
        window.HNARenderers.renderDolaPyramid(dola, null, { geoType, geoid, geoLabel: label, contextCounty });
      } else {
        window.HNAState.els.seniorNote.textContent = 'DOLA/SDO state aggregate not yet available. Run the HNA data build workflow to populate.';
      }
    } else {
      try{
        dola = await loadJson(window.HNAUtils.PATHS.dolaSya(contextCounty));
        cacheFlags.dola = true;
      }catch(e){
        console.warn(e);
      }
      // For places/CDPs, fetch ACS B01001 live so we can show place-level age cohorts
      if (geoType === 'place' || geoType === 'cdp') {
        try {
          acsCohorts = await fetchAcsB01001(geoType, geoid);
        } catch (e) {
          console.warn('[HNA] fetchAcsB01001 failed for ' + geoType + ':' + geoid, e);
        }
      }
      if (dola || acsCohorts){
        // F186 — explicit geo context (prevents stale-label bug from F183/F185)
        window.HNARenderers.renderDolaPyramid(dola, acsCohorts, { geoType, geoid, geoLabel: label, contextCounty });
      } else {
        window.HNAState.els.seniorNote.textContent = 'DOLA/SDO age data not yet available. Run the HNA data build workflow to populate.';
      }
    }

    // F188 — Renter need by bedroom count (ACS B25009 → bedroom bins).
    // Fire and forget: the panel updates when the fetch resolves; downstream
    // chart rendering doesn't wait. Failures are silent — the panel shows
    // a placeholder without blocking anything else.
    (async () => {
      try {
        const b25009 = await fetchAcsB25009(geoType, geoid);
        if (b25009 && window.HNARenderers && window.HNARenderers.renderBedroomNeed) {
          window.HNARenderers.renderBedroomNeed(b25009);
        }
      } catch (e) {
        console.warn('[HNA] fetchAcsB25009 failed for ' + geoType + ':' + geoid, e);
      }
    })();

    // 20-year projections (cached; county context or state '08')
    window.HNAState.state.current = { geoType, geoid, label, contextCounty, profile };
    // Store profile for next refresh — enables YOY comparison on subsequent updates
    if (profile && geoid) window.HNAState.state.prevProfile[geoid] = profile;
    const projFips = geoType === 'state' ? '08' : contextCounty;
    const projRes = projFips
      ? await renderProjections(projFips, window.HNAState.state.current)
      : window.HNARenderers.clearProjectionsForStateLevel();
    if (projRes?.ok) cacheFlags.projections = true;

    window.HNARenderers.renderLocalResources(geoType, geoid);

    const derivedEntry = window.HNAState.state.derived?.geos?.[geoid] || null;
    if (derivedEntry) cacheFlags.derived = true;

    window.HNARenderers.renderMethodology({
      geoType,
      geoid,
      geoLabel: label,
      usedCountyForContext: contextCounty,
      cacheFlags,
      derivedEntry,
      derivedYears: window.HNAState.state.derived?.acs5_years || null,
    });

    // LIHTC / QCT / DDA overlays (non-blocking; state FIPS '08' for statewide, county FIPS otherwise)
    updateLihtcOverlays(geoType === 'state' ? '08' : contextCounty, geoType, label).catch(e => console.warn('[HNA] LIHTC overlay error', e));

    // HUD FMR & Income Limits panel (non-blocking)
    // For county, place, and CDP show county-level FMR; for state-level show a prompt.
    window.HNARenderers.renderFmrPanel(geoType !== 'state' ? contextCounty : null);

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
      window.HNARenderers.setBanner(`Map boundary unavailable — data for ${label} is shown below.`, 'info');
    }

    // Hide all chart loading overlays now that rendering is complete (Recommendation 3.1)
    window.HNARenderers.hideChartLoading();
  }


  async function init(){
    // Load geo config + resources if present
    try{ window.__HNA_GEO_CONFIG = await loadJson(window.HNAUtils.PATHS.geoConfig); }catch(_){ window.__HNA_GEO_CONFIG = { featured: window.HNAUtils.FEATURED }; }
    try{ window.__HNA_LOCAL_RESOURCES = await loadJson(window.HNAUtils.PATHS.localResources); }catch(_){ window.__HNA_LOCAL_RESOURCES = {}; }
    try{ window.HNAState.state.derived = await loadJson(window.HNAUtils.PATHS.derived); }catch(_){ window.HNAState.state.derived = null; }

    // Load the full geography registry (513 places + CDPs with their
    // containing-county FIPS) so countyFromGeoid resolves correctly for
    // any CO place — not just the small subset in __HNA_GEO_CONFIG.
    // Previously, missing entries silently fell back to Mesa County
    // (08077), causing the Fruita/Boulder anomaly.
    //
    // AWAIT the load: update() runs countyFromGeoid synchronously to
    // pick the LEHD/DOLA cache file for non-featured places like
    // Paonia (08029). Without await, the registry hadn't finished
    // loading by the time update() ran and countyFromGeoid returned
    // null, so the LEHD/DOLA charts rendered empty.
    if (typeof window.HNAUtils.ensureGeographyRegistry === 'function') {
      try { await window.HNAUtils.ensureGeographyRegistry(); }
      catch (_) { /* soft-fail: callers handle null county lookup */ }
    }

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
        window.__HNA_GEO_CONFIG.counties = await fetchCoCountiesList();
      }catch(e){
        console.warn('County list fetch failed', e);
      }
    }

    // Restore jurisdiction from WorkflowState / SiteState, or fall back to defaults.
    let restoredGeoType = null;
    let restoredGeoId   = null;

    // Priority 0: Explicit URL override (?auto=1 from comparative analysis links).
    // When the user clicks a "View HNA" link from another page, the link sets
    // ?auto=1 to signal "honor these URL params even if WorkflowState has a
    // different stale jurisdiction selected." Without this, clicking a link
    // for Fruita while WorkflowState holds Boulder would silently load Boulder.
    const urlParams = new URLSearchParams(window.location.search);
    const urlAutoFlag = urlParams.get('auto') === '1';
    let urlGeoType = urlParams.get('geoType');
    const urlGeoid   = urlParams.get('geoid') || urlParams.get('fips');
    /* F165 — Infer geoType from GEOID length when the param wasn't passed.
       Previously a bare `?geoid=0853395` was ignored because urlGeoType was
       null, and the page silently fell back to state-level Colorado data
       (the default initial state) — that's why chartHomeValue and the
       other DP04 charts rendered Colorado-statewide aggregates (627K units
       in the $500K-1M bin, etc.) for what users thought was a New Castle
       URL. Census place GEOIDs are 7 digits, counties 5, states 2 — those
       three lengths are unambiguous in this dataset. */
    if (!urlGeoType && urlGeoid) {
      const n = String(urlGeoid).length;
      if      (n === 7) urlGeoType = 'place';
      else if (n === 5) urlGeoType = 'county';
      else if (n === 2) urlGeoType = 'state';
    }
    if (urlAutoFlag && urlGeoType && urlGeoid) {
      restoredGeoType = urlGeoType === 'cdp' ? 'place' : urlGeoType;
      restoredGeoId   = urlGeoid;
    }

    // Priority 1: WorkflowState (set by select-jurisdiction.html)
    if (!restoredGeoType && window.WorkflowState && typeof window.WorkflowState.getJurisdiction === 'function') {
      const jx = window.WorkflowState.getJurisdiction();
      if (jx && jx.fips) {
        if (jx.type === 'city' && jx.displayName) {
          // City/town selection — find its GEOID in geo-config places
          if (jx.placeGeoid) {
            // Direct geoid from selector — most reliable
            restoredGeoType = 'place';
            restoredGeoId   = jx.placeGeoid;
          } else {
            // Fallback: name matching
            const cfg = window.__HNA_GEO_CONFIG;
            const allPlaces = [...(cfg?.places || []), ...(cfg?.cdps || [])];
            const stripSuffix = s => s.replace(/\s*\((?:city|town|CDP)\)/i, '').toLowerCase();
            const targetName = stripSuffix(jx.displayName);
            const nameMatch = allPlaces.find(p =>
              stripSuffix(p.label) === targetName
            );
            if (nameMatch) {
              restoredGeoType = 'place';
              restoredGeoId   = nameMatch.geoid;
            } else {
              // City not in geo-config — fall back to its containing county
              restoredGeoType = 'county';
              restoredGeoId   = jx.fips;
            }
          }
        } else {
          // County selection
          restoredGeoType = 'county';
          restoredGeoId   = jx.fips;
        }
      }
    }

    // Priority 2: URL parameters without explicit auto flag (legacy fallback).
    // Reuses the urlParams parsed at Priority 0 — only fires when WorkflowState
    // wasn't set and the URL had geoType+geoid but no auto=1 marker.
    if (!restoredGeoType && urlGeoType && urlGeoid) {
      restoredGeoType = urlGeoType === 'cdp' ? 'place' : urlGeoType; // CDPs use 'place' geoType selector
      restoredGeoId   = urlGeoid;
    }

    // Priority 3: SiteState.getGeography (sub-county selection from comparative analysis)
    if (!restoredGeoType && window.SiteState && typeof window.SiteState.getGeography === 'function') {
      const geo = window.SiteState.getGeography();
      if (geo && geo.geoid) {
        restoredGeoType = (geo.type === 'cdp') ? 'place' : (geo.type || 'place');
        restoredGeoId   = geo.geoid;
      }
    }

    // Priority 4: SiteState.getCounty (legacy fallback)
    if (!restoredGeoType && window.SiteState && typeof window.SiteState.getCounty === 'function') {
      const county = window.SiteState.getCounty();
      if (county && county.fips) {
        restoredGeoType = 'county';
        restoredGeoId   = county.fips;
      }
    }

    // Apply restored jurisdiction or defaults
    window.HNAState.els.geoType.value = restoredGeoType || window.HNAUtils.DEFAULTS.geoType;
    buildSelect();
    if (restoredGeoId) {
      window.HNAState.els.geoSelect.value = restoredGeoId;
    }

    // For county type, ensure a county is selected (first in list when no match)
    if (window.HNAState.els.geoType.value === 'county' && !window.HNAState.els.geoSelect.value){
      const firstOpt = window.HNAState.els.geoSelect.options[0];
      if (firstOpt) window.HNAState.els.geoSelect.value = firstOpt.value;
    }

    // ── HSA → WorkflowState sync ─────────────────────────────────────
    // Whenever the user changes the HNA dropdowns, write the new
    // selection back to WorkflowState so the Select Jurisdiction page
    // (and every other workflow step) stays in sync. Without this, HNA
    // is read-only — the user picks Adams on HNA, then revisits Select
    // Jurisdiction and the old/default selection is still showing.
    function _syncJurisdictionToWorkflowState() {
      var gt = window.HNAState.els.geoType.value;
      var gid = window.HNAState.els.geoSelect.value;
      if (!gid) return;
      var selOpt = window.HNAState.els.geoSelect.options[window.HNAState.els.geoSelect.selectedIndex];
      var label = selOpt ? selOpt.textContent : gid;
      try {
        if (window.WorkflowState && typeof window.WorkflowState.setJurisdiction === 'function') {
          // Workflow-state convention from select-jurisdiction.js: place
          // selections use type='city' with placeGeoid; county selections
          // use type='county' with fips. Match it so the restoration logic
          // (Priority 1 in update() init) reads it back cleanly next time.
          var payload;
          if (gt === 'county') {
            payload = { type: 'county', fips: gid, name: label, geoid: gid };
          } else if (gt === 'state') {
            payload = { type: 'state', fips: '08', name: 'Colorado', geoid: '08' };
          } else {
            // place / cdp — restoration code expects 'city' + placeGeoid +
            // displayName + a containing-county fips for legacy fallbacks.
            var contextCounty = window.HNAUtils.countyFromGeoid(gt, gid);
            payload = {
              type: 'city',
              displayName: label,
              placeGeoid: gid,
              geoid: gid,
              fips: contextCounty || '08',
              name: label,
            };
          }
          window.WorkflowState.setJurisdiction(payload);
        }
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[HNA] WorkflowState sync failed:', e && e.message);
        }
      }
    }

    window.HNAState.els.geoType.addEventListener('change', ()=>{
      buildSelect();
      _syncJurisdictionToWorkflowState();
      update();
    });
    window.HNAState.els.geoSelect.addEventListener('change', () => {
      _syncJurisdictionToWorkflowState();
      update();
    });
    window.HNAState.els.btnRefresh.addEventListener('click', update);
    window.HNAState.els.btnPdf?.addEventListener('click', exportPdf);
    window.HNAState.els.btnCsv?.addEventListener('click', ()=>{
      if (window.__HNA_exportCsv){ window.__HNA_exportCsv(); }
    });
    window.HNAState.els.btnJson?.addEventListener('click', ()=>{
      if (window.__HNA_exportJson){ window.__HNA_exportJson(); }
    });
    // F168 — Native Excel export with data tables + chart objects.
    document.getElementById('btnExcel')?.addEventListener('click', ()=>{
      if (window.__HNA_exportExcel){ window.__HNA_exportExcel(); }
    });

    // Projection assumptions controls
    const onAssumpChange = ()=>{ if(window.HNAState.state.lastProj && window.HNAState.state.current){ applyAssumptions(window.HNAState.state.lastProj, window.HNAState.state.current); } };
    window.HNAState.els.assumpHorizon?.addEventListener('change', onAssumpChange);
    window.HNAState.els.assumpVacancy?.addEventListener('input', ()=>{ window.HNAState.els.assumpVacancyVal.textContent = `${Number(window.HNAState.els.assumpVacancy.value).toFixed(1)}%`; onAssumpChange(); });
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
        // Update visible completion indicator
        const geoType = window.HNAState.els.geoType ? window.HNAState.els.geoType.value : 'county';
        const geoid   = window.HNAState.els.geoSelect ? window.HNAState.els.geoSelect.value : '';
        const completionEl = document.getElementById('checklistCompletionStatus');
        if (completionEl) {
          const allDone = window.ComplianceChecklist.isChecklistComplete(geoType, geoid);
          completionEl.textContent = allDone ? 'All items complete! ✅' : '';
          completionEl.style.display = allDone ? '' : 'none';
        }
        // Announce change to screen readers
        const announcer = document.getElementById('checklistAnnouncer');
        if (announcer) {
          announcer.textContent = window.ComplianceChecklist.getNextAction(geoType, geoid);
        }
      });
    }

    // Sync checklist state to compliance-dashboard.html on unload
    window.addEventListener('beforeunload', () => {
      if (window.ComplianceChecklist && window.HNAState.state.current) {
        window.ComplianceChecklist.broadcastChecklistChange({
          geoType: window.HNAState.state.current.geoType,
          geoid:   window.HNAState.state.current.geoid,
        });
      }
    });

    wireLayerToggles();
    wireScenarioControls();
    updateScenarioDescription();

    // Wire horizon toggle (10-year / 20-year)
    var horizonBtns = document.querySelectorAll('.horizon-btn');
    horizonBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        horizonBtns.forEach(function (b) {
          b.classList.remove('horizon-btn--active');
          b.style.background = 'var(--bg2)';
          b.style.color = 'var(--muted)';
          b.style.fontWeight = '400';
        });
        btn.classList.add('horizon-btn--active');
        btn.style.background = 'var(--accent)';
        btn.style.color = '#fff';
        btn.style.fontWeight = '600';
        // Re-render projections with new horizon
        var countyFips = window.HNAUtils.countyFromGeoid(
          window.HNAState.els.geoType.value,
          window.HNAState.els.geoSelect.value
        );
        if (countyFips) {
          renderProjections(countyFips, {
            geoType: window.HNAState.els.geoType.value,
            geoid: window.HNAState.els.geoSelect.value
          });
        }
      });
    });

    ensureMap();
    update();
  }


  window.HNAController = {
    init,
    update,
    renderProjections,
    applyAssumptions,
    ensureMap,
  };

  window.__HNA_renderFastTrack = window.HNARenderers.renderFastTrackCalculatorSection;
  window.__HNA_generateComplianceReport  = window.HNAUtils.generateComplianceReport;
  window.__HNA_getJurisdictionCompliance = window.HNAUtils.getJurisdictionComplianceStatus;
  window.__HNA_calculateFastTrackTimeline = window.HNAUtils.calculateFastTrackTimeline;
  window.__HNA_renderProjectionChart    = window.HNARenderers.renderProjectionChart;
  window.__HNA_renderScenarioComparison = window.HNARenderers.renderScenarioComparison;
  window.__HNA_renderHouseholdDemand    = window.HNARenderers.renderHouseholdDemand;
  window.__HNA_PROJECTION_SCENARIOS     = window.HNAUtils.PROJECTION_SCENARIOS;
  window.__HNA_renderEmploymentTrend   = window.HNARenderers.renderEmploymentTrend;
  window.__HNA_renderWageTrend         = window.HNARenderers.renderWageTrend;
  window.__HNA_renderIndustryAnalysis  = window.HNARenderers.renderIndustryAnalysis;
  window.__HNA_renderEconomicIndicators = window.HNARenderers.renderEconomicIndicators;
  window.__HNA_renderWageGaps          = window.HNARenderers.renderWageGaps;
  window.__HNA_renderFmrPanel          = window.HNARenderers.renderFmrPanel;
  window.__HNA_renderChasAffordabilityGap = window.HNARenderers.renderChasAffordabilityGap;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
