/**
 * js/components/ma-pdf.js
 * market-analysis.html and deal-market-analysis.html (rebuilt from it).
 *
 * "Download PDF" (paul, 24 Nov 2026: "add the pma pdf"): one click saves the whole study as a PDF file. The existing
 * "Print report" (js/market-analysis/market-report-renderers.js exportReport, formerly "Export Report") stays: it opens
 * a printable page of the eight report sections.
 *
 * The PDF holds, in page order, what the screen shows after an analysis:
 *   1. a cover: the place, the site point, the buffer, the date, the site score and its tier, and the screening note
 *   2. the map, with the OpenStreetMap credit (and Esri's when the satellite layer is on)
 *   3. the market area panel: score, capture rate, supply, risk flags, the transit-zone and QCT/DDA lines
 *   4. the place context, CHFA requirements checklist and Subject Project
 *   5. the eight report sections, the infrastructure section and the concept recommendation
 * Each part is a picture of the part on screen (html2canvas, as the Deal Calculator's "Download PDF" does), so every
 * figure, label and source line in the file is the one on screen. Nothing here works out a figure.
 *
 * jsPDF is the copy the site's other PDF downloads use (jsdelivr, 2.5.1), loaded on the first click. If either
 * library cannot load, or the capture fails, the printable page opens instead and the reason is shown.
 */
