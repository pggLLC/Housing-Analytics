# COHO Housing Analytics — Site Audit Report

**Date:** June 4, 2026
**Author:** COHO engineering review

## Executive Summary

COHO Housing Analytics is a free, browser-based workbench that walks a developer through scoping a Colorado Low-Income Housing Tax Credit (LIHTC) deal — from picking a town all the way to a draft capital stack. Every figure on the site is pulled from a published list of roughly a dozen public sources — Census, HUD, the Colorado Department of Local Affairs (DOLA), the Colorado Housing and Finance Authority (CHFA), Federal Reserve, and a handful of named industry publishers — refreshed on each source's own cadence and labeled with publication dates so users can see exactly how current any number is. The math behind the seven headline metrics (Opportunity Score, Housing Needs Scorecard, Gap, Cost Burden, Market Capture Advantage, Deal Calculator pro forma, and Private Activity Bond allocation) runs in the open and is documented step by step; nothing is proprietary. About a dozen automated safety nets — described in detail in the reliability section below — surface broken sources and out-of-date files before users hit them. Reliability is high for federal-data-driven figures, medium for industry benchmarks between official refreshes, and low for any single small-place number used in isolation; the site is built to flag those weak spots out loud rather than hide them.

**Who runs it, who pays for it.** COHO Analytics is built and maintained by IndiBuild, a Colorado affordable-housing developer, as a small in-house effort (one to two engineers contributing alongside other work, not a dedicated team). Operating costs are absorbed by IndiBuild and consist mostly of hosting and data-pipeline compute — there is no subscription revenue and no advertising. Because IndiBuild is itself a developer that uses the public tool to triage Colorado markets, the same incentive that pushes us to keep the numbers honest also creates a potential conflict of interest, which we address in the governance notes below. Outputs are intended as indicative — useful for triage, market screening, and early committee conversations — not as audit-ready figures for a financing close. Lenders, syndicators, and CHFA underwriters should always confirm headline numbers against the primary source. A short terms-of-use and liability disclaimer is linked from the site footer.

## What the Site Does

COHO Analytics walks a developer through scoping a Colorado affordable housing tax credit deal — from picking a town all the way to a draft capital stack you can hand to your underwriter. A user can walk in with no project in mind and walk out with a target town, proof of the housing need there, a market screen on a specific site, a 20-year demand forecast, and a rough pro forma. The numbers come from the same sources Colorado's housing finance agency, the federal housing department, and the state's Department of Local Affairs already publish — we just put them in the order a deal actually gets built.

Think of it as the cockpit you sit in before you spend money on a market visit. Six numbered steps run across the top of every page. When you pick a town on one step, it carries forward, so you're not retyping "Pueblo County" into five different tools.

You start at the **Opportunity Finder**. This answers the targeting question: where in Colorado should I be looking for my next deal? It ranks roughly 150 Colorado places that qualify for the 30% federal basis boost — the bonus tax credit equity you earn for building in distressed or high-cost areas (the exact count refreshes when HUD updates its Qualified Census Tract and Difficult Development Area designations each fall). The ranking weighs recent funding history (has the state awarded credits here lately?), housing need, population size, and signs the town is ready to work with a developer, like whether it has an active comprehensive plan or a housing trust fund. You can re-tune the formula for a bond deal versus a competitive deal, since those two rounds reward very different markets. When a town catches your eye — Salida or Pueblo, say — one click locks it in as your active jurisdiction.

Next you size the need. The **Housing Needs Assessment** page pulls the evidence a council member or a state credit reader expects to see: how many local renter households are paying too much of their income for rent, where the gaps sit by income tier, what's already in the affordable housing pipeline, and how local wages actually break down. The data is real, drawn from federal affordability tables, the Census Bureau's annual community survey, and federal commute data. We pull it at the place level when we can, not just county averages. For a 60-unit deal in Pueblo, this page tells you whether you're chasing 50% Area Median Income (AMI) renters paying over half their income to rent, or 80% AMI workforce households priced out of homeownership.

Then you screen the site. **Market Analysis** lets you drop a pin on the map and set a buffer around it. The page scores that site on vacancy, the density of renters who would qualify, commute patterns, school access, and competing affordable supply within walking distance. It's the early screen that tells you whether to spend money on the formal market study the state requires, or move on.

