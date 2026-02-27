/**
 * mobile-menu.js — Affordable Housing Intelligence
 *
 * Handles the mobile navigation drawer injected by navigation.js.
 * - Slide-in drawer with backdrop.
 * - Focus trap, aria attributes, scroll lock.
 * - Close on backdrop click, close button, link click, Escape.
 * - Returns focus to toggle button on close.
 *
 * Falls back to the legacy overlay menu if the drawer elements
 * are not present (e.g., older page templates).
 *
 * This script is self-contained and has no external dependencies.
 * It fires after navigation.js has injected the header.
 */
(function () {
  'use strict';

  var MOBILE_BREAKPOINT = 768;  // px — matches nav CSS media query

  /* ── Drawer elements ─────────────────────────────────── */
  var toggle   = null;   // #mobileNavToggle
  var drawer   = null;   // #mobileNavDrawer
  var closeBtn = null;   // #mobileNavClose
  var backdrop = null;   // .mobile-nav-backdrop (created dynamically)

  /* ── State ───────────────────────────────────────────── */
  var previouslyFocused = null;
  var prevOverflow      = '';

  /* ─────────────────────────────────────────────────────
     Drawer implementation
  ───────────────────────────────────────────────────── */

  function createBackdrop() {
    var el = document.createElement('div');
    el.className = 'mobile-nav-backdrop';
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('click', closeDrawer);
    document.body.appendChild(el);
    return el;
  }

  function openDrawer() {
    if (!toggle || !drawer) return;
    previouslyFocused = document.activeElement;
    prevOverflow = document.documentElement.style.overflow;

    // Show elements
    backdrop.removeAttribute('hidden');
    drawer.removeAttribute('hidden');

    // Animate on next frame so the transition plays
    requestAnimationFrame(function () {
      drawer.dataset.open = 'true';
    });

    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';

    // Focus first link
    var firstLink = drawer.querySelector('a, button');
    if (firstLink) firstLink.focus();
  }

  function closeDrawer() {
    if (!toggle || !drawer) return;
    drawer.dataset.open = 'false';
    toggle.setAttribute('aria-expanded', 'false');

    // Wait for CSS transition before hiding
    var duration = getTransitionDuration(drawer);
    setTimeout(function () {
      drawer.setAttribute('hidden', '');
      backdrop.setAttribute('hidden', '');
      document.documentElement.style.overflow = prevOverflow;
      if (previouslyFocused && previouslyFocused.focus) {
        previouslyFocused.focus();
      }
    }, duration);
  }

  function toggleDrawer() {
    if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  /** Return the CSS transition duration in ms (defaults to 200). */
  function getTransitionDuration(el) {
    try {
      var raw = window.getComputedStyle(el).transitionDuration || '';
      var seconds = parseFloat(raw);
      return isNaN(seconds) ? 200 : Math.round(seconds * 1000);
    } catch (e) {
      return 200;
    }
  }

  /* ── Focus trap ──────────────────────────────────────── */
  function getFocusable() {
    return Array.prototype.slice.call(
      drawer.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  function onKeydown(e) {
    var key = e.key || e.keyCode;

    // Escape: close drawer (or legacy menu)
    if (key === 'Escape' || key === 27) {
      if (drawer && toggle && toggle.getAttribute('aria-expanded') === 'true') {
        closeDrawer();
        return;
      }
      // Legacy fallback
      if (legacyMenuBtn && legacyMenuBtn.getAttribute('aria-expanded') === 'true') {
        legacyCloseMenu();
        legacyMenuBtn.focus();
      }
      return;
    }

    // Tab: trap focus inside drawer while open
    if ((key === 'Tab' || key === 9) &&
        drawer && toggle && toggle.getAttribute('aria-expanded') === 'true') {
      var focusable = getFocusable();
      if (focusable.length === 0) { e.preventDefault(); return; }
      var first = focusable[0];
      var last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  /* ── Drawer init ─────────────────────────────────────── */
  function initDrawer() {
    toggle   = document.getElementById('mobileNavToggle');
    drawer   = document.getElementById('mobileNavDrawer');
    closeBtn = document.getElementById('mobileNavClose');

    if (!toggle || !drawer) return false;  // fall through to legacy

    backdrop = createBackdrop();

    toggle.addEventListener('click', toggleDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    // Close on any link click inside the drawer
    drawer.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeDrawer);
    });

    document.addEventListener('keydown', onKeydown);

    // Close drawer when viewport becomes desktop-sized
    window.addEventListener('resize', function () {
      if (window.innerWidth >= MOBILE_BREAKPOINT &&
          toggle.getAttribute('aria-expanded') === 'true') {
        // Close without animation to avoid visual glitch
        drawer.dataset.open = 'false';
        drawer.setAttribute('hidden', '');
        backdrop.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
        document.documentElement.style.overflow = prevOverflow;
      }
    });

    return true;
  }

  /* ─────────────────────────────────────────────────────
     Legacy overlay fallback (used when drawer not found)
  ───────────────────────────────────────────────────── */
  var legacyMenuBtn = null;
  var legacyNavEl   = null;

  function legacyOpenMenu() {
    if (!legacyNavEl || !legacyMenuBtn) return;
    legacyNavEl.classList.add('nav-expanded');
    legacyMenuBtn.setAttribute('aria-expanded', 'true');
    document.documentElement.style.overflow = 'hidden';
  }

  function legacyCloseMenu() {
    if (!legacyNavEl || !legacyMenuBtn) return;
    legacyNavEl.classList.remove('nav-expanded');
    legacyMenuBtn.setAttribute('aria-expanded', 'false');
    document.documentElement.style.overflow = '';
  }

  function legacyToggleMenu() {
    var isOpen = legacyMenuBtn && legacyMenuBtn.getAttribute('aria-expanded') === 'true';
    if (isOpen) { legacyCloseMenu(); } else { legacyOpenMenu(); }
  }

  function initLegacy() {
    var wrap = document.querySelector('.nav-wrap');
    if (!wrap) return;
    legacyNavEl = wrap.querySelector('nav.site-nav');
    if (!legacyNavEl) return;

    if (wrap.querySelector('.mobile-menu-btn')) {
      legacyMenuBtn = wrap.querySelector('.mobile-menu-btn');
    } else {
      legacyMenuBtn = document.createElement('button');
      legacyMenuBtn.className = 'mobile-menu-btn';
      legacyMenuBtn.type = 'button';
      legacyMenuBtn.setAttribute('aria-label', 'Open navigation menu');
      legacyMenuBtn.setAttribute('aria-expanded', 'false');
      legacyMenuBtn.setAttribute('aria-controls', 'site-nav-list');
      legacyMenuBtn.innerHTML = '<span></span><span></span><span></span>';
      if (!legacyNavEl.id) legacyNavEl.id = 'site-nav-list';
      wrap.insertBefore(legacyMenuBtn, legacyNavEl);
    }

    legacyMenuBtn.addEventListener('click', legacyToggleMenu);
    legacyNavEl.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', legacyCloseMenu);
    });

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', function () {
      if (window.innerWidth >= MOBILE_BREAKPOINT && legacyNavEl) {
        legacyNavEl.classList.remove('nav-expanded');
        if (legacyMenuBtn) legacyMenuBtn.setAttribute('aria-expanded', 'false');
        document.documentElement.style.overflow = '';
      }
    });
  }

  /* ── Entry point ─────────────────────────────────────── */
  function init() {
    if (!initDrawer()) {
      initLegacy();
    }
  }

  // Run after navigation.js fires its 'nav:rendered' event,
  // or fall back to DOMContentLoaded.
  document.addEventListener('nav:rendered', init);

  if (document.readyState !== 'loading') {
    if (!toggle) init();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (!toggle) init();
    });
  }
})();

