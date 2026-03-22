/**
 * help-modal.js — COHO Analytics
 * Reusable "How to Use This Page" help modal component.
 *
 * Usage:
 *   CohoHelp.init({
 *     title: 'How to Use This Page',
 *     description: 'Optional intro text…',
 *     steps: [
 *       { label: 'Step label', desc: 'Step description.' },
 *       …
 *     ],
 *     tips: ['Tip one', 'Tip two'],   // optional
 *   });
 *
 * This creates a "?" button appended to the first <h1> on the page and wires
 * it to a fully accessible modal dialog.
 */
(function () {
  'use strict';

  var BACKDROP_ID = 'helpModalBackdrop';

  /* ── Inject link to help-modal.css ──────────────────────── */
  function injectCss() {
    if (document.getElementById('help-modal-css')) return;
    var link = document.createElement('link');
    link.id = 'help-modal-css';
    link.rel = 'stylesheet';
    var prefix = typeof __PATH_PREFIX !== 'undefined' ? __PATH_PREFIX : '';
    link.href = prefix + 'css/help-modal.css';
    document.head.appendChild(link);
  }

  /* ── HTML escape ─────────────────────────────────────────── */
  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Build modal HTML ─────────────────────────────────────── */
  function buildModalHtml(config) {
    var stepsHtml = (config.steps || []).map(function (step, i) {
      return '<li class="help-step">' +
        '<span class="help-step-num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<div class="help-step-content">' +
          '<p class="help-step-label">' + esc(step.label) + '</p>' +
          (step.desc ? '<p class="help-step-desc">' + esc(step.desc) + '</p>' : '') +
        '</div>' +
        '</li>';
    }).join('');

    var tipsHtml = '';
    if (config.tips && config.tips.length) {
      tipsHtml = '<p class="help-tips-heading">Tips</p>' +
        '<ul class="help-tips">' +
        config.tips.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') +
        '</ul>';
    }

    return [
      '<div class="help-modal-backdrop" id="' + BACKDROP_ID + '" role="dialog" aria-modal="true" aria-label="' + esc(config.title || 'How to Use This Page') + '">',
        '<div class="help-modal" tabindex="-1" id="helpModalPanel">',
          '<div class="help-modal-header">',
            '<h2 class="help-modal-title">' + esc(config.title || 'How to Use This Page') + '</h2>',
            '<button class="help-modal-close" id="helpModalClose" type="button" aria-label="Close help">✕</button>',
          '</div>',
          '<div class="help-modal-body">',
            (config.description ? '<p class="help-modal-desc">' + esc(config.description) + '</p>' : ''),
            (stepsHtml ? '<ol class="help-steps" aria-label="Steps">' + stepsHtml + '</ol>' : ''),
            tipsHtml,
          '</div>',
          '<div class="help-modal-footer">',
            '<button class="btn" id="helpModalDone" type="button">Got it</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  /* ── Open modal ──────────────────────────────────────────── */
  function openModal(config) {
    if (document.getElementById(BACKDROP_ID)) return;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = buildModalHtml(config);
    var backdrop = wrapper.firstChild;
    document.body.appendChild(backdrop);

    var panel = document.getElementById('helpModalPanel');
    if (panel) panel.focus();

    document.getElementById('helpModalClose').addEventListener('click', closeModal);
    document.getElementById('helpModalDone').addEventListener('click', closeModal);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', onKeyDown);
  }

  function closeModal() {
    var bd = document.getElementById(BACKDROP_ID);
    if (bd) bd.remove();
    document.removeEventListener('keydown', onKeyDown);
    // Return focus to trigger button
    var btn = document.getElementById('helpTriggerBtn');
    if (btn) btn.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeModal();
  }

  /* ── Inject trigger button next to page h1 ───────────────── */
  function injectTrigger(config) {
    if (document.getElementById('helpTriggerBtn')) return;

    var h1 = document.querySelector('main h1, #main-content h1, h1');
    if (!h1) return;

    var btn = document.createElement('button');
    btn.id = 'helpTriggerBtn';
    btn.className = 'help-trigger';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'How to use this page — open help');
    btn.setAttribute('title', 'How to use this page');
    btn.textContent = '?';
    btn.addEventListener('click', function () { openModal(config); });

    h1.appendChild(btn);
  }

  /* ── Public API ──────────────────────────────────────────── */
  window.CohoHelp = {
    /**
     * Initialize the help modal for the current page.
     * @param {Object} config
     * @param {string} config.title        - Modal heading
     * @param {string} [config.description] - Intro paragraph
     * @param {Array}  config.steps         - [{label, desc}]
     * @param {Array}  [config.tips]        - ['tip text', …]
     */
    init: function (config) {
      injectCss();

      function setup() {
        injectTrigger(config);
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
      } else {
        // Wait for navigation injection before looking for h1
        if (document.querySelector('main h1, #main-content h1, h1')) {
          setup();
        } else {
          document.addEventListener('nav:rendered', setup);
          setTimeout(setup, 300); // fallback
        }
      }
    },

    open: openModal,
    close: closeModal
  };
})();
