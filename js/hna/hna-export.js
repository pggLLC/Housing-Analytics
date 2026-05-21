/*
  hna-export.js — Export utilities for Housing Needs Assessment reports.

  Provides three export modes:
    * PDF  — multi-page screenshot via html2canvas + jsPDF (with print() fallback)
    * CSV  — key housing metrics for the current geography as a comma-separated file
    * JSON — structured report snapshot for archiving or downstream processing

  All public entry points are exposed on the window object so they can be
  called from housing-needs-assessment.js and tested in Node.js static checks:

    window.__HNA_exportPdf(filename?)
    window.__HNA_exportCsv(reportData, filename?)
    window.__HNA_exportJson(reportData, filename?)
    window.__HNA_buildReportData()    <- reads rendered DOM values

  A convenience facade is also available as window.HNAExport.
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
   * Show a brief toast and announce to the #hnaLiveRegion (Recommendation 5.1).
   * Auto-dismisses after 4 seconds.
   *
   * @param {string} message - Human-readable confirmation, e.g. "PDF downloaded ✓"
   * @param {'success'|'info'|'warn'} [type='success'] - Toast colour variant
   */
  function _showExportToast(message, type) {
    var bgMap = {
      success: 'var(--good,#047857)',
      info:    'var(--accent,#2563eb)',
      warn:    'var(--warning,#d97706)'
    };
    var bg = bgMap[type] || bgMap.success;

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
      'background:' + bg, 'color:#fff',
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
   * Pull a ranking-index entry for the currently-selected geography by
   * matching geoid against window.HNARanking._get().allEntries. Returns
   * null if the ranking module isn't loaded yet — HNA single-jurisdiction
   * page doesn't load it; Compare does.
   */
  function _rankingEntry(geoid) {
    try {
      var st = window.HNARanking && window.HNARanking._get
             ? window.HNARanking._get() : null;
      if (!st || !st.allEntries) return null;
      for (var i = 0; i < st.allEntries.length; i++) {
        if (st.allEntries[i].geoid === geoid) return st.allEntries[i];
      }
    } catch (_) {}
    return null;
  }

  /**
   * Fallback metrics builder for the HNA single-jurisdiction page where
   * HNARanking isn't loaded. Reads from window.HNAState (the loaded
   * profile + chasData) and computes the same analytics-grade fields
   * the ranking-index would expose.
   */
  function _metricsFromHnaState(geoid) {
    try {
      var st = window.HNAState && window.HNAState.state;
      if (!st) return null;
      var prof = st.lastProfile || {};
      var chas = st.chasData || {};
      var contextCounty = st.contextCounty || (geoid && geoid.length === 5 ? geoid : null);
      var county = (chas.counties || chas)[contextCounty] || null;
      var rba = (county && county.renter_hh_by_ami) || null;
      var ownerSum = (county && county.summary) || {};

      // Helper: tier % from CHAS — use canonical cost_burdened_30pct
      function tierPct(td) {
        if (!td) return null;
        var total = +td.total, burdened = +(td.cost_burdened_30pct != null ? td.cost_burdened_30pct : td.cost_burdened);
        if (!total || !Number.isFinite(total) || total <= 0) return null;
        return +((burdened / total) * 100).toFixed(1);
      }

      // Vacancy from DP04_0005E (the actual percentage per ACS spec — fix landed in #857)
      var vacancyRate = null;
      var vacRaw = prof.DP04_0005E;
      var pctRenter = +prof.DP04_0047PE || 0;
      var totalUnits = +prof.DP04_0001E || 0;
      var rentalUnits = (totalUnits && pctRenter) ? Math.round(totalUnits * pctRenter / 100) : 0;
      if (vacRaw != null && rentalUnits >= 50) vacancyRate = Math.min(50, Math.max(0, +vacRaw));

      // Structure composition (5+ MF, 1-unit detached, 2-4 small MF)
      var sfDet = +prof.DP04_0007E || 0;
      var sfAtt = +prof.DP04_0008E || 0;
      var u2 = +prof.DP04_0009E || 0, u3to4 = +prof.DP04_0010E || 0;
      var u5to9 = +prof.DP04_0011E || 0, u10to19 = +prof.DP04_0012E || 0, u20plus = +prof.DP04_0013E || 0;
      var mobile = +prof.DP04_0014E || 0;
      var structTotal = sfDet + sfAtt + u2 + u3to4 + u5to9 + u10to19 + u20plus + mobile;
      var pctMf = structTotal > 0 ? +((u5to9 + u10to19 + u20plus) / structTotal * 100).toFixed(1) : null;
      var pctSf = structTotal > 0 ? +(sfDet / structTotal * 100).toFixed(1) : null;
      var pct24 = structTotal > 0 ? +((u2 + u3to4) / structTotal * 100).toFixed(1) : null;

      // Owner sum from CHAS summary. County CHAS uses `pct_owner_cb30`
      // (decimal); place CHAS uses `owner_cb30_share`. Check both.
      var ownerRaw = ownerSum.pct_owner_cb30 != null
        ? ownerSum.pct_owner_cb30
        : ownerSum.owner_cb30_share;
      var ownerBurden = (ownerRaw != null && Number.isFinite(+ownerRaw))
        ? +((+ownerRaw) * 100).toFixed(1)
        : null;

      return {
        population:           +prof.DP05_0001E || null,
        median_hh_income:     +prof.DP03_0062E || null,
        gross_rent_median:    +prof.DP04_0134E || null,
        pct_renters:          pctRenter || null,
        vacancy_rate:         vacancyRate,
        pct_multifamily:      pctMf,
        pct_sf_detached:      pctSf,
        pct_2to4_units:       pct24,
        pct_burdened_lte30:   rba ? tierPct(rba.lte30) : null,
        pct_burdened_31to50:  rba ? tierPct(rba['31to50']) : null,
        pct_burdened_51to80:  rba ? tierPct(rba['51to80']) : null,
        pct_burdened_81to100: rba ? tierPct(rba['81to100']) : null,
        pct_burdened_100plus: rba ? tierPct(rba['100plus']) : null,
        pct_owner_burdened_30plus: ownerBurden,
        _chas_source: county ? 'county' : 'none',
      };
    } catch (_) { return null; }
  }

  /**
   * Collects the currently rendered housing-needs assessment values from
   * the DOM AND from the loaded ranking-index entry for the selected
   * geography. The DOM values give exact visual fidelity (formatted
   * strings); the ranking-index values give analytics-grade numerics
   * with explicit data-provenance flags.
   *
   * @returns {object} reportData
   */
  function buildReportData() {
    var geoLabel   = _elText('geoContextPill');
    var geoTypeEl  = document.getElementById('geoType');
    var geoType    = geoTypeEl ? geoTypeEl.value : '';
    var geoSelectEl = document.getElementById('geoSelect');
    var geoid      = geoSelectEl ? geoSelectEl.value : '';

    // Pull the analytics-grade numeric record. Compare page provides
    // HNARanking — use its ranking-index entry. HNA single-jurisdiction
    // page doesn't load that module — fall back to a synthesis from
    // HNAState (the loaded ACS profile + CHAS county aggregate). Both
    // paths produce the same metrics shape so the export rows below
    // work uniformly.
    var idxRec = _rankingEntry(geoid);
    var m = (idxRec && idxRec.metrics) || _metricsFromHnaState(geoid) || {};

    return {
      exportedAt:    new Date().toISOString(),
      generatedBy:   'COHO Analytics HNA Export',
      disclaimer:    'Screening tool only. Public-data screening output, not a substitute for a CHFA-required market study, professional underwriting, or independent investor analysis. See docs/METHODOLOGY-GAPS-2026-05-21.md for known limitations.',
      vintages: {
        acs:          'ACS 5-Year 2019-2023',
        chas:         'HUD CHAS 2018-2022',
        lehd:         'LEHD WAC 2021',
        dola:         'DOLA SYA 2024',
        fmr:          'HUD FMR FY2025',
        rankingIndex: idxRec && idxRec._metadata && idxRec._metadata.builtAt || null,
      },
      geography: {
        label:   geoLabel,
        type:    geoType,
        geoid:   geoid,
        containingCounty: idxRec ? idxRec.containingCounty : null,
        region:           idxRec ? idxRec.region : null,
      },
      snapshot: {
        population:            _elText('statPop'),
        medianHouseholdIncome: _elText('statMhi'),
        medianHomeValue:       _elText('statHomeValue'),
        medianGrossRent:       _elText('statRent'),
        ownerRenterTenure:     _elText('statTenure'),
        rentBurden30Plus:      _elText('statRentBurden'),
        incomeNeededToBuy:     _elText('statIncomeNeed'),
        meanCommute:           _elText('statCommute'),
        // Analytics-grade numerics from ranking-index
        populationNumeric:        m.population || null,
        medianHhIncomeNumeric:    m.median_hh_income || null,
        grossRentMedianNumeric:   m.gross_rent_median || null,
        pctRenters:               m.pct_renters || null,
        pctCostBurdenedRenters:   m.pct_cost_burdened || null,
      },
      housingStock: {
        baselineUnits:       _elText('statBaseUnits'),
        targetVacancyRate:   _elText('statTargetVac'),
        unitsNeeded:         _elText('statUnitsNeed'),
        netMigration:        _elText('statNetMig'),
        // Structure-type composition (% of structures) + vacancy
        rentalVacancyRate:   m.vacancy_rate,
        pctMultifamily:      m.pct_multifamily || null,
        pctSfDetached:       m.pct_sf_detached || null,
        pct2to4Units:        m.pct_2to4_units || null,
        population20yr:      m.population_projection_20yr || null,
      },
      chasCostBurden: {
        source:         m._chas_source || 'unavailable',  // 'place' | 'county' | 'none'
        renterPctBurdened: {
          lte30:    m.pct_burdened_lte30 || null,
          tier31to50: m.pct_burdened_31to50 || null,
          tier51to80: m.pct_burdened_51to80 || null,
          tier81to100: m.pct_burdened_81to100 || null,
          tier100plus: m.pct_burdened_100plus || null,
        },
        ownerPctBurdened30Plus: m.pct_owner_burdened_30plus || null,
        note: 'CHAS publishes HUD-defined cost-burden rates (≥30% of income on housing) by AMI tier. Place-level values are TIGER-apportioned from tract-level CHAS when available; otherwise the containing-county rates are used as a fallback.',
      },
      amiGap: {
        housingGapUnits:    m.housing_gap_units || null,
        gap30pctUnits:      m.ami_gap_30pct || null,
        gap50pctUnits:      m.ami_gap_50pct || null,
        gap60pctUnits:      m.ami_gap_60pct || null,
        missingAmiTiers:    m.missing_ami_tiers || [],
        source:             m._ami_gap_source || 'unavailable',
      },
      employment: {
        inCommuters:        m.in_commuters || null,
        commuteRatioPct:    m.commute_ratio || null,
        source:             m._lehd_source || 'unavailable',  // 'place' | 'county_direct' | 'county_proportional' | 'none'
      },
      lihtc: {
        projectCount: _elText('statLihtcCount'),
        totalUnits:   _elText('statLihtcUnits'),
        qctTracts:    _elText('statQctCount'),
        ddaStatus:    _elText('statDdaStatus'),
      },
      dataQuality: idxRec ? {
        approximatedFields:  (idxRec.dataQuality && idxRec.dataQuality.approximated_fields) || [],
        approximationBasis:  (idxRec.dataQuality && idxRec.dataQuality.approximation_basis) || null,
        hasIncompleteData:   idxRec.hasIncompleteData || false,
        nullCriticalMetrics: idxRec.nullCriticalMetrics || 0,
      } : null,
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
    var pdfBtn  = document.getElementById('btnPdf');
    try {
      if (pdfBtn) { pdfBtn.disabled = true; }
      if (!window.html2canvas || !window.jspdf) {
        window.print();
        return;
      }

      _showExportToast('Generating PDF\u2026', 'info');

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
      _showExportToast('PDF generation failed \u2014 using print fallback', 'warn');
      window.print();
    } finally {
      if (pdfBtn) { pdfBtn.disabled = false; }
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

    var chas = d.chasCostBurden || {};
    var burden = chas.renterPctBurdened || {};
    var gap = d.amiGap || {};
    var emp = d.employment || {};
    var dq = d.dataQuality || {};
    var v = d.vintages || {};
    var fmtPct = function (n) { return (n == null) ? '' : (+n).toFixed(1) + '%'; };
    var fmtNum = function (n) { return (n == null) ? '' : (+n).toLocaleString('en-US'); };

    var rows = [
      // \u2500\u2500 Header & meta \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['Field', 'Value'],
      ['Report Type',                   'Housing Needs Assessment'],
      ['Generated By',                  d.generatedBy || ''],
      ['Exported At',                   d.exportedAt || ''],
      ['Disclaimer',                    d.disclaimer || ''],
      ['', ''],

      // \u2500\u2500 Geography \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Geography'],
      ['Geography Name',                d.geography.label],
      ['Geography Type',                d.geography.type],
      ['GEOID',                         d.geography.geoid],
      ['Containing County',             d.geography.containingCounty || ''],
      ['Region',                        d.geography.region || ''],
      ['', ''],

      // \u2500\u2500 Data vintages \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Data Vintages'],
      ['ACS',                           v.acs || ''],
      ['HUD CHAS',                      v.chas || ''],
      ['LEHD WAC',                      v.lehd || ''],
      ['DOLA Population/Households',    v.dola || ''],
      ['HUD FMR',                       v.fmr || ''],
      ['', ''],

      // \u2500\u2500 Executive Snapshot (visible page values) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Executive Snapshot'],
      ['Population (displayed)',                 d.snapshot.population],
      ['Median Household Income (displayed)',    d.snapshot.medianHouseholdIncome],
      ['Median Home Value (displayed)',          d.snapshot.medianHomeValue],
      ['Median Gross Rent (displayed)',          d.snapshot.medianGrossRent],
      ['Owner / Renter Tenure',                  d.snapshot.ownerRenterTenure],
      ['Rent Burden \u226530% of income',             d.snapshot.rentBurden30Plus],
      ['Income Needed to Buy Median Home',       d.snapshot.incomeNeededToBuy],
      ['Mean Commute Time',                      d.snapshot.meanCommute],
      ['', ''],

      // \u2500\u2500 Analytics-grade numerics from ranking-index \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Numeric Metrics (ranking-index)'],
      ['Population',                             fmtNum(d.snapshot.populationNumeric)],
      ['Median HH Income ($)',                   fmtNum(d.snapshot.medianHhIncomeNumeric)],
      ['Median Gross Rent ($)',                  fmtNum(d.snapshot.grossRentMedianNumeric)],
      ['% Renter-Occupied',                      fmtPct(d.snapshot.pctRenters)],
      ['% Renters Cost-Burdened (ACS GRAPI \u226530%)', fmtPct(d.snapshot.pctCostBurdenedRenters)],
      ['', ''],

      // \u2500\u2500 Housing stock composition \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Housing Stock'],
      ['Baseline Housing Units',                 d.housingStock.baselineUnits],
      ['Target Vacancy Rate',                    d.housingStock.targetVacancyRate],
      ['Rental Vacancy Rate (ACS DP04_0005E)',
        (d.housingStock.rentalVacancyRate == null ? '\u2014 (small-N suppressed)' : fmtPct(d.housingStock.rentalVacancyRate))],
      ['% Multifamily (5+ unit structures)',     fmtPct(d.housingStock.pctMultifamily)],
      ['% Single-Family Detached',               fmtPct(d.housingStock.pctSfDetached)],
      ['% 2-4 Unit Structures',                  fmtPct(d.housingStock.pct2to4Units)],
      ['Estimated Units Needed (20-year)',       d.housingStock.unitsNeeded],
      ['Net Migration (20-year)',                d.housingStock.netMigration],
      ['Projected Population (20-year)',         fmtNum(d.housingStock.population20yr)],
      ['', ''],

      // \u2500\u2500 HUD CHAS Cost Burden (all 5 AMI tiers) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'HUD CHAS Cost Burden'],
      ['CHAS Data Source',                       chas.source || ''],
      ['Renter Cost-Burdened: \u226430% AMI',         fmtPct(burden.lte30)],
      ['Renter Cost-Burdened: 31-50% AMI',       fmtPct(burden.tier31to50)],
      ['Renter Cost-Burdened: 51-80% AMI',       fmtPct(burden.tier51to80)],
      ['Renter Cost-Burdened: 81-100% AMI',      fmtPct(burden.tier81to100)],
      ['Renter Cost-Burdened: >100% AMI',        fmtPct(burden.tier100plus)],
      ['Owner Cost-Burdened (\u226530% of income)',   fmtPct(chas.ownerPctBurdened30Plus)],
      ['CHAS Note',                              chas.note || ''],
      ['', ''],

      // \u2500\u2500 AMI Gap Analysis \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'AMI Gap Analysis'],
      ['Total Housing Gap (units)',              fmtNum(gap.housingGapUnits)],
      ['Unit Gap \u226430% AMI',                      fmtNum(gap.gap30pctUnits)],
      ['Unit Gap \u226450% AMI',                      fmtNum(gap.gap50pctUnits)],
      ['Unit Gap \u226460% AMI',                      fmtNum(gap.gap60pctUnits)],
      ['Missing AMI Tiers',                      (gap.missingAmiTiers || []).join(', ')],
      ['AMI Gap Source',                         gap.source || ''],
      ['', ''],

      // \u2500\u2500 LEHD Employment + Commuting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'LEHD Employment'],
      ['In-Commuters',                           fmtNum(emp.inCommuters)],
      ['Commute Ratio (inflow / total)',         fmtPct(emp.commuteRatioPct)],
      ['LEHD Source',                            emp.source || ''],
      ['', ''],

      // \u2500\u2500 LIHTC \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'LIHTC'],
      ['LIHTC Projects in County',               d.lihtc.projectCount],
      ['LIHTC Total Units',                      d.lihtc.totalUnits],
      ['Qualified Census Tracts',                d.lihtc.qctTracts],
      ['DDA Status',                             d.lihtc.ddaStatus],
      ['', ''],

      // \u2500\u2500 Data Quality flags \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      ['SECTION', 'Data Quality'],
      ['Approximated Fields',                    (dq.approximatedFields || []).join(', ')],
      ['Approximation Basis',                    dq.approximationBasis || ''],
      ['Has Incomplete Data',                    String(dq.hasIncompleteData)],
      ['Null Critical Metrics (count)',          String(dq.nullCriticalMetrics)],
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

  // ---------------------------------------------------------------------------
  // HNAExport facade — convenience wrapper used by UI event handlers
  // ---------------------------------------------------------------------------

  window.HNAExport = {
    exportPdf: function (filename) {
      return exportPdf(filename);
    },
    exportCsv: function (reportData, filename) {
      return exportCsv(reportData, filename);
    },
    exportJson: function (reportData, filename) {
      return exportJson(reportData, filename);
    },
    buildReportData: function () {
      return buildReportData();
    },
  };

})();
