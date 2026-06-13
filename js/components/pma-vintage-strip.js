/**
 * js/components/pma-vintage-strip.js
 * ===============================================================
 * Decorates every .pma-card[data-vintage] with a small "As of X"
 * strip beneath the card's <h2>. Brings PMA cards into freshness
 * parity with the jurisdiction-brief renderer.
 *
 * Reads:
 *   data-vintage       e.g. "ACS 2020–2024 · HUD LIHTC 2023 · FRED 2024"
 *   data-source        e.g. "ACS 5-Year + HUD LIHTC DB + FRED + DOLA"
 *   data-source-url    optional canonical link
 *   data-source-type   "modeled" | "primary" | "derived"
 *
 * Idempotent: never appends a duplicate strip.
 * Runs once on DOMContentLoaded + observes DOM mutations.
 */
(function (global) {
  'use strict';
  if (global.PmaVintageStrip) return;

  var STRIP_CLASS = 'pma-vintage-strip';

  function _strip(card) {
    if (!card || card.querySelector(':scope > .' + STRIP_CLASS)) return;
    var vintage = card.getAttribute('data-vintage');
    var sourceType = card.getAttribute('data-source-type');
    var source = card.getAttribute('data-source');
    var url = card.getAttribute('data-source-url');
    if (!vintage && !source) return;

    var h2 = card.querySelector(':scope > h2');
    var strip = document.createElement('div');
    strip.className = STRIP_CLASS;
    strip.setAttribute('role', 'note');
    strip.style.cssText = [
      'display:flex',
      'flex-wrap:wrap',
      'gap:.4rem .8rem',
      'align-items:baseline',
      'margin:.15rem 0 .55rem',
      'font-size:.7rem',
      'color:var(--muted)',
      'line-height:1.4'
    ].join(';');

    var pieces = [];
    if (vintage) pieces.push('<span><strong style="color:var(--text);font-weight:500">As of:</strong> ' + _esc(vintage) + '</span>');
    if (sourceType) {
      var t = String(sourceType).toLowerCase();
      var badge = t === 'modeled' ? 'Modeled' : (t === 'derived' ? 'Derived' : 'Primary');
      pieces.push('<span style="padding:1px 6px;border:1px solid var(--border);border-radius:3px;font-size:.65rem;letter-spacing:.03em;text-transform:uppercase">' + badge + '</span>');
    }
    if (source) {
      var label = url
        ? '<a href="' + _esc(url) + '" target="_blank" rel="noopener" style="color:var(--muted);text-decoration:underline">' + _esc(source) + '</a>'
        : _esc(source);
      pieces.push('<span><strong style="color:var(--text);font-weight:500">Source:</strong> ' + label + '</span>');
    }
    strip.innerHTML = pieces.join('');

    if (h2 && h2.parentNode === card) {
      // Insert right after the <h2>
      if (h2.nextSibling) card.insertBefore(strip, h2.nextSibling);
      else card.appendChild(strip);
    } else {
      card.insertBefore(strip, card.firstChild);
    }
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]);
    });
  }

  function _scan(root) {
    var scope = root || document;
    var cards = scope.querySelectorAll('.pma-card[data-vintage], .pma-card[data-source]');
    cards.forEach(_strip);
  }

  function _init() {
    _scan();
    // Observe new cards added later by renderers
    if (typeof MutationObserver === 'function') {
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes && m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.classList && n.classList.contains('pma-card')) _strip(n);
            _scan(n);
          });
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  global.PmaVintageStrip = { scan: _scan };
})(window);
