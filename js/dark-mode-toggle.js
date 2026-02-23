/**
 * dark-mode-toggle.js — Affordable Housing Intelligence
 *
 * Detects the OS colour-scheme preference, allows the user to
 * manually override it, and persists the choice to localStorage.
 *
 * Usage: include this script in any page that needs the toggle.
 * No external dependencies required.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'lihtc-color-scheme';
  var CLASS_DARK  = 'dark-mode';
  var CLASS_LIGHT = 'light-mode';

  /**
   * Returns the stored preference, or null if none has been set.
   * @returns {'dark'|'light'|null}
   */
  function getStoredPreference() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  /**
   * Saves the user's explicit choice.
   * @param {'dark'|'light'} scheme
   */
  function savePreference(scheme) {
    try {
      localStorage.setItem(STORAGE_KEY, scheme);
    } catch (_) { /* storage may be unavailable */ }
  }

  /**
   * Returns true when the OS prefers dark mode.
   * @returns {boolean}
   */
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Apply the given scheme to <html>.
   * @param {'dark'|'light'} scheme
   */
  function applyScheme(scheme) {
    var html = document.documentElement;
    if (scheme === 'dark') {
      html.classList.add(CLASS_DARK);
      html.classList.remove(CLASS_LIGHT);
    } else {
      html.classList.add(CLASS_LIGHT);
      html.classList.remove(CLASS_DARK);
    }
    updateToggleButton(scheme);
  }

  /**
   * Toggle between dark and light modes.
   */
  function toggle() {
    var html = document.documentElement;
    var next = html.classList.contains(CLASS_DARK) ? 'light' : 'dark';
    applyScheme(next);
    savePreference(next);
  }

  /**
   * Update the accessible label and icon on the toggle button.
   * @param {'dark'|'light'} scheme
   */
  function updateToggleButton(scheme) {
    var btn = document.querySelector('.dark-mode-toggle');
    if (!btn) return;
    var isDark = scheme === 'dark';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', String(isDark));
    btn.textContent = isDark ? '☀' : '🌙';
  }

  /**
   * Inject the floating toggle button into the page.
   */
  function injectToggleButton() {
    if (document.querySelector('.dark-mode-toggle')) return;
    var btn = document.createElement('button');
    btn.className    = 'dark-mode-toggle';
    btn.type         = 'button';
    btn.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
  }

  /**
   * Initialise: apply correct scheme before first paint to avoid flash.
   */
  function init() {
    var stored = getStoredPreference();
    var scheme = stored || (systemPrefersDark() ? 'dark' : 'light');

    // Apply immediately (before DOMContentLoaded) to prevent FOUC
    applyScheme(scheme);

    // Inject the button once the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectToggleButton);
    } else {
      injectToggleButton();
    }

    // React to OS-level preference changes (only when user hasn't overridden)
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!getStoredPreference()) {
          applyScheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  init();
})();
