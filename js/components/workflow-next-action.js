/**
 * workflow-next-action.js — "Recommended Next Action" banner component
 *
 * Renders a contextual banner on each workflow page telling the user
 * what step to take next.  Reads from WorkflowState.getProgress() and
 * the current page's data-step attribute (set on the analytics.js script tag).
 *
 * States:
 *   1. Current step incomplete, prior steps also incomplete → nudge to go back
 *   2. Current step incomplete, all priors done → "Complete this step, then…"
 *   3. Current step complete, next step exists → "Step complete! Continue to…"
 *   4. All 5 steps complete → "Workflow complete — export your summary"
 *
 * Mount:  Looks for an element with id="workflowNextAction" on the page.
 *         If absent, auto-creates one after the first .hero, .sb-hero,
 *         .dc-hero, or .sj-header element inside <main>.
 *
 * Depends on: workflow-state-core.js, workflow-state-api.js
 */
(function (global) {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────── */

  var STEP_KEYS = ['jurisdiction', 'hsa', 'market', 'scenario', 'deal'];
  var STEP_LABELS = {
    jurisdiction: 'Select Jurisdiction',
    hsa:          'Housing Needs Assessment',
    market:       'Market Analysis',
    scenario:     'Scenario Builder',
    deal:         'Deal Calculator'
  };
  var STEP_URLS = {
    jurisdiction: 'select-jurisdiction.html',
    hsa:          'housing-needs-assessment.html',
    market:       'market-analysis.html',
    scenario:     'hna-scenario-builder.html',
    deal:         'deal-calculator.html'
  };
  var STEP_ACTIONS = {
    jurisdiction: 'Choose a county and jurisdiction to start your analysis.',
    hsa:          'Review affordability gaps and housing need indicators.',
    market:       'Run a PMA scoring analysis for your target site.',
    scenario:     'Build demographic projection scenarios.',
    deal:         'Model your capital stack and pro forma.'
  };

  /* ── Detect current page step ──────────────────────────────────────── */

  function _detectCurrentStep() {
    // Use data-step attribute from analytics.js script tag
    var scriptTag = document.querySelector('script[data-step]');
    if (scriptTag) {
      var num = parseInt(scriptTag.getAttribute('data-step'), 10);
      if (num >= 1 && num <= 5) return STEP_KEYS[num - 1];
    }
    // Fallback: match URL
    var loc = global.location.pathname.split('/').pop() || '';
    for (var key in STEP_URLS) {
      if (loc === STEP_URLS[key]) return key;
    }
    return null;
  }

  /* ── Find or create mount element ──────────────────────────────────── */

  function _getMount() {
    var existing = document.getElementById('workflowNextAction');
    if (existing) return existing;

    // Auto-create after hero (or jurisdiction banner, or first h1 in main)
    var heroSelectors = ['.hero', '.sb-hero', '.dc-hero', '.sj-header', '.hna-jurisdiction-banner'];
    var anchor = null;
    for (var i = 0; i < heroSelectors.length; i++) {
      anchor = document.querySelector('main ' + heroSelectors[i]);
      if (anchor) break;
    }
    // Fallback: insert after the first container div that holds the h1
    if (!anchor) {
      var h1 = document.querySelector('main h1');
      if (h1) {
        // Walk up to find the wrapping div (not main itself)
        anchor = h1.parentElement;
        if (anchor && anchor.id === 'main-content') anchor = h1;
      }
    }
    if (!anchor) return null;

    var mount = document.createElement('div');
    mount.id = 'workflowNextAction';
    mount.setAttribute('role', 'status');
    mount.setAttribute('aria-live', 'polite');
    anchor.parentNode.insertBefore(mount, anchor.nextSibling);
    return mount;
  }

  /* ── Render ────────────────────────────────────────────────────────── */

  function _render() {
    var WS = global.WorkflowState;
    if (!WS || typeof WS.getProgress !== 'function') return;

    var currentStep = _detectCurrentStep();
    if (!currentStep) return;

    var mount = _getMount();
    if (!mount) return;

    var progress = WS.getProgress();
    var completed = progress.completedSteps || [];
    var currentIdx = STEP_KEYS.indexOf(currentStep);
    var currentDone = completed.indexOf(currentStep) !== -1;

    // Find the first incomplete step before current
    var firstIncompleteBeforeCurrent = null;
    for (var i = 0; i < currentIdx; i++) {
      if (completed.indexOf(STEP_KEYS[i]) === -1) {
        firstIncompleteBeforeCurrent = STEP_KEYS[i];
        break;
      }
    }

    // Determine banner state
    var icon, heading, body, actionUrl, actionLabel, variant;

    if (progress.completedCount === 5) {
      // State 4: All done
      icon    = '\u2705';  // checkmark
      variant = 'complete';
      heading = 'Workflow Complete';
      body    = 'All five steps are done. You can export a combined Project Impact Summary or revisit any step to refine your analysis.';
      actionUrl   = null;
      actionLabel = null;

    } else if (currentDone && progress.nextIncomplete) {
      // State 3: Current step done, next step exists
      var nextKey = progress.nextIncomplete;
      icon    = '\u2192';  // arrow
      variant = 'next';
      heading = 'Step Complete';
      body    = STEP_ACTIONS[nextKey];
      actionUrl   = STEP_URLS[nextKey];
      actionLabel = 'Continue to ' + STEP_LABELS[nextKey] + ' \u2192';

    } else if (!currentDone && firstIncompleteBeforeCurrent) {
      // State 1: Prior steps incomplete
      var priorKey = firstIncompleteBeforeCurrent;
      icon    = '\u26A0\uFE0F';  // warning
      variant = 'skipped';
      heading = 'Earlier Step Incomplete';
      body    = STEP_LABELS[priorKey] + ' hasn\'t been completed yet. Results on this page may be more useful after completing prior steps.';
      actionUrl   = STEP_URLS[priorKey];
      actionLabel = 'Go to ' + STEP_LABELS[priorKey] + ' \u2192';

    } else if (!currentDone) {
      // State 2: Current step incomplete, all priors done
      var nextAfterCurrent = currentIdx < 4 ? STEP_KEYS[currentIdx + 1] : null;
      icon    = '\uD83D\uDCCB';  // clipboard
      variant = 'current';
      heading = 'Step ' + (currentIdx + 1) + ' of 5';
      body    = STEP_ACTIONS[currentStep];
      if (nextAfterCurrent) {
        body += ' When you\'re done, you\'ll continue to ' + STEP_LABELS[nextAfterCurrent] + '.';
      }
      actionUrl   = null;
      actionLabel = null;

    } else {
      // Edge case: hide
      mount.hidden = true;
      return;
    }

    // Build HTML
    mount.hidden = false;
    mount.className = 'wf-next-action wf-next-action--' + variant;
    mount.innerHTML =
      '<div class="wf-next-action__inner">' +
        '<span class="wf-next-action__icon" aria-hidden="true">' + icon + '</span>' +
        '<div class="wf-next-action__text">' +
          '<strong class="wf-next-action__heading">' + heading + '</strong>' +
          '<span class="wf-next-action__body">' + body + '</span>' +
        '</div>' +
        (actionUrl
          ? '<a class="wf-next-action__cta" href="' + actionUrl + '">' + actionLabel + '</a>'
          : '') +
      '</div>';
  }

  /* ── Init ──────────────────────────────────────────────────────────── */

  function init() {
    _render();

    // Re-render when workflow state updates
    document.addEventListener('workflow:step-updated', _render);
    document.addEventListener('workflow:project-loaded', _render);
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Defer slightly to ensure WorkflowState is initialized
    setTimeout(init, 0);
  }

  // Expose for testing
  global.WorkflowNextAction = { render: _render };

})(typeof window !== 'undefined' ? window : this);
