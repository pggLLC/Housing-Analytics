/**
 * chart-fix.js — Sitewide chart lifecycle manager for COHO Analytics
 *
 * Solves the "blank chart" problem that occurs when Chart.js renders into a
 * hidden container (e.g. inside a collapsed <details> element, a hidden tab,
 * or a section off-screen).
 *
 * How it works:
 *  1. Charts are *registered* before or after creation.
 *  2. An IntersectionObserver watches each canvas; when it becomes visible the
 *     chart is (re)rendered or resized.
 *  3. A ResizeObserver watches each canvas's parent container so that charts
 *     reflow when the layout changes.
 *  4. <details> elements that contain canvases have a toggle listener added
 *     so that charts inside them refresh when the panel opens.
 *  5. Charts can be destroyed and re-created without duplication because the
 *     manager tracks the Chart.js instance per canvas.
 *
 * Usage:
 *   ChartFix.register(canvasId, createFn);
 *   ChartFix.refresh(canvasId);
 *   ChartFix.destroy(canvasId);
 *   ChartFix.refreshAll();
 *
 * See docs/CHART_FIX_USAGE.md for full documentation.
 */
(function (global) {
  'use strict';

  /* ── Registry ── */
  var _registry = {};   // canvasId → { canvas, createFn, instance, io, ro }

  /* ── Observer factories ── */
  var _intersectionObserver = null;
  var _resizeObserver       = null;

  function _getIntersectionObserver() {
    if (_intersectionObserver) return _intersectionObserver;
    if (!('IntersectionObserver' in window)) return null;
    _intersectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.dataset.chartFixId;
          if (id) _refresh(id, false);
        }
      });
    }, { threshold: 0.01 });
    return _intersectionObserver;
  }

  function _getResizeObserver() {
    if (_resizeObserver) return _resizeObserver;
    if (!('ResizeObserver' in window)) return null;
    _resizeObserver = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        var container = entry.target;
        var canvases = container.querySelectorAll('canvas[data-chart-fix-id]');
        canvases.forEach(function (canvas) {
          var id = canvas.dataset.chartFixId;
          if (id && _registry[id] && _registry[id].instance) {
            try { _registry[id].instance.resize(); } catch (_) { _refresh(id, false); }
          }
        });
      });
    });
    return _resizeObserver;
  }

  /* ── <details> toggling ── */
  function _wireDetailsParents(canvas) {
    var el = canvas.parentElement;
    while (el) {
      if (el.tagName === 'DETAILS' && !el.dataset.chartFixWired) {
        el.dataset.chartFixWired = '1';
        el.addEventListener('toggle', function () {
          if (el.open) {
            var canvases = el.querySelectorAll('canvas[data-chart-fix-id]');
            canvases.forEach(function (c) {
              var id = c.dataset.chartFixId;
              if (id) _refresh(id, false);
            });
          }
        });
      }
      el = el.parentElement;
    }
  }

  /* ── Core refresh logic ── */
  function _refresh(id, force) {
    var entry = _registry[id];
    if (!entry) return;
    var canvas = entry.canvas;

    /* Skip if container is not laid out (zero dimensions) */
    if (!force) {
      var rect = canvas.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      /* Also skip if any ancestor is display:none */
      var el = canvas;
      while (el) {
        if (el === document.body) break;
        if (getComputedStyle(el).display === 'none') return;
        el = el.parentElement;
      }
    }

    if (entry.instance) {
      /* Chart already exists — just resize */
      try { entry.instance.resize(); return; } catch (_) { /* fall through to recreate */ }
    }

    /* Create the chart */
    if (typeof entry.createFn === 'function') {
      try {
        /* Destroy any pre-existing Chart.js instance attached to this canvas */
        if (global.Chart) {
          var existing = global.Chart.getChart(canvas);
          if (existing) { try { existing.destroy(); } catch (_) { /* noop */ } }
        }
        entry.instance = entry.createFn(canvas);
      } catch (e) {
        console.warn('[ChartFix] createFn error for "' + id + '":', e);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * Public API
   * ══════════════════════════════════════════════════════════════════════════ */
  var ChartFix = {

    /**
     * Register a canvas for lifecycle management.
     *
     * @param {string}   canvasId   The `id` attribute of the <canvas> element
     * @param {Function} createFn   Called with the canvas element; must return
     *                              a Chart.js instance (or any object with a
     *                              `.resize()` method).
     * @param {Object}   [options]
     * @param {boolean}  [options.renderImmediately=true]  Render right away if
     *                   the canvas is already visible.
     */
    register: function (canvasId, createFn, options) {
      var opts = options || {};
      var canvas = document.getElementById(canvasId);
      if (!canvas) {
        console.warn('[ChartFix] canvas not found: "' + canvasId + '"');
        return;
      }

      /* Tag the canvas for observer callbacks */
      canvas.dataset.chartFixId = canvasId;

      /* Store in registry */
      _registry[canvasId] = {
        canvas:   canvas,
        createFn: createFn,
        instance: null,
      };

      /* Wire <details> parents */
      _wireDetailsParents(canvas);

      /* IntersectionObserver */
      var io = _getIntersectionObserver();
      if (io) io.observe(canvas);

      /* ResizeObserver on parent container */
      var ro = _getResizeObserver();
      if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

      /* Render now if visible */
      if (opts.renderImmediately !== false) {
        _refresh(canvasId, false);
      }
    },

    /**
     * Manually trigger a refresh (resize or re-create) for a canvas.
     * @param {string} canvasId
     */
    refresh: function (canvasId) {
      _refresh(canvasId, true);
    },

    /**
     * Refresh all registered canvases.
     */
    refreshAll: function () {
      Object.keys(_registry).forEach(function (id) {
        _refresh(id, false);
      });
    },

    /**
     * Destroy the Chart.js instance for a canvas and remove it from the registry.
     * @param {string} canvasId
     */
    destroy: function (canvasId) {
      var entry = _registry[canvasId];
      if (!entry) return;
      if (entry.instance) {
        try { entry.instance.destroy(); } catch (_) { /* noop */ }
      }
      if (entry.canvas) {
        delete entry.canvas.dataset.chartFixId;
        var io = _getIntersectionObserver();
        if (io) io.unobserve(entry.canvas);
        var ro = _getResizeObserver();
        if (ro && entry.canvas.parentElement) ro.unobserve(entry.canvas.parentElement);
      }
      delete _registry[canvasId];
    },

    /**
     * Retrieve the Chart.js instance for a canvas (or null).
     * @param {string} canvasId
     * @returns {Object|null}
     */
    getInstance: function (canvasId) {
      return (_registry[canvasId] && _registry[canvasId].instance) || null;
    },

    /**
     * Update the Chart.js instance stored for a canvas.
     * Use this when you create a chart yourself and want ChartFix to manage
     * its lifecycle (resize, destroy) without re-running createFn.
     *
     * @param {string} canvasId
     * @param {Object} instance  Chart.js instance
     */
    setInstance: function (canvasId, instance) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      canvas.dataset.chartFixId = canvasId;
      if (!_registry[canvasId]) {
        _registry[canvasId] = { canvas: canvas, createFn: null, instance: null };
        _wireDetailsParents(canvas);
        var io = _getIntersectionObserver();
        if (io) io.observe(canvas);
        var ro = _getResizeObserver();
        if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
      }
      _registry[canvasId].instance = instance;
    },

    /**
     * Number of registered canvases (useful for diagnostics).
     */
    count: function () {
      return Object.keys(_registry).length;
    },
  };

  /* ── Refresh all on window resize (debounced) ── */
  var _resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () { ChartFix.refreshAll(); }, 150);
  });

  /* ── Expose globally ── */
  global.ChartFix = ChartFix;

}(typeof window !== 'undefined' ? window : this));
