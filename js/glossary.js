/**
 * glossary.js — COHO Analytics
 * Loads acronym definitions from data/glossary.json and provides:
 *   1. A modal glossary accessible via a header button.
 *   2. Auto-tooltip wrapping of the first occurrence of each acronym on the page.
 *
 * Usage: included via <script src="js/glossary.js"></script>
 * The navigation.js injects a glossary button into the site header automatically.
 */
(function () {
  'use strict';

  var PATH_PREFIX = (typeof window.APP_BASE_PATH === 'string')
    ? window.APP_BASE_PATH
    : (typeof __PATH_PREFIX !== 'undefined' ? __PATH_PREFIX : '');
  var GLOSSARY_DATA_PATH = PATH_PREFIX + 'data/glossary.json';
  var MODAL_ID = 'glossaryModal';
  var BACKDROP_ID = 'glossaryBackdrop';
  var _terms = null; // cached array of term objects

  /* ── Load glossary data ──────────────────────────────────── */
  function loadTerms(callback) {
    if (_terms !== null) { callback(_terms); return; }
    fetch(GLOSSARY_DATA_PATH)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        _terms = Array.isArray(data.terms) ? data.terms : [];
        callback(_terms);
      })
      .catch(function () {
        _terms = [];
        callback(_terms);
      });
  }

  /* ── Inject styles ───────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('glossary-injected-styles')) return;
    var s = document.createElement('style');
    s.id = 'glossary-injected-styles';
    s.textContent = [
      /* Backdrop */
      '#' + BACKDROP_ID + '{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:1rem;animation:glBackdropIn .2s ease}',
      '@keyframes glBackdropIn{from{opacity:0}to{opacity:1}}',
      /* Modal panel */
      '#' + MODAL_ID + '{background:var(--card);border:1px solid var(--border);border-radius:calc(var(--radius)*2);box-shadow:0 8px 40px rgba(0,0,0,.22);width:100%;max-width:680px;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;animation:glSlideIn .22s ease}',
      '@keyframes glSlideIn{from{opacity:0;transform:translateY(-12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
      /* Header */
      '.gl-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.4rem .8rem;border-bottom:1px solid var(--border);gap:.75rem;flex-shrink:0}',
      '.gl-title{font-size:1.1rem;font-weight:700;color:var(--text);margin:0}',
      '.gl-search-wrap{flex:1;max-width:300px}',
      '.gl-search{width:100%;padding:.4rem .75rem;border:1px solid var(--border);border-radius:999px;background:var(--bg2);color:var(--text);font-size:.9rem;outline:none}',
      '.gl-search:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in oklab,var(--accent) 30%,transparent)}',
      '.gl-close{width:32px;height:32px;min-width:44px;min-height:44px;border:1px solid var(--border);border-radius:50%;background:none;cursor:pointer;color:var(--muted);font-size:1rem;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0}',
      '.gl-close:hover,.gl-close:focus-visible{background:var(--bad-dim,#fee2e2);color:var(--bad,#dc2626);outline:2px solid var(--bad,#dc2626);outline-offset:2px}',
      /* Body */
      '.gl-body{overflow-y:auto;padding:.5rem 1.4rem 1.4rem;flex:1}',
      '.gl-empty{text-align:center;color:var(--muted);font-size:.9rem;padding:2rem 0}',
      /* Term card */
      '.gl-term{padding:.9rem 0;border-bottom:1px solid var(--border)}',
      '.gl-term:last-child{border-bottom:none}',
      '.gl-acronym{font-size:1rem;font-weight:800;color:var(--text);margin:0 0 .15rem}',
      '.gl-full{font-size:.82rem;font-weight:600;color:var(--accent);margin:0 0 .45rem;letter-spacing:.01em}',
      '.gl-def{font-size:.88rem;color:var(--muted);line-height:1.65;margin:0}',
      /* Inline tooltip */
      '.gl-tooltip-trigger{border-bottom:1px dashed var(--accent);cursor:help;color:inherit;text-decoration:none;position:relative}',
      '.gl-tooltip-trigger:hover .gl-tooltip-popup,.gl-tooltip-trigger:focus .gl-tooltip-popup{display:block}',
      '.gl-tooltip-popup{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);min-width:220px;max-width:300px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:.65rem .85rem;z-index:9500;font-size:.8rem;line-height:1.55;color:var(--text);pointer-events:none}',
      '.gl-tooltip-popup strong{display:block;font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:.2rem}',
      /* Header button */
      '.glossary-nav-btn{background:none;border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:.84rem;font-weight:700;color:var(--text);cursor:pointer;display:flex;align-items:center;gap:.35rem;transition:background .15s,border-color .15s;white-space:nowrap}',
      '.glossary-nav-btn:hover,.glossary-nav-btn:focus-visible{background:color-mix(in oklab,var(--card) 70%,var(--accent) 30%);border-color:color-mix(in oklab,var(--border) 60%,var(--accent) 40%);outline:none}',
      '@media(max-width:640px){#' + MODAL_ID + '{max-width:100%;border-radius:var(--radius)}.gl-search-wrap{display:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Render term list ────────────────────────────────────── */
  function renderTerms(terms, filter) {
    var body = document.getElementById('glossaryBody');
    if (!body) return;
    var q = (filter || '').toLowerCase().trim();
    var visible = q
      ? terms.filter(function (t) {
          return t.term.toLowerCase().includes(q) ||
                 t.full.toLowerCase().includes(q) ||
                 t.definition.toLowerCase().includes(q);
        })
      : terms;

    if (visible.length === 0) {
      body.innerHTML = '<p class="gl-empty">No terms match "<strong>' + escHtml(q) + '</strong>".</p>';
      return;
    }

    body.innerHTML = visible.map(function (t) {
      return '<div class="gl-term" role="article">' +
        '<p class="gl-acronym">' + escHtml(t.term) + '</p>' +
        '<p class="gl-full">' + escHtml(t.full) + '</p>' +
        '<p class="gl-def">' + escHtml(t.definition) + '</p>' +
        '</div>';
    }).join('');
  }

  /* ── Build & open modal ──────────────────────────────────── */
  function openModal(highlightTerm) {
    if (document.getElementById(BACKDROP_ID)) return; // already open

    loadTerms(function (terms) {
      var backdrop = document.createElement('div');
      backdrop.id = BACKDROP_ID;
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-label', 'Housing Finance Glossary');

      backdrop.innerHTML = [
        '<div id="' + MODAL_ID + '" tabindex="-1">',
          '<div class="gl-header">',
            '<h2 class="gl-title">📖 Glossary</h2>',
            '<div class="gl-search-wrap">',
              '<input class="gl-search" id="glossarySearch" type="search" placeholder="Search terms…" aria-label="Search glossary terms">',
            '</div>',
            '<button class="gl-close" id="glossaryClose" aria-label="Close glossary">✕</button>',
          '</div>',
          '<div class="gl-body" id="glossaryBody" role="list" aria-live="polite" aria-atomic="true"></div>',
        '</div>'
      ].join('');

      document.body.appendChild(backdrop);

      renderTerms(terms, '');

      // If a specific term was requested, filter to it
      if (highlightTerm) {
        renderTerms(terms, highlightTerm);
        var searchEl = document.getElementById('glossarySearch');
        if (searchEl) searchEl.value = highlightTerm;
      }

      // Focus modal
      var modal = document.getElementById(MODAL_ID);
      if (modal) modal.focus();

      // Search handler
      var searchInput = document.getElementById('glossarySearch');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          renderTerms(terms, searchInput.value);
        });
      }

      // Close handlers
      document.getElementById('glossaryClose').addEventListener('click', closeModal);
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) closeModal();
      });
      document.addEventListener('keydown', onKeyDown);
    });
  }

  function closeModal() {
    var bd = document.getElementById(BACKDROP_ID);
    if (bd) bd.remove();
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeModal();
  }

  /* ── HTML escape ─────────────────────────────────────────── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Auto-tooltip: wrap first occurrence of each acronym ─── */
  /**
   * Which container counts as "the place the reader is looking".
   *
   * First-occurrence-per-PAGE is the wrong unit on a 17,000-word assessment.
   * AMI appears 169 times and CDP 218 times; defining each once, at the top,
   * means every panel below it is unexplained by the time anyone reaches it.
   * Per section, a reader gets the definition next to the number that made
   * them ask.
   */
  function sectionKeyFor(node) {
    var el = node.parentElement;
    var host = el && el.closest
      ? el.closest('section, .chart-card, article, main')
      : null;
    if (!host) return 'page';
    if (!host.__glKey) host.__glKey = 'sec' + (++_sectionSeq);
    return host.__glKey;
  }

  var _sectionSeq = 0;
  // Survives across passes: content arrives late and is scanned repeatedly, so
  // "already wrapped" has to outlive a single invocation or the same term gets
  // wrapped again on every mutation.
  var _wrapped = Object.create(null);

  function autoTooltip(terms, root) {
    if (!terms || !terms.length) return;

    // Build a map of acronym → term object
    var termMap = {};
    terms.forEach(function (t) { termMap[t.term] = t; });

    var acronyms = terms.map(function (t) { return t.term; });
    // Sort longest first so "SOFR" doesn't match inside "SOFR-based" improperly
    acronyms.sort(function (a, b) { return b.length - a.length; });

    // One alternation, longest-first, so the single pass below still prefers
    // the longer term ("compliance period" over "compliance").
    var termPattern = new RegExp(
      '\\b(' + acronyms.map(function (a) {
        return a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|') + ')\\b', 'g');

    var wrapped = _wrapped;
    var hiddenCache = new Map();   // per pass: element -> not on screen

    // Walk text nodes in <main> only (avoid nav/header/footer/scripts)
    var main = root || document.querySelector('main') || document.body;
    walkTextNodes(main, function (node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return;
      var parent = node.parentNode;
      // Skip if inside a script, style, pre, code, or our own tooltip
      if (!parent) return;
      var tag = parent.tagName ? parent.tagName.toUpperCase() : '';
      // ABBR is ours: the trigger is an <abbr>, so without it a second pass
      // wraps the tooltip's own text and nests definitions inside definitions.
      if (['SCRIPT', 'STYLE', 'CODE', 'PRE', 'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'ABBR'].indexOf(tag) !== -1) return;
      if (parent.closest && parent.closest('.gl-tooltip-trigger, .gl-tooltip-popup')) return;
      // Don't wrap acronyms inside headings — the popup's full definition
      // text bleeds into the heading's textContent / accessible name (e.g.
      // Deal Calculator's H1 ended up with "LIHTCLow-Income Housing Tax
      // Credit A dollar-for-dollar federal tax credit…" in textContent).
      // Headings are shorthand by design; the body copy that follows can
      // carry the tooltip instead. Walk ancestors so wrapping inner spans
      // (e.g. <h1><span>LIHTC</span></h1>) is also caught.
      var headingAncestor = parent.closest && parent.closest('h1, h2, h3, h4, h5, h6');
      if (headingAncestor) return;
      // F152 — Same problem class as the heading case but in form controls
      // and accessible-name elements. The direct-parent skip list above
      // missed two things:
      //   (a) OPTION wasn't on it, so a text node directly inside
      //       <option>Acres Green (CDP)</option> got wrapped — and because
      //       browsers render <option> via plain textContent (no child
      //       element formatting), the nested .gl-tooltip-popup span's
      //       full definition string concatenated straight into the
      //       dropdown label ("CDPCensus Designated PlaceAn unincorporated…").
      //   (b) Even with OPTION on the direct-tag list, a text node wrapped
      //       in a <span> inside an <option> / <button> / [role=button]
      //       would still slip through, because the direct-parent tag is
      //       SPAN. Use closest() to reject the whole subtree.
      // Kept narrow: only the elements where injecting the popup span
      // either visibly garbles output (option/optgroup → flat textContent)
      // or pollutes the computed accessible name in a way users will hear
      // (button/role=button label). textarea/input value can't contain
      // child elements anyway, but cheap to include.
      // TH joins the list for the same reason as the heading case above: a
      // table header is a compact label, not body copy. Injecting a definition
      // into one produced "Gap rate at ≤30% AMIArea Median IncomeThe midpoint
      // of the income distribution…" inside a four-column comparison table,
      // where the label has one line to work in. The definition still reaches
      // the reader through the prose around the table.
      if (parent.closest && parent.closest('option, optgroup, button, [role="button"], textarea, input, abbr, th')) return;
      // .no-glossary is the site's opt-out, and inline-glossary.js already
      // honours it. This script did not, so Housing News headlines and their
      // local data lines, marked no-glossary, still came out with AMI, ACS and
      // CHFA definitions spliced into them.
      if (parent.closest && parent.closest('.no-glossary')) return;
      if (parent.classList && parent.classList.contains('gl-tooltip-trigger')) return;
      // A term's one definition per section went to its first use even when
      // that use was not on screen: on market-analysis.html LIHTC's went to
      // the collapsed map legend, leaving the visible LIHTC below it
      // undefined. Text that is not rendered is skipped, so the first
      // VISIBLE use carries the definition; the observer re-sweeps when a
      // legend, tab or <details> opens.
      if (isHidden(parent, hiddenCache)) return;

      var text = node.nodeValue;
      var changed = false;
      var sectionKey = sectionKeyFor(node);

      // ONE pass over the original text, not one replace() per term over an
      // accumulating HTML string.
      //
      // The old loop re-scanned its own output: AMI's definition ends
      // "...as calculated by HUD", so the HUD pass matched inside the AMI
      // popup and produced "AMIArea Median IncomeThe midpoint ... by HUDU.S.
      // Department of Housing and Urban Development…". 44 nested definitions
      // on one page. It was invisible while only 17 terms in the static shell
      // were ever wrapped; it appeared the moment coverage reached the
      // rendered panels.
      //
      // The text is escaped FIRST and matched afterwards — acronyms are word
      // characters, so escaping cannot affect matching, and it closes the
      // older hazard of interpolating raw data-driven text into innerHTML.
      var escaped = escHtml(text);
      var result = escaped.replace(termPattern, function (match) {
        var key = sectionKey + '|' + match;
        if (wrapped[key]) return match;          // already defined in THIS section
        var t = termMap[match];
        if (!t) return match;
        wrapped[key] = true;
        changed = true;
        // aria-label rather than title, so the browser's native tooltip does
        // not duplicate the custom .gl-tooltip-popup.
        return '<abbr class="gl-tooltip-trigger" tabindex="0" aria-label="' +
          escHtml(t.full) +
          '" data-glossary-term="' + escHtml(match) + '">' + match +
          '<span class="gl-tooltip-popup" aria-hidden="true"><strong>' + escHtml(t.full) + '</strong>' +
          escHtml(t.definition.substring(0, 160)) + '…</span></abbr>';
      });

      if (changed) {
        var span = document.createElement('span');
        span.innerHTML = result;
        parent.replaceChild(span, node);

        // Wire tooltip triggers to open glossary on click
        span.querySelectorAll('[data-glossary-term]').forEach(function (el) {
          el.addEventListener('click', function (e) {
            e.preventDefault();
            openModal(el.getAttribute('data-glossary-term'));
          });
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openModal(el.getAttribute('data-glossary-term'));
            }
          });
        });
      }
    });
  }

  /**
   * Walk text nodes, refusing to descend into tooltips we already made.
   *
   * Rejecting the whole SUBTREE, not each node. A definition is prose and
   * contains other acronyms — AMI's definition ends "...as calculated by HUD",
   * so a later pass wrapped HUD inside the AMI popup and produced
   * "AMIArea Median IncomeThe midpoint ... as calculated by HUDU.S. Department
   * of Housing and Urban Development...". 41 of those before this filter.
   *
   * FILTER_REJECT skips the node and everything under it; FILTER_SKIP would
   * only skip the node itself and keep descending, which is the bug.
   */
  /*
   * Whether an element is off screen: [hidden]; inside a closed <details>
   * (other than its <summary>); or, by computed style, display:none,
   * visibility:hidden, opacity:0, or clipped to zero height (the
   * collapsed-legend pattern: .map-legend.is-collapsed .map-legend-body is
   * max-height:0 with overflow:hidden). In a browser an element with no
   * client rects is also off screen; jsdom has no layout, so that check is
   * used only when the page itself has rects. `cache` is per sweep.
   */
  function hiddenByItself(el) {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    var up = el.parentElement;
    if (up && up.tagName === 'DETAILS' && !up.open && el.tagName !== 'SUMMARY') return true;
    var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (cs.opacity !== '' && parseFloat(cs.opacity) === 0) return true;
    var clipped = (cs.overflow && cs.overflow !== 'visible') || (cs.overflowY && cs.overflowY !== 'visible');
    return !!(clipped && (parseFloat(cs.maxHeight) === 0 || parseFloat(cs.height) === 0));
  }
  function isHidden(el, cache) {
    var chain = [];
    var hidden = false;
    for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
      if (cache.has(a)) { hidden = cache.get(a); break; }
      chain.push(a);
      if (hiddenByItself(a)) { hidden = true; break; }
    }
    if (!hidden && el.getClientRects && document.body && document.body.getClientRects().length > 0 &&
        el.getClientRects().length === 0) {
      hidden = true;
    }
    chain.forEach(function (c) { cache.set(c, hidden); });
    return hidden;
  }

  function walkTextNodes(root, callback) {
    var filter = {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (p && p.closest && p.closest('.gl-tooltip-popup')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, filter, false);
    var node;
    var nodes = [];
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    nodes.forEach(callback);
  }

  /* ── Inject glossary button into nav header ──────────────── */
  function injectNavButton() {
    var nav = document.querySelector('nav.site-nav');
    if (!nav) return;
    if (document.getElementById('glossaryNavBtn')) return;

    var btn = document.createElement('button');
    btn.id = 'glossaryNavBtn';
    btn.className = 'glossary-nav-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open housing finance glossary');
    btn.innerHTML = '📖 <span aria-hidden="true">Glossary</span>';
    btn.addEventListener('click', function () { openModal(); });
    nav.appendChild(btn);
  }

  /* ── Expose public API ───────────────────────────────────── */
  window.CohoGlossary = {
    open: function (term) { openModal(term || null); },
    close: closeModal,
    // For renderers that know when they are done; the observer catches the
    // rest. Safe to call repeatedly — wrapping is idempotent per section.
    rescan: function (root) {
      loadTerms(function (terms) {
        try { autoTooltip(terms, root || null); } catch (e) { /* non-fatal */ }
      });
    },
    // For renderers that REPLACE a section's prose. "Already wrapped" is
    // remembered per section so late-arriving content is not re-wrapped on
    // every pass — but that memory outlives the wrapped span when the
    // section's innerHTML is swapped, so the new text would never get its
    // first-occurrence tooltip back. Forgetting the section gives it a fresh
    // key; the next sweep (observer or rescan) treats it as new content.
    forget: function (el) {
      var host = el && el.closest ? el.closest('section, .chart-card, article, main') : null;
      if (host && host.__glKey) delete host.__glKey;
    }
  };

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    injectStyles();

    // Inject nav button after nav:rendered or immediately if nav is ready
    if (document.querySelector('nav.site-nav')) {
      injectNavButton();
    } else {
      document.addEventListener('nav:rendered', injectNavButton);
    }

    // Auto-tooltip after a short delay to let the page render, and again
    // whenever content arrives.
    //
    // A single pass 150ms after DOMContentLoaded only ever saw the static
    // shell. The HNA renders its panels after fetching data, so the pages a
    // novice actually reads got NOTHING: measured on housing-needs-assessment
    // .html, 17 terms wrapped page-wide and 0 inside Affordable Ownership
    // Need — a section carrying LIHTC, QCT, CHFA, AMI, HUD, ACS and CHAS in
    // 2,038 words. The glossary was written, shipped, and never reached the
    // text it was for.
    loadTerms(function (terms) {
      var pending = null;
      var mutating = false;
      function sweep(root) {
        // Our own insertions fire the observer. Without this the sweep
        // re-triggers itself on every pass, forever, on a page that renders
        // continuously.
        mutating = true;
        try { autoTooltip(terms, root); } catch (e) { /* never break the page for a tooltip */ }
        finally { setTimeout(function () { mutating = false; }, 0); }
      }
      function scheduleSweep() {
        if (pending) clearTimeout(pending);
        // Debounced: HNA renders many panels in a burst, and a full re-walk
        // per mutation would be paid 100+ times for one screenful.
        pending = setTimeout(function () { pending = null; sweep(null); }, 400);
      }
      function start() {
        setTimeout(function () { sweep(null); }, 150);
        var host = document.querySelector('main') || document.body;
        if (!host || typeof MutationObserver !== 'function') return;
        new MutationObserver(function (records) {
          if (mutating) return;
          for (var i = 0; i < records.length; i++) {
            if (records[i].addedNodes && records[i].addedNodes.length) { scheduleSweep(); return; }
            // A legend, tab, <details> or inline-styled panel opening reveals
            // text the sweep skipped as hidden (see isHidden). Map panes
            // restyle on every pan and zoom, and our own tooltips on every
            // hover; neither holds prose to define, so neither is a reason
            // to sweep.
            var t = records[i].target;
            if (records[i].type === 'attributes' &&
                !(t.closest && t.closest('.leaflet-pane, .gl-tooltip-trigger, .gl-tooltip-popup'))) { scheduleSweep(); return; }
          }
        }).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'style'] });
      }
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        start();
      } else {
        document.addEventListener('DOMContentLoaded', start);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
