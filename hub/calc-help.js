// Hover help on Financials (calculator move, piece E): what the full Deal Calculator page explains on hover.
//
// 1. What each box is. The live page puts a button under every box whose note gives the box's definition from
//    js/deal-calculator-input-registry.js. That file is loaded here unchanged, and each box with a definition gets a
//    small "?" beside its label (or, in the cost and operating tables, a tip on the column heading). The live note's
//    other lines (worked example, assumption, not yet verified) describe the live page's own invented starting
//    values; Financials starts blank or from the tool's stated defaults, and its own tag under each box says who
//    sets it, so only the definition is carried.
// 2. Glossary terms and column heading tips, as on the live page (js/components/inline-glossary.js and
//    js/components/table-header-tips.js): the guide pages' own code (site/guide.js hoverHelp) reads the same two
//    files and marks each term at its first use.
// Every tip opens on hover, keyboard focus or a tap, and closes with Escape or a tap elsewhere (site/guide.js).
(function (global) {
  'use strict';
  var PATH = 'js/deal-calculator-input-registry.js';
  var main = document.getElementById('main');
  if (!main) return;
  var reg = null;     // null: not asked; 'loading'; 'failed'; 'ready'

  function onFinancials() { return /^#\/financials\//.test(location.hash || ''); }

  // A Financials box's name, as the live page names the same box (its id in the registry).
  var TRANCHE = { program: 'prog', amount: 'amount', loanType: 'type', rate: 'rate', term: 'term', maturity: 'maturity', ioYears: 'io',
    cashflowPayPct: 'cfpay', priority: 'priority', fundSource: 'fed', doh: 'doh', activity: 'activity', status: 'status', stateRequest: 'state' };
  function liveId(name) {
    var m;
    if ((m = /^cost:([a-z_]+)$/.exec(name))) return 'dc-cost-' + m[1];
    if ((m = /^basis:([a-z_]+)$/.exec(name))) return 'dc-cost-' + m[1] + '-basis';
    if ((m = /^part:([a-z_]+)$/.exec(name))) return 'dc-cost-' + m[1] + '-eligible';
    if ((m = /^used:([a-z_]+)$/.exec(name))) return 'dc-cost-' + m[1] + '-used';
    if ((m = /^opinc:([a-z_]+)$/.exec(name))) return 'dc-op-income-' + m[1];
    if ((m = /^op:([a-z_]+)$/.exec(name))) return 'dc-op-' + m[1];
    if ((m = /^tr:\d+:([A-Za-z]+)$/.exec(name))) return TRANCHE[m[1]] ? 'tranche-' + TRANCHE[m[1]] : null;
    // Every other box already carries the live id as its name (dc-..., and the pro forma's pf-...).
    return /^[a-z]+-[a-z0-9-]+$/.test(name) ? name : null;
  }
  function definition(name) {
    var R = global.DealCalculatorInputRegistry, id = liveId(name), f = R && id && R.get(id);
    return f && f.definition ? f.definition : null;
  }

  function loadRegistry() {
    if (reg) return;
    if (global.DealCalculatorInputRegistry) { reg = 'ready'; return; }
    reg = 'loading';
    var el = document.createElement('script');
    el.src = (global.LAB_VENDOR || '') + PATH;
    el.onload = function () { reg = global.DealCalculatorInputRegistry ? 'ready' : 'failed'; soon(); };
    el.onerror = function () { reg = 'failed'; };
    document.body.appendChild(el);
  }

  function marker(def) {
    var s = document.createElement('span');
    s.className = 'fin-help'; s.setAttribute('tabindex', '0'); s.setAttribute('role', 'button');
    s.setAttribute('aria-label', 'What this box is'); s.setAttribute('data-gtip', def); s.textContent = '?';
    return s;
  }
  // The boxes the live page explains: text, number and choice boxes (not ticks, choices of one, or sliders).
  var SKIP_TYPE = /^(hidden|checkbox|radio|range|button|submit|search)$/;
  function fields(root) {
    var n = 0;
    Array.prototype.forEach.call(root.querySelectorAll('form[data-action="financials"] [name]'), function (el) {
      if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || SKIP_TYPE.test(el.type || '')) return;
      var def = definition(el.name);
      if (!def) return;
      var label = el.closest('label');
      if (label) {
        if (label.classList.contains('check')) return;
        var first = label.firstChild, holder = label.firstElementChild;
        if (holder && holder.tagName === 'SPAN' && !holder.contains(el) && first === holder) {
          if (!holder.querySelector('.fin-help')) { holder.appendChild(document.createTextNode(' ')); holder.appendChild(marker(def)); n++; }
        } else if (first && first.nodeType === 3 && first.nodeValue.trim()) {
          if (!(first.nextSibling && first.nextSibling.classList && first.nextSibling.classList.contains('fin-help'))) { label.insertBefore(marker(def), first.nextSibling); n++; }
        }
        return;
      }
      // In a table: the column heading says what the column's boxes are; a row whose box means something else
      // (other income in the operating table) says it beside the row's name.
      // The unit grid's own row boxes are named "Homes at 30% AMI" and "Size of the homes at 30% AMI", the live
      // definition in other words, so they carry no "?" (the split cells, in labels, do).
      var td = el.closest('td'), table = td && td.closest('table'), head = table && table.tHead && table.tHead.rows[0];
      var th = head && head.cells[td.cellIndex];
      if (!th) return;
      if (!th.hasAttribute('data-help-def')) {
        th.setAttribute('data-help-def', def);
        if (!th.hasAttribute('data-gtip')) { th.setAttribute('data-gtip', def); th.classList.add('g-tip'); if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0'); n++; }
      }
      if (th.getAttribute('data-help-def') !== def) {
        var cell = td.parentNode.cells[0];
        if (cell && cell !== td && !cell.querySelector('.fin-help')) { cell.appendChild(document.createTextNode(' ')); cell.appendChild(marker(def)); n++; }
      }
    });
    return n;
  }

  // Glossary terms and heading tips: once per page drawing, then for any part a late load draws again.
  var files = null, asking = false;
  function glossary() {
    var G = global.LabGuide;
    if (!G || !G.hoverHelp) return;
    if (!files) {
      if (asking) return;
      asking = true;
      G.helpFiles(function (F) { files = F; asking = false; soon(); });
      return;
    }
    var h1 = main.querySelector('h1');
    if (h1 && main.__helpFor !== h1) {
      main.__helpFor = h1;
      main.removeAttribute('data-help');
      G.hoverHelp(main, files, true);
      Array.prototype.forEach.call(main.querySelectorAll('section'), function (s) { s.setAttribute('data-help', '1'); });
      return;
    }
    Array.prototype.forEach.call(main.querySelectorAll('section:not([data-help])'), function (s) { G.hoverHelp(s, files, true); });
  }

  function apply() {
    if (!onFinancials() || !main.querySelector('form[data-action="financials"]')) { main.removeAttribute('data-hover-help'); main.__helpFor = null; return; }
    main.setAttribute('data-hover-help', 'financials');
    // The tips open from the "?" whether or not the glossary files have come (site/guide.js).
    if (global.LabGuide && global.LabGuide.wireTips) global.LabGuide.wireTips();
    glossary();
    loadRegistry();
    if (reg === 'ready') fields(main);
  }
  var queued = false;
  function soon() {
    if (queued) return;
    queued = true;
    (global.requestAnimationFrame || setTimeout)(function () { queued = false; apply(); });
  }
  new MutationObserver(soon).observe(main, { childList: true, subtree: true });
  global.addEventListener('hashchange', soon);

  // A tap on a tip inside a label opens the tip; it does not move the cursor into the box (the label would).
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-hover-help] [data-gtip]');
    if (t && t.closest('label')) ev.preventDefault();
  }, true);

  global.LabCalcHelp = { liveId: liveId, definition: definition, fields: fields, apply: apply, _state: function () { return { reg: reg, files: !!files }; } };
})(window);
