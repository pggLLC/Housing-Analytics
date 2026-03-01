/**
 * navigation.js
 * Injects a consistent header + footer across pages.
 * Uses site-theme.css variables.
 */
(function () {
  const LINKS = [
    { label: "Home", href: "index.html" },
    { label: "Dashboard", href: "economic-dashboard.html" },
    { label: "Housing Needs", href: "housing-needs-assessment.html" },
    { label: "Market Insights", href: "insights.html" },
    { label: "LIHTC Allocation", href: "LIHTC-dashboard.html" },
    { label: "LIHTC Basics", href: "lihtc-guide-for-stakeholders.html" },
    { label: "About", href: "about.html" },
  ];

  function relToRoot() {
    // If a page lives in a subfolder (e.g., /docs/), back out.
    const depth = location.pathname.split('/').filter(Boolean).length;
    // GitHub pages includes repo name; keep it simple: if current path includes '/docs/', go up one.
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
      .footer-wrap{max-width:1200px;margin:0 auto;padding:18px;color:var(--muted);display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center}
      .footer-wrap a{color:var(--muted);text-decoration:none}
      .footer-wrap a:hover{color:var(--text)}
      main{max-width:1200px;margin:0 auto;padding:18px}
      .mobile-menu-btn{display:none;flex-direction:column;justify-content:center;align-items:center;gap:5px;width:44px;height:44px;background:none;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:8px}
      .mobile-menu-btn span{display:block;width:18px;height:2px;background:var(--text);border-radius:2px;transition:transform 0.2s,opacity 0.2s}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(1){transform:translateY(7px) rotate(45deg)}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(2){opacity:0}
      .mobile-menu-btn[aria-expanded="true"] span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
      @media(max-width:768px){
        .mobile-menu-btn{display:flex}
        nav.site-nav{display:none}
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
          <a href="${normalizeHref('index.html')}">Affordable Housing Intelligence</a>
          <small>Affordable Housing Market Intelligence</small>
        </div>
        <nav class="site-nav" aria-label="Primary">
          ${LINKS.map(l => `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">${l.label}</a>`).join('')}
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
        <div class="mobile-nav-title">Menu</div>
        <button type="button" id="mobileNavClose" class="mobile-nav-close" aria-label="Close menu">&#x2715;</button>
      </div>
      <nav class="mobile-nav-links">
        ${LINKS.map(l => `<a class="${activeClass(l.href)}" href="${normalizeHref(l.href)}">${l.label}</a>`).join('')}
      </nav>
    `;

    // Footer
    const year = new Date().getFullYear();
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.setAttribute('role', 'contentinfo');
    footer.innerHTML = `
      <div class="footer-wrap">
        <div>© ${year} Affordable Housing Intelligence</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <a href="${normalizeHref('about.html')}">Methodology</a>
          <a href="${normalizeHref('economic-dashboard.html')}">Economic Dashboard</a>
          <a href="${normalizeHref('LIHTC-dashboard.html')}">Allocations</a>
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

    document.dispatchEvent(new CustomEvent('nav:rendered'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
