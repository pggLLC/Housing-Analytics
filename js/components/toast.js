/* ===================================================================
 *  CohoToast — lightweight toast notification component
 *  ES5 IIFE · injects its own CSS · stacks bottom-right
 * =================================================================== */
(function (global) {
  'use strict';

  if (global.CohoToast) return;               // already loaded

  var MAX_VISIBLE = 4;
  var DEFAULTS    = { error: 6000, warn: 4000, info: 4000, success: 4000 };
  var _cssInjected = false;
  var _container   = null;

  /* ── Inject scoped CSS once ──────────────────────────────────────── */

  function _injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;

    var style = document.createElement('style');
    style.textContent =
      '.coho-toast-container{' +
        'position:fixed;bottom:1rem;right:1rem;z-index:10000;' +
        'display:flex;flex-direction:column;gap:.5rem;' +
        'pointer-events:none;max-width:24rem;' +
      '}' +
      /* Animation is transform-only (slide in from below) — opacity is
         pinned at 1 so axe-core/other auditors always see the final
         stable color pair. Prior keyframes animated opacity 0→1 which
         gave a11y tools a mid-transition snapshot, producing spurious
         contrast failures against partially-transparent toast bg. */
      '.coho-toast{' +
        'display:flex;align-items:flex-start;gap:.5rem;' +
        'padding:.625rem .75rem;border-radius:.375rem;' +
        'font:400 .875rem/1.35 var(--font-sans,system-ui,sans-serif);' +
        'color:#fff;pointer-events:auto;opacity:1;' +
        'box-shadow:0 4px 12px rgba(0,0,0,.25);' +
        'transform:translateY(.5rem);' +
        'animation:coho-toast-in .25s ease forwards;' +
      '}' +
      '.coho-toast--error{background:var(--bad,#d32f2f)}' +
      '.coho-toast--warn{background:var(--warn,#a84608)}' +
      '.coho-toast--info{background:var(--accent,#0288d1)}' +
      '.coho-toast--success{background:var(--good,#2e7d32)}' +
      '.coho-toast__msg{flex:1}' +
      '.coho-toast__close{' +
        'background:none;border:none;color:inherit;cursor:pointer;' +
        'font-size:1rem;line-height:1;padding:0 0 0 .25rem;opacity:.8;' +
      '}' +
      '.coho-toast__close:hover{opacity:1}' +
      '@keyframes coho-toast-in{' +
        'to{transform:translateY(0)}' +
      '}' +
      '@keyframes coho-toast-out{' +
        'to{opacity:0;transform:translateY(.5rem)}' +
      '}';

    document.head.appendChild(style);
  }

  /* ── Ensure container exists ─────────────────────────────────────── */

  function _ensureContainer() {
    if (_container && document.body.contains(_container)) return _container;
    _container = document.createElement('div');
    _container.className = 'coho-toast-container';
    _container.setAttribute('aria-live', 'polite');
    document.body.appendChild(_container);
    return _container;
  }

  /* ── Remove a single toast element ───────────────────────────────── */

  function _dismiss(el) {
    if (!el || !el.parentNode) return;
    el.style.animation = 'coho-toast-out .2s ease forwards';
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }

  /* ── Enforce max-visible limit ───────────────────────────────────── */

  function _enforceLimit() {
    var c = _ensureContainer();
    while (c.children.length > MAX_VISIBLE) {
      _dismiss(c.children[0]);
    }
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  function show(message, type, duration) {
    type     = type || 'info';
    duration = duration || DEFAULTS[type] || 4000;

    _injectCSS();
    var c = _ensureContainer();

    var el = document.createElement('div');
    el.className = 'coho-toast coho-toast--' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');

    var msg = document.createElement('span');
    msg.className = 'coho-toast__msg';
    msg.textContent = message;

    var btn = document.createElement('button');
    btn.className = 'coho-toast__close';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.textContent = '\u00d7';
    btn.addEventListener('click', function () { _dismiss(el); });

    el.appendChild(msg);
    el.appendChild(btn);
    c.appendChild(el);

    _enforceLimit();

    var timer = setTimeout(function () { _dismiss(el); }, duration);

    // Allow callers to cancel auto-dismiss
    return { dismiss: function () { clearTimeout(timer); _dismiss(el); } };
  }

  /* ── Expose ──────────────────────────────────────────────────────── */

  global.CohoToast = { show: show };

})(typeof window !== 'undefined' ? window : this);
