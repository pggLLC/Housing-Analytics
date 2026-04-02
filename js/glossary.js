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

  var GLOSSARY_DATA_PATH = (typeof __PATH_PREFIX !== 'undefined' ? __PATH_PREFIX : '') + 'data/glossary.json';
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
      '#' + BACKDROP_ID + '{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:4000;display:flex;align-items:center;justify-content:center;padding:1rem;animation:glBackdropIn .2s ease}',
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
      '.gl-tooltip-popup{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);min-width:220px;max-width:300px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:.65rem .85rem;z-index:3500;font-size:.8rem;line-height:1.55;color:var(--text);pointer-events:none}',
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
  function autoTooltip(terms) {
    if (!terms || !terms.length) return;

    // Build a map of acronym → term object
    var termMap = {};
    terms.forEach(function (t) { termMap[t.term] = t; });

    var acronyms = terms.map(function (t) { return t.term; });
    // Sort longest first so "SOFR" doesn't match inside "SOFR-based" improperly
    acronyms.sort(function (a, b) { return b.length - a.length; });

    var wrapped = {};

    // Walk text nodes in <main> only (avoid nav/header/footer/scripts)
    var main = document.querySelector('main') || document.body;
    walkTextNodes(main, function (node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return;
      var parent = node.parentNode;
      // Skip if inside a script, style, pre, code, or our own tooltip
      if (!parent) return;
      var tag = parent.tagName ? parent.tagName.toUpperCase() : '';
      if (['SCRIPT', 'STYLE', 'CODE', 'PRE', 'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].indexOf(tag) !== -1) return;
      if (parent.classList && parent.classList.contains('gl-tooltip-trigger')) return;

      var text = node.nodeValue;
      var changed = false;
      var result = text;

      acronyms.forEach(function (term) {
        if (wrapped[term]) return; // already wrapped once globally
        // Match whole word (case-sensitive)
        var re = new RegExp('\\b' + term + '\\b');
        if (re.test(result)) {
          var t = termMap[term];
          // Use aria-label instead of title so the browser's native tooltip
          // doesn't create a duplicate of the custom .gl-tooltip-popup,
          // which was also causing raw HTML strings to be visible in some contexts.
          var tooltip = '<abbr class="gl-tooltip-trigger" tabindex="0" aria-label="' +
            escHtml(t.full) +
            '" data-glossary-term="' + escHtml(term) + '">' + term +
            '<span class="gl-tooltip-popup" aria-hidden="true"><strong>' + escHtml(t.full) + '</strong>' +
            escHtml(t.definition.substring(0, 160)) + '…</span></abbr>';
          result = result.replace(re, tooltip);
          wrapped[term] = true;
          changed = true;
        }
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

  function walkTextNodes(root, callback) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
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
    close: closeModal
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

    // Auto-tooltip after a short delay to let the page render
    loadTerms(function (terms) {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(function () { autoTooltip(terms); }, 150);
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          setTimeout(function () { autoTooltip(terms); }, 150);
        });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
