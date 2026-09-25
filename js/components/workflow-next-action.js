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

  /* ── The step sequence: read, never re-declared ──────────────────────
   *
   * workflow-progress.js STEPS is the canonical list and this file consumes
   * it. It used to keep a parallel copy, and the copy drifted — six keys with
   * Opportunity Finder first, against the rail's seven with Jurisdiction
   * first. Two producers of one sequence, so the same screen could show the
   * rail reading "step 1 of 7" and this banner reading "Step 2 of 6".
   *
   * The comment that stood here described an EARLIER instance of the same
   * drift ("Step 2 of 5" against "step 3 of 6") and its fix was to re-type the
   * list correctly. That is why it came back: a copy kept in step by hand goes
   * out of step the next time the other one moves. It moved twice — the first
   * two steps swapped, and step 7 was added.
   *
   * Missing step 7 was not a cosmetic fault. Recommendation is the synthesis:
   * workflow-progress.js calls it out as the step without which "the reader
   * finished the route holding six pages and no answer". Absent from this
   * list, the deal calculator announced itself as "Step 6 of 6" and pointed
   * nowhere, so the guided path ended one page short of its own conclusion.
   *
   * The fallback exists only for a page that loads this file without the rail;
   * on every guided-path page workflow-progress.js is loaded first.
   */
  var FALLBACK_STEPS = [
    { key: 'jurisdiction',   label: 'Select Jurisdiction',      href: 'select-jurisdiction.html' },
    { key: 'opportunity',    label: 'Opportunity Finder',       href: 'lihtc-opportunity-finder.html' },
    { key: 'hsa',            label: 'Housing Needs Assessment', href: 'hna-what-housing-exists.html' },
    { key: 'market',         label: 'Market Analysis',          href: 'market-analysis.html' },
    { key: 'scenario',       label: 'Scenario Builder',         href: 'hna-scenario-builder.html' },
    { key: 'deal',           label: 'Deal Calculator',          href: 'deal-calculator.html' },
    { key: 'recommendation', label: 'Recommendation',           href: 'recommendation.html' }
  ];

  var _canon = null;
  /** {keys, labels, urls} from the rail, resolved once the rail has loaded. */
  function canon() {
    if (_canon) return _canon;
    var WP = global.WorkflowProgress;
    var fromRail = WP && Object.prototype.toString.call(WP.STEPS) === '[object Array]'
      && WP.STEPS.length ? WP.STEPS : null;
    var list = fromRail || FALLBACK_STEPS;
    var out = { keys: [], labels: {}, urls: {} };
    for (var i = 0; i < list.length; i++) {
      out.keys.push(list[i].key);
      out.labels[list[i].key] = STEP_LABEL_OVERRIDES[list[i].key] || list[i].label;
      out.urls[list[i].key] = list[i].href;
    }
    // Only cache once the real list is in hand, so a fallback read during an
    // unlucky early call cannot freeze the wrong sequence for the page.
    if (fromRail) _canon = out;
    return out;
  }

  /* The rail's labels are short enough to fit a 7-node strip ("Deal",
   * "Scenarios"). Prose needs the full name. Keys absent here use the rail's. */
  var STEP_LABEL_OVERRIDES = {
    hsa:      'Housing Needs Assessment',
    scenario: 'Scenario Builder',
    deal:     'Deal Calculator'
  };

  /* Steps a reader is not gated on finishing: Opportunity Finder is statewide
   * discovery, and Recommendation is the output, not a task. */
  var UNTRACKED_STEPS = { opportunity: 1, recommendation: 1 };

  /* Other pages that ARE a step, beyond the one the rail links to.
   *
   * The rail carries one href per step — the page the guided route sends you
   * to. A step can be served by more than one page: step 3 is the needs
   * assessment, whose rail href is the first chapter, while
   * housing-needs-assessment.html is the same step's full 53-section report.
   * Without this, a reader on the full report gets no banner at all, because
   * URL detection is the only path on a page that renders no rail.
   *
   * Keys are page filenames; values are step keys that must exist in the rail. */
  var STEP_URL_ALIASES = {
    'housing-needs-assessment.html':      'hsa',
    'hna-who-lives-here.html':            'hsa',
    'hna-what-households-can-afford.html': 'hsa',
    'hna-where-its-heading.html':         'hsa',
    'hna-what-to-do.html':                'hsa'
  };
  var STEP_ACTIONS = {
    opportunity:  'Find a jurisdiction with strong LIHTC opportunity to focus your analysis.',
    jurisdiction: 'Lock in the jurisdiction you\'re analyzing for the rest of the workflow.',
    hsa:          'Review affordability gaps and housing need indicators.',
    market:       'Run a PMA scoring analysis for your target site.',
    scenario:     'Build demographic projection scenarios.',
    deal:         'Model your capital stack and pro forma.',
    recommendation: 'Read the synthesis of everything the earlier steps computed.'
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
    var urls = canon().urls;
    if (STEP_URL_ALIASES[loc] && canon().keys.indexOf(STEP_URL_ALIASES[loc]) !== -1) {
      return STEP_URL_ALIASES[loc];
    }
    for (var key in urls) {
      if (loc === urls[key]) return key;
    }
    // Fallback: data-step attribute (only consulted if the URL isn't a known
    // funnel page; numbering follows the 6-step progress-bar scheme:
    // 1=opportunity / 2=jurisdiction / 3=hsa / 4=market / 5=scenario / 6=deal).
    var scriptTag = document.querySelector('script[data-step]');
    if (scriptTag) {
      var num = parseInt(scriptTag.getAttribute('data-step'), 10);
      var ks = canon().keys;
      if (num >= 1 && num <= ks.length) return ks[num - 1];
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
    var CANON = canon();
    var STEP_KEYS = CANON.keys;
    var STEP_LABELS = CANON.labels;
    var STEP_URLS = CANON.urls;
    var currentIdx = STEP_KEYS.indexOf(currentStep);
    var currentDone = completed.indexOf(currentStep) !== -1;
    // Counted over TRACKED steps only. `completed` carries an auto-added
    // 'opportunity', so comparing its raw length against the tracked total
    // declared the workflow finished one real step early.
    var completedCount = 0;
    for (var cc = 0; cc < completed.length; cc++) {
      if (!UNTRACKED_STEPS[completed[cc]]) completedCount++;
    }
    var nextIncomplete = null;
    // Only the jurisdiction is a prerequisite: every page keys its data off
    // it. The analyses before a page (HNA, Market Analysis, Scenario Builder)
    // are context the page can quote, never inputs it needs — the deal
    // calculator reads its own HUD/CHFA data and only the active project's
    // jurisdiction from WorkflowState. Until 2026-09-23 any skipped prior
    // step raised the amber "Earlier Step Incomplete → Go to …" warning, so a
    // reader who took the HNA's own "Next step → Deal Calculator" link was
    // told to go back to Market Analysis, then Scenario Builder. The site
    // offers those jumps; it must not scold them. Skipped analyses are named
    // in one quiet line under the page's own guidance instead.
    var PREREQUISITE_STEPS = { jurisdiction: 1 };
    var skippedContext = [];
    for (var si = 0; si < currentIdx; si++) {
      var sk = STEP_KEYS[si];
      if (completed.indexOf(sk) === -1 && !PREREQUISITE_STEPS[sk]) skippedContext.push(sk);
    }
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
    var trackedCount = 0;
    for (var tk = 0; tk < STEP_KEYS.length; tk++) {
      if (!UNTRACKED_STEPS[STEP_KEYS[tk]]) trackedCount++;
    }
    if (completedCount >= trackedCount) {
      // State 4: All done
      icon    = '\u2705';  // checkmark
      variant = 'complete';
      heading = 'Workflow Complete';
      body    = 'All ' + trackedCount + ' steps are done. You can export a combined Project Impact Summary or revisit any step to refine your analysis.';
      actionUrl   = null;
      actionLabel = null;

    } else if (firstIncompleteBeforeCurrent && PREREQUISITE_STEPS[firstIncompleteBeforeCurrent]) {
      // State 1: a prerequisite (the jurisdiction) is missing. Checked BEFORE
      // "current step done": the HNA chapters mark themselves complete on
      // read (#1833), so a first-time visitor with no jurisdiction used to see
      // "Step Complete → Continue to Jurisdiction" — a verdict on a step they
      // had not taken, pointing back to the start with no way back here.
      //
      // The site itself sends people here: the homepage links directly into
      // every guided-path page except step 1, so a first-time reader who picks
      // "Deal Calculator" off a job tile arrives with no jurisdiction. Telling
      // them an "Earlier Step" is "Incomplete" blames them for skipping a step
      // they were never shown, and dropping them on step 1 loses the thing
      // they actually asked for.
      //
      // So: say what the page needs, and carry the destination so choosing a
      // jurisdiction returns them here instead of stranding them at the top of
      // the path. `next` is read back through an allowlist in
      // jurisdiction-selector.js — it is a URL a stranger can set.
      var priorKey = firstIncompleteBeforeCurrent;
      icon    = '\u26A0\uFE0F';  // warning
      variant = 'skipped';
      heading = 'Choose a jurisdiction first';
      body    = 'This page reads its numbers from one Colorado community, so it has '
              + 'nothing to show until you pick one. You\'ll come straight back here.';
      actionUrl   = STEP_URLS[priorKey];
      var here = STEP_URLS[currentStep];
      if (priorKey === 'jurisdiction' && here) {
        actionUrl += (actionUrl.indexOf('?') === -1 ? '?' : '&')
          + 'next=' + encodeURIComponent(here);
      }
      actionLabel = 'Choose a jurisdiction \u2192';

    } else if (currentDone && nextIncomplete) {
      // State 3: Current step done, next step exists
      var nextKey = nextIncomplete;
      icon    = '\u2192';  // arrow
      variant = 'next';
      heading = 'Step Complete';
      body    = STEP_ACTIONS[nextKey];
      actionUrl   = STEP_URLS[nextKey];
      actionLabel = 'Continue to ' + STEP_LABELS[nextKey] + ' \u2192';

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
      if (skippedContext.length) {
        var names = [];
        for (var ci = 0; ci < skippedContext.length; ci++) names.push(STEP_LABELS[skippedContext[ci]]);
        body += ' <span class="wf-next-action__advisory">Optional context not yet run: ' + names.join(', ') +
          ' (<a href="' + STEP_URLS[skippedContext[0]] + '">open ' + STEP_LABELS[skippedContext[0]] + '</a>). Results here do not depend on it.</span>';
      }
      // #1837 F3: from step 4 on, "what do I do next" had no forward control;
      // the only link in this state was the optional-context one, which points
      // BACK. The route must always offer the next step, whether or not this
      // one has been marked done — no later step needs this one's output.
      actionUrl   = nextAfterCurrent ? STEP_URLS[nextAfterCurrent] : null;
      actionLabel = nextAfterCurrent ? 'Go on to ' + STEP_LABELS[nextAfterCurrent] + ' \u2192' : null;

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

  // Expose for testing. `steps` is the resolved sequence this banner is
  // using, so a guard can prove it equals the rail's rather than trusting
  // that it still reads from it.
  global.WorkflowNextAction = {
    render: _render,
    steps: function () { return canon(); },
    fallbackSteps: function () { return FALLBACK_STEPS.slice(); },
    urlAliases: function () { return STEP_URL_ALIASES; }
  };

})(typeof window !== 'undefined' ? window : this);
