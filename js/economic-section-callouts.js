/**
 * economic-section-callouts.js
 *
 * F217 — "Why this matters" callouts for the Economic Dashboard.
 * Mirrors the F211 HNA developer-context + F216 HNA section takeaway
 * pattern: matches section headings by id/text, injects a styled
 * aside under the existing heading, idempotent.
 *
 * The dashboard is a wall of macro indicators (CPI, Fed funds rates,
 * mortgage rates, prediction-market odds, LIHTC trends). Without an
 * orienting "why does this matter for housing" line under each
 * section, the page reads as financial newswire rather than a
 * housing-development context tool.
 *
 * Each callout explains WHY the indicators in that section matter to
 * affordable housing — connecting macro signals to construction
 * lending costs, LIHTC equity pricing, rental demand pools, the
 * pipeline of CHFA deals. Audience: developers, lenders, policy
 * staff, residents, journalists, students. Voice neutral per F211.
 *
 * Exposes: window.EconomicSectionCallouts (debug/extend)
 */
(function () {
  'use strict';

  // ── Per-section callout content ─────────────────────────────────
  // Keys are matched against the h2/h3 text (case-insensitive contains).
  // Each entry: a 2-3 sentence "why this matters" paragraph + a short
  // "what to watch" follow-up.
  var CALLOUTS = {
    // ── Census snapshot ──
    'Census snapshot': {
      why: 'This section anchors the macro indicators below to the households they are tested against: population, households, income and housing stock for the geography you pick. Every rate, cost or prediction-market move further down matters only insofar as it changes what these households can afford.',
      watch: 'Compare median household income here with the rent and mortgage figures further down the page.',
    },

    // ── Colorado Real Estate & Affordability Impact ──
    'Colorado Real Estate': {
      why: 'These two readings translate national odds into the pressures a Colorado deal feels. Higher inflation raises construction costs, which makes deeper-affordability units harder to fund within a LIHTC (Low-Income Housing Tax Credit) budget. A recession slows deal flow and raises tenant payment risk on stabilized properties.',
      watch: 'Both figures are national Polymarket odds, not Colorado forecasts.',
    },

    // ── Federal Reserve & Interest Rates ──
    'Federal Reserve': {
      why: 'Fed policy sets the cost of construction lending and variable-rate debt, and it moves the Treasury yields that permanent loans are priced from. LIHTC equity pricing (what investors pay per dollar of tax credit) has fallen alongside higher rates since 2021, but over that period the two mostly moved on a shared trend rather than one driving the other.',
      watch: 'The odds for the next Fed meeting change quickly after each inflation and jobs report.',
    },

    // ── Recession Risk & Economic Growth ──
    'Recession Risk': {
      why: 'A recession usually curtails new construction starts, slows LIHTC deal flow, and raises tenant payment risk on stabilized properties. GDP growth supports in-migration to Colorado, which sustains housing demand. Inflation feeds construction costs and erodes the margins that projects underwrote at closing.',
      watch: 'Recession odds here are national. Pair them with the labor-market charts above.',
    },

    // ── Employment & Labor Market ──
    'Employment': {
      why: 'Job losses soften housing demand and make rent collection harder for lower-income households. Labor-market odds are a forward read on the unemployment and payroll charts above.',
      watch: 'Compare these odds with the latest unemployment rate in the Labor Market section.',
    },

    // ── Multifamily rent benchmarks (Yardi) ──
    'Multifamily rent benchmarks': {
      why: 'Multifamily asking-rent trends are a direct read on the rental market that LIHTC and workforce housing compete with. When market-rate asking rent runs well above HUD FMR (Fair Market Rent, the HUD-published rent that Housing Choice Voucher payments are tied to), LIHTC projects hold a deeper rent advantage. When asking rent falls toward FMR, that advantage shrinks and lease-up risk rises.',
      watch: 'The gap between asking rent and FMR is the underwriting cushion.',
    },

    // ── Market-priced macro expectations (Kalshi) ──
    'Market-priced macro expectations': {
      why: 'Kalshi is a US exchange for event contracts regulated by the CFTC (Commodity Futures Trading Commission). Many of its contracts settle on the same government releases this page charts from FRED, such as monthly housing starts, so the prices show what traders expect the next figure to be before it is published.',
      watch: 'A contract with little trading can show a stale price. Check the market on Kalshi before relying on any one line.',
    },

    // ── Polymarket umbrella section (the parent <details> card) ──
    'Prediction Markets': {
      why: 'Prediction markets price the odds of future events with real money. For housing finance that gives a forward-looking read on the macro variables that move deal economics: Fed decisions (construction and permanent debt costs), recession (deal flow and tenant payment risk), inflation (construction cost) and unemployment (rental demand). The FRED charts above show what has already happened; these odds show what traders expect next.',
      watch: 'Read the recession odds next to the Fed decision odds in the same section.',
    },

    // ── FRED indicator groups (collapsible <details>/<summary> cards) ──
    'Construction Costs': {
      why: 'Producer price indexes for construction inputs (steel, lumber, concrete and labor) flow directly into per-unit budgets. Construction wages (CES2000000008) and the Employment Cost Index set the labor cost trajectory that budgets and operating pro forma assumptions ride on.',
      watch: 'Compare the year-over-year change in construction inputs with the cost escalation in your budget.',
    },
    'Housing Market': {
      why: 'Permits, starts and completions describe the supply pipeline that LIHTC competes with. Median home price, homeownership rate and rental vacancy describe the demand environment. Together they set a project\'s rent advantage over the market and frame lease-up risk for new construction.',
      watch: 'Multifamily permits (PERMIT5) and starts (HOUST5F) show how much new rental supply is coming.',
    },
    'Housing Cycle Indicators': {
      why: 'New home sales, residential construction spending and construction employment tend to turn at different points in the housing cycle. Reading them together, alongside permits, starts and months\' supply, helps place a deal in the cycle.',
    },
    'Financial & Interest Rates': {
      why: 'DGS10 (the FRED ticker for the 10-year Treasury yield) is the base that most permanent loans are priced from. The yield curve (T10Y2Y, the 10-year minus 2-year Treasury spread) is a widely watched recession signal. SOFR (Secured Overnight Financing Rate, the benchmark that replaced LIBOR) drives variable-rate construction loan costs. Moody\'s Baa spread (BAA10Y) shows lender risk appetite: wider spreads mean a harder lending environment for higher-risk deals.',
    },
    'Labor Market': {
      why: 'Unemployment and payrolls describe demand strength for the rental units a LIHTC project will lease up. Average hourly earnings and the Employment Cost Index describe wage trajectory. CPI Shelter is the closest measure of the rent-inflation environment a stabilized project operates in.',
      watch: 'When wages grow faster than AMI (Area Median Income), rents set at a fixed AMI share become more affordable to tenants over time.',
    },
  };

  // ── Match h2/h3 to a callout key ────────────────────────────────
  // Prefer longest matching key so "Real Estate & Home Values" doesn't
  // collide with "Real Estate" or "Home Values" if added later.
  function _matchKey(heading) {
    var id = (heading.id || '').toLowerCase();
    var text = (heading.textContent || '').toLowerCase();
    var best = null;
    for (var key in CALLOUTS) {
      if (!Object.prototype.hasOwnProperty.call(CALLOUTS, key)) continue;
      var k = key.toLowerCase();
      var hit = false;
      if (id === k || (id && id.indexOf(k) !== -1)) hit = true;
      else if (text && text.indexOf(k) !== -1) hit = true;
      if (hit && (!best || k.length > best.length)) {
        best = { key: key, length: k.length };
      }
    }
    return best ? best.key : null;
  }

  // ── Inject the callouts ────────────────────────────────────────
  function _injectAll() {
    // Match h2 + h3 for the main policy sections, AND <summary> for the
    // collapsible FRED-indicator <details> cards (Construction Costs,
    // Housing Market, Housing Cycle, Financial & Interest Rates, Labor
    // Market). Summary nodes don't have an h2/h3 child but do carry the
    // section name as plain text.
    var nodes = document.querySelectorAll(
      'main h2, main h3.hp-section-heading, main h2.hp-section-heading, ' +
      'main details > summary'
    );
    var injected = 0;
    for (var i = 0; i < nodes.length; i++) {
      var heading = nodes[i];
      var key = _matchKey(heading);
      if (!key) continue;
      var entry = CALLOUTS[key];
      if (!entry) continue;
      // For <summary>, mount the callout inside the .section-body so it
      // collapses with the rest of the section. For h2/h3, mount as the
      // immediate next sibling.
      var mountSibling = null;
      var mountParent = null;
      var existingSelector = '.econ-section-callout';
      if (heading.tagName.toLowerCase() === 'summary') {
        var body = heading.parentNode.querySelector('.section-body');
        if (!body) continue;
        if (body.querySelector(existingSelector)) continue;
        mountParent = body;
        // Inject as the FIRST child of .section-body so it lands above
        // the existing "section-desc" paragraph + the metric grid.
        mountSibling = body.firstChild;
      } else {
        var next = heading.nextElementSibling;
        if (next && next.classList && next.classList.contains('econ-section-callout')) continue;
        mountParent = heading.parentNode;
        mountSibling = heading.nextSibling;
      }
      var aside = document.createElement('aside');
      aside.className = 'econ-section-callout';
      aside.setAttribute('role', 'note');
      aside.style.cssText =
        'margin:.4rem 0 1rem;padding:.65rem .9rem;border-left:3px solid var(--accent,#096e65);' +
        'background:color-mix(in oklab,var(--accent,#096e65) 5%,var(--card,#ffffff) 95%);' +
        'border-radius:0 6px 6px 0;font-size:.9rem;line-height:1.55;color:var(--text,#1a1a2e)';
      aside.innerHTML =
        '<div style="font-size:.8125rem;color:var(--muted,#5a6a7a);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:.3rem">Why this matters for housing</div>' +
        '<p style="margin:0 0 .4rem">' + entry.why + '</p>' +
        (entry.watch
          ? '<p style="margin:0;font-size:.84rem;color:var(--muted,#5a6a7a)"><strong style="color:var(--accent,#096e65)">What to watch:</strong> ' + entry.watch + '</p>'
          : '');
      mountParent.insertBefore(aside, mountSibling);
      injected++;
    }
    return injected;
  }

  // Run on DOM ready + a 1500ms tick to cover any progressively-loaded
  // section headings (the dashboard renders the FRED + Yardi sections
  // after async data arrives).
  function _init() {
    _injectAll();
    setTimeout(_injectAll, 1500);
    setTimeout(_injectAll, 4000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  window.EconomicSectionCallouts = { inject: _injectAll, callouts: CALLOUTS };
})();
