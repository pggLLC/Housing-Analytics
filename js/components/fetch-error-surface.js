/**
 * fetch-error-surface.js — F249 (P0-2): Surface fetch failures in the UI.
 *
 * Why this exists
 * ---------------
 * When an external data fetch fails, users see a blank chart, an empty
 * table, or a "—". The error goes to the browser console where a
 * developer would see it, but a casual user has no idea why a number
 * went missing. The June 2026 reliability audit flagged this as a top
 * open risk: "failures are silent at the user layer."
 *
 * This module gives every renderer a standard way to convert an opaque
 * blank slot into a transparent "we couldn't reach HUD; here's why and
 * what to do" message. It's intentionally lightweight — just a renderer
 * that returns HTML, no fetch wrapping or auto-retry. Callers wire it
 * into their existing .catch() handlers.
 *
 * Public API
 * ----------
 *   FetchErrorSurface.render(target, options)
 *     target: DOM element to populate with the error message
 *     options:
 *       - source: human label for the data source ("HUD Fair Market Rent",
 *         "Novogradac Equity Pricing", "Census ACS"). REQUIRED.
 *       - url: optional URL the page tried to load (relative to site root)
 *       - error: the Error or string that surfaced from the fetch
 *       - lastKnownValue: optional cached value to show as fallback
 *       - lastKnownDate: optional date string ("2026-05-22") for the
 *         cached value
 *       - retryFn: optional function the user can click to retry
 *       - severity: 'info' | 'warn' | 'error'. Default 'warn'.
 *
 *   FetchErrorSurface.wrapFetch(fetchPromise, target, options)
 *     Convenience: returns a Promise that resolves to the fetched JSON
 *     on success, or renders the error and rejects on failure.
 *
 * Usage example
 * -------------
 *   var target = document.getElementById('yardiNational');
 *   fetch('data/market/yardi-matrix-national-multifamily.json')
 *     .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
 *     .then(j => renderYardi(j))
 *     .catch(err => FetchErrorSurface.render(target, {
 *       source: 'Yardi Matrix National Multifamily Report',
 *       url:    'data/market/yardi-matrix-national-multifamily.json',
 *       error:  err,
 *       lastKnownDate: '2026-06-04',
 *       retryFn: () => initYardi()
 *     }));
 */
(function () {
  'use strict';

  function _escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _formatError(err) {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    return String(err);
  }

  function render(target, options) {
    if (!target) return;
    var opts = options || {};
    var source = opts.source || 'external data source';
    var severity = opts.severity || 'warn';
    var errMsg = _formatError(opts.error);

    var colorMap = {
      info:  { bg: 'var(--info-dim,#1e293b)',  fg: 'var(--info,#60a5fa)',  border: 'var(--info,#60a5fa)' },
      warn:  { bg: 'var(--warn-dim,#3f2a1a)',  fg: 'var(--warn,#fbbf24)',  border: 'var(--warn,#fbbf24)' },
      error: { bg: 'var(--bad-dim,#3f1a1a)',   fg: 'var(--bad,#f87171)',   border: 'var(--bad,#f87171)' }
    };
    var color = colorMap[severity] || colorMap.warn;

    var iconMap = { info: 'ℹ️', warn: '⚠️', error: '⛔' };
    var icon = iconMap[severity] || iconMap.warn;

    var html =
      '<div class="fes-error" role="status" aria-live="polite" ' +
        'style="display:flex;gap:.6rem;padding:.7rem .85rem;border-radius:6px;' +
        'background:' + color.bg + ';border:1px solid ' + color.border + ';' +
        'font-size:.85rem;line-height:1.5;color:var(--text);">' +
        '<div style="font-size:1.1rem;flex-shrink:0;line-height:1;">' + icon + '</div>' +
        '<div style="flex:1;">' +
          '<div style="font-weight:600;color:' + color.fg + ';margin-bottom:.15rem;">' +
            'Couldn\'t load ' + _escHtml(source) +
          '</div>' +
          '<div style="color:var(--muted);font-size:.78rem;">' +
            _escHtml(errMsg) +
          '</div>';

    if (opts.lastKnownValue != null || opts.lastKnownDate) {
      html += '<div style="margin-top:.4rem;padding-top:.4rem;border-top:1px dashed var(--border);font-size:.78rem;">' +
        '<strong>Last known value' +
        (opts.lastKnownDate ? ' (as of ' + _escHtml(opts.lastKnownDate) + ')' : '') +
        ':</strong> ';
      if (opts.lastKnownValue != null) {
        html += _escHtml(String(opts.lastKnownValue));
      } else {
        html += '<em style="color:var(--muted);">cached on the page</em>';
      }
      html += '</div>';
    }

    var actions = [];
    if (opts.retryFn) {
      actions.push('<button type="button" class="fes-retry" ' +
        'style="background:transparent;border:1px solid ' + color.border + ';' +
        'color:' + color.fg + ';padding:2px 8px;border-radius:4px;font-size:.72rem;' +
        'font-weight:600;cursor:pointer;">Retry</button>');
    }
    if (opts.url) {
      actions.push('<a href="' + _escHtml(opts.url) + '" target="_blank" rel="noopener" ' +
        'style="color:' + color.fg + ';font-size:.72rem;text-decoration:underline;">' +
        'View raw file →</a>');
    }
    if (actions.length) {
      html += '<div style="margin-top:.4rem;display:flex;gap:.5rem;align-items:center;">' +
        actions.join('') + '</div>';
    }

    html += '</div></div>';
    target.innerHTML = html;
    target.hidden = false;

    // Wire retry button
    if (opts.retryFn) {
      var btn = target.querySelector('.fes-retry');
      if (btn) {
        btn.addEventListener('click', function () {
          try { opts.retryFn(); }
          catch (e) { console.warn('[FetchErrorSurface] retry threw:', e); }
        });
      }
    }
  }

  function wrapFetch(fetchPromise, target, options) {
    return fetchPromise
      .then(function (r) {
        if (r && typeof r.ok === 'boolean') {
          if (!r.ok) {
            return Promise.reject(new Error('HTTP ' + r.status + ' ' + r.statusText));
          }
          return r.json();
        }
        return r;
      })
      .catch(function (err) {
        render(target, Object.assign({}, options, { error: err }));
        return Promise.reject(err);
      });
  }

  window.FetchErrorSurface = {
    render: render,
    wrapFetch: wrapFetch
  };
}());
