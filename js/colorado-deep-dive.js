/**
 * colorado-deep-dive.js — Page controller for colorado-deep-dive.html
 *
 * Responsibilities:
 *  - Tab switching with ARIA state management + keyboard navigation
 *  - Hash-based deep linking (#tab-ami-gap, #tab-market-trends, etc.)
 *  - Lazy-loading per-panel init (modules only boot when their tab opens)
 *  - localStorage caching utility with TTL
 *  - Error handling: one panel failing never crashes others
 *  - Data-loading status indicators
 */
(function () {
  'use strict';

  /* ── Caching utility ───────────────────────────────────────────── */
  var CACHE_PREFIX = 'cdrive_';

  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var item = JSON.parse(raw);
      if (item.exp && Date.now() > item.exp) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return item.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data, ttlMs) {
    try {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
        data: data,
        exp: ttlMs ? Date.now() + ttlMs : 0
      }));
    } catch (e) { /* quota exceeded or private browsing — silently skip */ }
  }

  /* ── Loading state helpers ─────────────────────────────────────── */
  function showLoadingState(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel || panel.querySelector('.cdrive-loading')) return;
    var el = document.createElement('div');
    el.className = 'cdrive-loading';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = 'Loading…';
    el.style.cssText = 'padding:.75rem 0;color:var(--muted);font-size:.85rem;';
    panel.prepend(el);
  }

  function clearLoadingState(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var el = panel.querySelector('.cdrive-loading');
    if (el) el.remove();
  }

  /* ── Error handling ────────────────────────────────────────────── */
  function handleDataError(panelName, error) {
    console.warn('[colorado-deep-dive] Panel "' + panelName + '" init failed:', error);
  }

  /* ── Panel lazy loaders ────────────────────────────────────────── */
  var panelLoaded = {};

  function loadPanel(panelId) {
    if (panelLoaded[panelId]) return;
    panelLoaded[panelId] = true;

    switch (panelId) {
      case 'tab-ami-gap':
        initAmiPanel(panelId);
        break;
      case 'tab-market-trends':
        initMarketPanel(panelId);
        break;
      case 'tab-state-comparison':
        initComparisonPanel(panelId);
        break;
      case 'tab-policy-simulator':
        initPolicyPanel(panelId);
        break;
      case 'tab-affordability-geo':
        initAffordabilityGeoPanel(panelId);
        break;
    }
  }

  function initAmiPanel(panelId) {
    showLoadingState(panelId);
    try {
      if (window.CoAmiGap && typeof window.CoAmiGap.init === 'function') {
        window.CoAmiGap.init();
      }
    } catch (e) {
      handleDataError('ami-gap', e);
    } finally {
      clearLoadingState(panelId);
    }
  }

  function initMarketPanel(panelId) {
    showLoadingState(panelId);
    try {
      if (window.TrendAnalysis && typeof window.TrendAnalysis.init === 'function') {
        window.TrendAnalysis.init();
      }
    } catch (e) {
      handleDataError('market-trends', e);
    } finally {
      clearLoadingState(panelId);
    }
  }

  function initComparisonPanel(panelId) {
    /* State comparison panel is static HTML — nothing to load */
    clearLoadingState(panelId);
  }


  var prop123Initialized = false;

  function initProp123Section() {
    if (prop123Initialized) return;
    prop123Initialized = true;

    var tbody = document.getElementById('prop123TableBody');
    var summary = document.getElementById('prop123Summary');
    var status = document.getElementById('prop123Status');
    if (!tbody) return;

    function setStatus(msg) {
      if (status) status.textContent = msg || '';
    }

    // Always resolve via DataService.baseData for GitHub Pages compatibility
    function loadWithFallback() {
      var localFallback = DataService.baseData('policy/prop123_jurisdictions.json');
      var primaryUrl = (window.APP_CONFIG && window.APP_CONFIG.PROP123_API_URL) || null;
      if (!primaryUrl) {
        return DataService.getJSON(localFallback);
      }
      return DataService.getJSON(primaryUrl).catch(function () {
        console.warn('[colorado-deep-dive] Primary Prop 123 API failed, using local fallback:', localFallback);
        return DataService.getJSON(localFallback);
      });
    }
    setStatus('Loading…');
    loadWithFallback().then(function (data) {
      var jurisdictions = data.jurisdictions || data.items || data || [];
      // Allow the fallback file schema: { updated, jurisdictions: [...] }
      if (data && data.jurisdictions) jurisdictions = data.jurisdictions;
      if (!Array.isArray(jurisdictions)) jurisdictions = [];
      var count = jurisdictions.length;
      var countyCount = jurisdictions.filter(function (j) {
        var k = (j.kind || j.type || '').toString().toLowerCase();
        return k.includes('county') || (j.name || '').toLowerCase().includes(' county');
      }).length;
      var muniCount = count - countyCount;
      if (summary) summary.textContent = count
        ? (count + ' jurisdictions (' + countyCount + ' counti' + (countyCount === 1 ? 'y' : 'es') + ', ' + muniCount + ' municipalit' + (muniCount === 1 ? 'y' : 'ies') + ') currently listed in the Prop 123 commitment dataset.')
        : 'No jurisdictions found in the dataset.';
      setStatus(count ? ('Loaded ' + count + ' Prop 123 jurisdictions') : '(0)');

      // Render table rows
      tbody.innerHTML = '';
      if (!count) {
        tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);">No Prop 123 jurisdictions found.</td></tr>';
        return;
      }

      jurisdictions.slice(0, 500).forEach(function (j) {
        var name = j.name || j.jurisdiction || j.place || j.county || '—';
        var type = j.type || j.jurisdiction_type || (j.is_county ? 'County' : (j.is_place ? 'Municipality' : '—'));
        var statusTxt = j.status || j.commitment_status || '—';
        var dt = j.commitment_date || j.filing_date || j.date || j.filed_date || '';
        var dateTxt = dt ? String(dt).replace('T00:00:00.000Z','') : '—';

        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(name) + '</td>' +
                       '<td>' + escapeHtml(type) + '</td>' +
                       '<td>' + escapeHtml(statusTxt) + '</td>' +
                       '<td>' + escapeHtml(dateTxt) + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(function (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);">Prop 123 data unavailable — check data/policy/prop123_jurisdictions.json.</td></tr>';
      if (summary) summary.textContent = '';
      setStatus('Error loading data');
      console.warn('[colorado-deep-dive] Prop 123 load error:', e);
    });
  }

  function loadCarMarketKpis() {
    // This section is present in the HTML, but may not have a data feed configured.
    var section = document.getElementById('carMarketSection');
    if (!section) return;

    var ids = ['carMedianPrice','carInventory','carDaysOnMarket','carPricePerSqFt'];
    var any = ids.some(function (id) { return document.getElementById(id); });
    if (!any) return;

    var url = (window.APP_CONFIG && window.APP_CONFIG.CAR_MARKET_URL) ? window.APP_CONFIG.CAR_MARKET_URL : 'data/car-market.json';

    DataService.getJSON(url).then(function (d) {
      // Expected schema example:
      // { updated: "YYYY-MM-DD", median_sale_price: 0, active_listings: 0, median_days_on_market: 0, median_price_per_sqft: 0 }
      var mp  = d.median_sale_price ?? d._legacy_median_price ?? d.medianPrice;
      var inv = d.active_listings ?? d.inventory;
      var dom = d.median_days_on_market ?? d._legacy_median_dom ?? d.days_on_market;
      var ppsf = d.median_price_per_sqft ?? d._legacy_price_per_sqft ?? d.pricePerSqFt;

      setText('carMedianPrice', formatCurrency(mp));
      setText('carInventory', formatNumber(inv));
      setText('carDaysOnMarket', dom == null ? '—' : String(dom));
      setText('carPricePerSqFt', formatCurrency(ppsf));
    }).catch(function () {
      // If the file doesn't exist, keep dashes but add an explanatory note
      var noteId = 'carMarketNote';
      if (!document.getElementById(noteId)) {
        var p = document.createElement('p');
        p.id = noteId;
        p.className = 'data-sources-small';
        p.style.marginTop = '0.75rem';
        p.textContent = 'CAR KPIs are placeholders until a static data file is added at data/car-market.json (recommended via scheduled GitHub Actions).';
        section.appendChild(p);
      }
    });

    function setText(id, txt) {
      var el = document.getElementById(id);
      if (el) el.textContent = txt;
    }
    function formatNumber(x) {
      if (x == null || x === '') return '—';
      try { return Number(x).toLocaleString(); } catch (e) { return String(x); }
    }
    function formatCurrency(x) {
      if (x == null || x === '') return '—';
      try { return '$' + Math.round(Number(x)).toLocaleString(); } catch (e) { return String(x); }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

function initPolicyPanel(panelId) {
    showLoadingState(panelId);
    try {
      if (window.PolicySimulator && typeof window.PolicySimulator.init === 'function') {
        window.PolicySimulator.init();
      }
      // Fill Prop 123 section and any configured market KPIs
      initProp123Section();
      loadCarMarketKpis();
    } catch (e) {
      handleDataError('policy-simulator', e);
    } finally {
      clearLoadingState(panelId);
    }
  }

  /* ── Affordability Geography panel ────────────────────────────── */
  var _affGeoInit = false;
  var _affGeoMaps = [];   /* Leaflet map instances for invalidateSize on tab re-show */

  function initAffordabilityGeoPanel(panelId) {
    if (_affGeoInit) return;
    _affGeoInit = true;
    showLoadingState(panelId);

    /* Helper: tile layer URL (CARTO dark, matching site theme) */
    var TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>';

    function makeMap(elId) {
      if (!window.L || !document.getElementById(elId)) return null;
      var m = L.map(elId, { scrollWheelZoom: false, zoomControl: true })
               .setView([39.0, -105.5], 6);
      _affGeoMaps.push(m);
      return m;
    }

    function addTiles(map) {
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
    }

    /* ─ Section A: Affordability Ratio dot map ─ */
    function renderRatioMap() {
      var map = makeMap('affRatioMap');
      if (!map) return;
      addTiles(map);

      function ratioColor(pct) {
        if (pct <  25) return '#2ca25f';
        if (pct <  35) return '#f0ab00';
        if (pct <  50) return '#e07b00';
        return '#c0392b';
      }

      Promise.all([
        DataService.getJSON('data/market/acs_tract_metrics_co.json'),
        DataService.getJSON('data/market/tract_centroids_co.json')
      ]).then(function (res) {
        var tracts    = (res[0].tracts || []);
        var centroids = (res[1].tracts || []);
        var centMap   = {};
        centroids.forEach(function (c) { centMap[c.geoid] = c; });

        var rendered = 0;
        tracts.forEach(function (t) {
          var c = centMap[t.geoid];
          if (!c) return;
          var rent = t.median_gross_rent, inc = t.median_hh_income;
          if (!rent || !inc || inc <= 0) return;
          var pct = (rent * 12 / inc) * 100;   /* annualised rent ÷ annual income × 100 */
          L.circleMarker([c.lat, c.lon], {
            radius: 5, fillColor: ratioColor(pct),
            color: 'transparent', fillOpacity: 0.72
          }).bindTooltip(
            '<strong>' + escapeHtml(c.county_name) + ' Tract ' + t.geoid.slice(-6) + '</strong>' +
            '<br>Rent/Income: ' + pct.toFixed(1) + '%'
          ).addTo(map);
          rendered++;
        });

        var st = document.getElementById('affRatioMapStatus');
        if (st) st.textContent = rendered + ' tracts rendered · ACS 2023 5-year estimates';
      }).catch(function () {
        var st = document.getElementById('affRatioMapStatus');
        if (st) st.textContent = 'Affordability ratio data currently unavailable.';
      });
    }

    /* ─ Section B: Cost Burden county choropleth ─ */
    function renderBurdenMap() {
      var map = makeMap('affBurdenMap');
      if (!map) return;
      addTiles(map);

      function burdenColor(rate) {
        if (rate < 0.40) return '#c6dbef';
        if (rate < 0.50) return '#6baed6';
        if (rate < 0.60) return '#2171b5';
        return '#084594';
      }

      /* Helper: look up cost-burden rate for a county using its 5-digit FIPS code */
      function getCountyBurdenRate(fips, data) {
        var county = data[fips];
        if (!county || !county.renter_hh_by_ami) return { rate: 0, name: null };
        var ami = county.renter_hh_by_ami;
        var totR = 0, totB = 0;
        Object.values(ami).forEach(function (t) { totR += t.total || 0; totB += t.cost_burdened || 0; });
        return { rate: totR > 0 ? totB / totR : 0, name: county.name };
      }

      Promise.all([
        DataService.getJSON('data/co-county-boundaries.json'),
        DataService.getJSON('data/hna/chas_affordability_gap.json')
      ]).then(function (res) {
        var geojson  = res[0];
        var chasData = res[1].counties || {};

        L.geoJSON(geojson, {
          style: function (feat) {
            var fips = feat.properties.GEOID;
            var info = getCountyBurdenRate(fips, chasData);
            return { fillColor: burdenColor(info.rate), weight: 1, color: '#555', fillOpacity: 0.75 };
          },
          onEachFeature: function (feat, layer) {
            var fips = feat.properties.GEOID;
            var info = getCountyBurdenRate(fips, chasData);
            var name = info.name || feat.properties.NAME || fips;
            layer.bindTooltip('<strong>' + escapeHtml(name) + ' County</strong><br>Cost-burdened renters: ' +
              (info.rate * 100).toFixed(1) + '%');
          }
        }).addTo(map);

        var st = document.getElementById('affBurdenMapStatus');
        if (st) st.textContent = 'County-level data · HUD CHAS 2016–2020 5-year estimates';
      }).catch(function () {
        var st = document.getElementById('affBurdenMapStatus');
        if (st) st.textContent = 'Cost burden data currently unavailable.';
      });
    }

    /* ─ Section C: AMI Gap table ─ */
    function renderGapTable() {
      var tbody = document.getElementById('affGapTableBody');
      if (!tbody) return;
      DataService.getJSON('data/co_ami_gap_by_county.json').then(function (d) {
        var counties = (d.counties || []).slice();
        counties.sort(function (a, b) {
          var ga = (a.gap_units_minus_households_le_ami_pct || {})['50'] || 0;
          var gb = (b.gap_units_minus_households_le_ami_pct || {})['50'] || 0;
          return ga - gb;   /* most negative (largest gap) first */
        });

        /* Methodology vintage */
        var vintage = document.getElementById('affGeoDataVintage');
        if (vintage && d.meta) {
          var gen = d.meta.generated_at || '';   /* co_ami_gap_by_county.json uses generated_at */
          vintage.textContent = gen ? 'Data generated: ' + gen : '';
        }

        tbody.innerHTML = '';
        counties.slice(0, 10).forEach(function (c) {
          var gap      = (c.gap_units_minus_households_le_ami_pct || {})['50'] || 0;
          var coverage = (c.coverage_le_ami_pct || {})['50'] || 0;
          var supplyPct = (coverage * 100).toFixed(1);
          var tr = document.createElement('tr');
          tr.innerHTML = '<td>' + escapeHtml(c.county_name) + '</td>' +
            '<td style="color:#c0392b;font-variant-numeric:tabular-nums;">' + gap.toLocaleString() + '</td>' +
            '<td>' + supplyPct + '%</td>' +
            '<td style="color:var(--muted);">50% AMI tier</td>';
          tbody.appendChild(tr);
        });
      }).catch(function () {
        var tbody2 = document.getElementById('affGapTableBody');
        if (tbody2) tbody2.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">AMI gap data currently unavailable.</td></tr>';
      });
    }

    /* Boot all three sections */
    requestAnimationFrame(function () {
      try { renderRatioMap();  } catch (e) { handleDataError('aff-ratio-map', e); }
      try { renderBurdenMap(); } catch (e) { handleDataError('aff-burden-map', e); }
      try { renderGapTable();  } catch (e) { handleDataError('aff-gap-table', e); }
      clearLoadingState(panelId);
    });
  }

  /* ── Tab activation ────────────────────────────────────────────── */
  function activateTab(panelId, opts) {
    opts = opts || {};
    var updateHash = opts.updateHash !== false;
    var tabList = document.querySelector('[role="tablist"]');
    if (!tabList) return;

    var buttons = tabList.querySelectorAll('[role="tab"]');
    var panels  = document.querySelectorAll('[role="tabpanel"]');

    /* If no panel with this id exists, fall back to first tab */
    if (!document.getElementById(panelId)) {
      var firstBtn = buttons[0];
      if (firstBtn) panelId = firstBtn.getAttribute('aria-controls');
    }

    /* Update buttons */
    buttons.forEach(function (btn) {
      var active = btn.getAttribute('aria-controls') === panelId;
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });

    /* Update panels */
    panels.forEach(function (panel) {
      if (panel.id === panelId) {
        panel.classList.add('is-active');
        panel.removeAttribute('hidden');
      } else {
        panel.classList.remove('is-active');
        panel.setAttribute('hidden', '');
      }
    });

    /* Lazy-load the panel's module */
    loadPanel(panelId);

    /* Update the URL hash for deep linking (only on user intent) */
    if (updateHash) {
      try {
        history.replaceState(null, '', '#' + panelId);
      } catch (e) { /* ignore */ }
    }

    /* Leaflet maps in hidden panels need a size refresh after becoming visible */
    try {
      var activePanel = document.getElementById(panelId);
      if (activePanel && activePanel.querySelector) {
        if (activePanel.querySelector('#coMap')) {
          requestAnimationFrame(function () {
            var _leafletMap = window.ColoradoDeepDiveMap;
            if (_leafletMap && typeof _leafletMap.invalidateSize === 'function') {
              _leafletMap.invalidateSize(true);
            } else {
              console.warn('[colorado-deep-dive] Map object (window.ColoradoDeepDiveMap) not available for resize.');
            }
          });
        }
        /* Affordability Geography maps */
        if (panelId === 'tab-affordability-geo') {
          requestAnimationFrame(function () {
            _affGeoMaps.forEach(function (m) {
              try { m.invalidateSize(true); } catch (_e) { /* ignore */ }
            });
          });
        }
      }
    } catch (e) { /* ignore */ }
  }

  /* ── Tab setup ─────────────────────────────────────────────────── */
  function setupTabs() {
    var tabList = document.querySelector('[role="tablist"]');
    if (!tabList) return;

    var buttons = tabList.querySelectorAll('[role="tab"]');
    if (!buttons.length) return;

    /* Attach click and keyboard handlers */
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var target = btn.getAttribute('aria-controls');
        if (target) activateTab(target, { updateHash: true });
      });

      btn.addEventListener('keydown', function (e) {
        var all  = Array.prototype.slice.call(tabList.querySelectorAll('[role="tab"]'));
        var idx  = all.indexOf(btn);
        var next;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          next = all[(idx + 1) % all.length];
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          next = all[(idx - 1 + all.length) % all.length];
        } else if (e.key === 'Home') {
          e.preventDefault();
          next = all[0];
        } else if (e.key === 'End') {
          e.preventDefault();
          next = all[all.length - 1];
        }
        if (next) {
          next.focus();
          activateTab(next.getAttribute('aria-controls'), { updateHash: true });
        }
      });
    });

    /* Resolve initial panel from URL hash or first tab */
    var hash = window.location.hash.replace('#', '');
    var hashPanel = hash && document.getElementById(hash);
    var startPanel;

    if (hashPanel && hashPanel.getAttribute('role') === 'tabpanel') {
      startPanel = hash;
    } else {
      /* Default: use first tab that already has is-active, or just first tab */
      var activePanelEl = document.querySelector('[role="tabpanel"].is-active');
      startPanel = activePanelEl
        ? activePanelEl.id
        : (buttons[0] ? buttons[0].getAttribute('aria-controls') : null);
    }

    if (startPanel) activateTab(startPanel, { updateHash: false });

    /* Handle browser back/forward navigation */
    window.addEventListener('popstate', function () {
      var h = window.location.hash.replace('#', '');
      if (h) {
        var el = document.getElementById(h);
        if (el && el.getAttribute('role') === 'tabpanel') {
          activateTab(h, { updateHash: false });
        }
      }
    });
  }

  /* ── Freshness badge ───────────────────────────────────────────── */
  function stampFreshness() {
    var badge = document.querySelector('[data-freshness]');
    if (!badge) return;
    var now = new Date();
    badge.textContent = 'Updated ' + now.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    } catch (e) { /* ignore */ }
    stampFreshness();
    setupTabs();
    /* Bootstrap Prop 123 section on DOMContentLoaded whenever the table is present. */
    if (document.getElementById('prop123TableBody')) {
      try { initProp123Section(); } catch (e) { /* ignore */ }
    }
  });

  window.addEventListener('load', function () {
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  });

  /* ── Public API ────────────────────────────────────────────────── */
  window.coloradoDeepDive = {
    activateTab: activateTab,
    cacheGet:    cacheGet,
    cacheSet:    cacheSet
  };

}());
