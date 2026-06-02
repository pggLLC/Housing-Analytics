/**
 * js/components/affordable-housing-layer.js — F119
 * =================================================
 * Reusable Leaflet layer that shows ALL affordable-housing properties
 * across every map in COHO, color-coded by program type so the user can
 * distinguish 9% LIHTC, 4% LIHTC, 9%+State, 4%+State, MIHTC, HUD MF,
 * USDA RD, and preservation candidates at a glance.
 *
 * Usage:
 *   <script src="js/components/affordable-housing-layer.js"></script>
 *   <script>
 *     window.AffordableHousingLayer.attach(map, {
 *       show9pct: true, show4pct: true, showMihtc: true,
 *       showStatePaired: true, showHudMf: true, showUsdaRd: true,
 *       showPreservation: true,
 *       showLegend: true,    // floating legend control
 *       interactive: true,   // popups + tooltips on click
 *     });
 *   </script>
 *
 * Data:
 *   data/affordable-housing/properties.json — 3,073 properties from CHFA
 *   LIHTC + CHFA Preservation + HUD MF Assisted + USDA RD + Prop 123.
 *   Built by scripts/build-affordable-housing-properties.js. The component
 *   is idempotent: re-attaching to the same map is safe.
 *
 * Color palette tuned for contrast in both light + dark modes.
 */
