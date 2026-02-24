/**
 * js/scroll-fix.js
 * Forces every page to scroll to the top on load.
 * Disables the browser's automatic scroll-restoration so that pressing
 * Back/Forward doesn't accidentally restore a mid-page position.
 */
(function () {
  'use strict';

  if (window.history && window.history.scrollRestoration) {
    window.history.scrollRestoration = 'manual';
  }

  function scrollTop() {
    window.scrollTo(0, 0);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('load', scrollTop);
  } else {
    scrollTop();
  }
})();
