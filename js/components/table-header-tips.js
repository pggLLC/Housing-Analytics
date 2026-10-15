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
 * alone. Headers with no text (blank corner cells), or that contain a form
 * control or a link of their own, are skipped.
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

  // The header's own last word: a text node that is a direct child of the
  // <th> and carries more than a sort arrow. Text inside child elements is
  // left alone, because renderers rewrite those (preservation.js assigns
  // `.sort-icon.textContent` on every sort) and would delete the glyph.
  function lastOwnTextNode(th) {
    var last = null;
    for (var n = th.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /[^\s▲▼↑↓⇅↕?]/.test(n.nodeValue)) last = n;
    }
    return last;
  }

  function decorate(th) {
    if (th.querySelector('.th-tip__btn')) return;
    if (th.querySelector('input, select, button, textarea')) return;
    // A header that already links to its own explanation (the footnote
    // daggers on chfa-portfolio.html) keeps that link as its one control:
    // a second 44px target beside it would share the same pixels, so a tap
    // there would reach whichever wins hit testing (Codex on #2239).
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
    var label = th.textContent.replace(/\s+/g, ' ').trim();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-tip__btn';
    btn.setAttribute('aria-label', 'What does "' + label + '" mean?');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    // A small inline "i" glyph, sized to the label text so it sits on the
    // label's baseline. The 24px hit area comes from CSS (::before), not
    // from the glyph's layout box, so it never pushes the label around.
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true" focusable="false">'
      + '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>'
      + '<rect x="7.2" y="7" width="1.6" height="4.6" rx=".8" fill="currentColor"/>'
      + '<circle cx="8" cy="4.6" r="1" fill="currentColor"/></svg>';

    var pop = document.createElement('span');
    pop.className = 'th-tip__pop';
    pop.id = id;
    pop.setAttribute('role', 'tooltip');
    pop.textContent = tip;

    th.addEventListener('mouseenter', function () { place(th); });
    th.addEventListener('focusin', function () { place(th); });

    // Sortable headers sort on click; the glyph must not also sort.
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var open = th.classList.toggle('is-open');
      if (open) place(th);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { th.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
    });

    th.classList.add('th-tip');
    th.setAttribute('aria-describedby', id);
    // Keep the glyph glued to the label's last word: if a narrow column
    // wraps the label, the glyph wraps with that word instead of landing
    // alone on a line of its own.
    var tail = document.createElement('span');
    tail.className = 'th-tip__tail';
    var last = lastOwnTextNode(th);
    var m = last && /(\S+)(\s*)$/.exec(last.nodeValue);
    if (m) {
      last.nodeValue = last.nodeValue.slice(0, m.index);
      tail.appendChild(document.createTextNode(m[1]));
      th.insertBefore(tail, last.nextSibling);
    } else {
      th.appendChild(tail);
    }
    tail.appendChild(btn);
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
