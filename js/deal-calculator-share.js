/*!
 * js/deal-calculator-share.js  — F202
 *
 * Save / share / export utilities for the Deal Calculator.
 *
 * Three modes (mirrors the HNA pattern in js/hna-export.js):
 *   1. Copy share URL  — encode key inputs as URL params; user pastes to partner
 *                        who opens the page and sees the same scenario.
 *   2. Download PDF    — multi-page screenshot of <main> via html2canvas + jsPDF
 *                        (falls back to window.print() if libs unavailable).
 *   3. Export JSON     — structured snapshot of all inputs (machine-readable).
 *
 * Hydration: on DOMContentLoaded the script reads URL params and populates
 * matching <input>/<select> elements, then dispatches an `input` event so the
 * Deal Calc's existing listeners run their normal recalculate() chain. No
 * direct call into __DealCalc is needed — we just nudge the same inputs the
 * user would have edited by hand.
 *
 * The list of shareable inputs (SHARE_KEYS) is hardcoded so we never
 * accidentally include diagnostic/output spans or rendered table cells. Add
 * a new key here when a new input ID should round-trip via the share URL.
 *
 * Tranches (multi-instance, dynamic) get a special compact encoding:
 *   ?tr=chfa_htf:500000:loan:3.0:30:100:current:5;prop123:250000:loan:0:30:0:accrued:8
 * Each ';' delimits a tranche; each ':' delimits one of the 8 F194 fields:
 *   program : amount : mode : rate : term : cashflowPayPct : accrueMode : priority
 *
 * Exposes window.__DealCalcShare with { copyLink, exportPdf, exportJson }.
 */
