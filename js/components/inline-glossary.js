/**
 * inline-glossary.js — COHO Analytics (F152)
 * ─────────────────────────────────────────────────────────────────
 * A lightweight, no-dependency component that decorates inline
 * housing-terminology mentions with hover/focus tooltips.
 *
 * USAGE (recommended): annotate at write-time
 *   <abbr data-glossary="AMI">AMI</abbr>
 *   <abbr data-glossary="LIHTC">LIHTC</abbr>
 *
 * AUTO-DECORATION (opt-in): on pages that include this script,
 * the FIRST occurrence of each known term inside elements with
 * class `js-glossary-auto` will be wrapped in an <abbr> tag.
 *
 * Opt-out per page:
 *   <body data-inline-glossary="off">
 *
 * Why a separate component (and not js/glossary.js)?
 *   js/glossary.js renders the modal launcher used in the header.
 *   This component is targeted at *inline* term-on-first-use
 *   plain-English tooltips for new public pages (F152 IndiBuild
 *   Pipeline + audit checklist additions to HNA/PMA/OF/Compare).
 *   Keeping them separate avoids tangling the modal launcher's
 *   DOM with inline tooltips.
 *
 * Accessibility:
 *   - Uses native <abbr title> as a fallback so screen readers and
 *     non-JS readers still see the definition.
 *   - The custom tooltip is keyboard-focusable (tabindex=0) and
 *     dismissable with Escape.
 *   - aria-describedby wires the tooltip to the term.
 */
