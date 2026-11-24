/**
 * js/components/calc-financials-link.js
 * deal-calculator.html.
 *
 * Puts "Continue in Financials" under the Deal Calculator. The link opens the Deal hub's #/open-calc route with the
 * calculator's own share-link parameters, which the hub shows first and then opens as a new project on Financials.
 * Nothing is saved before that click.
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

  function params() {
    var share = window.__DealCalcShare;
    if (!share || typeof share.buildSnapshot !== 'function') return null;
    var url = share.buildSnapshot().url || '';
    var q = url.indexOf('?');
    if (q < 0) return null;
    var out = url.slice(q + 1);
    // The subject project on this page (homes, sizes, AMI targets, utility allowance basis). A deal whose homes come
    // from the Market Analysis rent schedule cannot be priced from the share settings alone: the hub reruns this
    // subject on its own rent-limit code, attaches it as the scenario's homes, and says whether the rerun matches
    // the link's rentSchedule rows.
    var sp = window.SubjectProject;
    if (sp && typeof sp.get === 'function') {
      try { var subject = sp.get(); if (subject) out += '&subject=' + encodeURIComponent(JSON.stringify(subject)); } catch (_) {}
    }
    return out;
  }

  function refresh(a) {
    var p = params();
    if (p == null) return false;
    a.href = ROUTE + p;
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
    a.textContent = 'Continue in Financials';
    a.setAttribute('aria-describedby', 'maCalcHandoffNote');
    refresh(a);
    // The address is built when it is used, so it carries the numbers on screen at that moment.
    ['pointerdown', 'focus', 'mouseenter', 'contextmenu', 'click'].forEach(function (ev) {
      a.addEventListener(ev, function () { refresh(a); });
    });
    var note = document.createElement('span');
    note.id = 'maCalcHandoffNote';
    note.className = 'ma-calc-handoff-note';
    note.textContent = 'The Deal hub shows what it received first; nothing is saved until you open it as a project.';
    p.appendChild(a);
    p.appendChild(document.createTextNode(' '));
    p.appendChild(note);
    mount.parentNode.insertBefore(p, mount.nextSibling);
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
