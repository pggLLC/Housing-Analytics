/* F197 — Plain-English "For affordable housing developers" callouts
 * across the HNA page. User asked: every chart, indicator, or stat
 * should have an explanation in plain English of (a) why it matters
 * for developing an affordable housing project, (b) what it says
 * about the need for housing, and (c) how it supports successful
 * housing projects or not.
 *
 * Approach: a single JS file that runs on HNA load, reads section
 * IDs from each .chart-card h2[id], looks up an explanation from the
 * EXPLAIN map below, and injects a styled callout immediately after
 * each h2's existing intro <p>. Keeps the HTML clean and makes it
 * trivial to add more sections — just append an entry to EXPLAIN.
 *
 * Each entry has three lenses:
 *   why     — why a developer should care about this signal
 *   demand  — what it implies about the need for affordable housing
 *   project — how it shapes the deal (unit mix, AMI, scoring, etc.)
 *
 * Three-lens callout reads as one paragraph so the page isn't cluttered
 * with separate boxes. Section IDs are the h2's `id` attribute; if a
 * section doesn't have one we use a content-based fallback via the h2
 * text. Idempotent — if the callout already exists for a section, we
 * don't re-inject.
 */
(function () {
  'use strict';

  // Match HNA's h2 id="..." pattern OR h2 text content (case-insensitive
  // contains match) when an id isn't set on the original markup. Keys
  // are intentionally specific so we don't false-match.
  const EXPLAIN = {
    /* ── Executive snapshot ── */
    'snapshot': {
      why: 'The headline stats — population, median income, rent, home value, and cost burden — set the ceiling on what your project can charge and who it must serve.',
      demand: 'Low median income + high rent + high cost-burden share is the classic signal of unmet affordable-housing demand. Every 30+ point gap between median income and area median income (AMI) means deeper need.',
      project: 'Use these to size your AMI mix: if median household income is well below the county AMI, lean into 30-60% AMI units. If it\'s above, mixed-income (60-80%) is more competitive in QAP scoring.',
    },

    /* ── LIHTC, QCT & DDA ── */
    'LIHTC, QCT': {
      why: 'QCT (Qualified Census Tract) and DDA (Difficult Development Area) designations are the single biggest financial lever in a LIHTC deal — a 30% basis boost on a $20M project is ~$6M of additional eligible basis.',
      demand: 'High QCT count + DDA status indicates a community HUD recognizes as needing extra incentive to attract affordable housing. Existing LIHTC project count tells you market saturation — too many recent awards can hurt your CHFA scoring.',
      project: 'A site inside a QCT or DDA county qualifies for the basis boost automatically. Aim for sites in QCT + DDA where possible. If recency is 4+ years since the last LIHTC award, you score well on "geographic distribution" in the CHFA QAP.',
    },

    /* ── HUD FMR + Income Limits ── */
    'HUD Fair Market Rents': {
      why: 'FMR sets the maximum rent you can charge LIHTC tenants at each AMI band. HUD updates them yearly; they\'re the hard floor of your pro forma revenue.',
      demand: 'When FMR is significantly below market rents (look at the rent triangulation panel below), you have severe affordability stress — exactly the conditions LIHTC was designed for.',
      project: 'Pencil your rents at 50-60% AMI to verify the project is financeable. If 60% AMI rents are well below FMR, you have room to deepen affordability to 30-40% AMI and earn CHFA QAP "deeper income targeting" points.',
    },

    /* ── Rent triangulation ── */
    'Rent triangulation': {
      why: 'Three different rent measures — HUD FMR (regulated), ACS median (legacy tenants), Zillow ZORI (new leases) — surface lease-up premium and market drift.',
      demand: 'When ZORI (new-lease rent) runs 15%+ above ACS (legacy rent), long-tenured renters pay much less than newcomers. Once they turn over, displacement risk spikes — that\'s acute affordable-housing demand brewing.',
      project: 'Use ACS for cost-burden math, FMR for underwriting your LIHTC rents, ZORI for the "what will a market-rate comparable charge" line. The blended average reflects what a typical mixed-tenure resident actually pays.',
    },

    /* ── Housing stock / structure type ── */
    'Housing stock': {
      why: 'The structure mix (single-family / 2-4 unit / 5+ unit) reveals whether the market has multifamily infrastructure or is single-family-dominant. LIHTC deals are almost always 5+ units.',
      demand: 'A community with <10% multifamily has structural undersupply for renters. Adding 60-100 LIHTC units in that context dramatically shifts the renter housing market.',
      project: 'Single-family-dominant markets need extra zoning and entitlement effort. Look for areas where multifamily is already 15-25% — entitlement risk drops and existing infrastructure (water, sewer) is sized for it.',
    },

    /* ── Tenure ── */
    'Owner/renter': {
      why: 'Renter share is the audience for your project. Low renter share + high cost burden = renters trapped in unaffordable units with no alternatives.',
      demand: 'A jurisdiction with 30-40% renters and 50%+ rent burden has an acute renter affordability problem. That\'s a strong demand case for new affordable rentals.',
      project: 'Cities with 50%+ renter share have well-developed rental markets — your project plugs into an existing renter base. Towns with <25% renters are harder lease-ups; lean into senior + workforce niches.',
    },

    /* ── Home value distribution ── */
    'Home value': {
      why: 'Owner-occupied home values tell you the appreciation pressure pushing renters out of for-sale ownership and into permanent renting.',
      demand: 'When home values cluster $400K+ and median income is $70K, the math says ~95% of renters can\'t buy in. That\'s a structural locked-in renter pool — your audience.',
      project: 'High home values often mean QCT eligibility may not survive future ACS releases (rising-incomes risk). Use the snapshot to gauge how stable your basis-boost status will be over the 15-year compliance period.',
    },

    /* ── Homeownership affordability ── */
    'Homeownership affordability': {
      why: 'The "income needed to buy the median home" stat is the most concrete statement of who is being priced out of ownership today.',
      demand: 'When required income is 30%+ above actual median income, the affordability gap is severe — these households become permanent renters and need quality affordable rental supply.',
      project: 'Quantify the gap and use it in your CHFA narrative. "X% of local households can\'t buy the median home" is the kind of concrete need statement that scores in QAP "community need" sections.',
    },

    /* ── Rent burden ── */
    'Rent burden distribution': {
      why: 'Cost burden (30%+ of income on rent) and severe burden (50%+) are HUD\'s legal definitions of housing-unaffordability. They\'re also CHFA\'s primary scoring metric.',
      demand: 'A 40%+ rent-burdened share signals systemic affordable-housing failure. 50%+ severe burden means renters are choosing between rent and food / medical / transportation.',
      project: 'Target the deepest burden bands with your AMI mix. CHFA QAP awards more points for serving 30% AMI households precisely because that band carries the most severe burden.',
    },

    /* ── Cost burden by AMI tier (HUD CHAS) ── */
    'Cost burden by AMI tier': {
      why: 'HUD CHAS breaks cost burden by AMI band — letting you see exactly which income tier needs help most. This is the single highest-resolution view of demand.',
      demand: 'If 30% AMI burden is 85%+ and 50-80% is 30%, your most acute need is at deepest affordability. If burden is high across all tiers, you have broad workforce-housing demand too.',
      project: 'Map your unit mix to the burden distribution. A project serving exclusively 30% AMI tenants when 80% AMI is also heavily burdened leaves QAP points on the table. Mixed AMI projects (20% at 30% AMI + 30% at 50% + 50% at 60%) often score best.',
    },

    /* ── Commute / mode share ── */
    'Commuting: mode share': {
      why: 'Commute mode reveals transit access — the "transit-oriented development" (TOD) bonus in CHFA QAP requires verified frequent transit nearby.',
      demand: 'Heavy car-dominant commutes + low transit + high housing costs creates a "trapped commuter" pattern — workers driving 30+ min from cheaper outlying housing to job centers.',
      project: 'Sites with >5% transit share are likely TOD-eligible. Sites with <2% transit are car-dominant and need parking + drive-time analysis. Quantify the commute pattern in your CHFA narrative for "amenity proximity" scoring.',
    },

    /* ── LEHD commute flows ── */
    'inflow': {
      why: 'Commute flows distinguish job centers (more workers come in than out) from bedroom communities (more residents leave for work). The two need very different affordable housing strategies.',
      demand: 'A jurisdiction with strong inbound commute but high local rent burden has a workforce-housing crisis — the people working there can\'t afford to live there. That\'s a classic LIHTC + workforce-paired QAP narrative.',
      project: 'Bedroom communities benefit from family + senior 9% LIHTC. Job centers benefit from workforce-targeted 4% bond + state-paired credits at 60-80% AMI. Match your AMI mix to the labor-market character.',
    },

    /* ── Household composition / occupation / labor force ── */
    'Household composition, occupation': {
      why: 'The mix of married couples, single parents, living-alone, and occupation profile drives unit-mix decisions (1BR vs 2BR vs 3BR) and supportive-services design.',
      demand: 'High single-parent share means demand for 2-3BR units with childcare proximity. High living-alone share means 1BR / studio demand. High service-occupation share signals deep-AMI need (30-60% AMI band).',
      project: 'Use the household-type mix to set your bedroom mix in pro forma. Use the occupation mix to set the AMI band — service workers need 30-60% AMI; mid-tier office workers need 60-80% AMI.',
    },

    /* ── Race & ethnicity ── */
    'Race & ethnicity': {
      why: 'Demographic composition matters for AFFH (Affirmatively Furthering Fair Housing) compliance and CHFA QAP "geographic distribution" scoring.',
      demand: 'Jurisdictions with concentrated minority populations and high cost burden indicate historical disinvestment — exactly where new affordable housing has the deepest impact and CHFA prioritizes scoring.',
      project: 'Use the race/ethnicity profile in your CHFA narrative for AFFH context. A project that serves a demographically representative tenant pool scores better on "community integration" and avoids fair-housing risk.',
    },

    /* ── Educational attainment ── */
    'Educational attainment': {
      why: 'Education profile predicts long-term income trajectory and informs supportive-services design (workforce training partnerships, etc).',
      demand: 'Lower Bachelor\'s+ share with high cost burden indicates a workforce population permanently locked out of higher-wage jobs — they need durable affordable housing because their income won\'t catch up to rents.',
      project: 'Education stats support QAP scoring for "community need" + inform whether to partner with workforce training nonprofits (which boosts CHFA + DOH scoring). Higher-education jurisdictions may suit family or workforce housing.',
    },

    /* ── Age pyramid ── */
    'Age pyramid': {
      why: 'Population by age reveals which sub-population needs grow fastest — seniors, working-age, or family/youth. Each implies a different affordable-housing product.',
      demand: 'A bottom-heavy pyramid (young families) means schools, family units, and ground-floor accessibility don\'t apply. A top-heavy pyramid (aging-in-place) means senior + age-restricted housing is the dominant need.',
      project: 'Use the pyramid to choose target population in your CHFA application. CHFA awards specifically to seniors / families / supportive / supportive-services projects — pick the lane the data supports.',
    },

    /* ── Senior growth pressure ── */
    'Senior growth': {
      why: 'Senior population growth (75+, 65+) is the slowest-moving but most predictable demographic signal — if it\'s accelerating now, demand for senior housing will compound through your 15-year LIHTC compliance period.',
      demand: '20%+ senior-population growth over a decade with no senior-restricted LIHTC nearby is acute unmet demand. Senior renters are typically deeper-AMI (fixed-income Social Security) so they need the deepest affordability.',
      project: '62+ age-restricted projects score in their own CHFA category. Project demand from this chart is one of the strongest pieces of evidence in the "community need" section.',
    },

    /* ── 20-year outlook / population projection ── */
    '20-year outlook': {
      why: 'A 20-year projection tells you whether the unit need you\'re solving is permanent or a passing wave. LIHTC compliance is 15-30 years; you need your demand thesis to outlast that.',
      demand: 'If projected population growth implies 1,500+ new households over 10 years and current housing-gap is 600 units, the gap is growing — your project is part of a durable solution.',
      project: 'Use the projection in your CHFA narrative for "market durability." If projection shows DECLINING population, lean harder into senior + workforce niches that have specific local drivers.',
    },

    /* ── DOLA forecast sensitivity ── */
    'DOLA forecast': {
      why: 'DOLA publishes three scenarios (baseline / low / high). Range between low and high is your honesty test — wider bands mean more demand uncertainty.',
      demand: 'If even the low-growth scenario shows positive household formation > current housing inventory growth rate, demand is structurally there even in a downturn. That\'s a safe project.',
      project: 'Run your underwriting against the LOW-growth scenario for stress-testing. CHFA underwriters and DOH gap-funders look at this; a deal that pencils in DOLA low-growth is much more likely to fund.',
    },

    /* ── Housing need summary ── */
    'Housing need summary': {
      why: 'The composite housing need score and AMI-gap counts are CHFA QAP\'s primary scoring inputs. This is the single most-important section for your application.',
      demand: 'A "high" need rating + multi-thousand unit gap at 30-50% AMI is the textbook "community need" justification. Cite the AMI-gap counts directly in your CHFA narrative.',
      project: 'Use the gap counts to size your project (e.g. "we\'re proposing 80 units against a 1,200-unit 30% AMI gap, addressing 6.7% of the unmet need"). CHFA scoring rewards proposals that proportionally address the documented gap.',
    },

    /* ── Bedroom mix / household demand ── */
    'Bedroom': {
      why: 'Bedroom mix demand connects household structure (single-parent / family / senior) to unit-mix economics. Wrong mix = persistent vacancy + scoring penalty.',
      demand: 'High demand for 2BR + 3BR means family + single-parent households dominate; CHFA QAP awards more points for serving families. Heavy 1BR demand means senior + living-alone — different scoring lane.',
      project: 'Build your pro forma unit mix to match the demand distribution. A 60-unit project with 40 1BR / 15 2BR / 5 3BR scores poorly if local demand is 2BR-dominant. Recalibrate.',
    },

    /* ── Affordability composite ── */
    'Affordability Composite': {
      why: 'The composite affordability ratio (income vs rent + home value vs income) is a single-number gauge of how stressed the local affordability picture is.',
      demand: 'Composite scores in the worst quartile indicate communities where market-rate solutions can\'t close the gap — only subsidized affordable housing can.',
      project: 'Lean into your CHFA application by quoting the composite ranking. "Top 10% most-stressed in Colorado" is concrete language that scores in community-need sections.',
    },

    /* ── Special Needs ── */
    'Special Needs': {
      why: 'Senior + disability + single-parent shares signal demand for supportive-services-paired housing. These households need deeper affordability AND service partnerships.',
      demand: 'High 65+ share + high disability share means senior + supportive-housing demand is concentrated here. Plan deeper AMI bands (30-50%) since fixed-income seniors carry severe rent burden.',
      project: 'Partner with a local supportive-services provider (continuum of care, disability services nonprofit) for supportive housing scoring. CHFA + DOH-HHPG award strongly when supportive services are paired with the housing.',
    },
  };

  // Match an h2's identity to an EXPLAIN key. Tries (in order):
  //   1. exact id match
  //   2. id contains the key (case-insensitive)
  //   3. h2 text contains the key (case-insensitive)
  function _matchKey(h2) {
    const id = (h2.id || '').toLowerCase();
    const text = (h2.textContent || '').toLowerCase();
    for (const key of Object.keys(EXPLAIN)) {
      const kl = key.toLowerCase();
      if (id === kl) return key;
      if (id && id.includes(kl)) return key;
      if (text && text.includes(kl)) return key;
    }
    return null;
  }

  function _renderCallout(key) {
    const entry = EXPLAIN[key];
    return '<aside class="hna-dev-context" role="note" ' +
           'style="margin:.55rem 0 .8rem;padding:.65rem .85rem;' +
           'border-left:3px solid var(--accent);background:var(--bg2);' +
           'border-radius:0 6px 6px 0;font-size:.85rem;line-height:1.45">' +
             '<div style="font-size:.7rem;font-weight:700;letter-spacing:.06em;' +
                  'text-transform:uppercase;color:var(--accent);margin-bottom:.3rem">' +
               'For affordable-housing developers' +
             '</div>' +
             '<p style="margin:0 0 .4rem"><strong>Why it matters:</strong> ' + entry.why + '</p>' +
             '<p style="margin:0 0 .4rem"><strong>What it says about need:</strong> ' + entry.demand + '</p>' +
             '<p style="margin:0"><strong>How it shapes your project:</strong> ' + entry.project + '</p>' +
           '</aside>';
  }

  function _injectCallouts() {
    // Find all h2s in the HNA main content
    const h2s = document.querySelectorAll('main h2');
    let injected = 0;
    h2s.forEach(h2 => {
      // Skip if a callout already exists in the same chart card
      const card = h2.closest('.chart-card');
      if (!card) return;
      if (card.querySelector('.hna-dev-context')) return;

      const key = _matchKey(h2);
      if (!key) return;

      // Insert AFTER the existing intro <p> (so the description still
      // reads naturally before the developer lens). If no <p> exists,
      // insert right after the h2.
      const intro = card.querySelector('h2 + p');
      const html = _renderCallout(key);
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const node = wrap.firstChild;
      if (intro) intro.parentNode.insertBefore(node, intro.nextSibling);
      else h2.parentNode.insertBefore(node, h2.nextSibling);
      injected++;
    });
    return injected;
  }

  // Run on DOM ready. HNA renders progressively — many h2 sections are
  // already in the DOM at parse time. Run once on DOMContentLoaded for
  // most sections, then again after a short delay to catch dynamically-
  // injected sections (e.g. scenario projections).
  function _init() {
    _injectCallouts();
    setTimeout(_injectCallouts, 500);
    setTimeout(_injectCallouts, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Expose for debugging / extending
  window.HnaDevContext = { explain: EXPLAIN, render: _renderCallout, inject: _injectCallouts };
})();
