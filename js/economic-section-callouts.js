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
      why: 'This section anchors the macro indicators below to the real-world denominator they\'re tested against: Colorado\'s population, households, income distribution, and housing stock. Every Polymarket odd, prediction-market bid, and Fed-rate scenario above is meaningful only insofar as it changes what these households can actually afford.',
      watch: 'Compare CO median income against the implied mortgage payment in the Polymarket cards — when payment-to-income climbs above 30%, the typical Colorado household has crossed from "affordability stressed" into "affordability locked."',
    },

    // ── Colorado Real Estate & Affordability Impact ──
    'Colorado Real Estate': {
      why: 'This section converts national signals (Fed rates, home values, inflation) into Colorado affordability math. The median CO home × current mortgage rate × CO household income determines whether the market is reachable for first-time buyers — or whether subsidized housing is the only path. Construction cost pressure feeds directly into LIHTC deal feasibility: when materials inflation runs above 4%, projects pencil at higher AMI bands and fewer deep-affordability units get built.',
      watch: 'When payment-to-income passes 30%, market-rate ownership is out of reach for the median Colorado household; LIHTC + workforce housing become the only paths to expand supply.',
    },

    // ── Federal Reserve & Interest Rates ──
    'Federal Reserve': {
      why: 'Fed policy sets the cost of construction lending, the cost of permanent debt on stabilized projects, and — through Treasury spreads — the yield that determines LIHTC equity pricing. A 25bp Fed cut typically widens LIHTC pricing by 2–4 cents per dollar of credit; a 25bp hike does the inverse. The prediction markets above give a live read on equity pricing months before it shows up in CHFA tax-credit awards.',
      watch: 'When the implied rate-cut count for 2026 rises by one full cut, LIHTC syndicators reprice their bids upward within weeks — that\'s the leading signal for stronger deal economics in the next CHFA round.',
    },

    // ── Real Estate & Home Values ──
    'Real Estate & Home Values': {
      why: 'Home values frame both ownership affordability AND the rent ceiling for naturally-occurring affordable housing (NOAH). Denver typically trades ~35% above the national median, so the US benchmark plus the Polymarket median-value odds give an early directional read on Colorado. When home values rise faster than incomes, the rental pool grows — pushing demand into the LIHTC + workforce housing pipeline.',
      watch: 'Watch for LA + Chicago divergence: LA leads Denver by 6–12 months on coastal high-cost cycles; Chicago is closer to Colorado Springs / Pueblo pricing dynamics.',
    },

    // ── Recession Risk & Economic Growth ──
    'Recession Risk': {
      why: 'A recession sharply curtails new construction starts, slows LIHTC deal flow, and elevates tenant payment risk on stabilized properties. GDP growth supports in-migration to Colorado (especially the Front Range), which sustains housing demand. Inflation feeds construction costs and erodes the LIHTC rent affordability margins that projects underwrote at closing.',
      watch: 'A recession probability above 40% on prediction markets historically aligns with CHFA seeing 2–3 deals pulled per round; above 60% the pipeline goes quiet for 1–2 quarters.',
    },

    // ── Employment & Labor Market ──
    'Employment': {
      why: 'Unemployment is the leading indicator of housing-demand softness. Colorado\'s job market tracks ~0.4pp below the national rate, and the service-sector economy is more rate-sensitive than the national average. Sustained unemployment above 5% historically triggers rent collection problems for low-AMI units and forecloses the workforce-housing demand pool LIHTC was designed to serve.',
      watch: 'A 0.5pp rise in CO unemployment over 3 months is the threshold most CHFA underwriters use to start trimming achievable rents in pro forma.',
    },

    // ── Multifamily rent benchmarks (Yardi) ──
    'Multifamily rent benchmarks': {
      why: 'Multifamily asking-rent trends are a direct read on the addressable rental pool that LIHTC + workforce housing compete with. When market-rate asking rent runs well above HUD FMR, market-rate landlords have pricing power — and LIHTC projects gain a deeper rent advantage. When asking rent compresses toward FMR, the LIHTC rent advantage shrinks and lease-up risk rises.',
      watch: 'The asking-rent vs FMR gap is the underwriting cushion. When it shrinks below 15%, expect CHFA to ask harder questions about 4% bond deal lease-up assumptions.',
    },

    // ── Market-priced macro expectations (Kalshi) ──
    // The Kalshi-specific complement to the Polymarket umbrella below.
    // Kalshi is CFTC-regulated and focused on finer-grained macro
    // outcomes — CPI ranges, Fed decisions, NFP — which gives a
    // different lens than Polymarket's binary "by year-end" framing.
    'Market-priced macro expectations': {
      why: 'Kalshi is a CFTC-regulated US exchange for event contracts — the only US venue where retail traders can legally trade event outcomes. Its contracts skew toward fine-grained macro events: specific CPI ranges (e.g. "Sep CPI YoY 3.0-3.2%"), FOMC decisions by meeting, and labor-market prints. For housing-finance, that granularity is what makes it a useful read on LIHTC equity pricing pressure: equity pricing keys off Treasury yields, Treasury yields key off inflation expectations, and Kalshi prices inflation expectations at the resolution that actually moves syndicator bids. Many underwriters cite Kalshi over Polymarket for CPI/Fed signals specifically because of the regulatory legitimacy.',
      watch: 'Compare Kalshi rate-cut odds to the Fed\'s own SEP "dot plot" — when Kalshi diverges from Fed guidance by more than one full cut, equity syndicators historically side with the market. On the CPI side, watch the spread between the "near-target" (2.0-2.5%) and "stuck above 3%" buckets — when the latter rises above 35%, expect LIHTC bond pricing assumptions to tighten across the board.',
    },

    // ── Polymarket umbrella section (the parent <details> card) ──
    // The four sub-sections below it (Colorado Impact, Fed, Real Estate,
    // Recession, Employment) each have their own callouts — this one
    // explains why prediction markets matter as a CATEGORY of signal
    // worth watching at all.
    'Prediction Markets': {
      why: 'Prediction markets price the probability of future events with real money. For housing-finance, that gives a continuously-updated, forward-looking read on the macro variables that move LIHTC deal economics: Fed rate cuts (equity pricing), recession (deal flow + tenant payment risk), inflation (construction cost), home values (NOAH rent ceilings + ownership affordability), and unemployment (rental demand). Unlike economist surveys that publish quarterly, prediction-market odds adjust within minutes of new data — so they\'re the leading indicator that often moves before the FRED series above.',
      watch: 'When recession probability climbs above 40% on Polymarket, CHFA typically sees 2-3 deals pulled per round; above 60% the pipeline goes quiet for 1-2 quarters. Track the recession + rate-cut odds together: rising recession odds AND rising rate-cut odds is the classic late-cycle setup before the Fed pivots.',
    },

    // ── FRED indicator groups (collapsible <details>/<summary> cards) ──
    'Construction Costs': {
      why: 'Producer price indices for construction inputs (steel, lumber, concrete, ready-mix, labor) flow directly into per-unit budgets. A 10% rise in WPUFD49207 (construction inputs) compresses LIHTC eligible basis on a 60-unit deal by roughly $700K. Construction wages (CES2000000008) and the Employment Cost Index set the labor cost trajectory that operating-pro-forma assumptions ride on for 15 years.',
      watch: 'When construction-input PPI runs above 6% year-over-year, expect CHFA to revisit cost-cap assumptions and per-unit basis limits in the next QAP cycle.',
    },
    'Housing Market': {
      why: 'Permits + starts + completions describe the supply pipeline that LIHTC competes with. Median home price + homeownership rate + rental vacancy describe the demand environment. Together these set the LIHTC project\'s rent advantage vs market and frame lease-up risk for new construction.',
      watch: 'A multifamily permits + starts decline of 15% or more (PERMIT5 vs HOUST5F) is the leading indicator that 4% bond deals will see tighter underwriting cushions in the next 6-12 months.',
    },
    'Housing Cycle Indicators': {
      why: 'New home sales lead total starts by 3-6 months; residential construction spending follows permits/starts by 6-12 months; construction employment is the lagging confirmation. Reading these in sequence — alongside permits, starts, and Months\' Supply — tells you whether you\'re entering a deal at the top, bottom, or middle of the cycle.',
      watch: 'New home sales declining while construction employment is still rising = late-cycle setup; that\'s usually 6-9 months before stabilized rent assumptions need a haircut.',
    },
    'Financial & Interest Rates': {
      why: 'DGS10 (10-yr Treasury) sets the floor for permanent debt + LIHTC equity pricing. The yield curve (T10Y2Y) signals recession risk; an inverted curve historically precedes Fed cuts by 6-18 months. SOFR drives variable-rate construction loan costs. Moody\'s Baa spread (BAA10Y) shows lender risk appetite — wider spreads = harder lending environment for higher-risk affordable deals.',
      watch: 'When the 10-yr Treasury moves 50bp in either direction within a month, LIHTC equity pricing typically reprices by 4-8 cents per dollar over the next two reporting cycles.',
    },
    'Labor Market': {
      why: 'Unemployment + payrolls describe demand strength for the rental units a LIHTC project will lease up. Average hourly earnings + ECI describe wage trajectory — when wages outpace AMI growth, projects underwritten at 60% AMI rents become deeper-affordability over time. CPI Shelter is the closest measure of the rent-inflation environment a stabilized project operates in.',
      watch: 'Sustained wage growth above 4%/yr while AMI rises only 2-3%/yr is the classic setup for LIHTC projects ending up more affordable than underwritten — good for tenants, but rent-up risk rises if local market rents soften.',
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
        '<div style="font-size:.66rem;color:var(--muted,#5a6a7a);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:.3rem">Why this matters for housing</div>' +
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
