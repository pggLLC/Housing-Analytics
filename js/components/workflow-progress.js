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

  // 6-step model. Page-level workflow bars carry the same numbering inline;
  // this constant is used by the dynamic .render() path and is the ONLY place
  // a step number is written down — getDoneSteps() derives its WorkflowState
  // key → number map from `key` below rather than keeping a second table that
  // can disagree with this one (it did, through two renumbers).
  var STEPS = [
    // Jurisdiction first. A novice's step 1 is "pick my town" — the
    // Opportunity Finder is a STATEWIDE screening tool, useful to someone
    // deciding where to look and a detour for the far more common visitor who
    // already knows which town they are working on. Putting it first made the
    // guided path open on a question most readers had already answered.
    //
    // The finder stays on the route as step 2 rather than being removed: it is
    // the right tool for "where should we build", and #1620 §7 is explicit that
    // this slice is route and copy only — no page moves, no deletions.
    { num: 1, key: 'jurisdiction', label: 'Jurisdiction',       href: 'select-jurisdiction.html' },
    { num: 2, key: 'opportunity',  label: 'Opportunity Finder', href: 'lihtc-opportunity-finder.html' },
    // Part 1 of 5, not the full report. The canonical assessment is 53
    // sections and ~15,800 words; sending someone who has just chosen their
    // town into that is where the guided path stopped being guided. The
    // chapters carry the same content in 11-15 section parts and each one
    // offers 'Full report →' for anyone who wants the whole thing.
    { num: 3, key: 'hsa',          label: 'Needs Assessment',   href: 'hna-what-housing-exists.html' },
    { num: 4, key: 'market',       label: 'Market Analysis',    href: 'market-analysis.html' },
    { num: 5, key: 'scenario',     label: 'Scenarios',          href: 'hna-scenario-builder.html' },
    { num: 6, key: 'deal',         label: 'Deal',               href: 'deal-calculator.html' }
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
      /* Workflow stepper sits BELOW the sticky site header (which is
         z-index:1000, top:0) but ABOVE the page content. Make it
         stick too so it stays visible on scroll — previously it
         scrolled away with the rest of the page, which left users
         wondering where they were in the 5-step flow once they
         started reading mid-page. */
      '.wf-progress-wrap{box-sizing:border-box;width:100%;max-width:1200px;margin:0 auto;padding:10px 18px;' +
        'position:sticky;top:var(--site-header-h,58px);z-index:900;background:var(--bg);' +
        'border-bottom:1px solid var(--border);overflow:hidden;}',
      '.wf-progress-steps{display:flex;align-items:center;gap:0;width:100%;max-width:1200px;margin:0 auto;min-width:0;}',
      '.wf-step{display:flex;flex-direction:column;align-items:center;text-align:center;',
        'text-decoration:none;color:var(--muted);min-width:80px;}',
      '.wf-step__num{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;',
        'justify-content:center;font-size:.78rem;font-weight:700;background:var(--bg2);',
        'color:var(--muted);border:2px solid var(--border);z-index:1;}',
      '.wf-step__label{font-size:.68rem;color:var(--muted);margin-top:4px;line-height:1.2;font-weight:600;}',
      '.wf-step--active .wf-step__num{background:var(--accent);color: var(--on-accent, #fff);border-color:var(--accent);}',
      '.wf-step--active .wf-step__label{color:var(--accent);}',
      '.wf-step--done .wf-step__num{background:var(--good,#047857);color:#fff;border-color:var(--good,#047857);}',
      '.wf-step--done .wf-step__label{color:var(--good,#047857);}',
      '.wf-step-connector{flex:1;height:2px;background:var(--border);min-width:20px;margin-bottom:18px;}',
      '@media(max-width:480px){',
      '  .wf-progress-wrap{box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:8px 10px;overflow:hidden;}',
      '  .wf-progress-steps{box-sizing:border-box;width:100%;max-width:100%;min-width:0;gap:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;}',
      '  .wf-progress-steps::-webkit-scrollbar{display:none;}',
      '  .wf-step{flex:0 0 58px;min-width:58px;}',
      '  .wf-step-connector{flex:0 0 12px;min-width:12px;}',
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

    // Derived from STEPS, so a reorder moves the numbers here too. A parallel
    // literal used to live at this line and survived the #1620 reorder pointing
    // at the wrong steps — a finished jurisdiction would have ticked the finder.
    // "opportunity" is a forward-compat key; WorkflowState doesn't write it
    // today, so that step is normally surfaced via the conservative fallback in
    // resolveDoneSteps() (any step < activeStep counts as done), not this map.
    var map = {};
    for (var m = 0; m < STEPS.length; m++) { map[STEPS[m].key] = STEPS[m].num; }
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
    },

    /**
     * Fix #2: Update step completion classes on an *existing* hardcoded progress
     * bar without replacing its DOM.  Call this on DOMContentLoaded for any page
     * that has a statically-rendered `.wf-step[data-step]` progress bar.
     *
     * - Steps that WorkflowState records as completed get `wf-step--done` + ✓ num.
     * - The declared activeStep keeps `wf-step--active` and is never overwritten.
     * - Future `refresh(containerId)` calls will work after this runs.
     *
     * @param {string} containerId  ID of the wrapper element.
     * @param {number} activeStep   The step number this page represents.
     */
    refreshSteps: function (containerId, activeStep) {
      ensureStyles();   // Fix #17: inject CSS if not already present
      var container = document.getElementById(containerId);
      if (!container) return;

      var step = parseInt(activeStep, 10) || 1;
      var done = resolveDoneSteps(step, null);

      var stepEls = container.querySelectorAll('.wf-step[data-step]');
      for (var i = 0; i < stepEls.length; i++) {
        var el  = stepEls[i];
        var num = parseInt(el.getAttribute('data-step'), 10);
        if (!num) continue;

        var isActive = (num === step);
        var isDone   = (done.indexOf(num) !== -1);

        el.classList.toggle('wf-step--done',   isDone   && !isActive);
        el.classList.toggle('wf-step--active', isActive);

        var numEl = el.querySelector('.wf-step__num');
        if (numEl) {
          numEl.textContent = (isDone && !isActive) ? '\u2713' : String(num);
        }
      }

      // Register so subsequent refresh(containerId) calls work correctly
      _lastArgs[containerId] = { activeStep: step, options: null };
    }

  };

  /* ── Publish the real header height ──────────────────────────────────────
     The sticky workflow strip pins below the site header. Its offset used to
     be a hardcoded 58px in site-theme.css, described in a comment as "height
     of the sticky site header" -- but the header is 61px at desktop and 70px
     at 375px wide, because its contents wrap and the root font-size is fluid.
     The strip therefore slid under the header by 3px on desktop and 12px on
     mobile, hiding its own top edge.

     Measuring beats guessing here: the height moves with viewport, font size
     and zoom, so no constant is right everywhere. ResizeObserver keeps the
     variable correct as the header reflows; the resize listener covers
     browsers without it. Cheap -- it writes one custom property and only when
     the value actually changes. */
  function publishHeaderHeight() {
    var observed = null;
    var ro = null;

    function apply() {
      // Re-query every time: the header is re-rendered by the nav component
      // after DOMContentLoaded, so a reference captured once ends up pointing
      // at a detached node and the observer goes quiet. That is exactly how an
      // early 1px pre-layout measurement got latched in during testing.
      var header = document.querySelector('.site-header');
      if (!header) return;

      if (observed !== header) {
        observed = header;
        if (ro) { try { ro.disconnect(); } catch (e) { /* non-fatal */ } }
        if (typeof ResizeObserver === 'function') {
          try { ro = new ResizeObserver(apply); ro.observe(header); } catch (e) { ro = null; }
        }
      }

      var h = Math.round(header.getBoundingClientRect().height);
      // A header this short has not been laid out yet. Publishing it would pin
      // the strip to the top of the viewport until something else moved.
      if (h < 24) return;

      if (document.documentElement.style.getPropertyValue('--site-header-h') !== h + 'px') {
        document.documentElement.style.setProperty('--site-header-h', h + 'px');
      }

      // Publish the progress strip's height too, so anchor navigation can clear
      // BOTH sticky bars. Without this, clicking a contents-rail link scrolled
      // the target heading underneath the header and the strip, and the reader
      // landed on a section whose own title was hidden -- the one thing an
      // in-page link exists to prevent. css/site-theme.css consumes this in a
      // single `html { scroll-padding-top: ... }` rule, which covers ordinary
      // anchors, :target, and scrollIntoView alike.
      //
      // Measured rather than assumed: the strip is present on the HNA pages and
      // absent elsewhere, and its height changes with wrapping at narrow widths.
      var strip = document.querySelector('.wf-progress-wrap, .workflow-progress');
      var sh = strip ? Math.round(strip.getBoundingClientRect().height) : 0;
      // A strip mid-layout reports a few pixels; publishing that would under-pad
      // the scroll and reintroduce the bug it is meant to fix.
      if (strip && sh < 16) return;
      if (document.documentElement.style.getPropertyValue('--wf-progress-h') !== sh + 'px') {
        document.documentElement.style.setProperty('--wf-progress-h', sh + 'px');
      }
    }

    apply();
    window.addEventListener('load', apply);
    window.addEventListener('resize', apply, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', publishHeaderHeight);
  } else {
    publishHeaderHeight();
  }

  /* ── Expose globally ────────────────────────────────────────────────────── */
  global.WorkflowProgress = WorkflowProgress;

}(typeof window !== 'undefined' ? window : this));
