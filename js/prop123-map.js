// js/prop123-map.js
// Prop 123 overlay for the Colorado Deep Dive Leaflet map.
// Requirements:
// - Includes BOTH municipalities (Places) and counties that have committed to/implemented Prop 123.
// - Tooltips show "quick data" (required commitment + status/date/link when available).
// Data source:
// - Recommended: a serverless endpoint returning JSON: { updated, source_url, jurisdictions: [...] }
// - Fallback: /data/prop123_jurisdictions.json
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

  function getConfig() { return (window.APP_CONFIG || {}); }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
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
    const cfg = getConfig();
    if (cfg.PROP123_API_URL) return fetchJSON(cfg.PROP123_API_URL);
    return fetchJSON('data/prop123_jurisdictions.json');
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
    // Places (incorporated places) layer:
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
    // For Places, TIGERweb uses STATEFP='08' field; for Counties, STATEFP='08' is the correct field.
    let placesGeo, countiesGeo;
    try {
      placesGeo = await arcgisQueryGeoJSON(TIGER_PLACES, "STATEFP='08'");
    } catch (e) {
      console.warn('Places geometry fetch failed', e);
    }
    try {
      countiesGeo = await arcgisQueryGeoJSON(TIGER_COUNTIES, "STATEFP='08'");
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
      // Use different strokes so counties are visually distinct from municipalities.
      return (feature) => ({
        weight: kind === 'county' ? 2 : 1,
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

    return { group, muniLayer, countyLayer };
  }

  async function init() {
    const toggle = document.getElementById('layerProp123');
    if (!toggle) return;

    const map = window.CODeepDiveMap?.map;
    if (!map) {
      console.warn('CODeepDiveMap.map not found; Prop123 overlay not initialized');
      return;
    }

    let overlay = null;

    async function ensureLayer() {
      if (overlay) return overlay;
      overlay = await buildOverlay(map);
      return overlay;
    }

    async function sync() {
      const o = await ensureLayer();
      if (!o) return;
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

  document.addEventListener('DOMContentLoaded', init);
})();
