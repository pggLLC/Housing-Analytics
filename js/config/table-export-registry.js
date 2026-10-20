/**
 * table-export-registry.js — the tables that offer "Download Excel" and
 * "Download CSV" (js/components/table-export.js).
 *
 * A table opts in with data-export="<id>"; its entry here says what the
 * download is called, what the rows are, which sources it comes from and
 * which on-page controls decide what it shows.
 *
 *   title        name used for the file's About sheet and the button label
 *   description  one sentence on what a row is
 *   sources      ids in js/data-source-inventory.js. The Sources sheet is
 *                read from the inventory, so maintenance mode and the
 *                last-changed date are never copied here.
 *   selection    { label: CSS selector } for controls whose current value
 *                changes the rows (a county picker); recorded on About.
 *   sourcesBySelection
 *                for a table whose rows come from a different dataset
 *                depending on a control: { control, values: { value: [ids] },
 *                otherwise: [ids] }. `sources` is then the page's default.
 *   notes        caveats a reader of the file needs that the table can't say
 *
 * Column definitions are deliberately absent: each comes from the header's
 * own on-page definition, so the file and the page cannot disagree.
 * test/table-export.test.js fails on a data-export id with no entry here,
 * an entry no page uses, or a source id the inventory does not hold.
 */
(function (global) {
  'use strict';

  var tables = {
    /* ── colorado-deep-dive.html ─────────────────────────────────────── */
    'dd-ami-gap-detail': {
      title: 'AMI gap detail by income band',
      description: 'One row per AMI band for the selected county or statewide: affordable rent, renter households, priced-affordable rental homes, the gap and the coverage ratio.',
      sources: ['co-ami-gap-county'],
      selection: { 'County or region': '#amiGapCountySelect' }
    },
    'dd-county-affordability': {
      title: 'Affordability metrics by county',
      description: 'One row per Colorado county: median home value, median household income, price-to-income, price-to-rent and the share of households who can afford the median home.',
      sources: ['home-value-cascade', 'bls-laus', 'fred-data'],
      notes: 'The affordability rate uses the mortgage rate stated in the column definition, taken from FRED when the page was built.'
    },
    'dd-market-health': {
      title: 'Market health composite by county',
      description: 'One row per Colorado county: the 0–100 composite score and the five signals it blends.',
      sources: ['bls-laus', 'hmda-co']
    },
    'dd-prop123': {
      title: 'Proposition 123 commitments',
      description: 'One row per jurisdiction that filed a Proposition 123 commitment with DOLA.',
      sources: ['prop123-jurisdictions']
    },
    'dd-hmda-top10': {
      title: 'Mortgage lending, top 10 counties',
      description: 'The 10 Colorado counties with the most mortgage originations in the latest HMDA year.',
      sources: ['hmda-co']
    },
    'dd-aff-gap-top10': {
      title: 'AMI gap at 50% AMI, top 10 counties',
      description: 'The 10 Colorado counties with the largest shortfall of rental homes affordable at 50% AMI.',
      sources: ['co-ami-gap-county']
    },
    'dd-trade-wages': {
      title: 'Hourly wage by construction trade',
      description: 'One row per construction occupation: mean hourly wage statewide and in each Colorado metro area.',
      sources: ['co-construction-labor-cost']
    },
    'dd-cost-history': {
      title: 'Construction wages, employment and input prices, month by month',
      description: 'One row per month: year-over-year change in Colorado construction earnings and employment, and in national multifamily construction input prices.',
      sources: ['co-construction-labor-cost', 'fred-data']
    },
    'dd-chfa-limits': {
      title: 'CHFA income and rent limits',
      description: 'One row per AMI tier for the selected county: maximum income by household size and maximum gross rent by bedroom count.',
      sources: ['chfa-income-rent-limits'],
      selection: { County: '#dfAmiCounty' }
    },
    'dd-lihtc-by-year': {
      title: 'Colorado LIHTC awards per year by credit type',
      description: 'One row per award year: developments and housing units by credit type.',
      sources: ['chfa-lihtc'],
      notes: 'CHFA’s property feed lags its own award announcements, so the latest year can be incomplete.'
    },
    'dd-lihtc-cumulative': {
      title: 'Colorado LIHTC projects and units by award year, cumulative',
      description: 'One row per award year: developments and units awarded that year and the running totals.',
      sources: ['chfa-lihtc'],
      notes: 'CHFA’s property feed lags its own award announcements, so the latest year can be incomplete.'
    },
    'dd-lihtc-size-period': {
      title: 'Colorado LIHTC project size by award period',
      description: 'One row per five-year award period: developments, units and median development size by credit type.',
      sources: ['chfa-lihtc']
    },
    'dd-lihtc-size-band': {
      title: 'Colorado LIHTC projects by size band and credit type',
      description: 'One row per development size band: how many developments and units fall in it, by credit type.',
      sources: ['chfa-lihtc']
    },
    'dd-lihtc-size-county': {
      title: 'Colorado LIHTC project size by county',
      description: 'One row per county with tax-credit developments: count, units, and average, median and largest development size.',
      sources: ['chfa-lihtc']
    },
    'dd-peer-benchmark': {
      title: 'Peer LIHTC project benchmark',
      description: 'Tax-credit developments in the selected county, as CHFA records them.',
      sources: ['chfa-lihtc'],
      selection: { County: '#benchCounty' }
    },
    'dd-metro-breakdown': {
      title: 'LIHTC portfolio by metro area',
      description: 'One row per metro area: tax-credit developments, total and low-income units, and the metro’s share of low-income units.',
      sources: ['chfa-lihtc']
    },
    'dd-funding-vs-need': {
      title: 'Funding vs need by county',
      description: 'One row per Colorado county: the ≤30% AMI housing gap, tax-credit and Prop 123 awards, and market signals.',
      sources: ['funding-vs-need'],
      notes: 'This download is the table as displayed. "Download every field (CSV)" on the page gives the raw fields behind it, including county FIPS codes and credit amounts.'
    },
    'dd-market-direction-counties': {
      title: 'Housing market direction by county',
      description: 'One row per Colorado county: its market call, the readings behind it, homes permitted this year against last, the tax-credit rent edge, affordable homes in the pipeline, and Realtor.com’s homes for sale, days on market and share of listings with a price cut.',
      sources: ['market-direction', 'realtor-inventory']
    },
    'dd-market-direction-towns': {
      title: 'Housing market direction by town',
      description: 'One row per incorporated town, plus each census-designated place when the page’s box is ticked, for the county and call selected on the page: its market call and the readings behind it. The Type column says which each row is.',
      sources: ['market-direction'],
      selection: { County: '#mdCounty', Call: '#mdTownCall', 'Census-designated places included': '#mdCdps' }
    },
    'dd-market-projects': {
      title: 'Affordable projects in a county',
      description: 'Every affordable-housing project a state agency recorded in the selected county since 2016, newest first.',
      sources: ['development-activity'],
      selection: { County: '#mdCounty' }
    },

    /* ── lihtc-allocations.html ──────────────────────────────────────── */
    'la-regions': {
      title: 'LIHTC allocation by U.S. region',
      description: 'One row per U.S. Census region for the year and filters selected on the page.',
      sources: ['lihtc-state-allocations'],
      selection: { Year: '#year-select', Region: '#region-select', State: '#state-select', 'Quick search': '#state-search' },
      sourcesBySelection: {
        control: '#year-select',
        values: { '2026': ['lihtc-state-allocations'] },
        otherwise: ['lihtc-state-allocations-historical']
      }
    },
    'la-states': {
      title: 'LIHTC allocation by state',
      description: 'One row per state for the year, region, state and search filters selected on the page.',
      sources: ['lihtc-state-allocations'],
      selection: { Year: '#year-select', Region: '#region-select', State: '#state-select', 'Quick search': '#state-search' },
      sourcesBySelection: {
        control: '#year-select',
        values: { '2026': ['lihtc-state-allocations'] },
        otherwise: ['lihtc-state-allocations-historical']
      },
      notes: 'The page lists up to 50 rows, so with no filter one of the 51 jurisdictions (50 states and DC) is not shown and not downloaded.'
    },

    /* ── chfa-portfolio.html ──────────────────────────────────────────── */
    'cp-portfolio': {
      title: 'CHFA multifamily tax-credit portfolio',
      description: 'One row per tax-credit property CHFA lists, for the filters selected on the page. Every matching property is included, not only the page of 50 on screen.',
      sources: ['chfa-lihtc'],
      selection: {
        County: '#filterCounty', 'Credit type': '#filterCredit', Development: '#filterDevType', Setting: '#filterSetting',
        'Population served': '#filterServes', 'Income targeting': '#filterIncome', 'Award year from': '#filterYearFrom',
        'Award year to': '#filterYearTo', Search: '#filterSearch'
      },
      notes: 'The Location column holds the street address CHFA publishes, or its coordinates where there is no address. CHFA’s feed publishes no DDA or QCT values, so that column is blank with the reason in the notes column.'
    },

    /* ── insights.html ───────────────────────────────────────────────── */
    'in-equity-pricing': {
      title: 'LIHTC equity pricing',
      description: 'National average equity price per $1 of federal credit for 9% and 4% credits, with quarter-over-quarter and year-over-year change.',
      sources: ['novogradac-equity-pricing'],
      notes: 'Captured by hand from Novogradac each quarter; see the Sources sheet for the date it last changed.'
    },
    'in-rates': {
      title: 'Benchmark financing rates',
      description: 'One row per benchmark rate: latest value, change over one year and the date of the latest value.',
      sources: ['fred-data']
    }
  };

  /* Downloads that are a whole report rather than one table. Their own
   * code writes the data; TableExport.describe() adds the same Sources and
   * About metadata from these entries. */
  var reports = {
    'hna-report': {
      title: 'Housing Needs Assessment',
      description: 'The figures the Housing Needs Assessment shows for the selected geography: the page’s stat cards, housing stock, cost burden by income, the AMI gap, jobs and commuting, tax-credit properties and the transit-zone screen.',
      sources: ['hna-county-profiles', 'hna-ranking-index', 'hud-chas-co', 'co-ami-gap-county', 'lehd-wac', 'dola-sya', 'hna-projections',
        'hud-income-limits', 'hud-fair-market-rents', 'home-value-cascade', 'chfa-lihtc', 'qct-colorado', 'dda-colorado', 'transit-stops-statewide-co'],
      notes: 'Each value carries the reason the page gives when it is unavailable. Vintages for ACS, CHAS, LEHD, DOLA and FMR are listed in the data itself.'
    },
    'pma-site-analysis': {
      title: 'Market analysis (PMA) site screen',
      description: 'The screening result for one site: the overall and dimension scores, the census-tract aggregates inside the market area, existing affordable supply and the nearest services.',
      sources: ['acs-tract-metrics', 'tract-centroids-co', 'hud-chas-co', 'lodes-co', 'hud-lihtc-co', 'chfa-lihtc', 'transit-stops-statewide-co',
        'affordable-housing-properties', 'chfa-income-rent-limits', 'nces-schools-co', 'amenities-grocery-co', 'amenities-healthcare-co',
        'amenities-parks-co', 'fema-flood-co'],
      notes: 'A screening signal from public data, not a substitute for a CHFA-required market study.'
    }
  };

  global.TableExportRegistry = { tables: tables, reports: reports };
})(window);
