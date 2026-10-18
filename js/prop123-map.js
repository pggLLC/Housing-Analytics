// js/prop123-map.js
// Prop 123 overlay for the Colorado Deep Dive Leaflet map.
// Requirements:
// - Includes BOTH municipalities (Places) and counties that have committed to/implemented Prop 123.
// - Tooltips show "quick data" (required commitment + status/date/link when available).
// Data source:
// - Recommended: a serverless endpoint returning JSON: { updated, source_url, jurisdictions: [...] }
// - Fallback: /data/policy/prop123_jurisdictions.json
//
// Jurisdiction object schema (serverless + fallback):
// {
//   "name": "City of Boulder",
//   "kind": "municipality" | "county",
//   "required_commitment": "…",         // text or numeric string
//   "status": "Committed | Filed | ...", // optional
//   "filing_date": "YYYY-MM-DD",        // optional
//   "source_url": "https://…"           // optional
// }
//
// Note: Geometry is fetched from Census TIGERweb ArcGIS services (public).

(function () {
  'use strict';

  var prop123ListPromise = null;

  function getConfig() { return (window.APP_CONFIG || {}); }

  var FETCH_TIMEOUT_MS = 20000;
  var RETRY_DELAY_BASE_MS = 500;

  async function fetchJSON(url, retries) {
    retries = (typeof retries === 'number') ? retries : 1;
    var lastErr = new Error('No fetch attempts completed');
    for (var attempt = 0; attempt <= retries; attempt++) {
      try {
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
        var res;
        try {
          res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries) {
          await new Promise(function (r) { setTimeout(r, RETRY_DELAY_BASE_MS * Math.pow(2, attempt)); });
        }
      }
    }
    throw lastErr;
  }

  async function arcgisQueryGeoJSON(layerUrl, where) {
    const qs = new URLSearchParams({
      where: where || '1=1',
      outFields: '*',
      returnGeometry: 'true',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: '5000',
      resultOffset: '0',
      returnExceededLimitFeatures: 'true'
    });
    const url = `${layerUrl}/query?${qs.toString()}`;
    return fetchJSON(url);
  }

  function normalizeName(s) {
    return (s || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\-\.&]/g, '')
      .trim();
  }

  function classifyKind(j) {
    const k = (j.kind || j.type || '').toString().toLowerCase();
    if (k.includes('county')) return 'county';
    if (k.includes('municip') || k.includes('city') || k.includes('town') || k.includes('village')) return 'municipality';
    // Heuristic: "X County" -> county
    if ((j.name || '').toString().toLowerCase().includes(' county')) return 'county';
    return 'municipality';
  }

  function toTooltipHTML(j) {
    const parts = [];
    parts.push(`<div style="font-weight:700;margin-bottom:.25rem">${escapeHtml(j.name || '')}</div>`);
    const kind = classifyKind(j);
    parts.push(`<div style="opacity:.85;margin-bottom:.25rem">${kind === 'county' ? 'County' : 'Municipality'}</div>`);
    if (j.required_commitment) parts.push(`<div><strong>Required commitment:</strong> ${escapeHtml(j.required_commitment)}</div>`);
    if (j.status) parts.push(`<div><strong>Status:</strong> ${escapeHtml(j.status)}</div>`);
    if (j.filing_date) parts.push(`<div><strong>Filing date:</strong> ${escapeHtml(j.filing_date)}</div>`);
    if (j.source_url) parts.push(`<div style="margin-top:.25rem"><a href="${escapeAttr(j.source_url)}" target="_blank" rel="noopener">Source</a></div>`);
    return parts.join('');
  }

  function escapeHtml(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  async function loadProp123List() {
    if (prop123ListPromise) return prop123ListPromise;
    const cfg = getConfig();
    if (cfg.PROP123_API_URL) {
      prop123ListPromise = fetchJSON(cfg.PROP123_API_URL);
      return prop123ListPromise;
    }
    // Prefer DataService for portable path resolution (GitHub Pages subpath safe)
    if (window.DataService && typeof window.DataService.getJSON === 'function' &&
        typeof window.DataService.baseData === 'function') {
      prop123ListPromise = window.DataService.getJSON(window.DataService.baseData('policy/prop123_jurisdictions.json'));
      return prop123ListPromise;
    }
    // Legacy fallback: use fetchJSON with absolute path derived from script location
    const base = (function () {
      try {
        const scripts = document.querySelectorAll('script[src]');
        for (var i = 0; i < scripts.length; i++) {
          const src = scripts[i].getAttribute('src') || '';
          if (src.includes('prop123-map')) {
            return new URL(src, location.href).href.replace(/\/js\/[^/]+$/, '');
          }
        }
      } catch (e) { /* ignore */ }
      return location.origin + location.pathname.replace(/\/[^/]*$/, '');
    }());
    prop123ListPromise = fetchJSON(base + '/data/policy/prop123_jurisdictions.json');
    return prop123ListPromise;
  }

  function comparableName(s) {
    return normalizeName((s || '').toString().replace(/\s+\([^)]*\)$/, ''))
      .replace(/^(city and county|city|town|village) of\s+/, '')
      .replace(/\s+county$/, '')
      .replace(/^mt\.?\s+/, 'mount ')
      // DOLA files Central City as "City of Central", its legal name.
      .replace(/^central city$/, 'central')
      .trim();
  }

  // Census still tabulates these as CDPs, but each has since incorporated
  // and filed its own commitment, so the CDP rule must not reject the
  // filing. Keystone incorporated as a town in 2024.
  var INCORPORATED_AFTER_CENSUS = ['keystone'];

  function findJurisdiction(payload, geoType, geoLabel) {
    if ((geoType === 'cdp' || /\(cdp\)/i.test(geoLabel || '')) &&
        INCORPORATED_AFTER_CENSUS.indexOf(comparableName(geoLabel)) === -1) return null;
    var index = buildIndex(payload);
    var wantedName = comparableName(geoLabel);
    var wantedKind = geoType === 'county' ? 'county' : 'municipality';
    var sameName = index.list.filter(function (record) {
      return comparableName(record.name) === wantedName;
    });
    var sameKind = sameName.find(function (record) {
      return classifyKind(record) === wantedKind;
    });
    if (sameKind) return sameKind;
    // Denver and Broomfield are consolidated city/counties represented by
    // one DOLA record but selectable in HNA as either a county or a place.
    return sameName.length === 1 && /city\s*\/\s*county/i.test(sameName[0].type || '')
      ? sameName[0]
      : null;
  }

  // countyLabels names the county (or, for a CDP spanning a county line,
  // each county) containing a CDP. A CDP cannot file a commitment of its
  // own; its county's commitment covers it (C.R.S. § 29-32-105(1)(b)), so
  // its status is the county's. Where the counties differ, the status is
  // "Depends on county" and countyRecords lists each one.
  function relationship(payload, geoType, geoLabel, countyLabels) {
    var record = findJurisdiction(payload, geoType, geoLabel);
    var rejectedSameNameRecord = null;
    var countyRecords = [];
    if (!record && (geoType === 'cdp' || /\(cdp\)/i.test(geoLabel || ''))) {
      countyRecords = [].concat(countyLabels || []).filter(Boolean).map(function (countyLabel) {
        return { county: countyLabel, record: findJurisdiction(payload, 'county', countyLabel) };
      });
      var wantedName = comparableName(geoLabel);
      rejectedSameNameRecord = buildIndex(payload).list.find(function (candidate) {
        return classifyKind(candidate) === 'municipality' &&
          comparableName(candidate.name) === wantedName;
      }) || null;
    }
    var statusOf = function (r) { return r ? r.status : 'Not committed'; };
    var fastTrackOf = function (r) { return r ? (r.fast_track === true ? 'Yes' : 'No') : 'Not committed'; };
    var agreed = function (values) {
      return values.every(function (v) { return v === values[0]; }) ? values[0] : 'Depends on county';
    };
    var coveredBy = countyRecords.length === 1 ? countyRecords[0].record : null;
    var status, fastTrack;
    if (record || !countyRecords.length) {
      status = statusOf(record);
      fastTrack = fastTrackOf(record);
    } else {
      status = agreed(countyRecords.map(function (c) { return statusOf(c.record); }));
      fastTrack = agreed(countyRecords.map(function (c) { return fastTrackOf(c.record); }));
    }
    // DOLA also lists fast-track adoptions by jurisdictions with no
    // 2024–2026 commitment (Town of Moffat).
    if (!record && !countyRecords.length) {
      var name = comparableName(geoLabel);
      var kind = geoType === 'county' ? 'county' : 'municipality';
      var ftOnly = ((payload && payload.fast_track_without_cycle1_commitment) || []).find(function (f) {
        return comparableName(f.name) === name && classifyKind(f) === kind;
      });
      if (ftOnly) fastTrack = 'Yes';
    }
    return {
      record: record,
      coveredBy: coveredBy,
      countyRecords: countyRecords.length > 1 ? countyRecords : [],
      status: status,
      fastTrack: fastTrack,
      nextCycle: countyRecords.length > 1 ? nextCycleAcross(payload, countyRecords) : nextCycleFor(payload, record || coveredBy || nextCycleOnly(payload, geoType, geoLabel)),
      rejectedSameNameRecord: rejectedSameNameRecord
    };
  }

  // The 2027–2029 filing, if DOLA lists one for this record. Filings for
  // jurisdictions with no first-cycle record (Moffat County, Stratton) sit
  // only in payload.next_cycle.filings, so look there by name and kind.
  function nextCycleFor(payload, record) {
    var cycle = payload && payload.next_cycle;
    if (!cycle) return null;
    var filing = null;
    if (record && record.next_cycle) filing = record.next_cycle;
    else if (record) {
      var name = comparableName(record.name);
      var kind = classifyKind(record);
      filing = (cycle.filings || []).find(function (f) {
        return comparableName(f.name) === name && classifyKind(f) === kind;
      }) || null;
    }
    return { cycle: cycle.cycle, deadline: cycle.filing_deadline, filing: filing };
  }

  // Across a county line: one answer only when every county agrees;
  // perCounty keeps each county's filing for the renderer to list.
  function nextCycleAcross(payload, countyRecords) {
    var each = countyRecords.map(function (c) { return nextCycleFor(payload, c.record); });
    if (!each[0]) return null;
    var filed = each.filter(function (n) { return n && n.filing; }).length;
    return {
      cycle: each[0].cycle,
      deadline: each[0].deadline,
      filing: null,
      // 'all' | 'none' | 'mixed'; perCounty carries each county's filing.
      across: filed === each.length ? 'all' : (filed === 0 ? 'none' : 'mixed'),
      perCounty: countyRecords.map(function (c, i) { return { county: c.county, filing: each[i] && each[i].filing }; })
    };
  }

  // A jurisdiction absent from the first-cycle list can still have filed
  // for 2027–2029; findJurisdiction only sees first-cycle records.
  function nextCycleOnly(payload, geoType, geoLabel) {
    var cycle = payload && payload.next_cycle;
    if (!cycle || geoType === 'cdp' || /\(cdp\)/i.test(geoLabel || '')) return null;
    var name = comparableName(geoLabel);
    var kind = geoType === 'county' ? 'county' : 'municipality';
    return (cycle.filings || []).find(function (f) {
      return comparableName(f.name) === name && classifyKind(f) === kind;
    }) || null;
  }

  function buildIndex(payload) {
    const list = Array.isArray(payload?.jurisdictions) ? payload.jurisdictions : (Array.isArray(payload) ? payload : []);
    const muni = new Map();
    const county = new Map();
    for (const j0 of list) {
      const j = Object.assign({}, j0);
      j.kind = classifyKind(j);
      const key = normalizeName(j.name);
      if (!key) continue;
      if (j.kind === 'county') county.set(key, j);
      else muni.set(key, j);
    }
    return { muni, county, list };
  }

  async function buildOverlay(map) {
    const statusEl = document.getElementById('prop123Status');

    // TIGERweb layers:
    // Places (incorporated places) layer (2025 vintage — layer 4):
    const TIGER_PLACES = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';
    // Counties layer:
    const TIGER_COUNTIES = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1';

    let payload;
    try {
      payload = await loadProp123List();
    } catch (e) {
      console.warn('Prop123 list load failed', e);
      if (statusEl) statusEl.textContent = 'Prop 123 list unavailable';
      return null;
    }

    const { muni, county } = buildIndex(payload);

    // Fetch Colorado geometries
    // TIGERweb Places (layer 4) and State_County (layer 1) both expose
    // the FIPS field as STATE, not STATEFP. Querying STATEFP returns
    // HTTP 400 "Failed to execute query" — this was silently failing
    // and falling back to empty geometry.
    let placesGeo, countiesGeo;
    try {
      placesGeo = await arcgisQueryGeoJSON(TIGER_PLACES, "STATE='08'");
    } catch (e) {
      console.warn('Places geometry fetch failed', e);
    }
    try {
      countiesGeo = await arcgisQueryGeoJSON(TIGER_COUNTIES, "STATE='08'");
    } catch (e) {
      console.warn('Counties geometry fetch failed', e);
    }

    const L = window.L;
    if (!L) {
      console.warn('Leaflet not present');
      return null;
    }

    function featureName(f) {
      const p = f?.properties || {};
      return p.NAME || p.NAMELSAD || p.name || '';
    }

    function styleFor(kind) {
      // Read theme-aware tokens via getComputedStyle for light/dark compatibility.
      const cs = getComputedStyle(document.documentElement);
      const stroke = cs.getPropertyValue('--map-boundary-stroke').trim() ||
        (kind === 'county' ? 'rgba(13,31,53,.45)' : 'rgba(13,31,53,.45)');
      const weight = parseFloat(cs.getPropertyValue('--map-boundary-weight').trim()) || 1.5;
      return () => ({
        color: stroke,
        weight: kind === 'county' ? weight * 1.33 : weight,
        opacity: 0.9,
        fillOpacity: kind === 'county' ? 0.08 : 0.18
      });
    }

    const highlightStyle = { weight: 3, fillOpacity: 0.35 };

    const muniLayer = placesGeo ? L.geoJSON(placesGeo, {
      style: styleFor('municipality'),
      filter: (f) => muni.has(normalizeName(featureName(f))),
      onEachFeature: (f, layer) => {
        const key = normalizeName(featureName(f));
        const j = muni.get(key);
        if (j) {
          layer.bindTooltip(toTooltipHTML(j), { sticky: true, direction: 'auto', opacity: 0.95 });
          layer.on('mouseover', () => layer.setStyle(highlightStyle));
          layer.on('mouseout', () => muniLayer.resetStyle(layer));
        }
      }
    }) : null;

    const countyLayer = countiesGeo ? L.geoJSON(countiesGeo, {
      style: styleFor('county'),
      filter: (f) => {
        const n = featureName(f);
        const key = normalizeName(n.includes('County') ? n : `${n} County`);
        return county.has(key) || county.has(normalizeName(n));
      },
      onEachFeature: (f, layer) => {
        const n = featureName(f);
        const key1 = normalizeName(n.includes('County') ? n : `${n} County`);
        const j = county.get(key1) || county.get(normalizeName(n));
        if (j) {
          layer.bindTooltip(toTooltipHTML(j), { sticky: true, direction: 'auto', opacity: 0.95 });
          layer.on('mouseover', () => layer.setStyle(highlightStyle));
          layer.on('mouseout', () => countyLayer.resetStyle(layer));
        }
      }
    }) : null;

    const group = L.layerGroup();
    if (countyLayer) group.addLayer(countyLayer);
    if (muniLayer) group.addLayer(muniLayer);

    const count = (countyLayer ? Object.keys(countyLayer._layers).length : 0) + (muniLayer ? Object.keys(muniLayer._layers).length : 0);
    if (statusEl) statusEl.textContent = `Loaded ${count} Prop 123 jurisdictions (counties + municipalities)`;

    // Watch for theme changes (dark-mode-toggle sets data-theme on <html>) and restyle layers.
    if (typeof MutationObserver !== 'undefined') {
      const themeObserver = new MutationObserver(function () {
        if (muniLayer) muniLayer.setStyle(styleFor('municipality')());
        if (countyLayer) countyLayer.setStyle(styleFor('county')());
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }

    return { group, muniLayer, countyLayer };
  }

  async function init() {
    const toggle = document.getElementById('layerProp123');
    if (!toggle) return;

    // Retry up to 10 times over ~2 seconds waiting for co-lihtc-map.js to expose ColoradoDeepDiveMap
    const MAX_RETRIES = 10;
    const RETRY_INTERVAL_MS = 200;
    const MAX_WAIT_MS = MAX_RETRIES * RETRY_INTERVAL_MS;
    let map = window.ColoradoDeepDiveMap;
    if (!map) {
      await new Promise(function (resolve) {
        let attempts = 0;
        const interval = setInterval(function () {
          attempts++;
          if (window.ColoradoDeepDiveMap) {
            clearInterval(interval);
            map = window.ColoradoDeepDiveMap;
            resolve();
          } else if (attempts >= MAX_RETRIES) {
            clearInterval(interval);
            console.warn('[prop123-map] ColoradoDeepDiveMap not available after ' + MAX_WAIT_MS + 'ms; Prop 123 overlay skipped.');
            resolve();
          }
        }, RETRY_INTERVAL_MS);
      });
    }

    if (!map) return;

    const statusEl = document.getElementById('prop123Status');

    let overlay = null;

    async function ensureLayer() {
      if (overlay) return overlay;
      if (statusEl) statusEl.textContent = 'Loading Prop 123 data…';
      overlay = await buildOverlay(map);
      return overlay;
    }

    async function sync() {
      const o = await ensureLayer();
      if (!o) {
        if (statusEl) statusEl.textContent = 'Prop 123 data unavailable';
        return;
      }
      if (toggle.checked) {
        o.group.addTo(map);
      } else {
        map.removeLayer(o.group);
      }
    }

    toggle.addEventListener('change', sync);
    // Auto-load if checked
    if (toggle.checked) sync();
  }

  // Shared loader/lookup used by the HNA. Keeping this API here means every
  // surface follows the existing Prop 123 load path instead of implementing
  // another fetch for the same policy file.
  window.Prop123Jurisdictions = {
    load: loadProp123List,
    find: findJurisdiction,
    relationship: relationship,
    // True for a CDP that has not since incorporated (the county covers it).
    isUnincorporated: function (geoType, geoLabel) {
      return (geoType === 'cdp' || /\(cdp\)/i.test(geoLabel || '')) &&
        INCORPORATED_AFTER_CENSUS.indexOf(comparableName(geoLabel)) === -1;
    },
    findLoaded: async function (geoType, geoLabel) {
      return findJurisdiction(await loadProp123List(), geoType, geoLabel);
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
