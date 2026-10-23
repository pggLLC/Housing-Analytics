/**
 * navigation.js — Shared site header, nav, drawer, and footer
 * Injects a consistent header + footer across pages.
 * Uses site-theme.css variables.
 *
 * Information Architecture:
 * ─────────────────────────────────────────────────────────────────────────
 * SCOPING A RENTAL PROJECT (primary workflow):
 *   LIHTC Guide (start here) → Opportunity Finder (find a market) →
 *   Select Jurisdiction → HNA → Market Analysis → Scenario Builder →
 *   Deal Calculator
 *
 * SCOPING A FOR-SALE PROJECT (entry points):
 *   Ownership Need, For-Sale Market Study, Deal Calculator,
 *   Land Value & Negotiation
 *
 * EXPLORE (comparative & context):
 *   Compare Jurisdictions, Colorado Deep Dive, Market Intelligence,
 *   CHFA Portfolio, Prop 123 Land Banking Awards, Economic Dashboard, Preservation
 *   Tracking
 *
 * DATA (transparency & quality):
 *   Data Health, Data Quality, Data Review, Census Explorer
 *
 * INSIGHTS, in three groups (2026-09-28):
 *   Current: Housing News, Policy & Legislation, Colorado Elections
 *   Research: Research & Analysis, Tax Credit Equity Markets, the papers
 *   Guides: Help for Homebuyers
 *   It was 11 ungrouped items that overflowed a 1280x720 screen. About and
 *   Sitemap are in the footer. Each label matches the <h1> of the page it
 *   opens (test/insights-nav-labels.test.mjs).
 * ─────────────────────────────────────────────────────────────────────────
 */