(function () {
  'use strict';

  // ── Inputs that round-trip via URL params ────────────────────────────
  // Add new keys here when adding shareable Deal Calc inputs. Order doesn't
  // matter — the param name is the DOM ID with the "dc-" prefix stripped.
  var SHARE_KEYS = [
    // Capital stack
    'dc-tdc', 'dc-units', 'dc-basis-pct', 'dc-qct-dda',
    'dc-equity-price', 'dc-deferred-dev-fee',
    // AMI mix (7 tiers)
    'dc-units-30', 'dc-units-40', 'dc-units-50',
    'dc-units-60', 'dc-units-70', 'dc-units-80', 'dc-units-100',
    // Mortgage sizing
    'dc-noi', 'dc-dcr', 'dc-rate', 'dc-term',
    // Pro forma growth assumptions
    'pf-rent-growth', 'pf-exp-growth', 'dc-vacancy',
    // Year-15 exit
    'dc-exit-hold', 'dc-exit-cap',
    // F193 stress sliders
    'dc-stress-equity-price', 'dc-stress-tdc-overrun', 'dc-stress-rent-low',
    'dc-stress-leaseup', 'dc-stress-dscr-floor',
    // F195 capital event waterfall
    'dc-wf-lp-equity', 'dc-wf-pref', 'dc-wf-gp-residual', 'dc-wf-catchup'
  ];

  // ── DOM helpers ───────────────────────────────────────────────────────
  function _getEl(id) { return document.getElementById(id); }
  function _readVal(id) {
    var el = _getEl(id);
    if (!el) return null;
    if (el.type === 'checkbox') return el.checked ? '1' : '0';
    if (el.type === 'radio') {
      var checked = document.querySelector('input[name="' + el.name + '"]:checked');
      return checked ? checked.value : null;
    }
    return el.value;
  }
  function _writeVal(id, raw) {
    var el = _getEl(id);
    if (!el || raw == null) return;
    if (el.type === 'checkbox') {
      el.checked = (raw === '1' || raw === 'true' || raw === true);
    } else {
      el.value = raw;
    }
    // Fire the same events the user would have triggered by editing the
    // input. The Deal Calc listens for 'input' (and sometimes 'change');
    // dispatching both keeps the recalculate flow honest.
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Tranche encode / decode ───────────────────────────────────────────
  // Tranches are rendered into rows with class .dc-tr-* — encode each row
  // as 8 colon-delimited fields, multiple rows joined by ';'.
  // Field order: program:amount:mode:rate:term:cfPay:accrue:priority
  function _readTranches() {
    var rows = document.querySelectorAll('[data-tranche-id]');
    if (!rows || !rows.length) return '';
    var out = [];
    rows.forEach(function (row) {
      var prog  = (row.querySelector('.dc-tr-prog') || {}).value || '';
      var amt   = (row.querySelector('.dc-tr-amount') || {}).value || '';
      var modeRadio = row.querySelector('.dc-tr-mode:checked');
      var mode  = modeRadio ? modeRadio.value : 'loan';
      var rate  = (row.querySelector('.dc-tr-rate') || {}).value || '';
      var term  = (row.querySelector('.dc-tr-term') || {}).value || '';
      var cfPay = (row.querySelector('.dc-tr-cfpay') || {}).value || '';
      var accrue = (row.querySelector('.dc-tr-accrue') || {}).value || '';
      var prio  = (row.querySelector('.dc-tr-priority') || {}).value || '';
      out.push([prog, amt, mode, rate, term, cfPay, accrue, prio].join(':'));
    });
    return out.join(';');
  }
  function _applyTranches(encoded) {
    if (!encoded) return;
    var pairs = encoded.split(';');
    // Click "+ Add soft-funding tranche" until row count matches encoded
    // tranche count (starting from 1 pre-seeded row).
    var addBtn = _getEl('dc-add-tranche');
    if (addBtn) {
      var existingCount = document.querySelectorAll('[data-tranche-id]').length;
      for (var i = existingCount; i < pairs.length; i++) addBtn.click();
    }
    // Wait one tick so the freshly-added rows mount, then populate.
    setTimeout(function () {
      var rows = document.querySelectorAll('[data-tranche-id]');
      pairs.forEach(function (s, idx) {
        var row = rows[idx];
        if (!row) return;
        var parts = s.split(':');
        var prog = parts[0], amt = parts[1], mode = parts[2], rate = parts[3];
        var term = parts[4], cfPay = parts[5], accrue = parts[6], prio = parts[7];
        function _setRowInput(sel, val) {
          var el = row.querySelector(sel);
          if (!el || val == null || val === '') return;
          el.value = val;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        _setRowInput('.dc-tr-prog', prog);
        _setRowInput('.dc-tr-amount', amt);
        if (mode) {
          var modeEl = row.querySelector('.dc-tr-mode[value="' + mode + '"]');
          if (modeEl) { modeEl.checked = true; modeEl.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        _setRowInput('.dc-tr-rate', rate);
        _setRowInput('.dc-tr-term', term);
        _setRowInput('.dc-tr-cfpay', cfPay);
        if (accrue) {
          var accEl = row.querySelector('.dc-tr-accrue');
          if (accEl) { accEl.value = accrue; accEl.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        _setRowInput('.dc-tr-priority', prio);
      });
    }, 80);
  }

  // ── Serialize / hydrate ───────────────────────────────────────────────
  function _serialize() {
    var params = new URLSearchParams();
    SHARE_KEYS.forEach(function (id) {
      var v = _readVal(id);
      if (v != null && v !== '') params.set(id.replace(/^dc-/, ''), v);
    });
    var tr = _readTranches();
    if (tr) params.set('tr', tr);
    // Active jurisdiction (county FIPS) so the partner lands on the same
    // basis-boost / county context.
    try {
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject &&
                 window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (jx && jx.fips)  params.set('fips',  jx.fips);
      if (jx && jx.geoid) params.set('geoid', jx.geoid);
    } catch (_) {}
    return params;
  }
  function _hydrate() {
    var params = new URLSearchParams(window.location.search);
    if (!Array.from(params.keys()).length) return;  // no params, nothing to do
    SHARE_KEYS.forEach(function (id) {
      var key = id.replace(/^dc-/, '');
      if (params.has(key)) _writeVal(id, params.get(key));
    });
    if (params.has('tr')) _applyTranches(params.get('tr'));
    // Surface that the scenario came from a URL so the user knows it's not
    // their saved defaults.
    setTimeout(function () {
      _showShareToast('Scenario hydrated from URL ✓', 'info');
    }, 200);
  }

  // ── Toast (matches HNA pattern) ───────────────────────────────────────
  function _showShareToast(message, level) {
    var existing = document.getElementById('dc-share-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'dc-share-toast';
    var bg = level === 'warn' ? 'var(--warn-dim, #fef3c7)' :
             level === 'info' ? 'var(--accent-dim, #d1f0ed)' :
             'var(--good-dim, #d1fae5)';
    var color = level === 'warn' ? 'var(--warn, #a84608)' :
                level === 'info' ? 'var(--accent, #096e65)' :
                'var(--good, #047857)';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'background:' + bg + ';color:' + color + ';padding:10px 18px;border-radius:8px;' +
      'box-shadow:0 4px 12px rgba(0,0,0,.15);font-weight:600;font-size:.88rem;z-index:9999;' +
      'border:1px solid currentColor;opacity:0;transition:opacity .2s';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function () { toast.style.opacity = '1'; }, 10);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, 250);
    }, 2400);
  }

  // ── Public — Copy share link ──────────────────────────────────────────
  function copyLink() {
    try {
      var params = _serialize();
      var url = window.location.origin + window.location.pathname + '?' + params.toString();
      // Update browser bar so the user sees the encoded state too
      try { window.history.replaceState(null, '', url); } catch (_) {}
      // Copy to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          _showShareToast('Share link copied to clipboard ✓');
        }).catch(function () {
          _fallbackCopy(url);
        });
      } else {
        _fallbackCopy(url);
      }
    } catch (e) {
      console.warn('[DealCalc] share copy failed', e);
      _showShareToast('Copy failed — see console', 'warn');
    }
  }
  function _fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      _showShareToast('Share link copied ✓');
    } catch (_) {
      _showShareToast('Copy failed — link is in the URL bar', 'warn');
    }
    ta.remove();
  }

  // ── Public — Export JSON ──────────────────────────────────────────────
  function exportJson() {
    try {
      var snapshot = {
        exportedAt: new Date().toISOString(),
        url: window.location.origin + window.location.pathname + '?' + _serialize().toString(),
        inputs: {},
        tranches: []
      };
      SHARE_KEYS.forEach(function (id) {
        var v = _readVal(id);
        if (v != null) snapshot.inputs[id.replace(/^dc-/, '')] = v;
      });
      var trStr = _readTranches();
      if (trStr) {
        snapshot.tranches = trStr.split(';').map(function (s) {
          var p = s.split(':');
          return {
            program: p[0], amount: p[1], mode: p[2], rate: p[3], term: p[4],
            cashflowPayPct: p[5], accrueMode: p[6], priority: p[7]
          };
        });
      }
      var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'deal-calculator-scenario.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      _showShareToast('JSON downloaded ✓');
    } catch (e) {
      console.warn('[DealCalc] JSON export failed', e);
      _showShareToast('JSON export failed — see console', 'warn');
    }
  }

  // ── Public — Export PDF (html2canvas + jsPDF; print fallback) ─────────
  async function exportPdf(filename) {
    var outFile = filename || 'deal-calculator-scenario.pdf';
    var btn = document.getElementById('dc-share-pdf');
    try {
      if (btn) btn.disabled = true;
      if (!window.html2canvas || !window.jspdf) {
        _showShareToast('PDF libs not loaded — using print dialog', 'warn');
        window.print();
        return;
      }
      _showShareToast('Generating PDF…', 'info');
      var jsPDF = window.jspdf.jsPDF;
      var node = document.querySelector('main') || document.body;
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
      var canvas = await window.html2canvas(node, { scale: 2, useCORS: true, backgroundColor: bg });
      var imgData = canvas.toDataURL('image/png');
      var pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      var imgW = pageW;
      var imgH = canvas.height * (pageW / canvas.width);
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
      var remaining = imgH - pageH;
      var offset = 0;
      while (remaining > 0) {
        pdf.addPage();
        offset += pageH;
        pdf.addImage(imgData, 'PNG', 0, -offset, imgW, imgH);
        remaining -= pageH;
      }
      pdf.save(outFile);
      _showShareToast('PDF downloaded ✓');
    } catch (e) {
      console.warn('[DealCalc] PDF export failed; falling back to print()', e);
      _showShareToast('PDF generation failed — using print dialog', 'warn');
      window.print();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Wire buttons + hydrate on DOM ready ───────────────────────────────
  function _initButtons() {
    var btnCopy = document.getElementById('dc-share-copy');
    var btnPdf  = document.getElementById('dc-share-pdf');
    var btnJson = document.getElementById('dc-share-json');
    if (btnCopy) btnCopy.addEventListener('click', copyLink);
    if (btnPdf)  btnPdf.addEventListener('click', function () { exportPdf(); });
    if (btnJson) btnJson.addEventListener('click', exportJson);
  }
  function _init() {
    _initButtons();
    // Hydrate after Deal Calc's own init has populated defaults. Delay long
    // enough for __DealCalc.init() to complete (~200ms typical).
    setTimeout(_hydrate, 350);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Public API
  window.__DealCalcShare = { copyLink: copyLink, exportPdf: exportPdf, exportJson: exportJson };
})();
