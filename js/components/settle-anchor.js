/**
 * js/components/settle-anchor.js
 * Keep a linked section in view while the page renders its data.
 *
 * Housing News links to sections that sit below lists rendered after page
 * load (colorado-elections.html#people-and-roles, the policy watch on
 * housing-legislation-2026.html). The browser scrolls to the anchor at once,
 * then the lists above it arrive and push it off screen: measured 2026-09-28,
 * the officials section ended 9,117px below the top of the window a reader
 * had been sent to.
 *
 * So for a few seconds after load, whenever the page's content changes, the
 * target is scrolled back to the top. It stops as soon as the reader scrolls,
 * types, clicks or touches, or after SETTLE_MS, so it never fights a reader.
 */
(function () {
  'use strict';
  var SETTLE_MS = 4000;
  var hash = window.location.hash;
  if (!hash || hash.length < 2 || typeof MutationObserver === 'undefined') return;
  var id;
  try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return; }

  var done = false;
  var observer;
  function stop() {
    if (done) return;
    done = true;
    if (observer) observer.disconnect();
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
      window.removeEventListener(type, stop, true);
    });
  }
  function settle() {
    if (done) return;
    var target = document.getElementById(id);
    if (target && !target.hidden && target.scrollIntoView) target.scrollIntoView();
  }

  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (type) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  });
  function start() {
    observer = new MutationObserver(settle);
    observer.observe(document.body, { childList: true, subtree: true });
    settle();
    setTimeout(function () { settle(); stop(); }, SETTLE_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
