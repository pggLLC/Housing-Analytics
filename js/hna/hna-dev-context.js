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

    /* ── F198 — Second-batch callouts for the remaining ~30 sections ── */

    /* ── Household Income Distribution (ACS DP03 brackets) ── */
    'Household Income': {
      why: 'The income distribution shows you exactly how many households fall in each AMI band — your direct demand pool for each unit at each rent point.',
      demand: 'A jurisdiction with 25%+ of households below 30% AMI but no deep-affordability LIHTC has acute unmet need at the lowest income tier. That\'s where supportive + 30% AMI projects fill the deepest gap.',
      project: 'Build your AMI mix as a mirror of this distribution. If 40% of HHs are <50% AMI, having 40% of your project at 30-50% AMI sizes your audience correctly and earns "deeper income targeting" points in CHFA QAP.',
    },

    /* ── How Affordable Has Housing Become Over Last 15 Years ── */
    'How Affordable Has Housing': {
      why: '15-year affordability trends prove whether housing stress is a passing wave or a structural shift. CHFA QAP "documented community need" sections weight long-trend evidence heavily.',
      demand: 'When rent rises 60%+ and income rises 25% over the same period, you have permanent affordability erosion — exactly the conditions that LIHTC was designed to fix and CHFA prioritizes.',
      project: 'Cite the 15-year rent-to-income ratio shift directly in your application narrative. "Median rent rose 62% while median income rose 21%" is the kind of concrete historical evidence that CHFA underwriters look for.',
    },

    /* ── Pace & Scale of New Housing Permits ── */
    'Pace & Scale of New Housing Permits': {
      why: 'Permit-to-need ratios show whether the market is keeping up with the local affordability gap or falling behind. CHFA + DOH evaluators look at this when assessing whether your project is filling a real shortage.',
      demand: 'When annual permits are below the annual unit-need-growth rate, the shortage compounds yearly. A 5-year permit pace at 50% of need-growth means you\'re adding to a deepening hole — strong affirmative-action case.',
      project: 'Document the gap in your CHFA "Community Need" section. "Local permitting averages X units/year against an Y unit/year need, so this project addresses Z% of the recurring annual shortfall" is concrete narrative scoring language.',
    },

    /* ── Age of Housing Stock ── */
    'Age of Housing Stock': {
      why: 'Old housing stock (pre-1960) signals lead paint, asbestos, and accessibility-retrofit costs. It also signals an aging building stock that has fewer "newly built" amenities and creates demand for modern affordable units.',
      demand: 'Heavy pre-1960 share + low new-construction permitting = renters stuck in deteriorating units paying high rents. New high-quality affordable construction commands strong lease-up demand.',
      project: 'A newly-built LIHTC project provides quality, modern accessible units that older stock can\'t match. Score on "physical condition improvement" + "ADA accessibility" + "energy efficiency" by contrasting your new construction with the existing dated stock.',
    },

    /* ── Bedroom Mix ── */
    'Bedroom Mix': {
      why: 'The bedroom inventory (% 1BR / 2BR / 3BR / 4+BR) reveals whether the local market serves families or singles — and where the supply gap is.',
      demand: 'Severe undersupply of 3BR+ in a jurisdiction with high single-parent + family-with-kids share means families are crowded into too-small units (overcrowding). That\'s acute family-housing demand.',
      project: 'Set your project bedroom mix to fill the local supply gap, not duplicate it. A 60-unit family project with 25 1BR / 20 2BR / 15 3BR addresses overcrowding and earns "family housing" + "right-sizing" QAP points.',
    },

    /* ── Owner Housing Cost Burden ── */
    'Owner Housing Cost Burden': {
      why: 'Owner cost burden (mortgage + tax + insurance + utilities > 30% of income) reveals "house-poor" homeowners who can\'t spend on maintenance or family needs. It also signals owners at risk of foreclosure-to-rental transition.',
      demand: 'High owner burden + low renter availability creates a brittle housing market. When owner-burdened HHs lose their home they go to the rental market, increasing rental demand further.',
      project: 'Document both renter AND owner burden in your CHFA narrative. "Total cost-burdened HHs is X" (renter + owner combined) is a stronger demand statement than renter-only stats, especially for workforce-targeted projects.',
    },

    /* ── Housing Gap & Affordability Analysis ── */
    'Housing Gap': {
      why: 'The AMI-band housing gap is the most direct unit-count statement of unmet need. It tells you "how many more units at this AMI does this community need?" — your project sizes against this number.',
      demand: 'A 30% AMI gap of 1,200+ units in a town of 10,000 households is structural failure of the market. Your 60-unit project addresses 5% of the gap — solid but incremental. A 200-unit project would address 17% — transformative.',
      project: 'Quote the exact gap by AMI tier in your CHFA application. "Project provides X units at Y% AMI against a documented Z unit gap at that tier" is direct math the CHFA scorers look for in "Community Need" sections.',
    },

    /* ── Scenario-based demographic projections ── */
    'Scenario-based demographic projections': {
      why: 'Three-scenario projections (baseline / low / high) test your project under different futures. Underwriters care about the LOW-growth case because that\'s the stress condition.',
      demand: 'If even the low-growth scenario shows positive household formation above current permitting pace, demand is structural even in a downturn — your project is durable.',
      project: 'Pencil your underwriting against the LOW scenario for safety. If it pencils there, you have a deal that survives a recession. Then run baseline + high to size your upside. CHFA + DOH gap funders look for this discipline.',
    },

    /* ── Labor Market Context / Wage Distribution / Top Industries ── */
    'Labor Market Context': {
      why: 'Wage distribution + dominant industries tell you what AMI band your future tenants actually earn. Many resort-area service workers can\'t afford 60% AMI but qualify for 30-50%.',
      demand: 'Heavy service-occupation employment + low median wage = deep affordability need at the 30-50% AMI band. Office-dominant markets need 60-80% AMI workforce housing.',
      project: 'Match your AMI mix to the actual wage distribution. Resort towns need 30-50% AMI. Tech-dominant suburbs need 60-80% AMI. Mixed-economy cities benefit from broad AMI mix (30%/50%/60%/80%) to capture the full workforce.',
    },

    'Wage Distribution': {
      why: 'The wage distribution by percentile tells you exactly which workers can afford which rents. Cross-referenced against FMR, it surfaces who is priced out.',
      demand: 'When the 50th percentile wage can\'t afford the 50th percentile rent at the 30% rule, half the workforce is rent-burdened. That\'s a workforce housing crisis.',
      project: 'Use the wage distribution to size your AMI mix. If 35% of workers earn < $30K, target 30-50% AMI units. If 40% earn $40-60K, target 60-80% AMI units. Avoid "middle-class trap" where your project serves only the deepest band and misses the broader workforce.',
    },

    'Top Industries': {
      why: 'Dominant industries reveal job stability + wage trajectory. Healthcare + government = stable + growing. Mining + manufacturing = volatile. Hospitality = low-wage + seasonal.',
      demand: 'Hospitality-dominant areas have high turnover + low wages = acute workforce-housing demand. Healthcare-dominant areas have stable mid-tier workers needing 60-80% AMI workforce units.',
      project: 'Tailor your supportive services to the dominant industry. Partner with the local hospital for healthcare-worker preference; with the resort association for hospitality preference. CHFA + Prop 123 scoring rewards employer partnerships.',
    },

    'Wages vs Housing Affordability': {
      why: 'The wage-to-rent ratio is the single most accessible test of "can workers afford to live here?" It\'s the math everyone — politicians, voters, employers — understands intuitively.',
      demand: 'A 40+ hour/week minimum wage worker spending 60%+ on rent is exactly who LIHTC was designed to serve. That ratio in your data is your most concrete demand evidence.',
      project: 'Quote the ratio in plain English in your CHFA narrative: "A full-time worker earning X must spend Y% of pre-tax income on the median 2BR rent." This is the language that scores in "Community Need" + "Local Support" sections (because it persuades local elected officials).',
    },

    /* ── Economic indicators / employment trend / wage trend / industry analysis ── */
    'Economic Indicators': {
      why: 'Macroeconomic context (unemployment, labor-force participation, prime-age employment) tells you whether the local economy is expanding or contracting — which shapes 15-year lease-up risk.',
      demand: 'Tight labor market + rising wages + low unemployment = strong rental demand at all AMI bands. Loosening labor market = workforce-housing demand stays high as workers downsize from market-rate to subsidized units.',
      project: 'Reference economic-cycle context in your underwriting narrative. A counter-cyclical play (start construction when peers slow down) reduces hard-cost stress and positions lease-up for the next upswing.',
    },

    'Employment Trend': {
      why: 'Employment trajectory is the leading indicator of housing demand — jobs come first, residents follow, then rents move. A 5-yr employment trend forecasts the next 2-3 years of housing market direction.',
      demand: 'Positive employment trend (+2%/yr) + flat housing supply = rapidly tightening rental market. Your project absorbs net new workers into affordable units before the market re-equilibrates upward.',
      project: 'Use the employment trend in your CHFA narrative for "market growth" + "lease-up confidence." Positive trends support 9% LIHTC family / workforce; negative trends suit senior / preservation niches.',
    },

    'Wage Trend': {
      why: 'Wage growth (or stagnation) tells you whether AMI thresholds will rise (lifting unit rents) or stagnate (locking your project at its initial pricing). Critical for 15-year compliance economics.',
      demand: 'Wage trend BELOW rent growth = expanding affordability gap = permanent and growing demand. Wage trend ABOVE rent growth = closing gap, project may become less competitive over time.',
      project: 'Stress-test your pro forma against the worst 5-yr wage trend in this dataset. If your unit rents stay viable when wages flat-line for 5 years, your project survives a recession.',
    },

    'Industry Analysis': {
      why: 'Industry concentration shows economic resilience — diverse economies recover from shocks; single-industry towns don\'t. 15-year LIHTC compliance favors diverse economies.',
      demand: 'Single-industry towns (mining, military, university) have wildly variable affordable-housing demand depending on local employer fortunes. Diverse economies have stable, predictable demand.',
      project: 'Diverse economies suit 9% family / workforce projects with multi-AMI mixes. Single-industry towns suit targeted niches (senior, supportive, or employer-aligned workforce). Match your project type to economic structure.',
    },

    'Wage Gaps': {
      why: 'Wage inequality reveals "service worker / professional" splits that are invisible in median stats. It shows the depth of workforce-housing crisis.',
      demand: 'Large wage gaps at the local level mean dual demand: deep-affordability for service workers (30-50% AMI) AND workforce middle for healthcare / education (60-80% AMI). Both are needed.',
      project: 'Mixed-AMI projects (e.g. 25% at 30% AMI + 35% at 50% AMI + 40% at 60% AMI) directly address documented wage gaps. CHFA QAP rewards proposals that mirror local economic complexity.',
    },

    /* ── Affordable Housing Compliance (HB 22-1093 / Prop 123) ── */
    'HB 22-1093': {
      why: 'HB 22-1093 + Prop 123 are Colorado\'s state-level housing-action requirements. Compliance status determines eligibility for Prop 123 fast-track funding and state-level credit allocations.',
      demand: 'A jurisdiction without an adopted Housing Action Plan or local commitment is leaving Prop 123 dollars on the table — even if their underlying housing need is severe.',
      project: 'Check this status BEFORE applying. Jurisdictions with adopted plans + commitments are pre-qualified for Prop 123 fast-track + Local Investment funds. Those without may need 6-12 months of catch-up work before you can layer state credit.',
    },

    /* ── PMA Delineation & CHFA Requirements ── */
    'PMA Delineation': {
      why: 'The Primary Market Area (PMA) is the defined catchment for your project\'s tenant base. CHFA underwriters require a documented PMA before they\'ll consider your application.',
      demand: 'A wide PMA (15+ mi) means you\'re relying on a broad regional tenant base — risky for lease-up. A tight PMA (5 mi) means strong local demand justifies your unit count.',
      project: 'Document your PMA on the map. For rural areas use a county or multi-county PMA; for urban use a sub-city PMA. The smaller and more defensible the PMA, the stronger your "market sizing" argument with CHFA.',
    },

    /* ── Projected Housing Need ── */
    'Projected Housing Need': {
      why: 'A forward-looking housing-need projection (3-5 yr) is the demand thesis underneath your stabilized lease-up assumption. CHFA underwriters and lenders look for this.',
      demand: 'When projected need exceeds the local pipeline (permits + announced affordable) by 200+ units, you have durable lease-up demand for years. When projection is flat or declining, your project is the LAST one this market needs — proceed cautiously.',
      project: 'Quote the projected unit need in your CHFA narrative. A project for 80 units in a market projected to need 600 more affordable units in 5 years is on the right side of the supply-demand curve.',
    },

    /* ── Renter need by bedroom count (B25009 → bins) ── */
    'Renter need by bedroom': {
      why: 'Renter household-size distribution reveals what bedroom mix actually serves the local renters — distinct from owner-side or area-wide household stats.',
      demand: 'When 35% of renter HHs are 3+ persons but only 15% of the rental supply is 3BR, families are crowded into 2BRs. That\'s the most visible form of housing inadequacy — overcrowding.',
      project: 'Use renter-side bedroom distribution to set your unit mix. Mismatch with the broader population distribution (which includes owners) is common; trust the renter-specific signal.',
    },

    /* ── What types of housing does the data support? ── */
    'What types of housing': {
      why: 'This composite ranks 6 housing-type lanes (deep-affordability rental / workforce rental / family / senior / missing-middle ownership / detached SF ownership) by local need signals — a top-line view of where to focus.',
      demand: 'A top-ranked lane is where your project will face the LEAST competition and the MOST demand. Pursuing a low-ranked lane in this geography means you\'re fighting the data.',
      project: 'Match your project type to the top-ranked lane in this dataset. If "deep-affordability rental" is top, do a 30-50% AMI deep-targeting project. If "missing-middle ownership" is top, consider a townhome/condo for-sale path instead.',
    },

    /* ── Neighborhood & Architectural Context ── */
    'Neighborhood & Architectural': {
      why: 'Neighborhood + architectural fit affects entitlement timelines, public support, and tenant lease-up. A project that "fits" gets through entitlement faster.',
      demand: 'Markets with strong design preferences (historic districts, character zones) need architectural sensitivity. Markets without these constraints allow faster, cheaper construction.',
      project: 'Use this context in your design phase. Historic-character markets benefit from infill / adaptive-reuse strategies (which also unlock historic tax credits). Open-plan suburban markets allow type-V garden-style at lower cost-per-unit.',
    },

    /* ── Housing Type Feasibility Analysis ── */
    'Housing Type Feasibility': {
      why: 'A type-by-type feasibility check (per-unit cost vs achievable rent vs zoning vs basis-boost) tells you what physical product is financeable here.',
      demand: 'A high-cost-area + strict zoning + low FMR = only deeply-subsidized 4% bond + state-paired projects pencil. A moderate-cost suburb + flexible zoning + reasonable FMR opens 9% LIHTC family product.',
      project: 'Use this analysis to set the project TYPE before you commit to a financing path. 9% LIHTC works in moderate markets. 4% bond + state needs harder-cost markets with full basis boost. Don\'t force the wrong product into the wrong market.',
    },

    /* ── Colorado Market Conditions ── */
    'Colorado Market Conditions': {
      why: 'State-level context (statewide construction cost trends, capital market conditions, equity pricing) sets the macro frame for your local project.',
      demand: 'When statewide cost trends compound 5-7%/yr while local rents rise 2-3%/yr, the gap widens — only deeply-subsidized projects pencil. Time your application cycles accordingly.',
      project: 'Read the macro signals before you commit to a closing date. High-cost / soft-equity-pricing periods favor 4% bond + state + soft-funded deals. Low-cost / strong-equity periods favor 9% competitive projects.',
    },

    /* ── Housing Action Plan Checklist ── */
    'Housing Action Plan': {
      why: 'A locally-adopted Housing Action Plan is now table stakes for state-level competitive credit. CHFA + DOH explicitly reward jurisdictions with adopted plans.',
      demand: 'Jurisdictions with adopted plans + Prop 123 commitments demonstrate political will. Your project lands in a friendlier entitlement environment with state-level scoring bonuses.',
      project: 'Verify the jurisdiction has an adopted plan + Prop 123 commitment BEFORE you submit. If not, you may need to engage a planning consultant + the elected officials to support adoption — adds 6-12 months to your timeline.',
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
    // F199 — Dropped the "For affordable-housing developers" eyebrow
    // per user request. The three labeled paragraphs already make the
    // intent clear without the redundant header. Accent left border +
    // muted background still distinguish the callout visually.
    return '<aside class="hna-dev-context" role="note" ' +
           'style="margin:.55rem 0 .8rem;padding:.65rem .85rem;' +
           'border-left:3px solid var(--accent);background:var(--bg2);' +
           'border-radius:0 6px 6px 0;font-size:.85rem;line-height:1.45">' +
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
