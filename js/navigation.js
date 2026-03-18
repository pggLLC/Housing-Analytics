/**
 * navigation.js — COHO Analytics
 * Injects a consistent header + footer across pages.
 * Uses site-theme.css variables.
 */
(function () {
  const GROUPS = [
    {
      label: "Platform",
      items: [
        { label: "Housing Needs Assessment", href: "housing-needs-assessment.html", desc: "County & municipal HNA tool" },
        { label: "Market Analysis", href: "market-analysis.html", desc: "PMA & feasibility" },
        { label: "Colorado Deep Dive", href: "colorado-deep-dive.html", desc: "County-level detail" },
        { label: "Economic Dashboard", href: "economic-dashboard.html", desc: "FRED indicators" },
        { label: "LIHTC Dashboard", href: "LIHTC-dashboard.html", desc: "Allocation maps" },
      ]
    },
    {
      label: "Data &amp; Research",
      items: [
        { label: "Market Intelligence", href: "market-intelligence.html", desc: "Statewide market data" },
        { label: "State Allocations", href: "state-allocation-map.html", desc: "2026 LIHTC allocations" },
        { label: "CHFA Portfolio", href: "chfa-portfolio.html", desc: "CHFA LIHTC projects" },
        { label: "Construction Costs", href: "construction-commodities.html", desc: "PPI & commodities" },
        { label: "Preservation Tracking", href: "preservation.html", desc: "NHPD subsidy expiry" },
        { label: "Data Sources", href: "dashboard-data-sources-ui.html", desc: "All 43+ data sources" },
      ]
    },
    {
      label: "Policy &amp; Insights",
      items: [
        { label: "Market Insights", href: "insights.html", desc: "Analysis & commentary" },
        { label: "Weekly Housing Brief", href: "private/weekly-brief/index.html", desc: "Weekly intelligence brief" },
        { label: "LIHTC Guide", href: "lihtc-guide-for-stakeholders.html", desc: "LIHTC basics" },
        { label: "LIHTC Enhancement (AHCIA)", href: "lihtc-enhancement-ahcia.html", desc: "AHCIA provisions" },
        { label: "Housing Legislation", href: "housing-legislation-2026.html", desc: "2026 bills tracker" },
        { label: "Policy Briefs", href: "policy-briefs.html", desc: "Research summaries" },
        { label: "CRA Expansion", href: "cra-expansion-analysis.html", desc: "CRA opportunity areas" },
      ]
    },
    {
      label: "About",
      items: [
        { label: "Home", href: "index.html", desc: "Platform overview" },
        { label: "About COHO", href: "about.html", desc: "Platform & methodology" },
        { label: "Regional Overview", href: "regional.html", desc: "Regional comparisons" },
        { label: "Colorado Market", href: "colorado-market.html", desc: "Market conditions" },
        { label: "Compliance Dashboard", href: "compliance-dashboard.html", desc: "Prop 123 compliance" },
        { label: "Sitemap", href: "sitemap.html", desc: "All pages" },
        { label: "Privacy Policy", href: "privacy-policy.html", desc: "Data & privacy" },
        { label: "Dashboard (Legacy)", href: "dashboard.html", desc: "Legacy dashboard" },
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
    const s = document.createElement('style');
    s.id = 'nav-injected-styles';
    s.textContent = `
      header.site-header{position:sticky;top:0;z-index:1000;background:var(--card);border-bottom:1px solid var(--border);backdrop-filter:saturate(1.2) blur(10px)}
      .nav-wrap{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 18px;gap:14px}
      .brand{display:flex;flex-direction:column;gap:2px}
      .brand a{font-weight:800;letter-spacing:.2px;color:var(--text);text-decoration:none}
      .brand small{color:var(--muted);font-weight:600}
      nav.site-nav{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      nav.site-nav a{padding:8px 10px;border-radius:999px;border:1px solid transparent;color:var(--text);text-decoration:none;font-weight:700;font-size:.92rem}
      nav.site-nav a:hover{background:color-mix(in oklab, var(--card) 70%, var(--accent) 30%);border-color:color-mix(in oklab, var(--border) 60%, var(--accent) 40%)}
      nav.site-nav a.is-active{background:color-mix(in oklab, var(--card) 60%, var(--accent) 40%);border-color:color-mix(in oklab, var(--border) 40%, var(--accent) 60%)}
      footer.site-footer{margin-top:32px;border-top:1px solid var(--border);background:var(--bg2)}
      main{max-width:1200px;margin:0 auto;padding:18px}
      .mobile-menu-btn{display:none;flex-direction:column;justify-content:center;align-items:center;gap:5px;width:44px;height:44px;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:8px}
      .mobile-menu-btn span{display:block;width:18px;height:2px;background:var(--text);border-radius:2px;transition:transform 0.2s,opacity 0.2s}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(1){transform:translateY(7px) rotate(45deg)}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(2){opacity:0}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
      .nav-group{position:relative}
      .nav-group-btn{background:none;border:none;cursor:pointer;color:var(--text);font-weight:700;font-size:.92rem;padding:8px 10px;border-radius:999px;border:1px solid transparent;display:flex;align-items:center;gap:4px}
      .nav-group-btn:hover{background:color-mix(in oklab,var(--card) 70%,var(--accent) 30%);border-color:color-mix(in oklab,var(--border) 60%,var(--accent) 40%)}
      .nav-dropdown{position:absolute;top:100%;left:0;min-width:220px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:6px;z-index:2000}
      .nav-dropdown a{display:flex;flex-direction:column;padding:8px 10px;border-radius:6px;color:var(--text);text-decoration:none}
      .nav-dropdown a:hover{background:color-mix(in oklab,var(--card) 70%,var(--accent) 30%)}
      .nav-link-label{font-weight:700;font-size:.9rem}
      .nav-link-desc{font-size:.78rem;color:var(--muted)}
      .nav-caret{font-size:.7em;transition:transform .2s}
      [aria-expanded="true"] .nav-caret{transform:rotate(180deg)}
      .mobile-nav-section-btn{width:100%;text-align:left;background:none;border:none;padding:12px 16px;font-weight:700;color:var(--text);cursor:pointer;display:flex;justify-content:space-between;border-bottom:1px solid var(--border)}
      .mobile-nav-section-items a{display:block;padding:10px 24px;color:var(--text);text-decoration:none}
      .footer-wrap{max-width:1200px;margin:0 auto;padding:24px 18px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
      .footer-col{display:flex;flex-direction:column;gap:8px}
      .footer-col strong{font-size:.95rem;color:var(--text)}
      .footer-col a{color:var(--muted);text-decoration:none;font-size:.88rem}
      .footer-col a:hover{color:var(--text)}
      .footer-col p{color:var(--muted);font-size:.82rem;margin:0}
      .footer-disclaimer{grid-column:1/-1;border-top:1px solid var(--border);padding-top:16px;color:var(--muted);font-size:.8rem}
      @media(max-width:768px){
        .mobile-menu-btn{display:flex}
        nav.site-nav{display:none}
        .footer-wrap{grid-template-columns:1fr}
      }
    `;
    document.head.appendChild(s);
  }

  function inject() {
    // Prevent duplicate navigation injection
    if (document.querySelector('header.site-header')) {
      return;
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
          <strong>Platform</strong>
          <a href="${normalizeHref('housing-needs-assessment.html')}">Housing Needs Assessment</a>
          <a href="${normalizeHref('market-analysis.html')}">Market Analysis</a>
          <a href="${normalizeHref('colorado-deep-dive.html')}">Colorado Deep Dive</a>
        </div>
        <div class="footer-col">
          <strong>Data</strong>
          <a href="${normalizeHref('economic-dashboard.html')}">Economic Dashboard</a>
          <a href="${normalizeHref('LIHTC-dashboard.html')}">LIHTC Allocations</a>
          <a href="${normalizeHref('market-intelligence.html')}">Market Intelligence</a>
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

    // Append footer after main (or at end)
    const main = document.querySelector('main');
    if (main && main.parentElement) {
      main.parentElement.insertBefore(footer, main.nextSibling);
    } else {
      document.body.appendChild(footer);
    }

    // Inject drawer into body
    document.body.appendChild(drawer);

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

    document.dispatchEvent(new CustomEvent('nav:rendered'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
