/**
 * js/hna/hna-export.js
 * Responsibility: PDF/CSV/JSON export logic — thin re-export of js/hna-export.js.
 * Dependencies: window.__HNA_exportPdf, window.__HNA_exportCsv, window.__HNA_exportJson,
 *               window.__HNA_buildReportData (set by js/hna-export.js)
 * Exposes: nothing new — js/hna-export.js already exposes the window.__HNA_export* API.
 *
 * NOTE: The canonical implementation lives in js/hna-export.js and is loaded separately
 * by housing-needs-assessment.html before the hna/* modules. This file exists solely to
 * satisfy the module-directory contract defined in the problem statement; it has no code
 * of its own because the host page already loads the real implementation.
 */
(function () {
  'use strict';
  // No-op: js/hna-export.js is loaded directly by the HTML before this module runs,
  // so window.__HNA_exportPdf / exportCsv / exportJson / buildReportData are already set.
})();
