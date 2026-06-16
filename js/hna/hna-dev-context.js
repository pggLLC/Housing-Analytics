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
      why: 'Population, median income, rent, home value, and cost-burden share are the first numbers a developer, council member, or housing partner needs in front of them. Together they describe what rents a project can realistically charge, who in the community it is likely to serve, and how the unit mix has to be shaped to actually meet local need.',
      demand: 'When local incomes sit well below what HUD calls the Area Median Income (AMI) for the surrounding area while rents and the share of residents paying over 30% of their income on housing both climb, residents are running out of options close to home. The wider that gap — roughly 30 percentage points or more — the more acutely the community needs affordable rental supply at deeper AMI bands.',
      project: 'These numbers also point toward the right unit mix. If the local median household income sits well below the county AMI, units restricted to 30–60% AMI are the ones that actually serve neighbors who live here today. If local income runs above the county AMI instead, a mixed-income approach (60–80% AMI) tends to score better in the "community need" sections of CHFA\'s Qualified Allocation Plan and reach a wider range of working households.',
    },

    /* ── LIHTC, QCT & DDA ── */
    'LIHTC, QCT': {
      why: 'QCT (Qualified Census Tract) and DDA (Difficult Development Area) designations are among the most significant financial supports in a LIHTC deal — a 30% basis boost on a $20M project means roughly $6M in additional eligible basis to put toward homes for residents.',
      demand: 'A high QCT count plus DDA status reflects a community HUD has recognized as needing extra support to bring affordable homes online. Looking at recent local LIHTC awards alongside that helps us understand how much new construction the community has been able to absorb lately, and where the next thoughtful addition might fit.',
      project: 'A site inside a QCT or DDA county qualifies for the basis boost automatically — sites in both are especially strong candidates. Several years since the last local LIHTC award is often something CHFA recognizes under its geographic-distribution considerations.',
    },

    /* ── HUD FMR + Income Limits ── */
    'HUD Fair Market Rents': {
      why: 'HUD publishes Fair Market Rent (FMR) and Income Limits each year. CHFA uses those numbers — together with the IRC §42 formula — to set the actual rent ceilings that LIHTC residents are charged at each AMI band. Those ceilings are what a project budgets against.',
      demand: 'When the local rent ceiling sits well below what new market-rate apartments are leasing for (see the rent triangulation panel below), it is a signal that affordability is genuinely strained in the community — and that an affordable project would meaningfully widen the choices residents have.',
      project: 'For planning, 50–60% AMI rents are often reviewed first because they anchor the project budget. When the 60% AMI rent ceiling is well below local rents, a project may also be able to serve residents at 30–40% AMI, consistent with CHFA\'s QAP framework for deeper affordability.',
    },

    /* ── Rent triangulation ── */
    'Rent triangulation': {
      why: 'Three different rent measures — HUD FMR (the regulated reference CHFA uses), ACS median (what longer-tenure residents are paying), and Zillow ZORI (what new leases are signing for) — together show whether the community\'s rents have shifted under existing residents\' feet.',
      demand: 'When ZORI (new-lease rent) runs 15%+ above ACS (longer-tenure rent), long-time residents are paying meaningfully less than newcomers. As units turn over, those residents face hard choices — a real and growing affordability pressure that an affordable rental project would help address.',
      project: 'ACS informs the cost-burden math, the HUD FMR reference informs the LIHTC rent ceiling CHFA sets, and ZORI provides a comparable-market read on what a market-rate apartment would charge today. Together they describe what a typical resident in this community is actually paying.',
    },

    /* ── Housing stock / structure type ── */
    'Housing stock': {
      why: 'The structure mix (single-family / 2-4 unit / 5+ unit) reveals whether the market has multifamily infrastructure or is single-family-dominant. LIHTC deals are almost always 5+ units.',
      demand: 'A community with <10% multifamily has structural undersupply for renters. Adding 60-100 LIHTC units in that context dramatically shifts the renter housing market.',
      project: 'Single-family-dominant markets need extra zoning and entitlement effort. Areas where multifamily is already 15-25% tend to have lower entitlement risk and infrastructure (water, sewer) sized for it.',
    },

    /* ── Tenure ── */
    'Owner/renter': {
      why: 'How many residents in the community rent their homes shapes the kind of housing partnership that fits. A community where many residents rent and many are cost-burdened is one where neighbors are stretched and have few alternatives close by.',
      demand: 'A community with 30–40% of residents renting and more than half of them paying over 30% of their income on rent has a documented affordability strain — and a real case for thoughtful new affordable homes.',
      project: 'Cities where renting is already the norm (50%+ of residents) tend to have a well-developed rental market that a project can join. In towns where most residents own their homes, senior and workforce partnerships are often the ones that fit best — because they line up with documented community needs (aging in place; the workforce commuting in from out of town).',
    },

    /* ── Home value distribution ── */
    'Home value': {
      why: 'Local home values show how much pressure ownership has been under. As prices rise faster than wages, neighbors who would have bought a starter home in their own town increasingly stay in rentals.',
      demand: 'When home values cluster above $400K and median household income is around $70K, very few local renter households can realistically buy a home in their own community — meaning thoughtful, well-built affordable rentals would meaningfully widen the choices residents have.',
      project: 'When home values rise sharply, future ACS releases may eventually move some tracts out of QCT eligibility — something to think through when shaping the 15-year compliance plan for a project here.',
    },

    /* ── Homeownership affordability ── */
    'Homeownership affordability': {
      why: 'The "income needed to buy the median home" figure is the most direct way to describe who can — and cannot — buy a home in this community today.',
      demand: 'When the income needed to buy the median home is 30%+ above the actual local median, many neighbors who hoped to buy will instead remain renters for the foreseeable future — and thoughtful affordable rental supply is part of how a community supports them.',
      project: 'This figure is also a clear, plain-language way to describe a community\'s need when working together on CHFA application narratives: "X% of our local households are unable to buy the median home in our own community."',
    },

    /* ── Rent burden ── */
    'Rent burden distribution': {
      why: 'Cost burden (30%+ of income on rent) and severe burden (50%+) are HUD\'s definitions of housing-unaffordability. They are also the metric CHFA gives the most weight to when reading the community\'s need.',
      demand: 'A community where 40%+ of renter households are cost-burdened, or where 50%+ are severely burdened, is one where many neighbors are making hard tradeoffs every month — between rent and food, medical care, and transportation.',
      project: 'Shaping the AMI mix of a project so it serves the bands carrying the heaviest burden lines up with CHFA\'s QAP framework — which gives more weight to projects serving very low-income residents precisely because that is where the affordability pressure is most acute.',
    },

    /* ── Cost burden by AMI tier (HUD CHAS) ── */
    'Cost burden by AMI tier': {
      why: 'HUD CHAS breaks cost burden out by AMI band — showing which income tiers in the community are under the most pressure. It is the highest-resolution public view of housing affordability strain.',
      demand: 'When 85%+ of residents at 30% AMI are cost-burdened and 30%+ at 50–80% AMI also are, the most acute need is at the deepest-affordability end. When burden is high across all tiers, workforce housing is also part of the partnership conversation.',
      project: 'A project\'s unit mix usually reflects the local burden distribution. A project that serves only the 30% AMI band when 80% AMI is also heavily burdened may not reach as many of the community\'s neighbors as a thoughtfully mixed-AMI project (e.g. 20% at 30% AMI + 30% at 50% + 50% at 60%) — which is also how CHFA\'s QAP tends to read most favorably.',
    },

    /* ── Commute / mode share ── */
    'Commuting: mode share': {
      why: 'How residents in this community get to work tells us about transit access. The CHFA QAP recognizes Transit-Oriented Development (TOD) — sites near verified frequent transit — and the commute mix is the first read on whether the community supports it.',
      demand: 'When most residents drive long distances to work — 30+ minutes from outlying housing to job centers — it often reflects the same affordability pressure: working neighbors who cannot afford to live in the community where they work. An affordable project closer to those jobs helps.',
      project: 'Sites with more than 5% transit commute share are often TOD-eligible. Sites under 2% are car-dependent, where parking and drive-time will need careful thought. Either way, the commute pattern is part of describing the community\'s context in a CHFA application.',
    },

    /* ── LEHD commute flows ── */
    'inflow': {
      why: 'Commute flows distinguish job centers (where more residents come in to work than leave) from bedroom communities (where more residents leave for jobs elsewhere). Both call for affordable housing, but the partnership shape is different.',
      demand: 'A community with strong inbound commute and significant local rent burden is one where the people working there often cannot afford to live there. Workforce housing — paired thoughtfully with LIHTC — is often the right partnership shape, and this story fits naturally into a CHFA application.',
      project: 'Bedroom communities tend to suit family + senior 9% LIHTC. Job centers tend to suit workforce-targeted 4% bond + state-paired credits at 60-80% AMI. AMI mix typically follows the labor-market character.',
    },

    /* ── Household composition / occupation / labor force ── */
    'Household composition, occupation': {
      why: 'The mix of married couples, single parents, living-alone, and occupation profile drives unit-mix decisions (1BR vs 2BR vs 3BR) and supportive-services design.',
      demand: 'High single-parent share means demand for 2-3BR units with childcare proximity. High living-alone share means 1BR / studio demand. A high current share of service-occupation workers signals 30-60% AMI cost-burden pressure today.',
      project: 'Household-type mix typically sets bedroom mix; occupation mix typically sets the AMI band — service workers fit 30-60% AMI; mid-tier office workers fit 60-80% AMI.',
    },

    /* ── Race & ethnicity ── */
    'Race & ethnicity': {
      why: 'Demographic composition matters for AFFH (Affirmatively Furthering Fair Housing) compliance and CHFA QAP "geographic distribution" scoring.',
      demand: 'Jurisdictions where past policy decisions (redlining, exclusionary zoning, urban renewal) concentrated cost burden on historically marginalized communities are where new affordable housing functions as repair — and where CHFA\'s AFFH and geographic-distribution scoring is most responsive.',
      project: 'The race/ethnicity profile feeds CHFA AFFH narratives. A project that serves a demographically representative tenant pool scores better on "community integration" and reduces fair-housing risk.',
    },

    /* ── Educational attainment ── */
    'Educational attainment': {
      why: 'Education profile predicts long-term income trajectory and informs supportive-services design (workforce training partnerships, etc).',
      demand: 'Lower Bachelor\'s+ share with high cost burden often points to a workforce concentrated in service, trade, and care occupations where current local wages have not kept pace with current local rents — durable affordable housing addresses today\'s cost-burden gap and reduces displacement risk while household incomes shift over time.',
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
      why: 'The composite housing need score and AMI-gap counts are among the clearest summaries of how many neighbors in this community are stretched thin on housing — and the kind of evidence CHFA looks for when reading the case for a project.',
      demand: 'A "high" overall need rating, paired with a multi-thousand-household gap at 30–50% AMI, is the kind of grounded "community need" story CHFA looks for. AMI-gap counts can be carried directly into a thoughtful application narrative.',
      project: 'Gap counts help us right-size a project to what the community actually needs ("80 homes against a 1,200-household gap at 30% AMI — addressing about 6.7% of that documented gap"). Proposals that match the community\'s own documented need tend to read well in CHFA review.',
    },

    /* ── Bedroom mix / household demand ── */
    'Bedroom': {
      why: 'Bedroom mix demand connects who actually lives in the community (single-parent households, families with kids, seniors) to the unit-mix choices a thoughtful project would make. A mix that doesn\'t match the community can leave homes harder to fill and the underlying need unmet.',
      demand: 'High demand for 2BR + 3BR homes means families and single-parent households are a large part of the community — and family-sized affordable homes are something CHFA\'s QAP particularly recognizes. Heavy 1BR demand points more to seniors and people living alone, a different community story.',
      project: 'A project\'s unit mix usually mirrors the community\'s own demand. A 60-home project with 40 1BR / 15 2BR / 5 3BR can feel out of step in a community where 2BR demand dominates — rebalancing to what the data shows is the straightforward fix.',
    },

    /* ── Affordability composite ── */
    'Affordability Composite': {
      why: 'The composite affordability ratio (income vs rent + home value vs income) is a single-number gauge of how stressed the local affordability picture is.',
      demand: 'Composite scores in the worst quartile indicate communities where market-rate solutions can\'t close the gap — only subsidized affordable housing can.',
      project: 'The composite ranking feeds CHFA application narratives. "Top 10% most-stressed in Colorado" is the kind of concrete language that scores in community-need sections.',
    },

    /* ── Special Needs ── */
    'Special Needs': {
      why: 'Senior, disability, and single-parent shares help us understand who in the community would most benefit from supportive-services-paired housing. These neighbors often need both deeper affordability and strong local service partnerships.',
      demand: 'A high share of residents aged 65+ together with a high disability share suggests concentrated demand for senior and supportive housing here. Deeper AMI bands (30–50%) often fit, since fixed-income seniors are among the most rent-burdened residents.',
      project: 'Thoughtful partnerships with local supportive-services providers (continuum of care, disability-services nonprofits) tend to be central to supportive-housing projects. CHFA and DOH-HHPG both recognize the value of housing paired with on-the-ground services.',
    },

    /* ── F198 — Second-batch callouts for the remaining ~30 sections ── */

    /* ── Household Income Distribution (ACS DP03 brackets) ── */
    'Household Income': {
      why: 'The income distribution shows how many households in the community fall in each AMI band — and by extension, the count of neighbors who would benefit from a home priced at each rent level.',
      demand: 'A community with 25%+ of households earning under 30% AMI but no deep-affordability LIHTC yet has documented unmet need at the lowest income tier. That is where supportive housing and 30% AMI homes do the most.',
      project: 'A project\'s AMI mix often mirrors the community\'s own income distribution. When 40% of local households are under 50% AMI, planning 40% of project homes at 30–50% AMI is a thoughtful match — and it lines up with the deeper-affordability emphasis in CHFA\'s QAP.',
    },

    /* ── How Affordable Has Housing Become Over Last 15 Years ── */
    'How Affordable Has Housing': {
      why: 'Looking at 15-year affordability trends shows whether the strain on residents is recent or has been building over time. CHFA\'s "documented community need" sections look at this kind of long-trend evidence carefully.',
      demand: 'When local rents rise 60%+ while incomes rise 25% over the same period, residents have been steadily losing ground — exactly the kind of long-term shift LIHTC was designed to help communities respond to.',
      project: 'The 15-year rent-to-income shift is a clear, plain-language way to describe the community\'s context. "Median rent rose 62% while median income rose 21%" tells a story CHFA underwriters can take seriously.',
    },

    /* ── Pace & Scale of New Housing Permits ── */
    'Pace & Scale of New Housing Permits': {
      why: 'Whether the community has been permitting enough homes to keep up with its own growing need is one of the clearest signals of where a partnership can help. Both CHFA and DOH look at this when reading the case for new construction.',
      demand: 'When the community\'s annual permitting is below its annual need-growth rate, the gap compounds. A five-year permit pace at half of need-growth means new construction is not catching up on its own — a real opening for a partnership project.',
      project: 'This gap often appears in CHFA application narratives: "the community has permitted X homes per year against a need of Y per year, so this project would close Z% of the annual shortfall." It is concrete and grounded in the community\'s own data.',
    },

    /* ── Age of Housing Stock ── */
    'Age of Housing Stock': {
      why: 'Older housing stock (pre-1960) often carries lead-paint, asbestos, and accessibility-retrofit considerations. It can also mean residents are living in homes with fewer modern features — and a thoughtful, well-built affordable project here would offer real improvement.',
      demand: 'When the community has a heavy share of pre-1960 stock and relatively little new construction, many residents are paying high rents for homes that need significant work. A newly-built affordable project is a meaningful upgrade.',
      project: 'A newly-built LIHTC project offers high-quality, accessible, energy-efficient homes that older stock often cannot. This is part of a project\'s story to CHFA on physical condition, ADA accessibility, and energy efficiency.',
    },

    /* ── Bedroom Mix ── */
    'Bedroom Mix': {
      why: 'The community\'s mix of 1BR / 2BR / 3BR / 4+BR homes shows who today\'s housing stock serves — and where the bedroom count does not match the community\'s actual households.',
      demand: 'When the community has a real undersupply of 3BR+ homes and a substantial share of family households with children, those families are too often crowded into homes that don\'t fit. Family-sized affordable homes here would meaningfully help.',
      project: 'Bedroom mix on a project usually fills the community\'s gap rather than duplicating its existing stock. A 60-home family project with 25 1BR / 20 2BR / 15 3BR addresses overcrowding directly — which CHFA\'s QAP also recognizes as a community-fit choice.',
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
      why: 'Wage distribution and dominant industries help us understand what AMI band the residents who would live in a new affordable project actually earn. Many service workers in resort communities, for example, cannot afford homes at 60% AMI but fit well at 30–50%.',
      demand: 'Heavy service-sector employment paired with a low median wage points to real affordability need at the 30–50% AMI band. Office-dominant communities tend to point more toward 60–80% AMI workforce housing.',
      project: 'A project\'s AMI mix usually mirrors the community\'s wage distribution. Resort towns often need 30–50% AMI homes; tech-dominant suburbs often need 60–80% AMI; mixed-economy cities are often well-served by a broad mix (30% / 50% / 60% / 80%) so the project fits a wider range of working residents.',
    },

    'Wage Distribution': {
      why: 'The wage distribution by percentile shows which workers in the community can afford which rents today. Cross-referenced against FMR, it makes plain who is currently being priced out.',
      demand: 'When the 50th-percentile wage cannot afford the 50th-percentile rent at the 30% rule, half the working community is rent-burdened. That is a clear, grounded affordability story.',
      project: 'A project\'s AMI mix is usually sized from the wage distribution. When 35% of workers earn under $30K, homes at 30–50% AMI fit. When 40% earn $40–60K, homes at 60–80% AMI fit. Designing for a single band can mean the project misses the broader community of working residents.',
    },

    'Top Industries': {
      why: 'Dominant industries help us understand job stability and wage trajectory in the community. Healthcare and government tend to be stable and growing; mining and manufacturing can be more volatile; hospitality is often lower-wage and seasonal.',
      demand: 'Hospitality-dominant communities tend to see high turnover and lower wages — and therefore a real need for workforce-priced homes. Healthcare-dominant communities often have steadier mid-tier earners who fit well in 60–80% AMI workforce homes.',
      project: 'Supportive services on a project are often tailored to the community\'s dominant industry — for example, partnerships with the local hospital where healthcare workers are central, or with the regional resort association where hospitality is. Employer partnerships of this kind are something both CHFA and Proposition 123 recognize.',
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
      project: 'Mixed-AMI projects (for example, 25% at 30% AMI, 35% at 50% AMI, and 40% at 60% AMI) can reflect documented wage gaps and show how the proposed affordability mix relates to the local economy under CHFA\'s QAP framework.',
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
      demand: 'A top-ranked lane is where public indicators show the clearest combination of documented need and feasible delivery conditions. A lower-ranked lane may still be appropriate, but it should be supported by local evidence not captured in the public data.',
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
      why: 'A type-by-type feasibility check (per-home cost, achievable rent, zoning, and basis boost) shows which housing approaches are most likely to be financeable in the selected community.',
      demand: 'In a high-cost community with strict zoning and a low FMR, projects that work financially tend to be deeply-subsidized 4% bond deals paired with state resources. A moderate-cost suburb with flexible zoning and a reasonable FMR more often opens the door to 9% LIHTC family homes.',
      project: 'This analysis helps shape the project type before the financing path is locked in. 9% LIHTC tends to fit moderate-cost communities; 4% bond + state resources tends to be needed in higher-cost communities with a full basis boost. Matching the project type to the community is one of the most important early choices.',
    },

    /* ── Colorado Market Conditions ── */
    'Colorado Market Conditions': {
      why: 'Statewide context — construction-cost trends, capital-market conditions, equity pricing — provides the broader frame around any local project.',
      demand: 'When statewide construction costs compound at 5–7% per year while local rents rise 2–3%, the gap between what residents can pay and what it costs to build widens — making deeper subsidy a more likely fit. Application cycles tend to track these conditions.',
      project: 'Statewide signals can inform closing-date decisions. Periods of higher costs and softer equity pricing tend to favor 4% bond + state + soft-funded deals; periods of lower costs and stronger equity tend to favor 9% competitive projects.',
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
