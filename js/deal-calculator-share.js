/*!
 * js/deal-calculator-share.js  — F202
 *
 * Save / share / export utilities for the Deal Calculator.
 *
 * Three modes (mirrors the HNA pattern in js/hna-export.js):
 *   1. Copy share URL  — encode key inputs as URL params; user pastes to partner
 *                        who opens the page and sees the same scenario.
 *   2. Download PDF    — screenshot pages plus searchable report disclosures via jsPDF
 *                        (falls back to window.print() if libs unavailable).
 *   3. Deal file       — "Download deal file": structured snapshot of all inputs,
 *                        plus the computed outputs as displayed (null where
 *                        unavailable). "Open deal file" reloads one.
 *
 * Hydration: on DOMContentLoaded the script reads URL params and populates
 * matching <input>/<select> elements, then dispatches an `input` event so the
 * Deal Calc's existing listeners run their normal recalculate() chain. The
 * resolved utility allowance is restored separately as scenario state through
 * __DealCalc; it never writes to the recipient's Subject Project.
 *
 * The shareable inputs are read from the page (every form control whose id
 * starts with dc- or pf-), so a new input round-trips without an edit here.
 * auditInputs() accounts for every other control in <main>; see shareKeys().
 *
 * Tranches (multi-instance, dynamic) get a special compact encoding:
 *   ?tr=chfa_htf:500000:loan:3.0:30:100:current:5;prop123:250000:loan:0:30:0:accrued:8
 * Each ';' delimits a tranche; each ':' delimits one field:
 *   program : amount : mode : rate : term : cashflowPayPct : accrueMode : priority
 *   : loanType : maturity : ioYears : fundSource (federal | nonfederal | blank, #2160)
 *   : doh (DOH PR 3) : activity : status : state request (yes | no) (DOH PR 4)
 *
 * Exposes window.__DealCalcShare with { copyLink, exportPdf, exportJson, openDealFile }.
 */
