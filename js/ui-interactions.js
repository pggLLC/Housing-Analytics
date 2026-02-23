/**
 * ui-interactions.js — Loading states, micro-interactions, and data freshness
 * Enhances the Colorado Deep Dive page UX without modifying core logic.
 */
(function () {
  'use strict';

  // ── Loading spinner ──────────────────────────────────────────────────────────
  var SPINNER_HTML = '<span class="ui-spinner" aria-hidden="true"></span>';

  function showLoadingState(containerEl, message) {
    if (!containerEl) return;
    containerEl.setAttribute('data-loading', 'true');
    var existing = containerEl.querySelector('.ui-loading-overlay');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.className = 'ui-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = SPINNER_HTML + '<span class="ui-loading-msg">' + (message || 'Loading…') + '</span>';
    containerEl.classList.add('ui-relative');
    containerEl.appendChild(overlay);
  }

  function hideLoadingState(containerEl) {
    if (!containerEl) return;
    containerEl.removeAttribute('data-loading');
    var overlay = containerEl.querySelector('.ui-loading-overlay');
    if (overlay) overlay.remove();
  }

  // ── Data freshness badge ─────────────────────────────────────────────────────
  function updateFreshnessBadge(el, dateString) {
    if (!el) return;
    var label = dateString ? 'Updated ' + dateString : 'Last updated: —';
    el.textContent = label;
    el.setAttribute('title', 'Data freshness indicator');
  }

  function stampFreshnessNow(el) {
    if (!el) return;
    var now = new Date();
    var label = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    updateFreshnessBadge(el, label);
  }

  // ── Card hover micro-interactions ────────────────────────────────────────────
  function initCardHovers() {
    var cards = document.querySelectorAll('.kpi-card, .chart-card');
    cards.forEach(function (card) {
      if (card.dataset.hoverInit) return;
      card.dataset.hoverInit = '1';
      card.addEventListener('mouseenter', function () {
        card.classList.add('is-hovered');
      });
      card.addEventListener('mouseleave', function () {
        card.classList.remove('is-hovered');
      });
    });
  }

  // ── Button press micro-interaction ───────────────────────────────────────────
  function initButtonPress() {
    document.addEventListener('mousedown', function (e) {
      var btn = e.target.closest('.btn, button');
      if (!btn || btn.disabled) return;
      btn.classList.add('is-pressed');
    });
    document.addEventListener('mouseup', function () {
      document.querySelectorAll('.is-pressed').forEach(function (el) {
        el.classList.remove('is-pressed');
      });
    });
  }

  // ── Smooth tab transitions ───────────────────────────────────────────────────
  function initTabTransitions() {
    var tabBtns = document.querySelectorAll('[role="tab"]');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) {
          panel.style.opacity = '0';
          requestAnimationFrame(function () {
            panel.style.transition = 'opacity 0.15s ease';
            panel.style.opacity = '1';
          });
        }
      });
    });
  }

  // ── Expose public API ────────────────────────────────────────────────────────
  window.uiInteractions = {
    showLoadingState: showLoadingState,
    hideLoadingState: hideLoadingState,
    updateFreshnessBadge: updateFreshnessBadge,
    stampFreshnessNow: stampFreshnessNow
  };

  // ── Boot ─────────────────────────────────────────────────────────────────────
  function init() {
    initCardHovers();
    initButtonPress();
    initTabTransitions();

    // Stamp freshness badges found on the page
    document.querySelectorAll('[data-freshness]').forEach(function (el) {
      var src = el.getAttribute('data-freshness');
      if (src === 'now') {
        stampFreshnessNow(el);
      } else if (src) {
        updateFreshnessBadge(el, src);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