The **Scenario Builder** projects 20 years forward. It walks each age cohort through baseline, low-growth, and high-growth pictures of how the renter pool will change. Useful when a council member asks whether the project will still pencil in 2040 — you have an answer beyond a shrug.

The **Deal Calculator** closes the loop. This is where the tax credit pro forma lives. Enter unit count, the mix of income tiers you're targeting, and the bedroom mix. The tool pulls the federal rent ceilings for your county, sizes the tax credit equity, layers in soft debt and gap financing, and runs a 30-year cash flow with reserves and a Year-15 exit. For Pueblo it surfaces an illustrative 60% AMI two-bedroom rent ceiling — drawn directly from the current HUD income-limit table published each April — and shows you what hard debt that rent supports at a 1.20x debt service coverage ratio.

Around that main flow sit three side tools. **Compare** puts two to six towns next to each other across every Opportunity Finder dimension — useful when a board is choosing between Grand Junction and Montrose. **Colorado Deep Dive** is a county-level overview map for context. The **Economic Dashboard** tracks the macro numbers that move tax credit equity pricing and your permanent debt: Treasury yields, inflation, construction cost indexes.

The **Insights** and **News** pages are reading material. Market Insights is our team's written commentary. Housing News (the page formerly called Policy Briefs) is a machine-summarized feed of Colorado housing headlines, clearly labeled as such so nobody quotes it without clicking through to the original. The **Data** pages — Data Review Hub and Data Explorer — show our work. Every file we use, when it was published, when we last refreshed it, and how much of Colorado it actually covers. If a reader doubts a number, they can click straight to the raw file.

Two pages are internal-only and password-protected for IndiBuild staff. "Where Should I Build?" sorts every Colorado jurisdiction into Tier 1, 2, and 3 build candidates through a developer's lens — it uses the same public Opportunity Score as a starting input but layers on IndiBuild's own build-cost assumptions, internal capacity, and target IRR thresholds that have no place on a public site. Because that internal page is read only by IndiBuild and never feeds back into the public scores or rankings, it does not influence what an outside developer sees. The internal Pipeline runs the firm's working list of live opportunities. Access to both is restricted by individual login, not a shared password, and the pages do not collect or store user inputs from the public site.

Developers are the primary audience and use the full six-step flow to triage a market before booking a site visit. Housing authorities use the Needs Assessment and Compare pages to defend project priorities to their boards. City staff and planners pull the same evidence into housing element updates and grant narratives. Lenders and equity investors check the rent ceilings, basis boost designations, and pipeline competition before pricing a deal. Council members get a one-page answer to "why are we approving this project here and not that one over there" — without having to read a 60-page market study.

## Where the Data Comes From

We don't make up any of the numbers on this site. Every figure comes from a published list of roughly a dozen government and industry sources — the same reports a LIHTC underwriter or a HUD compliance officer pulls before they sharpen a pencil on a new deal. The full source list with publisher URLs lives on the Data Review Hub. We download each one, line them up against each other, and refresh on its own schedule so what you see when the page loads is as current as the source itself.

### Population and household data (federal)

Everything starts with the Census Bureau's American Community Survey — the ACS. For every Colorado town and county it tells us how many households earn under $30,000, how many spend more than half their paycheck on rent, who owns versus rents, what they pay today, and what they could afford. We use the longer five-year sample because small towns like Silt or Buena Vista are too thin in the single-year sample to trust.

Built on top of the ACS is HUD's Comprehensive Housing Affordability Strategy file — CHAS. CHAS takes the same Census survey responses and sorts households by income tier against rent paid, broken into the Area Median Income (AMI) bands every affordable deal uses: under 30 percent, 31 to 50, 51 to 80, 81 to 100, and above 100. The current release covers 2018 to 2022. As one illustrative figure HUD publishes, roughly 165,000 Colorado renter households earn under 30 percent of AMI and the large majority of them are paying more than they can afford; the exact counts as currently published by HUD appear next to the figure on each page.

The third federal piece is the Opportunity Zone map — roughly 1,450 Colorado census tracts the U.S. Treasury locked in back in 2018 where investors can defer capital-gains tax (the precise count is published by the Treasury CDFI Fund and shown next to the figure on the site). These designations don't expire, so we only update if Treasury redraws the map.

### LIHTC program data (federal)

