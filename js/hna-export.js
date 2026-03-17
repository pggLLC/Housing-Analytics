/*
  hna-export.js — Export utilities for Housing Needs Assessment reports.

  Provides three export modes:
    • PDF  — multi-page screenshot via html2canvas + jsPDF (with print() fallback)
    • CSV  — key housing metrics for the current geography as a comma-separated file
    • JSON — structured report snapshot for archiving or downstream processing

  All public entry points are exposed on the window object so they can be
  called from housing-needs-assessment.js and tested in Node.js static checks:

    window.__HNA_exportPdf(filename?)
    window.__HNA_exportCsv(reportData, filename?)
    window.__HNA_exportJson(reportData, filename?)
    window.__HNA_buildReportData()    ← reads rendered DOM values
*/

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Trigger a file download for a Blob in browsers that support it. */
  function _triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  /**
   * Show a brief success toast and announce to the #hnaLiveRegion (Recommendation 5.1).
   * Auto-dismisses after 4 seconds.
   *
   * @param {string} message - Human-readable confirmation, e.g. "PDF downloaded ✓"
   */
  function _showExportToast(message) {
    // Announce to screen readers via aria-live region
    var liveRegion = document.getElementById('hnaLiveRegion');
    if (liveRegion) {
      liveRegion.textContent = '';
      requestAnimationFrame(function () { liveRegion.textContent = message; });
    }

    // Visual toast for sighted users
    var existing = document.getElementById('hna-export-toast');
    if (existing) { existing.remove(); }

    var toast = document.createElement('div');
    toast.id = 'hna-export-toast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = [
      'position:fixed', 'bottom:1.25rem', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--good,#047857)', 'color:#fff',
      'padding:.55rem 1.25rem', 'border-radius:8px', 'font-size:.875rem',
      'box-shadow:0 4px 18px rgba(0,0,0,.22)', 'z-index:9500',
      'max-width:90vw', 'text-align:center', 'pointer-events:none',
      'transition:opacity .3s'
    ].join(';');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { if (toast.parentNode) { toast.remove(); } }, 350);
    }, 4000);
  }

  /** Safely read visible text from a DOM element, returning '' on miss. */
  function _elText(id) {
    var el = document.getElementById(id);
    return el ? el.textContent.trim() : '';
  }

  /** Escape a CSV field: wrap in quotes and double any internal quotes. */
  function _csvField(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /** Convert an array-of-arrays to a CSV string. */
  function _toCsv(rows) {
    return rows.map(function (r) {
      return r.map(_csvField).join(',');
    }).join('\r\n');
  }

  // ---------------------------------------------------------------------------
  // buildReportData — collect rendered values from the live DOM
  // ---------------------------------------------------------------------------

  /**
   * Collects the currently rendered housing-needs assessment values from
   * the DOM and returns a plain object suitable for CSV or JSON export.
   *
   * @returns {object} reportData
   */
  function buildReportData() {
    var geoLabel   = _elText('geoContextPill');
    var geoTypeEl  = document.getElementById('geoType');
    var geoType    = geoTypeEl ? geoTypeEl.value : '';
    var geoSelectEl = document.getElementById('geoSelect');
    var geoid      = geoSelectEl ? geoSelectEl.value : '';

    return {
      exportedAt:    new Date().toISOString(),
      geography: {
        label:   geoLabel,
        type:    geoType,
        geoid:   geoid,
      },
      snapshot: {
        population:        _elText('statPop'),
        medianHouseholdIncome: _elText('statMhi'),
        medianHomeValue:   _elText('statHomeValue'),
        medianGrossRent:   _elText('statRent'),
        ownerRenterTenure: _elText('statTenure'),
        rentBurden30Plus:  _elText('statRentBurden'),
        incomeNeededToBuy: _elText('statIncomeNeed'),
        meanCommute:       _elText('statCommute'),
      },
      housingStock: {
        baselineUnits:    _elText('statBaseUnits'),
        targetVacancyRate: _elText('statTargetVac'),
        unitsNeeded:      _elText('statUnitsNeed'),
        netMigration:     _elText('statNetMig'),
      },
      lihtc: {
        projectCount: _elText('statLihtcCount'),
        totalUnits:   _elText('statLihtcUnits'),
        qctTracts:    _elText('statQctCount'),
        ddaStatus:    _elText('statDdaStatus'),
      },
      narrative: _elText('execNarrative'),
    };
  }

  // ---------------------------------------------------------------------------
  // exportPdf — screenshot-based PDF via html2canvas + jsPDF
  // ---------------------------------------------------------------------------

  /**
   * Exports the current HNA report view as a multi-page PDF.
   * Falls back to window.print() if the required libraries are unavailable.
   *
   * @param {string} [filename] - Output filename (default: housing-needs-assessment.pdf)
   * @returns {Promise<void>}
   */
  async function exportPdf(filename) {
    var outFile = filename || 'housing-needs-assessment.pdf';
    try {
      if (!window.html2canvas || !window.jspdf) {
        window.print();
        return;
      }
      var jsPDF = window.jspdf.jsPDF;
      var node  = document.querySelector('main');
      var bg    = getComputedStyle(document.documentElement)
                    .getPropertyValue('--bg').trim() || '#ffffff';

      var canvas  = await window.html2canvas(node, { scale: 2, useCORS: true, backgroundColor: bg });
      var imgData = canvas.toDataURL('image/png');
      var pdf     = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });

      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      var imgW  = pageW;
      var imgH  = canvas.height * (pageW / canvas.width);

      // First page
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);

      // Additional pages for tall content
      var remaining = imgH - pageH;
      var offset    = 0;
      while (remaining > 0) {
        pdf.addPage();
        offset    += pageH;
        pdf.addImage(imgData, 'PNG', 0, -offset, imgW, imgH);
        remaining -= pageH;
      }

      pdf.save(outFile);
      _showExportToast('PDF downloaded \u2713');
    } catch (e) {
      console.warn('[HNA] PDF export failed; falling back to print()', e);
      window.print();
    }
  }

  // ---------------------------------------------------------------------------
  // exportCsv — flat CSV of headline housing metrics
  // ---------------------------------------------------------------------------

  /**
   * Exports key housing metrics for the current geography as a CSV file.
   *
   * @param {object} [reportData] - Pre-built report object (from buildReportData).
   *   If omitted the function calls buildReportData() automatically.
   * @param {string} [filename]   - Output filename (default: housing-needs-assessment.csv)
   */
  function exportCsv(reportData, filename) {
    var d       = reportData || buildReportData();
    var outFile = filename   || 'housing-needs-assessment.csv';

    var rows = [
      // Header row
      ['Field', 'Value'],
      // Geography
      ['Geography',              d.geography.label],
      ['Geography Type',         d.geography.type],
      ['GEOID',                  d.geography.geoid],
      // Snapshot
      ['Population',                    d.snapshot.population],
      ['Median Household Income',       d.snapshot.medianHouseholdIncome],
      ['Median Home Value',             d.snapshot.medianHomeValue],
      ['Median Gross Rent',             d.snapshot.medianGrossRent],
      ['Owner / Renter Tenure',         d.snapshot.ownerRenterTenure],
      ['Rent Burden (≥30% of income)', d.snapshot.rentBurden30Plus],
      ['Income Needed to Buy Median Home', d.snapshot.incomeNeededToBuy],
      ['Mean Commute Time',             d.snapshot.meanCommute],
      // Housing stock / projections
      ['Baseline Housing Units',        d.housingStock.baselineUnits],
      ['Target Vacancy Rate',           d.housingStock.targetVacancyRate],
      ['Estimated Units Needed (20-year)', d.housingStock.unitsNeeded],
      ['Net Migration (20-year)',          d.housingStock.netMigration],
      // LIHTC
      ['LIHTC Projects in County',      d.lihtc.projectCount],
      ['LIHTC Total Units',             d.lihtc.totalUnits],
      ['Qualified Census Tracts',       d.lihtc.qctTracts],
      ['DDA Status',                    d.lihtc.ddaStatus],
      // Meta
      ['Exported At',                   d.exportedAt],
    ];

    var csv  = _toCsv(rows);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    _triggerDownload(blob, outFile);
    _showExportToast('CSV downloaded \u2713');
  }

  // ---------------------------------------------------------------------------
  // exportJson — structured JSON snapshot
  // ---------------------------------------------------------------------------

  /**
   * Exports the full structured report snapshot as a JSON file.
   *
   * @param {object} [reportData] - Pre-built report object (from buildReportData).
   *   If omitted the function calls buildReportData() automatically.
   * @param {string} [filename]   - Output filename (default: housing-needs-assessment.json)
   */
  function exportJson(reportData, filename) {
    var d       = reportData || buildReportData();
    var outFile = filename   || 'housing-needs-assessment.json';

    var blob = new Blob(
      [JSON.stringify(d, null, 2)],
      { type: 'application/json' }
    );
    _triggerDownload(blob, outFile);
    _showExportToast('JSON downloaded \u2713');
  }

  // ---------------------------------------------------------------------------
  // Expose on window for housing-needs-assessment.js and for testability
  // ---------------------------------------------------------------------------

  window.__HNA_buildReportData = buildReportData;
  window.__HNA_exportPdf       = exportPdf;
  window.__HNA_exportCsv       = exportCsv;
  window.__HNA_exportJson      = exportJson;

})();
