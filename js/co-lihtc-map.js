/**
 * co-lihtc-map.js — Colorado Deep Dive Leaflet map (standalone, no bundler required)
 * Depends on: js/vendor/leaflet.js loaded before this script.
 * Exports: window.coLihtcMap — the Leaflet map instance (set after initialization).
 */
(function () {
  'use strict';

  // ── Fallback embedded data (used when HUD ArcGIS APIs are unreachable) ──────
  var FALLBACK_LIHTC = [];
  var FALLBACK_QCT   = [];
  var FALLBACK_DDA   = [];

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
    return Array.isArray(data) && data.length > 0;
  }

  // ── Render markers ───────────────────────────────────────────────────────────
  function renderData(map, data) {
    data.forEach(function (item) {
      if (item && item.coordinates) {
        L.marker(item.coordinates).addTo(map);
      } else {
        console.warn('[co-lihtc-map] Invalid item (no coordinates):', item);
      }
    });
  }

  // ── Fetch data from API, fall back to embedded data ──────────────────────────
  function fetchData(map) {
    updateStatus('Loading LIHTC data…');
    fetchWithTimeout('https://api.example.com/data', {}, 8000)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (validateData(data)) {
          renderData(map, data);
          updateStatus('');
        } else {
          console.warn('[co-lihtc-map] API returned invalid data; using fallback.');
          renderData(map, FALLBACK_LIHTC);
          updateStatus('Using embedded fallback data.');
        }
      })
      .catch(function (err) {
        console.warn('[co-lihtc-map] API fetch failed; using fallback.', err.message);
        renderData(map, FALLBACK_LIHTC);
        updateStatus('Using embedded fallback data.');
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