Every April, HUD publishes new rent and income ceilings for tax-credit deals. These are the maximum rents a LIHTC project is allowed to charge. The 60-percent-AMI rent caps used throughout the site are pulled directly from that HUD table each April, with the county lookup and publication date visible next to every figure.

HUD also publishes the two basis-boost maps that move equity in 9 percent deals: Difficult Development Areas (DDAs) and Qualified Census Tracts (QCTs). If your land sits inside either one, your eligible LIHTC basis goes up 30 percent — real money in the capital stack. HUD redesignates both every fall and we refresh accordingly.

### Colorado state data

The Colorado Housing Finance Authority (CHFA) keeps the live registry of every tax-credit property in the state — the exact active-project count is read each Sunday from their public mapping service and shown on the Data Review Hub. CHFA also publishes the preservation pipeline of properties approaching their year-15 exit or year-30 use-restriction expiration, and we refresh that monthly.

The State Demography Office at the Colorado Department of Local Affairs (DOLA) puts out long-range population forecasts by county and town. DOLA also publishes the annual Private Activity Bond allocation table — the tax-exempt bond authority Colorado gets each year that fuels 4 percent LIHTC deals. The 2025 statewide cap as published by DOLA is on the order of $760 million, with Denver receiving roughly $47 million in direct cap and CHFA's statewide pool holding roughly $375 million; the exact figures on the site are pulled from the DOLA allocation table and dated. We refresh the bond allocations every spring.

### Industry research

Five industry publishers fill in what the federal data can't see. Specific figures cited below are taken from each publisher's most recent release at the time of writing and may have moved since; the live site always shows the source publication date next to the number.

- **Yardi Matrix** puts out a free monthly National Multifamily Report. The most recent issue at the time of writing showed Denver rent growth in the low-single-digit range and occupancy in the mid-90s; the live page cites the specific report month.
- **Freddie Mac's** quarterly Multifamily Outlook tracks the lending environment — recent issues have shown permanent loan rates for stabilized affordable deals in the high-5s and workforce LIHTC cap rates in the high-6s nationally, with the specific Freddie Mac quarter cited on the page.
- **Novogradac's** monthly equity pricing survey shows what investors are paying per dollar of credit; recent Novogradac surveys have shown 9 percent Denver pricing in the mid-$0.80s, with rural Colorado a few cents lower. The exact monthly figure and the Novogradac issue date are shown alongside the number.
- **Harvard's Joint Center for Housing Studies** publishes the State of the Nation's Housing every June. It's the national yardstick we measure Colorado against — the most recent edition reports that roughly half of U.S. renters now spend more than they can afford on rent; the exact share and the report year are cited on the page.
- The **National Low Income Housing Coalition's** annual Out of Reach report gives us the "housing wage" — what someone working full-time needs to earn to afford a two-bedroom without busting their budget. NLIHC's most recent Colorado housing wage is in the high-$30s per hour against a median renter wage in the low-$20s, leaving a roughly $15-per-hour gap. The exact figures and NLIHC report year appear on the page.

### Live market feeds

For the numbers that move week to week, we pull from live feeds instead of caching files. Zillow's Observed Rent Index updates monthly by ZIP code. The Bureau of Labor Statistics refreshes county-level unemployment and 5-year job growth every month. Apartment List puts out a new Rent Estimate each month. These are the figures that can drift between LIHTC application cycles, so we read them live rather than freezing a snapshot from six months ago.

### How fresh is the data

Two things worth knowing.

First, most federal data runs one to two years behind. The 2020-2024 ACS came out in late 2025, the 2018-2022 CHAS landed in 2024, and HUD's 2025 income limits dropped in April 2025. That lag is the cost of doing business — every underwriter in the country works with the same delay.

Second, the things that *can* refresh quickly, do. CHFA's project list updates weekly. Yardi, Novogradac, Zillow, BLS, and Apartment List update monthly. HUD income and rent limits arrive every April. Every number on the site shows its publication date right next to it, so you can see exactly how recent it is. And our automated link checker scans every external source URL the site cites — a list of several hundred, published in full on the Data Review Hub — every week to make sure the original publisher hasn't moved or pulled the file. If a source breaks, we know before you do.

## How the Numbers Are Computed

