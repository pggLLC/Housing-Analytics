# COHO Analytics — Site Data, Calculations & Modeling Report

**Prepared:** March 2026  
**Scope:** Complete inventory of all data sources, calculations, and analytical models used by the COHO Analytics platform  
**Audience:** Non-technical stakeholders, policy reviewers, housing agency staff, and public interest advocates  
**Purpose:** To make the platform's methods fully transparent and auditable without requiring programming knowledge

---

## How to Read This Report

This report describes **what data the platform uses**, **where it comes from**, **how it is processed**, and **what the numbers on screen actually mean**. It does not require any technical background.

Technical terms are defined the first time they appear. Italicized words in *parentheses* indicate the name of the data source or file behind each metric.

---

## Part 1 — Overview of the Platform

COHO Analytics is a web-based decision-support tool for affordable housing professionals in Colorado. It brings together data from seven federal agencies, one state agency, and one private-sector source and presents them as interactive maps, charts, and reports.

The platform is used for three primary purposes:

1. **Housing Needs Assessment (HNA)** — Measuring how much affordable housing a community needs and who needs it
2. **Market Feasibility Analysis** — Evaluating whether a specific site can support a new affordable housing development
3. **Economic & Policy Monitoring** — Tracking the economic conditions and policy environment that affect housing finance

All data is publicly available. No information about individual people, properties, or businesses is collected from users.

---

## Part 2 — Data Sources

### 2.1 U.S. Census Bureau — American Community Survey (ACS)

**What it is:** The ACS is a large annual survey conducted by the federal government. It collects information on income, housing costs, household composition, commuting, and many other topics. Unlike the 10-year Census, the ACS is conducted every year on a rolling basis.

**What COHO uses it for:**
- Population counts and household counts at the county and city level
- Median household income (how much a typical family earns)
- Median gross rent (how much a typical renter pays each month)
- Housing cost burden (the share of renters who pay more than 30% of their income on rent)
- Renter vs. owner household breakdown
- Housing vacancy rates

**Two versions are used:**
- **ACS 1-Year Estimates** — More current, but only available for areas with 65,000+ people. Used when available.
- **ACS 5-Year Estimates** — Covers all areas including small towns and rural counties, but reflects a five-year average rather than a single year.

**Source:** U.S. Census Bureau, `api.census.gov`  
**Update frequency:** Annual (published approximately 12 months after the reference year)  
**Current vintage on site:** 2024 (or most recently released)

---

### 2.2 Colorado Department of Local Affairs (DOLA) — State Demographer's Office

**What it is:** The Colorado State Demographer's Office (SDO) produces the official population projections used for state planning. These are based on historical population trends, birth and death rates, and migration patterns.

**What COHO uses it for:**
- **Population projections** — How many people are expected to live in each Colorado county through 2050
- **Single-Year-of-Age (SYA) data** — A breakdown of how many people of each exact age (0 to 85+) currently live in each county. This is used to build the "population pyramid" charts showing the age distribution of a community.
- **Components of change** — How much of the population change each year comes from births, deaths, and people moving in or out

**Source:** Colorado Department of Local Affairs / SDO, `demography.dola.colorado.gov`  
**Update frequency:** Annual (county projections) / Periodic (SYA data)

---

### 2.3 U.S. Department of Housing and Urban Development (HUD)

HUD provides several distinct datasets that the platform uses:

#### 2.3a — LIHTC Database (Low-Income Housing Tax Credit)

**What it is:** A national database of every affordable housing development that received a Low-Income Housing Tax Credit (LIHTC) since 1987. The LIHTC is the primary federal program for financing affordable rental housing. Developers receive tax credits in exchange for keeping rents affordable for at least 30 years.

**What COHO uses it for:**
- Mapping all existing LIHTC properties in Colorado
- Counting affordable units by county
- Tracking historical allocation trends
- Identifying which projects are in Qualified Census Tracts (QCTs) or Difficult Development Areas (DDAs)

