/**
 * Contents rail for the Housing Needs Assessment.
 *
 * The page runs 54 sections across roughly 53 desktop screens — about 112 on
 * a phone — with no table of contents and only five jump links. A reader who
 * wants Prop 123 compliance, or bedroom mix, or the permit history has one
 * tool available: scrolling past dozens of sections they did not ask for.
 *
 * The rail is deliberately additive. It reorders nothing, renames nothing and
 * computes nothing — it reads the headings already in the document and builds
 * navigation from them, so it carries none of the regression risk that
 * resequencing the sections would (freshness checks, anchors, the PDF export).
 *
 * Two decisions worth recording:
 *
 * 1. Entries are listed in DOCUMENT order, not grouped by subject. Grouping
 *    would better reflect how the page *should* read, but the highlight
 *    follows the reader's scroll, and a grouped rail would make it jump
 *    between groups as they scroll linearly. Navigation must describe the
 *    page that exists, not the one we would like to exist.
 *
 * 2. Labels are taken from a CLONE of each heading with its methodology
 *    disclosure stripped. Around eight headings embed their tooltip inside
 *    the <h2>, so their raw textContent reads "Housing stock by structure
 *    typeℹ️ MethodologyWhat it measuresDistribution…". Using that verbatim
 *    would produce a rail of paragraphs.
 */
