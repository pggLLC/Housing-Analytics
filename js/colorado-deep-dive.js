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

  function initPolicyPanel(panelId) {
    showLoadingState(panelId);
    try {
      if (window.PolicySimulator && typeof window.PolicySimulator.init === 'function') {
        window.PolicySimulator.init();
      }
    } catch (e) {
      handleDataError('policy-simulator', e);
    } finally {
      clearLoadingState(panelId);
    }
  }

  /* ── Tab activation ────────────────────────────────────────────── */
  function activateTab(panelId) {
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

    /* Update the URL hash for deep linking */
    try {
      history.replaceState(null, '', '#' + panelId);
    } catch (e) { /* ignore in environments where history isn't available */ }
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
        if (target) activateTab(target);
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
          activateTab(next.getAttribute('aria-controls'));
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

    if (startPanel) activateTab(startPanel);

    /* Handle browser back/forward navigation */
    window.addEventListener('popstate', function () {
      var h = window.location.hash.replace('#', '');
      if (h) {
        var el = document.getElementById(h);
        if (el && el.getAttribute('role') === 'tabpanel') {
          activateTab(h);
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
