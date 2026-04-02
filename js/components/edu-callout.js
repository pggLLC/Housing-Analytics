/**
 * edu-callout.js — Educational Callout System for COHO Analytics
 * ES5 IIFE module. Exposes window.EduCallout.
 *
 * Usage:
 *   EduCallout.load().then(function() { EduCallout.init(); });
 *   EduCallout.setAudience('elected' | 'developer' | 'financier');
 *
 * Scans for [data-edu="term_key"] attributes, injects ⓘ trigger buttons,
 * and shows audience-aware callout panels on click.
 */
(function (window, document) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Private state                                                       */
  /* ------------------------------------------------------------------ */
  var _data        = null;   // parsed educational-content.json
  var _loaded      = false;
  var _audience    = 'developer'; // default audience mode
  var _openCallout = null;   // currently open callout element or null
  var _styleInjected = false;

  /* ------------------------------------------------------------------ */
  /*  CSS                                                                 */
  /* ------------------------------------------------------------------ */
  var CSS = [
    '.edu-trigger{',
      'background:none;border:none;cursor:pointer;',
      'color:var(--accent,#2563eb);font-size:.9em;',
      'padding:0 3px;vertical-align:middle;opacity:.7;',
      'line-height:1;',
    '}',
    '.edu-trigger:hover{opacity:1;}',
    '.edu-callout{',
      'position:absolute;',
      'background:var(--card,#fff);',
      'border:1px solid var(--border,#e2e8f0);',
      'border-radius:10px;',
      'box-shadow:0 4px 20px rgba(0,0,0,.15);',
      'padding:16px 20px;',
      'max-width:380px;width:100%;',
      'z-index:3000;font-size:.88rem;',
      'box-sizing:border-box;',
    '}',
    '.edu-callout__header{',
      'display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;',
    '}',
    '.edu-callout__term{',
      'font-weight:700;flex:1;font-size:.95rem;',
      'color:var(--text,#1e293b);',
    '}',
    '.edu-callout__audience-tabs{display:flex;gap:4px;flex-shrink:0;}',
    '.edu-callout__tab{',
      'padding:3px 8px;font-size:.7rem;border-radius:999px;',
      'border:1px solid var(--border,#e2e8f0);',
      'background:none;cursor:pointer;',
      'color:var(--muted,#64748b);',
      'white-space:nowrap;',
    '}',
    '.edu-callout__tab--active{',
      'background:var(--accent,#2563eb);',
      'color:#fff;',
      'border-color:var(--accent,#2563eb);',
    '}',
    '.edu-callout__close{',
      'background:none;border:none;cursor:pointer;',
      'font-size:1.2rem;color:var(--muted,#64748b);padding:0;',
      'flex-shrink:0;line-height:1;',
    '}',
    '.edu-callout__short{',
      'color:var(--muted,#64748b);font-size:.82rem;',
      'margin:0 0 10px;font-style:italic;',
    '}',
    '.edu-callout__body{',
      'line-height:1.55;margin:0 0 12px;',
      'color:var(--text,#1e293b);',
    '}',
    '.edu-callout__link{',
      'font-size:.8rem;color:var(--accent,#2563eb);text-decoration:none;',
    '}',
    '.edu-callout__link:hover{text-decoration:underline;}'
  ].join('');

  function _injectStyles() {
    if (_styleInjected) { return; }
    var el = document.getElementById('edu-callout-styles');
    if (!el) {
      el = document.createElement('style');
      el.id = 'edu-callout-styles';
      (document.head || document.body).appendChild(el);
    }
    el.textContent = CSS;
    _styleInjected = true;
  }

  /* ------------------------------------------------------------------ */
  /*  Build callout HTML                                                  */
  /* ------------------------------------------------------------------ */
  function _buildCalloutHTML(key, entry, audience) {
    var tabs = ['elected', 'developer', 'financier'];
    var labels = { elected: 'Elected Official', developer: 'Developer', financier: 'Financier' };
    var tabsHTML = '';
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var active = (t === audience) ? ' edu-callout__tab--active' : '';
      tabsHTML += '<button data-aud="' + t + '" class="edu-callout__tab' + active + '">' + labels[t] + '</button>';
    }

    var learnMore = entry.learnMore
      ? '<a class="edu-callout__link" href="' + _esc(entry.learnMore) + '" target="_blank" rel="noopener">Learn more ↗</a>'
      : '';

    return (
      '<div class="edu-callout__header">' +
        '<span class="edu-callout__term">' + _esc(entry.term) + '</span>' +
        '<div class="edu-callout__audience-tabs">' + tabsHTML + '</div>' +
        '<button class="edu-callout__close" aria-label="Close">×</button>' +
      '</div>' +
      '<p class="edu-callout__short">' + _esc(entry.short) + '</p>' +
      '<p class="edu-callout__body" id="edu-callout-body-' + _esc(key) + '">' + _esc(entry[audience] || '') + '</p>' +
      learnMore
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Escape HTML                                                         */
  /* ------------------------------------------------------------------ */
  function _esc(str) {
    if (str === null || str === undefined) { return ''; }
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ */
  /*  Close the currently open callout                                   */
  /* ------------------------------------------------------------------ */
  function _closeOpen() {
    if (_openCallout && _openCallout.parentNode) {
      _openCallout.parentNode.removeChild(_openCallout);
    }
    _openCallout = null;
  }

  /* ------------------------------------------------------------------ */
  /*  Open a callout for a given key, anchored to a trigger element      */
  /* ------------------------------------------------------------------ */
  function _openCalloutForKey(key, triggerEl) {
    var entry = _getEntry(key);
    if (!entry) { return; }

    // Close existing
    _closeOpen();

    var callout = document.createElement('div');
    callout.className = 'edu-callout';
    callout.id = 'edu-callout-' + key;
    callout.setAttribute('role', 'dialog');
    callout.setAttribute('aria-label', 'About ' + entry.term);
    callout.innerHTML = _buildCalloutHTML(key, entry, _audience);

    // Position: below trigger, absolutely in nearest positioned ancestor
    var parent = triggerEl.offsetParent || document.body;
    parent.appendChild(callout);

    // Compute position
    _positionCallout(callout, triggerEl);

    _openCallout = callout;

    // Audience tab clicks
    var tabBtns = callout.querySelectorAll('.edu-callout__tab');
    for (var i = 0; i < tabBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var aud = btn.getAttribute('data-aud');
          _audience = aud;
          _updateCalloutAudience(callout, key, entry, aud);
        });
      })(tabBtns[i]);
    }

    // Close button
    var closeBtn = callout.querySelector('.edu-callout__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _closeOpen();
      });
    }

    // Prevent clicks inside callout from propagating to document
    callout.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Position callout below the trigger element                         */
  /* ------------------------------------------------------------------ */
  function _positionCallout(callout, triggerEl) {
    // Get trigger position relative to its offsetParent
    var top = 0;
    var left = 0;
    var el = triggerEl;
    var parent = callout.parentNode;

    // Sum up offsetTop/offsetLeft up to the callout's parent
    while (el && el !== parent) {
      top  += el.offsetTop  + (el.clientTop  || 0);
      left += el.offsetLeft + (el.clientLeft || 0);
      el = el.offsetParent;
    }

    callout.style.top  = (top + triggerEl.offsetHeight + 6) + 'px';
    callout.style.left = left + 'px';
  }

  /* ------------------------------------------------------------------ */
  /*  Update audience content without rebuilding the whole callout       */
  /* ------------------------------------------------------------------ */
  function _updateCalloutAudience(callout, key, entry, audience) {
    // Update body text
    var bodyEl = callout.querySelector('#edu-callout-body-' + key);
    if (bodyEl) {
      bodyEl.textContent = entry[audience] || '';
    }
    // Update active tab
    var tabs = callout.querySelectorAll('.edu-callout__tab');
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (tab.getAttribute('data-aud') === audience) {
        tab.className = 'edu-callout__tab edu-callout__tab--active';
      } else {
        tab.className = 'edu-callout__tab';
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Wire up a single [data-edu] element                                */
  /* ------------------------------------------------------------------ */
  function _wireElement(el) {
    var key = el.getAttribute('data-edu');
    if (!key) { return; }

    // Avoid double-wiring
    if (el.getAttribute('data-edu-wired')) { return; }
    el.setAttribute('data-edu-wired', '1');

    var entry = _getEntry(key);
    if (!entry) { return; }

    var btn = document.createElement('button');
    btn.className = 'edu-trigger';
    btn.setAttribute('data-edu-key', key);
    btn.setAttribute('aria-label', 'Learn about ' + entry.term);
    btn.setAttribute('type', 'button');
    btn.textContent = 'ⓘ';

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // Toggle: if this callout is already open, close it
      if (_openCallout && _openCallout.id === 'edu-callout-' + key) {
        _closeOpen();
      } else {
        _openCalloutForKey(key, btn);
      }
    });

    if (el.nextSibling) {
      el.parentNode.insertBefore(btn, el.nextSibling);
    } else {
      el.parentNode.appendChild(btn);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Internal entry lookup                                               */
  /* ------------------------------------------------------------------ */
  function _getEntry(key) {
    if (!_data || !_data.entries) { return null; }
    return _data.entries[key] || null;
  }

  /* ------------------------------------------------------------------ */
  /*  Load educational-content.json                                      */
  /* ------------------------------------------------------------------ */
  function _load() {
    if (_loaded) {
      return Promise.resolve(_data);
    }

    var root = (window.__REPO_ROOT !== undefined) ? window.__REPO_ROOT : '';
    var url  = root + 'data/core/educational-content.json';

    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('EduCallout: failed to load educational-content.json (' + res.status + ')');
        }
        return res.json();
      })
      .then(function (json) {
        _data   = json;
        _loaded = true;
        return json;
      })
      .catch(function (err) {
        console.error('EduCallout load error:', err);
        throw err;
      });
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * init(options)
   * Scan the page for [data-edu] attributes and wire up trigger buttons.
   * Optionally pass { audience: 'elected'|'developer'|'financier' }.
   * Must be called after load() resolves.
   */
  function init(options) {
    options = options || {};
    if (options.audience) {
      _audience = options.audience;
    }
    _injectStyles();

    var elements = document.querySelectorAll('[data-edu]');
    for (var i = 0; i < elements.length; i++) {
      _wireElement(elements[i]);
    }

    // Close on outside click
    document.addEventListener('click', function () {
      _closeOpen();
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      var key = e.key || e.keyCode;
      if (key === 'Escape' || key === 27) {
        _closeOpen();
      }
    });
  }

  /**
   * setAudience(mode)
   * Change the global audience mode. Re-renders any open callout.
   * @param {string} mode — 'elected', 'developer', or 'financier'
   */
  function setAudience(mode) {
    var valid = { elected: true, developer: true, financier: true };
    if (!valid[mode]) {
      console.warn('EduCallout.setAudience: unknown mode "' + mode + '"');
      return;
    }
    _audience = mode;

    // Re-render open callout if any
    if (_openCallout) {
      var key = _openCallout.id.replace('edu-callout-', '');
      var entry = _getEntry(key);
      if (entry) {
        _updateCalloutAudience(_openCallout, key, entry, _audience);
      }
    }
  }

  /**
   * load()
   * Fetch educational-content.json. Returns a Promise that resolves with the data.
   */
  function load() {
    return _load();
  }

  /**
   * isLoaded()
   * Returns true if the data has been loaded.
   */
  function isLoaded() {
    return _loaded;
  }

  /**
   * getEntry(key)
   * Returns the entry object for a given term key, or null if not found.
   * @param {string} key
   */
  function getEntry(key) {
    return _getEntry(key);
  }

  /* ------------------------------------------------------------------ */
  /*  Expose public API                                                   */
  /* ------------------------------------------------------------------ */
  /**
   * scan(rootEl)
   * Wire up any [data-edu] elements within rootEl that were added after init().
   * Call this at the end of any function that renders dynamic content containing
   * [data-edu] anchors (e.g. HousingNeedProjector, NeighborhoodContext).
   * Safe to call repeatedly — already-wired elements are skipped.
   *
   * @param {Element} rootEl  Container to scan. Defaults to document.body.
   */
  function scan(rootEl) {
    var root = rootEl || document.body;
    var elements = root.querySelectorAll('[data-edu]');
    for (var i = 0; i < elements.length; i++) {
      _wireElement(elements[i]);
    }
  }

  window.EduCallout = {
    init:        init,
    scan:        scan,
    setAudience: setAudience,
    load:        load,
    isLoaded:    isLoaded,
    getEntry:    getEntry
  };

}(window, document));