**Key fields:**
- **Project Name** — The name of the development
- **Total Units** — Total residential units in the development
- **LI Units** — Units restricted to low-income households
- **Year Allocated** — The year LIHTC credits were awarded (not when construction was completed)
- **9% vs. 4% Credit** — The type of LIHTC used (9% credits are competitive; 4% credits are non-competitive and used with tax-exempt bonds)
- **Non-Profit sponsor** — Whether the developer was a non-profit organization

**Source:** HUD LIHTC Database, `lihtc.huduser.gov` and via ArcGIS FeatureServer  
**Update frequency:** Annual (with a 1–2 year reporting lag for recent projects)  
**Important caveat:** The database reflects *allocation* year, not *construction completion* year. A project allocated credits in 2022 may not be occupied until 2024 or 2025.

#### 2.3b — Qualified Census Tracts (QCTs) and Difficult Development Areas (DDAs)

**What it is:** HUD designates certain geographic areas as QCTs or DDAs based on poverty, income, and housing cost data. Affordable housing projects in these areas are eligible for a 30% "basis boost," which increases the dollar value of tax credits awarded and makes projects in challenging markets more financially viable.

**What COHO uses it for:**
- Map overlays showing QCT and DDA boundaries in Colorado
- Identifying whether a prospective development site qualifies for the basis boost

**Source:** HUD ArcGIS FeatureServer  
**Update frequency:** Annual (HUD redesignates QCTs and DDAs each year)

#### 2.3c — Fair Market Rents (FMRs)

**What it is:** FMRs are HUD's estimate of what a modest apartment in a given area costs to rent at the 40th percentile of the local market (meaning 40% of rentals are at or below this price). FMRs are used to set payment standards for the Section 8 Housing Choice Voucher program.

**What COHO uses it for:**
- Contextualizing local rent levels
- Setting "affordable rent" reference points for market analysis calculations

**Source:** HUD Fair Market Rents API  
**Update frequency:** Annual (published each October for the following fiscal year)

#### 2.3d — CHAS Data (Comprehensive Housing Affordability Strategy)

**What it is:** CHAS data, produced by HUD from ACS microdata, provides detailed counts of housing problems (cost burden, overcrowding, incomplete plumbing/kitchen) broken down by income tier and tenure (renter vs. owner). It is more detailed than standard ACS tables for housing need analysis.

**What COHO uses it for:**
- The "Affordability Gap" chart on the Housing Needs Assessment page
- Estimating the number of households at each AMI tier (30%, 50%, 80% of Area Median Income) who are cost-burdened

**Source:** HUD CHAS data portal  
**Update frequency:** Every 1–3 years (based on ACS 5-year releases)

---

### 2.4 Federal Reserve Bank of St. Louis (FRED)

**What it is:** The Federal Reserve's FRED database is a free repository of more than 800,000 economic time series from dozens of sources including the Bureau of Labor Statistics, Census Bureau, and the Federal Reserve itself. It is the standard source for macroeconomic data.

**What COHO uses it for:**
- **Mortgage rates** — 30-year fixed mortgage rates (`MORTGAGE30US`), which directly affect housing affordability and development feasibility
- **Inflation** — Consumer Price Index for All Urban Consumers (`CPIAUCSL`) and the Shelter component (`CUUR0000SAH1`), which measures how fast housing costs are rising
- **Unemployment rate** (`UNRATE`) and **labor force participation** (`CIVPART`)
- **Construction materials costs** — Producer Price Indices (PPI) for lumber, steel, concrete, and other building materials
- **Building permits** — Monthly permit counts as a leading indicator of housing supply
- **Rental vacancy rate** (`RRVRUSQ156N`) — National measure of how tight the rental market is

**How data is stored:** A daily automated script downloads the latest observations for all 45 tracked series and stores them in `data/fred-data.json`. Each series includes all available observations from 2014 onward, so trend analysis is always possible.

**Source:** Federal Reserve Bank of St. Louis, `fred.stlouisfed.org`  
**Update frequency:** Daily (for most series; some are monthly or quarterly)

---

### 2.5 Colorado Association of Realtors (CAR)

