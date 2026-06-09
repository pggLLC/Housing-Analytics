/* F197 — Plain-English explanatory callouts across the HNA page.
 * Every chart, indicator, or stat gets a 3-lens explanation:
 *   (a) why this signal matters,
 *   (b) what it says about the need for housing,
 *   (c) how it shapes a project (unit mix, AMI, scoring, etc.).
 *
 * F211 — Neutralized the voice from second-person developer-directed
 * ("use this in your CHFA application") to informational third-person
 * ("AMIs feed CHFA applications") so the site reads correctly for
 * EVERY audience — residents, policymakers, journalists, planners,
 * lenders, developers, students. The data and its meaning don't
 * change; only the framing does. The accompanying paragraph header
 * is "How it shapes a project" (not "your project").
 *
 * Approach: a single JS file that runs on HNA load, reads section
 * IDs from each .chart-card h2[id], looks up an explanation from the
 * EXPLAIN map below, and injects a styled callout immediately after
 * each h2's existing intro <p>. Keeps the HTML clean and makes it
 * trivial to add more sections — just append an entry to EXPLAIN.
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
      why: 'The headline stats — population, median income, rent, home value, and cost burden — frame what a project can charge and who it must serve.',
      demand: 'Low median income + high rent + high cost-burden share is the classic signal of unmet affordable-housing demand. Every 30+ point gap between median income and area median income (AMI) means deeper need.',
      project: 'These size an AMI mix: if median household income is well below the county AMI, 30-60% AMI units fit the local pool. If it sits above, mixed-income (60-80%) tends to score better in QAP "community need" sections.',
    },

    /* ── LIHTC, QCT & DDA ── */
    'LIHTC, QCT': {
      why: 'QCT (Qualified Census Tract) and DDA (Difficult Development Area) designations are the single biggest financial lever in a LIHTC deal — a 30% basis boost on a $20M project is ~$6M of additional eligible basis.',
      demand: 'High QCT count + DDA status indicates a community HUD recognizes as needing extra incentive to attract affordable housing. Existing LIHTC project count reflects market saturation — many recent awards can pull down CHFA scoring for new applicants.',
      project: 'A site inside a QCT or DDA county qualifies for the basis boost automatically. Sites in QCT + DDA are the strongest candidates. Four-plus years since the last local LIHTC award typically scores well on "geographic distribution" in the CHFA QAP.',
    },

    /* ── HUD FMR + Income Limits ── */
    'HUD Fair Market Rents': {
      why: 'FMR sets the maximum rent that can be charged to LIHTC tenants at each AMI band. HUD updates these yearly; they form the hard floor of pro forma revenue.',
      demand: 'When FMR sits significantly below market rents (see the rent triangulation panel below), local affordability stress is severe — exactly the conditions LIHTC was designed for.',
      project: '50-60% AMI rents are commonly penciled to verify financeability. When 60% AMI rents are well below FMR, there is room to deepen affordability to 30-40% AMI — a path that earns CHFA QAP "deeper income targeting" points.',
    },

    /* ── Rent triangulation ── */
    'Rent triangulation': {
      why: 'Three different rent measures — HUD FMR (regulated), ACS median (legacy tenants), Zillow ZORI (new leases) — surface lease-up premium and market drift.',
      demand: 'When ZORI (new-lease rent) runs 15%+ above ACS (legacy rent), long-tenured renters pay much less than newcomers. Once they turn over, displacement risk spikes — that is acute affordable-housing demand brewing.',
      project: 'ACS feeds cost-burden math, FMR feeds LIHTC rent underwriting, ZORI feeds the "what a market-rate comparable would charge" benchmark. The blended average reflects what a typical mixed-tenure resident actually pays.',
    },

    /* ── Housing stock / structure type ── */
    'Housing stock': {
      why: 'The structure mix (single-family / 2-4 unit / 5+ unit) reveals whether the market has multifamily infrastructure or is single-family-dominant. LIHTC deals are almost always 5+ units.',
      demand: 'A community with <10% multifamily has structural undersupply for renters. Adding 60-100 LIHTC units in that context dramatically shifts the renter housing market.',
      project: 'Single-family-dominant markets need extra zoning and entitlement effort. Areas where multifamily is already 15-25% tend to have lower entitlement risk and infrastructure (water, sewer) sized for it.',
    },

    /* ── Tenure ── */
    'Owner/renter': {
      why: 'Renter share is the audience for a rental project. Low renter share + high cost burden = renters trapped in unaffordable units with no alternatives.',
      demand: 'A jurisdiction with 30-40% renters and 50%+ rent burden has an acute renter affordability problem. That is a strong demand case for new affordable rentals.',
      project: 'Cities with 50%+ renter share have well-developed rental markets — projects plug into an existing renter base. Towns with <25% renters are harder lease-ups; senior + workforce niches tend to fit better.',
    },

    /* ── Home value distribution ── */
    'Home value': {
      why: 'Owner-occupied home values reflect the appreciation pressure pushing renters out of for-sale ownership and into permanent renting.',
      demand: 'When home values cluster $400K+ and median income is $70K, the math says ~95% of renters cannot buy in. That is a structural locked-in renter pool — and the addressable rental audience.',
      project: 'High home values often mean QCT eligibility may not survive future ACS releases (rising-incomes risk). The snapshot gauges how stable basis-boost status will be over the 15-year compliance period.',
    },

    /* ── Homeownership affordability ── */
    'Homeownership affordability': {
      why: 'The "income needed to buy the median home" stat is the most concrete statement of who is being priced out of ownership today.',
      demand: 'When required income is 30%+ above actual median income, the affordability gap is severe — these households become permanent renters and need quality affordable rental supply.',
      project: 'This gap supports CHFA "community need" narratives. "X% of local households cannot buy the median home" is the kind of concrete need statement that scores in QAP sections.',
    },

    /* ── Rent burden ── */
    'Rent burden distribution': {
      why: 'Cost burden (30%+ of income on rent) and severe burden (50%+) are HUD\'s legal definitions of housing-unaffordability. They are also CHFA\'s primary scoring metric.',
      demand: 'A 40%+ rent-burdened share signals systemic affordable-housing failure. 50%+ severe burden means renters are choosing between rent and food / medical / transportation.',
      project: 'Targeting the deepest burden bands with the AMI mix lines up with CHFA QAP scoring — more points go to projects serving 30% AMI households precisely because that band carries the most severe burden.',
    },

    /* ── Cost burden by AMI tier (HUD CHAS) ── */
    'Cost burden by AMI tier': {
      why: 'HUD CHAS breaks cost burden by AMI band — showing which income tier needs help most. This is the single highest-resolution view of demand.',
      demand: 'When 30% AMI burden is 85%+ and 50-80% AMI burden is 30%, the most acute need is at deepest affordability. When burden is high across all tiers, broad workforce-housing demand is also present.',
      project: 'Unit mix typically mirrors the burden distribution. A project serving exclusively 30% AMI tenants when 80% AMI is also heavily burdened leaves QAP points on the table. Mixed AMI projects (e.g. 20% at 30% AMI + 30% at 50% + 50% at 60%) often score best.',
    },

    /* ── Commute / mode share ── */
    'Commuting: mode share': {
      why: 'Commute mode reveals transit access — the "transit-oriented development" (TOD) bonus in CHFA QAP requires verified frequent transit nearby.',
      demand: 'Heavy car-dominant commutes + low transit + high housing costs create a "trapped commuter" pattern — workers driving 30+ min from cheaper outlying housing to job centers.',
      project: 'Sites with >5% transit share are likely TOD-eligible. Sites with <2% transit are car-dominant and need parking + drive-time analysis. The commute pattern feeds CHFA "amenity proximity" scoring narratives.',
    },

    /* ── LEHD commute flows ── */
    'inflow': {
      why: 'Commute flows distinguish job centers (more workers come in than out) from bedroom communities (more residents leave for work). The two need very different affordable housing strategies.',
      demand: 'A jurisdiction with strong inbound commute but high local rent burden has a workforce-housing crisis — the people working there cannot afford to live there. That is a classic LIHTC + workforce-paired QAP narrative.',
      project: 'Bedroom communities tend to suit family + senior 9% LIHTC. Job centers tend to suit workforce-targeted 4% bond + state-paired credits at 60-80% AMI. AMI mix typically follows the labor-market character.',
    },

    /* ── Household composition / occupation / labor force ── */
    'Household composition, occupation': {
      why: 'The mix of married couples, single parents, living-alone, and occupation profile drives unit-mix decisions (1BR vs 2BR vs 3BR) and supportive-services design.',
      demand: 'High single-parent share means demand for 2-3BR units with childcare proximity. High living-alone share means 1BR / studio demand. High service-occupation share signals deep-AMI need (30-60% AMI band).',
      project: 'Household-type mix typically sets bedroom mix; occupation mix typically sets the AMI band — service workers fit 30-60% AMI; mid-tier office workers fit 60-80% AMI.',
    },

    /* ── Race & ethnicity ── */
    'Race & ethnicity': {
      why: 'Demographic composition matters for AFFH (Affirmatively Furthering Fair Housing) compliance and CHFA QAP "geographic distribution" scoring.',
      demand: 'Jurisdictions with concentrated minority populations and high cost burden indicate historical disinvestment — exactly where new affordable housing has the deepest impact and CHFA prioritizes scoring.',
      project: 'The race/ethnicity profile feeds CHFA AFFH narratives. A project that serves a demographically representative tenant pool scores better on "community integration" and reduces fair-housing risk.',
    },

    /* ── Educational attainment ── */
    'Educational attainment': {
      why: 'Education profile predicts long-term income trajectory and informs supportive-services design (workforce training partnerships, etc).',
      demand: 'Lower Bachelor\'s+ share with high cost burden indicates a workforce population permanently locked out of higher-wage jobs — they need durable affordable housing because their income will not catch up to rents.',
      project: 'Education stats feed QAP "community need" scoring + workforce-training partnership decisions (which boost CHFA + DOH scoring). Higher-education jurisdictions may suit family or workforce housing.',
    },

    /* ── Age pyramid ── */
    'Age pyramid': {
      why: 'Population by age reveals which sub-population needs grow fastest — seniors, working-age, or family/youth. Each implies a different affordable-housing product.',
      demand: 'A bottom-heavy pyramid (young families) means schools, family units, and ground-floor accessibility don\'t apply. A top-heavy pyramid (aging-in-place) means senior + age-restricted housing is the dominant need.',
      project: 'The pyramid points to target population for CHFA applications. CHFA awards specifically to seniors / families / supportive / supportive-services projects — the data signals which lane fits.',
    },

    /* ── Senior growth pressure ── */
    'Senior growth': {
      why: 'Senior population growth (75+, 65+) is the slowest-moving but most predictable demographic signal — when it is accelerating now, demand for senior housing will compound through the 15-year LIHTC compliance period.',
      demand: '20%+ senior-population growth over a decade with no senior-restricted LIHTC nearby is acute unmet demand. Senior renters are typically deeper-AMI (fixed-income Social Security) so they need the deepest affordability.',
      project: '62+ age-restricted projects score in their own CHFA category. Demand signals from this chart are among the strongest pieces of evidence used in "community need" sections.',
    },

    /* ── 20-year outlook / population projection ── */
    '20-year outlook': {
      why: 'A 20-year projection shows whether the unit need being solved is permanent or a passing wave. LIHTC compliance is 15-30 years; demand thesis must outlast that.',
      demand: 'When projected population growth implies 1,500+ new households over 10 years and current housing-gap is 600 units, the gap is growing — durable solutions are warranted.',
      project: 'Projections support CHFA "market durability" narratives. When projections show DECLINING population, senior + workforce niches with specific local drivers tend to fit better.',
    },

    /* ── DOLA forecast sensitivity ── */
    'DOLA forecast': {
      why: 'DOLA publishes three scenarios (baseline / low / high). The range between low and high is the honesty test — wider bands mean more demand uncertainty.',
      demand: 'When even the low-growth scenario shows positive household formation > current housing inventory growth rate, demand is structurally present even in a downturn.',
      project: 'Underwriting is typically stress-tested against the LOW-growth scenario. CHFA underwriters and DOH gap-funders look at this; deals that pencil in DOLA low-growth are much more likely to fund.',
    },

    /* ── Housing need summary ── */
    'Housing need summary': {
      why: 'The composite housing need score and AMI-gap counts are CHFA QAP\'s primary scoring inputs. This is the single most-important section for applications.',
      demand: 'A "high" need rating + multi-thousand unit gap at 30-50% AMI is the textbook "community need" justification. AMI-gap counts feed CHFA narratives directly.',
      project: 'Gap counts size a project (e.g. "80 units against a 1,200-unit 30% AMI gap, addressing 6.7% of the unmet need"). CHFA scoring rewards proposals that proportionally address the documented gap.',
    },

    /* ── Bedroom mix / household demand ── */
    'Bedroom': {
      why: 'Bedroom mix demand connects household structure (single-parent / family / senior) to unit-mix economics. Wrong mix = persistent vacancy + scoring penalty.',
      demand: 'High demand for 2BR + 3BR means family + single-parent households dominate; CHFA QAP awards more points for serving families. Heavy 1BR demand means senior + living-alone — different scoring lane.',
      project: 'Pro forma unit mix typically matches the demand distribution. A 60-unit project with 40 1BR / 15 2BR / 5 3BR scores poorly when local demand is 2BR-dominant; recalibrating to the data is the standard fix.',
    },

    /* ── Affordability composite ── */
    'Affordability Composite': {
      why: 'The composite affordability ratio (income vs rent + home value vs income) is a single-number gauge of how stressed the local affordability picture is.',
      demand: 'Composite scores in the worst quartile indicate communities where market-rate solutions can\'t close the gap — only subsidized affordable housing can.',
      project: 'The composite ranking feeds CHFA application narratives. "Top 10% most-stressed in Colorado" is the kind of concrete language that scores in community-need sections.',
    },

    /* ── Special Needs ── */
    'Special Needs': {
      why: 'Senior + disability + single-parent shares signal demand for supportive-services-paired housing. These households need deeper affordability AND service partnerships.',
      demand: 'High 65+ share + high disability share means senior + supportive-housing demand is concentrated here. Deeper AMI bands (30-50%) typically fit since fixed-income seniors carry severe rent burden.',
      project: 'Supportive housing scoring rewards partnerships with local supportive-services providers (continuum of care, disability services nonprofits). CHFA + DOH-HHPG award strongly when supportive services are paired with the housing.',
    },

    /* ── F198 — Second-batch callouts for the remaining ~30 sections ── */

    /* ── Household Income Distribution (ACS DP03 brackets) ── */
    'Household Income': {
      why: 'The income distribution shows exactly how many households fall in each AMI band — the direct demand pool for each unit at each rent point.',
      demand: 'A jurisdiction with 25%+ of households below 30% AMI but no deep-affordability LIHTC has acute unmet need at the lowest income tier. That is where supportive + 30% AMI projects fill the deepest gap.',
      project: 'AMI mix typically mirrors this distribution. When 40% of HHs are <50% AMI, having 40% of project units at 30-50% AMI sizes the audience correctly and earns "deeper income targeting" points in CHFA QAP.',
    },

    /* ── How Affordable Has Housing Become Over Last 15 Years ── */
    'How Affordable Has Housing': {
      why: '15-year affordability trends show whether housing stress is a passing wave or a structural shift. CHFA QAP "documented community need" sections weight long-trend evidence heavily.',
      demand: 'When rent rises 60%+ and income rises 25% over the same period, the result is permanent affordability erosion — exactly the conditions that LIHTC was designed to fix and CHFA prioritizes.',
      project: 'The 15-year rent-to-income ratio shift feeds application narratives directly. "Median rent rose 62% while median income rose 21%" is the kind of concrete historical evidence that CHFA underwriters look for.',
    },

    /* ── Pace & Scale of New Housing Permits ── */
    'Pace & Scale of New Housing Permits': {
      why: 'Permit-to-need ratios show whether the market is keeping up with the local affordability gap or falling behind. CHFA + DOH evaluators look at this when assessing whether new construction is filling a real shortage.',
      demand: 'When annual permits are below the annual unit-need-growth rate, the shortage compounds yearly. A 5-year permit pace at 50% of need-growth means construction is not keeping up — a strong affirmative case.',
      project: 'CHFA "Community Need" narratives often document this gap. "Local permitting averages X units/year against a Y unit/year need, so this project addresses Z% of the recurring annual shortfall" is concrete scoring language.',
    },

    /* ── Age of Housing Stock ── */
    'Age of Housing Stock': {
      why: 'Old housing stock (pre-1960) signals lead paint, asbestos, and accessibility-retrofit costs. It also signals an aging building stock with fewer "newly built" amenities and creates demand for modern affordable units.',
      demand: 'Heavy pre-1960 share + low new-construction permitting = renters stuck in deteriorating units paying high rents. New high-quality affordable construction commands strong lease-up demand.',
      project: 'A newly-built LIHTC project provides quality, modern accessible units that older stock can\'t match. Contrast with existing dated stock supports scoring on "physical condition improvement" + "ADA accessibility" + "energy efficiency."',
    },

    /* ── Bedroom Mix ── */
    'Bedroom Mix': {
      why: 'The bedroom inventory (% 1BR / 2BR / 3BR / 4+BR) reveals whether the local market serves families or singles — and where the supply gap is.',
      demand: 'Severe undersupply of 3BR+ in a jurisdiction with high single-parent + family-with-kids share means families are crowded into too-small units (overcrowding). That is acute family-housing demand.',
      project: 'Bedroom mix typically fills the local supply gap rather than duplicating it. A 60-unit family project with 25 1BR / 20 2BR / 15 3BR addresses overcrowding and earns "family housing" + "right-sizing" QAP points.',
    },

    /* ── Owner Housing Cost Burden ── */
    'Owner Housing Cost Burden': {
      why: 'Owner cost burden (mortgage + tax + insurance + utilities > 30% of income) reveals "house-poor" homeowners who cannot spend on maintenance or family needs. It also signals owners at risk of foreclosure-to-rental transition.',
      demand: 'High owner burden + low renter availability creates a brittle housing market. When owner-burdened HHs lose their home they move to the rental market, increasing rental demand further.',
      project: 'Both renter AND owner burden feed CHFA narratives. "Total cost-burdened HHs is X" (renter + owner combined) is a stronger demand statement than renter-only stats, especially for workforce-targeted projects.',
    },

    /* ── Housing Gap & Affordability Analysis ── */
    'Housing Gap': {
      why: 'The AMI-band housing gap is the most direct unit-count statement of unmet need. It answers: "how many more units at this AMI does this community need?" — the number a project sizes against.',
      demand: 'A 30% AMI gap of 1,200+ units in a town of 10,000 households is structural market failure. A 60-unit project addresses 5% of the gap — solid but incremental. A 200-unit project would address 17% — transformative.',
      project: 'CHFA applications cite the exact gap by AMI tier. "Project provides X units at Y% AMI against a documented Z unit gap at that tier" is direct math the CHFA scorers look for in "Community Need" sections.',
    },

    /* ── Scenario-based demographic projections ── */
    'Scenario-based demographic projections': {
      why: 'Three-scenario projections (baseline / low / high) test a project under different futures. Underwriters care about the LOW-growth case because that is the stress condition.',
      demand: 'When even the low-growth scenario shows positive household formation above current permitting pace, demand is structural even in a downturn — projects are more durable.',
      project: 'Underwriting is typically stress-tested against the LOW scenario for safety. A deal that pencils there survives a recession; running baseline + high then sizes the upside. CHFA + DOH gap funders look for this discipline.',
    },

    /* ── Labor Market Context / Wage Distribution / Top Industries ── */
    'Labor Market Context': {
      why: 'Wage distribution + dominant industries reveal what AMI band future tenants actually earn. Many resort-area service workers cannot afford 60% AMI but qualify for 30-50%.',
      demand: 'Heavy service-occupation employment + low median wage = deep affordability need at the 30-50% AMI band. Office-dominant markets need 60-80% AMI workforce housing.',
      project: 'AMI mix typically matches the actual wage distribution. Resort towns need 30-50% AMI. Tech-dominant suburbs need 60-80% AMI. Mixed-economy cities benefit from broad AMI mix (30%/50%/60%/80%) to capture the full workforce.',
    },

    'Wage Distribution': {
      why: 'The wage distribution by percentile shows exactly which workers can afford which rents. Cross-referenced against FMR, it surfaces who is priced out.',
      demand: 'When the 50th percentile wage cannot afford the 50th percentile rent at the 30% rule, half the workforce is rent-burdened. That is a workforce housing crisis.',
      project: 'AMI mix is typically sized from the wage distribution. When 35% of workers earn < $30K, 30-50% AMI units fit. When 40% earn $40-60K, 60-80% AMI units fit. Single-band targeting risks the "middle-class trap" where a project misses the broader workforce.',
    },

    'Top Industries': {
      why: 'Dominant industries reveal job stability + wage trajectory. Healthcare + government = stable + growing. Mining + manufacturing = volatile. Hospitality = low-wage + seasonal.',
      demand: 'Hospitality-dominant areas have high turnover + low wages = acute workforce-housing demand. Healthcare-dominant areas have stable mid-tier workers needing 60-80% AMI workforce units.',
      project: 'Supportive services are typically tailored to the dominant industry — local hospital partnerships for healthcare-worker preference; resort association partnerships for hospitality preference. CHFA + Prop 123 scoring rewards employer partnerships.',
    },

    'Wages vs Housing Affordability': {
      why: 'The wage-to-rent ratio is the single most accessible test of "can workers afford to live here?" It is the math everyone — politicians, voters, employers — understands intuitively.',
      demand: 'A 40+ hour/week minimum wage worker spending 60%+ on rent is exactly who LIHTC was designed to serve. That ratio is among the most concrete pieces of demand evidence.',
      project: 'The ratio reads well in CHFA narratives: "A full-time worker earning X must spend Y% of pre-tax income on the median 2BR rent." This is the language that scores in "Community Need" + "Local Support" sections (because it persuades local elected officials).',
    },

    /* ── Economic indicators / employment trend / wage trend / industry analysis ── */
    'Economic Indicators': {
      why: 'Macroeconomic context (unemployment, labor-force participation, prime-age employment) shows whether the local economy is expanding or contracting — which shapes 15-year lease-up risk.',
      demand: 'Tight labor market + rising wages + low unemployment = strong rental demand at all AMI bands. Loosening labor market = workforce-housing demand stays high as workers downsize from market-rate to subsidized units.',
      project: 'Economic-cycle context feeds underwriting narratives. A counter-cyclical play (start construction when peers slow down) reduces hard-cost stress and positions lease-up for the next upswing.',
    },

    'Employment Trend': {
      why: 'Employment trajectory is the leading indicator of housing demand — jobs come first, residents follow, then rents move. A 5-yr employment trend forecasts the next 2-3 years of housing market direction.',
      demand: 'Positive employment trend (+2%/yr) + flat housing supply = rapidly tightening rental market. New affordable units absorb net new workers before the market re-equilibrates upward.',
      project: 'Employment trends feed CHFA "market growth" + "lease-up confidence" narratives. Positive trends support 9% LIHTC family / workforce; negative trends suit senior / preservation niches.',
    },

    'Wage Trend': {
      why: 'Wage growth (or stagnation) shows whether AMI thresholds will rise (lifting unit rents) or stagnate (locking a project at its initial pricing). Critical for 15-year compliance economics.',
      demand: 'Wage trend BELOW rent growth = expanding affordability gap = permanent and growing demand. Wage trend ABOVE rent growth = closing gap, projects may become less competitive over time.',
      project: 'Pro formas are typically stress-tested against the worst 5-yr wage trend in this dataset. When unit rents stay viable under flat wages for 5 years, the project survives a recession.',
    },

    'Industry Analysis': {
      why: 'Industry concentration shows economic resilience — diverse economies recover from shocks; single-industry towns don\'t. 15-year LIHTC compliance favors diverse economies.',
      demand: 'Single-industry towns (mining, military, university) have wildly variable affordable-housing demand depending on local employer fortunes. Diverse economies have stable, predictable demand.',
      project: 'Diverse economies suit 9% family / workforce projects with multi-AMI mixes. Single-industry towns suit targeted niches (senior, supportive, or employer-aligned workforce). Project type typically matches economic structure.',
    },

    'Wage Gaps': {
      why: 'Wage inequality reveals "service worker / professional" splits that are invisible in median stats. It shows the depth of workforce-housing crisis.',
      demand: 'Large wage gaps at the local level mean dual demand: deep-affordability for service workers (30-50% AMI) AND workforce middle for healthcare / education (60-80% AMI). Both are needed.',
      project: 'Mixed-AMI projects (e.g. 25% at 30% AMI + 35% at 50% AMI + 40% at 60% AMI) directly address documented wage gaps. CHFA QAP rewards proposals that mirror local economic complexity.',
    },

    /* ── Affordable Housing Compliance (HB 22-1093 / Prop 123) ── */
    'HB 22-1093': {
      why: 'HB 22-1093 + Prop 123 are Colorado\'s state-level housing-action requirements. Compliance status determines eligibility for Prop 123 fast-track funding and state-level credit allocations.',
      demand: 'A jurisdiction without an adopted Housing Action Plan or local commitment is leaving Prop 123 dollars on the table — even when the underlying housing need is severe.',
      project: 'Status matters BEFORE applying. Jurisdictions with adopted plans + commitments are pre-qualified for Prop 123 fast-track + Local Investment funds. Those without may need 6-12 months of catch-up work before state credit can layer in.',
    },

    /* ── PMA Delineation & CHFA Requirements ── */
    'PMA Delineation': {
      why: 'The Primary Market Area (PMA) is the defined catchment for a project\'s tenant base. CHFA underwriters require a documented PMA before considering an application.',
      demand: 'A wide PMA (15+ mi) implies a broad regional tenant base — riskier for lease-up. A tight PMA (5 mi) means strong local demand justifies the unit count.',
      project: 'The PMA is documented on the map. For rural areas a county or multi-county PMA fits; for urban a sub-city PMA fits. The smaller and more defensible the PMA, the stronger the "market sizing" argument with CHFA.',
    },

    /* ── Projected Housing Need ── */
    'Projected Housing Need': {
      why: 'A forward-looking housing-need projection (3-5 yr) is the demand thesis underneath a stabilized lease-up assumption. CHFA underwriters and lenders look for this.',
      demand: 'When projected need exceeds the local pipeline (permits + announced affordable) by 200+ units, durable lease-up demand persists for years. When projection is flat or declining, new projects face a saturated market — caution warranted.',
      project: 'Projected unit need feeds CHFA narratives. A project for 80 units in a market projected to need 600 more affordable units in 5 years is on the right side of the supply-demand curve.',
    },

    /* ── Renter need by bedroom count (B25009 → bins) ── */
    'Renter need by bedroom': {
      why: 'Renter household-size distribution reveals what bedroom mix actually serves the local renters — distinct from owner-side or area-wide household stats.',
      demand: 'When 35% of renter HHs are 3+ persons but only 15% of the rental supply is 3BR, families are crowded into 2BRs. That is the most visible form of housing inadequacy — overcrowding.',
      project: 'Renter-side bedroom distribution sets unit mix more accurately than broader population distribution (which includes owners). The renter-specific signal is the one to trust.',
    },

    /* ── What types of housing does the data support? ── */
    'What types of housing': {
      why: 'This composite ranks 6 housing-type lanes (deep-affordability rental / workforce rental / family / senior / missing-middle ownership / detached SF ownership) by local need signals — a top-line view of where to focus.',
      demand: 'A top-ranked lane is where projects face the LEAST competition and the MOST demand. Pursuing a low-ranked lane in this geography means fighting the data.',
      project: 'Project type typically matches the top-ranked lane. When "deep-affordability rental" is top, a 30-50% AMI deep-targeting project fits. When "missing-middle ownership" is top, a townhome/condo for-sale path may fit better.',
    },

    /* ── Neighborhood & Architectural Context ── */
    'Neighborhood & Architectural': {
      why: 'Neighborhood + architectural fit affects entitlement timelines, public support, and tenant lease-up. A project that "fits" gets through entitlement faster.',
      demand: 'Markets with strong design preferences (historic districts, character zones) need architectural sensitivity. Markets without these constraints allow faster, cheaper construction.',
      project: 'This context shapes design phase. Historic-character markets benefit from infill / adaptive-reuse strategies (which also unlock historic tax credits). Open-plan suburban markets allow type-V garden-style at lower cost-per-unit.',
    },

    /* ── Housing Type Feasibility Analysis ── */
    'Housing Type Feasibility': {
      why: 'A type-by-type feasibility check (per-unit cost vs achievable rent vs zoning vs basis-boost) shows what physical product is financeable here.',
      demand: 'A high-cost-area + strict zoning + low FMR = only deeply-subsidized 4% bond + state-paired projects pencil. A moderate-cost suburb + flexible zoning + reasonable FMR opens 9% LIHTC family product.',
      project: 'This analysis sets the project TYPE before financing path is locked. 9% LIHTC works in moderate markets. 4% bond + state needs harder-cost markets with full basis boost. Forcing the wrong product into the wrong market rarely pencils.',
    },

    /* ── Colorado Market Conditions ── */
    'Colorado Market Conditions': {
      why: 'State-level context (statewide construction cost trends, capital market conditions, equity pricing) sets the macro frame for a local project.',
      demand: 'When statewide cost trends compound 5-7%/yr while local rents rise 2-3%/yr, the gap widens — only deeply-subsidized projects pencil. Application cycles tend to align with these conditions.',
      project: 'Macro signals inform closing-date decisions. High-cost / soft-equity-pricing periods favor 4% bond + state + soft-funded deals. Low-cost / strong-equity periods favor 9% competitive projects.',
    },

    /* ── Housing Action Plan Checklist ── */
    'Housing Action Plan': {
      why: 'A locally-adopted Housing Action Plan is now table stakes for state-level competitive credit. CHFA + DOH explicitly reward jurisdictions with adopted plans.',
      demand: 'Jurisdictions with adopted plans + Prop 123 commitments demonstrate political will. Projects in those jurisdictions land in friendlier entitlement environments with state-level scoring bonuses.',
      project: 'Adopted plan + Prop 123 commitment status matters BEFORE submission. Where status is absent, engaging a planning consultant + elected officials to support adoption can add 6-12 months to a timeline.',
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
             '<p style="margin:0"><strong>How it shapes a project:</strong> ' + entry.project + '</p>' +
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