(function () {
  'use strict';

  // ── Inputs that round-trip via URL params ────────────────────────────
  // The shareable set is READ FROM THE PAGE, not hand-listed. A hand list
  // (SHARE_KEYS, F202-F221) silently dropped every input added after it was
  // written — the county selector, gross SF, the studio split column, the
  // ownership resale inputs, the methodology constants — so a recipient
  // opening an ownership share link saw every output as "—" while the sender
  // saw a max price and a gap. Now every <input>/<select>/<textarea> whose id
  // starts with one of SHARE_ID_PREFIXES is shared, and anything else inside
  // <main> must be accounted for in SHARE_EXCLUDED_CONTAINERS or
  // ATTR_SHARE_KEYS, or auditInputs() reports it (and
  // test/deal-calc-share-roundtrip.test.js fails).
  //
  // The URL param name is the DOM id with the "dc-" prefix stripped, so every
  // link produced by the old hand list still hydrates.
  var SHARE_ID_PREFIXES = /^(dc|pf)-/;

  // Radio groups are carried by ONE member (the first in DOM order, which is
  // the id the old hand list used: dc-mode-rental, dc-rate-9); _readVal /
  // _writeVal walk the group by name. The other members are not separate keys.

  // Controls inside <main> that are deliberately not shared, with the reason.
  var SHARE_EXCLUDED_CONTAINERS = [
    // Soft-funding tranche rows are id-less and multi-instance; they travel in
    // the compact `tr` param (see _readTranches / _applyTranches).
    { selector: '[data-tranche-id]', reason: 'soft-funding tranches travel in the `tr` param' },
    // Rent-vs-Buy is a separate market-context widget with its own defaults;
    // it feeds no Deal Calculator output.
    { selector: '#rvbCalculator', reason: 'Rent vs Buy widget is independent of the deal scenario' },
    // Residual land value tool (js/components/land-value-tool.js): its own
    // inputs and comps, reads nothing from and writes nothing to the calculator.
    { selector: '#landValueTool', reason: 'standalone land-value tool; feeds no Deal Calculator output' },
    // Quick estimate panel (js/deal-calculator-quick.js): each control mirrors a
    // dc- input that is shared, so the panel itself carries nothing.
    { selector: '#dcQuick', reason: 'quick estimate controls mirror shared dc- inputs' },
    // Development realism checklists: reading aids a user ticks, not modeled.

    { selector: '.devr-checkbox', reason: 'realism checklist ticks; not modeled by the calculator' }
  ];

  // Id-less controls that do drive an output, keyed by a data attribute. The
  // ownership resale picker is rebuilt on every recalculate, so it has no id.
  // Order matters on hydrate: the mechanism options depend on the subsidy type.
  var ATTR_SHARE_KEYS = [
    { param: 'resale-subsidy',   selector: '[data-resale-subsidy-type]' },
    { param: 'resale-mechanism', selector: '[data-resale-mechanism]' }
  ];

  function _isFormControl(el) {
    return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) &&
      el.type !== 'button' && el.type !== 'submit' && el.type !== 'reset' && el.type !== 'file';
  }

  /** Every shareable id on the page, in DOM order, one per radio group. */
  function shareKeys() {
    var out = [];
    var seenGroups = {};
    Array.prototype.forEach.call(document.querySelectorAll('input[id], select[id], textarea[id]'), function (el) {
      if (!_isFormControl(el) || !SHARE_ID_PREFIXES.test(el.id)) return;
      if (_excludedBy(el)) return;
      if (el.type === 'radio') {
        if (!el.name || seenGroups[el.name]) return;
        seenGroups[el.name] = true;
      }
      out.push(el.id);
    });
    return out;
  }

  function _excludedBy(el) {
    for (var i = 0; i < SHARE_EXCLUDED_CONTAINERS.length; i++) {
      if (el.closest && el.closest(SHARE_EXCLUDED_CONTAINERS[i].selector)) return SHARE_EXCLUDED_CONTAINERS[i];
    }
    return null;
  }

  /**
   * Account for every form control in <main>: shared by id, shared by data
   * attribute, or excluded with a reason. `unaccounted` must be empty — a
   * control in it is one a share link would silently drop.
   */
  function auditInputs() {
    var scope = document.querySelector('main') || document.body;
    var keys = shareKeys();
    var keySet = {};
    keys.forEach(function (id) { keySet[id] = true; });
    var result = { shared: keys, sharedByAttr: [], excluded: [], unaccounted: [] };
    Array.prototype.forEach.call(scope.querySelectorAll('input, select, textarea'), function (el) {
      if (!_isFormControl(el)) return;
      var label = el.id || el.name || (el.outerHTML || '').slice(0, 80);
      if (el.id && keySet[el.id]) return;
      if (el.type === 'radio' && el.name) {
        var carrier = document.querySelector('input[type="radio"][name="' + el.name + '"]');
        if (carrier && keySet[carrier.id]) return;
      }
      for (var i = 0; i < ATTR_SHARE_KEYS.length; i++) {
        if (el.matches && el.matches(ATTR_SHARE_KEYS[i].selector)) { result.sharedByAttr.push(ATTR_SHARE_KEYS[i].param); return; }
      }
      var ex = _excludedBy(el);
      if (ex) { result.excluded.push({ control: label, reason: ex.reason }); return; }
      result.unaccounted.push(label);
    });
    return result;
  }

  // The county a share link carries. deal-calculator.js reads this when the
  // county list finishes loading, so its own jurisdiction auto-select does not
  // overwrite the shared county (the list loads asynchronously, after hydrate).
  try {
    var _sharedCounty = new URLSearchParams(window.location.search).get('county-select');
    if (_sharedCounty) window.__DealCalcSharedCounty = _sharedCounty;
  } catch (_) {}

  // ── DOM helpers ───────────────────────────────────────────────────────
  var _sharedProvenance = null;
  function _notifyInput(el, type) {
    var dispatch = function () { el.dispatchEvent(new Event(type, { bubbles: true })); };
    if (_sharedProvenance && window.InputProvenance) window.InputProvenance.withProgrammaticChange(dispatch);
    else dispatch(); // Older links retain their original edit-event behavior.
  }
  function _provenanceMap() {
    return window.InputProvenance ? window.InputProvenance.serialize(document.getElementById('dealCalcMount') || document) : null;
  }
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
  // A value already in place is left alone: every write fires a full
  // recalculate, and a link now carries ~140 inputs, most at their defaults.
  // Writes run in page order, so "already in place" is judged after earlier
  // writes' side effects (e.g. the credit-rate radio resetting equity price).
  function _writeVal(id, raw) {
    var el = _getEl(id);
    if (!el || raw == null) return;
    if (el.type === 'checkbox') {
      var want = (raw === '1' || raw === 'true' || raw === true);
      if (el.checked === want) return;
      el.checked = want;
      _notifyInput(el, 'input');
      _notifyInput(el, 'change');
      return;
    }
    if (el.type === 'radio') {
      // F221 — Previously this set el.value = raw which mutated the value
      // attribute on a single radio, instead of selecting the radio whose
      // value matches. Find the matching member of the group and check it.
      // Escape backslashes before quotes so the value can't break out of the
      // CSS string literal (backslash-escaping order matters).
      var cssVal = String(raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      var match = document.querySelector('input[name="' + el.name + '"][value="' + cssVal + '"]');
      if (match && !match.checked) {
        match.checked = true;
        _notifyInput(match, 'input');
        _notifyInput(match, 'change');
      }
      return;
    }
    if (el.tagName === 'SELECT' && !_hasOption(el, raw)) {
      // Options loaded asynchronously (the county list waits for HUD FMR, the
      // unit-size standards for their JSON). Setting .value now would select
      // nothing, so wait for the option to appear.
      _whenOptionExists(function () { return _getEl(id); }, raw);
      return;
    }
    if (el.value === String(raw)) return;
    el.value = raw;
    // Fire the same events the user would have triggered by editing the
    // input. The Deal Calc listens for 'input' (and sometimes 'change');
    // dispatching both keeps the recalculate flow honest.
    _notifyInput(el, 'input');
    _notifyInput(el, 'change');
  }

  function _hasOption(sel, raw) {
    return Array.prototype.some.call(sel.options || [], function (o) { return o.value === String(raw); });
  }
  function _selectAndFire(sel, raw) {
    sel.value = raw;
    _notifyInput(sel, 'input');
    _notifyInput(sel, 'change');
    if (_sharedProvenance && window.InputProvenance) window.InputProvenance.restore(_sharedProvenance);
  }
  // Poll (100 ms, up to 15 s) for a select option that is populated later.
  function _whenOptionExists(getSel, raw, tries) {
    var sel = getSel();
    if (sel && _hasOption(sel, raw)) {
      if (sel.value !== String(raw)) _selectAndFire(sel, raw);
      return;
    }
    if ((tries || 0) >= 150) {
      console.warn('[DealCalc] shared value ' + raw + ' never became available; not applied');
      return;
    }
    setTimeout(function () { _whenOptionExists(getSel, raw, (tries || 0) + 1); }, 100);
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
      var type = (row.querySelector('.dc-tr-type') || {}).value;
      var maturity = (row.querySelector('.dc-tr-maturity') || {}).value;
      var io = (row.querySelector('.dc-tr-io') || {}).value;
      var fed = (row.querySelector('.dc-tr-fed') || {}).value || '';
      var doh = (row.querySelector('.dc-tr-doh') || {}).value || '';
      var activity = (row.querySelector('.dc-tr-activity') || {}).value || '';
      var status = (row.querySelector('.dc-tr-status') || {}).value || '';
      var state = (row.querySelector('.dc-tr-state') || {}).value || '';
      out.push([prog, amt, mode, rate, term, cfPay, accrue, prio, type, maturity, io, fed, doh, activity, status, state].join(':'));
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
      if (window.InputProvenance) {
        var host = document.getElementById('dc-soft-tranches');
        window.InputProvenance.apply(host);
      }
      var rows = document.querySelectorAll('[data-tranche-id]');
      pairs.forEach(function (s, idx) {
        var row = rows[idx];
        if (!row) return;
        var parts = s.split(':');
        var prog = parts[0], amt = parts[1], mode = parts[2], rate = parts[3];
        var term = parts[4], cfPay = parts[5], accrue = parts[6], prio = parts[7];
        function _setRowInput(sel, val) {
          var el = row.querySelector(sel);
          if (!el || val == null) return;
          el.value = val;
          _notifyInput(el, 'input');
          _notifyInput(el, 'change');
        }
        _setRowInput('.dc-tr-prog', prog);
        _setRowInput('.dc-tr-amount', amt);
        if (mode) {
          var modeEl = row.querySelector('.dc-tr-mode[value="' + mode + '"]');
          if (modeEl) { modeEl.checked = true; _notifyInput(modeEl, 'change'); }
        }
        _setRowInput('.dc-tr-rate', rate);
        _setRowInput('.dc-tr-term', term);
        _setRowInput('.dc-tr-cfpay', cfPay);
        if (accrue) {
          var accEl = row.querySelector('.dc-tr-accrue');
          if (accEl) { accEl.value = accrue; _notifyInput(accEl, 'change'); }
        }
        _setRowInput('.dc-tr-priority', prio);
        _setRowInput('.dc-tr-type', parts[8] === undefined ? (accrue === 'accrued' ? 'accrue_defer' : cfPay !== undefined && cfPay !== '' && Number(cfPay) < 100 ? 'cash_flow' : 'amortizing') : parts[8]);
        _setRowInput('.dc-tr-maturity', parts[9] === undefined ? term : parts[9]);
        _setRowInput('.dc-tr-io', parts[10] === undefined ? '2' : parts[10]);
        // #2160: links made before the federal-money field leave it at the program default.
        if (parts[11] !== undefined) _setRowInput('.dc-tr-fed', parts[11]);
        // DOH PR 3: links made before the DOH group keep the program's default group.
        if (parts[12] !== undefined) _setRowInput('.dc-tr-doh', parts[12]);
        // DOH PR 4: older links keep the whole-project default, pending, and the
        // program's state-request default.
        if (parts[13] !== undefined) _setRowInput('.dc-tr-activity', parts[13]);
        if (parts[14]) _setRowInput('.dc-tr-status', parts[14]);
        if (parts[15]) _setRowInput('.dc-tr-state', parts[15]);
      });
      if (_sharedProvenance && window.InputProvenance) window.InputProvenance.restore(_sharedProvenance);
    }, 80);
  }

  // ── Which inputs leave the page ───────────────────────────────────────
  // PC-2: an ownership export carries no tax-credit, basis, NOI or LIHTC-debt
  // input. What is rental-only is read from the page, not listed here: an
  // input inside a [data-dc-mode="rental"] container is one ownership mode
  // hides, so it is one an ownership export omits. A second list would drift
  // from the first; this cannot.
  function _dealMode() {
    var checked = document.querySelector('input[name="dc-deal-mode"]:checked');
    return checked && checked.value === 'ownership' ? 'ownership' : 'rental';
  }
  function _exportedKeys() {
    var keys = shareKeys();
    if (_dealMode() !== 'ownership') return keys;
    return keys.filter(function (id) {
      var el = _getEl(id);
      return !(el && el.closest && el.closest('[data-dc-mode="rental"]'));
    });
  }
  function _exportedTranches() {
    // The soft-funding stack is a LIHTC gap-filling stack (it sits in a
    // rental-only fieldset), so an ownership export carries none of it.
    return _dealMode() === 'ownership' ? '' : _readTranches();
  }

  // ── Serialize / hydrate ───────────────────────────────────────────────
  function _serialize() {
    var params = new URLSearchParams();
    _exportedKeys().forEach(function (id) {
      var v = _readVal(id);
      if (v == null) return;
      // An empty field is carried only when it differs from the page default
      // (the sender cleared a pre-filled value); otherwise the URL would carry
      // ~50 empty split-unit params for nothing.
      if (v === '') {
        var el = _getEl(id);
        if (!el || !('defaultValue' in el) || el.tagName === 'SELECT' || (el.defaultValue || '') === '') return;
      }
      params.set(id.replace(/^dc-/, ''), v);
    });
    ATTR_SHARE_KEYS.forEach(function (k) {
      var el = document.querySelector(k.selector);
      if (el && el.value) params.set(k.param, el.value);
    });
    var provenance = _provenanceMap();
    if (provenance) params.set('inputProvenance', JSON.stringify(provenance));
    var tr = _exportedTranches();
    if (tr) params.set('tr', tr);
    if (_dealMode() === 'rental' && window.__DealCalc && window.__DealCalc.getUtilityAllowanceMetadata) {
      params.set('utilityAllowance', JSON.stringify(window.__DealCalc.getUtilityAllowanceMetadata()));
      if (window.__DealCalc.getRentScheduleMetadata) params.set('rentSchedule', JSON.stringify(window.__DealCalc.getRentScheduleMetadata()));
    }
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
    if (window.__DealCalc && window.__DealCalc.beginSharedScenario) window.__DealCalc.beginSharedScenario();
    try { _sharedProvenance = JSON.parse(params.get('inputProvenance')); } catch (_) { _sharedProvenance = null; }
    // Cost lines saved before the DOH layout load into the DOH lines that hold them.
    var cbm = window.DealCostBasis;
    if (cbm && cbm.legacyCostFields) {
      var legacy = cbm.legacyCostFields(function (key) { return params.has(key) ? params.get(key) : null; });
      Object.keys(legacy).forEach(function (key) { params.set(key, legacy[key]); });
    }
    var obm = window.DealOperatingBudget;
    if (obm && obm.legacyOperatingFields) {
      var legacyOp = obm.legacyOperatingFields(function (key) { return params.has(key) ? params.get(key) : null; });
      Object.keys(legacyOp).forEach(function (key) { params.set(key, legacyOp[key]); });
      if (obm.legacyOperatingProvenance) _sharedProvenance = obm.legacyOperatingProvenance(_sharedProvenance, legacyOp);
    }
    shareKeys().forEach(function (id) {
      var key = id.replace(/^dc-/, '');
      if (params.has(key)) _writeVal(id, params.get(key));
    });
    if (window.__DealCalc && window.__DealCalc.setSharedUtilityAllowance) {
      var allowance = null;
      if (params.has('utilityAllowance')) {
        try { allowance = JSON.parse(params.get('utilityAllowance')) || {}; } catch (_) { allowance = {}; }
      }
      window.__DealCalc.setSharedUtilityAllowance(allowance, {
        countyFips: params.get('county-select'), regime: params.get('rent-limit-regime')
      });
    }
    if (window.__DealCalc && window.__DealCalc.setSharedRentSchedule) {
      var schedule = null;
      if (params.has('rentSchedule')) {
        try { schedule = JSON.parse(params.get('rentSchedule')) || {}; } catch (_) { schedule = {}; }
      } else {
        // Legacy links carried a manual grid. Preserve it and the D2 allowance lookup.
        var preference = _getEl('dc-unit-mix-source');
        if (preference) preference.value = 'manual';
      }
      window.__DealCalc.setSharedRentSchedule(schedule, {
        countyFips: params.get('county-select'), regime: params.get('rent-limit-regime')
      });
    }
    if (window.__DealCalc && window.__DealCalc.endSharedScenario) window.__DealCalc.endSharedScenario();
    // Verify after values and independently loaded sources have settled. Late
    // source loads re-check the claim when their own markData call runs.
    if (_sharedProvenance && window.InputProvenance) window.InputProvenance.restore(_sharedProvenance);
    if (params.has('tr')) _applyTranches(params.get('tr'));
    // The resale picker is re-rendered by each recalculate, so it is looked up
    // afresh for each key, after the id-keyed inputs have settled.
    ATTR_SHARE_KEYS.forEach(function (k) {
      if (!params.has(k.param)) return;
      _whenOptionExists(function () { return document.querySelector(k.selector); }, params.get(k.param));
    });
    // Surface that the scenario came from a URL so the user knows it's not
    // their saved defaults.
    var opened = null;
    try { opened = sessionStorage.getItem(OPENED_KEY); sessionStorage.removeItem(OPENED_KEY); } catch (_) { opened = null; }
    setTimeout(function () {
      _showShareToast(opened ? 'Opened ' + opened + ' ✓' : 'Scenario hydrated from URL ✓', 'info');
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

  // ── Outputs carried in the JSON export ──────────────────────────────
  // The figures a reader acts on, per mode. Values are the text the page
  // displays ("$291,723", "1.15x"); an output the page shows as "—", leaves
  // empty, hides, or does not render is null — never 0, which would read as
  // a computed zero (AGENTS.md: an unmeasurable quantity is null).
  // Ownership exports carry no rental output (PC-2).
  // ── Public — Download deal file (the Export JSON snapshot) ──────────────────────────────────────────────
  function buildReportMeta(result) {
    return window.DealCalculatorReportMeta ? window.DealCalculatorReportMeta.buildReportMeta(result)
      : { unavailableReason: 'The report metadata module is unavailable.' };
  }
  function buildSnapshot() {
    var result = window.__DealCalc && window.__DealCalc.getResult ? window.__DealCalc.getResult() : null;
    var snapshot = {
      exportedAt: new Date().toISOString(),
      dealMode: _dealMode(),
      url: window.location.origin + window.location.pathname + '?' + _serialize().toString(),
      inputProvenance: _provenanceMap(),
      reportMeta: buildReportMeta(result),
      inputs: {},
      tranches: [],
      // Added after `inputs`; importers that read only inputs/tranches are
      // unaffected. Unrounded values, presentation and reasons travel together.
      outputs: window.__DealCalc && window.__DealCalc.getOutputRecords
        ? window.__DealCalc.getOutputRecords(result, _dealMode()) : {}
    };
    if (snapshot.dealMode === 'rental') {
      snapshot.loanObligations = result ? result.obligations : null;
      snapshot.debtCoverage = result ? result.coverage : null;
      // DOH's Permanent Financing Sources view, as displayed.
      snapshot.permanentFinancing = window.__DealCalc && window.__DealCalc.getPermanentFinancing
        ? window.__DealCalc.getPermanentFinancing() : null;
      snapshot.dohSchedules = window.__DealCalc && window.__DealCalc.getDohSchedules
        ? window.__DealCalc.getDohSchedules() : null;
      snapshot.rentLimits = window.__DealCalc ? window.__DealCalc.getRentLimitsMetadata() : null;
      snapshot.rentSchedule = window.__DealCalc && window.__DealCalc.getRentScheduleMetadata ? window.__DealCalc.getRentScheduleMetadata() : null;
      snapshot.utilityAllowance = window.__DealCalc && window.__DealCalc.getUtilityAllowanceMetadata
        ? window.__DealCalc.getUtilityAllowanceMetadata() : { applied: false, reason: 'subject_project_unavailable' };
    }
    _exportedKeys().forEach(function (id) {
      var v = _readVal(id);
      if (v != null) snapshot.inputs[id.replace(/^dc-/, '')] = v;
    });
    ATTR_SHARE_KEYS.forEach(function (k) {
      var el = document.querySelector(k.selector);
      if (el && el.value) snapshot.inputs[k.param] = el.value;
    });
    var trStr = _exportedTranches();
    if (trStr) {
      snapshot.tranches = trStr.split(';').map(function (s) {
        var p = s.split(':');
        return {
          program: p[0], amount: p[1], mode: p[2], rate: p[3], term: p[4],
          cashflowPayPct: p[5], accrueMode: p[6], priority: p[7], loanType: p[8], maturity: p[9], ioYears: p[10],
          fundSource: p[11] || null, doh: p[12] === undefined ? null : p[12],
          activity: p[13] || null, status: p[14] || null, stateRequest: p[15] ? p[15] === 'yes' : null
        };
      });
    }
    return snapshot;
  }

  // The deal file is this snapshot. Its `url` query is the deal: Open deal
  // file, Deal workbook and Submittal review all reload from it, and the
  // results are recomputed on opening, never read back from the file.
  function exportJson() {
    try {
      var snapshot = buildSnapshot();
      var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'deal-' + snapshot.exportedAt.slice(0, 10) + '.coho.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      _showShareToast('Deal file downloaded ✓');
    } catch (e) {
      console.warn('[DealCalc] JSON export failed', e);
      _showShareToast('Deal file download failed — see console', 'warn');
    }
  }

  // ── Public — Open deal file ───────────────────────────────────────────
  // The calculator settings a deal file carries, or null when it is not one.
  function dealFileQuery(snap) {
    if (!snap || typeof snap !== 'object' || !snap.inputs || typeof snap.inputs !== 'object' || typeof snap.url !== 'string') return null;
    var u;
    try { u = new URL(snap.url, window.location.href); } catch (_) { return null; }
    if (!/(^|\/)deal-calculator(\.html)?$/.test(u.pathname)) return null;
    var query = u.search.replace(/^\?/, '');
    return query ? query : null;
  }
  var OPENED_KEY = 'dc-opened-deal-file';
  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  // Reloads this page with the file's settings, so the deal opens exactly as a
  // share link does, on this address (the public site or the member site).
  function openDealFile(file) {
    if (!file) return Promise.resolve(false);
    if (file.size > MAX_FILE_BYTES) { _showShareToast('That file is too large to be a deal file.', 'warn'); return Promise.resolve(false); }
    return file.text().then(function (text) {
      var snap = null;
      try { snap = JSON.parse(text); } catch (_) { snap = null; }
      var query = dealFileQuery(snap);
      if (!query) { _showShareToast('That file is not a Deal Calculator deal file.', 'warn'); return false; }
      try { sessionStorage.setItem(OPENED_KEY, file.name); } catch (_) { /* toast falls back to the share-link wording */ }
      window.location.assign(window.location.pathname + '?' + query);
      return true;
    }, function () {
      _showShareToast('That file could not be read.', 'warn');
      return false;
    });
  }

  function buildCsv(snapshot) {
    snapshot = snapshot || buildSnapshot();
    function cell(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
    var rows = [['metric', 'value', 'display', 'unavailable_reason']];
    Object.keys(snapshot.outputs).forEach(function (key) {
      var output = snapshot.outputs[key];
      rows.push([key, output.value, output.display, output.unavailableReason]);
    });
    return rows.map(function (row) { return row.map(cell).join(','); }).join('\r\n') + '\r\n';
  }
  function exportCsv() {
    var blob = new Blob([buildCsv()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'deal-calculator-outputs.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    _showShareToast('CSV downloaded ✓');
  }

  function reportSections(report) {
    return report.unavailableReason
      ? [{ key: 'unavailable', heading: 'Report disclosures', entries: [{ text: 'unavailable — ' + report.unavailableReason, fieldIds: [] }] }]
      : window.DealCalculatorReportMeta.sections(report);
  }
  function printReport(report) {
    var id = 'dc-print-report-meta', block = document.getElementById(id);
    if (!block) {
      block = document.createElement('section'); block.id = id;
      document.body.appendChild(block);
      var style = document.createElement('style');
      style.textContent = '#' + id + '{display:none} @media print { #' + id +
        '{display:block!important;break-before:page;color:#000;background:#fff;font:11pt/1.4 sans-serif}' +
        '#' + id + ' h2{break-after:avoid} #' + id + ' p{white-space:pre-wrap;overflow-wrap:anywhere;break-inside:auto} }';
      document.head.appendChild(style);
    }
    block.replaceChildren();
    reportSections(report).forEach(function (section) {
      var heading = document.createElement('h2'); heading.textContent = section.heading; block.appendChild(heading);
      (section.entries.length ? section.entries : [{ text: section.empty }]).forEach(function (entry) {
        var paragraph = document.createElement('p'); paragraph.textContent = entry.text; block.appendChild(paragraph);
      });
    });
    window.print();
  }
  function appendReportPages(pdf, report) {
    var margin = 40, pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    var y = margin;
    pdf.addPage();
    function write(text, size) {
      pdf.setFontSize(size);
      // Standard PDF fonts do not cover these mathematical Unicode glyphs.
      var printable = String(text).replace(/[‐‑‒–—−]/g, '-').replace(/≤/g, '<=').replace(/≥/g, '>=');
      pdf.splitTextToSize(printable, pageW - margin * 2).forEach(function (line) {
        if (y + size > pageH - margin) { pdf.addPage(); y = margin; }
        pdf.text(line, margin, y); y += size * 1.4;
      });
      y += 8;
    }
    reportSections(report).forEach(function (section) {
      if (y + 50 > pageH - margin) { pdf.addPage(); y = margin; }
      write(section.heading, 14);
      (section.entries.length ? section.entries : [{ text: section.empty }]).forEach(function (entry) { write(entry.text, 10); });
    });
  }

  // ── Public — Export PDF (html2canvas + jsPDF; print fallback) ─────────
  async function exportPdf(filename) {
    var outFile = filename || 'deal-calculator-scenario.pdf';
    var btn = document.getElementById('dc-share-pdf');
    var snapshot;
    try {
      snapshot = buildSnapshot();
      if (btn) btn.disabled = true;
      if (!window.html2canvas || !window.jspdf) {
        _showShareToast('PDF libs not loaded — using print dialog', 'warn');
        printReport(snapshot.reportMeta);
        return;
      }
      _showShareToast('Generating PDF…', 'info');
      var jsPDF = window.jspdf.jsPDF;
      var node = document.querySelector('main') || document.body;
      var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
      var rentLimits = snapshot.rentLimits;
      var canvas = await window.html2canvas(node, { scale: 1.5, useCORS: true, backgroundColor: bg });
      var pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });
      if (rentLimits && typeof pdf.setProperties === 'function') {
        pdf.setProperties({ subject: JSON.stringify({ rentLimits: rentLimits, utilityAllowance: snapshot.utilityAllowance, rentSchedule: snapshot.rentSchedule }) });
      }
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      // One page-sized JPEG slice per page. The calculator is about 28,000
      // px tall; one PNG of all of it, placed again on every page, was
      // larger than the PDF writer can hold, so the download always fell
      // back to the print dialog.
      var sliceH = Math.floor(canvas.width * (pageH / pageW));
      for (var top = 0, pageNo = 0; top < canvas.height; top += sliceH, pageNo++) {
        var h = Math.min(sliceH, canvas.height - top);
        var slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = h;
        var sctx = slice.getContext && slice.getContext('2d');
        if (!sctx) {
          // No 2D canvas (a test DOM): place the whole capture, offset per page.
          if (pageNo > 0) pdf.addPage();
          pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, -top * (pageW / canvas.width), pageW, canvas.height * (pageW / canvas.width));
          continue;
        }
        sctx.fillStyle = bg || '#ffffff';
        sctx.fillRect(0, 0, slice.width, h);
        sctx.drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
        if (pageNo > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pageW, h * (pageW / canvas.width));
      }
      appendReportPages(pdf, snapshot.reportMeta);
      pdf.save(outFile);
      _showShareToast('PDF downloaded ✓');
    } catch (e) {
      console.warn('[DealCalc] PDF export failed; falling back to print()', e);
      _showShareToast('PDF generation failed — using print dialog', 'warn');
      printReport(snapshot ? snapshot.reportMeta : buildReportMeta());
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── F214 — Open IC Summary with geoid + back-link to this scenario ─
  function openIcSummary() {
    try {
      // 1. Resolve the active jurisdiction's geoid from WorkflowState.
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject &&
                 window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      var geoid = jx && (jx.geoid || jx.fips || '').replace(/\D/g, '');
      if (!geoid) {
        _showShareToast('⚠ No active jurisdiction. Pick one in HNA or Deal Calc first.', 'warn');
        return;
      }
      // 2. Encode the current Deal Calc URL (with serialized scenario)
      //    as a `dc` back-link so IC Summary can render a "View deal
      //    underwriting" pill that takes the reader back here.
      var dcUrl = window.location.origin + window.location.pathname + '?' + _serialize().toString();
      var icParams = new URLSearchParams();
      icParams.set('geoid', geoid);
      icParams.set('dc', dcUrl);
      var icUrl = window.location.origin + window.location.pathname.replace(/deal-calculator\.html$/, 'ic-summary.html') + '?' + icParams.toString();
      // 3. Open in a new tab so the user keeps the Deal Calc state alive.
      window.open(icUrl, '_blank', 'noopener');
    } catch (e) {
      console.warn('[DealCalc] openIcSummary failed', e);
      _showShareToast('IC Summary open failed — see console', 'warn');
    }
  }

  // ── Wire buttons + hydrate on DOM ready ───────────────────────────────
  function _initButtons() {
    var btnCopy = document.getElementById('dc-share-copy');
    var btnPdf  = document.getElementById('dc-share-pdf');
    var btnJson = document.getElementById('dc-share-json');
    var btnIc   = document.getElementById('dc-share-ic');
    if (btnCopy) btnCopy.addEventListener('click', copyLink);
    if (btnPdf)  btnPdf.addEventListener('click', function () { exportPdf(); });
    if (btnJson) btnJson.addEventListener('click', exportJson);
    var btnOpen = document.getElementById('dc-share-open'), fileIn = document.getElementById('dc-open-file');
    if (btnOpen && fileIn) {
      btnOpen.addEventListener('click', function () { fileIn.value = ''; fileIn.click(); });
      fileIn.addEventListener('change', function () { openDealFile(fileIn.files && fileIn.files[0]); });
    }
    var btnCsv = document.getElementById('dc-share-csv');
    if (btnCsv) btnCsv.addEventListener('click', exportCsv);
    if (btnIc)   btnIc.addEventListener('click', openIcSummary);
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
  window.__DealCalcShare = { copyLink: copyLink, exportPdf: exportPdf, exportJson: exportJson, openDealFile: openDealFile, dealFileQuery: dealFileQuery, exportCsv: exportCsv, buildCsv: buildCsv, openIcSummary: openIcSummary, buildSnapshot: buildSnapshot, buildReportMeta: buildReportMeta,
    shareKeys: shareKeys, auditInputs: auditInputs, serialize: function () { return _serialize().toString(); },
    hydrate: _hydrate };
})();