Knowing where the data comes from is only half the picture. The other half is what we do with it. Every figure on this site comes from public data — Census, HUD, DOLA, CHFA, Federal Reserve. We pull the latest published version of each file, run the math in the open, and show our work. Nothing is proprietary. If a number on screen doesn't match what you'd get by hand from the same source, that's a bug we want to hear about.

The math behind each headline metric has been reviewed informally against industry practice by housing-finance practitioners we work with, but the Deal Calculator has not been formally signed off by an independent CHFA underwriter, CPA, or syndicator. We disclose this on the calculator page and treat its output as illustrative.

Here is what each of the seven headline metrics actually means.

### 1. The Opportunity Score

The Opportunity Score ranks every Colorado city, town, and unincorporated place on a 0–100 scale, answering one question: where does a LIHTC deal most deserve a developer's attention?

Five things go into it. How much housing need is there. How long since the jurisdiction last won a LIHTC award. Whether the place sits inside a Qualified Census Tract or Difficult Development Area, which unlocks a 30% basis boost. Whether the population is large enough to lease up the project. And whether the local government is ready to actually do the deal — Prop 123 commitment, housing lead, comprehensive plan, housing authority.

How much each of those matters depends on the type of deal you're chasing. For a 9% competitive deal — where you're fighting other developers for a scarce CHFA allocation — housing need matters most, because CHFA's Qualified Allocation Plan rewards deals that serve the deepest need. Time since the last award and civic readiness come next. For a 4% bond deal, the math flips. Bond deals carry fixed transaction costs that only pencil at 100+ units, so population and feasibility move to the front and competition recency drops back. Unincorporated places (Census-Designated Places, or CDPs) take a small penalty on most deal types, because someone in the county still has to issue the permits, write the bonds, and hold the hearing. That's friction the score has to credit.

So Crested Butte and Cortez may both score 78, but for different reasons, and the "why" is shown alongside the number. When the formula itself changes — say a weight is re-tuned or a new readiness signal is added — the Data Review Hub posts a dated change note so any user who saved a prior ranking can see what moved and why.

### 2. The Housing Needs Scorecard

The Scorecard reduces a county's housing stress to one number out of 100. It does this by ranking each county against every other Colorado county on four signals: blended cost burden (renters and owners together), the share of renters who are extremely low income, an affordability pressure index (how far market rents have outpaced local wages), and worst-case need (renters paying 50%+ of income on housing). Each signal contributes up to 25 points based on where the county sits in the statewide ranking.

A score of 75 means "in the toughest quarter of Colorado on most measures." A score of 30 means "rest of the state has it harder." Pueblo County tends to land in the high-stress quartile because of high cost burden and deep need; Douglas County tends to land in the low-stress quartile because higher incomes absorb the rent. Ranking against peers, instead of against an absolute threshold, is deliberate: it stops resort-town outliers like Aspen from drowning out the rest of the state.

### 3. The Gap

When the site says "Pueblo needs 4,200 more units affordable to households below 60% AMI," that number comes from HUD's CHAS data (basically HUD's deeper cut of Census survey data on who can afford what). For each income tier — 30%, 50%, 60%, 80% AMI — we count the renter households at or below that income, work out the rent they can afford (30% of their income), then count how many existing rentals actually price at or below that ceiling. The difference is the gap.

Two honest caveats. The count uses HUD's 2018–2022 release, so it lags by one to three years. And for small towns we apportion the county number by household share rather than measuring the town directly — Census privacy rules suppress small-area data.

### 4. Cost Burden

"Cost-burdened" means a household pays more than 30% of its gross income on rent and utilities (or principal, interest, taxes, and insurance for owners). "Severely cost-burdened" is 50% or more. These thresholds aren't ours; they come from HUD's longstanding definition, which housing scholars trace back to mid-twentieth-century federal housing law. Above 30%, a typical household has no discretionary budget left for groceries, childcare, transportation, or savings. Above 50%, one car repair triggers a missed rent payment. That's why the lines sit where they do — and why HUD's Worst Case Housing Needs reports use the same cutoffs.

In Pueblo, the share of cost-burdened renters tends to land in the mid-to-high 40s, with severely cost-burdened renters in the low 20s — the population at acute eviction risk. The exact figures from the current CHAS release are shown on the Pueblo page.

### 5. Market Capture Advantage

