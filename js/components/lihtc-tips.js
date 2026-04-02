/**
 * js/components/lihtc-tips.js — COHO Analytics
 * Renders contextual "LIHTC Quick Reference" tip panels at each workflow step.
 *
 * Reads from data/core/educational-content.json (same source as EduCallout).
 * If EduCallout has already loaded the data it reuses the cached entries.
 *
 * Usage:
 *   LihtcTips.render('lihtcTipsMount-hna', ['ami','cost_burden','housing_gap'], {
 *     audience: 'developer',   // 'elected' | 'developer' | 'financier'
 *     heading:  'HNA Quick Reference'
 *   });
 *
 * The component is self-contained — no external CSS file required.
 */
(function (global) {
  'use strict';

  var DATA_URL  = 'data/core/educational-content.json';
  var _cache    = null;   // resolved entry array
  var _promise  = null;   // in-flight fetch Promise
  var _audience = 'developer';

  /* ── Styles (injected once) ───────────────────────────────────────────── */

  function _ensureStyles() {
    if (global.document.getElementById('lt-styles')) return;
    var s = global.document.createElement('style');
    s.id = 'lt-styles';
    s.textContent = [
      '.lt-wrap{max-width:1200px;margin:32px auto 0;padding:0 18px;}',
      '.lt-inner{background:color-mix(in oklab,var(--card) 80%,var(--accent) 20%);',
        'border:1px solid color-mix(in oklab,var(--border) 60%,var(--accent) 40%);',
        'border-radius:10px;padding:20px 24px;}',
      '.lt-heading{display:flex;align-items:center;gap:8px;margin:0 0 14px;',
        'font-size:.85rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;}',
      '.lt-heading svg{flex-shrink:0;}',
      '.lt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}',
      '.lt-card{border:1px solid var(--border);border-radius:8px;overflow:hidden;',
        'background:var(--card);}',
      '.lt-card__trigger{width:100%;display:flex;align-items:center;justify-content:space-between;',
        'gap:8px;padding:10px 14px;background:none;border:none;cursor:pointer;',
        'text-align:left;font-size:.82rem;font-weight:700;color:var(--text);}',
      '.lt-card__trigger:hover{background:var(--bg2);}',
      '.lt-card__term{flex:1;}',
      '.lt-card__arrow{font-size:.7rem;color:var(--muted);transition:transform .2s;flex-shrink:0;}',
      '.lt-card--open .lt-card__arrow{transform:rotate(180deg);}',
      '.lt-card__body{display:none;padding:0 14px 12px;font-size:.82rem;line-height:1.55;color:var(--text);}',
      '.lt-card--open .lt-card__body{display:block;}',
      '.lt-card__short{color:var(--muted);font-size:.78rem;margin-top:4px;}',
      '.lt-guide-link{display:inline-block;margin-top:12px;font-size:.78rem;',
        'color:var(--accent);text-decoration:none;font-weight:700;}',
      '.lt-guide-link:hover{text-decoration:underline;}',
      '@media(max-width:540px){.lt-grid{grid-template-columns:1fr;}}'
    ].join('');
    global.document.head.appendChild(s);
  }

  /* ── Data loading ─────────────────────────────────────────────────────── */

  function _load() {
    // Reuse EduCallout's data if available
    if (global.EduCallout && global.EduCallout.isLoaded()) {
      _cache = _cache || [];   // EduCallout caches internally; we'll query via getEntry
      return Promise.resolve(_cache);
    }
    if (_cache)   return Promise.resolve(_cache);
    if (_promise) return _promise;

    _promise = fetch(DATA_URL)
      .then(function (r) {
        if (!r.ok) throw new Error('lihtc-tips: failed to load ' + DATA_URL);
        return r.json();
      })
      .then(function (data) {
        _cache = Array.isArray(data) ? data : [];
        return _cache;
      })
      ['catch'](function (err) {
        console.warn('[LihtcTips]', err && err.message);
        _cache = [];
        return _cache;
      });

    return _promise;
  }

  /* ── Entry lookup ─────────────────────────────────────────────────────── */

  function _findByTags(tags) {
    if (!tags || !tags.length) return [];
    var results = [];

    // If EduCallout is loaded, use its getEntry() for each tag directly
    if (global.EduCallout && global.EduCallout.isLoaded()) {
      var seen = {};
      tags.forEach(function (tag) {
        var entry = global.EduCallout.getEntry(tag);
        if (entry && !seen[entry.term]) {
          seen[entry.term] = true;
          results.push(entry);
        }
      });
      return results;
    }

    // Otherwise filter our own cache by matching term or tag values
    if (!_cache || !_cache.length) return [];
    var tagSet = {};
    tags.forEach(function (t) { tagSet[t] = true; });

    _cache.forEach(function (entry) {
      var matchesTerm = tagSet[entry.term];
      var matchesTag  = Array.isArray(entry.tags) && entry.tags.some(function (t) { return tagSet[t]; });
      if (matchesTerm || matchesTag) {
        results.push(entry);
      }
    });

    // Return only the tags that were explicitly requested, preserving order
    var ordered = [];
    var usedTerms = {};
    tags.forEach(function (tag) {
      var match = results.filter(function (e) {
        return e.term === tag || (Array.isArray(e.tags) && e.tags.indexOf(tag) !== -1);
      })[0];
      if (match && !usedTerms[match.term]) {
        usedTerms[match.term] = true;
        ordered.push(match);
      }
    });
    return ordered;
  }

  /* ── HTML builders ────────────────────────────────────────────────────── */

  function _cardHTML(entry, audience, idx) {
    var copy = entry[audience] || entry.developer || entry.short || '';
    var id   = 'lt-card-' + idx;
    return (
      '<div class="lt-card" id="' + id + '">' +
        '<button class="lt-card__trigger" type="button" ' +
            'aria-expanded="false" aria-controls="' + id + '-body">' +
          '<span class="lt-card__term">' + _esc(entry.term) + '</span>' +
          '<span class="lt-card__arrow">▼</span>' +
        '</button>' +
        '<div class="lt-card__body" id="' + id + '-body" role="region">' +
          '<p>' + _esc(copy) + '</p>' +
          (entry.short && entry.short !== copy
            ? '<p class="lt-card__short">' + _esc(entry.short) + '</p>'
            : '') +
        '</div>' +
      '</div>'
    );
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Accordion wiring ─────────────────────────────────────────────────── */

  function _wireAccordion(container) {
    var triggers = container.querySelectorAll('.lt-card__trigger');
    for (var i = 0; i < triggers.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var card     = btn.closest ? btn.closest('.lt-card') : btn.parentNode;
          var isOpen   = card.classList.contains('lt-card--open');
          var expanded = !isOpen;
          card.classList.toggle('lt-card--open', expanded);
          btn.setAttribute('aria-expanded', String(expanded));
        });
      }(triggers[i]));
    }
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  /**
   * render(containerId, tags, options)
   * Fetch data (or reuse cache) then inject tip cards into the container.
   *
   * @param {string}   containerId  ID of mount element
   * @param {string[]} tags         Term keys from educational-content.json
   * @param {object}   [options]
   * @param {string}   [options.audience]  'elected'|'developer'|'financier'
   * @param {string}   [options.heading]   Override panel heading text
   */
  function render(containerId, tags, options) {
    options = options || {};
    _ensureStyles();

    var container = global.document.getElementById(containerId);
    if (!container) return;

    var audience = options.audience || _audience;
    var heading  = options.heading  || 'LIHTC Quick Reference';

    _load().then(function () {
      var entries = _findByTags(tags);
      if (!entries.length) return;   // nothing to show

      var cards = entries.map(function (e, i) {
        return _cardHTML(e, audience, containerId + '-' + i);
      }).join('');

      container.innerHTML =
        '<div class="lt-wrap">' +
          '<div class="lt-inner">' +
            '<p class="lt-heading">' +
              '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
                'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<circle cx="12" cy="12" r="10"/>' +
                '<line x1="12" y1="8" x2="12" y2="12"/>' +
                '<line x1="12" y1="16" x2="12.01" y2="16"/>' +
              '</svg>' +
              _esc(heading) +
            '</p>' +
            '<div class="lt-grid">' + cards + '</div>' +
            '<a class="lt-guide-link" href="lihtc-guide-for-stakeholders.html">' +
              'Full LIHTC Guide →' +
            '</a>' +
          '</div>' +
        '</div>';

      _wireAccordion(container);
    });
  }

  /**
   * setAudience(mode)
   * Set the default audience for future render() calls.
   */
  function setAudience(mode) {
    if (mode === 'elected' || mode === 'developer' || mode === 'financier') {
      _audience = mode;
    }
  }

  global.LihtcTips = {
    render:      render,
    setAudience: setAudience
  };

}(typeof window !== 'undefined' ? window : this));
