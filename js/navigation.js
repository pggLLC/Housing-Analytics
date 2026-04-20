/**
 * navigation.js — COHO Analytics
 * Injects a consistent header + footer across pages.
 * Uses site-theme.css variables.
 *
 * Information Architecture:
 * ─────────────────────────────────────────────────────────────────────────
 * PRIMARY WORKFLOW (Scoping a Project group):
 *   Select Jurisdiction → Housing Needs Assessment → Market Analysis
 *   → Scenario Builder → Deal Calculator
 *
 * EXPLORE:
 *   Compare Jurisdictions, Colorado Deep Dive, Market Intelligence,
 *   LIHTC Allocations, CHFA Portfolio, Economic Dashboard
 *
 * DATA:
 *   Data Health, Data Quality, Preservation Tracking, Data Review
 *
 * INSIGHTS:
 *   Market Insights, LIHTC Guide, Housing Legislation, CRA Expansion,
 *   About COHO
 * ─────────────────────────────────────────────────────────────────────────
 */
(function () {
  const GROUPS = [
    {
      label: "Scoping a Project",
      items: [
        { label: "Select Jurisdiction",     href: "select-jurisdiction.html",     desc: "Choose your county or city" },
        { label: "Housing Needs Assessment",href: "housing-needs-assessment.html", desc: "HNA tool & county profile" },
        { label: "Market Analysis",         href: "market-analysis.html",          desc: "PMA, comparables & feasibility" },
        { label: "Land Value Negotiation",  href: "land-value-negotiation.html",   desc: "Residual land value & negotiation" },
        { label: "Scenario Builder",        href: "hna-scenario-builder.html",     desc: "20-year projection scenarios" },
        { label: "Deal Calculator",         href: "deal-calculator.html",          desc: "LIHTC pro forma & capital stack" },
      ]
    },
    {
      label: "Explore",
      items: [
        { label: "Compare Jurisdictions", href: "hna-comparative-analysis.html", desc: "Statewide needs ranking & comparison" },
        { label: "Colorado Deep Dive",    href: "colorado-deep-dive.html",        desc: "County-level detail & market overview" },
        { label: "Market Intelligence",   href: "market-intelligence.html",       desc: "Statewide market data" },
        { label: "LIHTC Allocations",     href: "lihtc-allocations.html",         desc: "State allocation maps & data" },
        { label: "CHFA Portfolio",        href: "chfa-portfolio.html",            desc: "CHFA LIHTC projects" },
        { label: "Economic Dashboard",    href: "economic-dashboard.html",        desc: "FRED economic indicators" },
        { label: "Census Explorer",      href: "census-dashboard.html",          desc: "Interactive ACS census data browser" },
      ]
    },
    {
      label: "Data",
      items: [
        { label: "Data Health",           href: "data-status.html",               desc: "Pipeline & data freshness" },
        { label: "Data Quality",          href: "dashboard-data-quality.html",    desc: "Dataset coverage & freshness" },
        { label: "Preservation Tracking", href: "preservation.html",              desc: "NHPD subsidy expiry" },
        { label: "Data Review",           href: "data-review-hub.html",           desc: "Review & transparency" },
      ]
    },
    {
      label: "Insights",
      items: [
        { label: "Market Insights",       href: "insights.html",                  desc: "Analysis & commentary" },
        { label: "Housing News",           href: "policy-briefs.html",             desc: "News alerts & policy briefs" },
        { label: "LIHTC Guide",           href: "lihtc-guide-for-stakeholders.html", desc: "LIHTC basics for all audiences" },
        { label: "Housing Legislation",   href: "housing-legislation-2026.html",  desc: "2026 bills tracker" },
        { label: "CRA Expansion",         href: "cra-expansion-analysis.html",    desc: "CRA opportunity areas" },
        { label: "About COHO",            href: "about.html",                     desc: "Platform & methodology" },
      ]
    }
  ];

  function relToRoot() {
    // If a page lives in a subfolder, back out to the repo root.
    if (location.pathname.includes('/private/weekly-brief/')) return '../../';
    if (location.pathname.includes('/docs/')) return '../';
    return '';
  }

  function normalizeHref(href) {
    // Keep absolute URLs unchanged.
    if (/^https?:\/\//i.test(href)) return href;
    return relToRoot() + href;
  }

  function activeClass(targetHref) {
    const cur = location.pathname.split('/').pop() || 'index.html';
    const t = targetHref.split('/').pop();
    return cur.toLowerCase() === t.toLowerCase() ? 'is-active' : '';
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
        county = jx.name || jx.countyName;
        if (jx.type === 'city' && jx.displayName) {
          city = jx.displayName.replace(/\s*\((?:city|town|CDP)\)/i, '');
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
    var pillLabel = city ? county + ' · ' + city : county;

    if (county) {
      wrap.innerHTML =
        '<a href="' + root + 'select-jurisdiction.html" class="jurisdiction-pill" title="Change jurisdiction">' +
          '<span class="jurisdiction-pill__name">' + pillLabel + '</span>' +
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
          <small>Colorado Housing Intelligence</small>
        </div>
        <div class="jurisdiction-pill-wrap" id="jurisdictionPillWrap">
          <!-- populated by _updateJurisdictionPill() after DOM is ready -->
        </div>
        <div class="audience-toggle" id="audienceToggleWrap" aria-label="Audience view">
          <button class="audience-toggle__btn" type="button" data-audience="elected" aria-pressed="false">Elected</button>
          <button class="audience-toggle__btn" type="button" data-audience="developer" aria-pressed="true">Developer</button>
          <button class="audience-toggle__btn" type="button" data-audience="financier" aria-pressed="false">Financier</button>
        </div>
        <nav class="site-nav" aria-label="Primary">
          ${GROUPS.map(g => `
            <div class="nav-group">
              <button class="nav-group-btn" type="button" aria-expanded="false" aria-haspopup="true">
                ${g.label} <span class="nav-caret" aria-hidden="true">▾</span>
              </button>
              <div class="nav-dropdown" hidden>
                ${g.items.map(l => `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">
                  <span class="nav-link-label">${l.label}</span>
                  <span class="nav-link-desc">${l.desc}</span>
                </a>`).join('')}
              </div>
            </div>
          `).join('')}
        </nav>
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
              ${g.items.map(l => `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">${l.label}</a>`).join('')}
            </div>
          </div>
        `).join('')}
      </nav>
    `;

    // Footer
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.setAttribute('role', 'contentinfo');
    footer.innerHTML = `
      <div class="footer-wrap">
        <div class="footer-col">
          <strong>COHO Analytics</strong>
          <p>Colorado Housing Intelligence — data-driven insights for affordable housing professionals.</p>
        </div>
        <div class="footer-col">
          <strong>Scoping a Project</strong>
          <a href="${normalizeHref('select-jurisdiction.html')}">Select Jurisdiction</a>
          <a href="${normalizeHref('housing-needs-assessment.html')}">Housing Needs Assessment</a>
          <a href="${normalizeHref('market-analysis.html')}">Market Analysis</a>
          <a href="${normalizeHref('deal-calculator.html')}">Deal Calculator</a>
        </div>
        <div class="footer-col">
          <strong>Explore &amp; Learn</strong>
          <a href="${normalizeHref('hna-comparative-analysis.html')}">Compare Jurisdictions</a>
          <a href="${normalizeHref('lihtc-guide-for-stakeholders.html')}">LIHTC Guide</a>
          <a href="${normalizeHref('insights.html')}">Market Insights</a>
          <a href="${normalizeHref('policy-briefs.html')}">Housing News</a>
        </div>
        <div class="footer-disclaimer">
          <small>COHO Analytics is an independent research platform. Data is sourced from public datasets (FRED, HUD, Census Bureau, CHFA). Not financial or legal advice.</small>
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

    // #11 — Audience toggle: restore saved preference, wire buttons
    (function () {
      var saved = '';
      try { saved = localStorage.getItem('coho_audience') || 'developer'; } catch (_) {}
      var toggleWrap = document.getElementById('audienceToggleWrap');
      if (toggleWrap) {
        toggleWrap.querySelectorAll('[data-audience]').forEach(function (btn) {
          var aud = btn.getAttribute('data-audience');
          btn.setAttribute('aria-pressed', String(aud === saved));
          btn.addEventListener('click', function () {
            try { localStorage.setItem('coho_audience', aud); } catch (_) {}
            toggleWrap.querySelectorAll('[data-audience]').forEach(function (b) {
              b.setAttribute('aria-pressed', String(b === btn));
            });
            if (window.EduCallout && window.EduCallout.setAudience) window.EduCallout.setAudience(aud);
            if (window.LihtcTips && window.LihtcTips.setAudience) window.LihtcTips.setAudience(aud);
          });
        });
        // Apply saved audience to modules when they load
        document.addEventListener('DOMContentLoaded', function () {
          if (window.EduCallout && window.EduCallout.setAudience) window.EduCallout.setAudience(saved);
          if (window.LihtcTips && window.LihtcTips.setAudience) window.LihtcTips.setAudience(saved);
        });
      }
    }());

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
                  '" data-proj-id="' + p.id + '">' + (isCur ? '● ' : '') +
                  (p.name || 'Untitled project').slice(0, 28) + '</button>';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