This answers a single underwriting question: will your deal pencil at the LIHTC rent ceiling, or will the ceiling come in below market?

For each county, we take HUD's Fair Market Rent for a 2-bedroom — which sits at the 40th percentile of the local market — and compare it to the maximum rent a deal targeting households at 60% AMI is allowed to charge. The cap comes from the standard LIHTC formula: 30% of the HUD income limit for that household size. We subtract one from the other.

A positive number means the LIHTC ceiling sits below market — the deal has room and tenants will line up. In a market like Mesa County, the Fair Market Rent is typically a few hundred dollars above the 60% AMI 2BR cap, so the advantage is comfortably positive and the deal pencils; the exact HUD figures and the difference are shown on the county page. In a soft market like Las Animas County, the gap can flip negative, which means a 60% AMI deal would have to charge what the open market is already charging. That kills lease-up.

### 6. Deal Calculator Pro Forma

The Deal Calculator takes the inputs you'd write on a napkin — total development cost, unit count, unit mix by AMI tier, soft debt from local sources, equity price per credit dollar — and tells you whether the financing closes.

It starts by working out annual rents from the unit mix, using HUD income limits for the relevant county (with a market-rent cap on workforce tiers if you ask it to). It subtracts operating expenses and reserves to get net operating income, then sizes the first mortgage so debt service is covered 1.20 times over. Next, it works out LIHTC equity from eligible basis (with the 30% basis boost if you're in a Qualified Census Tract or Difficult Development Area), priced at the credit rate and equity price you entered. It adds your soft sources and your developer fee deferral. Then it tells you the gap.

If sources cover uses, the deal is balanced. If there's a shortfall, the calculator shows you exactly how much you need to find — and which levers (more soft debt, higher rents, deferred fee, deeper income targeting for a basis boost) would close it.

### 7. Private Activity Bond Allocation

Four-percent LIHTC deals require tax-exempt bonds, and tax-exempt bonds require a piece of the Private Activity Bond (PAB) volume cap — a federal ceiling on how much tax-exempt debt each state can issue every year. Colorado's most recent annual cap as published by DOLA is on the order of $760 million. About half of that goes directly to several dozen designated local issuers (with Denver, Boulder County, and other large jurisdictions getting the biggest pieces), handed out on a per-resident basis under the formula DOLA publishes. The rest sits in a CHFA-managed statewide pool that funds the bulk of 4% deals. Specific local allocations and the per-resident figure on the site are taken directly from the DOLA allocation table and dated.

When you click on a jurisdiction and see Denver's direct allocation plus access to the CHFA statewide pool, it's worth understanding that the local number is mostly used for single-family bond programs, mortgage credit certificates, and county industrial development bonds, not multifamily. The statewide CHFA pool is where almost every 4% deal in Colorado actually draws. We surface both so you can see the full picture, with a note that the local cap is rarely the binding constraint. A coming federal change in the bond-financing test is widely expected to reduce the threshold for projects placed in service after the end of 2025 — we link to the statute and current Treasury guidance on the page; treat the exact mechanics as still firming up.

### Honest Limits

- **Small-place data is thin.** For towns under 200 households, HUD and Census suppress detail to protect privacy. We fall back to the parent county and flag it. A "Crowley County" score applied to Olney Springs is approximate, not direct measurement.
- **Census surveys lag.** ACS 5-year and CHAS are published 12–18 months after their reference period. A 2026 score uses 2018–2022 cost burden. We refresh when HUD publishes; we don't claim more freshness than the source has.
- **Cost burden and actual housing distress are correlated, not identical.** A retired homeowner with no mortgage and $1,500/month Social Security shows up as severely cost-burdened on paper. The number is directionally right but flattens real-world variation.
- **The basis-boost score is binary.** A jurisdiction either has a QCT/DDA tract or it doesn't — we don't credit "almost qualifying" tracts that may flip in next year's HUD designation cycle.
- **CHFA award probability is approximated, not modeled.** We surface recency of last award as a proxy for CHFA's geographic-distribution scoring. A real CHFA underwriter also looks at scoring tie-breakers, sponsor capacity, and politics we don't capture.
- **The Deal Calculator does not size construction debt or capture investor preferences.** It produces a stylized capital stack to test feasibility. Real deal financing requires a CPA, a CHFA reviewer, and a syndicator — all of whom will refine these numbers.

## How Reliable Is It

Open math and honest limits are only worth as much as the operations around them. The short answer on reliability: the platform is built so problems get **caught and shown**, not hidden. We assume something will break — a federal data feed will go dark, a city will redesign its housing page, a number will go out of date — and we'd rather flag it out loud than quietly serve you a wrong answer.

**What runs automatically.** A stack of automated checks runs on a schedule, with no one pressing a button. There are roughly a dozen of these; the full list lives on the Data Review Hub, and the major ones are:

- An automated test suite that runs whenever the site is updated, confirming the critical pages still load and the Deal Calculator and Opportunity Finder still have the data files they need.
- A nightly diagnostic at 2am Mountain that sweeps data coverage across every Colorado place and county and flags any sudden gaps — for instance if we lost the curated employer roster for a non-tiny county.
- A weekly Monday sweep that re-tests every external link the site cites (city housing pages, state agency forms, federal data portals) to confirm they still resolve, and a second weekly sweep that checks the major upstream publishers (HUD, Census) for newer release dates.
- A daily check that compares every key file against its expected refresh date and flags anything that has fallen out of date.

When a link breaks, a refresh is due, or a publisher releases a newer year of data, the system records the issue on an internal tracker so the team picks it up instead of waiting for a user to stumble on it.

**How we know if data goes out of date.** Every number on the site is labeled with three dates: the year of the underlying federal survey, when our copy was last refreshed, and when the upstream publisher last updated. This matters because housing data lags reality. The 2020-2024 ACS is currently our best read on household income in any Colorado place, but it reflects the average of 2020 through 2024, so it lags current conditions by roughly a year. Showing all three dates gets us two things. First, when a federal publisher releases a new year of data — say, Census drops the 2021-2025 ACS in late 2026 — the weekly check catches it and the team queues a refresh. Second, if a source goes dark or starts returning errors, the daily check catches it the same day. You can see all of this live on the Data Health page (linked from the footer): every dataset, when the publisher posted it, when we copied it in, what share of Colorado places and counties it covers, and a simple current/aging/out-of-date indicator.

**What we've fixed recently.** Recent updates show a healthy pattern: a steady stream of small, specific fixes. A few examples — a bug where the Opportunity Finder was silently substituting county-level need numbers when a place lacked its own (now fixed and audited site-wide); an ACS release-year mix-up where some pages still cited the older release after we'd upgraded to the newer one (swept and corrected); a Deal Calculator display bug where the place-level rent number occasionally appeared before the HUD rent ceilings finished loading; an inconsistency in the affordable-supply count for Primary Market Area lookups; a batch of dark-mode contrast fixes for users with vision-accessibility needs. None of these are dramatic. They're the kind of small corrections you see on a site that's actively used and watched. A neglected site doesn't produce this many small fixes — it produces silent wrong answers.

**What's honestly still risky.** Three things to keep in mind when you're staring at a number on the screen:

- **Small-place margins of error.** The federal surveys we rely on for income, rent burden, and tenure (ACS, CHAS) have wide confidence intervals when the population is small. For a town of a few thousand households, the reported renter share can be several percentage points off in either direction (the Census Bureau publishes the exact margin of error alongside each estimate, and we surface it on the place page). We flag places under our confidence threshold with a small-sample warning badge, but a casual reader who jumps straight to the headline number can miss it. Triangulate with a neighboring jurisdiction or the county aggregate before you bet a deal on a single small-place stat.
- **Annual-lag publishers.** Some of our most important sources publish only once a year, and at a substantial lag. HUD's CHAS data — the source for our AMI-tier gap analysis — is currently the 2018–2022 release, the freshest HUD has put out, and matches the CHAS release year cited elsewhere in this report. State Private Activity Bond allocations refresh annually after DOLA posts. Our numbers can lag what's actually happening on the ground by roughly a year. For a market that hasn't shifted dramatically (most of rural Colorado), that's fine. For a market that's moving fast (Denver metro, mountain resort towns), pair our numbers with a current broker check.
- **Industry research benchmarks.** Figures from Yardi (rent indices), Novogradac (LIHTC equity pricing), and Harvard's Joint Center for Housing Studies are best-effort directional estimates between official refreshes. They're useful for sanity-checking trends, but for an investment committee memo, cite the primary source directly and confirm the current number.

**Overall reliability:** high for federal-data-driven figures (rent ceilings, income limits, demographics, LIHTC project locations); medium for industry benchmarks between official refreshes; low for any single small-place number used in isolation — always triangulate.

## Governance, Security, and Operations

A board reviewing a public-facing analytics site will want plain answers on the items below.

- **Who runs it.** IndiBuild's engineering side maintains the site — one to two engineers contributing as part of their broader work, with subject-matter review from IndiBuild's housing-development team. There is no separate non-profit, foundation, or vendor between the developer and the site. The named maintainer for issue reports is listed in the site footer.
- **Funding and conflict of interest.** Hosting and data-pipeline costs are paid by IndiBuild and currently run in the low-thousands-of-dollars-per-month range. Because IndiBuild is itself a Colorado developer that uses the same public data to evaluate markets, every public output (Opportunity Score, Scorecard, Gap, etc.) is computed identically for every user — the internal "Where Should I Build?" page is read-only by IndiBuild and does not change anything an outside developer sees. The board should still treat the internal Tier 1/2/3 page as a conflict-of-interest item to revisit if the public site ever begins to drive deal flow at scale.
- **Security and privacy.** The public site does not require an account and does not store user-entered site addresses, deal assumptions, or pipeline data after the browser session ends — all calculation happens in the page and inputs are not transmitted to a server-side database. The two internal-only pages are gated by per-user logins (not a shared password) over HTTPS, and only IndiBuild staff have credentials. A short security and data-handling note is linked from the footer.
- **Usage.** Site traffic is currently in the low-thousands of unique visitors per month, with the heaviest concentration around CHFA application windows. We have not yet instrumented per-audience usage (developer vs. housing authority vs. lender), and the "primary audience" descriptions above reflect our intended users rather than measured shares.
- **Track record.** The tool has been used by IndiBuild's own pipeline and by a handful of external developers and housing authorities we work with; we are not yet in a position to publish a list of closed deals attributable to the tool. We expect to add anonymized case studies as users opt in.
- **How we compare to paid tools.** COHO Analytics is not a replacement for CoStar, CoreLogic, or Novogradac's premium products. Those tools carry proprietary rent and sales comparables, broker-fed lease-up timelines, and national equity-pricing depth we cannot match. Where COHO differs is on focus and price: the site is Colorado-specific, organized around the LIHTC deal flow, free, and shows its math.
- **Outputs and disclaimer.** Outputs are indicative — useful for triage, market screening, and early committee conversations — and are not audit-ready. A terms-of-use and liability disclaimer is linked from the site footer; users should rely on the formal CHFA, lender, and syndicator review before any financing close.
- **Uptime.** We do not currently publish a formal service-level agreement. In practice the site has been broadly available on a normal commercial-hosting baseline, with the Data Health page showing dataset status independent of front-end uptime. Major outages are flagged on the same page with a recovery estimate.
- **Where this goes next.** Over the next twelve months the funded roadmap is incremental — keeping data fresh as new HUD, ACS, and CHFA releases land; tightening the Deal Calculator with feedback from practitioner reviewers; and instrumenting basic usage. Larger items (a richer Scenario Builder, a public API, expansion beyond Colorado) are on a wishlist that depends on whether outside funding or a partner emerges.

## Bottom Line

COHO Housing Analytics is a transparent, source-driven workbench that compresses the first two weeks of LIHTC deal scoping — market targeting, need documentation, site screening, demand forecasting, and capital stack drafting — into a single guided flow built on the same federal, state, and industry data an underwriter would pull anyway. The math is open and documented, every number is labeled with its publication date, and roughly a dozen automated safety nets run in the background to catch broken links, out-of-date files, and missing data before users do. The honest caveats are real and remain on the screen: small-place statistics carry wide margins of error, federal releases lag the ground by roughly a year, industry benchmarks are directional between refreshes, and the Deal Calculator produces a stylized capital stack rather than a financeable one. Used as designed — federal-driven figures trusted at face value, small-place numbers triangulated against the county, industry benchmarks confirmed against the primary source before they leave the building — it is a reliable triage tool that gets a developer, lender, or council member to a defensible answer faster and cheaper than the status quo, without pretending to replace the formal market study, the CPA, the CHFA reviewer, or the syndicator who close the deal.
