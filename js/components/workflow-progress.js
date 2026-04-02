/**
 * workflow-progress.js — COHO Analytics
 * Reusable 5-step workflow progress bar component.
 *
 * Reads step completion from WorkflowState when available, so each page no
 * longer needs to inline duplicate progress-bar styles and markup.
 *
 * Usage:
 *   WorkflowProgress.render('myContainerId', 2);
 *   WorkflowProgress.render('myContainerId', 3, { doneSteps: [1, 2] });
 *   WorkflowProgress.refresh('myContainerId');
 *
 * Requires: workflow-state.js (optional but recommended)
 */
(function (global) {
  'use strict';

  /* ── Step definitions ───────────────────────────────────────────────────── */

  var STEPS = [
    { num: 1, label: 'Jurisdiction',     href: 'select-jurisdiction.html' },
    { num: 2, label: 'Needs Assessment', href: 'housing-needs-assessment.html' },
    { num: 3, label: 'Market Analysis',  href: 'market-analysis.html' },
    { num: 4, label: 'Scenarios',        href: 'hna-scenario-builder.html' },
    { num: 5, label: 'Deal',             href: 'deal-calculator.html' }
  ];

  /* ── relToRoot — mirrors navigation.js pattern ──────────────────────────── */

  function relToRoot() {
    if (location.pathname.includes('/private/weekly-brief/')) { return '../../'; }
    if (location.pathname.includes('/docs/'))                 { return '../'; }
    return '';
  }

  /* ── Inject CSS once ────────────────────────────────────────────────────── */

  function ensureStyles() {
    if (document.getElementById('wf-progress-styles')) { return; }
    var s = document.createElement('style');
    s.id = 'wf-progress-styles';
    s.textContent = [
      '.wf-progress-wrap{max-width:1200px;margin:0 auto;padding:14px 18px 0;}',
      '.wf-progress-steps{display:flex;align-items:center;gap:0;}',
      '.wf-step{display:flex;flex-direction:column;align-items:center;text-align:center;',
        'text-decoration:none;color:var(--muted);min-width:80px;}',
      '.wf-step__num{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;',
        'justify-content:center;font-size:.78rem;font-weight:700;background:var(--bg2);',
        'color:var(--muted);border:2px solid var(--border);z-index:1;}',
      '.wf-step__label{font-size:.68rem;color:var(--muted);margin-top:4px;line-height:1.2;font-weight:600;}',
      '.wf-step--active .wf-step__num{background:var(--accent);color:#fff;border-color:var(--accent);}',
      '.wf-step--active .wf-step__label{color:var(--accent);}',
      '.wf-step--done .wf-step__num{background:var(--good,#047857);color:#fff;border-color:var(--good,#047857);}',
      '.wf-step--done .wf-step__label{color:var(--good,#047857);}',
      '.wf-step-connector{flex:1;height:2px;background:var(--border);min-width:20px;margin-bottom:18px;}',
      '@media(max-width:480px){',
      '  .wf-progress-steps{gap:0;overflow-x:auto;}',
      '  .wf-step{min-width:60px;}',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Read completion from WorkflowState ─────────────────────────────────── */

  function getDoneSteps() {
    if (!global.WorkflowState) { return []; }
    var done = [];
    var proj = global.WorkflowState.getActiveProject();
    if (!proj || !proj.steps) {
      // WorkflowState stores step data at the top level of the project object,
      // not nested under a "steps" key — check those keys directly.
      if (!proj) { return done; }
    }

    // Map WorkflowState step keys to step numbers
    var map = { jurisdiction: 1, hsa: 2, market: 3, scenario: 4, deal: 5 };
    var keys = Object.keys(map);
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var stepData = proj[k] || (proj.steps && proj.steps[k]);
      if (stepData && stepData.completedAt) {
        done.push(map[k]);
      }
    }
    return done;
  }

  /* ── Build HTML for a single step ──────────────────────────────────────── */

  function buildStepHtml(step, activeStep, doneSteps) {
    var isDone   = (doneSteps.indexOf(step.num) !== -1);
    var isActive = (step.num === activeStep);

    var classes  = 'wf-step';
    if (isDone)   { classes += ' wf-step--done'; }
    if (isActive) { classes += ' wf-step--active'; }

    var ariaAttr  = isActive ? ' aria-current="step"' : '';
    var numText   = isDone ? '\u2713' : String(step.num);
    var labelText = step.label;

    // Done and upcoming steps (not the active step) get links; active stays div
    var useLink = !isActive;
    var tag, tagClose, hrefAttr;

    if (useLink) {
      tag      = 'a';
      tagClose = '</a>';
      hrefAttr = ' href="' + relToRoot() + step.href + '"';
    } else {
      tag      = 'div';
      tagClose = '</div>';
      hrefAttr = '';
    }

    return (
      '<' + tag + ' class="' + classes + '"' + hrefAttr +
        ' data-step="' + step.num + '"' + ariaAttr + '>' +
        '<span class="wf-step__num">' + numText + '</span>' +
        '<span class="wf-step__label">' + labelText + '</span>' +
      tagClose
    );
  }

  /* ── Build complete progress bar HTML ───────────────────────────────────── */

  function buildHtml(activeStep, doneSteps) {
    var parts = [];
    var i;
    for (i = 0; i < STEPS.length; i++) {
      if (i > 0) {
        parts.push('<div class="wf-step-connector"></div>');
      }
      parts.push(buildStepHtml(STEPS[i], activeStep, doneSteps));
    }
    return (
      '<div class="wf-progress-wrap">' +
        '<div class="wf-progress-steps" role="navigation" aria-label="Workflow steps">' +
          parts.join('') +
        '</div>' +
      '</div>'
    );
  }

  /* ── Resolve doneSteps from options or WorkflowState ────────────────────── */

  function resolveDoneSteps(activeStep, options) {
    // Explicit caller-supplied list takes precedence
    if (options && Array.isArray(options.doneSteps)) {
      return options.doneSteps;
    }
    // Auto-compute from WorkflowState
    var fromState = getDoneSteps();
    if (fromState.length > 0) {
      return fromState;
    }
    // Conservative fallback: mark all steps before activeStep as done
    var fallback = [];
    var i;
    for (i = 1; i < activeStep; i++) {
      fallback.push(i);
    }
    return fallback;
  }

  /* ── Store last render args per container for refresh() ─────────────────── */

  var _lastArgs = {};   // { [containerId]: { activeStep, options } }

  /* ══════════════════════════════════════════════════════════════════════════
   * Public API — window.WorkflowProgress
   * ══════════════════════════════════════════════════════════════════════════ */

  var WorkflowProgress = {

    /**
     * Render (or re-render) the workflow progress bar into a DOM container.
     *
     * @param {string} containerId  ID of the element to inject into.
     * @param {number} activeStep   Current step number (1–5).
     * @param {Object} [options]
     * @param {number[]} [options.doneSteps]  Explicit list of completed step
     *   numbers; auto-computed from WorkflowState when omitted.
     */
    render: function (containerId, activeStep, options) {
      ensureStyles();

      var container = document.getElementById(containerId);
      if (!container) {
        console.warn('[WorkflowProgress] Container not found: #' + containerId);
        return;
      }

      var step = parseInt(activeStep, 10) || 1;
      var done = resolveDoneSteps(step, options);

      container.innerHTML = buildHtml(step, done);

      // Remember args so refresh() can re-render without caller knowledge
      _lastArgs[containerId] = { activeStep: step, options: options || null };
    },

    /**
     * Re-render the progress bar using the current WorkflowState, preserving
     * the activeStep that was supplied in the last render() call.
     *
     * @param {string} containerId  ID of the element to refresh.
     */
    refresh: function (containerId) {
      var last = _lastArgs[containerId];
      if (!last) {
        console.warn('[WorkflowProgress] refresh() called before render() for #' + containerId);
        return;
      }
      WorkflowProgress.render(containerId, last.activeStep, last.options);
    }

  };

  /* ── Expose globally ────────────────────────────────────────────────────── */
  global.WorkflowProgress = WorkflowProgress;

}(typeof window !== 'undefined' ? window : this));