(function (global) {
  'use strict';
  if (global.AffordableHousingLayer) return;

  // ─────────────────────────────────────────────────────────────────────
  // Category buckets — every property gets exactly one bucket via priority.
  // Order matters: more-specific buckets first.
  // ─────────────────────────────────────────────────────────────────────
  var CATEGORIES = [
    { key: '9pct_state',   label: '9% + State paired', color: '#ea580c',
      desc: '9% federal LIHTC stacked with Colorado State LIHTC and/or Prop 123 equity. The state add-on roughly doubles equity yield — Colorado’s most-subsidized stack.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('lihtc-9pct') && pt.includes('lihtc-state-paired');
    }},
    { key: '4pct_state',   label: '4% + State paired', color: '#0891b2',
      desc: '4% federal LIHTC with tax-exempt bonds, paired with Colorado State LIHTC and/or Prop 123. The 2024+ workhorse for resort + middle-income deals — no 9% competitive cap.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('lihtc-4pct') && pt.includes('lihtc-state-paired');
    }},
    { key: '9pct',         label: '9% LIHTC',          color: '#dc2626',
      desc: 'Federal 9% Low-Income Housing Tax Credit (IRC §42). Competitively allocated by CHFA; ~30% of project cost as equity. The classic new-construction affordable financing.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('lihtc-9pct');
    }},
    { key: '4pct',         label: '4% LIHTC',          color: '#2563eb',
      desc: 'Federal 4% LIHTC paired with tax-exempt private activity bonds. ~25% equity, no competitive cap (bond-driven). Used for larger deals + acq/rehab preservation.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('lihtc-4pct');
    }},
    { key: 'mihtc',        label: 'MIHTC (Middle Income)', color: '#9333ea',
      desc: 'Colorado Middle Income Housing Tax Credit — state-only credit (no federal layer) serving 80–120% AMI. CHFA-allocated; small annual cap.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('lihtc-mihtc');
    }},
    { key: 'hud_mf',       label: 'HUD Multifamily',   color: '#d97706',
      desc: 'Property with a HUD-administered subsidy contract — Section 8 PBRA, 202/811 elderly+disabled, or FHA-insured (221d, 223). Federal contract, tracked in HUD MULTIFAMILY_PROPERTIES_ASSISTED.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('hud-multifamily');
    }},
    { key: 'usda_rd',      label: 'USDA Rural Dev',    color: '#16a34a',
      desc: 'USDA Rural Development Section 515/521 multifamily — rural-only financing with restrictive use covenants. Many properties also carry rental assistance.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('usda-rural-development');
    }},
    { key: 'pbv_local',    label: 'PBV (local PHA)',   color: '#0ea5e9',
      desc: 'Project-Based Voucher contract administered by a local Housing Authority (not a federal HUD contract). Invisible to federal feeds — curated from PHA records.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('pbv-local');
    }},
    { key: 'preservation', label: 'Preservation candidate', color: '#64748b',
      desc: 'Property at risk of losing affordability restrictions — use restriction expiring, FHA loan maturing, or LIHTC compliance period ending. Source: CHFA preservation database.',
      match: function (p) {
        var pt = p.program_type || [];
        return pt.includes('preservation-candidate');
    }},
  ];

  function _categorize(p) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].match(p)) return CATEGORIES[i];
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Shared cache (multi-map pages don't refetch the 2MB file).
  // ─────────────────────────────────────────────────────────────────────
  var _propsData = null;
  var _propsPromise = null;
  function _resolvePath(p) {
    if (typeof global.resolveAssetUrl === 'function') return global.resolveAssetUrl(p);
    return p;
  }
  function _loadProps() {
    if (_propsData) return Promise.resolve(_propsData);
    if (_propsPromise) return _propsPromise;
    _propsPromise = fetch(_resolvePath('data/affordable-housing/properties.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { _propsData = d && d.properties ? d.properties : []; return _propsData; })
      .catch(function (e) {
        console.warn('[AffordableHousingLayer] properties fetch failed', e);
        return [];
      });
    return _propsPromise;
  }

  // Per-map registry
  var _registry = new WeakMap();

  // ─────────────────────────────────────────────────────────────────────
  // Dedicated Leaflet pane so markers + popups sit above polygon overlays
  // (QCT, DDA, jurisdiction boundaries). Default Leaflet panes:
  //   overlayPane  400  — where vector polygons + circleMarker live by default
  //   markerPane   600  — HTML markers (LIHTC divIcons)
  //   tooltipPane  650
  //   popupPane    700
  // We want our circleMarkers ABOVE all polygon overlays AND the LIHTC
  // divIcon markers, but below tooltips/popups (so tooltip + popup still
  // work). zIndex 620 satisfies all those constraints.
  // ─────────────────────────────────────────────────────────────────────
  var PANE_NAME = 'affordableHousingPane';
  function _ensurePane(map) {
    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME);
      var p = map.getPane(PANE_NAME);
      p.style.zIndex = 620;
      p.style.pointerEvents = 'auto';
    }
    return PANE_NAME;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Marker + popup factory
  // ─────────────────────────────────────────────────────────────────────
  function _fmtNum(n) {
    if (!isFinite(n)) return '—';
    return Math.round(n).toLocaleString();
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _popupHtml(p, cat) {
    var units = p.total_units || p.assisted_units || 0;
    var pt = (p.program_type || []).join(', ');
    var src = p.source || '';
    // F124 — credit-type tag with hover tooltip + lookup pill bar (Map,
    // News, CHFA, NHPD, etc.) so the user can dig deeper without leaving
    // the workflow.
    var creditCell = '';
    if (p.type_of_credits) {
      creditCell = (global.PropertyLookup
        ? global.PropertyLookup.creditTypeTagHtml(p.type_of_credits)
        : _esc(p.type_of_credits));
    }
    var lookupBar = global.PropertyLookup
      ? global.PropertyLookup.htmlFor(p, { compact: true })
      : '';
    return (
      '<div style="min-width:200px;max-width:280px;font-size:13px;line-height:1.4">' +
        '<div style="font-weight:700;color:' + cat.color + ';margin-bottom:4px">' +
          _esc(p.property_name || 'Unnamed property') +
        '</div>' +
        '<div style="color:#666;font-size:11px;margin-bottom:4px">' + _esc(pt) + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          (p.address ? '<tr><td style="opacity:.7">Address</td><td style="text-align:right">' + _esc(p.address) + '</td></tr>' : '') +
          (p.city    ? '<tr><td style="opacity:.7">City</td><td style="text-align:right">' + _esc(p.city) + '</td></tr>' : '') +
          (units     ? '<tr><td style="opacity:.7">Units</td><td style="text-align:right">' + _fmtNum(units) + '</td></tr>' : '') +
          (creditCell ? '<tr><td style="opacity:.7">Credit type</td><td style="text-align:right">' + creditCell + '</td></tr>' : '') +
          (p.latest_year ? '<tr><td style="opacity:.7">Year placed</td><td style="text-align:right">' + _esc(p.latest_year) + '</td></tr>' : '') +
          (p.award_year && p.award_year !== p.latest_year ? '<tr><td style="opacity:.7">CHFA awarded</td><td style="text-align:right">' + _esc(p.award_year) + '</td></tr>' : '') +
          (p.pha_administered_by ? '<tr><td style="opacity:.7">PHA</td><td style="text-align:right">' + _esc(p.pha_administered_by) + '</td></tr>' : '') +
          (p.pbv_contract_sunset ? '<tr><td style="opacity:.7">PBV sunsets</td><td style="text-align:right;color:#dc2626;font-weight:600">' + _esc(p.pbv_contract_sunset) + '</td></tr>' : '') +
        '</table>' +
        lookupBar +
        (src ? '<div style="font-size:10px;color:#888;margin-top:6px">Source: ' + _esc(src) + '</div>' : '') +
      '</div>'
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Legend control
  // ─────────────────────────────────────────────────────────────────────
  // Inject one-time stylesheet for legend tooltips. Idempotent.
  function _ensureLegendStyles() {
    if (document.getElementById('ahl-legend-styles')) return;
    var st = document.createElement('style');
    st.id = 'ahl-legend-styles';
    st.textContent = [
      '.ahl-legend .ahl-row { position: relative; cursor: help; }',
      '.ahl-legend .ahl-row .ahl-tt {',
      '  position: absolute; right: calc(100% + 8px); top: 50%;',
      '  transform: translateY(-50%);',
      '  background: #111827; color: #f3f4f6;',
      '  padding: 8px 10px; border-radius: 6px;',
      '  font-size: 11px; line-height: 1.45;',
      '  width: 240px; white-space: normal;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,.25);',
      '  border: 1px solid rgba(255,255,255,.08);',
      '  pointer-events: none;',
      '  opacity: 0; visibility: hidden;',
      '  transition: opacity .12s ease;',
      '  z-index: 1000;',
      '}',
      '.ahl-legend .ahl-row:hover .ahl-tt,',
      '.ahl-legend .ahl-row:focus-within .ahl-tt { opacity: 1; visibility: visible; }',
      '.ahl-legend .ahl-row .ahl-tt::after {',
      '  content: ""; position: absolute;',
      '  left: 100%; top: 50%; transform: translateY(-50%);',
      '  border: 5px solid transparent; border-left-color: #111827;',
      '}',
      '.ahl-legend .ahl-info {',
      '  display: inline-flex; align-items: center; justify-content: center;',
      '  width: 12px; height: 12px; border-radius: 50%;',
      '  background: rgba(0,0,0,.08); color: inherit;',
      '  font-size: 9px; font-weight: 700; opacity: .55;',
      '  margin-left: 2px;',
      '}',
      '.dark-mode .ahl-legend .ahl-info { background: rgba(255,255,255,.12); }',
      '@media (max-width: 640px) {',
      '  .ahl-legend .ahl-row .ahl-tt { display: none; }', // no hover on touch — tooltip suppressed
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function _makeLegend(activeKeys) {
    var L = global.L;
    _ensureLegendStyles();
    var legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
      var div = L.DomUtil.create('div', 'ahl-legend');
      div.setAttribute('aria-label', 'Affordable housing legend');
      div.style.cssText =
        'background:rgba(255,255,255,.96);padding:8px 10px;border-radius:6px;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.18);font-size:11px;line-height:1.5;' +
        'border:1px solid rgba(0,0,0,.08);max-width:220px;';
      // Dark-mode-aware bg
      if (document.documentElement.classList.contains('dark-mode')) {
        div.style.background = 'rgba(20,28,42,.95)';
        div.style.color = '#e4f0fc';
        div.style.borderColor = 'rgba(255,255,255,.08)';
      }
      var rows = CATEGORIES.filter(function (c) {
        return activeKeys.indexOf(c.key) >= 0;
      }).map(function (c) {
        var ttText = c.desc ? _esc(c.desc) : '';
        // Native title= as fallback for touch / screen readers + assistive tech.
        // Custom styled tooltip for desktop hover discovery via .ahl-tt.
        return (
          '<div class="ahl-row" tabindex="0"' +
            (ttText ? ' title="' + ttText + '" aria-label="' + _esc(c.label) + ': ' + ttText + '"' : '') +
            ' style="display:flex;align-items:center;gap:6px;white-space:nowrap">' +
            '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + c.color + ';border:1.5px solid rgba(255,255,255,.7);flex-shrink:0"></span>' +
            '<span>' + _esc(c.label) + '</span>' +
            (ttText ? '<span class="ahl-info" aria-hidden="true">i</span>' : '') +
            (ttText ? '<span class="ahl-tt" role="tooltip">' + ttText + '</span>' : '') +
          '</div>'
        );
      }).join('');
      div.innerHTML =
        '<div style="font-weight:700;margin-bottom:4px;font-size:11px">Affordable housing <span style="opacity:.6;font-weight:400">(hover for detail)</span></div>' +
        rows;
      // Prevent map drag when clicking legend
      L.DomEvent.disableClickPropagation(div);
      return div;
    };
    return legend;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Main attach
  // ─────────────────────────────────────────────────────────────────────
  function attach(map, opts) {
    if (!map || !global.L) {
      console.warn('[AffordableHousingLayer] no map or Leaflet');
      return null;
    }
    opts = opts || {};
    var entry = _registry.get(map) || {};

    // Resolve which buckets to show. Default: everything.
    var showMap = {
      '9pct':         opts.show9pct         !== false,
      '4pct':         opts.show4pct         !== false,
      '9pct_state':   opts.showStatePaired  !== false,
      '4pct_state':   opts.showStatePaired  !== false,
      'mihtc':        opts.showMihtc        !== false,
      'hud_mf':       opts.showHudMf        !== false,
      'usda_rd':      opts.showUsdaRd       !== false,
      'pbv_local':    opts.showPbvLocal     !== false,
      'preservation': opts.showPreservation !== false,
    };
    var interactive = opts.interactive !== false;
    var showLegend = opts.showLegend !== false;

    if (entry.markerLayer) {
      // Idempotent re-attach: just refresh visibility per opts
      Object.keys(entry.subLayers).forEach(function (k) {
        if (showMap[k]) entry.subLayers[k].addTo(map);
        else map.removeLayer(entry.subLayers[k]);
      });
      return { detach: function () { detach(map); }, layers: entry };
    }

    _loadProps().then(function (props) {
      if (!props || !props.length) return;
      // Reserve a dedicated high-z-index pane on first attach so the
      // markers are guaranteed to sit above QCT / DDA / jurisdiction
      // polygons even when those layers attach LATER than us.
      var paneName = _ensurePane(map);
      var sub = {};
      CATEGORIES.forEach(function (c) { sub[c.key] = global.L.layerGroup(); });

      props.forEach(function (p) {
        if (!isFinite(p.lat) || !isFinite(p.lng)) return;
        var cat = _categorize(p);
        if (!cat) return;
        var marker = global.L.circleMarker([p.lat, p.lng], {
          pane: paneName,
          radius: 5,
          fillColor: cat.color,
          color: '#ffffff',
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.85,
          interactive: interactive,
        });
        marker.feature = { type: 'Feature', properties: p };
        if (interactive) {
          marker.bindPopup(_popupHtml(p, cat));
          marker.bindTooltip(p.property_name || 'unnamed', { sticky: true });
        }
        sub[cat.key].addLayer(marker);
      });

      entry.subLayers = sub;
      entry.markerLayer = global.L.featureGroup();
      Object.keys(sub).forEach(function (k) {
        if (showMap[k]) sub[k].addTo(map);
      });

      if (showLegend) {
        var activeKeys = Object.keys(showMap).filter(function (k) { return showMap[k]; });
        entry.legend = _makeLegend(activeKeys);
        entry.legend.addTo(map);
      }

      _registry.set(map, entry);
    });

    _registry.set(map, entry);
    return {
      detach: function () { detach(map); },
      layers: entry,
      categories: CATEGORIES,
    };
  }

  function detach(map) {
    var entry = _registry.get(map);
    if (!entry) return;
    if (entry.subLayers) {
      Object.keys(entry.subLayers).forEach(function (k) {
        try { map.removeLayer(entry.subLayers[k]); } catch (_) {}
      });
    }
    if (entry.legend) {
      try { map.removeControl(entry.legend); } catch (_) {}
    }
    _registry.delete(map);
  }

  global.AffordableHousingLayer = {
    attach: attach,
    detach: detach,
    CATEGORIES: CATEGORIES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
