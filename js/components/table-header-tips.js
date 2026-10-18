/**
 * table-header-tips.js — a visible, accessible definition for every table
 * column header on the site.
 *
 * Why: most headers already carried a native `title` attribute, but a
 * native title is invisible until the pointer rests on it for a second,
 * never appears on touch, and gives no hint that a definition exists — so
 * a header like "NEED PCTL" (the global `table th` rule uppercases labels)
 * read as jargon with no way in. A header with a definition now gets a
 * dotted underline on its label (the same signal glossary terms use in body
 * text); hovering the header or focusing it shows the definition in a
 * popover, linked with aria-describedby for screen readers. On touch, where
 * there is no hover, a tap on the label opens it and does not sort — the
 * sort arrow from table-sort.js is the separate touch target. (Until
 * 2026-10-18 the trigger was a separate circled "i" glyph; paul asked for
 * the header itself to carry the tip because the glyph read as clutter.)
 *
 * Where the text comes from, in order:
 *   1. the header's own `title` attribute (moved to data-tip so the native
 *      tooltip does not double up with the popover)
 *   2. a `data-tip` attribute set by the page or renderer
 *   3. data/table-header-tips.json — definitions keyed by the header's
 *      normalized text, for static headers nobody hand-annotated
 *
 * Runs once on load and again whenever a table is inserted or re-rendered
 * (MutationObserver), so JS-built tables (ranking index, county comparison,
 * projections, deal calculator) are covered without each renderer knowing
 * this exists. Idempotent: a header that already has its control is left
 * alone. Headers with no text (blank corner cells), or that contain a form
 * control or a link of their own, are skipped.
 */
(function () {
  'use strict';

  var MAP_PATH = 'data/table-header-tips.json';
  var map = null;
  var counter = 0;
  var lastPointerTouch = false;
  document.addEventListener('pointerdown', function (e) { lastPointerTouch = e.pointerType === 'touch' || e.pointerType === 'pen'; }, true);

  function normalize(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[▲▼↑↓⇅↕?]+\s*$/, '')
      .trim()
      .toLowerCase();
  }

  function fetchMap() {
    var DS = window.DataService;
    var p = DS && typeof DS.getJSON === 'function'
      ? DS.getJSON(DS.baseData ? DS.baseData('table-header-tips.json') : MAP_PATH)
      : fetch(MAP_PATH).then(function (r) { return r.ok ? r.json() : {}; });
    return p.then(function (j) { return (j && j.tips) || j || {}; }).catch(function () { return {}; });
  }

  function tipFor(th) {
    var own = th.getAttribute('data-tip');
    if (own) return own;
    var title = th.getAttribute('title');
    if (title) {
      // Move it: the popover replaces the native tooltip rather than
      // stacking on top of it.
      th.setAttribute('data-tip', title);
      th.removeAttribute('title');
      return title;
    }
    var key = normalize(th.textContent);
    if (map && key && Object.prototype.hasOwnProperty.call(map, key)) return map[key];
    return null;
  }

  // Tables sit in scrolling containers that clip anything absolutely
  // positioned, so the popover is placed in viewport coordinates under its
  // header and kept on screen: a right-hand column on a phone no longer
  // opens a definition that runs off the edge.
  var GAP = 8;
  function place(th) {
    var pop = th.querySelector('.th-tip__pop');
    if (!pop) return;
    var r = th.getBoundingClientRect();
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = window.innerHeight;
    pop.style.maxWidth = Math.min(352, vw - 2 * GAP) + 'px';
    pop.classList.add('th-tip__pop--placed');
    var w = pop.offsetWidth || 224;
    var h = pop.offsetHeight || 0;
    var left = Math.max(GAP, Math.min(r.left, vw - w - GAP));
    var top = r.bottom + 4;
    if (h && top + h > vh - GAP && r.top - 4 - h >= GAP) top = r.top - 4 - h;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function decorate(th) {
    if (th.querySelector('.th-tip__label')) return;
    if (th.querySelector('input, select, textarea, button:not(.th-sort)')) return;
    // A header that already links to its own explanation (the footnote
    // daggers on chfa-portfolio.html) keeps that link as its one control:
    // making the label a second tap target would compete with the link for
    // the same pixels (Codex on #2239).
    // Its definition still rides on the header as a native title, which
    // table-export.js reads for the downloaded data dictionary.
    if (th.querySelector('a[href]')) {
      if (!th.getAttribute('title') && !th.getAttribute('data-tip')) {
        var def = map && Object.prototype.hasOwnProperty.call(map, normalize(th.textContent)) ? map[normalize(th.textContent)] : null;
        if (def) th.setAttribute('title', def);
      }
      return;
    }
    if (!normalize(th.textContent)) return;
    var tip = tipFor(th);
    if (!tip) return;

    var id = 'thtip-' + (++counter);

    var pop = document.createElement('span');
    pop.className = 'th-tip__pop';
    pop.id = id;
    pop.setAttribute('role', 'tooltip');
    pop.textContent = tip;

    th.addEventListener('mouseenter', function () { place(th); });
    th.addEventListener('focusin', function () { place(th); });

    // The label itself carries the definition: a dotted underline marks
    // it, hover or keyboard focus shows it. On touch there is no hover, so
    // a tap anywhere on the header opens it (the whole cell is the target,
    // at least 44px tall) and does not sort; the sort arrow from
    // table-sort.js is the separate touch target.
    var label = document.createElement('span');
    label.className = 'th-tip__label';
    var kids = [];
    for (var n = th.firstChild; n; n = n.nextSibling) if (!(n.classList && n.classList.contains('th-sort'))) kids.push(n);
    kids.forEach(function (k) { label.appendChild(k); });
    th.insertBefore(label, th.querySelector('.th-sort'));
    th.addEventListener('click', function (e) {
      // The arrow's header click (table-sort.js) is not a tap on the label.
      if (e.thSortArrow || !lastPointerTouch || (e.target.closest && e.target.closest('.th-sort'))) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      var open = th.classList.toggle('is-open');
      if (open) place(th);
    }, true);
    th.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') th.classList.remove('is-open');
    });

    th.classList.add('th-tip');
    th.setAttribute('aria-describedby', id);
    if (!th.hasAttribute('tabindex')) th.setAttribute('tabindex', '0');
    th.appendChild(pop);
  }

  function decorateAll(root) {
    var ths = (root || document).querySelectorAll('th');
    for (var i = 0; i < ths.length; i++) decorate(ths[i]);
  }

  // Tap outside closes any open popover (touch has no hover-out).
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.th-tip')) return;
    var open = document.querySelectorAll('.th-tip.is-open');
    for (var i = 0; i < open.length; i++) {
      open[i].classList.remove('is-open');
    }
  });

  // Keep a visible popover attached to its header while the page or the
  // table's own container scrolls.
  window.addEventListener('scroll', function () {
    var shown = document.querySelectorAll('th.th-tip.is-open, th.th-tip:hover, th.th-tip:focus-within');
    for (var i = 0; i < shown.length; i++) place(shown[i]);
  }, { capture: true, passive: true });

  function observe() {
    if (!window.MutationObserver) return;
    var pending = false;
    var obs = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; decorateAll(); }, 50);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    fetchMap().then(function (m) {
      map = m;
      decorateAll();
      observe();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TableHeaderTips = { normalize: normalize, decorateAll: decorateAll };
})();
