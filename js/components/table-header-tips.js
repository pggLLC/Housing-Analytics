/**
 * table-header-tips.js — a visible, accessible definition for every table
 * column header on the site.
 *
 * Why: most headers already carried a native `title` attribute, but a
 * native title is invisible until the pointer rests on it for a second,
 * never appears on touch, and gives no hint that a definition exists — so
 * a header like "NEED PCTL" (the global `table th` rule uppercases labels)
 * read as jargon with no way in. Every <th> now gets a small "?" control;
 * hover, focus or tap shows the definition in a popover, and the popover
 * is linked to the header with aria-describedby for screen readers.
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
 * alone. Headers with no text (blank corner cells) or that contain a form
 * control are skipped.
 */
(function () {
  'use strict';

  var MAP_PATH = 'data/table-header-tips.json';
  var map = null;
  var counter = 0;

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

  function decorate(th) {
    if (th.querySelector('.th-tip__btn')) return;
    if (th.querySelector('input, select, button, textarea')) return;
    if (!normalize(th.textContent)) return;
    var tip = tipFor(th);
    if (!tip) return;

    var id = 'thtip-' + (++counter);
    var label = th.textContent.replace(/\s+/g, ' ').trim();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-tip__btn';
    btn.setAttribute('aria-label', 'What does "' + label + '" mean?');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    btn.textContent = '?';

    var pop = document.createElement('span');
    pop.className = 'th-tip__pop';
    pop.id = id;
    pop.setAttribute('role', 'tooltip');
    pop.textContent = tip;

    // Sortable headers sort on click; the "?" must not also sort.
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var open = th.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { th.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
    });

    th.classList.add('th-tip');
    th.setAttribute('aria-describedby', id);
    th.appendChild(btn);
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
      var b = open[i].querySelector('.th-tip__btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    }
  });

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
