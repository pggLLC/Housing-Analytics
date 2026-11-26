/**
 * js/components/calc-financials-link.js
 * deal-calculator.html.
 *
 * Puts "Continue in Financials" under the Deal Calculator. The link opens the Deal hub's #/open-calc route with the
 * calculator's own share-link parameters, which the hub shows first and then opens as a new project on Financials.
 * Nothing is saved before that click.
 *
 * In the for-sale mode the link says "Continue in Homes for sale" and opens the Deal hub's #/sale-deal screen with the
 * same parameters (mode-rental=ownership): that screen fills its county, cost, homes, buyer income, floor area and
 * resale boxes from them, makes the place the working place, and names every other box, which stays here. Financials
 * works rental deals only, so before 24 Nov 2026 a for-sale deal sent there stopped at a refusal.
 *
 * Moved here from deal-market-analysis.html (it was js/components/ma-calc-handoff.js, under the copy of the calculator
 * that page drew) in the duplicate cleanup of 24 Nov 2026: the Market Analysis pages now link to this page, so the
 * path to Financials lives with the one calculator.
 *
 * The parameters come from js/deal-calculator-share.js, loaded before this file:
 * window.__DealCalcShare.buildSnapshot().url carries exactly what "Copy link" carries (every dc- and pf- control,
 * the tranche string, input sources, utility allowance and rent schedule). Nothing here reads a calculator control
 * itself. One setting is added: subject, the page's subject project (window.SubjectProject.get()), which the hub needs
 * to price homes that come from the rent schedule.
 */
(function () {
  'use strict';

  var ROUTE = 'deal-hub.html#/open-calc?v=1&';
  var SALE_ROUTE = 'deal-hub.html#/sale-deal?v=1&';
  var TEXT = { rental: 'Continue in Financials', sale: 'Continue in Homes for sale' };
  var NOTE = {
    rental: 'The Deal hub shows what it received first; nothing is saved until you open it as a project.',
    sale: 'Opens the Deal hub’s for-sale screen with this county, cost, homes, buyer income and resale inputs; nothing is saved.'
  };
  function forSale(p) { return /(^|&)mode-rental=ownership(&|$)/.test(p); }

  function params() {
    var share = window.__DealCalcShare;
    if (!share || typeof share.buildSnapshot !== 'function') return null;
    var url = share.buildSnapshot().url || '';
    // The settings ride in the fragment ("#v=1&..."), as Copy link writes them (Codex delta check D1); a query
    // form is still read.
    var h = url.indexOf('#v=1&'), q = url.indexOf('?');
    var out = h >= 0 ? url.slice(h + 5) : q >= 0 ? url.slice(q + 1).split('#')[0] : null;
    if (!out) return null;
    // The subject project on this page (homes, sizes, AMI targets, utility allowance basis). A deal whose homes come
    // from the Market Analysis rent schedule cannot be priced from the share settings alone: the hub reruns this
    // subject on its own rent-limit code, attaches it as the scenario's homes, and says whether the rerun matches
    // the link's rentSchedule rows.
    var sp = window.SubjectProject;
    if (!forSale(out) && sp && typeof sp.get === 'function') {
      try { var subject = sp.get(); if (subject) out += '&subject=' + encodeURIComponent(JSON.stringify(subject)); } catch (_) {}
    }
    return out;
  }

  function refresh(a) {
    var p = params();
    if (p == null) return false;
    var sale = forSale(p);
    a.href = (sale ? SALE_ROUTE : ROUTE) + p;
    var k = sale ? 'sale' : 'rental';
    if (a.textContent !== TEXT[k]) a.textContent = TEXT[k];
    var note = document.getElementById('maCalcHandoffNote');
    if (note && note.textContent !== NOTE[k]) note.textContent = NOTE[k];
    return true;
  }

  function place() {
    var mount = document.getElementById('dealCalcMount');
    if (!mount || document.getElementById('maCalcHandoff')) return true;
    if (!mount.querySelector('input[id^="dc-"], select[id^="dc-"]')) return false;   // calculator not drawn yet
    if (params() == null) return false;
    var p = document.createElement('p');
    p.id = 'maCalcHandoff';
    p.className = 'ma-calc-handoff';
    var a = document.createElement('a');
    a.textContent = TEXT.rental;
    a.setAttribute('aria-describedby', 'maCalcHandoffNote');
    // The address is built when it is used, so it carries the numbers on screen at that moment.
    ['pointerdown', 'focus', 'mouseenter', 'contextmenu', 'click'].forEach(function (ev) {
      a.addEventListener(ev, function () { refresh(a); });
    });
    var note = document.createElement('span');
    note.id = 'maCalcHandoffNote';
    note.className = 'ma-calc-handoff-note';
    note.textContent = NOTE.rental;
    p.appendChild(a);
    p.appendChild(document.createTextNode(' '));
    p.appendChild(note);
    mount.parentNode.insertBefore(p, mount.nextSibling);
    refresh(a);
    // The mode switch changes where the link goes and what it says, before anyone points at it.
    document.addEventListener('change', function (ev) { if (ev.target && /^dc-mode/.test(ev.target.id || ev.target.name || '')) refresh(a); });
    return true;
  }

  function start() {
    if (place()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (place() || ++tries > 120) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