**What it is:** The Colorado Association of Realtors publishes a monthly market report summarizing residential real estate sales data across Colorado's major metro areas.

**What COHO uses it for:**
- Median sale prices by metro area and statewide
- Active listing counts
- Days on market
- Month-over-month and year-over-year market trend tracking

**Source:** CAR monthly market reports  
**Update frequency:** Monthly (requires manual ingestion)  
**Files on site:** `data/car-market-report-2026-02.json`, `data/car-market-report-2026-03.json`

---

### 2.6 LEHD (Longitudinal Employer-Household Dynamics) — U.S. Census Bureau

**What it is:** LEHD data, produced by the Census Bureau from state unemployment insurance records, shows where workers live and where they work. It links employer location to worker home location to create detailed commuting flow data.

**What COHO uses it for:**
- Understanding the labor market catchment area of a given county
- Identifying what industries employ local workers (retail, healthcare, manufacturing, etc.)
- Measuring the wage distribution of workers in a local area (jobs paying under $1,250/month, $1,251–$3,333/month, and above $3,333/month)

**Three wage bands** used for housing affordability analysis:
- **CE01** — Workers earning ≤$1,250/month (~$15,000/year) — typically minimum-wage or part-time workers
- **CE02** — Workers earning $1,251–$3,333/month ($15,001–$40,000/year) — lower-wage service workers
- **CE03** — Workers earning ≥$3,334/month (>$40,000/year) — higher-wage workers

**Source:** U.S. Census Bureau LODES (LEHD Origin-Destination Employment Statistics)  
**Update frequency:** Annual (released approximately 18 months after the reference year)

---

### 2.7 Kalshi — Prediction Markets

**What it is:** Kalshi is a regulated prediction market exchange where participants can trade contracts on the probability of specific future events. These markets aggregate the collective judgment of many participants, often providing leading indicators that differ from official forecasts.

**What COHO uses it for:**
- Monitoring market sentiment about future Federal Reserve interest rate decisions
- Tracking probability estimates for housing-related policy outcomes

**Source:** Kalshi REST API  
**Update frequency:** Weekly  
**Note:** Prediction market probabilities are speculative and should not be treated as official forecasts.

---

### 2.8 Proposition 123 / Colorado HB 22-1093

**What it is:** Colorado Proposition 123 (2022) created a dedicated state fund for affordable housing, funded by a portion of state income taxes. Local governments that commit to specific zoning reforms and affordability requirements gain access to these funds.

**What COHO uses it for:**
- Mapping which Colorado jurisdictions have committed to Proposition 123 requirements
- The Compliance Dashboard page shows the status of commitments by municipality and county

**Source:** Colorado Department of Local Affairs (CDOLA) commitment filings portal  
**Update frequency:** Manual (updated when new commitments are filed)

---

## Part 3 — Calculations and Modeling

This section explains every formula and calculation the platform uses, in plain language.

### 3.1 Housing Cost Burden

**Definition:** A household is "cost-burdened" when it spends more than 30% of its gross income on housing costs (rent or mortgage + utilities). A household is "severely cost-burdened" at 50% or more.

**How it is calculated:**  
The platform counts the number of renter households in each cost-burden category from the Census ACS table `B25070`:

| Category | Census Code | Meaning |
|----------|-------------|---------|
| 30.0–34.9% of income on rent | B25070_007E | Moderately burdened |
| 35.0–39.9% of income on rent | B25070_008E | Moderately burdened |
| 40.0–49.9% of income on rent | B25070_009E | Severely burdened |
| 50.0% or more of income on rent | B25070_010E | Severely burdened |

**Cost burden rate** = (sum of all burdened households above) ÷ (all renter households paying cash rent, `B25070_001E`)

**Example:** If 4,000 of 10,000 renter households pay more than 30% of income on rent, the cost burden rate is 40%.

**Why it matters:** Cost burden is the most widely used measure of housing affordability stress. It identifies communities where housing costs are growing faster than incomes, creating pressure for additional affordable housing supply.

---

