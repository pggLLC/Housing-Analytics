/**
 * js/iframe-spinner.js
 * Auto-attaches loading spinner overlays to <iframe> elements.
 *
 * For each <iframe> that does not already have a spinner overlay in its parent,
 * this utility:
 *   1. Ensures the parent has position:relative so the overlay can be positioned.
 *   2. Inserts a themed spinner overlay div that shows immediately.
 *   3. Hides the overlay when the iframe fires its "load" event.
 *   4. Leaves the overlay visible if the iframe fails to load (visual error state).
 *
 * Usage (automatic):
 *   Include this script in the page; all iframes present at DOMContentLoaded
 *   are wired automatically.  To attach spinners to iframes added later, call:
 *       window.iframeSpinner.attach(iframeElement);
 *   or to re-scan the whole page:
 *       window.iframeSpinner.attachAll();
 *
 * CSS dependency:
 *   Uses .map-iframe-overlay / .map-iframe-spinner classes defined in
 *   site-theme.css (or inline-style fallbacks if the classes are absent).
 */
(function () {
  'use strict';

  /**
   * Inject a spinner overlay into the parent of the given iframe.
   * Does nothing if an overlay is already present.
   * @param {HTMLIFrameElement} iframe
   */
  function attach(iframe) {
    if (!iframe || iframe.tagName !== 'IFRAME') return;

    var parent = iframe.parentElement;
    if (!parent) return;

    // Skip if an overlay is already present in this parent.
    if (parent.querySelector('.map-iframe-overlay')) return;

    // Ensure the parent is positioned so the overlay can fill it.
    var style = window.getComputedStyle(parent);
    if (style.position === 'static') {
      parent.style.position = 'relative';
    }

    // Build the overlay element.
    var overlay = document.createElement('div');
    overlay.className = 'map-iframe-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    var spinner = document.createElement('div');
    spinner.className = 'map-iframe-spinner';

    var label = document.createElement('span');
    label.className = 'map-iframe-overlay-text';
    label.textContent = 'Loading\u2026';

    overlay.appendChild(spinner);
    overlay.appendChild(label);

    // Insert overlay before the iframe so it renders on top via z-index.
    parent.insertBefore(overlay, iframe);

    // Hide the overlay once the iframe content has loaded.
    iframe.addEventListener('load', function () {
      overlay.classList.add('loaded');
    });
  }

  /**
   * Scan the document for all iframes and attach spinners to those that do
   * not already have one.
   */
  function attachAll() {
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      attach(iframes[i]);
    }
  }

  // Run after the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll);
  } else {
    attachAll();
  }

  // Expose API for programmatic use.
  window.iframeSpinner = { attach: attach, attachAll: attachAll };

})();
