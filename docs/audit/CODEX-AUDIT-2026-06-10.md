# Codex Audit - 2026-06-10

Independent audit of `pggLLC/Housing-Analytics` at main `5e221002` as described in the audit brief.

Sources checked:
- Local repo files listed in the audit scope.
- CHFA current QAP page and the [2025-26 QAP Second Amendment PDF](https://www.chfainfo.com/getattachment/7535845e-c0fa-4061-9bcb-60d7158ea294/2025-2026-QAP-Second-Amendment.pdf), adopted September 26, 2025 and approved November 13, 2025.
- OMB [Bulletin No. 23-01](https://bidenwhitehouse.archives.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf), July 21, 2023, for current county-based metropolitan delineations.

No code edits were made.

## Executive Summary

The most important public-surface issue is that several pages still present the site as "COHO Analytics" or speak as if a platform or organization is guiding the user. That conflicts with the current brief: this is an open public-data reference, not a company website. The homepage and the public pipeline page carry the highest-priority voice fixes.

The Opportunity Finder's 4% scoring is directionally understandable but overweighted toward population at the exact margin the audit brief identifies. Rifle and New Castle have the same regional 4% recency pressure and similar geography; New Castle's stronger need and longer place-level gap are not enough to overcome Rifle's population score. Recommendation: reduce 4% `pop` from `0.30` to `0.20`, increase `need` to `0.30`, and increase `recency` to `0.17`.

The CHFA rural filter is not aligned to the current QAP framing. The current QAP does not appear to include a "rural set-aside" or Appendix 4 test; it gives five secondary-selection points for projects in non-metro counties with population of 180,000 or fewer. Under current OMB metro delineations, the hardcoded "urban" list misses Clear Creek, Elbert, Gilpin, Park, and Teller counties.

## Priority 1 - Voice & Tone Consistency

### Finding 1 - Public homepage still names COHO as the product/brand

- File: `index.html:8-11`, `index.html:45`, `index.html:444`
- Current text:
  - `<title>COHO Analytics | Colorado Affordable Housing Platform</title>`
  - `<meta name="description" content="COHO Analytics guides developers...">`
  - `COHO Analytics · A Colorado Housing Tax Credit Educational Guide`
  - `COHO is built on federal raw data...`
- What's wrong: Public-facing copy names a product/organization and uses "guides developers" company-platform language. The brief says no private organization should be named or implied.
- Suggested fix:
  - Title: `Colorado Affordable Housing Data Reference`
  - Description: `A public-data reference for Colorado affordable housing: housing needs assessment, CHFA Housing Tax Credit context, market analysis, scenario planning, and deal-calculator methodology.`
  - Eyebrow: `Colorado Housing Tax Credit Educational Guide`
  - Research-source intro: `This reference draws from federal raw data (Census ACS/CHAS, HUD FMR/AMI, BLS LODES) and a curated layer of housing research commonly cited in affordable-housing planning and finance. Each source below links to the current authoritative reference.`

### Finding 2 - Homepage still speaks directly to "you/your" and frames a deal-targeting cockpit

- File: `index.html:155-194`, `index.html:202-250`, `index.html:297-311`
- Current text:
  - `Know your jurisdiction?`
  - `Start your analysis`
  - `Where in Colorado should you spend scarce time looking for the next deal?`
  - `The deal-targeting cockpit before you commit to a jurisdiction.`
  - `understanding what CHFA awards points for in their Qualified Allocation Plan.`
- What's wrong: Second-person workflow copy is product-like and developer-directed; "deal-targeting cockpit" and "awards points" are outside the expected public-reference voice.
- Suggested fix:
  - `Know your jurisdiction?` -> `Jurisdiction selected?`
  - `Start your analysis` -> `Start with a jurisdiction`
  - Opportunity Finder paragraph:
    `Compare Colorado jurisdictions with QCT or DDA designations using public indicators: recent CHFA investment, housing need, basis-boost eligibility, population scale, and civic-capacity context. The weights can be viewed by 4% bond or 9% competitive path so readers can see how the same public facts change under different financing structures.`
  - First-time developer paragraph:
    `LIHTC development is a multi-year, multi-party process with specific technical requirements at each stage. This reference explains the public workflow from documenting community need and defining a Primary Market Area to understanding how CHFA's QAP evaluates complete applications.`

### Finding 3 - Homepage comment text contains first-person "we're falling behind"

- File: `index.html:408-412`
- Current text:
  - `This is the "we're falling behind by X / year" number.`
- What's wrong: It is in a comment, not rendered public copy, but it contradicts the tone sweep and is easy to leak into future text.
- Suggested fix:
  - `This is the annual shortfall-growth estimate: new <=60%-AMI households per year minus recent LIHTC and preservation production.`

### Finding 4 - Public pipeline HTML shell uses first-person plural and COHO title

- File: `indibuild-pipeline-public.html:8-11`
- Current text:
  - `From a neighbor's struggle to a home that fits ... | COHO Analytics`
  - `The eight-step path we walk with our partners...`
- What's wrong: Public metadata names COHO and uses first-person partnership language.
- Suggested fix:
  - Title: `How Affordable Housing Gets Built in Colorado | Public Data Reference`
  - Description: `An eight-step public-data reference for how Colorado affordable housing moves from documented community need to homes residents can afford, with sources named for review.`
  - OG title: `How Affordable Housing Gets Built in Colorado`
  - OG description: `An eight-step public-data reference for Colorado affordable housing, written in plain language with each source named.`

### Finding 5 - Public pipeline JSON still names COHO-controlled sources

- File: `data/indibuild/pipeline-content.json:146-148`, `data/indibuild/pipeline-content.json:231-234`, `data/indibuild/pipeline-content.json:257`
- Current text:
  - `COHO local-resources directory`
  - `COHO capital partner roster`
  - `COHO tax abatement inventory`
- What's wrong: This JSON renders into the public pipeline page. Internal path names are acceptable; rendered labels should not imply a private organization.
- Suggested fix:
  - `COHO local-resources directory` -> `Local-resources directory`
  - `COHO capital partner roster` -> `Capital partner reference list`
  - `COHO tax abatement inventory` -> `Tax abatement and fee-waiver reference`

### Finding 6 - Public pipeline still uses "watch-outs", "opportunity buckets", and private-workspace framing

- File: `data/indibuild/pipeline-content.json:21-27`, `data/indibuild/pipeline-content.json:33-36`, `data/indibuild/pipeline-content.json:182-183`, `data/indibuild/pipeline-content.json:322-329`
- Current text:
  - `watch-outs`
  - `Opportunity buckets`
  - `A common way practitioners group jurisdictions when deciding where to focus capital and staff.`
  - `Those assignments live in private developer workspaces.`
- What's wrong: "Opportunity buckets" and "where to focus capital and staff" read like internal deal-screening. "Private developer workspaces" implies a private operator behind the public site.
- Suggested fix:
  - `watch-outs` -> `limits to keep in mind`
  - `Opportunity buckets` -> `Readiness categories`
  - Stat subtext:
    `A neutral way to describe where a community may be in its own affordable-housing planning cycle.`
  - `does_not_tell_you`:
    `Which jurisdictions specifically fall into each category today. Public reference pages should describe the criteria without publishing current classifications for named communities.`
  - `what_stays_private` item:
    `Specific jurisdiction A/B/C/D assignments used in any private planning process`

### Finding 7 - Opportunity Finder metadata uses "target" and "Rank" language

- File: `lihtc-opportunity-finder.html:8-11`
- Current text:
  - `Rank Colorado jurisdictions...`
  - `Target Colorado jurisdictions...`
- What's wrong: "Rank" and "target" are explicitly in the audit concern set. They imply the site is sorting communities for developer pursuit rather than presenting public data.
- Suggested fix:
  - Title: `LIHTC Opportunity Finder | Colorado Public Data Reference`
  - Description: `Compare Colorado jurisdictions with QCT or DDA designations for 4% bond and 9% competitive LIHTC contexts using public indicators: recent CHFA investment, housing need, basis-boost eligibility, and population scale.`
  - OG title: `LIHTC Opportunity Finder | Colorado Public Data Reference`
  - OG description: `Compare Colorado jurisdictions by public LIHTC planning indicators, with source context for each measure.`

### Finding 8 - HNA page still uses first-person "we/our" and second-person checklist copy

- File: `housing-needs-assessment.html:617-629`, `housing-needs-assessment.html:1402-1430`, `housing-needs-assessment.html:1901-1998`
- Current text:
  - `Why HUD income limits and not CHFA's published tables?`
  - `Why we read HUD MTSP directly`
  - `We can ingest HUD daily; CHFA we'd have to scrape.`
  - `our numbers should match CHFA's published tables`
  - `Track your jurisdiction's...`
  - `Check items as your jurisdiction completes them.`
- What's wrong: First-person plural and direct user task language remain on a public page.
- Suggested fix:
  - Summary heading: `Why use HUD MTSP income limits?`
  - Bullets:
    `HUD MTSP is the upstream authoritative source. CHFA's tables are derived from HUD's published MTSP numbers using the same IRC Section 42 formula.`
    `HUD publishes machine-readable data. CHFA publishes annual tables for compliance reference.`
    `Computing from MTSP makes the rent-ceiling formula visible while preserving CHFA's published tables as the binding application reference.`
  - Application paragraph:
    `For CHFA application submissions, calculated limits should be checked against CHFA's published tables. If a discrepancy appears, CHFA's published tables are the binding reference.`
  - Checklist intro:
    `Prop 123 (HB 22-1093) compliance steps for the selected jurisdiction. Checked items are saved locally by geography.`
  - Action-plan intro:
    `Strategic actions commonly used to address documented housing needs. Checked items are saved locally by geography.`

### Finding 9 - HNA developer-context callouts still contain "our", "us", rewards language, and market-fighting phrasing

- File: `js/hna/hna-dev-context.js:50-52`, `js/hna/hna-dev-context.js:303-307`, `js/hna/hna-dev-context.js:337-341`, `js/hna/hna-dev-context.js:351-355`
- Current text:
  - `In our underwriting we usually look first...`
  - `CHFA QAP rewards proposals...`
  - `where projects face the LEAST competition and the MOST demand`
  - `fighting the data`
  - `helps us understand...`
- What's wrong: This is public-rendered HNA explanatory text. It still contains first-person voice and "rewards" / competitive framing.
- Suggested fix:
  - `project` at lines 50-52:
    `For planning, 50-60% AMI rents are often reviewed first because they anchor the project budget. When the 60% AMI rent ceiling is well below local rents, a project may also be able to serve residents at 30-40% AMI, consistent with CHFA's QAP framework for deeper affordability.`
  - `Wage Gaps.project`:
    `Mixed-AMI projects (for example, 25% at 30% AMI, 35% at 50% AMI, and 40% at 60% AMI) can reflect documented wage gaps and show how the proposed affordability mix relates to the local economy under CHFA's QAP framework.`
  - `What types of housing.demand`:
    `A top-ranked lane is where public indicators show the clearest combination of documented need and feasible delivery conditions. A lower-ranked lane may still be appropriate, but it should be supported by local evidence not captured in the public data.`
  - `Housing Type Feasibility.why`:
    `A type-by-type feasibility check (per-home cost, achievable rent, zoning, and basis boost) shows which housing approaches are most likely to be financeable in the selected community.`

### Finding 10 - Methodology document is still developer-facing and organization-facing

- File: `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md:5-23`, `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md:195`, `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md:233`, `docs/methodology/LIHTC-LOCATOR-METHODOLOGY.md:261-270`
- Current text:
  - `deal targeting`
  - `Which Colorado jurisdictions deserve scarce developer attention...`
  - `our model's calibration`
  - `our own outreach calendar`
  - `Population dominates`
- What's wrong: Methodology docs are in scope for the public voice guide. This document still reads like an internal developer-screening memo.
- Suggested fix:
  - Opening paragraph:
    `This document describes the methodology behind the LIHTC Opportunity Finder. It explains how the reference compares Colorado jurisdictions using public indicators, what data supports each measure, and what the tool does not determine.`
  - Product question:
    `How do public indicators describe Colorado jurisdictions in different LIHTC planning contexts?`
  - Line 195:
    `The 5,000-resident inflection point is a model calibration derived from observed award patterns; it is not a CHFA QAP threshold.`
  - Line 233:
    `The score is bounded by known dimensions so partial civic-capacity records are not treated the same as complete records. It is a planning indicator, not a public judgment of any community.`
  - 4% rationale:
    `4% Bond: Population is currently weighted highest (30%) because bond-financed projects often need larger unit counts and absorption capacity. Need and recency remain important because CHFA's QAP still evaluates housing need, market demand, project feasibility, and applicable state-credit criteria.`

## Priority 2 - Opportunity Finder 4% Scoring Sanity Check

### Finding 11 - Population at 30% likely overstates the 4% signal for rural bond-plus-state-credit contexts

- File: `js/lihtc-opportunity-finder.js:297-303`, `js/lihtc-opportunity-finder.js:539-545`, `data/hna/ranking-index.json:11414-11484`, `data/hna/ranking-index.json:16372-16442`
- Current code:
  - `4pct: { need: 0.25, recency: 0.12, basis: 0.15, pop: 0.30, civic: 0.18 }`
  - `populationScore(pop)` caps at 100 around 15,000 and gives New Castle 78 vs Rifle 93.
- Current records:
  - New Castle: need `72.4`, cost burden `70.2%`, population `4,880`, drought years `10`, 4% recency `100`, regional 4% recency `50`, civic `4/7`.
  - Rifle: need `65.4`, cost burden `39.3%`, population `10,570`, drought years `3`, 4% recency `100`, regional 4% recency `50`, civic `3/7`.
- What's wrong: The 4% composite gives a large contribution to population even though both places inherit the same current regional 4% pressure from Garfield County/Glenwood Springs and neither has a place-level 4% award. That makes Rifle's scale dominate New Castle's stronger need, cost burden, longer place-level gap, and stronger civic record.
- CHFA/QAP context: The current QAP says 4% tax-exempt-bond projects are evaluated and underwritten similarly to 9% proposals unless otherwise stated, and CHFA may apply Section 4 underwriting criteria. The QAP's Section 5 scoring criteria emphasize income targeting, extended use, and secondary criteria related to area housing needs, project characteristics, location, applicant characteristics, resident population, and housing type. The market-study appendix requires PMA renter-household and demand/capture analysis; it does not create a population-size preference by itself.
- Actual bond-deal context: 4% bond transactions do need scale because tax-exempt bond issuance, legal, trustee, rating/credit enhancement, and carry costs are hard to absorb in very small projects. But rural 4% + state-credit deals also depend heavily on documented need, local support, and a defensible PMA. A 30% population weight is too blunt for resort-adjacent/rural Garfield County places where community need and regional recency are doing the public-policy work.
- Recommendation: Do not modify code yet, but recommend changing 4% weights to:
  - `need: 0.30`
  - `recency: 0.17`
  - `basis: 0.15`
  - `pop: 0.20`
  - `civic: 0.18`
- Suggested report-language for methodology if this change is accepted:
  `4% Bond: Population remains important because bond-financed projects need enough renter households to support lease-up and transaction costs. Need and recency are weighted higher than before so the score remains anchored in documented community need and CHFA's geographic-distribution context, especially for rural 4% plus state-credit applications.`

## Priority 3 - CHFA Rural Definition Accuracy

### Finding 12 - Current code references a rural set-aside definition that is not in the current QAP

- File: `js/lihtc-opportunity-finder.js:306-328`
- Current code:
  - `CHFA Rural set-aside: counties NOT in CO's 12 urban/metro list are treated as rural under CHFA's QAP Section 3.B.`
  - Urban counties: Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas, El Paso, Jefferson, Larimer, Mesa, Pueblo, Weld.
- What's wrong: In the current 2025-26 QAP Second Amendment, Section 2.C is set-asides and says CHFA will not consider requests for set-asides beyond the code-required nonprofit set-aside; Section 3.B is preliminary application and award process. I did not find an Appendix 4 rural set-aside definition in the current PDF. The current rural-like criterion appears in Section 2.B priorities and Section 5.B.3.b: projects in non-metro counties with a population of 180,000 or fewer receive/meet the relevant priority/points.
- Suggested fix:
  - Rename the filter from `CHFA Rural set-aside` to `CHFA non-metro county priority`.
  - Update the comment to cite current QAP Section 5.B.3.b, not Section 3.B / Appendix 4.
  - Treat "rural" as a UI shorthand only if the UI clearly says `non-metro county priority`.

### Finding 13 - Hardcoded urban list misses five current OMB metropolitan counties

- File: `js/lihtc-opportunity-finder.js:309-321`
- Current code marks only these counties as urban/metro:
  - `08001`, `08005`, `08013`, `08014`, `08031`, `08035`, `08041`, `08059`, `08069`, `08077`, `08101`, `08123`
- What's wrong: OMB Bulletin 23-01 lists the Denver-Aurora-Centennial MSA as Adams, Arapahoe, Broomfield, Clear Creek, Denver, Douglas, Elbert, Gilpin, Jefferson, and Park counties. The code includes six of those but misses Clear Creek (`08019`), Elbert (`08039`), Gilpin (`08047`), and Park (`08093`). The Colorado Springs MSA includes El Paso and Teller; the code includes El Paso but misses Teller (`08119`). The current code therefore marks these five metropolitan counties as rural/non-metro eligible:
  - Clear Creek (`08019`) - should be non-eligible if applying the current non-metro test.
  - Elbert (`08039`) - should be non-eligible.
  - Gilpin (`08047`) - should be non-eligible.
  - Park (`08093`) - should be non-eligible.
  - Teller (`08119`) - should be non-eligible.
- False urban review: No counties in the current 12-county list appear to be false positives under the current non-metro test; each is in a current OMB metropolitan statistical area.
- Suggested fix:
  - If the code keeps an inverse `URBAN_COUNTY_FIPS` set, add `08019`, `08039`, `08047`, `08093`, and `08119`.
  - Prefer a positive `CHFA_NONMETRO_PRIORITY_COUNTY_FIPS` set generated from OMB metro delineations + Census/DOLA county population, with an explicit source comment.

## Priority 4 - Place-vs-County Data Masking Sweep

### Finding 14 - Most CHAS fallbacks are now disclosed, but one scorecard panel remains county-only for place selections

- File: `js/hna/hna-narratives.js:94-160`, `js/hna/hna-narratives.js:472-493`, `js/hna/hna-renderers.js:6928-7128`, `js/hna/hna-renderers.js:6650-6715`
- Current code:
  - `hna-narratives.js` tracks `chasSourceIsPlace` and renders a disclosure when county data is used.
  - `renderChasAffordabilityGap()` attempts TIGER place-level CHAS first and then sets a `county-approx` provenance badge when a place/CDP falls back to county.
  - `renderHnaScorecardPanel(geoid)` resolves `countyFips = String(geoid).length === 5 ? geoid : (state.contextCounty || null)` and then computes county metrics without an obvious rendered proxy badge in the inspected block.
- What's wrong: The main CHAS narratives and affordability gap chart appear to have explicit fallback disclosures. The HNA scorecard panel still appears to compute a county-level score for selected places/CDPs without a visible "county proxy" note in the block that builds the score. This fits the recurring silent-fallback risk pattern.
- Suggested fix:
  - In `renderHnaScorecardPanel`, set a local `isPlaceProxy` when selected `geoid` is not a 5-digit county and `countyFips` is used.
  - Render a small warning/provenance line near the score title:
    `County proxy: this scorecard uses {County Name} county-level CHAS and economic indicators because this panel is not yet available at place geography.`
  - Store the provenance in any mirrored state as `_scorecard_source: 'county'` for place/CDP selections.

## Sources

- CHFA QAP page: `https://www.chfainfo.com/rental-housing/housing-credit/qualified-allocation-plan`
- CHFA 2025-26 QAP Second Amendment: `https://www.chfainfo.com/getattachment/7535845e-c0fa-4061-9bcb-60d7158ea294/2025-2026-QAP-Second-Amendment.pdf`
- OMB Bulletin No. 23-01: `https://bidenwhitehouse.archives.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf`