### 3.2 Area Median Income (AMI) and Affordability Tiers

**Definition:** AMI is the median household income for a specific area, as calculated by HUD for each metropolitan statistical area and county. "Area" refers to a HUD-defined geographic unit, not simply the city limits.

**How affordability tiers work:**
- **30% AMI** — Extremely low income (e.g., ~$28,500/year for a family of four in Denver metro in 2025)
- **50% AMI** — Very low income (~$47,500/year)
- **60% AMI** — Low income — the typical LIHTC targeting threshold (~$57,000/year)
- **80% AMI** — Moderate income — upper boundary for most federal housing programs (~$76,000/year)
- **120% AMI** — Middle income — sometimes used for workforce housing (~$114,000/year)

**Affordable rent formula:**  
A unit is considered "affordable" for a household at a given AMI tier if the monthly rent does not exceed 30% of the monthly income at that tier.

*Affordable monthly rent at 60% AMI = (AMI × 60%) × 30% ÷ 12 months*

**Example (Denver metro, 4-person household, 2025):**  
AMI = ~$95,000 × 60% = $57,000 × 30% = $17,100 ÷ 12 = **$1,425/month maximum affordable rent**

A market-rate unit in Denver renting for $2,000/month exceeds this threshold by $575/month, representing the "affordability gap" that LIHTC programs are designed to close.

---

### 3.3 AMI Gap Analysis

**What the chart shows:** The AMI gap chart on the Colorado Deep Dive and HNA pages shows, for each county, the difference between what a household at each AMI tier can afford to pay and what the median market rent actually is.

**How it is calculated:**

1. Obtain the HUD AMI for a 4-person household in each county
2. Calculate the maximum affordable monthly rent at 30%, 50%, and 60% of AMI
3. Compare to the ACS median gross rent for that county
4. The "gap" is the difference: `gap = median_gross_rent − affordable_rent_at_tier`

A positive gap means market rents exceed what households at that income level can afford. A negative gap means the area is relatively affordable for that income tier.

**Data sources:** `data/co_ami_gap_by_county.json` — built from HUD AMI limits and ACS median gross rent

---

### 3.4 Housing Needs Assessment (HNA) — Population Projections

The HNA projections estimate how much housing a community will need in the future. The methodology has three steps.

#### Step 1: Project population growth

**For counties:** The platform uses official DOLA State Demographer population projections. These are the same projections used in Colorado state planning documents.

**For cities and towns:** There is no official municipal-level projection, so the platform derives one:

1. Measure what share of the county's population lives in the city today  
   *(Example: Denver holds 32% of Denver County's population)*
2. Measure whether the city is growing faster or slower than the county as a whole, based on ACS data over two survey years
3. Apply this "relative growth rate" to the county projection forward

The share is allowed to drift over time but is capped between 2% and 98% to avoid unrealistic results.

**Formula:**  
`city_population(year) = county_population(year) × share(year)`

Where `share(year)` increases or decreases based on whether the city is growing faster or slower than the county, capped at a maximum of the entire county population.

#### Step 2: Convert population to households

**Headship rate** = the share of the population that is a "head of household." This measures how many separate households a given population forms.

*Households = population × headship rate*

The platform uses two modes for the headship rate:
- **Hold constant** — Assume the same share of people form households as today (conservative estimate)
- **Apply trend** — Allow the headship rate to drift based on its historical trajectory from ACS data. If younger generations are forming households later in life (a national trend), this lowers the projected household count

#### Step 3: Convert households to housing units needed

Not every household occupies a unit — some units are vacant (either for sale, for rent, or seasonally vacant). The platform uses a "target vacancy rate" to account for this:

*Units needed = households ÷ (1 − target vacancy rate)*

A healthy rental market typically has a 5–6% vacancy rate. A vacancy rate below 3% indicates a tight market where new supply is clearly needed.

**Incremental units needed:**  
*New units needed = units needed in projection year − current housing units*

This is the number the platform displays as the housing shortfall or surplus.

---

### 3.5 Public Market Analysis (PMA) Scoring

When a user selects a site on the Market Analysis page, the platform calculates a "PMA score" from 0 to 100 representing how strongly the local market supports a new affordable housing development. A higher score means stronger market fundamentals.

The score has five components:

#### Component 1 — Demand (30% of overall score)

This measures the intensity of housing need in the area.

- **Cost burden subscore**: How many renters are paying more than 30% of their income on rent? The maximum score (100) is reached when 55% or more of renters are cost-burdened.
- **Renter prevalence subscore**: What share of households are renters? The maximum score (100) is reached when 60% or more of households rent.

*Demand score = (cost burden subscore × 60%) + (renter prevalence subscore × 40%)*

#### Component 2 — Capture Risk (25% of overall score)

This measures whether the local market is already saturated with affordable housing.

- **Capture rate** = (existing affordable units + proposed units) ÷ renter households in the area
- A capture rate near zero means the market can absorb new supply
- A capture rate near 50% means nearly half of all renter households are already in affordable housing — the market may be saturated

*Capture risk score = (1 − capture rate ÷ 50%) × 100, floored at 0 and capped at 100*

#### Component 3 — Rent Pressure (15% of overall score)

This measures how much market rents exceed what lower-income households can afford.

- If market rents are much higher than affordable rents, there is unmet demand, which is a positive signal for a new affordable development.
- **Affordable rent threshold** = (AMI × 60% × 30%) ÷ 12 = the maximum rent affordable to a household at 60% AMI

*Rent pressure score = (rent ratio − 0.70) ÷ (1.50 − 0.70) × 100, floored at 0 and capped at 100*

Where `rent ratio = median market rent ÷ affordable rent threshold`

#### Component 4 — Land / Supply (15% of overall score)

This measures housing supply tightness using the vacancy rate.

- A very low vacancy rate (below 3%) signals that demand is overwhelming supply — a positive signal for new development
- The maximum score (100) is reached at 0% vacancy; the score reaches 0 at 12% vacancy

*Land score = (1 − vacancy rate ÷ 12%) × 100, floored at 0*

#### Component 5 — Workforce (15% of overall score)

This component is currently a placeholder and returns a constant score of 60 for all sites. It is planned to incorporate LODES commute-shed data (measuring the workforce demand near the site) in a future version.

#### Overall Score Formula

*Overall score = (Demand × 30%) + (Capture Risk × 25%) + (Rent Pressure × 15%) + (Land × 15%) + (Workforce × 15%)*

#### Score Tiers

| Score | Interpretation |
|-------|----------------|
| 80–100 | **Strong** — Market conditions are favorable for a new affordable development |
| 60–79 | **Moderate** — Generally supportive conditions; review any flagged risk factors |
| 40–59 | **Marginal** — Limited market support; additional study is recommended |
| 0–39 | **Weak** — Market conditions do not strongly support new affordable supply here |

---

### 3.6 Affordability Index (Homeownership)

On the Housing Needs Assessment page, the platform also estimates whether a median-priced home is affordable to a median-income household. This calculation mirrors standard underwriting practice:

**Monthly principal and interest (P&I):**  
*P&I = loan_amount × [monthly_rate × (1 + monthly_rate)^360] ÷ [(1 + monthly_rate)^360 − 1]*

Where:
- `loan_amount` = median home price × (1 − 10% down payment)
- `monthly_rate` = current 30-year fixed mortgage rate ÷ 12
- 360 = months in a 30-year mortgage

**Total housing payment:**  
*Total payment = P&I + property taxes + insurance + PMI*

Standard assumptions used:
- **Down payment:** 10% of purchase price
- **Property taxes:** 0.65% of home value annually (Colorado average)
- **Homeowner's insurance:** 0.35% of home value annually
- **PMI (mortgage insurance):** 0.50% of loan amount annually (required when down payment < 20%)

**Affordability test:**  
*Housing is affordable if total monthly payment ≤ 30% of gross monthly income*

*Affordable price = (median household income × 30%) ÷ 12 months ÷ [P&I factor + tax/insurance factor]*

If the median home price exceeds this affordable price, the community has a homeownership affordability gap.

---

### 3.7 Demographic Projections — Cohort-Component Model

For advanced demographic analysis, the platform uses a **cohort-component model** — the same methodology used by the U.S. Census Bureau for national population projections.

**How it works:**

1. **Start with a baseline population** divided into age/sex cohorts (e.g., females aged 25–29, males aged 30–34, etc.)
2. **Apply survival rates** — Each cohort "ages" one year and a certain percentage survive to the next year based on life tables
3. **Add births** — Based on fertility rates applied to women of childbearing age
4. **Add or subtract migration** — Based on historical net migration patterns

The model produces a population pyramid for each future year, showing how the age distribution of a community is expected to change.

**Why this matters for housing:**  
Different age groups have very different housing needs. An aging population needs more accessible housing, senior-focused units, and care facilities. A young adult influx drives demand for small rental apartments. A family-formation wave drives demand for larger units.

**Source methodology:** Scripts in `scripts/hna/demographic_projections.py` and `scripts/hna/household_projections.py`

---

### 3.8 CRA Expansion Analysis

The Community Reinvestment Act (CRA) requires banks to invest in the communities where they take deposits, particularly in low- and moderate-income areas. The CRA Expansion Analysis page helps banks and community organizations assess where CRA-qualifying investments would have the most impact.

**How the analysis works:**

1. Map all census tracts that qualify as low-to-moderate income (LMI) — defined as median family income ≤ 80% of the area median
2. Identify where LIHTC properties are concentrated
3. Calculate the gap between LMI housing need and existing affordable supply
4. Highlight tracts with high gap scores as priority areas for CRA-qualifying investments

**Data sources:** ACS 5-year estimates, HUD LIHTC database

---

### 3.9 LIHTC Historical Allocation Trend

**What the chart shows:** A bar chart of Colorado's annual LIHTC credit allocation from 1988 to the present.

**Two distinct metrics are displayed:**

- **Allocation Authority** — The maximum dollar amount of LIHTC credits that the IRS permitted Colorado to award each year. This is a federal formula: `IRS per-capita floor × Colorado population`. It increases each year with inflation.

- **Actual Credits Awarded (from HUD database)** — The dollar value of credits that Colorado's Housing Finance Authority (CHFA) actually awarded to specific projects. This may be lower than the authority in years when not enough qualified projects applied.

**Important caveat:** The HUD database reflects the *year credits were allocated*, not the *year the building was completed*. A project that received credits in 2022 typically will not be occupied until 2024 or 2025. The last 2–3 years of data are always understated because recently allocated projects have not yet been reported to HUD.

---

### 3.10 Economic Indicators Dashboard

The Economic Dashboard monitors 45 macroeconomic time series from FRED. Key indicators and their interpretation:

| Indicator | What It Measures | Why It Matters for Housing |
|-----------|-----------------|---------------------------|
| **30-Year Fixed Mortgage Rate** | The interest rate on a standard home loan | Higher rates raise monthly payments, reducing affordability |
| **CPI Shelter Component** | How fast housing costs are rising relative to inflation | Persistent shelter inflation signals under-supply |
| **Unemployment Rate** | Share of labor force without jobs | High unemployment reduces ability to pay rent |
| **Building Permits (residential)** | New construction applications | Leading indicator of housing supply pipeline |
| **Rental Vacancy Rate** | Share of rental units that are empty | Low vacancy = tight market; below 5% is historically tight |
| **Lumber PPI** | Price of lumber for construction | High lumber costs raise construction costs for new units |
| **Steel PPI** | Price of structural steel | Same as lumber — a cost-driver for new development |
| **Concrete PPI** | Price of concrete products | Same as above |

---

## Part 4 — Data Quality and Limitations

### 4.1 Temporal Lags

Most federal data sources have reporting delays of 1–2 years:
- ACS 5-Year data is published approximately 12 months after the final survey year
- HUD LIHTC database is updated with a 1–2 year lag
- LEHD data is typically 18 months behind

The platform displays "Last Updated" timestamps on all data-dependent pages. When data is older than 30 days, a caution indicator appears. When older than 90 days, a warning is shown.

### 4.2 Geographic Coverage Gaps

- The Housing Needs Assessment covers all 64 Colorado counties and approximately 32 featured municipalities. Rural counties with small populations may have wider statistical margins of error in ACS data.
- The HUD LIHTC database is substantially complete through 2019. Years 2020–present are understated due to reporting lags.
- CHAS data covers counties but does not always provide reliable estimates for very small geographic areas (fewer than ~5,000 households).

### 4.3 Assumptions in Projections

All projection models require assumptions about the future. Key assumptions used:

- **Mortgage assumptions (affordability index):** 30-year fixed mortgage, 10% down payment, 0.65% property tax rate, 0.35% insurance rate. Actual costs vary by lender and location.
- **Target vacancy rate (housing need projections):** Default 5% vacancy rate. Areas with different conditions may warrant adjustment.
- **PMA workforce score:** Currently a fixed placeholder of 60 (see Section 3.5). Does not yet incorporate actual commute-shed data.
- **AMI figures:** Based on the most recent HUD published AMI limits, which are updated annually each spring. Current-year LIHTC applications always use the most recent published figures.

### 4.4 What the Platform Does Not Include

- Private market data (MLS listings, CoStar, Zillow rent trends) — these are proprietary and not publicly available
- Individual property-level data for non-LIHTC units
- Real-time vacancy data (all vacancy data is from annual surveys)
- Construction pipeline data beyond building permits (permits that did not proceed to construction are not filtered out)

---

## Part 5 — Data Refresh Schedule

| Data Source | Refresh Frequency | Automation |
|-------------|------------------|------------|
| FRED economic indicators | Daily | Automated (GitHub Actions) |
| ACS state estimates | Daily | Automated |
| HNA summary (county/city) | Weekly (Monday) | Automated |
| LIHTC map overlays | Weekly (Monday) | Automated |
| QCT / DDA overlays | Weekly (Monday) | Automated |
| FRED construction commodities | Weekly | Automated |
| CAR market report | Monthly | Manual trigger |
| DOLA projections | Annual | Manual |
| HUD LIHTC database | Annual | Manual |
| Prop 123 jurisdictions | As-needed | Manual |

---

## Part 6 — Glossary of Key Terms

| Term | Plain-English Definition |
|------|--------------------------|
| **ACS** | American Community Survey — the Census Bureau's annual housing and income survey |
| **AMI** | Area Median Income — HUD's official income figure for a geographic area, used to set affordability limits |
| **CHFA** | Colorado Housing and Finance Authority — the state agency that administers LIHTC in Colorado |
| **CHAS** | Comprehensive Housing Affordability Strategy data — HUD's detailed housing needs statistics |
| **CRA** | Community Reinvestment Act — federal law requiring banks to invest in low- and moderate-income areas |
| **DDA** | Difficult Development Area — HUD designation that qualifies LIHTC projects for a 30% financing bonus |
| **FMR** | Fair Market Rent — HUD's estimate of the 40th-percentile rent in a given area |
| **FRED** | Federal Reserve Economic Data — the St. Louis Fed's free economic data repository |
| **LEHD / LODES** | Longitudinal Employer-Household Dynamics / LEHD Origin-Destination Employment Statistics — Census Bureau employment and commuting data |
| **LIHTC** | Low-Income Housing Tax Credit — the federal government's primary tool for financing affordable rental housing |
| **LMI** | Low-to-Moderate Income — Census tracts or households with income ≤ 80% of AMI |
| **NHPD** | National Housing Preservation Database — tracks federally assisted rental properties |
| **PMA** | Primary Market Analysis — a market feasibility study examining local housing demand |
| **QCT** | Qualified Census Tract — HUD designation that qualifies LIHTC projects for a 30% financing bonus |
| **SYA** | Single-Year-of-Age — population data broken out by each individual age (0, 1, 2, … 85+) |

---

*End of Data and Calculations Report*
