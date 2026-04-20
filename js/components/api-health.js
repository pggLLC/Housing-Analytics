/**
 * js/components/api-health.js
 * Lightweight API connectivity checker.
 *
 * Tests whether external data sources are reachable and reports
 * status as working / degraded / unavailable. Does NOT replace
 * DataQualityMonitor — this is a quick pre-flight check that
 * runs once on page load and reports results.
 *
 * Usage:
 *   ApiHealth.check([
 *     { name: 'Census ACS',  test: () => fetch('data/census-acs-state.json').then(r => r.ok) },
 *     { name: 'FRED',        test: () => fetch('data/fred-data.json').then(r => r.ok) },
 *   ]).then(results => ApiHealth.renderBadge('apiHealthBadge', results));
 *
 * Or auto-run with declarative attribute:
 *   <div id="apiHealthBadge" data-api-health="auto"></div>
 *
 * Exposes window.ApiHealth.
 */
(function () {
  'use strict';

  var TIMEOUT_MS = 5000;

  /**
   * Default data sources to probe (cached JSON files).
   * Each entry tests whether the cached data file is loadable.
   * This does NOT test live APIs (those require keys); it tests
   * whether the GitHub Actions pipeline has populated the cache.
   */
  var DEFAULT_SOURCES = [
    { name: 'Census ACS',       path: 'data/census-acs-state.json',       critical: true },
    { name: 'FRED Economic',    path: 'data/fred-data.json',              critical: true },
    { name: 'CHFA LIHTC',       path: 'data/chfa-lihtc.json',            critical: true },
    { name: 'QCT Overlays',     path: 'data/qct-colorado.json',          critical: false },
    { name: 'DDA Overlays',     path: 'data/dda-colorado.json',          critical: false },
    { name: 'AMI Gap',          path: 'data/co_ami_gap_by_county.json',  critical: false },
    { name: 'HNA Rankings',     path: 'data/hna/ranking-index.json',     critical: false },
    { name: 'County Boundaries',path: 'data/boundaries/counties_co.geojson',critical: false }
  ];

  /**
   * Probe a single source with timeout.
   * @param {{ name: string, path?: string, test?: function, critical?: boolean }} src
   * @returns {Promise.<{ name: string, status: string, critical: boolean, ms: number }>}
   */
  function probe(src) {
    var t0 = Date.now();
    var testFn = src.test || function () {
      var url = (typeof window.resolveAssetUrl === 'function')
        ? window.resolveAssetUrl(src.path) : src.path;
      // Use GET with default cache. Immediately cancel the response body after
      // reading the status so the HTTP connection is released cleanly. Without
      // body cancellation the browser keeps the connection open until the full
      // file is downloaded; when Playwright closes the browser context mid-download
      // (as it does in the site-audit workflow) those open connections are aborted
      // and appear as net::ERR_ABORTED hard failures in the audit report.
      return fetch(url, { cache: 'default' }).then(function (r) {
        var ok = r.ok;
        if (r.body) { r.body.cancel().catch(function () {}); }
        return ok;
      });
    };

    return Promise.race([
      testFn().then(function (ok) {
        return {
          name: src.name,
          status: ok ? 'working' : 'unavailable',
          critical: !!src.critical,
          ms: Date.now() - t0
        };
      }),
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ name: src.name, status: 'unavailable', critical: !!src.critical, ms: TIMEOUT_MS });
        }, TIMEOUT_MS);
      })
    ]).catch(function () {
      return { name: src.name, status: 'unavailable', critical: !!src.critical, ms: Date.now() - t0 };
    });
  }

  /**
   * Check multiple sources in parallel.
   * @param {Array} [sources] - Array of source configs. Defaults to DEFAULT_SOURCES.
   * @returns {Promise.<Array>} Results array.
   */
  function check(sources) {
    var list = sources || DEFAULT_SOURCES;
    return Promise.all(list.map(probe));
  }

  /**
   * Render a compact badge showing overall API health.
   * @param {string} containerId
   * @param {Array} results - From check()
   */
  function renderBadge(containerId, results) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var working = results.filter(function (r) { return r.status === 'working'; }).length;
    var total = results.length;
    var criticalDown = results.filter(function (r) { return r.status !== 'working' && r.critical; });

    var cls, label;
    if (criticalDown.length > 0) {
      cls = 'dqs-error';
      label = criticalDown.length + ' critical source' + (criticalDown.length > 1 ? 's' : '') + ' unavailable';
    } else if (working < total) {
      cls = 'dqs-warn';
      label = working + '/' + total + ' sources available';
    } else {
      cls = 'dqs-ok';
      label = 'All ' + total + ' data sources available';
    }

    var detailRows = results.map(function (r) {
      var icon = r.status === 'working' ? '✓' : '✕';
      var rCls = r.status === 'working' ? 'dqs-ok' : (r.critical ? 'dqs-error' : 'dqs-warn');
      var speed = r.status === 'working' ? ' (' + r.ms + 'ms)' : '';
      var crit = r.critical ? ' <em style="font-size:.7rem">(critical)</em>' : '';
      return '<div class="apih-row ' + rCls + '">' +
        '<span class="apih-icon">' + icon + '</span> ' +
        r.name + crit + speed +
        '</div>';
    }).join('');

    el.innerHTML =
      '<details class="apih-panel">' +
        '<summary class="dqs-summary ' + cls + '" style="font-size:.78rem;">' +
          '<span class="dqs-status-dot ' + cls + '"></span> ' + label +
        '</summary>' +
        '<div class="apih-body">' + detailRows + '</div>' +
      '</details>';
  }

  /* ── Auto-run for declarative elements ──────────────────────────── */
  function init() {
    var auto = document.querySelector('[data-api-health="auto"]');
    if (auto && auto.id) {
      // Delay probing to avoid racing with page-load data fetches.
      // In CI audit environments (Playwright), eager HEAD/GET probes
      // can cause net::ERR_ABORTED if the static server is still
      // serving other resources.
      setTimeout(function () {
        check().then(function (results) {
          renderBadge(auto.id, results);
        });
      }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 2000);
  }

  window.ApiHealth = { check: check, renderBadge: renderBadge, probe: probe, DEFAULT_SOURCES: DEFAULT_SOURCES };
})();
