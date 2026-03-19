/**
 * hna-export.js
 * Responsibility: Export logic (PDF, CSV, JSON) for Housing Needs Assessment.
 * Dependencies: window.__HNA_exportPdf, window.__HNA_exportCsv, window.__HNA_exportJson, window.__HNA_buildReportData
 * Exposes: window.HNAExport
 */
(function () {
  'use strict';

  window.HNAExport = {
    exportPdf: function (filename) {
      if (window.__HNA_exportPdf) return window.__HNA_exportPdf(filename);
      window.print();
    },
    exportCsv: function (reportData, filename) {
      if (window.__HNA_exportCsv) return window.__HNA_exportCsv(reportData, filename);
      console.warn('[HNAExport] exportCsv: window.__HNA_exportCsv is not loaded.');
    },
    exportJson: function (reportData, filename) {
      if (window.__HNA_exportJson) return window.__HNA_exportJson(reportData, filename);
      console.warn('[HNAExport] exportJson: window.__HNA_exportJson is not loaded.');
    },
    buildReportData: function () {
      if (window.__HNA_buildReportData) return window.__HNA_buildReportData();
      return null;
    },
  };
})();
