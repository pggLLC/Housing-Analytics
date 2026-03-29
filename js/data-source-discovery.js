// js/data-source-discovery.js
// Automated data source discovery — scans known paths and compares against
// DATA-MANIFEST.json to surface new or unregistered data files.
// Exposed as window.DataSourceDiscovery.

(function () {
  'use strict';

  var CONFIG_PATH  = 'config/data-discovery-config.json';
  var MANIFEST_PATH = 'DATA-MANIFEST.json';
  var REPORT_KEY   = 'drh_last_discovery_report';

  // ── Utility helpers ──────────────────────────────────────────────────────

  function resolvePath(p) {
    return (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(p)
      : p;
  }

  function safeFetch(url) {
    return fetch(resolvePath(url))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
        return r.json();
      });
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // Simple FNV-1a-inspired hash for change detection (browser-safe, no crypto).
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  // ── Known data directory probes ──────────────────────────────────────────
  // Because browsers can't list directories, we compare against the registered
  // manifests and probe a curated list of well-known paths derived from the
  // codebase scan.
  var PROBE_PATHS = [
    'data/manifest.json',
    'data/chfa-lihtc.json',
    'data/fred-data.json',
    'data/car-market.json',
    'data/car-market-report-2026-02.json',
    'data/car-market-report-2026-03.json',
    'data/census-acs-state.json',
    'data/co-county-boundaries.json',
    'data/co-county-demographics.json',
    'data/co-county-economic-indicators.json',
    'data/co-demographics.json',
    'data/co-historical-allocations.json',
    'data/co_ami_gap_by_county.json',
    'data/dda-colorado.json',
    'data/glossary.json',
    'data/hud-fmr-income-limits.json',
    'data/insights-meta.json',
    'data/lihtc-trends-by-county.json',
    'data/policy_briefs.json',
    'data/qct-colorado.json',
    'data/states-10m.json',
    'data/allocations.json',
    'data/market/hud_lihtc_co.geojson',
    'data/market/acs_tract_metrics_co.json',
    'data/market/tract_centroids_co.json',
    'data/market/nhpd_co.geojson',
    'data/market/reference-projects.json',
    'data/environmental/fema-flood-co.geojson',
    'data/environmental/epa-superfund-co.json',
    'data/policy/soft-funding-status.json',
    'data/policy/chfa-awards-historical.json',
    'data/policy/county-ownership.json',
    'data/amenities/grocery_co.geojson',
    'data/hna/chas_affordability_gap.json',
    'data/hna/municipal/municipal-config.json',
    'data/hna/municipal/growth-rates.json',
    'config/data-discovery-config.json'
  ];

  // ── Main discovery logic ─────────────────────────────────────────────────

  /**
   * Probe a single URL: HEAD to check existence, then optionally fetch size/hash.
   * @param {string} path
   * @returns {Promise<{path, exists, sizeEstimate, hash, probeMs}>}
   */
  function probeFile(path) {
    var start = Date.now();
    return fetch(resolvePath(path), { method: 'HEAD' })
      .then(function (r) {
        var size = parseInt(r.headers.get('content-length') || '0', 10) || 0;
        return { path: path, exists: r.ok, sizeEstimate: size, probeMs: Date.now() - start };
      })
      .catch(function () {
        return { path: path, exists: false, sizeEstimate: 0, probeMs: Date.now() - start };
      });
  }

  /**
   * Fetch a small portion of a JSON file to compute a hash for change detection.
   * @param {string} path
   * @returns {Promise<string>}
   */
  function computeFileHash(path) {
    return fetch(resolvePath(path))
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) { return hashString(text.slice(0, 4096)); })
      .catch(function () { return 'error'; });
  }

  /**
   * Build a map of file_path → entry from DATA-MANIFEST.json for fast lookup.
   * @param {object} manifest
   * @returns {object}
   */
  function buildManifestIndex(manifest) {
    var index = {};
    var sources = manifest.sources || [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (s.file_path) index[s.file_path] = s;
    }
    return index;
  }

  /**
   * Run the full discovery scan.
   * @returns {Promise<DiscoveryReport>}
   */
  function runDiscovery() {
    var scanStart = Date.now();
    var manifestIndex = {};

    return safeFetch(MANIFEST_PATH)
      .then(function (manifest) {
        manifestIndex = buildManifestIndex(manifest);
        return Promise.all(PROBE_PATHS.map(probeFile));
      })
      .then(function (probeResults) {
        var existingFiles = probeResults.filter(function (r) { return r.exists; });
        var newSources    = existingFiles.filter(function (r) {
          return !manifestIndex[r.path];
        });
        var knownSources  = existingFiles.filter(function (r) {
          return !!manifestIndex[r.path];
        });
        var missingFiles  = probeResults.filter(function (r) { return !r.exists; });

        // Fetch hashes for new sources only (to keep scan fast)
        var hashPromises = newSources.map(function (r) {
          return computeFileHash(r.path).then(function (hash) {
            r.hash = hash;
            return r;
          });
        });

        return Promise.all(hashPromises).then(function () {
          var report = {
            scanTimestamp:  nowISO(),
            scanDurationMs: Date.now() - scanStart,
            totalProbed:    probeResults.length,
            existingCount:  existingFiles.length,
            newSourceCount: newSources.length,
            missingCount:   missingFiles.length,
            newSources: newSources.map(function (r) {
              return {
                path:          r.path,
                hash:          r.hash || '',
                sizeEstimate:  r.sizeEstimate,
                suggestedName: suggestName(r.path),
                suggestedDesc: suggestDescription(r.path),
                suggestedFreq: suggestFrequency(r.path),
                status:        'pending-review'
              };
            }),
            knownSources: knownSources.map(function (r) {
              var entry = manifestIndex[r.path] || {};
              return {
                path:        r.path,
                source_name: entry.source_name || r.path,
                status:      entry.status || 'unknown',
                last_update: entry.last_update || null
              };
            }),
            missingRegistered: missingFiles
              .filter(function (r) { return !!manifestIndex[r.path]; })
              .map(function (r) {
                var entry = manifestIndex[r.path] || {};
                return {
                  path:        r.path,
                  source_name: entry.source_name || r.path,
                  last_update: entry.last_update || null
                };
              })
          };

          // Persist report to sessionStorage for UI consumption
          try {
            sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
          } catch (_) { /* quota exceeded — skip */ }

          return report;
        });
      });
  }

  // ── Metadata suggestion helpers ──────────────────────────────────────────

  function suggestName(filePath) {
    var base = filePath.replace(/^.*\//, '').replace(/\.(json|geojson|csv|tsv)$/, '');
    return base
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function suggestDescription(filePath) {
    if (/geojson/i.test(filePath))  return 'GeoJSON spatial dataset — verify coverage and feature schema.';
    if (/census|acs/i.test(filePath))  return 'Census / ACS demographic data — confirm vintage year.';
    if (/lihtc|chfa/i.test(filePath))  return 'LIHTC or CHFA housing program data.';
    if (/fred/i.test(filePath))         return 'FRED economic indicator time-series data.';
    if (/market|car/i.test(filePath))   return 'Real-estate market report data.';
    if (/hud/i.test(filePath))          return 'HUD program or geographic designation data.';
    if (/amenity/i.test(filePath))      return 'Amenity / POI dataset for proximity analysis.';
    if (/environ/i.test(filePath))      return 'Environmental overlay or hazard data.';
    if (/policy/i.test(filePath))       return 'Policy or funding status data.';
    return 'Data file — review schema and update frequency.';
  }

  function suggestFrequency(filePath) {
    if (/fred|census|acs|car-market-report/i.test(filePath)) return 'Monthly';
    if (/lihtc|chfa/i.test(filePath))  return 'Quarterly';
    if (/hud|boundaries|states/i.test(filePath)) return 'Annual';
    if (/amenity|environ/i.test(filePath)) return 'Annual';
    return 'Unknown';
  }

  // ── Cached report accessor ───────────────────────────────────────────────

  function getLastReport() {
    try {
      var raw = sessionStorage.getItem(REPORT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.DataSourceDiscovery = {
    runDiscovery:    runDiscovery,
    getLastReport:   getLastReport,
    probePaths:      PROBE_PATHS,
    suggestName:     suggestName,
    suggestDescription: suggestDescription,
    suggestFrequency: suggestFrequency
  };

}());
