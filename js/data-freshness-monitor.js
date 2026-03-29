// js/data-freshness-monitor.js
// Tracks data freshness for all registered sources against expected update
// windows and generates monthly freshness reports.
// Exposed as window.DataFreshnessMonitor.
//
// Distinct from js/data-freshness.js which only stamps .data-timestamp elements.

(function () {
  'use strict';

  var REPORT_KEY      = 'drh_freshness_report';
  var MS_PER_DAY      = 86400000;
  var MANIFEST_PATH   = 'DATA-MANIFEST.json';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function resolvePath(p) {
    return (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(p) : p;
  }

  function daysSince(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / MS_PER_DAY);
  }

  function nowISO() { return new Date().toISOString(); }

  // ── Frequency → expected max-age in days ─────────────────────────────────

  var FREQ_DAYS = {
    'Daily':     2,
    'Weekly':    10,
    'Monthly':   45,
    'Quarterly': 120,
    'Annual':    400,
    'Unknown':   null
  };

  function maxAgeDays(freq) {
    return FREQ_DAYS[freq] !== undefined ? FREQ_DAYS[freq] : 400;
  }

  function freshnessStatus(days, maxAge) {
    if (days === null || maxAge === null) return 'unknown';
    var agingThreshold = Math.floor(maxAge * 0.7);
    if (days <= agingThreshold) return 'current';
    if (days <= maxAge)         return 'aging';
    return 'stale';
  }

  // ── Source report builder ─────────────────────────────────────────────────

  function buildSourceReport(source) {
    var freq     = source.updateFrequency || source.update_method || 'Unknown';
    var updated  = source.lastUpdated || source.last_update || null;
    var days     = daysSince(updated);
    var maxAge   = maxAgeDays(freq);
    var status   = freshnessStatus(days, maxAge);
    var score    = (days === null || maxAge === null)
      ? null
      : Math.max(0, Math.round(100 * (1 - days / maxAge)));

    return {
      id:            source.id || source.file_path || source.source_name,
      name:          source.name || source.source_name || 'Unknown',
      category:      source.category || 'Uncategorized',
      lastUpdated:   updated,
      daysSince:     days,
      frequency:     freq,
      maxAgeDays:    maxAge,
      status:        status,
      freshnessScore: score,
      file:          source.localFile || source.file_path || null,
      url:           source.url || source.source_url || null,
      tags:          source.tags || []
    };
  }

  // ── Summary stats ────────────────────────────────────────────────────────

  function buildSummary(reports) {
    var counts = { current: 0, aging: 0, stale: 0, unknown: 0 };
    var scores = [];
    for (var i = 0; i < reports.length; i++) {
      var r = reports[i];
      counts[r.status] = (counts[r.status] || 0) + 1;
      if (r.freshnessScore !== null) scores.push(r.freshnessScore);
    }
    var avg = scores.length
      ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length)
      : null;
    return {
      total:         reports.length,
      counts:        counts,
      avgFreshness:  avg,
      staleSources:  reports.filter(function (r) { return r.status === 'stale'; })
                            .map(function (r) { return r.name; }),
      agingSources:  reports.filter(function (r) { return r.status === 'aging'; })
                            .map(function (r) { return r.name; })
    };
  }

  // ── Run full freshness scan ──────────────────────────────────────────────

  /**
   * Fetch all sources from DataSourceInventory + DATA-MANIFEST.json,
   * compute freshness for each, and return a structured report.
   * @returns {Promise<FreshnessReport>}
   */
  function runFreshnessCheck() {
    var sourceReports = [];

    // 1. Use DataSourceInventory if loaded (js/data-source-inventory.js)
    if (window.DataSourceInventory) {
      var inv = window.DataSourceInventory.getSources();
      for (var i = 0; i < inv.length; i++) {
        sourceReports.push(buildSourceReport(inv[i]));
      }
    }

    // 2. Augment from DATA-MANIFEST.json for sources not in the inventory
    return fetch(resolvePath(MANIFEST_PATH))
      .then(function (r) { return r.ok ? r.json() : { sources: [] }; })
      .then(function (manifest) {
        var sources = manifest.sources || [];
        var seen = {};
        for (var k = 0; k < sourceReports.length; k++) {
          seen[sourceReports[k].file] = true;
        }
        for (var m = 0; m < sources.length; m++) {
          var s = sources[m];
          if (!seen[s.file_path]) {
            var rep = buildSourceReport({
              id:           s.file_path,
              name:         s.source_name,
              localFile:    s.file_path,
              url:          s.source_url,
              lastUpdated:  s.last_update,
              updateFrequency: s.update_method === 'daily' ? 'Daily'
                             : s.update_method === 'weekly' ? 'Weekly'
                             : s.update_method === 'monthly' ? 'Monthly'
                             : 'Unknown'
            });
            sourceReports.push(rep);
          }
        }

        var report = {
          generatedAt: nowISO(),
          summary:     buildSummary(sourceReports),
          sources:     sourceReports
        };

        try {
          sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
        } catch (_) { /* quota */ }

        return report;
      })
      .catch(function () {
        var report = {
          generatedAt: nowISO(),
          summary:     buildSummary(sourceReports),
          sources:     sourceReports
        };
        try {
          sessionStorage.setItem(REPORT_KEY, JSON.stringify(report));
        } catch (_) { /* quota */ }
        return report;
      });
  }

  // ── Monthly report generator ──────────────────────────────────────────────

  /**
   * Generate a Markdown-formatted monthly freshness report.
   * @param {FreshnessReport} report
   * @returns {string}
   */
  function generateMarkdownReport(report) {
    var lines = [
      '# Data Freshness Report',
      '',
      '**Generated:** ' + report.generatedAt,
      '',
      '## Summary',
      '',
      '| Metric | Value |',
      '|---|---|',
      '| Total Sources | ' + report.summary.total + ' |',
      '| Current       | ' + (report.summary.counts.current || 0) + ' |',
      '| Aging         | ' + (report.summary.counts.aging   || 0) + ' |',
      '| Stale         | ' + (report.summary.counts.stale   || 0) + ' |',
      '| Unknown       | ' + (report.summary.counts.unknown || 0) + ' |',
      '| Avg Freshness | ' + (report.summary.avgFreshness !== null
        ? report.summary.avgFreshness + '%' : 'N/A') + ' |',
      ''
    ];

    if (report.summary.staleSources && report.summary.staleSources.length) {
      lines.push('## ⚠ Stale Sources', '');
      for (var i = 0; i < report.summary.staleSources.length; i++) {
        lines.push('- ' + report.summary.staleSources[i]);
      }
      lines.push('');
    }

    lines.push('## All Sources', '');
    lines.push('| Name | Category | Status | Days Since Update | Score |');
    lines.push('|---|---|---|---|---|');
    var sources = report.sources || [];
    for (var j = 0; j < sources.length; j++) {
      var s = sources[j];
      lines.push(
        '| ' + s.name +
        ' | ' + s.category +
        ' | ' + s.status +
        ' | ' + (s.daysSince !== null ? s.daysSince : '—') +
        ' | ' + (s.freshnessScore !== null ? s.freshnessScore + '%' : '—') +
        ' |'
      );
    }

    return lines.join('\n');
  }

  /**
   * Trigger a browser download of the freshness report as Markdown.
   * @param {FreshnessReport} report
   */
  function downloadMarkdownReport(report) {
    var md   = generateMarkdownReport(report);
    var blob = new Blob([md], { type: 'text/markdown' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download  = 'data-freshness-report-' + report.generatedAt.slice(0, 10) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getLastReport() {
    try {
      var raw = sessionStorage.getItem(REPORT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  window.DataFreshnessMonitor = {
    runFreshnessCheck:       runFreshnessCheck,
    getLastReport:           getLastReport,
    buildSourceReport:       buildSourceReport,
    generateMarkdownReport:  generateMarkdownReport,
    downloadMarkdownReport:  downloadMarkdownReport
  };

}());