(function () {
  const GROUPS = [
    {
      label: "Scoping a Project",
      items: [
        { label: "The Affordable Housing Pipeline",  href: "pipeline.html", desc: "Eight stages from housing need to housing built", isNew: true },
        { label: "LIHTC Guide",             href: "lihtc-guide-for-stakeholders.html", desc: "LIHTC basics. Start here" },
        { label: "— Rental (LIHTC) —", isHeader: true },
        { label: "Select Jurisdiction",     href: "select-jurisdiction.html",       desc: "Step 1: Pick a county or town" },
        { label: "Opportunity Finder",      href: "lihtc-opportunity-finder.html",  desc: "Step 2 (optional): Rank places for 4% and 9% credits", isNew: true },
        { label: "Housing Needs Assessment",href: "housing-needs-assessment.html",  desc: "Step 3: Local housing need, full report" },
        { label: "What housing exists", href: "hna-what-housing-exists.html", isSub: true, desc: "What housing is here, and what shape is it in?" },
        { label: "Who lives here", href: "hna-who-lives-here.html", isSub: true, desc: "Who lives here, and how is that changing?" },
        { label: "What households can afford", href: "hna-what-households-can-afford.html", isSub: true, desc: "What can households here actually afford, and where is the gap?" },
        { label: "Where it's heading", href: "hna-where-its-heading.html", isSub: true, desc: "What does demand look like in 5, 10 and 20 years?" },
        { label: "What to do about it", href: "hna-what-to-do.html", isSub: true, desc: "How much of what, for whom, and what is already available?" },
        { label: "Market Analysis",         href: "market-analysis.html",           desc: "Step 4: Score a site and its market area" },
        { label: "Scenario Builder",        href: "hna-scenario-builder.html",      desc: "Step 5: 20-year demographic projections" },
        { label: "Funding Sources",         href: "colorado-deep-dive.html#tab-funding", desc: "Colorado programs that fit your project" },
        { label: "Deal Calculator",         href: "deal-calculator.html",           desc: "Step 6: LIHTC pro forma & capital stack" },
        { label: "Recommendation",          href: "recommendation.html",            desc: "Step 7: What the steps add up to" },
        { label: "— For-Sale / Ownership —", isHeader: true },
        { label: "Ownership Need",           href: "housing-needs-assessment.html#affordable-ownership-need-section", desc: "Who can afford to buy, and what is missing" },
        { label: "For-Sale Market Study",    href: "for-sale-market-study.html",     desc: "Demand, capture, absorption, land disposition" },
        { label: "For-Sale Feasibility",     href: "deal-calculator.html?mode=ownership",           desc: "Per-unit subsidy gap for deed-restricted homes" },
        { label: "Land Value & Negotiation", href: "land-value.html",                desc: "Comps and a land bid, for rental or for-sale" },
      ]
    },
    {
      label: "Explore",
      items: [
        { label: "Compare Opportunity Scores", href: "compare.html",                 desc: "2 to 6 places side by side", isNew: true },
        { label: "Compare Jurisdictions", href: "hna-comparative-analysis.html", desc: "Rank 546 geographies by housing need" },
        { label: "Colorado Deep Dive",    href: "colorado-deep-dive.html",        desc: "Market signals, construction costs, LIHTC history, funding sources" },
        { label: "CHFA Portfolio",        href: "chfa-portfolio.html",            desc: "Browse CHFA LIHTC projects" },
        { label: "Where Colorado's Housing Money Goes", href: "where-housing-money-goes.html", desc: "Every CHFA, OEDIT and DOLA award by county, town and developer", isNew: true },
        { label: "Deal Summaries",        href: "deal-summary.html",              desc: "Sourced write-ups of CHFA tax credit awards: mix, money, status", isNew: true },
        { label: "Prop 123 Land Banking Awards", href: "land-banking-awards.html", desc: "Every Prop 123 land banking award, mapped", isNew: true },
        { label: "Economic Dashboard",    href: "economic-dashboard.html",        desc: "FRED indicators for deal timing" },
        { label: "Preservation Tracking", href: "preservation.html",              desc: "NHPD subsidy expiry risk" },
      ]
    },
    {
      // F177 — Data section consolidation. Was 5 confusingly-similar
      // pages (Data Health / Data Quality / Data Review / Data Explorer
      // / Census Explorer — the last mislabeled, it's actually a
      // multifamily housing dashboard). Now organized around 3 roles:
      //   1. Data Trust Center — start here · sources + transparency
      //   2. File Browser    — raw exploration of every JSON/GeoJSON
      //   3. Multifamily Lens — analytical view (was Census Explorer)
      // Pipeline Status + Coverage QA are kept reachable but demoted
      // since they're operational/QA pages that 95% of users don't need.
      // F182 — Data section trimmed to 3 primary pages. The two
      // operational/diagnostic pages (Pipeline Status, Coverage QA)
      // are no longer in the nav; they're reachable from the Data Trust
      // Center's footer "Operational pages" section. Net: 5 → 3 in nav.
      // Phase 2.1 (2026-07) — renamed "Data Hub" to "Data Trust Center"
      // and added a QA Coverage tab (5-layer status + place-level
      // methodology provenance) so the page answers "can I trust this
      // data?" without visiting 3 separate pages. See
      // internal/docs/audits/CODEX-HANDOFF-AUDIT-PHASE2-2026-07.md item 2.1.
      label: "Data",
      items: [
        { label: "Data Trust Center",      href: "data-review-hub.html",           desc: "Sources, freshness and how we check the data" },
        { label: "File Browser",          href: "data-explorer.html",             desc: "Browse every dataset with previews" },
        { label: "Data Map",              href: "data-map-browser.html",          desc: "LIHTC, QCT/DDA, OZ, amenities, flood zones", isNew: true },
      ]
    },
    {
      label: "Insights",
      items: [
        { label: "— Current —", isHeader: true },
        { label: "Housing News",           href: "policy-briefs.html",             desc: "Headlines; check the linked source" },
        { label: "Policy & Legislation",   href: "housing-legislation-2026.html",  desc: "Laws and rules we track" },
        { label: "Colorado Elections",     href: "colorado-elections.html",        desc: "2026 ballot and officials" },
        { label: "— Research —", isHeader: true },
        { label: "Research & Analysis",    href: "insights.html",                  desc: "Dated analysis and briefs" },
        { label: "Local Housing Incentives", href: "local-incentives.html",       desc: "What each town and county offers" },
        { label: "Services in Affordable Housing", href: "resident-services.html", desc: "How services help residents stay housed" },
        { label: "Tax Credit Equity Markets", href: "article-pricing.html",        desc: "Equity pricing benchmarks" },
        { label: "— How the numbers are made —", isHeader: true },
        { label: "White Paper for Planners", href: "apa-white-paper.html",        desc: "To explain a finding in plain language" },
        { label: "Working Paper",         href: "working-paper.html",             desc: "Why the system works the way it does" },
        { label: "Methods",               href: "methods.html",                   desc: "Every formula, to check a number" },
        { label: "— Guides —", isHeader: true },
        { label: "Help for Homebuyers",     href: "help-for-homebuyers.html",       desc: "Down-payment help, credits" },
        { label: "Who Does What in a Colorado Affordable Deal", href: "affordable-deal-team.html", desc: "Bankers, syndicators, lawyers, community work, CRA" },
      ]
    }
  ];

  // Canonical page names come from the first full-page navigation entry.
  // Context links and their agreement guard reuse this source, not a second registry.
  const pageNames = {
    // This dated analysis is linked from Research, not the primary menu.
    "cra-expansion-analysis.html": "CRA Expansion Impact on LIHTC Pricing"
  };
  GROUPS.forEach(function (group) {
    group.items.forEach(function (item) {
      if (item.href && item.href.indexOf('#') === -1 && !pageNames[item.href]) {
        pageNames[item.href] = item.label;
      }
    });
  });
  window.WorkflowPageNames = Object.freeze(pageNames);

  function addOwnershipProgramLink() {
    var section = document.getElementById('affordable-ownership-need-section');
    if (!section || section.querySelector('[data-workflow-link="hna-homebuyers"]')) return;
    var note = document.createElement('p');
    note.appendChild(document.createTextNode('Find buyer assistance programs in '));
    var link = document.createElement('a');
    link.href = normalizeHref('help-for-homebuyers.html');
    link.setAttribute('data-workflow-link', 'hna-homebuyers');
    link.textContent = pageNames['help-for-homebuyers.html'];
    note.appendChild(link);
    note.appendChild(document.createTextNode('. Confirm eligibility and funding with the program administrator.'));
    section.insertBefore(note, section.querySelector('.stats'));
  }

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Member sign in: the paid developer site, behind Cloudflare Access. Not shown
  // on the developer pages themselves (they carry their own Sign out).
  const MEMBER_SITE_URL = 'https://coho-backend.communityplanner.workers.dev/';
  function onMemberSite() {
    const page = (location.pathname.split('/').pop() || '');
    return /^developer/.test(page) || /\.workers\.dev$/.test(location.hostname);
  }
  function memberLink(cls) {
    return onMemberSite() ? '' : `<a class="${cls}" href="${MEMBER_SITE_URL}">Member sign in</a>`;
  }

  function relToRoot() {
    // If a page lives in a subfolder, back out to the repo root.
    if (location.pathname.includes('/private/weekly-brief/')) return '../../';
    if (location.pathname.includes('/places/')) return '../';
    if (location.pathname.includes('/docs/')) return '../';
    return '';
  }

  function normalizeHref(href) {
    // Keep absolute URLs unchanged.
    if (/^https?:\/\//i.test(href)) return href;
    return relToRoot() + href;
  }

  function activeClass(targetHref) {
    const page = location.pathname.split('/').pop() || 'index.html';
    // Research articles belong to Housing News; a bare reader URL has no brief.
    const cur = page === 'research-brief.html' ? 'policy-briefs.html' : page;
    const t = targetHref.split('/').pop();
    return cur.toLowerCase() === t.toLowerCase() ? 'is-active' : '';
  }

  /** Does this group contain sub-entries, and is one of them the current page? */
  function subsAreActive(items) {
    return items.some(l => l.isSub && activeClass(l.href));
  }

  /** Remembered open/closed state for a collapsible run of sub-entries. */
  function subsOpen(key, items) {
    // Expanded when you are already on one of the views — collapsing the menu
    // around the page you are looking at would hide your own location.
    if (subsAreActive(items)) return true;
    try { return localStorage.getItem('nav-subs-' + key) === 'open'; }
    catch (_) { return false; }        // private windows throw on access
  }

  function rememberSubs(key, open) {
    try { localStorage.setItem('nav-subs-' + key, open ? 'open' : 'closed'); }
    catch (_) { /* storage unavailable — the toggle still works for this page */ }
  }

  /**
   * Render one group's items, collapsing each run of isSub entries behind a
   * disclosure row.
   *
   * The five assessment views are children of step 3, not steps in their own
   * right. Rendered flat they added ~400px to a dropdown already taller than
   * the viewport and pushed steps 4-6 below the fold. Collapsed by default the
   * menu is its original length; the run expands on demand, and expands itself
   * when you are already on one of the views.
   */
  function renderItems(items, key, renderOne) {
    const open = subsOpen(key, items);
    const out = [];
    let i = 0;
    while (i < items.length) {
      if (!items[i].isSub) { out.push(renderOne(items[i])); i++; continue; }
      const run = [];
      while (i < items.length && items[i].isSub) { run.push(items[i]); i++; }
      const id = 'nav-subs-' + key + '-' + out.length;
      out.push(
        `<button type="button" class="nav-sub-toggle" aria-expanded="${open}" aria-controls="${id}"` +
        ` data-subs-key="${key}" style="display:block;width:100%;text-align:left;background:none;border:0;` +
        `padding:5px 14px 5px 32px;font:inherit;font-size:.82rem;color:var(--muted);cursor:pointer">` +
        `<span aria-hidden="true" style="opacity:.45;margin-right:7px">└</span>` +
        `${run.length} report views <span class="nav-sub-caret" aria-hidden="true">${open ? '▾' : '▸'}</span>` +
        `</button>`,
        `<div class="nav-subgroup" id="${id}"${open ? '' : ' hidden'}>${run.map(renderOne).join('')}</div>`
      );
    }
    return out.join('');
  }

  function ensureHeaderStyles() {
    if (document.getElementById('nav-injected-styles')) return;
    var link = document.createElement('link');
    link.id = 'nav-injected-styles';
    link.rel = 'stylesheet';
    link.href = relToRoot() + 'css/navigation.css';
    document.head.appendChild(link);
  }

  function _updateJurisdictionPill() {
    var wrap = document.getElementById('jurisdictionPillWrap');
    if (!wrap) return;

    // Try WorkflowState first, fall back to SiteState
    var county = null;
    var city = null;
    try {
      var proj = window.WorkflowState && window.WorkflowState.getActiveProject();
      var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
      if (jx && (jx.name || jx.countyName)) {
        // Two shapes reach here. The selector and the URL context write
        // name = the place ("Fruita (city)") with countyName = its county;
        // older saved projects wrote name = the county with displayName =
        // the place. Reading `name` as the county in both cases produced
        // "Fruita (city) · Fruita" on every page (2026-09-23).
        var isPlace = /^(city|town|cdp|place)$/i.test(jx.type || '');
        county = jx.countyName || (!isPlace ? jx.name : null) || jx.name;
        if (isPlace) {
          var placeLabel = jx.displayName || jx.name || '';
          if (placeLabel && placeLabel !== county) {
            city = placeLabel.replace(/\s*\((?:city|town|CDP)\)/i, '');
          }
        }
      }
    } catch (_) {}

    if (!county) {
      try {
        var sc = window.SiteState && window.SiteState.getCounty();
        if (sc && sc.name) county = sc.name;
      } catch (_) {}
    }

    var root = relToRoot();
    // Place first: the pill truncates at phone width, and "Garfield County ·
    // Glenwood Springs" lost the place the page is about (2026-10-14 walk).
    var pillLabel = city ? city + ' · ' + county : county;

    if (county) {
      wrap.innerHTML =
        '<a href="' + root + 'select-jurisdiction.html" class="jurisdiction-pill" title="Change jurisdiction">' +
          '<span class="jurisdiction-pill__name">' + _esc(pillLabel) + '</span>' +
          ' <span aria-hidden="true" style="opacity:.5;font-size:.75em">▾</span>' +
        '</a>';
    } else {
      wrap.innerHTML =
        '<a href="' + root + 'select-jurisdiction.html" class="jurisdiction-pill jurisdiction-pill--empty">' +
          '+ Choose jurisdiction' +
        '</a>';
    }
  }

  function inject() {
    // Prevent duplicate navigation injection.
    // An existing header is only considered "already injected" when it has content
    // (i.e. contains a .nav-wrap). Empty placeholder headers (e.g. in scenario-builder.html)
    // are replaced so navigation is always present.
    const existingHeader = document.querySelector('header.site-header');
    if (existingHeader && existingHeader.querySelector('.nav-wrap')) {
      return;
    }
    // Remove the empty placeholder so we can insert the full header below
    if (existingHeader) {
      existingHeader.parentNode.removeChild(existingHeader);
    }

    ensureHeaderStyles();

    // Inject mobile-nav stylesheet once
    if (!document.getElementById('mobile-nav-styles-link')) {
      const link = document.createElement('link');
      link.id = 'mobile-nav-styles-link';
      link.rel = 'stylesheet';
      link.href = relToRoot() + 'css/mobile-nav.css';
      document.head.appendChild(link);
    }

    // Header
    const header = document.createElement('header');
    header.className = 'site-header';
    header.setAttribute('role', 'banner');
    header.innerHTML = `
      <div class="nav-wrap">
        <div class="brand">
          <a href="${normalizeHref('index.html')}">COHO Analytics</a>
          <small>Colorado affordable housing data</small>
        </div>
        <div class="jurisdiction-pill-wrap" id="jurisdictionPillWrap">
          <!-- populated by _updateJurisdictionPill() after DOM is ready -->
        </div>
        <nav class="site-nav" aria-label="Primary">
          ${GROUPS.map(g => `
            <div class="nav-group">
              <button class="nav-group-btn" type="button" aria-expanded="false" aria-haspopup="true">
                ${g.label} <span class="nav-caret" aria-hidden="true">▾</span>
              </button>
              <div class="nav-dropdown" hidden>
                ${renderItems(g.items, g.label.replace(/\W+/g, '').toLowerCase(), (l) => {
                  // F177 — Section separator items (isHeader:true) render
                  // as a muted, non-clickable header inside the dropdown
                  // so a section can group primary entries from secondary
                  // (e.g. "Pipeline diagnostics" below the main 3 Data
                  // entries) without forcing a sub-menu component.
                  if (l.isHeader) {
                    return `<div class="nav-dd-header" role="presentation" style="padding:6px 14px 4px;font-size:.8125rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);opacity:.85;border-top:1px solid var(--border);margin-top:6px">${l.label.replace(/^—\s*|\s*—$/g, '')}</div>`;
                  }
                  // Child entries (isSub:true) are indented and rendered a step
                  // down from their parent. The five Housing Needs Assessment
                  // views are views OF step 3, not extra steps beside it, so
                  // they must not read as siblings of steps 4-6 — the 1..6
                  // sequence is the spine of this menu.
                  // Sub-entries are ONE line: label only, no description.
                  // With a description each they added ~400px to this dropdown
                  // and pushed Market Analysis from y=558 to y=992 in a 900px
                  // viewport — steps 4, 5 and 6 fell below the fold, so the
                  // Step 1→6 spine became the part of the menu you could not
                  // see. Dropping the descriptions puts Step 4 back at y=794.
                  // The question each view answers is on the view itself.
                  if (l.isSub) {
                    return `<a class="${activeClass(l.href)} nav-link-sub" href="${normalizeHref(l.href)}" style="padding:5px 14px 5px 32px">
                    <span class="nav-link-label" style="font-weight:500"><span aria-hidden="true" style="opacity:.4;margin-right:7px">└</span>${l.label}</span>
                  </a>`;
                  }
                  // The step number is a badge before the label, so the
                  // description no longer repeats "Step N:" in front of it.
                  const step = /^Step (\d+)(\s*\(optional\))?:\s*/.exec(l.desc || '');
                  const rest = step ? l.desc.slice(step[0].length) : (l.desc || '');
                  const desc = (step && step[2] ? 'Optional. ' : '') + rest.charAt(0).toUpperCase() + rest.slice(1);
                  return `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">
                    <span class="nav-link-label">${step ? `<span class="nav-link-step"><span class="sr-only">Step </span>${step[1]}</span>` : ''}${l.label}${l.isNew ? ' <span class="nav-link-new">NEW</span>' : ''}</span>
                    <span class="nav-link-desc">${desc}</span>
                  </a>`;
                })}
              </div>
            </div>
          `).join('')}
        </nav>
        <form class="nav-search" role="search" method="get" action="${(window.APP_BASE_PATH || '/')}search.html">
          <input type="search" name="q" class="nav-search-input" placeholder="Search…" autocomplete="off" aria-label="Search the site" />
          <button type="submit" class="nav-search-btn" aria-label="Search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
        </form>
        ${memberLink('nav-member-signin')}
        <button id="mobileNavToggle" class="mobile-menu-btn" type="button"
          aria-label="Open navigation menu"
          aria-expanded="false"
          aria-controls="mobileNavDrawer">
          <span></span><span></span><span></span>
        </button>
      </div>
    `;

    // Drawer (mobile slide-in)
    const drawer = document.createElement('aside');
    drawer.id = 'mobileNavDrawer';
    drawer.className = 'mobile-nav-drawer';
    drawer.setAttribute('hidden', '');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Site navigation');
    drawer.innerHTML = `
      <div class="mobile-nav-header">
        <div class="mobile-nav-title">COHO Analytics</div>
        <button type="button" id="mobileNavClose" class="mobile-nav-close" aria-label="Close menu">&#x2715;</button>
      </div>
      <nav class="mobile-nav-links">
        ${GROUPS.map(g => `
          <div class="mobile-nav-section">
            <button class="mobile-nav-section-btn" type="button" aria-expanded="false">
              ${g.label} <span class="nav-caret" aria-hidden="true">▾</span>
            </button>
            <div class="mobile-nav-section-items" hidden>
              ${renderItems(g.items, 'm' + g.label.replace(/\W+/g, '').toLowerCase(), (l) => {
                if (l.isHeader) {
                  return `<div class="mobile-nav-subheader" role="presentation" style="padding:8px 14px 4px;font-size:.8125rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);opacity:.85;border-top:1px solid var(--border);margin-top:6px">${l.label.replace(/^—\s*|\s*—$/g, '')}</div>`;
                }
                if (l.isSub) {
                  return `<a class="${activeClass(l.href)} nav-link-sub" href="${normalizeHref(l.href)}" style="padding-left:30px">${l.label}</a>`;
                }
                return `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">${l.label}${l.isNew ? ' <span class="nav-link-new">NEW</span>' : ''}</a>`;
              })}
            </div>
          </div>
        `).join('')}
        ${memberLink('mobile-nav-member-signin')}
      </nav>
    `;

    // Footer
    // The feedback form is a Google Form owned by the site's maintainer
    // account; entry.440415848 is its "Which page?" field, prefilled so a
    // question arrives with the page it was asked from. Only the parameters
    // that name a jurisdiction are kept: a shared Deal Calculator URL carries
    // a whole project's costs and rents, which must not be sent to Google.
    const FEEDBACK_CONTEXT_PARAMS = ['geoid', 'geoType', 'fips', 'place', 'region', 'geos', 'combinedMode', 'town'];
    const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfC1m7Y1_b3VL_U9rOg8f0nIE14RVg8qm4gvhQaG2Qw8vVOdw/viewform';
    function feedbackFormHref() {
      return FEEDBACK_FORM_URL + '?usp=pp_url&entry.440415848=' +
        encodeURIComponent((window.location.pathname || '/') + feedbackContextQuery());
    }
    function feedbackContextQuery() {
      const params = new URLSearchParams(window.location.search || '');
      const kept = new URLSearchParams();
      FEEDBACK_CONTEXT_PARAMS.forEach(function (key) {
        if (params.has(key)) kept.set(key, params.get(key));
      });
      const query = kept.toString();
      return query ? '?' + query : '';
    }
    const footer = document.createElement('footer');
    // HNA views rewrite the query string as the jurisdiction changes, so the
    // href is refreshed as the link is used (including synthetic clicks from
    // assistive technology), not only at render.
    footer.addEventListener('pointerdown', refreshFeedbackHref, true);
    footer.addEventListener('focusin', refreshFeedbackHref, true);
    footer.addEventListener('keydown', refreshFeedbackHref, true);
    footer.addEventListener('click', refreshFeedbackHref, true);
    function refreshFeedbackHref(e) {
      const link = e.target && e.target.closest && e.target.closest('a[data-feedback-link]');
      if (link) link.href = feedbackFormHref();
    }
    footer.className = 'site-footer';
    footer.setAttribute('role', 'contentinfo');
    footer.innerHTML = `
      <div class="footer-wrap">
        <div class="footer-col">
          <strong>COHO Analytics</strong>
          <p>A public-data reference for Colorado affordable housing — HUD, Census, CHFA, and DOLA sources drawn together for reference.</p>
          <p>Developed and maintained by <a href="https://pggllc.org" target="_blank" rel="noopener">pggLLC</a>.</p>
          <p class="footer-about-links">
            <a href="${normalizeHref('about.html')}">About this site</a>
            <a href="${normalizeHref('sitemap.html')}">Sitemap</a>
            <a href="${feedbackFormHref()}" target="_blank" rel="noopener" data-feedback-link>Questions or feedback</a>
            <a href="mailto:info@cohoanalytics.com">info@cohoanalytics.com</a>
            ${memberLink('footer-member-signin')}
          </p>
        </div>
        <div class="footer-col">
          <strong>Scoping a Project</strong>
          <a href="${normalizeHref('select-jurisdiction.html')}">Select Jurisdiction</a>
          <a href="${normalizeHref('lihtc-opportunity-finder.html')}">Opportunity Finder</a>
          <a href="${normalizeHref('housing-needs-assessment.html')}">Housing Needs Assessment</a>
          <a href="${normalizeHref('market-analysis.html')}">Market Analysis</a>
          <a href="${normalizeHref('deal-calculator.html')}">Deal Calculator</a>
          <a href="${normalizeHref('lihtc-guide-for-stakeholders.html')}">LIHTC Guide</a>
        </div>
        <div class="footer-col">
          <strong>Explore</strong>
          <a href="${normalizeHref('hna-comparative-analysis.html')}">Compare Jurisdictions</a>
          <a href="${normalizeHref('colorado-deep-dive.html')}">Colorado Deep Dive</a>
          <a href="${normalizeHref('where-housing-money-goes.html')}">Where Colorado's Housing Money Goes</a>
        </div>
        <div class="footer-col">
          <strong>Data</strong>
          <a href="${normalizeHref('data-review-hub.html')}">Data Trust Center</a>
          <a href="${normalizeHref('data-explorer.html')}">File Browser</a>
          <a href="${normalizeHref('data-map-browser.html')}">Data Map</a>
        </div>
        <div class="footer-col">
          <strong>Insights</strong>
          <a href="${normalizeHref('policy-briefs.html')}">Housing News</a>
          <a href="${normalizeHref('insights.html')}">Research &amp; Analysis</a>
          <a href="${normalizeHref('methods.html')}">Methods</a>
        </div>
        <!-- On phones, js/dark-mode-toggle.js and js/components/watchlist.js
             move their corner buttons into this row so they never sit over
             the page's text. -->
        <div class="footer-tools"></div>
        <div class="footer-disclaimer">
          <small>This site is a public-data reference. Data comes from public sources, including the Census Bureau, HUD, CHFA, DOLA, BLS and FRED. Not financial or legal advice. <a href="${normalizeHref('methods.html')}#how-we-check">How we check our figures</a></small>
        </div>
      </div>
    `;

    // Insert header at top of body, but after any existing skip link so that
    // the skip link remains the first focusable element for keyboard users.
    const existingSkipLink = document.querySelector('.skip-link');
    if (existingSkipLink && existingSkipLink.parentElement === document.body) {
      document.body.insertBefore(header, existingSkipLink.nextSibling);
    } else {
      document.body.insertBefore(header, document.body.firstChild);
    }

    // Replace any empty footer placeholder (class OR id based), otherwise insert after main
    const existingFooter = document.querySelector('footer.site-footer, footer#site-footer');
    if (existingFooter && !existingFooter.querySelector('.footer-wrap')) {
      existingFooter.parentNode.replaceChild(footer, existingFooter);
    } else if (!existingFooter) {
      const main = document.querySelector('main');
      if (main && main.parentElement) {
        main.parentElement.insertBefore(footer, main.nextSibling);
      } else {
        document.body.appendChild(footer);
      }
    }

    // Inject drawer into body
    document.body.appendChild(drawer);

    // Inject glossary.js once — after header is in the DOM so the glossary
    // button injection can find nav.site-nav immediately, or falls back to
    // the 'nav:rendered' event dispatched at the end of this function.
    if (!document.getElementById('glossary-script')) {
      const gs = document.createElement('script');
      gs.id = 'glossary-script';
      gs.src = relToRoot() + 'js/glossary.js';
      document.body.appendChild(gs);
    }

    // Desktop dropdown toggle
    header.querySelectorAll('.nav-group-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        // Close all dropdowns first
        header.querySelectorAll('.nav-group-btn').forEach(function(b) {
          b.setAttribute('aria-expanded', 'false');
          var dd = b.nextElementSibling;
          if (dd) dd.hidden = true;
        });
        if (!expanded) {
          btn.setAttribute('aria-expanded', 'true');
          var dd = btn.nextElementSibling;
          if (dd) dd.hidden = false;
        }
      });
    });

    // Sub-entry disclosure. Delegated on the header because the nav is
    // re-rendered after DOMContentLoaded, and bound before the outside-click
    // handler so stopPropagation here cannot close the dropdown we just
    // expanded inside.
    header.addEventListener('click', function(e) {
      var t = e.target.closest('.nav-sub-toggle');
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      var open = t.getAttribute('aria-expanded') !== 'true';
      t.setAttribute('aria-expanded', String(open));
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !open;
      var caret = t.querySelector('.nav-sub-caret');
      if (caret) caret.textContent = open ? '\u25be' : '\u25b8';
      rememberSubs(t.getAttribute('data-subs-key'), open);
    });

    // Close dropdowns on outside click
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.nav-group')) {
        header.querySelectorAll('.nav-group-btn').forEach(function(btn) {
          btn.setAttribute('aria-expanded', 'false');
          var dd = btn.nextElementSibling;
          if (dd) dd.hidden = true;
        });
      }
    });

    // Mobile accordion sections
    drawer.querySelectorAll('.mobile-nav-section-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        var items = btn.nextElementSibling;
        if (items) items.hidden = expanded;
      });
    });

    // Hamburger menu open / close
    function openDrawer() {
      drawer.removeAttribute('hidden');
      requestAnimationFrame(function() {
        drawer.setAttribute('data-open', 'true');
      });
      var toggleBtn = document.getElementById('mobileNavToggle');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.setAttribute('aria-label', 'Close navigation menu');
      }
      if (!document.getElementById('mobileNavBackdrop')) {
        var bd = document.createElement('div');
        bd.id = 'mobileNavBackdrop';
        bd.className = 'mobile-nav-backdrop';
        document.body.appendChild(bd);
        bd.addEventListener('click', closeDrawer);
      }
      document.body.style.overflow = 'hidden';
      var firstFocusable = drawer.querySelector('button, a');
      if (firstFocusable) firstFocusable.focus();
    }

    function closeDrawer() {
      drawer.removeAttribute('data-open');
      var toggleBtn = document.getElementById('mobileNavToggle');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.setAttribute('aria-label', 'Open navigation menu');
        toggleBtn.focus();
      }
      var bd = document.getElementById('mobileNavBackdrop');
      if (bd) bd.remove();
      document.body.style.overflow = '';
      // Delay matches the CSS transition duration on .mobile-nav-drawer (180ms)
      var DRAWER_TRANSITION_MS = 200;
      setTimeout(function() {
        if (drawer.getAttribute('data-open') !== 'true') {
          drawer.setAttribute('hidden', '');
        }
      }, DRAWER_TRANSITION_MS);
    }

    // Note: hamburger toggle + close handled by mobile-menu.js (toggleDrawer).
    // Only attach here if mobile-menu.js is not loaded (fallback).
    if (!window.__mobileMenuLoaded) {
      var mobileToggle = document.getElementById('mobileNavToggle');
      if (mobileToggle) {
        mobileToggle.addEventListener('click', openDrawer);
      }
      var mobileClose = document.getElementById('mobileNavClose');
      if (mobileClose) {
        mobileClose.addEventListener('click', closeDrawer);
      }
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && drawer.getAttribute('data-open') === 'true') {
        closeDrawer();
      }
    });

    // Inject a site-wide #statusPanel after the header if one doesn't already exist
    if (!document.getElementById('statusPanel')) {
      const sp = document.createElement('div');
      sp.id = 'statusPanel';
      sp.setAttribute('aria-live', 'polite');
      sp.setAttribute('role', 'status');
      sp.style.cssText = 'display:none;position:relative;z-index:900;padding:.55rem 1.25rem;font-size:.82rem;font-weight:600;background:#7c2d12;color:#fef3c7;border-bottom:1px solid #92400e;';
      const headerEl = document.querySelector('header.site-header, header');
      if (headerEl && headerEl.parentNode) {
        if (headerEl.nextSibling) {
          headerEl.parentNode.insertBefore(sp, headerEl.nextSibling);
        } else {
          headerEl.parentNode.appendChild(sp);
        }
      }
    }

    // Wire up global error handler to surface runtime errors in the status panel
    window.__navShowError = function(msg) {
      var sp = document.getElementById('statusPanel');
      if (!sp) return;
      sp.textContent = '⚠ ' + msg;
      sp.style.display = 'block';
    };

    // Capture unhandled JS errors and show them in the status panel
    window.addEventListener('error', function(ev) {
      var msg = (ev && ev.message) ? ev.message : 'An unexpected error occurred.';
      window.__navShowError(msg);
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', function(ev) {
      var msg = (ev && ev.reason && ev.reason.message) ? ev.reason.message : 'An unhandled error occurred.';
      window.__navShowError(msg);
    });

    // #12 — Project switcher: click pill → show dropdown with recent projects + New Project
    (function () {
      var _jxDropdown = null;
      function _closeJxDropdown() {
        if (_jxDropdown) { _jxDropdown.remove(); _jxDropdown = null; }
      }
      var pillWrap = document.getElementById('jurisdictionPillWrap');
      if (pillWrap) {
        pillWrap.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (_jxDropdown) { _closeJxDropdown(); return; }
          var root = relToRoot();
          var rows = '';
          try {
            var projects = window.WorkflowState && window.WorkflowState.listProjects() || [];
            var active   = window.WorkflowState && window.WorkflowState.getActiveProject();
            var activeId = active && active.id;
            if (projects.length) {
              rows += '<div class="jx-dropdown__label">Recent projects</div>';
              projects.slice(0, 3).forEach(function (p) {
                var isCur = p.id === activeId;
                rows += '<button class="jx-dropdown__item' + (isCur ? '" style="font-weight:700' : '') +
                  '" data-proj-id="' + _esc(p.id) + '">' + (isCur ? '● ' : '') +
                  _esc((p.name || 'Untitled project').slice(0, 28)) + '</button>';
              });
            }
          } catch (_) {}
          rows += '<a class="jx-dropdown__item jx-dropdown__item--new" href="' + root + 'select-jurisdiction.html?new=1">＋ New Project</a>';
          _jxDropdown = document.createElement('div');
          _jxDropdown.className = 'jx-dropdown';
          _jxDropdown.innerHTML = rows;
          // Wire project load buttons
          _jxDropdown.querySelectorAll('[data-proj-id]').forEach(function (btn) {
            btn.addEventListener('click', function (btnEvt) {
              btnEvt.stopPropagation();
              try { window.WorkflowState && window.WorkflowState.loadProject(btn.getAttribute('data-proj-id')); } catch (_) {}
              _closeJxDropdown();
              _updateJurisdictionPill();
            });
          });
          // F231 — Stop the "+ New Project" anchor click from bubbling up
          // to pillWrap's click handler, which calls e.preventDefault() on
          // every click and was silently swallowing the navigation. The
          // anchor's default-action (navigate to href) is what we want;
          // we just have to keep it out of the toggle handler's reach.
          var newProjBtn = _jxDropdown.querySelector('.jx-dropdown__item--new');
          if (newProjBtn) {
            newProjBtn.addEventListener('click', function (anchorEvt) {
              anchorEvt.stopPropagation(); // let the browser navigate; don't preventDefault
              // Best-effort clear of stale jurisdiction context so the
              // destination page's ?new=1 handler doesn't accidentally
              // inherit the old county into the new project's name.
              try { window.SiteState && window.SiteState.setCounty && window.SiteState.setCounty(null); } catch (_) {}
            });
          }
          pillWrap.appendChild(_jxDropdown);
          // Delay listener registration so the current click doesn't immediately close it
          setTimeout(function () {
            document.addEventListener('click', function _outside(ev) {
              if (!pillWrap.contains(ev.target)) { _closeJxDropdown(); document.removeEventListener('click', _outside); }
            });
          }, 10);
        });
      }
    }());

    _updateJurisdictionPill();
    document.addEventListener('workflow:step-updated', _updateJurisdictionPill);
    document.addEventListener('sitestate:county-changed', _updateJurisdictionPill);

    document.dispatchEvent(new CustomEvent('nav:rendered'));
  }

  // Place-profile pages get a plain-language AMI-tier explainer, loaded on demand.
  function loadPlaceProfileHelp() {
    if (!document.getElementById('psTier100p')) return;            // place profiles only
    if (document.getElementById('place-profile-help-script')) return;
    var s = document.createElement('script');
    s.id = 'place-profile-help-script';
    s.src = (window.APP_BASE_PATH || relToRoot() || '') + 'js/place-profile-help.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  // Site favicon — injected here so every page gets it, replacing the stale
  // cached favicon from the old host. Skipped if the page declares its own.
  function ensureFavicon() {
    if (document.querySelector('link[rel~="icon"]')) return;
    var l = document.createElement('link');
    l.rel = 'icon';
    l.type = 'image/svg+xml';
    l.href = (window.APP_BASE_PATH || relToRoot() || '') + 'favicon.svg';
    document.head.appendChild(l);
  }

  // Cloudflare Web Analytics: cookieless, anonymous visit counts (see
  // privacy-policy.html). The token is public by design; it ends up in the
  // page source either way. Empty token = no beacon. The /developer* pages are
  // excluded so gated work does not show up in the public site's traffic.
  var CF_ANALYTICS_TOKEN = 'd8f83044c0ed43bc89e766a9ecc23c6a';
  function loadAnalytics() {
    if (!CF_ANALYTICS_TOKEN) return;
    if (location.hostname !== 'cohoanalytics.com' && location.hostname !== 'www.cohoanalytics.com') return;
    var page = location.pathname.split('/').pop() || '';
    if (/^developer/.test(page)) return;
    if (document.getElementById('cf-web-analytics')) return;
    var s = document.createElement('script');
    s.id = 'cf-web-analytics';
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_ANALYTICS_TOKEN }));
    document.head.appendChild(s);
  }

  function boot() { ensureFavicon(); inject(); addOwnershipProgramLink(); loadPlaceProfileHelp(); loadAnalytics(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
