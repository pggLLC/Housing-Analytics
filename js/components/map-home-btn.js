/**
 * map-home-btn.js — Reusable "Home" / reset-extent control for Leaflet maps.
 *
 * Usage:
 *   addMapHomeButton(map, { center: [39.5, -105.5], zoom: 7 });
 *
 * Options:
 *   center   — [lat, lng] to reset to (required)
 *   zoom     — zoom level to reset to (required)
 *   position — Leaflet control position (default: 'topleft')
 *   label    — button text (default: '⌂')
 *   title    — tooltip (default: 'Reset map extent')
 */
(function () {
  'use strict';

  var CSS_INJECTED = false;

  function injectCSS() {
    if (CSS_INJECTED) return;
    CSS_INJECTED = true;
    var style = document.createElement('style');
    style.textContent =
      '.map-home-btn{' +
        'background:#fff;border:2px solid rgba(0,0,0,.25);border-radius:4px;' +
        'width:34px;height:34px;line-height:30px;text-align:center;' +
        'font-size:18px;cursor:pointer;color:#333;' +
        'box-shadow:0 1px 5px rgba(0,0,0,.25);' +
      '}' +
      '.map-home-btn:hover{background:#f4f4f4}' +
      '@media(prefers-color-scheme:dark){' +
        '.map-home-btn{background:#1e293b;color:#e2e8f0;border-color:rgba(255,255,255,.2)}' +
        '.map-home-btn:hover{background:#334155}' +
      '}';
    document.head.appendChild(style);
  }

  function addMapHomeButton(map, opts) {
    if (!map || !window.L) return null;
    opts = opts || {};
    var center = opts.center;
    var zoom   = opts.zoom;
    if (!center || zoom == null) return null;

    injectCSS();

    var HomeControl = L.Control.extend({
      options: { position: opts.position || 'topleft' },
      onAdd: function () {
        var btn = L.DomUtil.create('button', 'map-home-btn');
        btn.type = 'button';
        btn.innerHTML = opts.label || '⌂';
        btn.title = opts.title || 'Reset map extent';
        btn.setAttribute('aria-label', btn.title);
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', function (e) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          map.setView(center, zoom);
        });
        return btn;
      }
    });

    var control = new HomeControl();
    control.addTo(map);
    return control;
  }

  window.addMapHomeButton = addMapHomeButton;
})();