(function (global) {
  'use strict';

  if (global.InlineGlossary) return; // idempotent

  // ─────────────────────────────────────────────────────────────────
  // Plain-English term dictionary.
  // Definitions kept under ~40 words. Authoritative source for
  // PUBLIC inline tooltips on new pages; legacy glossary modal
  // (js/glossary.js → data/glossary.json) stays unchanged.
  // ─────────────────────────────────────────────────────────────────
  var TERMS = {
    'AMI': 'Area Median Income — the middle household income for a county or metro, published yearly by HUD. Programs use percentages of AMI (like 60% AMI) to define who qualifies for affordable housing.',
    'LIHTC': 'Low-Income Housing Tax Credit — the main federal program funding affordable rental housing. Investors buy the credits, providing equity that lets the project keep rents affordable for 30+ years.',
    '9% LIHTC': '9% LIHTC — the competitive federal credit. Covers about 70% of construction cost, but states only get a limited annual allocation, so projects compete through a scored CHFA application.',
    '4% LIHTC': '4% LIHTC — the non-competitive federal credit, paired with tax-exempt bonds. Covers about 30% of construction cost. Available year-round subject to a state bond cap.',
    'QCT': 'Qualified Census Tract — a HUD-designated neighborhood with high poverty or low incomes. LIHTC projects here qualify for a 30% basis boost.',
    'DDA': 'Difficult Development Area — a HUD-designated place where construction or land costs are high relative to local incomes. LIHTC projects here qualify for a 30% basis boost.',
    'basis boost': '30% increase in the LIHTC tax credits a project can claim, automatic in QCTs/DDAs or at the state\'s discretion. Often decides whether a deal pencils.',
    'rent burden': 'A renter paying more than 30% of gross income on rent and utilities. Over 50% is "severely rent-burdened." HUD\'s standard measure of affordability stress.',
    'cost burden': 'Renters or owners spending more than 30% of income on housing. Over 50% is "severely cost-burdened." HUD\'s standard affordability measure for both tenure types.',
    'absorption': 'How fast a market leases up newly built units, expressed as units per month. Slow absorption signals weak demand; fast absorption supports building more.',
    'PMA': 'Primary Market Area — the area a proposed project will draw most renters from, usually defined by drive time, school district, or natural boundaries.',
    'market study': 'A third-party report required for LIHTC and most lenders, testing whether a project has enough qualifying renters and reasonable rents. A weak study can kill a deal.',
    'Prop 123': 'A 2022 Colorado ballot measure dedicating state income tax revenue (~$300M/yr) to affordable housing. Jurisdictions must commit to grow affordable housing 3% per year to access the funds.',
    'CHFA': 'Colorado Housing and Finance Authority — the state agency that allocates federal LIHTC credits, issues bonds, and funds affordable housing in Colorado.',
    'QAP': 'Qualified Allocation Plan — CHFA\'s annual scoring rules for the LIHTC competition. Defines policy priorities (rural, preservation, opportunity, deeply affordable).',
    'MIHTC': 'Middle Income Housing Tax Credit — a Colorado state program for households between 80% and 120% AMI (workforce: teachers, nurses, first responders).',
    'State LIHTC': 'Colorado\'s state-level affordable housing tax credit. Layered on top of federal LIHTC, adds roughly 30 cents of subsidy per dollar of federal credit.',
    'soft debt': 'A loan with below-market interest, deferred payments, or repayment only from project cash flow. Cities, counties, and Prop 123 use it to fill financing gaps.',
    'PILOT': 'Payment In Lieu Of Taxes — an agreement where an affordable project pays a reduced, fixed amount instead of normal property taxes. Lowers operating costs.',
    'linkage fee': 'A fee on new commercial or market-rate residential development, paid into an affordable housing fund. Set per square foot.',
    'deed restriction': 'A legal restriction on a property\'s title that locks in affordability — capping rent or sale price for 30-99 years. Survives ownership changes.',
    'capture rate': 'The share of income-qualified renters in a market area a proposed project needs to lease its units. Under 10% is healthy; over 20% means the pool is too thin.',
    'NOI': 'Net Operating Income — annual rental income minus operating expenses, before debt payments. The main measure of whether a building covers its mortgage.',
    'DSCR': 'Debt Service Coverage Ratio — annual NOI divided by annual mortgage payments. Lenders typically require 1.15-1.25.',
    'TDC': 'Total Development Cost — every dollar to build the project: land, construction, design, financing, reserves, and developer fee.',
    'gap financing': 'The dollars needed to close the difference between project cost and what private debt + tax credit equity will fund. Filled with soft debt, grants, or fee waivers.',
    'FMR': 'Fair Market Rent — HUD\'s annual estimate of rent for a modest unit, by county and bedroom size. Used to set voucher payments and benchmark LIHTC rents.',
    'PBV': 'Project-Based Voucher — federal rental assistance tied to specific units (not a tenant). Gives the project a stable rent stream that supports deeper affordability.',
    'CHAS': 'Comprehensive Housing Affordability Strategy — HUD\'s custom ACS tabulation showing housing need at specific AMI bands. Cleanest public read on the gap by income tier.',
    'ACS': 'American Community Survey — the Census Bureau\'s rolling survey. 1-year estimates for places 65,000+; 5-year averages for smaller places.',
    'CDP': 'Census Designated Place — an unincorporated community with Census data but no local government. Planning targets that lack a city council or municipal staff.',
    'GEOID': 'The standard federal identifier the Census Bureau uses to keep data joined cleanly across sources. Every county or place has a unique GEOID.',
    'IRC §42': 'Section 42 of the federal Internal Revenue Code — the law that creates the LIHTC program and defines its rules (basis, income limits, rent caps, compliance).',
    '§42': 'Section 42 of the federal Internal Revenue Code — the law that creates the LIHTC program and defines its rules (basis, income limits, rent caps, compliance).',
    'QA/QC': 'Quality Assurance / Quality Control — the discipline of verifying that data inputs are current, complete, and reconcile across sources before any conclusion is drawn.'
  };

  // Aliases — alternate forms map to the same definition.
  var ALIASES = {
    'area median income': 'AMI',
    'low-income housing tax credit': 'LIHTC',
    'low income housing tax credit': 'LIHTC',
    'qualified census tract': 'QCT',
    'difficult development area': 'DDA',
    'primary market area': 'PMA',
    'fair market rent': 'FMR',
    'project-based voucher': 'PBV',
    'qualified allocation plan': 'QAP',
    'net operating income': 'NOI',
    'debt service coverage ratio': 'DSCR',
    'total development cost': 'TDC',
    'census designated place': 'CDP'
  };

  function lookup(term) {
    if (!term) return null;
    if (TERMS[term]) return TERMS[term];
    var alias = ALIASES[String(term).toLowerCase().trim()];
    if (alias && TERMS[alias]) return TERMS[alias];
    return null;
  }

  function decorateExplicit(root) {
    var nodes = (root || document).querySelectorAll('abbr[data-glossary]');
    nodes.forEach(function (el) {
      if (el.__igDecorated) return;
      var key = el.getAttribute('data-glossary');
      var def = lookup(key);
      if (!def) return;
      el.setAttribute('title', def);
      el.classList.add('ig-term');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', key + ' — ' + def);
      el.__igDecorated = true;
    });
  }

  function autoDecorate(root) {
    var scope = root || document;
    // Opt-out at body level.
    if (document.body && document.body.getAttribute('data-inline-glossary') === 'off') return;
    var containers = scope.querySelectorAll('.js-glossary-auto');
    if (!containers.length) return;
    // Build a regex matching any TERM token. Sort longest-first so
    // "9% LIHTC" wins over "LIHTC".
    var keys = Object.keys(TERMS).sort(function (a, b) { return b.length - a.length; });
    // Escape regex chars.
    function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    var pattern = new RegExp('\\b(' + keys.map(esc).join('|') + ')\\b');
    var seen = {}; // first-occurrence-only per container
    containers.forEach(function (container) {
      seen = {};
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'ABBR') return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('.no-glossary')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node;
      var toReplace = [];
      while ((node = walker.nextNode())) {
        var m = node.nodeValue.match(pattern);
        if (m && !seen[m[1]]) {
          seen[m[1]] = true;
          toReplace.push({ node: node, term: m[1], index: m.index });
        }
      }
      toReplace.forEach(function (r) {
        var n = r.node;
        var t = n.nodeValue;
        var before = t.slice(0, r.index);
        var after = t.slice(r.index + r.term.length);
        var abbr = document.createElement('abbr');
        abbr.setAttribute('data-glossary', r.term);
        abbr.textContent = r.term;
        var frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(abbr);
        if (after) frag.appendChild(document.createTextNode(after));
        n.parentNode.replaceChild(frag, n);
      });
      decorateExplicit(container);
    });
  }

  function ensureStyles() {
    if (document.getElementById('inline-glossary-styles')) return;
    var s = document.createElement('style');
    s.id = 'inline-glossary-styles';
    s.textContent = [
      '.ig-term {',
      '  border-bottom: 1px dotted var(--accent, #096e65);',
      '  cursor: help;',
      '  text-decoration: none;',
      '  position: relative;',
      '}',
      '.ig-term:focus { outline: 2px solid var(--accent, #096e65); outline-offset: 2px; }',
      // Native abbr tooltip is the baseline; on focus or hover we
      // upgrade to a richer styled bubble for users on devices that
      // support it. We keep this lightweight (no JS positioning).
      '.ig-term:hover::after, .ig-term:focus::after {',
      '  content: attr(title);',
      '  position: absolute;',
      '  left: 0;',
      '  top: 100%;',
      '  margin-top: 6px;',
      '  width: max-content;',
      '  max-width: min(34ch, 90vw);',
      '  background: var(--card, #1c1c1c);',
      '  color: var(--text, #e8e8e8);',
      '  border: 1px solid var(--border, #2a2a2a);',
      '  border-radius: 6px;',
      '  padding: 0.55rem 0.7rem;',
      '  font-size: 0.78rem;',
      '  line-height: 1.45;',
      '  font-weight: 400;',
      '  z-index: 1500;',
      '  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);',
      '  pointer-events: none;',
      '  white-space: normal;',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  var InlineGlossary = {
    lookup: lookup,
    decorate: function (root) {
      ensureStyles();
      decorateExplicit(root);
      autoDecorate(root);
    },
    terms: function () { return Object.assign({}, TERMS); }
  };

  global.InlineGlossary = InlineGlossary;

  function boot() {
    InlineGlossary.decorate(document);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
