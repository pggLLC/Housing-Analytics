/*
 * The report's own row of section links on deal-market-analysis.html (.ma-section-nav, carried from
 * market-analysis.html), made easier to use on a long page (paul, 18 Nov 2026: "do the small and low risk"):
 *
 *   1. Three more stops inside the market-area tool, where most of the reading happens: the site score, the
 *      affordable homes already in the area, and the capture simulator. They go just after "PMA Delineation".
 *      Each is found by an id the page already has, and left out when the page no longer has it.
 *   2. A jump keeps the address as it is. The page keeps the market area in the address hash (#pma=..., written by
 *      js/pma-ui-controller.js), and a plain #section link replaced it, so a reload or a copied link after a jump
 *      lost a site placed on the map. The row now scrolls to the section without touching the address.
 *   3. The section on screen is marked in the row (the .active style the page's sheet already has, plus
 *      aria-current for screen readers).
 *
 * Navigation only: it moves, hides and recalculates nothing, and every link still goes where it went.
 */
(function () {
  'use strict';
  var nav = document.querySelector('.ma-section-nav');
  var list = nav && nav.querySelector('.ma-section-nav-list');
  if (!list) return;

  // [label, element inside the card]. The jump goes to the card around it.
  var EXTRA = [
    ['Site score', 'pmaScoreWrap'],
    ['Supply in the area', 'pmaAffordableCount'],
    ['Capture', 'pmaProposedUnits']
  ];
  var first = list.querySelector('a[href="#maPmaTool"]');
  var after = first && first.closest('li');
  EXTRA.forEach(function (x) {
    var inner = document.getElementById(x[1]);
    var card = inner && (inner.closest('.pma-card') || inner);
    if (!card || !after) return;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'ma-section-nav-link';
    a.href = '#' + x[1];
    a.textContent = x[0];
    a.setAttribute('data-ma-card', x[1]);
    li.appendChild(a);
    after.parentNode.insertBefore(li, after.nextSibling);
    after = li;
  });

  var links = Array.prototype.slice.call(list.querySelectorAll('a.ma-section-nav-link'));
  function targetOf(a) {
    var card = a.getAttribute('data-ma-card');
    if (card) { var n = document.getElementById(card); return n && (n.closest('.pma-card') || n); }
    var id = (a.getAttribute('href') || '').slice(1);
    return id ? document.getElementById(id) : null;
  }
  // A card hidden until the analysis runs has no box: the jump goes to the nearest part of the page that shows.
  function shown(n) {
    while (n && n !== document.body && !n.getClientRects().length) n = n.parentElement;
    return n && n !== document.body ? n : null;
  }
  function px(name) {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return isFinite(v) ? v : 0;
  }
  // The top of the screen the sticky rows cover: this row's own bottom edge while it sticks.
  function cover() {
    var r = nav.getBoundingClientRect();
    return Math.max(r.bottom, px('--hdr-h') + px('--sp-top'));
  }

  nav.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a.ma-section-nav-link');
    if (!a || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button > 0) return;
    var t = shown(targetOf(a));
    if (!t) return;
    ev.preventDefault();
    // Two steps: the row and the step bar's slim line only stick once the page has scrolled, so the first jump
    // measures them stuck and the second, a frame later, settles the section just under them.
    // Instant, both times: the tool's theme sets html { scroll-behavior: smooth }, and a smooth first scroll would still
    // be moving when the second measures (Codex P2 on #2943).
    var land = function () { window.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top + window.pageYOffset - cover() - 12), behavior: 'instant' }); };
    land();
    requestAnimationFrame(function () { requestAnimationFrame(land); });
    if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (_) { /* older browsers */ }
  });

  var queued = false;
  function mark() {
    queued = false;
    // The section whose top has most recently passed under the row (the three cards sit inside the first section).
    var line = cover() + 24, best = -1, bestTop = -Infinity;
    links.forEach(function (a, i) {
      var t = shown(targetOf(a)); if (!t) return;
      var top = t.getBoundingClientRect().top;
      if (top <= line && top > bestTop) { bestTop = top; best = i; }
    });
    var at = best;
    links.forEach(function (a, i) {
      var on = i === at;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    // On a phone the row scrolls sideways: keep the marked link in view.
    var cur = links[at];
    if (cur && list.scrollWidth > list.clientWidth) {
      var lr = list.getBoundingClientRect(), cr = cur.getBoundingClientRect();
      if (cr.left < lr.left || cr.right > lr.right) list.scrollLeft += cr.left - lr.left - 16;
    }
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(mark); } }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  queue();
})();
