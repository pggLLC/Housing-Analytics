/*
 * Member tools on the public Deal Calculator (paul, 26 Nov 2026, "all three": gate the calculator's lender schedules,
 * as lab #333 did for the deal workspace). On cohoanalytics.com two parts of deal-calculator.html show the site's
 * "Member" card in their place (one gold Member tag, which stays on the open part on the member site):
 *   - Lender schedules: construction to year 30 (#dc-ls-panel, js/deal-lender-schedules-view.js);
 *   - the A/B scenario comparison (Save as Scenario A / B, js/deal-comparison.js).
 * The member site (coho-backend, *.workers.dev) serves this same page and shows both. Nothing is removed: the gated
 * parts are hidden, not deleted, so a shared link or deal file still carries their inputs, and every figure the page
 * shows is the same. The card is the one hub/shell.js memberCard draws (styles in hub/shell.css .member-card).
 */
(function () {
  'use strict';
  var MEMBER_SITE = 'https://coho-backend.communityplanner.workers.dev/';

  // As hub/shell.js memberOnly: the member site shows everything; the public site (the ported pages, which load
  // hub/lab-config.js) shows the card; ?view=public asks for the public view anywhere.
  function memberOnly() {
    var host = String(location.hostname || '');
    if (/\.workers\.dev$/.test(host)) return false;
    if (/[?&]view=public(&|$)/.test(String(location.search || ''))) return true;
    return !!window.LAB_PORT;
  }
  // One gold Member tag on both parts (paul, 28 Nov 2026, "is there a tag that should show a member page?"): on the
  // public card, and kept on the open part a member sees, as hub/shell.js memberTag (styles: hub/shell.css .member-tag).
  var TAG = '<span class="member-tag">Member</span>';
  function lenderBox() { return document.getElementById('dc-ls-panel'); }
  function compareBox() { var a = document.getElementById('dcSaveAsA'), s = a && a.closest('.dc-scenario-actions'); return s && s.parentElement; }
  function observe(fn) {
    fn();
    document.addEventListener('DOMContentLoaded', fn);
    window.addEventListener('load', fn);
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; fn(); }, 0);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (!memberOnly()) {
    // The member site: each open part gets the tag first, once, each time the calculator draws it.
    observe(function () {
      [lenderBox(), compareBox()].forEach(function (box) {
        if (!box || box.querySelector(':scope > [data-member-tag]')) return;
        var p = document.createElement('p');
        p.className = 'member-tag-row';
        p.setAttribute('data-member-tag', '');
        p.innerHTML = TAG;
        box.insertBefore(p, box.firstChild);
      });
    });
    return;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function card(o) {
    var to = memberHref();
    var el = document.createElement('section');
    el.className = 'callout member-card';
    el.setAttribute('data-member-card', o.key);
    el.setAttribute('aria-labelledby', o.id);
    el.innerHTML = '<p class="ma-kicker member-tag-row">' + TAG + '</p><h2 id="' + esc(o.id) + '">' + esc(o.title) + '</h2>' +
      '<p>' + esc(o.what) + '</p><ul>' + o.gets.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' +
      '<div class="actions"><a class="button-link" data-member-signin href="' + esc(to) + '">Member sign in</a>' +
      '<a class="button-link secondary" href="mailto:info@cohoanalytics.com?subject=Member%20access">Ask about member access</a></div>';
    return el;
  }

  // The member link carries the deal as it stands now, in the same fragment "Copy link" writes
  // (js/deal-calculator-share.js: #v=1&...), so the member tools open on the deal the visitor entered. It is built
  // again when the link is used, since the inputs change after the card is drawn (Codex, HA #3019).
  function memberHref() {
    var base = MEMBER_SITE + 'deal-calculator.html';
    var share = window.__DealCalcShare;
    var q = null;
    try { q = share && share.serialize ? share.serialize() : null; } catch (e) { q = null; }
    if (q) return base + '#v=1&' + q;
    return base + String(location.search || '').replace(/([?&])view=public(&|$)/, '$1').replace(/[?&]$/, '') + String(location.hash || '');
  }
  function refresh(ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('[data-member-card] a[data-member-signin]');
    if (a) a.href = memberHref();
  }
  ['mousedown', 'click', 'auxclick', 'keydown', 'focusin', 'contextmenu'].forEach(function (t) { document.addEventListener(t, refresh, true); });

  var LENDER = {
    key: 'lender-schedules', id: 'dc-member-ls-h', title: 'Lender schedules',
    what: 'What a construction lender, a permanent lender and CHFA check, from the same deal you entered above.',
    gets: ['Month-by-month construction draws and the payoff at conversion', 'Fifteen years of coverage under stress, and the reserves', 'CHFA’s minimum assumptions, line by line, and what the property could do after the compliance period']
  };
  var COMPARE = {
    key: 'scenario-compare', id: 'dc-member-compare-h', title: 'Compare two scenarios',
    what: 'Save this deal as Scenario A and a changed copy as Scenario B, and see them side by side.',
    gets: ['Two saved versions of the deal, compared line by line', 'The change in the gap, the credit and the coverage between them']
  };

  // Hide every child of a box except the card, and put the card first. Called again when the calculator redraws.
  function gate(box, o) {
    if (!box) return;
    var c = box.querySelector(':scope > [data-member-card="' + o.key + '"]');
    if (!c) { c = card(o); box.insertBefore(c, box.firstChild); }
    Array.prototype.forEach.call(box.children, function (ch) {
      if (ch !== c && ch.style.display !== 'none') { ch.setAttribute('data-member-hidden', ''); ch.style.display = 'none'; }
    });
  }
  function run() {
    gate(lenderBox(), LENDER);
    gate(compareBox(), COMPARE);
  }

  // The calculator draws the lender schedules late and may draw them again; gate each new copy.
  observe(run);
  window.DcMemberGate = { memberOnly: memberOnly, run: run };
})();
