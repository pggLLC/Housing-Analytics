/**
 * map-overlay.js — Colorado Deep Dive map layer toggle management
 * Depends on: js/vendor/leaflet.js and the map being initialized (window.coLihtcMap).
 * Works with the inline map IIFE already present in colorado-deep-dive.html.
 */
(function () {
  'use strict';

  // Visual feedback: mark label active when its checkbox is checked
  function syncLabelState(checkbox) {
    var label = checkbox.closest ? checkbox.closest('label') : checkbox.parentNode;
    if (!label) return;
    if (checkbox.checked) {
      label.setAttribute('data-active', 'true');
    } else {
      label.removeAttribute('data-active');
    }
  }

  // Apply active styling to all map-controls checkboxes on init
  function initToggleStyles() {
    var checkboxes = document.querySelectorAll('.map-controls input[type="checkbox"]');
    checkboxes.forEach(function (cb) {
      syncLabelState(cb);
      cb.addEventListener('change', function () {
        syncLabelState(cb);
      });
    });
  }

  // Safely get the Leaflet map (may be set after DOM ready by inline IIFE)
  function getMap() {
    return window.coLihtcMap || null;
  }

  // Show/hide a Leaflet layer with error handling
  function toggleLayer(layer, show) {
    var map = getMap();
    if (!map || !layer) return;
    try {
      if (show && !map.hasLayer(layer)) {
        map.addLayer(layer);
      } else if (!show && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    } catch (err) {
      console.warn('[map-overlay] Layer toggle failed:', err.message);
    }
  }

  // Expose toggle helper for inline scripts in the HTML
  window.mapOverlay = {
    toggleLayer: toggleLayer,
    getMap: getMap
  };

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggleStyles);
  } else {
    initToggleStyles();
  }
}());
