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
      if (st && st.allEntries) {
        for (var i = 0; i < st.allEntries.length; i++) {
          if (st.allEntries[i].geoid === geoid) return st.allEntries[i];
        }
      }
      /* F210 — direct ranking-index cache fallback. The HNA single-
         jurisdiction page doesn't load the hna-ranking-index module
         (Compare does), so the original code dropped to a CHAS-only
         synthesis (_metricsFromHnaState) that lacks AMI-gap + LEHD
         fields. We pre-fetch ranking-index.json at module init and
         consult it here, so the PDF's AMI gap & employment sections
         populate even on the HNA page. */
      if (_rankingIndexCache) {
        return _rankingIndexCache[geoid] || null;
      }
    } catch (_) {}
    return null;
  }

  /* F210 — Ranking-index cache (HNA page fallback for AMI gap + LEHD).
     Kicked off at module init; resolves to a geoid→entry map. The
     pre-load happens once; subsequent calls reuse the cached map. */
  var _rankingIndexCache = null;
  var _rankingIndexPromise = null;
  function _loadRankingIndex() {
    if (_rankingIndexCache) return Promise.resolve(_rankingIndexCache);
    if (_rankingIndexPromise) return _rankingIndexPromise;
    _rankingIndexPromise = fetch('data/hna/ranking-index.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) { _rankingIndexCache = null; return null; }
        // Build a geoid-indexed map for O(1) lookup. The source JSON
        // exposes either rankings[] (array of entries) or a flat
        // map keyed by geoid; handle both shapes.
        var rows = Array.isArray(j.rankings) ? j.rankings
                  : (j.rankings && typeof j.rankings === 'object' ? Object.values(j.rankings) : []);
        var map = Object.create(null);
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (r && r.geoid) map[r.geoid] = r;
        }
        _rankingIndexCache = map;
        return map;
      })
      .catch(function () { _rankingIndexCache = null; return null; });
    return _rankingIndexPromise;
  }
  // Start the fetch eagerly so it's likely cached by the time the
  // user clicks Export. exportStructuredPdf() also awaits it for
  // safety.
  try { _loadRankingIndex(); } catch (_) { /* non-fatal */ }

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
        acs:          'ACS 5-Year 2020-2024',
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

      /* F167 \u2014 PDF distortion fix. Three changes that together stop the
         charts-look-blurry-or-smeared symptom that users have flagged:

         (1) Bump html2canvas scale from 2 \u2192 3. The previous scale=2 was
             halving Chart.js's already-rendered canvas resolution when
             projected onto the letter page, which is why bars and axis
             labels came out fuzzy / jagged.

         (2) Force every Chart.js instance to re-render at the html2canvas
             pixel ratio BEFORE capture. Chart.js draws at the device pixel
             ratio at construction time; if the screen's devicePixelRatio
             was 1 (most external monitors), the charts were captured at 1\u00d7
             and then up-sampled by html2canvas \u2014 that's the actual source
             of the smear. We bump devicePixelRatio inside each chart's
             options + call .resize() so they redraw at 3\u00d7 before the
             screenshot fires.

         (3) Freeze animations during capture (animation:false) so charts
             aren't mid-tween when html2canvas reads pixels. */
      var charts = (window.Chart && Chart.instances)
        ? Object.values(Chart.instances).filter(Boolean) : [];
      var TARGET_DPR = 3;
      var savedAnim = [];
      charts.forEach(function (c) {
        try {
          savedAnim.push({
            chart: c,
            anim: c.options.animation,
            dpr:  c.options.devicePixelRatio,
          });
          c.options.animation = false;
          c.options.devicePixelRatio = TARGET_DPR;
          c.resize();
          c.update('none');
        } catch (_) {}
      });
      // Give the browser one paint cycle to commit the re-render before
      // html2canvas reads the canvases.
      await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 50); }); });

      var canvas;
      try {
        canvas = await window.html2canvas(node, {
          scale: TARGET_DPR,
          useCORS: true,
          backgroundColor: bg,
          /* logging: false silences the noisy "Failed to load resource"
             warnings html2canvas emits on every cross-origin tile request
             from the Leaflet basemap; the basemap is correctly
             foreground-blanked by the {backgroundColor: bg} setting so
             those warnings are cosmetic. */
          logging: false,
        });
      } finally {
        // Restore previous animation + dpr so the on-screen charts don't
        // permanently lock at 3\u00d7 DPR (would burn battery on mobile).
        savedAnim.forEach(function (s) {
          try {
            s.chart.options.animation = s.anim;
            s.chart.options.devicePixelRatio = s.dpr;
            s.chart.resize();
          } catch (_) {}
        });
      }

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

  /* ─────────────────────────────────────────────────────────────────
     F173 — exportStructuredPdf — narrative-style PDF builder.

     Replaces the html2canvas full-page screenshot approach with a
     structured jsPDF document modeled on the New Castle deliverable
     (8 sections, headline stat cards, embedded chart images, narrative
     paragraphs, methodology footer). Works for any selected geography
     by pulling values from buildReportData() + the live Chart.js
     canvases. The old screenshot-based exportPdf remains as an
     emergency fallback when jsPDF isn't available.

     Layout strategy:
       - US Letter portrait, 0.6" margins
       - Section header (12pt bold accent) + subhead/narrative (10pt)
       - Stat grid: 3 columns × N rows of label+value cards
       - Chart image: live Chart.js canvas at 3× DPR, scaled to content width
       - Methodology table at the end with vintage + source
     ───────────────────────────────────────────────────────────────── */
  async function exportStructuredPdf(filename) {
    const outFile = filename || 'housing-needs-assessment.pdf';
    const pdfBtn  = document.getElementById('btnPdf');
    if (!window.jspdf) {
      // No jsPDF available — fall back to screenshot path
      return exportPdf(filename);
    }
    try {
      if (pdfBtn) pdfBtn.disabled = true;
      _showExportToast('Generating PDF…', 'info');

      // F210 — ensure the ranking-index cache is warm before buildReportData
      // pulls from it. Without this, the HNA single-jurisdiction page
      // falls through to _metricsFromHnaState which omits AMI-gap and
      // LEHD fields, so sections 6 + 7 of the PDF render as
      // "source unavailable" even though the data exists in
      // data/hna/ranking-index.json.
      try { await _loadRankingIndex(); } catch (_) { /* non-fatal — proceed with whatever we have */ }

      const jsPDF = window.jspdf.jsPDF;
      const data  = buildReportData();
      const pdf   = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });

      // Page geometry in points (1in = 72pt). 0.6" margins → 532pt content width.
      const PAGE_W  = pdf.internal.pageSize.getWidth();   // 612
      const PAGE_H  = pdf.internal.pageSize.getHeight();  // 792
      const MARGIN  = 43;
      const CONTENT_W = PAGE_W - (2 * MARGIN);
      // Theme palette (mirrors site's --accent + supporting tones).
      const COLOR_ACCENT = [3, 102, 214];
      const COLOR_INK    = [40, 40, 40];
      const COLOR_MUTED  = [110, 110, 110];
      const COLOR_RULE   = [200, 200, 220];
      const COLOR_CARD   = [244, 247, 251];

      // Cursor state. After every section we advance `y`; addPage when needed.
      let y = MARGIN;

      function newPageIfNeeded(spaceNeeded) {
        if (y + spaceNeeded > PAGE_H - MARGIN) {
          pdf.addPage();
          y = MARGIN;
          return true;
        }
        return false;
      }

      function drawSectionHeader(title, subtitle) {
        newPageIfNeeded(56);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor.apply(pdf, COLOR_ACCENT);
        pdf.text(title, MARGIN, y);
        y += 8;
        // Thin accent rule under header
        pdf.setDrawColor.apply(pdf, COLOR_ACCENT);
        pdf.setLineWidth(1.5);
        pdf.line(MARGIN, y, MARGIN + 36, y);
        y += 14;
        if (subtitle) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9.5);
          pdf.setTextColor.apply(pdf, COLOR_MUTED);
          const wrapped = pdf.splitTextToSize(subtitle, CONTENT_W);
          pdf.text(wrapped, MARGIN, y);
          y += (wrapped.length * 12) + 6;
        }
      }

      function drawNarrative(text) {
        if (!text) return;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        pdf.setTextColor.apply(pdf, COLOR_INK);
        const wrapped = pdf.splitTextToSize(text, CONTENT_W);
        newPageIfNeeded((wrapped.length * 12) + 6);
        pdf.text(wrapped, MARGIN, y);
        y += (wrapped.length * 12) + 8;
      }

      function drawStatGrid(stats) {
        // 3-column grid. Each cell: label (small caps, muted) + value (bold).
        const cells = stats.filter(s => s && s.value != null && s.value !== '' && s.value !== '—');
        if (!cells.length) {
          drawNarrative('(Data not available for this geography.)');
          return;
        }
        const COLS = 3;
        const GAP_X = 10;
        const GAP_Y = 8;
        const CELL_W = (CONTENT_W - (COLS - 1) * GAP_X) / COLS;
        const CELL_H = 50;
        for (let i = 0; i < cells.length; i++) {
          const col = i % COLS;
          if (col === 0) {
            newPageIfNeeded(CELL_H + GAP_Y);
          }
          const x = MARGIN + col * (CELL_W + GAP_X);
          // Card background
          pdf.setFillColor.apply(pdf, COLOR_CARD);
          pdf.roundedRect(x, y, CELL_W, CELL_H, 4, 4, 'F');
          // Label
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor.apply(pdf, COLOR_MUTED);
          const labelLines = pdf.splitTextToSize(cells[i].label, CELL_W - 14);
          pdf.text(labelLines, x + 7, y + 13);
          // Value
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(13);
          pdf.setTextColor.apply(pdf, COLOR_INK);
          const valLines = pdf.splitTextToSize(String(cells[i].value), CELL_W - 14);
          pdf.text(valLines, x + 7, y + 33);
          // Sub-note
          if (cells[i].sub) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(7.5);
            pdf.setTextColor.apply(pdf, COLOR_MUTED);
            const subLines = pdf.splitTextToSize(cells[i].sub, CELL_W - 14);
            pdf.text(subLines, x + 7, y + 45);
          }
          // Advance row after the last column or last cell
          if (col === COLS - 1 || i === cells.length - 1) {
            y += CELL_H + GAP_Y;
          }
        }
      }

      function drawChart(canvasId, caption, maxHeightPt) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.toDataURL) return;
        try {
          // Force the chart to render at 3× DPR (F167 quality fix) before grab
          const chartInst = (window.Chart && Chart.getChart) ? Chart.getChart(canvas) : null;
          let savedDpr = null, savedAnim = null;
          if (chartInst) {
            savedDpr = chartInst.options.devicePixelRatio;
            savedAnim = chartInst.options.animation;
            chartInst.options.devicePixelRatio = 3;
            chartInst.options.animation = false;
            chartInst.resize();
            chartInst.update('none');
          }
          const dataUrl = canvas.toDataURL('image/png');
          if (chartInst) {
            chartInst.options.devicePixelRatio = savedDpr;
            chartInst.options.animation = savedAnim;
            chartInst.resize();
          }
          const aspect = canvas.height / canvas.width;
          const imgW = CONTENT_W;
          let imgH = imgW * aspect;
          if (imgH > (maxHeightPt || 220)) imgH = maxHeightPt || 220;
          newPageIfNeeded(imgH + 24);
          pdf.addImage(dataUrl, 'PNG', MARGIN, y, imgW, imgH, undefined, 'FAST');
          y += imgH + 4;
          if (caption) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(8);
            pdf.setTextColor.apply(pdf, COLOR_MUTED);
            const wrapped = pdf.splitTextToSize(caption, CONTENT_W);
            pdf.text(wrapped, MARGIN, y);
            y += (wrapped.length * 10) + 8;
          }
        } catch (e) { console.warn('[exportPdf] chart capture failed for', canvasId, e); }
      }

      function drawTableSimple(rows) {
        // Simple 2-col table: label | value
        const ROW_H = 18;
        const COL1_W = CONTENT_W * 0.55;
        for (const row of rows) {
          if (!row || row.value == null || row.value === '—') continue;
          newPageIfNeeded(ROW_H);
          // Row rule
          pdf.setDrawColor.apply(pdf, COLOR_RULE);
          pdf.setLineWidth(0.4);
          pdf.line(MARGIN, y + ROW_H, MARGIN + CONTENT_W, y + ROW_H);
          // Label
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(9.5);
          pdf.setTextColor.apply(pdf, COLOR_INK);
          pdf.text(row.label, MARGIN, y + 12);
          // Value
          pdf.setFont('helvetica', 'bold');
          pdf.text(String(row.value), MARGIN + COL1_W, y + 12);
          y += ROW_H;
        }
        y += 6;
      }

      function drawPageFooter() {
        const pageCount = pdf.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
          pdf.setPage(i);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor.apply(pdf, COLOR_MUTED);
          pdf.text(
            'Housing Needs Assessment · ' + (data.geography.label || '—') +
            ' · Generated ' + new Date().toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}),
            MARGIN, PAGE_H - 24
          );
          pdf.text('Page ' + i + ' of ' + pageCount, PAGE_W - MARGIN, PAGE_H - 24, {align: 'right'});
        }
      }

      // ── Cover ──
      pdf.setFillColor.apply(pdf, COLOR_ACCENT);
      pdf.rect(0, 0, PAGE_W, 6, 'F');
      y = MARGIN + 16;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.setTextColor.apply(pdf, COLOR_INK);
      pdf.text('Housing Needs Assessment', MARGIN, y);
      y += 30;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(15);
      pdf.setTextColor.apply(pdf, COLOR_ACCENT);
      pdf.text(data.geography.label || '(geography)', MARGIN, y);
      y += 22;
      pdf.setFontSize(10);
      pdf.setTextColor.apply(pdf, COLOR_MUTED);
      const meta = [
        'Geography type: ' + (data.geography.type || '—'),
        'GEOID: ' + (data.geography.geoid || '—') + (data.geography.containingCounty ? ' · Containing county: ' + data.geography.containingCounty : ''),
        'Generated: ' + new Date().toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'}),
        'Vintage: ' + (data.vintages.acs || '—'),
      ];
      for (const m of meta) { pdf.text(m, MARGIN, y); y += 13; }
      y += 14;
      if (data.narrative) {
        drawNarrative(data.narrative);
      }

      // ── 1. Demographic snapshot ──
      drawSectionHeader('1. Demographic snapshot', 'Population, household size, and average earner profile drawn from the ACS 5-year profile.');
      drawStatGrid([
        { label: 'Population',                value: data.snapshot.population,            sub: 'ACS DP05 total' },
        { label: 'Median household income',   value: data.snapshot.medianHouseholdIncome, sub: 'ACS DP03' },
        { label: 'Median home value',         value: data.snapshot.medianHomeValue,       sub: 'Owner-occupied DP04' },
        { label: 'Median gross rent',         value: data.snapshot.medianGrossRent,       sub: 'Renter-occupied DP04' },
        { label: 'Owner / renter mix',        value: data.snapshot.ownerRenterTenure,     sub: 'DP04 tenure' },
        { label: 'Income to buy median home', value: data.snapshot.incomeNeededToBuy,     sub: 'Implied 30% PITI' },
        { label: 'Mean commute',              value: data.snapshot.meanCommute,           sub: 'DP03 commute' },
      ]);

      // ── 2. Household composition + occupation ──
      drawSectionHeader('2. Household composition, occupation & labor force', 'Breakdown of household types, top-line occupation mix, and the retiree-vs-working-age share of residents not in the labor force.');
      drawStatGrid([
        { label: 'Total households',         value: _elText('statTotalHh'),       sub: 'DP02_0001E' },
        { label: 'Family households',        value: _elText('statFamilyHh'),      sub: 'married + related non-spouse' },
        { label: 'Average household size',   value: _elText('statAvgHhSize'),     sub: 'DP02_0016E' },
        { label: 'Average family size',      value: _elText('statAvgFamSize'),    sub: 'DP02_0017E' },
        { label: 'Households with kids',     value: _elText('statHhWithKids'),    sub: 'DP02_0014E' },
        { label: 'Households with seniors',  value: _elText('statHhWithSeniors'), sub: 'DP02_0015E' },
        { label: 'Residents with disability', value: _elText('statDisability'),    sub: 'DP02_0072E' },
      ]);
      drawChart('chartHouseholdSize',  'Household type mix (count of households by structure).', 200);
      drawChart('chartOccupationMix',  'Occupation mix — top-line OCC categories for civilian employed residents 16+.', 200);

      // ── 3. Race / ethnicity ──
      drawSectionHeader('3. Race & ethnicity', 'Population share by single-race "alone" categories and Hispanic/Latino ethnicity (which cross-cuts race in the Census schema).');
      drawStatGrid([
        { label: 'Total population',         value: _elText('statRacePopTotal'),  sub: 'DP05_0033E' },
        { label: 'Hispanic / Latino',        value: _elText('statRaceHispanic'),  sub: 'Any race' },
        { label: 'Not Hispanic, White alone', value: _elText('statRaceNHWhite'),   sub: 'DP05_0082E' },
        { label: 'Black alone',              value: _elText('statRaceBlack'),     sub: 'DP05_0038E' },
        { label: 'Asian alone',              value: _elText('statRaceAsian'),     sub: 'DP05_0047E' },
        { label: 'American Indian / AN',     value: _elText('statRaceAIAN'),      sub: 'DP05_0039E' },
        { label: 'Two or more races',        value: _elText('statRaceTwoOrMore'), sub: 'DP05_0061E' },
      ]);
      drawChart('chartRaceEthnicity', 'Race and ethnicity distribution (people, with cross-cut footnote — see site).', 260);

      // ── 4. Educational attainment ──
      drawSectionHeader('4. Educational attainment', 'Schooling completed for residents 25 and over.');
      drawStatGrid([
        { label: 'Population 25+',           value: _elText('statEduPop25Plus'),     sub: 'DP02_0059E' },
        { label: 'HS graduate or higher',    value: _elText('statEduHsOrHigher'),    sub: 'DP02_0067E' },
        { label: "Bachelor's or higher",     value: _elText('statEduBachOrHigher'),  sub: 'DP02_0068E' },
        { label: 'Graduate / professional',  value: _elText('statEduGradProf'),      sub: 'DP02_0066E' },
      ]);
      drawChart('chartEducation', '7-bucket distribution of highest schooling completed.', 220);

      // ── 5. Housing market + cost burden ──
      drawSectionHeader('5. Housing market & cost burden', 'Stock, vacancy, and the share of renters and owners spending more than 30% of income on housing.');
      drawStatGrid([
        { label: 'Baseline housing units',  value: data.housingStock.baselineUnits || _elText('statBaseUnits'), sub: 'DP04 total' },
        { label: 'Target vacancy rate',     value: data.housingStock.targetVacancyRate || _elText('statTargetVac'), sub: 'Policy target' },
        { label: 'Units needed',            value: data.housingStock.unitsNeeded || _elText('statUnitsNeed'), sub: 'Gap to target' },
        { label: '% multifamily',           value: data.housingStock.pctMultifamily != null ? data.housingStock.pctMultifamily + '%' : null, sub: 'DP04 structure' },
        { label: '% single-family detached', value: data.housingStock.pctSfDetached != null ? data.housingStock.pctSfDetached + '%' : null, sub: 'DP04 structure' },
        { label: 'Renters cost-burdened ≥30%', value: data.snapshot.rentBurden30Plus, sub: 'CHAS or DP04' },
      ]);
      drawChart('chartRentBurdenBins',     'Renters by share of income spent on rent.', 200);
      drawChart('chartOwnerCostBurden',    'Owners by share of income spent on housing.', 200);
      drawChart('chartHomeValue',          'Home value distribution (owner-occupied).', 200);

      // ── 6. Affordability + AMI gap ──
      drawSectionHeader('6. AMI gap & affordability', 'Estimated supply gap by AMI tier — the canonical entry point for sizing affordable-housing demand.');
      drawTableSimple([
        { label: 'Total housing gap (units)', value: data.amiGap.housingGapUnits },
        { label: '30% AMI gap',                value: data.amiGap.gap30pctUnits },
        { label: '50% AMI gap',                value: data.amiGap.gap50pctUnits },
        { label: '60% AMI gap',                value: data.amiGap.gap60pctUnits },
        { label: 'CHAS data source',           value: data.chasCostBurden.source },
        { label: 'AMI gap source',             value: data.amiGap.source },
      ]);

      // ── 7. Employment + commute ──
      drawSectionHeader('7. Employment & commute pattern', 'Inbound commuters (LEHD) and the local-jobs-to-resident-workers ratio.');
      drawTableSimple([
        { label: 'Inbound commuters', value: data.employment.inCommuters },
        { label: 'Commute ratio',     value: data.employment.commuteRatioPct != null ? data.employment.commuteRatioPct + '%' : null },
        { label: 'LEHD source',       value: data.employment.source },
      ]);

      // ── 8. LIHTC + opportunity factors ──
      drawSectionHeader('8. LIHTC properties & opportunity factors', 'Existing LIHTC supply and HUD basis-boost designations (QCT / DDA) that improve credit pricing.');
      drawStatGrid([
        { label: 'LIHTC projects', value: data.lihtc.projectCount, sub: 'Active compliance' },
        { label: 'LIHTC units',    value: data.lihtc.totalUnits,   sub: 'Affordable' },
        { label: 'QCT tracts',     value: data.lihtc.qctTracts,    sub: 'IRC §42(d)(5)(B)' },
        { label: 'DDA status',     value: data.lihtc.ddaStatus,    sub: '130% basis boost' },
      ]);

      // ── Methodology + sources ──
      drawSectionHeader('Methodology & sources', '');
      drawTableSimple([
        { label: 'ACS profile',     value: data.vintages.acs },
        { label: 'HUD CHAS',        value: data.vintages.chas },
        { label: 'LEHD workplace',  value: data.vintages.lehd },
        { label: 'DOLA SYA',        value: data.vintages.dola },
        { label: 'HUD FMR',         value: data.vintages.fmr },
        { label: 'Ranking index built', value: data.vintages.rankingIndex },
        { label: 'Exported at',     value: data.exportedAt },
        { label: 'Generated by',    value: data.generatedBy },
      ]);
      pdf.setFont('helvetica', 'italic');
      pdf.setFontSize(8);
      pdf.setTextColor.apply(pdf, COLOR_MUTED);
      const disclaimer = pdf.splitTextToSize(data.disclaimer, CONTENT_W);
      newPageIfNeeded((disclaimer.length * 10) + 6);
      pdf.text(disclaimer, MARGIN, y);
      y += (disclaimer.length * 10) + 6;

      drawPageFooter();
      pdf.save(outFile);
      _showExportToast('PDF downloaded ✓');
    } catch (e) {
      console.warn('[HNA] Structured PDF export failed; falling back to screenshot path', e);
      _showExportToast('Falling back to screenshot PDF…', 'warn');
      return exportPdf(filename);
    } finally {
      if (pdfBtn) pdfBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Expose on window for housing-needs-assessment.js and for testability
  // ---------------------------------------------------------------------------

  window.__HNA_buildReportData = buildReportData;
  // F173 — primary PDF entry point routes through the structured builder.
  // The old screenshot exportPdf is kept reachable for fallback (and on
  // explicit consumer call via window.__HNA_exportPdfScreenshot).
  window.__HNA_exportPdf            = exportStructuredPdf;
  window.__HNA_exportPdfScreenshot  = exportPdf;
  window.__HNA_exportCsv       = exportCsv;
  window.__HNA_exportJson      = exportJson;

  // ---------------------------------------------------------------------------
  // HNAExport facade — convenience wrapper used by UI event handlers
  // ---------------------------------------------------------------------------

  window.HNAExport = {
    exportPdf: function (filename) {
      // F173 — route through the structured narrative builder by default.
      return exportStructuredPdf(filename);
    },
    exportPdfScreenshot: function (filename) {
      // Emergency fallback: full-page html2canvas screenshot. Kept for
      // consumers that explicitly need the screenshot mode.
      return exportPdf(filename);
    },
    exportCsv: function (reportData, filename) {
      return exportCsv(reportData, filename);
    },
    exportJson: function (reportData, filename) {
      return exportJson(reportData, filename);
    },
    exportExcel: function (reportData, filename) {
      return exportExcel(reportData, filename);
    },
    buildReportData: function () {
      return buildReportData();
    },
  };

  /* ─────────────────────────────────────────────────────────────────
     F168 — exportExcel — native Excel workbook with data tables AND
     native Excel chart objects. Each Chart.js instance on the page
     gets its own worksheet with the underlying labels + series values
     in a real table, plus a chart object that references that table —
     so users can edit the numbers and Excel re-draws the chart
     automatically. Falls back to CSV when ExcelJS isn't loaded.
     ───────────────────────────────────────────────────────────────── */

  function _harvestChartsForExcel() {
    if (!window.Chart || !window.Chart.instances) return [];
    return Object.values(window.Chart.instances)
      .filter(Boolean)
      .map(function (c) {
        var canvas = c.canvas;
        if (!canvas || !canvas.id) return null;
        var labels = (c.data && c.data.labels) || [];
        var datasets = (c.data && c.data.datasets) || [];
        if (!labels.length || !datasets.length) return null;
        var series = datasets.map(function (ds, i) {
          var values = (ds.data || []).map(function (v) {
            if (v && typeof v === 'object' && 'y' in v) return +v.y;
            return Number.isFinite(+v) ? +v : null;
          });
          return { name: ds.label || ('Series ' + (i + 1)), values: values };
        }).filter(function (s) {
          return s.values.some(function (v) { return Number.isFinite(v) && v !== 0; });
        });
        if (!series.length) return null;
        var card = canvas.closest('.chart-card');
        var title = (card && card.querySelector('h2'))
          ? card.querySelector('h2').textContent.trim()
          : canvas.id;
        return {
          id: canvas.id, title: title,
          labels: labels.map(function (l) { return String(l); }),
          series: series,
          type: c.config && c.config.type === 'line' ? 'line' : 'bar',
        };
      })
      .filter(Boolean);
  }

  function _safeSheetName(s) {
    return String(s || 'Sheet').replace(/[\/\\?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet';
  }

  async function exportExcel(reportData, filename) {
    var d       = reportData || buildReportData();
    var outFile = filename   || 'housing-needs-assessment.xlsx';
    var btn     = document.getElementById('btnExcel');
    try {
      if (btn) btn.disabled = true;
      if (!window.ExcelJS) {
        _showExportToast('ExcelJS not loaded — falling back to CSV', 'warn');
        exportCsv(d, outFile.replace(/\.xlsx$/, '.csv'));
        return;
      }
      _showExportToast('Generating Excel workbook…', 'info');

      var wb = new ExcelJS.Workbook();
      wb.creator = 'COHO Analytics — Housing Needs Assessment';
      wb.created = new Date();

      // ── Summary sheet ──
      var summary = wb.addWorksheet('Summary');
      summary.columns = [
        { header: 'Metric', key: 'k', width: 38 },
        { header: 'Value',  key: 'v', width: 28 },
      ];
      summary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF096E65' } };
      var s = d.snapshot || {};
      [
        ['Geography',                d.geography || ''],
        ['Generated',                d.generated || new Date().toISOString().slice(0, 10)],
        ['Population',               s.population],
        ['Median household income',  s.medianHouseholdIncome || s.medianHHI],
        ['Median gross rent',        s.medianRent],
        ['Median home value',        s.medianHomeValue],
        ['Total housing units',      s.totalHousingUnits],
        ['Owner-occupied units',     s.ownerOccupied],
        ['Renter-occupied units',    s.renterOccupied],
        ['Rent burdened (≥30%)',     s.rentBurdened30Plus],
        ['Cost-burdened (overall)',  s.costBurdenedOverall],
        ['Income needed to buy',     s.incomeNeededToBuy],
        ['Mean commute time (min)',  s.meanCommuteMin],
      ].filter(function (r) { return r[1] != null && r[1] !== ''; })
       .forEach(function (r) { summary.addRow({ k: r[0], v: r[1] }); });

      // ── One sheet per chart ──
      var harvested = _harvestChartsForExcel();
      var used = { Summary: true };
      harvested.forEach(function (chart) {
        var base = _safeSheetName(chart.title || chart.id);
        var name = base, n = 2;
        while (used[name]) name = _safeSheetName(base.slice(0, 28) + ' ' + (n++));
        used[name] = true;

        var sh = wb.addWorksheet(name);
        sh.getCell('A1').value = chart.title;
        sh.getCell('A1').font  = { bold: true, size: 14, color: { argb: 'FF096E65' } };
        sh.getCell('A2').value = 'Chart ID: #' + chart.id;
        sh.getCell('A2').font  = { italic: true, color: { argb: 'FF5A6A7C' }, size: 10 };

        var headerRow = ['Category'].concat(chart.series.map(function (sr) { return sr.name; }));
        sh.getRow(4).values = headerRow;
        sh.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sh.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF096E65' } };
        sh.getColumn(1).width = 22;
        for (var i = 0; i < chart.series.length; i++) sh.getColumn(i + 2).width = 16;

        chart.labels.forEach(function (label, rowIdx) {
          var row = [label].concat(chart.series.map(function (sr) {
            var v = sr.values[rowIdx];
            return Number.isFinite(v) ? v : null;
          }));
          sh.getRow(5 + rowIdx).values = row;
        });

        try {
          var lastRow = 4 + chart.labels.length;
          sh.addChart({
            type:    chart.type === 'line' ? 'line' : 'bar',
            title:   { text: chart.title },
            legend:  { position: 'top' },
            position: {
              type: 'twoCell',
              from: { col: chart.series.length + 3, row: 3 },
              to:   { col: chart.series.length + 13, row: 24 },
            },
            categoryAxis: { range: { sheet: name, range: 'A5:A' + lastRow } },
            series: chart.series.map(function (sr, i) {
              var col = String.fromCharCode(65 + 1 + i);
              return { name: sr.name, values: { sheet: name, range: col + '5:' + col + lastRow } };
            }),
          });
        } catch (chartErr) {
          console.warn('[HNA Excel] addChart unavailable, data-only sheet emitted:', chartErr.message);
        }
      });

      // ── Notes sheet ──
      var notes = wb.addWorksheet('Notes & sources');
      notes.columns = [{ header: 'Notes', key: 'n', width: 110 }];
      notes.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      notes.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF096E65' } };
      [
        'Generated by COHO Analytics — Housing Needs Assessment.',
        'Data sources: ACS 2024 (Census), HUD MTSP FY2025, CHAS 2018–2022, DOLA SYA, LEHD/LODES.',
        'Each chart sheet contains the data table the chart reads from. Edit a number and Excel re-draws the chart automatically.',
        'For methodology + source URLs see https://github.com/pggLLC/Housing-Analytics — README.md.',
      ].forEach(function (line) { notes.addRow({ n: line }); });

      var buf  = await wb.xlsx.writeBuffer();
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = outFile;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
      _showExportToast('Excel workbook downloaded ✓');
    } catch (e) {
      console.warn('[HNA] Excel export failed:', e);
      _showExportToast('Excel export failed — see console', 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.__HNA_exportExcel = exportExcel;

})();