(function () {
  'use strict';

  var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  var PARTS = [
    { sel: '.pma-map-wrap', title: 'Map', map: true },
    { sel: '.pma-panel', title: 'Market area results' },
    { sel: '#maJurisdictionContext' },
    { sel: '#maChfaRequirements' },
    { sel: '#maSubjectProject' },
    { sel: '#maExecSummary' }, { sel: '#maMarketDemand' }, { sel: '#maAffordableSupply' }, { sel: '#maSubsidyOpp' },
    { sel: '#maSiteFeasibility' }, { sel: '#maNeighborhoodAccess' }, { sel: '#maPolicyOverlays' }, { sel: '#maOpportunities' },
    { sel: '#maInfrastructure' }, { sel: '#lihtcConceptSection' }
  ];

  function status(text, isError) {
    var s = document.getElementById('pmaPdfStatus');
    if (!s) return;
    s.textContent = text || '';
    s.hidden = !text;
    s.style.color = isError ? 'var(--bad, #b42318)' : '';
  }

  function loadScript(url, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = url; tag.async = true;
      tag.onload = function () { test() ? resolve() : reject(new Error('loaded but not available')); };
      tag.onerror = function () { reject(new Error('could not load ' + url)); };
      document.head.appendChild(tag);
    });
  }

  function site() {
    var st = window.MAState && typeof window.MAState.getState === 'function' ? window.MAState.getState() : null;
    var s = st && st.site;
    return s && typeof s.lat === 'number' && typeof s.lon === 'number' && Number.isFinite(s.lat) && Number.isFinite(s.lon) ? s : null;
  }

  function text(id) {
    var e = document.getElementById(id);
    return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  // Standard PDF fonts lack these glyphs.
  function printable(t) {
    return String(t).replace(/[‐‑‒–—−]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-');
  }

  function placeName() {
    var row = document.querySelector('.ma-place-row strong, #maPlaceRow strong, .jurisdiction-pill, [data-place-name]');
    var t = row ? String(row.textContent || '').trim() : '';
    return t && t.length < 80 ? t : '';
  }

  function mapCredit() {
    var a = document.querySelector('.pma-map-wrap .leaflet-control-attribution');
    var t = a ? String(a.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t || 'Map data (c) OpenStreetMap contributors';
  }

  // Place a canvas at the current position, across as many pages as it needs.
  function addCanvas(pdf, canvas, pos, bg) {
    var pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), m = pos.margin;
    // A narrow part (the results panel) keeps its screen size (1 CSS px = 0.75 pt) rather than being blown up to the page.
    var w = Math.min(pageW - m * 2, canvas.width / 1.5 * 0.75), k = w / canvas.width;
    var top = 0;
    while (top < canvas.height) {
      var room = pageH - m - pos.y;
      if (room < 60) { pdf.addPage(); pos.y = m; room = pageH - m * 2; }
      var h = Math.min(canvas.height - top, Math.floor(room / k));
      var slice = document.createElement('canvas');
      slice.width = canvas.width; slice.height = h;
      var c = slice.getContext && slice.getContext('2d');
      if (!c) return;
      c.fillStyle = bg; c.fillRect(0, 0, slice.width, h);
      c.drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
      pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', m, pos.y, w, h * k);
      pos.y += h * k + 10;
      top += h;
    }
  }

  function write(pdf, pos, t, size, bold) {
    var pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), m = pos.margin;
    pdf.setFontSize(size);
    if (pdf.setFont) pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.splitTextToSize(printable(t), pageW - m * 2).forEach(function (line) {
      if (pos.y + size > pageH - m) { pdf.addPage(); pos.y = m; }
      pdf.text(line, m, pos.y + size); pos.y += size * 1.35;
    });
    pos.y += 4;
  }

  function fileName(s) {
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'market-analysis-' + s.lat.toFixed(4) + '_' + s.lon.toFixed(4) + '-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.pdf';
  }

  function fallback(reason) {
    status('PDF could not be built (' + reason + '). Opening the printable report instead.', true);
    var R = window.MARenderers;
    if (R && typeof R.exportReport === 'function') R.exportReport();
  }

  // The study the PDF is of. Placing a site or finishing a run while the PDF builds changes the page under the capture,
  // so each such event counts here and the PDF is dropped if the count moves (Codex review of #2985).
  var changes = 0;
  ['pma-site-selected', 'pma:site-placed', 'ma:analysis-complete'].forEach(function (ev) {
    document.addEventListener(ev, function () { changes++; });
  });
  function Changed() { this.message = 'the analysis changed while the PDF was being built'; }

  var busy = false;
  async function download() {
    if (busy) return;
    var s = site();
    if (!s || document.body.getAttribute('data-pma-result-state') === 'pending') { status('Run an analysis first, then download the PDF.', true); return; }
    var btn = document.getElementById('pmaPdfBtn');
    var at = changes;
    // Same site, no new run, and the result on screen is not pending: else the parts would mix two studies.
    var same = function () {
      var n = site();
      if (at !== changes || !n || n.lat !== s.lat || n.lon !== s.lon || document.body.getAttribute('data-pma-result-state') === 'pending') throw new Changed();
    };
    busy = true; if (btn) btn.disabled = true;
    try {
      status('Building PDF: loading…');
      await loadScript(JSPDF_URL, function () { return !!(window.jspdf && window.jspdf.jsPDF); });
      same();
      if (!window.html2canvas) throw new Error('the page capture library did not load');
      var pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });
      var pos = { y: 40, margin: 40 };
      var bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = '#ffffff';
      var place = placeName();

      write(pdf, pos, 'Market Analysis' + (place ? ': ' + place : ''), 20, true);
      write(pdf, pos, 'Site ' + s.lat.toFixed(5) + ', ' + s.lon.toFixed(5) + ' - buffer ' + (s.bufferMiles || '') + ' mi - ' +
        new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), 11);
      var score = text('pmaScoreCircle'), tier = text('pmaScoreTier');
      if (score && score !== '—') write(pdf, pos, 'Site score: ' + score + (tier ? ' (' + tier + ')' : '') + '. Relative indicator only, not a CHFA threshold.', 11);
      write(pdf, pos, 'A screening tool, not a CHFA market study. Figures, sources and dates are as shown on cohoanalytics.com when this file was made: ' + location.href.split('#')[0], 9);
      pos.y += 6;

      var parts = PARTS.map(function (p) { return Object.assign({ el: document.querySelector(p.sel) }, p); })
        .filter(function (p) { return p.el && p.el.getClientRects().length > 0 && !p.el.hidden; });
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        status('Building PDF: part ' + (i + 1) + ' of ' + parts.length + '…');
        var canvas;
        try {
          canvas = await window.html2canvas(p.el, { scale: 1.5, useCORS: true, backgroundColor: bg, logging: false,
            // The map's height comes from a sheet the copy html2canvas draws from does not keep: give it the height on
            // screen. The layer pickers and address box are controls, not results (and their sheet stops the capture).
            onclone: function (d) { var m = d.getElementById('pmaMap'), live = document.getElementById('pmaMap'); if (m && live) m.style.height = live.getBoundingClientRect().height + 'px'; },
            ignoreElements: function (e) { return !!(e.classList && (e.classList.contains('map-layer-section') || e.classList.contains('pma-address-search'))) || e.id === 'pmaPdfStatus'; } });
        } catch (e) {
          same();
          if (p.map) { write(pdf, pos, 'Map: could not be captured in this browser (' + (e && e.message || 'capture failed') + ').', 9); continue; }
          throw e;
        }
        same();
        if (p.title) write(pdf, pos, p.title, 13, true);
        addCanvas(pdf, canvas, pos, bg);
        if (p.map) write(pdf, pos, mapCredit(), 8);
      }
      same();
      status('Building PDF: saving…');
      pdf.save(fileName(s));
      status('PDF downloaded.');
      setTimeout(function () { status(''); }, 6000);
    } catch (e) {
      // A changed study is not a failure of the PDF: say so, and let the reader press again for the new one.
      if (e instanceof Changed) status('The analysis changed while the PDF was being built, so it was not saved. Press Download PDF again for the study on screen.', true);
      else fallback(e && e.message ? e.message : 'unknown error');
    } finally {
      busy = false;
      // As js/market-analysis.js leaves it: off while a new site's result is pending.
      if (btn) btn.disabled = document.body.getAttribute('data-pma-result-state') === 'pending';
    }
  }

  function wire() {
    var btn = document.getElementById('pmaPdfBtn');
    if (btn) btn.addEventListener('click', download);
  }

  window.MAPdf = { download: download, parts: PARTS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
