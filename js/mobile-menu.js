/**
 * mobile-menu.js — Affordable Housing Intelligence
 *
 * Handles the mobile hamburger menu injected by navigation.js.
 * - Toggles nav.site-nav visibility on small screens.
 * - Closes the menu when a link is clicked.
 * - Closes the menu on Escape key.
 * - Prevents body scroll while the menu is open.
 * - Touch-friendly (44 × 44 px minimum button target).
 *
 * This script is self-contained and has no external dependencies.
 * It fires after navigation.js has injected the header.
 */
(function () {
  'use strict';

  var BREAKPOINT = 768;   // px — menu collapses below this width
  var menuBtn    = null;
  var navEl      = null;

  /**
   * Returns true when the viewport is below the mobile breakpoint.
   */
  function isMobile() {
    return window.innerWidth < BREAKPOINT;
  }

  /**
   * Open the mobile navigation menu.
   */
  function openMenu() {
    if (!navEl || !menuBtn) return;
    navEl.classList.add('nav-expanded');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close the mobile navigation menu.
   */
  function closeMenu() {
    if (!navEl || !menuBtn) return;
    navEl.classList.remove('nav-expanded');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  /**
   * Toggle open/closed state.
   */
  function toggleMenu() {
    var isOpen = menuBtn && menuBtn.getAttribute('aria-expanded') === 'true';
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  /**
   * Create and inject the hamburger button into the nav-wrap.
   */
  function injectMenuButton() {
    var wrap = document.querySelector('.nav-wrap');
    if (!wrap) return;

    navEl = wrap.querySelector('nav.site-nav');
    if (!navEl) return;

    // Avoid injecting twice
    if (wrap.querySelector('.mobile-menu-btn')) {
      menuBtn = wrap.querySelector('.mobile-menu-btn');
      return;
    }

    menuBtn = document.createElement('button');
    menuBtn.className = 'mobile-menu-btn';
    menuBtn.type      = 'button';
    menuBtn.setAttribute('aria-label', 'Open navigation menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', 'site-nav-list');
    menuBtn.innerHTML =
      '<span></span>' +
      '<span></span>' +
      '<span></span>';

    // Ensure nav has an id for aria-controls
    if (!navEl.id) navEl.id = 'site-nav-list';

    menuBtn.addEventListener('click', toggleMenu);
    wrap.insertBefore(menuBtn, navEl);

    // Close menu when any nav link is clicked
    navEl.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });
  }

  /**
   * Handle keyboard events.
   */
  function onKeydown(e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      if (menuBtn && menuBtn.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        menuBtn.focus();
      }
    }
  }

  /**
   * On resize: restore nav to visible state when switching to desktop.
   */
  function onResize() {
    if (!isMobile() && navEl) {
      navEl.classList.remove('nav-expanded');
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
  }

  /**
   * Initialise after the navigation has been injected.
   */
  function init() {
    injectMenuButton();
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
  }

  // Run after navigation.js fires its 'nav:rendered' event,
  // or fall back to DOMContentLoaded.
  document.addEventListener('nav:rendered', init);

  if (document.readyState !== 'loading') {
    // nav:rendered may have already fired; try initialising now
    if (!menuBtn) init();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (!menuBtn) init();
    });
  }
})();