(function () {
  'use strict';

  var MIN_SECTIONS = 6;          // below this a rail is noise, not navigation
  var LABEL_MAX = 42;            // keeps entries to one line at the rail width
  var ID_PREFIX = 'hna-rail-';

  /** Strip the methodology/tooltip furniture that lives inside some headings. */
  function cleanLabel(heading) {
    var clone = heading.cloneNode(true);
    var noise = clone.querySelectorAll(
      'details, summary, button, .hna-cat-tt, .data-approx-hint, .geo-chip, ' +
      '[class*="tooltip"], [class*="method"], [class*="-tt"], [hidden], [aria-hidden="true"]'
    );
    Array.prototype.forEach.call(noise, function (n) { n.remove(); });
    var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    // Some headings still carry a trailing info glyph once markup is gone.
    text = text.replace(/[ℹ️ⓘ•]+\s*$/g, '').trim();
    // Drop a trailing parenthetical qualifier only when the label is long
    // enough that the name survives without it.
    if (text.length > LABEL_MAX) {
      var trimmed = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (trimmed.length >= 12) text = trimmed;
    }
    if (text.length > LABEL_MAX) text = text.slice(0, LABEL_MAX - 1).trim() + '…';
    return text;
  }

  function isVisible(el) {
    if (!el || el.hidden) return false;
    if (el.closest && el.closest('[hidden]')) return false;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  /**
   * collect — find the headings worth navigating to.
   * Exported for tests: given a document, returns [{id, label, heading}].
   */
  function collect(doc) {
    var out = [];
    var seen = Object.create(null);
    var headings = doc.querySelectorAll('main h2');
    Array.prototype.forEach.call(headings, function (h) {
      if (!isVisible(h)) return;
      var label = cleanLabel(h);
      if (!label || label.length < 3) return;
      // Anchor to the enclosing section where one exists so the heading is
      // not scrolled under the sticky site header.
      var target = h.closest('section[id]') || h;
      var id = target.id;
      if (!id) {
        id = ID_PREFIX + out.length;
        target.id = id;
      }
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, label: label, heading: h });
    });
    return out;
  }


  /**
   * buildPath — render the guided reading path, or nothing if the module is
   * absent or too few stops survive. A two-stop "path" is not a path; below
   * that threshold the full contents list is the better affordance.
   */
  function buildPath(doc) {
    var RP = (typeof window !== 'undefined') && window.HNAReadingPath;
    if (!RP) return null;
    var resolved = RP.resolve(doc);
    if (resolved.steps.length < 4) return null;

    var wrap = doc.createElement('div');
    wrap.className = 'hna-rail__path';

    var head = doc.createElement('div');
    head.className = 'hna-rail__path-head';
    head.textContent = 'Start here';
    wrap.appendChild(head);

    var sub = doc.createElement('p');
    sub.className = 'hna-rail__path-sub';
    sub.textContent = 'The assessment as an argument, in ' + resolved.steps.length + ' steps.';
    wrap.appendChild(sub);

    var ol = doc.createElement('ol');
    ol.className = 'hna-rail__path-list';
    resolved.steps.forEach(function (step) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.className = 'hna-rail__path-link';
      a.href = '#' + step.id;
      a.textContent = step.label;
      // The question is the point of the stop; keep it available without
      // spending a line on it in a 15rem rail.
      a.title = step.question;
      li.appendChild(a);
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    return wrap;
  }

  function build(doc, entries) {
    var nav = doc.createElement('nav');
    nav.className = 'hna-rail';
    nav.id = 'hnaContentsRail';
    nav.setAttribute('aria-label', 'Contents');

    var toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'hna-rail__toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'hnaContentsRailList');
    toggle.innerHTML = '<span class="hna-rail__toggle-label">Contents</span>' +
      '<span class="hna-rail__count">' + entries.length + '</span>';

    // The guided reading path sits above the full list. The list answers
    // "where is X"; the path answers "what should I read, in what order" —
    // the question 54 sections in 33 topic-runs left unanswered.
    var path = buildPath(doc);
    if (path) nav.appendChild(path);

    var list = doc.createElement('ol');
    list.className = 'hna-rail__list';
    list.id = 'hnaContentsRailList';

    entries.forEach(function (entry) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.className = 'hna-rail__link';
      a.href = '#' + entry.id;
      a.textContent = entry.label;
      a.title = entry.label;
      li.appendChild(a);
      list.appendChild(li);
    });

    nav.appendChild(toggle);
    nav.appendChild(list);
    return nav;
  }

  function wire(nav, entries, doc) {
    var win = doc.defaultView;
    var links = {};
    Array.prototype.forEach.call(nav.querySelectorAll('.hna-rail__link'), function (a) {
      links[a.getAttribute('href').slice(1)] = a;
    });

    var toggle = nav.querySelector('.hna-rail__toggle');
    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    // Collapse after choosing a destination on narrow screens, where the rail
    // covers the content it is navigating to.
    nav.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('.hna-rail__link');
      if (!link) return;
      if (win.matchMedia && win.matchMedia('(max-width: 1100px)').matches) {
        nav.setAttribute('data-open', 'false');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    if (typeof win.IntersectionObserver !== 'function') return;

    // Track WHICH sections are in the band, not where they were when they
    // entered it. An element that is already intersecting emits no further
    // records as the reader keeps scrolling, so a cached top goes stale and
    // the highlight lags a section behind — measure live instead.
    var visible = Object.create(null);
    var observer = new win.IntersectionObserver(function (records) {
      records.forEach(function (r) {
        if (r.isIntersecting) visible[r.target.id] = true;
        else delete visible[r.target.id];
      });
      // Highlight the visible section nearest the top of the viewport.
      var best = null;
      var bestTop = Infinity;
      Object.keys(visible).forEach(function (id) {
        var el = doc.getElementById(id);
        if (!el) return;
        var top = Math.abs(el.getBoundingClientRect().top);
        if (top < bestTop) { bestTop = top; best = id; }
      });
      Object.keys(links).forEach(function (id) {
        if (id === best) links[id].setAttribute('aria-current', 'true');
        else links[id].removeAttribute('aria-current');
      });
    }, { rootMargin: '-12% 0px -70% 0px', threshold: 0 });

    entries.forEach(function (entry) {
      var el = doc.getElementById(entry.id);
      if (el) observer.observe(el);
    });
  }

  function init() {
    var doc = document;
    if (doc.getElementById('hnaContentsRail')) return;
    var main = doc.getElementById('main-content');
    if (!main) return;
    var entries = collect(doc);
    if (entries.length < MIN_SECTIONS) return;
    var nav = build(doc, entries);
    nav.setAttribute('data-open', 'false');
    main.parentNode.insertBefore(nav, main);
    wire(nav, entries, doc);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        // Let the renderers reveal their sections first; a section still
        // hidden at this point is not something the reader can navigate to.
        setTimeout(init, 1200);
      });
    } else {
      setTimeout(init, 1200);
    }
  }

  var api = { collect: collect, cleanLabel: cleanLabel, build: build, LABEL_MAX: LABEL_MAX, MIN_SECTIONS: MIN_SECTIONS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.HNASectionRail = api;
}());
