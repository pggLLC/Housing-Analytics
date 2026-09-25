(function (root) {
  'use strict';

  // Shared Leaflet vector stack:
  // fills 410 < selection 420 < points 450 < Leaflet markers 600
  // < affordable-housing 620 < tooltips 650 < popups 700.
  //
  // selectionPane holds shapes the analyst clicks to build something (the PMA
  // tract picker). It has to sit above fillsPane: the county boundary layer
  // there has a transparent fill that still takes clicks, so a picker drawn
  // below it never received one, and every tract click fell through to the
  // map and moved the site instead (audit F13).
  var PANE_STACK = [
    { name: 'fillsPane', zIndex: 410 },
    { name: 'selectionPane', zIndex: 420 },
    { name: 'pointsPane', zIndex: 450 }
  ];

  function ensurePane(map, paneConfig) {
    if (!map || typeof map.getPane !== 'function' || typeof map.createPane !== 'function') {
      return null;
    }
    var pane = map.getPane(paneConfig.name);
    if (!pane) {
      map.createPane(paneConfig.name);
      pane = map.getPane(paneConfig.name);
    }
    if (pane && pane.style) {
      pane.style.zIndex = String(paneConfig.zIndex);
      pane.style.pointerEvents = 'auto';
    }
    return pane;
  }

  function ensureStack(map) {
    PANE_STACK.forEach(function (paneConfig) {
      ensurePane(map, paneConfig);
    });
    return {
      fillsPane: 'fillsPane',
      selectionPane: 'selectionPane',
      pointsPane: 'pointsPane'
    };
  }

  root.MapPanes = {
    ensureStack: ensureStack,
    PANE_STACK: PANE_STACK.slice()
  };
})(window);
