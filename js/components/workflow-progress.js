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

  // 7-step model. Page-level workflow bars carry the same numbering inline;
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
    { num: 6, key: 'deal',         label: 'Deal',               href: 'deal-calculator.html' },
    // Step 7 is the synthesis. Every conclusion the workflow reaches is
    // computed on one of steps 1-6 and then left there; before this the
    // reader finished the route holding six pages and no answer.
    { num: 7, key: 'recommendation', label: 'Recommendation',  href: 'recommendation.html' }
  ];

  /* ── Product routes ────────────────────────────────────────────────────────
   *
   * The seven steps above are the LIHTC rental route, and stay the canonical
   * list (FINISH-LINE.md, the banner fallback and the tests read them). A
   * developer planning for-sale homes walks the same seven slots, but three of
   * them are rental-only tools: the Opportunity Finder ranks LIHTC
   * opportunity, Market Analysis is a LIHTC primary market area, and the
   * Scenario Builder sets rents. For that product those slots open the
   * ownership tools instead. Slot numbers and keys do not change, so step
   * completion, the banner and saved projects keep working; only where a slot
   * leads, and what it is called, follows the product.
   *
   * Middle-income rental (80–120% AMI) walks the LIHTC route: every step
   * applies, but the Deal step sizes federal LIHTC only — the chooser on
   * select-jurisdiction.html says so.
   *
   * A project with both rental and for-sale homes ("mixed") walks the LIHTC
   * route too, and the for-sale tool for slots 2, 4 and 5 rides along as a
   * companion: listed under the rail and named by the next-step banner. The
   * Deal Calculator still models one tenure at a time; a combined deal is not
   * built. docs/DEVELOPER-TRACKS.md maps all four.
   *
   * Labels match the site nav's labels for the same pages (js/navigation.js),
   * which test/guided-path-product-routes.test.js holds. */
  var PRODUCTS = {
    'lihtc-rental':         { label: 'LIHTC rental' },
    'middle-income-rental': { label: 'Middle-income rental' },
    'for-sale':             { label: 'For-sale ownership' },
    'mixed':                { label: 'Rental and for-sale' }
  };
  var DEFAULT_PRODUCT = 'lihtc-rental';
  // The ownership tool for each slot that has a rental-only tool.
  var FOR_SALE_SLOTS = {
    2: { label: 'Ownership Need', href: 'hna-what-to-do.html#affordable-ownership-need-section',
         action: 'Check who can afford to buy here and what is missing.' },
    4: { label: 'For-Sale Market Study', href: 'for-sale-market-study.html',
         action: 'Screen buyer demand, capture, absorption and resale for your project.' },
    5: { label: 'Land Value', href: 'land-value.html',
         action: 'Test what the land is worth against what the homes can sell for.' }
  };
  // Slots whose page is replaced, by product.
  var ROUTE_OVERRIDES = { 'for-sale': FOR_SALE_SLOTS };
  // Slots that keep their page and gain a second one, by product.
  var ROUTE_COMPANIONS = { 'mixed': FOR_SALE_SLOTS };
  var PRODUCT_STORAGE_KEY = 'coho:guided-product';

  function isProduct(p) { return Object.prototype.hasOwnProperty.call(PRODUCTS, p); }

  /** The product the reader chose, or null when none has been chosen. The
   *  active project's choice wins; a per-browser copy covers a reader who
   *  chose before any project existed. */
  function getProduct() {
    try {
      var WS = global.WorkflowState;
      var fromProject = WS && typeof WS.get === 'function' ? WS.get('product') : null;
      if (isProduct(fromProject)) return fromProject;
    } catch (e) { /* no project */ }
    try {
      var stored = global.localStorage && global.localStorage.getItem(PRODUCT_STORAGE_KEY);
      if (isProduct(stored)) return stored;
    } catch (e) { /* storage blocked */ }
    return null;
  }

  function setProduct(p) {
    if (!isProduct(p)) return false;
    try { if (global.localStorage) global.localStorage.setItem(PRODUCT_STORAGE_KEY, p); } catch (e) { /* storage blocked */ }
    try {
      var WS = global.WorkflowState;
      if (WS && typeof WS.getActiveProject === 'function' && WS.getActiveProject() && typeof WS.set === 'function') {
        WS.set('product', p);
      }
    } catch (e) { /* no project */ }
    applyRouteToDocument();
    try {
      document.dispatchEvent(new CustomEvent('workflow:product-changed', { detail: { product: p } }));
    } catch (e) { /* old browser */ }
    return true;
  }

  /** STEPS as they apply to a product. Overridden slots carry `routed: true`
   *  and an `action` sentence for the next-step banner; slots with a second
   *  page carry `companion: { label, href, action }`. */
  function stepsFor(product) {
    var o = ROUTE_OVERRIDES[product] || {};
    var c = ROUTE_COMPANIONS[product] || {};
    return STEPS.map(function (s) {
      var r = { num: s.num, key: s.key, label: s.label, href: s.href };
      if (o[s.num]) {
        r.label = o[s.num].label;
        r.href = o[s.num].href;
        r.action = o[s.num].action;
        r.routed = true;
      }
      if (c[s.num]) {
        r.companion = { label: c[s.num].label, href: c[s.num].href, action: c[s.num].action };
      }
      return r;
    });
  }

  /* The line under the rail that lists companion pages, or '' when the route
   * has none. */
  function companionsHtml(route) {
    var links = [];
    route.forEach(function (s) {
      if (!s.companion) return;
      links.push('<a href="' + relToRoot() + s.companion.href + '">' + s.companion.label + '</a> (step ' + s.num + ')');
    });
    return links.length
      ? '<p class="wf-companions">For the for-sale homes, also: ' + links.join(' \u00b7 ') + '</p>'
      : '';
  }

  function currentSteps() { return stepsFor(getProduct() || DEFAULT_PRODUCT); }

  /* Rewrite the hard-coded rails (13 pages carry one in their HTML) to the
   * chosen product's route. The active step is left alone: it names the page
   * the reader is on, whatever the route says that slot is for. */
  function applyRouteToDocument(root) {
    var scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || !scope.querySelectorAll) return;
    var byNum = {};
    currentSteps().forEach(function (s) { byNum[s.num] = s; });
    var els = scope.querySelectorAll('.wf-step[data-step]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var step = byNum[parseInt(el.getAttribute('data-step'), 10)];
      if (!step) continue;
      if (el.classList.contains('wf-step--active') || el.getAttribute('aria-current') === 'step') continue;
      var labelEl = el.querySelector('.wf-step__label');
      if (labelEl && labelEl.textContent !== step.label) labelEl.textContent = step.label;
      if (el.tagName === 'A') el.setAttribute('href', relToRoot() + step.href);
    }
    // The companion line sits right after each rail's row of steps. Pages
    // wrap their hard-coded rails differently, so the row is found from the
    // steps rather than from a wrapper class.
    var html = companionsHtml(currentSteps());
    if (html) ensureStyles();
    var rows = [];
    for (var r = 0; r < els.length; r++) {
      if (rows.indexOf(els[r].parentNode) === -1) rows.push(els[r].parentNode);
    }
    for (var w = 0; w < rows.length; w++) {
      var next = rows[w].nextElementSibling;
      if (next && next.classList.contains('wf-companions')) next.parentNode.removeChild(next);
      if (html) rows[w].insertAdjacentHTML('afterend', html);
    }
  }

  /* ── relToRoot — mirrors navigation.js pattern ──────────────────────────── */

  function relToRoot() {
    if (location.pathname.includes('/private/weekly-brief/')) { return '../../'; }
    if (location.pathname.includes('/docs/'))                 { return '../'; }
    return '';
  }

  /* ── The width at which the full-size rail stops fitting ──────────────────
   *
   * Derived, not picked. A full-size step is min-width 80px and a connector
   * min-width 20px, so N steps need (N * 80) + ((N - 1) * 20) plus the wrap's
   * 36px of side padding. At seven steps that is 716px.
   *
   * It used to be a literal 480, sized for six steps when the rail had five.
   * Adding step 7 (#1715) pushed the minimum from 580px to 680px, which opened
   * a band between 481px and 716px where the rail neither compacted nor
   * scrolled: `.wf-progress-wrap` is `overflow:hidden`, so the last step was
   * silently CLIPPED. On the deal calculator at 666px the reader simply lost
   * "Recommendation" — no scrollbar, no ellipsis, nothing to indicate a
   * seventh step existed.
   *
   * test:entry-path asserts this stays in step with STEPS.length, so adding an
   * eighth step fails the build rather than re-opening the same gap. */
  var STEP_MIN_PX = 80;
  var CONNECTOR_MIN_PX = 20;
  var WRAP_PADDING_PX = 36;
  function compactBelowPx() {
    return (STEPS.length * STEP_MIN_PX)
      + ((STEPS.length - 1) * CONNECTOR_MIN_PX)
      + WRAP_PADDING_PX;
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
      // Scroll rather than clip. A rail that cannot fit must still be
      // reachable: `overflow:hidden` on the wrap turns an overflowing strip
      // into a step the reader never learns about.
      '.wf-progress-steps{display:flex;align-items:center;gap:0;width:100%;max-width:1200px;margin:0 auto;min-width:0;'
        + 'overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;}',
      '.wf-progress-steps::-webkit-scrollbar{display:none;}',
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
      '.wf-companions{max-width:1200px;margin:6px auto 0;font-size:.74rem;line-height:1.4;color:var(--muted);text-align:center;}',
      '@media(max-width:' + compactBelowPx() + 'px){',
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

  function buildStepHtml(step, activeStep, doneSteps, onCompanion) {
    var isDone   = (doneSteps.indexOf(step.num) !== -1);
    var isActive = (step.num === activeStep);

    var classes  = 'wf-step';
    if (isDone)   { classes += ' wf-step--done'; }
    if (isActive) { classes += ' wf-step--active'; }

    var ariaAttr  = isActive ? ' aria-current="step"' : '';
    var numText   = isDone ? '\u2713' : String(step.num);
    // On a companion page (the for-sale study inside a mixed route) the active
    // slot is named for the page the reader is on.
    var labelText = (isActive && onCompanion && step.companion) ? step.companion.label : step.label;

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

  function buildHtml(activeStep, doneSteps, onCompanion) {
    var parts = [];
    var route = currentSteps();
    var i;
    for (i = 0; i < route.length; i++) {
      if (i > 0) {
        parts.push('<div class="wf-step-connector"></div>');
      }
      parts.push(buildStepHtml(route[i], activeStep, doneSteps, onCompanion));
    }
    return (
      '<div class="wf-progress-wrap">' +
        '<div class="wf-progress-steps" role="navigation" aria-label="Workflow steps">' +
          parts.join('') +
        '</div>' +
        companionsHtml(route) +
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
    /** The route itself. Read-only copy, so callers can map a step key to its
     *  number without writing a second table of numbers. */
    STEPS: STEPS.map(function (s) { return { num: s.num, key: s.key, label: s.label, href: s.href }; }),

    /** Product routes — see "Product routes" above. */
    PRODUCTS: Object.keys(PRODUCTS).map(function (k) { return { id: k, label: PRODUCTS[k].label }; }),
    getProduct: getProduct,
    setProduct: setProduct,
    stepsFor: stepsFor,
    /** The route for the chosen product (the LIHTC route when none is chosen). */
    routeSteps: currentSteps,
    applyRoute: applyRouteToDocument,

    render: function (containerId, activeStep, options) {
      ensureStyles();

      var container = document.getElementById(containerId);
      if (!container) {
        console.warn('[WorkflowProgress] Container not found: #' + containerId);
        return;
      }

      var step = parseInt(activeStep, 10) || 1;
      var done = resolveDoneSteps(step, options);

      container.innerHTML = buildHtml(step, done, !!(options && options.companion));

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
    /**
     * @param {Object} [options]
     * @param {number[]} [options.doneSteps]  Explicit list, same contract as
     *   render(). Without it the conservative fallback marks every step before
     *   the active one as done, which is fine on a page that shows only the
     *   rail and wrong on step 7, where the rail's claim sits directly above a
     *   list of which steps the reader actually completed. A page that can see
     *   the truth should be able to pass it.
     */
    refreshSteps: function (containerId, activeStep, options) {
      ensureStyles();   // Fix #17: inject CSS if not already present
      var container = document.getElementById(containerId);
      if (!container) return;

      var step = parseInt(activeStep, 10) || 1;
      var done = resolveDoneSteps(step, options || null);

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

      applyRouteToDocument(container);

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
    document.addEventListener('DOMContentLoaded', function () { applyRouteToDocument(); });
  } else {
    publishHeaderHeight();
    applyRouteToDocument();
  }

  /* ── Expose globally ────────────────────────────────────────────────────── */
  global.WorkflowProgress = WorkflowProgress;

}(typeof window !== 'undefined' ? window : this));
