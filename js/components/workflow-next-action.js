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

  // F21 made Opportunity Finder step 1 of a 6-step flow (see
  // workflow-progress.js STEPS for the canonical list). This banner was
  // still on the old 5-step model, so the same page would show
  // "Step 2 of 5" while the sticky stepper bar showed "step 3 of 6".
  // Mirror the 6-step model here so denominators line up everywhere.
  var STEP_KEYS = ['opportunity', 'jurisdiction', 'hsa', 'market', 'scenario', 'deal'];
  var STEP_LABELS = {
    opportunity:  'Opportunity Finder',
    jurisdiction: 'Select Jurisdiction',
    hsa:          'Housing Needs Assessment',
    market:       'Market Analysis',
    scenario:     'Scenario Builder',
    deal:         'Deal Calculator'
  };
  var STEP_URLS = {
    opportunity:  'lihtc-opportunity-finder.html',
    jurisdiction: 'select-jurisdiction.html',
    hsa:          'housing-needs-assessment.html',
    market:       'market-analysis.html',
    scenario:     'hna-scenario-builder.html',
    deal:         'deal-calculator.html'
  };
  var STEP_ACTIONS = {
    opportunity:  'Find a jurisdiction with strong LIHTC opportunity to focus your analysis.',
    jurisdiction: 'Lock in the jurisdiction you\'re analyzing for the rest of the workflow.',
    hsa:          'Review affordability gaps and housing need indicators.',
    market:       'Run a PMA scoring analysis for your target site.',
    scenario:     'Build demographic projection scenarios.',
    deal:         'Model your capital stack and pro forma.'
  };

  /* ── Detect current page step ──────────────────────────────────────── */

  function _detectCurrentStep() {
    // Match by URL filename FIRST — unambiguous and stable. The page data-step
    // attributes were renumbered when the Opportunity Finder became step 1 of
    // the progress bar (6-step scheme: OF=1, jurisdiction=2, hsa=3, …), which
    // broke the old 5-step STEP_KEYS[num-1] mapping: HNA (data-step=3) resolved
    // to 'market', making the component think HNA was an incomplete *prior*
    // step and render a self-referential "Earlier Step Incomplete → Go to
    // Housing Needs Assessment" banner ON the HNA page (and similar on
    // market/scenario/deal). URL filenames map 1:1 to funnel steps regardless.
    var loc = (global.location.pathname.split('/').pop() || '').toLowerCase();
    for (var key in STEP_URLS) {
      if (loc === STEP_URLS[key]) return key;
    }
    // Fallback: data-step attribute (only consulted if the URL isn't a known
    // funnel page; numbering follows the 6-step progress-bar scheme:
    // 1=opportunity / 2=jurisdiction / 3=hsa / 4=market / 5=scenario / 6=deal).
    var scriptTag = document.querySelector('script[data-step]');
    if (scriptTag) {
      var num = parseInt(scriptTag.getAttribute('data-step'), 10);
      if (num >= 1 && num <= STEP_KEYS.length) return STEP_KEYS[num - 1];
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
    var completed = (progress.completedSteps || []).slice();
    try {
      var jx = global.JurisdictionUrlContext &&
        global.JurisdictionUrlContext.resolveSync &&
        global.JurisdictionUrlContext.resolveSync();
      if (jx && (jx.countyFips || jx.fips || jx.geoid) && completed.indexOf('jurisdiction') === -1) {
        completed.push('jurisdiction');
      }
    } catch (_) {}
    // The Opportunity Finder is a discovery step — there's no "complete"
    // action to gate on (it's a browse view). Treat it as auto-complete so
    // downstream pages don't render a misleading "Earlier Step Incomplete →
    // Go to Opportunity Finder" banner just because the user landed via a
    // direct URL. The OF page itself still shows "Step 1 of 6 / Find a
    // jurisdiction…" because the page's own current-step short-circuit
    // ignores the completed list for the current step.
    if (completed.indexOf('opportunity') === -1) completed.push('opportunity');
    var currentIdx = STEP_KEYS.indexOf(currentStep);
    var currentDone = completed.indexOf(currentStep) !== -1;
    var completedCount = completed.length;
    var nextIncomplete = null;
    for (var ni = 0; ni < STEP_KEYS.length; ni++) {
      if (completed.indexOf(STEP_KEYS[ni]) === -1) {
        nextIncomplete = STEP_KEYS[ni];
        break;
      }
    }

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

    // "All done" = all real tracked steps from STEP_META complete. OF is
    // a discovery step (auto-complete above) so we don't gate on it here.
    var trackedCount = STEP_KEYS.length - 1; // minus 'opportunity'
    if (completedCount >= trackedCount) {
      // State 4: All done
      icon    = '\u2705';  // checkmark
      variant = 'complete';
      heading = 'Workflow Complete';
      body    = 'All ' + trackedCount + ' steps are done. You can export a combined Project Impact Summary or revisit any step to refine your analysis.';
      actionUrl   = null;
      actionLabel = null;

    } else if (currentDone && nextIncomplete) {
      // State 3: Current step done, next step exists
      var nextKey = nextIncomplete;
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
      var nextAfterCurrent = currentIdx < STEP_KEYS.length - 1 ? STEP_KEYS[currentIdx + 1] : null;
      icon    = '\uD83D\uDCCB';  // clipboard
      variant = 'current';
      heading = 'Step ' + (currentIdx + 1) + ' of ' + STEP_KEYS.length;
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
    document.addEventListener('jurisdiction-url-context:resolved', _render);
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
