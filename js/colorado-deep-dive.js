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

  
  function initProp123Section() {
    var tbody = document.getElementById('prop123TableBody');
    var summary = document.getElementById('prop123Summary');
    var status = document.getElementById('prop123Status');
    if (!tbody) return;

    function setStatus(msg) {
      if (status) status.textContent = msg || '';
    }

    var primaryUrl = (window.APP_CONFIG && window.APP_CONFIG.PROP123_API_URL) ? window.APP_CONFIG.PROP123_API_URL : 'api/prop123';
    var fallbackUrl = 'data/prop123_jurisdictions.json';

    // Try serverless first (if you later host it), then local fallback for GitHub Pages
    function loadWithFallback(primary, fallback) {
      return DataService.getJSON(primary).catch(function () {
        console.warn('[colorado-deep-dive] Primary failed, using fallback:', fallback);
        return DataService.getJSON(DataService.baseData(fallback.replace(/^data\//, '')));
      });
    }
    loadWithFallback(primaryUrl, fallbackUrl).then(function (data) {
      var jurisdictions = data.jurisdictions || data.items || data || [];
      // Allow the fallback file schema: { updated, jurisdictions: [...] }
      if (data && data.jurisdictions) jurisdictions = data.jurisdictions;
      if (!Array.isArray(jurisdictions)) jurisdictions = [];
      var count = jurisdictions.length;
      if (summary) summary.textContent = count ? (count + ' jurisdictions currently listed in the Prop 123 commitment dataset.') : 'No jurisdictions found in the dataset.';
      setStatus(count ? ('(' + count + ')') : '(0)');

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
        var dt = j.commitment_date || j.date || j.filed_date || '';
        var dateTxt = dt ? String(dt).replace('T00:00:00.000Z','') : '—';

        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + escapeHtml(name) + '</td>' +
                       '<td>' + escapeHtml(type) + '</td>' +
                       '<td>' + escapeHtml(statusTxt) + '</td>' +
                       '<td>' + escapeHtml(dateTxt) + '</td>';
        tbody.appendChild(tr);
      });
    }).catch(function (e) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);">Prop 123 data unavailable (missing API and fallback file).</td></tr>';
      if (summary) summary.textContent = '';
      setStatus('unavailable');
      console.warn(e);
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
      // { updated: "YYYY-MM-DD", median_price: 0, active_listings: 0, median_dom: 0, price_per_sqft: 0 }
      var mp  = d.median_price ?? d.medianPrice;
      var inv = d.active_listings ?? d.inventory;
      var dom = d.median_dom ?? d.days_on_market;
      var ppsf = d.price_per_sqft ?? d.pricePerSqFt;

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
      if (activePanel && activePanel.querySelector && activePanel.querySelector('#coMap')) {
        requestAnimationFrame(function () {
          if (window.coLihtcMap && typeof window.coLihtcMap.invalidateSize === 'function') {
            window.coLihtcMap.invalidateSize(true);
          } else if (window.CODeepDiveMap && window.CODeepDiveMap.map && typeof window.CODeepDiveMap.map.invalidateSize === 'function') {
            window.CODeepDiveMap.map.invalidateSize(true);
          }
        });
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
      window.scrollTo(0, 0);
    } catch (e) { /* ignore */ }
    stampFreshness();
    setupTabs();
  });

  /* ── Public API ────────────────────────────────────────────────── */
  window.coloradoDeepDive = {
    activateTab: activateTab,
    cacheGet:    cacheGet,
    cacheSet:    cacheSet
  };

}());
