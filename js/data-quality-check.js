/**
 * js/data-quality-check.js
 * Client-side data validation and freshness reporting.
 *
 * Validates critical datasets on page load, reports results to the console,
 * and updates any `.data-reliability-badge` elements found on the page.
 *
 * Public API (window.DataQuality):
 *   DataQuality.runAll()          — validate all datasets; returns Promise<Report[]>
 *   DataQuality.validate(cfg)     — validate a single dataset config; returns Promise<Report>
 *   DataQuality.renderBadge(el, report) — update a badge element with freshness info
 *
 * Each Report: { key, label, ok, warning, message, featureCount, cacheAge, dataAsOf, dataAgeMs }
 *
 * Emits CustomEvent 'dq:complete' on document with detail { reports, allOk }.
 * Emits CustomEvent 'dq:stale'    on document when any dataset is stale/invalid.
 */
(function (global) {
  "use strict";

  /** Datasets validated by default on every page. */
  var DEFAULT_DATASETS = [
    {
      key: "county-boundaries",
      label: "County boundaries",
      path: "data/co-county-boundaries.json",
      minFeatures: 60, // at least 60 of 64 CO counties
      critical: true,
    },
    {
      key: "chfa-lihtc",
      label: "CHFA LIHTC properties",
      path: "data/chfa-lihtc.json",
      minFeatures: 1,
      critical: true,
    },
    {
      key: "fred-data",
      label: "FRED economic series",
      path: "data/fred-data.json",
      validate: _validateFred,
      critical: false,
    },
    {
      key: "ami-gap",
      label: "AMI gap by county",
      path: "data/co_ami_gap_by_county.json",
      minFeatures: 0, // object-based file; custom check below
      validate: _validateAmiGap,
      critical: false,
    },
  ];

  /** Relative age thresholds for freshness badges (ms). */
  var AGE_FRESH = 2 * 60 * 60 * 1000; //  2 hours  → ✅ fresh
  var AGE_RECENT = 48 * 60 * 60 * 1000; // 48 hours  → ⚠️ recent but aging
  // Older than 48 h → ⚠️ stale

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Run default validations and render any `.data-reliability-badge` elements.
   * @returns {Promise<Report[]>}
   */
  function runAll() {
    return Promise.all(DEFAULT_DATASETS.map(validate)).then(function (reports) {
      var allOk = reports.every(function (r) {
        return r.ok;
      });
      _logResults(reports);
      _updateBadges(reports);
      _dispatchEvent("dq:complete", { reports: reports, allOk: allOk });
      if (!allOk) {
        _dispatchEvent("dq:stale", { reports: reports });
      }
      return reports;
    });
  }

  /**
   * Validate a single dataset configuration object.
   * @param {{ key:string, label:string, path:string, minFeatures?:number,
   *            validate?:function, critical?:boolean }} cfg
   * @returns {Promise<Report>}
   */
  function validate(cfg) {
    var cacheKey = "_fh_" + cfg.path;
    var cacheAge = _getCacheAge(cacheKey);

    var fetcher =
      typeof global.safeFetchJSON === "function"
        ? global.safeFetchJSON(cfg.path)
        : fetch(_resolvePath(cfg.path)).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          });

    return fetcher
      .then(function (data) {
        // Run custom validator if supplied
        if (typeof cfg.validate === "function") {
          return cfg.validate(data, cfg, cacheAge);
        }
        // Default GeoJSON feature-count check
        var features = Array.isArray(data && data.features)
          ? data.features.length
          : 0;
        var minF = typeof cfg.minFeatures === "number" ? cfg.minFeatures : 0;
        var ok = features >= minF;
        return _makeReport(
          cfg,
          ok,
          features,
          cacheAge,
          ok
            ? null
            : "Only " + features + " features (expected ≥ " + minF + ")",
          data,
        );
      })
      .catch(function (err) {
        return _makeReport(
          cfg,
          false,
          0,
          cacheAge,
          "Load error: " + ((err && err.message) || err),
          null,
        );
      });
  }

  /**
   * Update a single badge element to reflect a report.
   * @param {Element} el
   * @param {Report}  report  (or array of reports — use aggregate)
   */
  function renderBadge(el, reportOrReports) {
    if (!el) return;
    var reports = Array.isArray(reportOrReports)
      ? reportOrReports
      : [reportOrReports];
    var allOk = reports.every(function (r) {
      return r.ok;
    });
    var anyCriticalFail = reports.some(function (r) {
      return !r.ok && r.critical;
    });

    // Determine the most representative cache age
    var ages = reports
      .map(function (r) {
        return r.cacheAge;
      })
      .filter(function (a) {
        return a !== null && a !== undefined;
      });
    var minAge = ages.length ? Math.min.apply(null, ages) : null;

    el.textContent = _badgeText(allOk, anyCriticalFail, minAge);
    el.className = el.className.replace(/\bdrb--(ok|warn|error)\b/g, "");
    var cls = anyCriticalFail ? "drb--error" : allOk ? "drb--ok" : "drb--warn";
    el.classList.add(cls);
    el.setAttribute("aria-label", el.textContent);
    el.setAttribute("title", _badgeTitle(reports));
  }

  // ── Custom validators ────────────────────────────────────────────────────────

  function _validateFred(data, cfg, cacheAge) {
    var series = data && data.series;
    var hasSeries =
      series &&
      ((typeof series === "object" &&
        !Array.isArray(series) &&
        Object.keys(series).length > 0) ||
        (Array.isArray(series) && series.length > 0));
    if (!hasSeries) {
      return _makeReport(cfg, false, 0, cacheAge, "No FRED series found", data);
    }
    // Check that at least one series has observations
    var keys = Array.isArray(series) ? null : Object.keys(series);
    var hasObs = keys
      ? keys.some(function (k) {
          return (series[k].observations || []).length > 0;
        })
      : series.some(function (s) {
          return (s.observations || []).length > 0;
        });
    var count = keys ? keys.length : series.length;
    var ok = hasSeries && hasObs;
    return _makeReport(
      cfg,
      ok,
      count,
      cacheAge,
      ok ? null : "FRED series present but all have 0 observations",
      data,
    );
  }

  function _validateAmiGap(data, cfg, cacheAge) {
    var counties = data && data.counties;
    // counties may be either an array (current format) or a keyed object (legacy)
    var count = 0;
    if (Array.isArray(counties)) {
      count = counties.length;
    } else if (counties && typeof counties === "object") {
      count = Object.keys(counties).length;
    }
    var ok = count > 0;
    return _makeReport(
      cfg,
      ok,
      count,
      cacheAge,
      ok ? null : "AMI gap counties list is empty or malformed",
      data,
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _makeReport(cfg, ok, featureCount, cacheAge, errorMsg, data) {
    var dataAsOf = _extractDataTimestamp(data);
    var dataAgeMs = dataAsOf ? Date.now() - dataAsOf.getTime() : null;
    return {
      key: cfg.key,
      label: cfg.label,
      critical: !!cfg.critical,
      ok: ok,
      warning: !ok,
      message: errorMsg || null,
      featureCount: featureCount,
      cacheAge: cacheAge,
      dataAsOf: dataAsOf ? dataAsOf.toISOString() : null,
      dataAgeMs: dataAgeMs,
    };
  }

  function _extractDataTimestamp(data) {
    if (!data || typeof data !== "object") return null;
    var candidates = [
      data.generated_at,
      data.generatedAt,
      data.last_updated,
      data.lastUpdated,
      data.updated_at,
      data.updatedAt,
      data.as_of,
      data.asOf,
      data.vintage,
    ];
    if (data.meta && typeof data.meta === "object") {
      candidates.push(
        data.meta.generated,
        data.meta.generated_at,
        data.meta.last_updated,
        data.meta.lastUpdated,
        data.meta.as_of,
        data.meta.vintage,
      );
    }
    for (var i = 0; i < candidates.length; i++) {
      var raw = candidates[i];
      if (!raw) continue;
      var d = new Date(raw);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  function _getCacheAge(cacheKey) {
    try {
      var raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.ts) return null;
      return Date.now() - entry.ts;
    } catch (e) {
      return null;
    }
  }

  function _resolvePath(relativePath) {
    if (typeof global.resolveAssetUrl === "function") {
      return global.resolveAssetUrl(relativePath);
    }
    var base =
      typeof global.APP_BASE_PATH === "string" ? global.APP_BASE_PATH : "/";
    return base + relativePath.replace(/^\.\//, "");
  }

  function _logResults(reports) {
    reports.forEach(function (r) {
      var icon = r.ok ? "✅" : "⚠️";
      var detail =
        r.featureCount > 0 ? " (" + r.featureCount + " records)" : "";
      var age =
        r.cacheAge !== null ? " — cached " + _relTime(r.cacheAge) + " ago" : "";
      var msg = r.message ? " — " + r.message : "";
      console.log("[DataQuality] " + icon + " " + r.label + detail + age + msg);
    });
  }

  function _updateBadges(reports) {
    var badges = document.querySelectorAll(".data-reliability-badge");
    if (!badges.length) return;
    for (var i = 0; i < badges.length; i++) {
      renderBadge(badges[i], reports);
    }
  }

  function _dispatchEvent(name, detail) {
    try {
      var ev = new CustomEvent(name, { bubbles: true, detail: detail });
      document.dispatchEvent(ev);
    } catch (e) {
      /* older browsers */
    }
  }

  function _badgeText(allOk, anyCriticalFail, ageMs) {
    if (anyCriticalFail) return "⚠ Data unavailable";
    var ageStr = "";
    if (ageMs !== null && ageMs !== undefined) {
      if (ageMs < AGE_FRESH) {
        ageStr = " · " + _relTime(ageMs) + " ago";
      } else if (ageMs < AGE_RECENT) {
        ageStr = " · cached " + _relTime(ageMs) + " ago";
      } else {
        ageStr = " · data may be stale (" + _relTime(ageMs) + ")";
      }
    }
    return allOk ? "✅ Data current" + ageStr : "⚠ Some data outdated" + ageStr;
  }

  function _badgeTitle(reports) {
    return reports
      .map(function (r) {
        return (
          (r.ok ? "✅ " : "⚠ ") +
          r.label +
          (r.featureCount ? " (" + r.featureCount + ")" : "") +
          (r.message ? ": " + r.message : "")
        );
      })
      .join("\n");
  }

  function _relTime(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    return Math.floor(h / 24) + "d";
  }

  // ── Auto-run on DOMContentLoaded ─────────────────────────────────────────────

  function _autoRun() {
    // Only run if the page has a data-quality badge or an aria-live status element
    var hasBadge = !!document.querySelector(".data-reliability-badge");
    var hasStatus = !!document.getElementById("statusPanel");
    if (!hasBadge && !hasStatus) return;
    runAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _autoRun);
  } else {
    _autoRun();
  }

  // ── Expose ───────────────────────────────────────────────────────────────────

  global.DataQuality = {
    runAll: runAll,
    validate: validate,
    renderBadge: renderBadge,
  };
})(window);
