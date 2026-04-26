/**
 * hna-utils.js
 * Responsibility: Pure helpers, constants, formatting, and calculation utilities.
 * Dependencies: window.__HNA_GEO_CONFIG, window.APP_CONFIG
 * Exposes: window.HNAUtils
 */
(function () {
  'use strict';

  const STATE_FIPS_CO = '08';

  // fetchWithTimeout is provided globally by js/fetch-helper.js (window.fetchWithTimeout).
  // Alias it locally so in-file calls work without modification.

  // ACS 5-year release cadence: vintage Y is released ~December of year Y+1.
  // As of 2026-04 Census has published through 2024; 2025 (covering 2021-2025)
  // typically ships in Dec 2026. Probing 2025 first generates a 404 on every
  // page load that's visible in Chrome's network panel even when downstream
  // fallback succeeds — kept 2024 as primary and slowly accept 2025 back
  // in once Census publishes it.
  const ACS_VINTAGES = [2024, 2023, 2022, 2021];
  // Keep named constants so existing checks and references still work.
  const ACS_YEAR_PRIMARY  = ACS_VINTAGES[0];
  const ACS_YEAR_FALLBACK = ACS_VINTAGES[1];
  const DEBUG_HNA = new URLSearchParams(location.search).has('debug');


  function redactKey(url){
    return url.replace(/([?&]key=)[^&]*/g, '$1REDACTED');
  }


  const DEFAULTS = {
    geoType: 'state',
    // State of Colorado
    geoId: '08',
  };

  const AFFORD = {
    // Mortgage assumptions (transparent, not "the truth")
    rateAnnual: 0.065,
    termYears: 30,
    downPaymentPct: 0.10,
    propertyTaxPctAnnual: 0.0065,
    insurancePctAnnual: 0.0035,
    pmiPctAnnual: 0.005,
    // underwriting rule-of-thumb
    paymentToIncome: 0.30,
  };

  const FEATURED = [
    // Counties
    { type: 'county', geoid: '08031', label: 'Denver County' },
    { type: 'county', geoid: '08041', label: 'El Paso County' },
    { type: 'county', geoid: '08069', label: 'Larimer County' },
    { type: 'county', geoid: '08013', label: 'Boulder County' },
    { type: 'county', geoid: '08077', label: 'Mesa County' },
    { type: 'county', geoid: '08101', label: 'Pueblo County' },
    { type: 'county', geoid: '08097', label: 'Pitkin County' },
    { type: 'county', geoid: '08117', label: 'Summit County' },
    // Municipalities
    { type: 'place', geoid: '0820000', label: 'Denver (city)',           containingCounty: '08031' },
    { type: 'place', geoid: '0816000', label: 'Colorado Springs (city)', containingCounty: '08041' },
    { type: 'place', geoid: '0827425', label: 'Fort Collins (city)',     containingCounty: '08069' },
    { type: 'place', geoid: '0807850', label: 'Boulder (city)',          containingCounty: '08013' },
    { type: 'place', geoid: '0831660', label: 'Grand Junction (city)',   containingCounty: '08077' },
    { type: 'place', geoid: '0855745', label: 'Pueblo (city)',           containingCounty: '08101' },
    { type: 'place', geoid: '0830475', label: 'Glenwood Springs (city)', containingCounty: '08097' },
    { type: 'place', geoid: '0873220', label: 'Steamboat Springs (city)', containingCounty: '08107' },
    { type: 'place', geoid: '0823680', label: 'Durango (city)',          containingCounty: '08067' },
    // CDPs
    { type: 'cdp',   geoid: '0836410', label: 'Highlands Ranch (CDP)',  containingCounty: '08035' },
    { type: 'cdp',   geoid: '0815165', label: 'Clifton (CDP)',          containingCounty: '08077' },
  ];

  // Cached resource files (curated for featured geos; can be expanded by ETL)

  const PATHS = {
    geoConfig: 'data/hna/geo-config.json',
    localResources: 'data/hna/local-resources.json',
    summary: (geoid) => `data/hna/summary/${geoid}.json`,
    lehd: (geoid) => `data/hna/lehd/${geoid}.json`,
    dolaSya: (countyFips5) => `data/hna/dola_sya/${countyFips5}.json`,
    projections: (countyFips5) => `data/hna/projections/${countyFips5}.json`,
    derived: 'data/hna/derived/geo-derived.json',
    acsDebugLog: 'data/hna/acs_debug_log.txt',
    lihtc: (countyFips5) => `data/hna/lihtc/${countyFips5}.json`,
    chasCostBurden: 'data/hna/chas_affordability_gap.json',
    blsEconIndicators: 'data/co-county-economic-indicators.json',
  };

  const SOURCES = {
    tigerweb: 'https://www.census.gov/data/developers/data-sets/TIGERweb-map-service.html',
    acsProfile: 'https://api.census.gov/data/2023/acs/acs1/profile/groups.html',
    acsS0801: 'https://api.census.gov/data/2023/acs/acs1/subject/groups/S0801.html',
    lodesRoot: 'https://lehd.ces.census.gov/data/lodes/LODES8/',
    lodesTech: 'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf',
    sdoDownloads: 'https://demography.dola.colorado.gov/assets/html/sdodata.html',
    sdoPopulation: 'https://demography.dola.colorado.gov/assets/html/population.html',
    prop123Commitments: 'https://cdola.colorado.gov/commitment-filings',
    lihtcDb: 'https://lihtc.huduser.gov/',
    hudQct: 'https://www.huduser.gov/portal/datasets/qct.html',
    hudDda: 'https://www.huduser.gov/portal/datasets/qct.html',
    chfaLihtcQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC/FeatureServer/0',
    hudLihtcQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0',
    hudQctQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Qualified_Census_Tracts_2026/FeatureServer/0', // Update year annually (e.g. Qualified_Census_Tracts_2027 when HUD publishes next cycle)
    hudDdaQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0', // Update year annually (e.g. Difficult_Development_Areas_2027 when HUD publishes next cycle)
  };

  // GitHub Pages backup base URL — used as a third-tier fallback when both live APIs and
  // local /data/ files are unavailable. Files are updated by the CI workflow on each
  // successful run of scripts/fetch-chfa-lihtc.js (and equivalent scripts).
  const GITHUB_PAGES_BASE = 'https://pggllc.github.io/Housing-Analytics';

  // Colorado LIHTC fallback data (representative projects; source: HUD LIHTC database)
  // Used only when the HUD ArcGIS API is unreachable. Includes the same fields returned by
  // the live API so popups render consistently in both paths.

  const LIHTC_FALLBACK_CO = {type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9903,39.7392]},properties:{PROJECT:'Lincoln Park Apartments',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:120,LI_UNITS:120,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9748,39.7519]},properties:{PROJECT:'Curtis Park Lofts',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2016,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9875,39.7281]},properties:{PROJECT:'Baker Senior Residences',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:55,LI_UNITS:55,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9620,39.7617]},properties:{PROJECT:'Five Points Commons',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:96,LI_UNITS:96,YR_PIS:2019,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8851,39.6784]},properties:{PROJECT:'Aurora Family Commons',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:150,LI_UNITS:150,YR_PIS:2021,CREDIT:'4%',QCT:0,DDA:1,CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005',STATEFP:'08',COUNTYFP:'005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8325,39.6950]},properties:{PROJECT:'Aurora Senior Village',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:90,LI_UNITS:90,YR_PIS:2019,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005',STATEFP:'08',COUNTYFP:'005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2705,40.0150]},properties:{PROJECT:'Boulder Commons',PROJ_CTY:'Boulder',PROJ_ST:'CO',N_UNITS:100,LI_UNITS:100,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Boulder',CNTY_FIPS:'08013',STATEFP:'08',COUNTYFP:'013'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8214,38.8339]},properties:{PROJECT:'Springs Family Village',PROJ_CTY:'Colorado Springs',PROJ_ST:'CO',N_UNITS:130,LI_UNITS:130,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:1,CNTY_NAME:'El Paso',CNTY_FIPS:'08041',STATEFP:'08',COUNTYFP:'041'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0844,40.5853]},properties:{PROJECT:'Fort Collins Commons',PROJ_CTY:'Fort Collins',PROJ_ST:'CO',N_UNITS:104,LI_UNITS:104,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Larimer',CNTY_FIPS:'08069',STATEFP:'08',COUNTYFP:'069'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6914,40.4233]},properties:{PROJECT:'Greeley Flats',PROJ_CTY:'Greeley',PROJ_ST:'CO',N_UNITS:90,LI_UNITS:90,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:1,CNTY_NAME:'Weld',CNTY_FIPS:'08123',STATEFP:'08',COUNTYFP:'123'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6091,38.2544]},properties:{PROJECT:'Pueblo Senior Manor',PROJ_CTY:'Pueblo',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2017,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Pueblo',CNTY_FIPS:'08101',STATEFP:'08',COUNTYFP:'101'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5506,39.0639]},properties:{PROJECT:'Grand Junction Crossroads',PROJ_CTY:'Grand Junction',PROJ_ST:'CO',N_UNITS:85,LI_UNITS:85,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Mesa',CNTY_FIPS:'08077',STATEFP:'08',COUNTYFP:'077'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5750,39.0850]},properties:{PROJECT:'Mesa Valley Apartments',PROJ_CTY:'Grand Junction',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2017,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Mesa',CNTY_FIPS:'08077',STATEFP:'08',COUNTYFP:'077'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,39.6433]},properties:{PROJECT:'Eagle Valley Workforce Housing',PROJ_CTY:'Eagle',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2022,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Eagle',CNTY_FIPS:'08037',STATEFP:'08',COUNTYFP:'037'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8801,37.2753]},properties:{PROJECT:'Durango Commons',PROJ_CTY:'Durango',PROJ_ST:'CO',N_UNITS:62,LI_UNITS:62,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'La Plata',CNTY_FIPS:'08067',STATEFP:'08',COUNTYFP:'067'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9211,39.6861]},properties:{PROJECT:'Englewood Family Flats',PROJ_CTY:'Englewood',PROJ_ST:'CO',N_UNITS:70,LI_UNITS:70,YR_PIS:2019,CREDIT:'4%',QCT:0,DDA:1,CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005',STATEFP:'08',COUNTYFP:'005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0211,39.5611]},properties:{PROJECT:'Littleton Senior Homes',PROJ_CTY:'Littleton',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005',STATEFP:'08',COUNTYFP:'005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9895,39.7617]},properties:{PROJECT:'Capitol Hill Residences',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:84,LI_UNITS:84,YR_PIS:2022,CREDIT:'4%',QCT:1,DDA:1,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0163,39.7392]},properties:{PROJECT:'West Colfax Commons',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:56,LI_UNITS:56,YR_PIS:2021,CREDIT:'9%',QCT:1,DDA:1,CNTY_NAME:'Denver',CNTY_FIPS:'08031',STATEFP:'08',COUNTYFP:'031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1311,39.7500]},properties:{PROJECT:'Lakewood Affordable Flats',PROJ_CTY:'Lakewood',PROJ_ST:'CO',N_UNITS:92,LI_UNITS:92,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Jefferson',CNTY_FIPS:'08059',STATEFP:'08',COUNTYFP:'059'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.9281,39.5480]},properties:{PROJECT:'Glenwood Springs Workforce',PROJ_CTY:'Glenwood Springs',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2022,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Garfield',CNTY_FIPS:'08045',STATEFP:'08',COUNTYFP:'045'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8069,40.3722]},properties:{PROJECT:'Loveland Family Housing',PROJ_CTY:'Loveland',PROJ_ST:'CO',N_UNITS:75,LI_UNITS:75,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Larimer',CNTY_FIPS:'08069',STATEFP:'08',COUNTYFP:'069'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.4222,38.4681]},properties:{PROJECT:'Cañon City Senior Village',PROJ_CTY:'Cañon City',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Fremont',CNTY_FIPS:'08043',STATEFP:'08',COUNTYFP:'043'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7506,38.2008]},properties:{PROJECT:'Pueblo West Apartments',PROJ_CTY:'Pueblo West',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Pueblo',CNTY_FIPS:'08101',STATEFP:'08',COUNTYFP:'101'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3131,37.4681]},properties:{PROJECT:'Alamosa Affordable Homes',PROJ_CTY:'Alamosa',PROJ_ST:'CO',N_UNITS:40,LI_UNITS:40,YR_PIS:2021,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Alamosa',CNTY_FIPS:'08003',STATEFP:'08',COUNTYFP:'003'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9719,39.8680]},properties:{PROJECT:'Thornton Senior Apartments',PROJ_CTY:'Thornton',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Adams',CNTY_FIPS:'08001',STATEFP:'08',COUNTYFP:'001'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9339,39.8033]},properties:{PROJECT:'Commerce City Workforce Homes',PROJ_CTY:'Commerce City',PROJ_ST:'CO',N_UNITS:88,LI_UNITS:88,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Adams',CNTY_FIPS:'08001',STATEFP:'08',COUNTYFP:'001'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8153,39.9853]},properties:{PROJECT:'Brighton Family Residences',PROJ_CTY:'Brighton',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2018,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Adams',CNTY_FIPS:'08001',STATEFP:'08',COUNTYFP:'001'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0375,39.8358]},properties:{PROJECT:'Westminster Affordable Flats',PROJ_CTY:'Westminster',PROJ_ST:'CO',N_UNITS:96,LI_UNITS:96,YR_PIS:2022,CREDIT:'4%',QCT:1,DDA:1,CNTY_NAME:'Adams',CNTY_FIPS:'08001',STATEFP:'08',COUNTYFP:'001'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0869,39.9205]},properties:{PROJECT:'Broomfield Commons',PROJ_CTY:'Broomfield',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Broomfield',CNTY_FIPS:'08014',STATEFP:'08',COUNTYFP:'014'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1175,39.9064]},properties:{PROJECT:'Interlocken Workforce Housing',PROJ_CTY:'Broomfield',PROJ_ST:'CO',N_UNITS:54,LI_UNITS:54,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Broomfield',CNTY_FIPS:'08014',STATEFP:'08',COUNTYFP:'014'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8561,39.3722]},properties:{PROJECT:'Castle Rock Affordable Homes',PROJ_CTY:'Castle Rock',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Douglas',CNTY_FIPS:'08035',STATEFP:'08',COUNTYFP:'035'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7614,39.5183]},properties:{PROJECT:'Parker Senior Residences',PROJ_CTY:'Parker',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Douglas',CNTY_FIPS:'08035',STATEFP:'08',COUNTYFP:'035'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9690,39.5541]},properties:{PROJECT:'Highlands Ranch Family Flats',PROJ_CTY:'Highlands Ranch',PROJ_ST:'CO',N_UNITS:74,LI_UNITS:74,YR_PIS:2022,CREDIT:'4%',QCT:0,DDA:1,CNTY_NAME:'Douglas',CNTY_FIPS:'08035',STATEFP:'08',COUNTYFP:'035'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.0678,39.6319]},properties:{PROJECT:'Silverthorne Workforce Apts',PROJ_CTY:'Silverthorne',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Summit',CNTY_FIPS:'08117',STATEFP:'08',COUNTYFP:'117'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.0444,39.4817]},properties:{PROJECT:'Breckenridge Affordable Housing',PROJ_CTY:'Breckenridge',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2018,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Summit',CNTY_FIPS:'08117',STATEFP:'08',COUNTYFP:'117'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.1253,39.5750]},properties:{PROJECT:'Frisco Family Homes',PROJ_CTY:'Frisco',PROJ_ST:'CO',N_UNITS:42,LI_UNITS:42,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Summit',CNTY_FIPS:'08117',STATEFP:'08',COUNTYFP:'117'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,40.4850]},properties:{PROJECT:'Steamboat Springs Workforce',PROJ_CTY:'Steamboat Springs',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2022,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Routt',CNTY_FIPS:'08107',STATEFP:'08',COUNTYFP:'107'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8417,40.4950]},properties:{PROJECT:'Steamboat Senior Village',PROJ_CTY:'Steamboat Springs',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Routt',CNTY_FIPS:'08107',STATEFP:'08',COUNTYFP:'107'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8122,37.9375]},properties:{PROJECT:'Telluride Affordable Homes',PROJ_CTY:'Telluride',PROJ_ST:'CO',N_UNITS:28,LI_UNITS:28,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'San Miguel',CNTY_FIPS:'08113',STATEFP:'08',COUNTYFP:'113'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8222,37.9275]},properties:{PROJECT:'Mountain Village Workforce Apts',PROJ_CTY:'Mountain Village',PROJ_ST:'CO',N_UNITS:24,LI_UNITS:24,YR_PIS:2018,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'San Miguel',CNTY_FIPS:'08113',STATEFP:'08',COUNTYFP:'113'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.8008,40.2508]},properties:{PROJECT:'Fort Morgan Affordable Apts',PROJ_CTY:'Fort Morgan',PROJ_ST:'CO',N_UNITS:56,LI_UNITS:56,YR_PIS:2019,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Morgan',CNTY_FIPS:'08087',STATEFP:'08',COUNTYFP:'087'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.8108,40.2608]},properties:{PROJECT:'Fort Morgan Senior Village',PROJ_CTY:'Fort Morgan',PROJ_ST:'CO',N_UNITS:40,LI_UNITS:40,YR_PIS:2017,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Morgan',CNTY_FIPS:'08087',STATEFP:'08',COUNTYFP:'087'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.2086,40.6253]},properties:{PROJECT:'Sterling Workforce Housing',PROJ_CTY:'Sterling',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Logan',CNTY_FIPS:'08075',STATEFP:'08',COUNTYFP:'075'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.2186,40.6153]},properties:{PROJECT:'Sterling Senior Residences',PROJ_CTY:'Sterling',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Logan',CNTY_FIPS:'08075',STATEFP:'08',COUNTYFP:'075'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8762,38.4783]},properties:{PROJECT:'Montrose Family Housing',PROJ_CTY:'Montrose',PROJ_ST:'CO',N_UNITS:64,LI_UNITS:64,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Montrose',CNTY_FIPS:'08085',STATEFP:'08',COUNTYFP:'085'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8862,38.4683]},properties:{PROJECT:'Montrose Senior Apts',PROJ_CTY:'Montrose',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Montrose',CNTY_FIPS:'08085',STATEFP:'08',COUNTYFP:'085'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.9817,38.6086]},properties:{PROJECT:'Olathe Affordable Homes',PROJ_CTY:'Olathe',PROJ_ST:'CO',N_UNITS:32,LI_UNITS:32,YR_PIS:2017,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Montrose',CNTY_FIPS:'08085',STATEFP:'08',COUNTYFP:'085'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.9253,38.5458]},properties:{PROJECT:'Gunnison Affordable Apts',PROJ_CTY:'Gunnison',PROJ_ST:'CO',N_UNITS:38,LI_UNITS:38,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Gunnison',CNTY_FIPS:'08051',STATEFP:'08',COUNTYFP:'051'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.9872,38.8697]},properties:{PROJECT:'Crested Butte Workforce Housing',PROJ_CTY:'Crested Butte',PROJ_ST:'CO',N_UNITS:22,LI_UNITS:22,YR_PIS:2022,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Gunnison',CNTY_FIPS:'08051',STATEFP:'08',COUNTYFP:'051'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.5008,37.1742]},properties:{PROJECT:'Trinidad Family Commons',PROJ_CTY:'Trinidad',PROJ_ST:'CO',N_UNITS:52,LI_UNITS:52,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Las Animas',CNTY_FIPS:'08071',STATEFP:'08',COUNTYFP:'071'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.5158,37.1642]},properties:{PROJECT:'Trinidad Senior Village',PROJ_CTY:'Trinidad',PROJ_ST:'CO',N_UNITS:40,LI_UNITS:40,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Las Animas',CNTY_FIPS:'08071',STATEFP:'08',COUNTYFP:'071'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.0081,37.2692]},properties:{PROJECT:'Pagosa Springs Workforce Apts',PROJ_CTY:'Pagosa Springs',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Archuleta',CNTY_FIPS:'08007',STATEFP:'08',COUNTYFP:'007'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.0181,37.2592]},properties:{PROJECT:'Pagosa Springs Affordable Homes',PROJ_CTY:'Pagosa Springs',PROJ_ST:'CO',N_UNITS:28,LI_UNITS:28,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Archuleta',CNTY_FIPS:'08007',STATEFP:'08',COUNTYFP:'007'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5856,37.3489]},properties:{PROJECT:'Cortez Family Housing',PROJ_CTY:'Cortez',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Montezuma',CNTY_FIPS:'08083',STATEFP:'08',COUNTYFP:'083'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5956,37.3389]},properties:{PROJECT:'Cortez Senior Apts',PROJ_CTY:'Cortez',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Montezuma',CNTY_FIPS:'08083',STATEFP:'08',COUNTYFP:'083'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.2878,37.3442]},properties:{PROJECT:'Mancos Affordable Homes',PROJ_CTY:'Mancos',PROJ_ST:'CO',N_UNITS:24,LI_UNITS:24,YR_PIS:2022,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Montezuma',CNTY_FIPS:'08083',STATEFP:'08',COUNTYFP:'083'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.9989,38.5347]},properties:{PROJECT:'Salida Family Homes',PROJ_CTY:'Salida',PROJ_ST:'CO',N_UNITS:46,LI_UNITS:46,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Chaffee',CNTY_FIPS:'08015',STATEFP:'08',COUNTYFP:'015'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.0089,38.5247]},properties:{PROJECT:'Salida Senior Residences',PROJ_CTY:'Salida',PROJ_ST:'CO',N_UNITS:34,LI_UNITS:34,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Chaffee',CNTY_FIPS:'08015',STATEFP:'08',COUNTYFP:'015'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.2922,39.2508]},properties:{PROJECT:'Leadville Affordable Apts',PROJ_CTY:'Leadville',PROJ_ST:'CO',N_UNITS:38,LI_UNITS:38,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Lake',CNTY_FIPS:'08065',STATEFP:'08',COUNTYFP:'065'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3022,39.2408]},properties:{PROJECT:'Leadville Senior Housing',PROJ_CTY:'Leadville',PROJ_ST:'CO',N_UNITS:28,LI_UNITS:28,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Lake',CNTY_FIPS:'08065',STATEFP:'08',COUNTYFP:'065'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.1494,37.5797]},properties:{PROJECT:'Monte Vista Workforce Housing',PROJ_CTY:'Monte Vista',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2019,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Rio Grande',CNTY_FIPS:'08105',STATEFP:'08',COUNTYFP:'105'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3494,37.6869]},properties:{PROJECT:'Del Norte Family Homes',PROJ_CTY:'Del Norte',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Rio Grande',CNTY_FIPS:'08105',STATEFP:'08',COUNTYFP:'105'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.5436,37.9847]},properties:{PROJECT:'La Junta Family Housing',PROJ_CTY:'La Junta',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2019,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Otero',CNTY_FIPS:'08089',STATEFP:'08',COUNTYFP:'089'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.5336,37.9947]},properties:{PROJECT:'La Junta Senior Apts',PROJ_CTY:'La Junta',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2017,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Otero',CNTY_FIPS:'08089',STATEFP:'08',COUNTYFP:'089'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-102.6208,38.0872]},properties:{PROJECT:'Lamar Affordable Homes',PROJ_CTY:'Lamar',PROJ_ST:'CO',N_UNITS:42,LI_UNITS:42,YR_PIS:2020,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Prowers',CNTY_FIPS:'08099',STATEFP:'08',COUNTYFP:'099'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-102.6308,38.0772]},properties:{PROJECT:'Lamar Senior Village',PROJ_CTY:'Lamar',PROJ_ST:'CO',N_UNITS:32,LI_UNITS:32,YR_PIS:2018,CREDIT:'9%',QCT:1,DDA:0,CNTY_NAME:'Prowers',CNTY_FIPS:'08099',STATEFP:'08',COUNTYFP:'099'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.9356,40.0878]},properties:{PROJECT:'Granby Workforce Housing',PROJ_CTY:'Granby',PROJ_ST:'CO',N_UNITS:34,LI_UNITS:34,YR_PIS:2021,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Grand',CNTY_FIPS:'08049',STATEFP:'08',COUNTYFP:'049'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.1031,40.0728]},properties:{PROJECT:'Hot Sulphur Springs Affordable',PROJ_CTY:'Hot Sulphur Springs',PROJ_ST:'CO',N_UNITS:20,LI_UNITS:20,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Grand',CNTY_FIPS:'08049',STATEFP:'08',COUNTYFP:'049'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0567,38.9939]},properties:{PROJECT:'Woodland Park Affordable Apts',PROJ_CTY:'Woodland Park',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Teller',CNTY_FIPS:'08119',STATEFP:'08',COUNTYFP:'119'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0667,38.9839]},properties:{PROJECT:'Woodland Park Senior Homes',PROJ_CTY:'Woodland Park',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2018,CREDIT:'9%',QCT:0,DDA:1,CNTY_NAME:'Teller',CNTY_FIPS:'08119',STATEFP:'08',COUNTYFP:'119'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.5567,40.1722]},properties:{PROJECT:'Brush Family Affordable Apts',PROJ_CTY:'Brush',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2019,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Morgan',CNTY_FIPS:'08087',STATEFP:'08',COUNTYFP:'087'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.0197,40.1583]},properties:{PROJECT:'Wiggins Senior Village',PROJ_CTY:'Wiggins',PROJ_ST:'CO',N_UNITS:24,LI_UNITS:24,YR_PIS:2020,CREDIT:'9%',QCT:0,DDA:0,CNTY_NAME:'Morgan',CNTY_FIPS:'08087',STATEFP:'08',COUNTYFP:'087'}},
  ]};

  // Colorado QCT (Qualified Census Tract) embedded fallback data
  // Used when both the live HUD ArcGIS API and the local data/qct-colorado.json are unavailable.
  // Source: HUD Qualified Census Tracts list; representative tracts across Colorado counties.
  const QCT_FALLBACK_CO = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Globeville QCT',GEOID:'08031006700',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-105.000,39.772],[-104.940,39.772],[-104.940,39.790],[-105.000,39.790],[-105.000,39.772]]]}},
    {type:'Feature',properties:{NAME:'Denver-Five Points QCT',GEOID:'08031007700',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-104.982,39.745],[-104.940,39.745],[-104.940,39.768],[-104.982,39.768],[-104.982,39.745]]]}},
    {type:'Feature',properties:{NAME:'Denver-Sun Valley QCT',GEOID:'08031006800',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-105.010,39.720],[-104.975,39.720],[-104.975,39.740],[-105.010,39.740],[-105.010,39.720]]]}},
    {type:'Feature',properties:{NAME:'Denver-Montbello QCT',GEOID:'08031004601',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-104.955,39.760],[-104.910,39.760],[-104.910,39.810],[-104.955,39.810],[-104.955,39.760]]]}},
    {type:'Feature',properties:{NAME:'Denver-Westwood QCT',GEOID:'08031007400',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-105.050,39.680],[-104.995,39.680],[-104.995,39.718],[-105.050,39.718],[-105.050,39.680]]]}},
    {type:'Feature',properties:{NAME:'Denver-Villa Park QCT',GEOID:'08031008200',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-105.030,39.730],[-104.995,39.730],[-104.995,39.755],[-105.030,39.755],[-105.030,39.730]]]}},
    {type:'Feature',properties:{NAME:'Denver-Barnum QCT',GEOID:'08031008500',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-105.043,39.700],[-105.000,39.700],[-105.000,39.725],[-105.043,39.725],[-105.043,39.700]]]}},
    {type:'Feature',properties:{NAME:'Denver-Swansea QCT',GEOID:'08031009100',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-104.966,39.760],[-104.930,39.760],[-104.930,39.785],[-104.966,39.785],[-104.966,39.760]]]}},
    {type:'Feature',properties:{NAME:'Denver-Capitol Hill QCT',GEOID:'08031003200',STATEFP:'08',COUNTYFP:'031'},geometry:{type:'Polygon',coordinates:[[[-104.975,39.730],[-104.940,39.730],[-104.940,39.748],[-104.975,39.748],[-104.975,39.730]]]}},
    {type:'Feature',properties:{NAME:'Aurora-Colfax QCT',GEOID:'08005011020',STATEFP:'08',COUNTYFP:'005'},geometry:{type:'Polygon',coordinates:[[[-104.900,39.720],[-104.840,39.720],[-104.840,39.750],[-104.900,39.750],[-104.900,39.720]]]}},
    {type:'Feature',properties:{NAME:'Aurora-East QCT',GEOID:'08005011800',STATEFP:'08',COUNTYFP:'005'},geometry:{type:'Polygon',coordinates:[[[-104.840,39.686],[-104.780,39.686],[-104.780,39.710],[-104.840,39.710],[-104.840,39.686]]]}},
    {type:'Feature',properties:{NAME:'Westminster Federal QCT',GEOID:'08001012900',STATEFP:'08',COUNTYFP:'001'},geometry:{type:'Polygon',coordinates:[[[-105.040,39.843],[-104.990,39.843],[-104.990,39.868],[-105.040,39.868],[-105.040,39.843]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs-Downtown QCT',GEOID:'08041003200',STATEFP:'08',COUNTYFP:'041'},geometry:{type:'Polygon',coordinates:[[[-104.851,38.820],[-104.800,38.820],[-104.800,38.858],[-104.851,38.858],[-104.851,38.820]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs-East QCT',GEOID:'08041004100',STATEFP:'08',COUNTYFP:'041'},geometry:{type:'Polygon',coordinates:[[[-104.800,38.820],[-104.730,38.820],[-104.730,38.860],[-104.800,38.860],[-104.800,38.820]]]}},
    {type:'Feature',properties:{NAME:'Pueblo-Downtown QCT',GEOID:'08101000300',STATEFP:'08',COUNTYFP:'101'},geometry:{type:'Polygon',coordinates:[[[-104.635,38.238],[-104.580,38.238],[-104.580,38.278],[-104.635,38.278],[-104.635,38.238]]]}},
    {type:'Feature',properties:{NAME:'Pueblo-North QCT',GEOID:'08101000400',STATEFP:'08',COUNTYFP:'101'},geometry:{type:'Polygon',coordinates:[[[-104.640,38.278],[-104.575,38.278],[-104.575,38.310],[-104.640,38.310],[-104.640,38.278]]]}},
    {type:'Feature',properties:{NAME:'Greeley QCT',GEOID:'08123000500',STATEFP:'08',COUNTYFP:'123'},geometry:{type:'Polygon',coordinates:[[[-104.730,40.404],[-104.670,40.404],[-104.670,40.440],[-104.730,40.440],[-104.730,40.404]]]}},
    {type:'Feature',properties:{NAME:'Evans QCT',GEOID:'08123000700',STATEFP:'08',COUNTYFP:'123'},geometry:{type:'Polygon',coordinates:[[[-104.730,40.380],[-104.680,40.380],[-104.680,40.404],[-104.730,40.404],[-104.730,40.380]]]}},
    {type:'Feature',properties:{NAME:'Longmont East QCT',GEOID:'08013001900',STATEFP:'08',COUNTYFP:'013'},geometry:{type:'Polygon',coordinates:[[[-105.120,40.148],[-105.070,40.148],[-105.070,40.182],[-105.120,40.182],[-105.120,40.148]]]}},
    {type:'Feature',properties:{NAME:'Grand Junction QCT',GEOID:'08077000200',STATEFP:'08',COUNTYFP:'077'},geometry:{type:'Polygon',coordinates:[[[-108.590,39.048],[-108.530,39.048],[-108.530,39.085],[-108.590,39.085],[-108.590,39.048]]]}},
    {type:'Feature',properties:{NAME:'Fort Morgan QCT',GEOID:'08087000300',STATEFP:'08',COUNTYFP:'087'},geometry:{type:'Polygon',coordinates:[[[-103.840,40.244],[-103.780,40.244],[-103.780,40.272],[-103.840,40.272],[-103.840,40.244]]]}},
    {type:'Feature',properties:{NAME:'Sterling QCT',GEOID:'08075001100',STATEFP:'08',COUNTYFP:'075'},geometry:{type:'Polygon',coordinates:[[[-103.250,40.598],[-103.195,40.598],[-103.195,40.634],[-103.250,40.634],[-103.250,40.598]]]}},
    {type:'Feature',properties:{NAME:'Alamosa QCT',GEOID:'08003000600',STATEFP:'08',COUNTYFP:'003'},geometry:{type:'Polygon',coordinates:[[[-105.910,37.454],[-105.848,37.454],[-105.848,37.490],[-105.910,37.490],[-105.910,37.454]]]}},
    {type:'Feature',properties:{NAME:'Trinidad QCT',GEOID:'08071000500',STATEFP:'08',COUNTYFP:'071'},geometry:{type:'Polygon',coordinates:[[[-104.590,37.160],[-104.520,37.160],[-104.520,37.192],[-104.590,37.192],[-104.590,37.160]]]}},
    {type:'Feature',properties:{NAME:'Walsenburg QCT',GEOID:'08055000200',STATEFP:'08',COUNTYFP:'055'},geometry:{type:'Polygon',coordinates:[[[-104.805,37.620],[-104.760,37.620],[-104.760,37.645],[-104.805,37.645],[-104.805,37.620]]]}},
    {type:'Feature',properties:{NAME:'Cañon City QCT',GEOID:'08043000500',STATEFP:'08',COUNTYFP:'043'},geometry:{type:'Polygon',coordinates:[[[-105.260,38.427],[-105.200,38.427],[-105.200,38.456],[-105.260,38.456],[-105.260,38.427]]]}},
    {type:'Feature',properties:{NAME:'Las Animas QCT',GEOID:'08011000200',STATEFP:'08',COUNTYFP:'011'},geometry:{type:'Polygon',coordinates:[[[-103.240,38.058],[-103.180,38.058],[-103.180,38.082],[-103.240,38.082],[-103.240,38.058]]]}},
  ]};

  // Colorado DDA (Difficult Development Area) embedded fallback data
  // Used when both the live HUD ArcGIS API and the local data/dda-colorado.json are unavailable.
  // Source: HUD 2025 DDA list; representative Colorado DDA areas.
  const DDA_FALLBACK_CO = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Aurora Metro DDA',DDATYPE:'Metropolitan',STATE:'CO',COUNTIES:['001','005','014','019','031','035','039','047','059','093']},geometry:{type:'Polygon',coordinates:[[[-105.15,39.55],[-104.67,39.55],[-104.67,39.98],[-105.15,39.98],[-105.15,39.55]]]}},
    {type:'Feature',properties:{NAME:'Boulder-Broomfield DDA',DDATYPE:'Metropolitan',STATE:'CO',COUNTIES:['013','014']},geometry:{type:'Polygon',coordinates:[[[-105.35,39.95],[-104.98,39.95],[-104.98,40.15],[-105.35,40.15],[-105.35,39.95]]]}},
    {type:'Feature',properties:{NAME:'Fort Collins DDA',DDATYPE:'Metropolitan',STATE:'CO',COUNTIES:['069']},geometry:{type:'Polygon',coordinates:[[[-105.20,40.52],[-104.98,40.52],[-104.98,40.66],[-105.20,40.66],[-105.20,40.52]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs DDA',DDATYPE:'Metropolitan',STATE:'CO',COUNTIES:['041','119']},geometry:{type:'Polygon',coordinates:[[[-105.19,38.69],[-104.60,38.69],[-104.60,39.08],[-105.19,39.08],[-105.19,38.69]]]}},
    {type:'Feature',properties:{NAME:'Greeley DDA',DDATYPE:'Metropolitan',STATE:'CO',COUNTIES:['123']},geometry:{type:'Polygon',coordinates:[[[-104.90,40.28],[-104.55,40.28],[-104.55,40.55],[-104.90,40.55],[-104.90,40.28]]]}},
    {type:'Feature',properties:{NAME:'Eagle County DDA',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO',COUNTIES:['037']},geometry:{type:'Polygon',coordinates:[[[-107.18,39.44],[-106.29,39.44],[-106.29,39.74],[-107.18,39.74],[-107.18,39.44]]]}},
    {type:'Feature',properties:{NAME:'Summit County DDA',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO',COUNTIES:['117']},geometry:{type:'Polygon',coordinates:[[[-106.38,39.38],[-105.73,39.38],[-105.73,39.66],[-106.38,39.66],[-106.38,39.38]]]}},
    {type:'Feature',properties:{NAME:'Pitkin County DDA (Aspen)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO',COUNTIES:['097']},geometry:{type:'Polygon',coordinates:[[[-107.26,39.12],[-106.68,39.12],[-106.68,39.38],[-107.26,39.38],[-107.26,39.12]]]}},
    {type:'Feature',properties:{NAME:'San Miguel County DDA (Telluride)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO',COUNTIES:['113']},geometry:{type:'Polygon',coordinates:[[[-108.20,37.82],[-107.38,37.82],[-107.38,38.15],[-108.20,38.15],[-108.20,37.82]]]}},
    {type:'Feature',properties:{NAME:'Routt County DDA (Steamboat)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO',COUNTIES:['107']},geometry:{type:'Polygon',coordinates:[[[-107.28,40.25],[-106.46,40.25],[-106.46,40.74],[-107.28,40.74],[-107.28,40.25]]]}},
    {type:'Feature',properties:{NAME:'Garfield County DDA',DDATYPE:'Non-Metropolitan',STATE:'CO',COUNTIES:['045']},geometry:{type:'Polygon',coordinates:[[[-108.10,39.30],[-107.06,39.30],[-107.06,39.75],[-108.10,39.75],[-108.10,39.30]]]}},
    {type:'Feature',properties:{NAME:'La Plata County DDA (Durango)',DDATYPE:'Non-Metropolitan',STATE:'CO',COUNTIES:['067']},geometry:{type:'Polygon',coordinates:[[[-108.12,37.06],[-107.30,37.06],[-107.30,37.58],[-108.12,37.58],[-108.12,37.06]]]}},
  ]};

  // Colorado DDA (Difficult Development Area) designation lookup
  // Based on HUD 2025 DDA list; covers counties within HUD Metro FMR Areas that qualify.
  // Source: https://www.huduser.gov/portal/datasets/qct.html
  const CO_DDA = {
    '08001': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Adams
    '08005': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Arapahoe
    '08013': { status: true,  area: 'Boulder HUD Metro FMR Area' },                  // Boulder
    '08014': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Broomfield
    '08019': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Clear Creek
    '08031': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Denver
    '08035': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Douglas
    '08037': { status: true,  area: 'Edwards HUD Metro FMR Area (Eagle County)' },   // Eagle
    '08039': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Elbert
    '08041': { status: true,  area: 'Colorado Springs HUD Metro FMR Area' },          // El Paso
    '08047': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Gilpin
    '08059': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Jefferson
    '08069': { status: true,  area: 'Fort Collins HUD Metro FMR Area' },             // Larimer
    '08093': { status: true,  area: 'Denver-Aurora-Lakewood HUD Metro FMR Area' },   // Park
    '08097': { status: true,  area: 'Aspen HUD Metro FMR Area (Pitkin County)' },    // Pitkin
    '08117': { status: true,  area: 'Summit County HUD Metro FMR Area' },            // Summit
    '08119': { status: true,  area: 'Colorado Springs HUD Metro FMR Area' },          // Teller
    '08123': { status: true,  area: 'Greeley HUD Metro FMR Area' },                  // Weld
  };

  // DOM

  function fmtNum(n){
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (v === -666666666) return '—';
    return v.toLocaleString(undefined,{maximumFractionDigits:0});
  }
  function fmtMoney(n){
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (v === -666666666) return '—';
    return v.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});
  }
  function fmtPct(n){
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (v === -666666666) return '—';
    return `${v.toFixed(1)}%`;
  }

  /**
   * Build a data.census.gov table URL with the correct geography filter
   * so users can explore the underlying data.
   * @param {number|null} year  - ACS vintage year (e.g. 2024)
   * @param {string} series    - 'acs1' or 'acs5'
   * @param {string} table     - table code, e.g. 'DP04', 'DP05', 'S0801'
   * @param {string|null} geoType - 'county', 'place', 'cdp', or null (national)
   * @param {string|null} geoid   - FIPS geoid (5-digit county or 7-digit place)
   * @returns {string|null}
   */
  function censusSourceUrl(year, series, table, geoType, geoid){
    if (!year || !table) return null;
    const seriesCode = (series === 'acs1') ? '1Y' : '5Y';
    // data.census.gov table ID prefix by table type:
    //   S-prefix (Subject)  → ACSST{seriesCode}
    //   B-prefix (Detailed) → ACSDT{seriesCode}
    //   DP-prefix (Profile) → ACSDP{seriesCode}
    const prefix = table.startsWith('S') ? `ACSST${seriesCode}`
                 : table.startsWith('B') ? `ACSDT${seriesCode}`
                 : `ACSDP${seriesCode}`;
    const tableId = `${prefix}${year}.${table}`;
    let geoCode = '0100000US'; // default: national
    if (geoType === 'county' && geoid) {
      geoCode = `0500000US${geoid}`;
    } else if ((geoType === 'place' || geoType === 'cdp') && geoid) {
      geoCode = `1600000US${geoid}`;
    }
    return `https://data.census.gov/table/${tableId}?g=${geoCode}`;
  }

  /**
   * Render a source badge string (safe HTML) showing the ACS year, table label,
   * and a clickable [Source] link to data.census.gov.
   */
  function srcLink(tableLabel, year, series, table, geoType, geoid){
    const yearStr = year ? ` ${year}` : '';
    const url = censusSourceUrl(year, series, table, geoType, geoid);
    const link = url
      ? ` · <a href="${url}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline" title="View source table on data.census.gov">[Source]</a>`
      : '';
    return `ACS${yearStr} ${tableLabel}${link}`;
  }


  function safeNum(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }


  /**
   * Map a Colorado geography (place / CDP / county / state) to its
   * containing 5-digit county FIPS.
   *
   * Lookup order:
   *   1. county type → return the geoid itself
   *   2. state type  → return null (no single containing county)
   *   3. window.__HNA_GEO_CONFIG (fast in-memory path for featured geos)
   *   4. window.__HNA_GEOGRAPHY_REGISTRY (full 513-entry place/CDP map,
   *      loaded once from data/hna/geography-registry.json on first use)
   *   5. Otherwise return null — never fabricate a containing county.
   *
   * Previously, this function defaulted to '08077' (Mesa County) for any
   * place/CDP not present in the small `__HNA_GEO_CONFIG` lists. That
   * was the source of the "Fruita/Boulder anomaly" — Boulder city
   * (0807850) wasn't in the config, so the comparison panel would silently
   * pull MESA County data and label it as Boulder. Now: missing entries
   * return null, callers fall back to state-level data or show a
   * "county unknown" message.
   */
  function countyFromGeoid(geoType, geoid){
    if (geoType === 'county') return geoid;
    if (geoType === 'state')  return null;

    // Fast path: HNA_GEO_CONFIG (featured/places/cdps in-memory)
    const conf = window.__HNA_GEO_CONFIG;
    if (conf) {
      const allEntries = [
        ...(conf.featured || []),
        ...(conf.places   || []),
        ...(conf.cdps     || []),
      ];
      const match = allEntries.find(x => x.geoid === geoid);
      if (match?.containingCounty) return match.containingCounty;
    }

    // Canonical path: full geography registry (covers all 513 CO places/CDPs)
    const registry = window.__HNA_GEOGRAPHY_REGISTRY;
    if (registry && Array.isArray(registry.geographies)) {
      const reg = registry.geographies.find(g => g.geoid === geoid);
      if (reg?.containingCounty) return reg.containingCounty;
    }

    // Genuinely unknown — return null rather than fabricating Mesa County.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[HNAUtils] countyFromGeoid: no containing county for geoid', geoid,
        '(type=' + geoType + '). Comparison panels will fall back to state-level data.');
    }
    return null;
  }

  /**
   * Lazily load `data/hna/geography-registry.json` and cache it on
   * `window.__HNA_GEOGRAPHY_REGISTRY`. Idempotent. Returns the registry
   * object on success, or null if loading failed (e.g. file missing).
   *
   * Callers should `await ensureGeographyRegistry()` before relying on
   * `countyFromGeoid` for non-featured places.
   */
  let _registryLoadPromise = null;
  function ensureGeographyRegistry(){
    if (window.__HNA_GEOGRAPHY_REGISTRY) {
      return Promise.resolve(window.__HNA_GEOGRAPHY_REGISTRY);
    }
    if (_registryLoadPromise) return _registryLoadPromise;
    const path = (typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl('data/hna/geography-registry.json')
      : 'data/hna/geography-registry.json';
    _registryLoadPromise = fetch(path)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.geographies)) {
          window.__HNA_GEOGRAPHY_REGISTRY = data;
          return data;
        }
        return null;
      })
      .catch(err => {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[HNAUtils] geography-registry.json load failed:', err && err.message);
        }
        return null;
      });
    return _registryLoadPromise;
  }


  const BOUNDARY_STYLES = {
    county: { weight: 2,   color: '#2b6cb0', fillOpacity: 0.06 },
    place:  { weight: 3,   color: '#096e65', fillOpacity: 0.10 },
    cdp:    { weight: 3,   color: '#7c3d00', fillOpacity: 0.10 },
    state:  { weight: 1.5, color: '#2b6cb0', fillOpacity: 0.04 },
  };


  function lihtcFallbackForCounty(countyFips5){
    const features = LIHTC_FALLBACK_CO.features.filter(f =>
      !countyFips5 || (f.properties.CNTY_FIPS || '') === countyFips5
    );
    return { type: 'FeatureCollection', features };
  }

  // Fetch LIHTC projects for a county or for the whole state.
  // Pass a 5-digit county FIPS (e.g. '08077') for county-level results, or the
  // 2-digit Colorado state FIPS ('08') to get all statewide LIHTC projects.
  // For Colorado, data/chfa-lihtc.json (the canonical local file, kept current by CI)
  // is always tried first. Remote ArcGIS APIs (CHFA, then HUD) are only attempted when the
  // local file is absent (HTTP 404). For all other states, HUD ArcGIS is the live source.
  // The returned GeoJSON includes a _source field ('local' | 'CHFA' | 'HUD' | 'fallback').

  function lihtcSourceInfo(source) {
    if (source === 'CHFA')  return { label: 'CHFA (Colorado Housing and Finance Authority)', color: '#0ea5e9' };
    if (source === 'local') return { label: 'Local CHFA data (chfa-lihtc.json)', color: '#16a34a' };
    if (source === 'HUD')   return { label: 'HUD LIHTC Database', color: '#6366f1' };
    return                         { label: 'HUD LIHTC Database (embedded)', color: '#6366f1' };
  }

  // Helper: build rich LIHTC popup HTML (mirrors colorado-deep-dive popup style)
  // source: 'CHFA' | 'HUD' | 'fallback' — indicates which data source provided this record
  function lihtcPopupHtml(p, source) {
    const safe = v => (v == null || v === '') ? '—' : String(v);
    const yn   = v => (v === 1 || v === '1' || v === 'Y' || v === true)
      ? '<span style="color:#34d399">Yes</span>'
      : '<span style="color:#94a3b8">No</span>';
    const addr = [p.STD_ADDR || p.PROJ_ADD, p.STD_CITY || p.PROJ_CTY, p.STD_ST || p.PROJ_ST, p.STD_ZIP5]
      .filter(Boolean).join(', ');
    const { label: srcLabel } = lihtcSourceInfo(source);
    return `<div style="min-width:220px;max-width:280px;font-size:13px">
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;line-height:1.3">${safe(p.PROJECT || p.PROJ_NM) || 'LIHTC Project'}</div>
      ${addr ? `<div style="margin-bottom:6px;opacity:.8">${addr}</div>` : ''}
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:2px 0;opacity:.7">Total units</td><td style="text-align:right;font-weight:700">${safe(p.N_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Low-income units</td><td style="text-align:right;font-weight:700">${safe(p.LI_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Placed in service</td><td style="text-align:right">${safe(p.YR_PIS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">Credit type</td><td style="text-align:right">${safe(p.CREDIT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">QCT</td><td style="text-align:right">${yn(p.QCT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">DDA</td><td style="text-align:right">${yn(p.DDA)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7">County</td><td style="text-align:right">${safe(p.CNTY_NAME || p.PROJ_CTY)}</td></tr>
        ${p.HUD_ID ? `<tr><td style="padding:2px 0;opacity:.7">HUD ID</td><td style="text-align:right;font-size:11px">${safe(p.HUD_ID)}</td></tr>` : ''}
      </table>
      <div style="margin-top:6px;font-size:11px;opacity:.55">Source: ${srcLabel}</div>
    </div>`;
  }

  // Build (or rebuild) the "LIHTC projects in area (top 10 by units)" info panel
  // using features that fall within the current map viewport bounds.

  function censusKey(){
    return (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : '';
  }

  // Warn once per page load when CENSUS_API_KEY is absent so developers can
  // diagnose 400/403 failures without digging through network traffic.

  const NAICS_LABELS = {
    CNS01: 'Agriculture & Forestry',
    CNS02: 'Mining & Oil/Gas',
    CNS03: 'Utilities',
    CNS04: 'Construction',
    CNS05: 'Manufacturing',
    CNS06: 'Wholesale Trade',
    CNS07: 'Retail Trade',
    CNS08: 'Transportation & Warehousing',
    CNS09: 'Information',
    CNS10: 'Finance & Insurance',
    CNS11: 'Real Estate',
    CNS12: 'Professional & Technical Services',
    CNS13: 'Management',
    CNS14: 'Administrative & Support',
    CNS15: 'Educational Services',
    CNS16: 'Health Care & Social Assistance',
    CNS17: 'Arts & Entertainment',
    CNS18: 'Accommodation & Food Services',
    CNS19: 'Other Services',
    CNS20: 'Public Administration',
  };

  // Approximate annual wage midpoints for LEHD WAC wage bands (CE01–CE03).
  // CE01: ≤ $1,250/month → ≤ $15,000/year
  // CE02: $1,251–$3,333/month → midpoint ≈ $27,500/year
  // CE03: > $3,333/month → representative midpoint ≈ $55,000/year
  const WAGE_BAND_ANNUAL = { low: 15000, medium: 27500, high: 55000 };

  /**
   * Calculate high-level job metrics from LEHD data.
   * Supports both WAC (full) and OD-only (inflow/outflow/within) data shapes.
   * @param {object} lehd - LEHD JSON object
   * @param {object|null} profile - ACS profile for population (J:W ratio denominator)
   * @returns {object} metrics object
   */
  function calculateJobMetrics(lehd, profile) {
    if (!lehd) return null;
    const totalJobs = Number(lehd.C000) || null;  // WAC total jobs field
    const within    = Number(lehd.within)  || 0;
    const inflow    = Number(lehd.inflow)  || 0;
    const outflow   = Number(lehd.outflow) || 0;

    // If WAC C000 present use it; otherwise fall back to within+inflow (OD-based)
    const jobs = Number.isFinite(totalJobs) && totalJobs > 0
      ? totalJobs
      : (within + inflow > 0 ? within + inflow : null);

    const pop = Number(profile?.DP05_0001E) || null;
    // Workers ≈ labour-force participants; ~47% is a conservative approximation of the
    // civilian employment-population ratio (BLS FRED series EMRATIO hovers ~59–61% for all
    // ages, but including non-working-age population gives roughly 46–48% for total pop).
    // This is used only as a J:W ratio denominator when no local labour-force count is cached.
    const workers = pop ? Math.round(pop * 0.47) : null;
    const jwRatio = (jobs && workers && workers > 0) ? (jobs / workers) : null;

    return { jobs, within, inflow, outflow, jwRatio };
  }

  /**
   * Parse top-N industries from LEHD WAC CNS fields.
   * Returns [] if no WAC data available.
   * @param {object} lehd
   * @param {number} topN
   * @returns {Array<{label, count}>}
   */
  function parseIndustries(lehd, topN) {
    topN = topN || 5;
    if (!lehd) return [];
    const entries = [];
    Object.keys(NAICS_LABELS).forEach(function(key) {
      const count = Number(lehd[key]);
      if (Number.isFinite(count) && count > 0) {
        entries.push({ label: NAICS_LABELS[key], count: count });
      }
    });
    // Fallback: state-aggregate and pipeline-generated files may store industries as a
    // pre-sorted array instead of flat CNS root fields (e.g. data/hna/lehd/08.json).
    if (!entries.length && Array.isArray(lehd.industries)) {
      return lehd.industries
        .filter(function(d) { return d && Number.isFinite(Number(d.count)) && Number(d.count) > 0; })
        .slice(0, topN)
        .map(function(d) { return { label: d.label || d.naics, count: Number(d.count) }; });
    }
    if (!entries.length) return [];
    entries.sort(function(a, b) { return b.count - a.count; });
    return entries.slice(0, topN);
  }

  /**
   * Calculate wage distribution from LEHD WAC CE01/CE02/CE03 fields.
   * Falls back to annualWages[latest year] when root CE fields are absent
   * (e.g. state-aggregate file stores wage tiers under annualWages[year].low/medium/high).
   * @param {object} lehd
   * @returns {{low, medium, high, total}|null}
   */
  function calculateWageDistribution(lehd) {
    if (!lehd) return null;
    var low    = Number(lehd.CE01);  // ≤ $1,250/month
    var medium = Number(lehd.CE02);  // $1,251–$3,333/month
    var high   = Number(lehd.CE03);  // > $3,333/month

    // Fallback: use most-recent year from annualWages when root CE fields are absent.
    if (!Number.isFinite(low) && !Number.isFinite(medium) && !Number.isFinite(high)) {
      var wages = lehd.annualWages;
      if (wages && typeof wages === 'object') {
        var years = Object.keys(wages).sort();
        var latest = wages[years[years.length - 1]];
        if (latest) {
          low    = Number(latest.low);
          medium = Number(latest.medium);
          high   = Number(latest.high);
        }
      }
    }

    if (!Number.isFinite(low) && !Number.isFinite(medium) && !Number.isFinite(high)) return null;
    const l = Number.isFinite(low)    ? low    : 0;
    const m = Number.isFinite(medium) ? medium : 0;
    const h = Number.isFinite(high)   ? high   : 0;
    const total = l + m + h;
    if (total === 0) return null;
    return { low: l, medium: m, high: h, total };
  }

  // ---------------------------------------------------------------
  // Prop 123 / HB 22-1093 helpers
  // ---------------------------------------------------------------

  // Population thresholds for eligibility (per HB 22-1093)

  const PROP123_MUNICIPALITY_THRESHOLD = 1000;
  const PROP123_COUNTY_THRESHOLD       = 5000;
  // Required annual growth rate (3%)
  const PROP123_GROWTH_RATE = 0.03;

  /**
   * Regional AMI factors for Prop 123 baseline estimation.
   * Replaces the uniform 0.70 national approximation with county-specific
   * factors based on HUD CHAS income-rent relationship analysis.
   *
   * High-cost markets: fewer not-burdened renters are actually at ≤60% AMI
   * because local incomes are higher (many "not-burdened" households earn >60% AMI).
   * Low-cost markets: more not-burdened renters are at ≤60% AMI.
   *
   * Methodology: derived from 2017-2021 CHAS B25106 cross-tabulations comparing
   * not-burdened renter share to actual ≤60% AMI renter share by county group.
   */
  const REGIONAL_AMI_FACTORS = {
    // High-cost resort/mountain (AMI >$100K) — factor 0.45-0.55
    '08097': 0.50, // Pitkin (Aspen)
    '08117': 0.50, // Summit (Breckenridge)
    '08113': 0.50, // San Miguel (Telluride)
    '08037': 0.55, // Eagle (Vail)
    '08107': 0.55, // Routt (Steamboat)
    '08019': 0.55, // Clear Creek
    '08093': 0.55, // Park

    // Metro/urban (AMI $75K-$100K) — factor 0.60-0.65
    '08031': 0.63, // Denver
    '08001': 0.63, // Adams
    '08005': 0.63, // Arapahoe
    '08059': 0.63, // Jefferson
    '08035': 0.60, // Douglas (higher incomes)
    '08014': 0.63, // Broomfield
    '08013': 0.60, // Boulder
    '08069': 0.65, // Larimer (Fort Collins)
    '08123': 0.65, // Weld (Greeley)
    '08041': 0.67, // El Paso (Colorado Springs)

    // Mid-range metro/suburban (AMI $65K-$75K) — factor 0.68-0.72
    '08077': 0.70, // Mesa (Grand Junction)
    '08067': 0.70, // La Plata (Durango)
    '08045': 0.68, // Garfield (Glenwood Springs)
    '08043': 0.70, // Fremont
    '08029': 0.70, // Delta

    // Rural/low-cost (AMI <$65K) — factor 0.75-0.85
    '08101': 0.75, // Pueblo
    '08099': 0.78, // Prowers
    '08089': 0.78, // Otero
    '08025': 0.80, // Crowley
    '08011': 0.80, // Bent
    '08021': 0.80, // Conejos
    '08023': 0.80, // Costilla
    '08079': 0.82, // Mineral
    '08083': 0.78, // Montezuma
    '08003': 0.78, // Alamosa
    '08105': 0.78, // Rio Grande
    '08109': 0.78, // Saguache
  };
  const DEFAULT_AMI_FACTOR = 0.70;

  /**
   * Estimate count of 60% AMI rental units from ACS profile data.
   * Uses ACS DP04 GRAPI bins as a proxy:
   *   - Total renter-occupied units (DP04_0003E - vacant, or derived from tenure pct)
   *   - Affordability proxy: units paying < 30% income (not rent-burdened) as a proxy for
   *     units affordable at ≤60% AMI.  This is an approximation — true 60% AMI counts
   *     require ACS B25106 cross-tabulations not in the DP04 profile.
   *
   * ACS DP04 fields used:
   *   DP04_0001E  - Total housing units
   *   DP04_0047PE - Renter-occupied (%)
   *   DP04_0003E  - Occupied housing units
   *   DP04_0144PE - GRAPI <15%
   *   DP04_0145PE - GRAPI 15-19.9%
   *   DP04_0146PE - GRAPI 20-24.9%  (not burdened)
   *
   * @param {object} profile - ACS profile (DP04 fields)
   * @returns {{baseline60Ami, totalRentals, pctOfStock, method}|null}
   */

  /**
   * @param {object} profile - ACS profile (DP04 fields)
   * @param {string} [countyFips] - 5-digit county FIPS for regional AMI factor lookup
   */
  function calculateBaseline(profile, countyFips) {
    if (!profile) return null;

    const totalUnits  = Number(profile.DP04_0001E);
    const renterPct   = Number(profile.DP04_0047PE);  // e.g. 27.5
    const occupiedUnits = Number(profile.DP04_0003E);

    if (!Number.isFinite(totalUnits) || totalUnits <= 0) return null;
    if (!Number.isFinite(renterPct)  || renterPct  <= 0) return null;

    // Estimate total renter-occupied units
    const totalRentals = Math.round(totalUnits * (renterPct / 100));
    if (totalRentals <= 0) return null;

    // GRAPI bins: <15%, 15-19.9%, 20-24.9% are not-burdened (paying <30% income)
    // Use these as a proxy for affordability at ≤60% AMI (conservative estimate)
    const grapi_lt15   = Number(profile.DP04_0144PE);
    const grapi_15_20  = Number(profile.DP04_0145PE);
    const grapi_20_25  = Number(profile.DP04_0146PE);

    let baseline60Ami = null;
    let method = 'estimate';

    if (Number.isFinite(grapi_lt15) || Number.isFinite(grapi_15_20) || Number.isFinite(grapi_20_25)) {
      // Sum of not-burdened GRAPI bins as fraction of rentals
      const notBurdenedPct = (Number.isFinite(grapi_lt15) ? grapi_lt15 : 0) +
                             (Number.isFinite(grapi_15_20) ? grapi_15_20 : 0) +
                             (Number.isFinite(grapi_20_25) ? grapi_20_25 : 0);
      // 60% AMI affordability threshold proxy: among not-burdened renters (paying <25% of income),
      // approximately 65–70% are estimated to be at or below 60% AMI.  This is consistent with
      // HUD income/rent relationship analysis for moderate-income renter households nationally.
      // NOTE: This is a rough proxy only.  For a certified Prop 123 baseline, jurisdictions must
      // conduct a formal housing needs assessment using ACS B25106 cross-tabulations or local data.
      var amiFactor = (countyFips && REGIONAL_AMI_FACTORS[String(countyFips).padStart(5, '0')]) || DEFAULT_AMI_FACTOR;
      baseline60Ami = Math.round(totalRentals * (notBurdenedPct / 100) * amiFactor);
      method = 'acs-grapi-proxy';
    } else {
      // Fallback national average: roughly 40% of renter-occupied units are estimated to be
      // affordable at ≤60% AMI based on national ACS income/rent cross-tabulations (HUD
      // Worst Case Housing Needs reports consistently find ~38–42% of rentals affordable at
      // this level nationally). This fallback is used only when GRAPI data is unavailable.
      baseline60Ami = Math.round(totalRentals * 0.40);
      method = 'national-avg-proxy';
    }

    var usedFactor = (typeof amiFactor !== 'undefined') ? amiFactor : DEFAULT_AMI_FACTOR;
    var factorSource = (countyFips && REGIONAL_AMI_FACTORS[String(countyFips).padStart(5, '0')]) ? 'regional' : 'statewide-default';
    const pctOfStock = totalRentals > 0 ? (baseline60Ami / totalRentals) * 100 : 0;
    return { baseline60Ami, totalRentals, pctOfStock, method, amiFactor: usedFactor, factorSource };
  }

  /**
   * Calculate the 3% annual growth target for a given baseline and year offset.
   * @param {number} baseline - Starting 60% AMI rental count
   * @param {number} yearsAhead - Years from baseline (0 = baseline year)
   * @returns {number}
   */
  function calculateGrowthTarget(baseline, yearsAhead) {
    if (!Number.isFinite(baseline) || baseline <= 0) return 0;
    yearsAhead = Number.isFinite(yearsAhead) ? yearsAhead : 0;
    return Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, yearsAhead));
  }

  /**
   * Check if a jurisdiction is eligible for Prop 123 fast-track.
   * @param {number} population
   * @param {string} geoType - 'county' | 'place' | 'cdp'
   * @returns {{eligible, threshold, reason}}
   */
  function checkFastTrackEligibility(population, geoType) {
    const pop = Number(population);
    if (!Number.isFinite(pop) || pop <= 0) {
      return { eligible: null, threshold: null, reason: 'Population data unavailable' };
    }
    // CDPs are unincorporated areas and not eligible jurisdictions under HB 22-1093
    if (geoType === 'cdp') {
      return {
        eligible:  false,
        threshold: null,
        reason:    'Census-Designated Places (unincorporated areas) are not eligible jurisdictions under HB 22-1093',
      };
    }
    const isCounty  = geoType === 'county';
    const threshold = isCounty ? PROP123_COUNTY_THRESHOLD : PROP123_MUNICIPALITY_THRESHOLD;
    const eligible  = pop >= threshold;
    return {
      eligible,
      threshold,
      reason: eligible
        ? `Population (${pop.toLocaleString()}) meets the ${threshold.toLocaleString()} threshold`
        : `Population (${pop.toLocaleString()}) below the ${threshold.toLocaleString()} minimum`,
    };
  }

  // ---------------------------------------------------------------
  // Labor Market renderers
  // ---------------------------------------------------------------


  function calculateFastTrackTimeline(projectUnits, ami_pct, jurisdiction_type) {
    const units  = Number(projectUnits);
    const ami    = Number(ami_pct);

    // Standard local review cycle (per HB 22-1093 legislative findings, 180–365 days)
    const standardDays  = 270;  // median estimate
    // HB 22-1093 expedited timeline (45–90 days)
    const fastTrackDays = 60;   // typical with complete application

    const conditions = [];
    let eligible = true;

    if (!Number.isFinite(ami) || ami > 60) {
      eligible = false;
      conditions.push('Project must serve households at 60% AMI or below');
    } else {
      conditions.push('✅ 60% AMI or below — meets income targeting requirement');
    }

    if (!Number.isFinite(units) || units < 1) {
      eligible = false;
      conditions.push('At least 1 affordable unit required');
    } else {
      conditions.push(`✅ ${units} unit(s) proposed`);
    }

    // Only counties/municipalities that have filed a Prop 123 commitment are eligible
    const eligibleTypes = ['county', 'place'];
    if (!eligibleTypes.includes(jurisdiction_type)) {
      eligible = false;
      conditions.push('Jurisdiction must be a county or incorporated municipality with a filed commitment');
    } else {
      conditions.push('✅ Eligible jurisdiction type (' + jurisdiction_type + ')');
    }

    conditions.push('Must provide proper advance notice to DOLA (per statute)');
    conditions.push('Must comply with DOLA expedited process guidance');

    const savedDays   = standardDays - fastTrackDays;
    const savedMonths = Math.round(savedDays / 30);
    const savings     = savedMonths + ' month' + (savedMonths !== 1 ? 's' : '');

    return { standardDays, fastTrackDays, timelineSavings: savings, eligible, conditions };
  }

  /**
   * Get jurisdiction-level compliance status (single geography).
   * Delegates to Prop123Tracker if loaded, otherwise computes inline.
   *
   * @param {string} geoid
   * @param {string} geoType
   * @param {object|null} profile - ACS profile
   * @returns {{
   *   baseline: number|null,
   *   current: number|null,
   *   target: number|null,
   *   pctComplete: number|null,
   *   status: string,
   *   lastFiled: string|null
   * }}
   */

  function getJurisdictionComplianceStatus(geoid, geoType, profile, countyFips) {
    const baselineData = calculateBaseline(profile, countyFips);
    if (!baselineData) {
      return { baseline: null, current: null, target: null, pctComplete: null, status: 'no-data', lastFiled: null };
    }

    const baseline    = baselineData.baseline60Ami;
    const currentYear = new Date().getFullYear();
    const yearsIn     = currentYear - 2023;
    const target      = Math.round(baseline * Math.pow(1 + PROP123_GROWTH_RATE, yearsIn));

    // Check for user-supplied actuals in sessionStorage
    const storedKey = 'prop123_actual_' + geoid + '_' + currentYear;
    const stored    = (typeof sessionStorage !== 'undefined')
      ? sessionStorage.getItem(storedKey)
      : null;
    const current   = stored !== null ? Number(stored) : baseline; // fallback: assume at baseline
    const pct       = target > 0 ? Math.round((current / target) * 100) : null;

    let status;
    if (pct === null) {
      status = 'no-data';
    } else if (current >= target) {
      status = 'on-track';
    } else if (current >= target * 0.90) {
      status = 'at-risk';
    } else {
      status = 'off-track';
    }

    return { baseline, current, target, pctComplete: pct, status, lastFiled: null };
  }

  /**
   * Generate a CSV string for compliance report across a list of jurisdiction objects.
   * Each item: { geoid, name, population, baseline, current, target, status, lastFiled }
   *
   * @param {object[]} rows
   * @returns {string} CSV content
   */

  function generateComplianceReport(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const headers = ['geoid', 'name', 'population', 'baseline', 'current', 'target', 'pct_complete', 'status', 'last_filed'];
    const escape  = (v) => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const lines = [headers.join(',')];
    rows.forEach((r) => {
      lines.push([
        r.geoid, r.name, r.population,
        r.baseline, r.current, r.target,
        r.pctComplete, r.status, r.lastFiled,
      ].map(escape).join(','));
    });
    return lines.join('\n');
  }

  /**
   * Render the fast-track timeline calculator card.
   * Wires up form controls inside the #fastTrackCalculator container.
   */

  function computeIncomeNeeded(homeValue){
    const V = Number(homeValue);
    if (!Number.isFinite(V) || V <= 0) return null;

    const down = V * AFFORD.downPaymentPct;
    const loan = V - down;

    const r = AFFORD.rateAnnual / 12;
    const n = AFFORD.termYears * 12;
    const pAndI = loan * (r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1);

    const tax = (V * AFFORD.propertyTaxPctAnnual) / 12;
    const ins = (V * AFFORD.insurancePctAnnual) / 12;
    const pmi = (AFFORD.downPaymentPct < 0.20) ? (loan * AFFORD.pmiPctAnnual) / 12 : 0;

    const payment = pAndI + tax + ins + pmi;
    const annualIncome = (payment / AFFORD.paymentToIncome) * 12;

    return {
      homeValue: V,
      down,
      loan,
      payment,
      annualIncome,
      components: { pAndI, tax, ins, pmi }
    };
  }

  function rentBurden30Plus(pcts){
    // DP04_0145PE (30-34.9) + DP04_0146PE (35+)
    const a = Number(pcts.DP04_0145PE);
    const b = Number(pcts.DP04_0146PE);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a + b;
  }

  // --- Renderers ---

  const PROJECTION_SCENARIOS = {
    baseline: {
      label: 'Baseline',
      description: 'Moderate growth following recent historical trends. Fertility holds steady; migration reflects the 2018–2023 average.',
      color: '#4a90d9',
    },
    low_growth: {
      label: 'Low growth',
      description: 'Slowing in-migration, modest fertility decline, slightly elevated mortality. Reflects affordability-driven headwinds.',
      color: '#e07b39',
    },
    high_growth: {
      label: 'High growth',
      description: 'Accelerated in-migration driven by economic expansion, slightly above-trend fertility, continued mortality improvement.',
      color: '#4caf50',
    },
  };

  // AMI tier labels for housing demand charts
  const AMI_TIER_LABELS = {
    '30_ami':       '≤30% AMI',
    '50_ami':       '31–50% AMI',
    '80_ami':       '51–80% AMI',
    '100_ami':      '81–100% AMI',
    '120_ami':      '101–120% AMI',
    'above_120_ami':'Above 120% AMI',
  };

  const AMI_TIER_COLORS = {
    '30_ami':       '#d32f2f',
    '50_ami':       '#f57c00',
    '80_ami':       '#fbc02d',
    '100_ami':      '#388e3c',
    '120_ami':      '#1976d2',
    'above_120_ami':'#7b1fa2',
  };

  /**
   * renderProjectionChart — draw a line chart of projected population for one
   * scenario over a custom year range.
   *
   * @param {string}   geoid    - 5-digit county FIPS (or place FIPS)
   * @param {string}   scenario - 'baseline' | 'low_growth' | 'high_growth'
   * @param {number}   years    - projection horizon (e.g. 10)
   * @param {Object}   opts
   * @param {Element}  opts.canvas  - <canvas> element to draw on
   * @param {Array}    opts.basePopSeries  - [{year, population}, ...] from loaded projections
   */


  window.HNAUtils = {
    // constants
    STATE_FIPS_CO,
    ACS_VINTAGES,
    ACS_YEAR_PRIMARY,
    ACS_YEAR_FALLBACK,
    DEBUG_HNA,
    DEFAULTS,
    AFFORD,
    FEATURED,
    PATHS,
    SOURCES,
    GITHUB_PAGES_BASE,
    NAICS_LABELS,
    WAGE_BAND_ANNUAL,
    PROP123_MUNICIPALITY_THRESHOLD,
    PROP123_COUNTY_THRESHOLD,
    PROP123_GROWTH_RATE,
    LIHTC_FALLBACK_CO,
    QCT_FALLBACK_CO,
    DDA_FALLBACK_CO,
    CO_DDA,
    BOUNDARY_STYLES,
    PROJECTION_SCENARIOS,
    AMI_TIER_LABELS,
    AMI_TIER_COLORS,
    // functions
    redactKey,
    fmtNum,
    fmtMoney,
    fmtPct,
    censusSourceUrl,
    srcLink,
    safeNum,
    computeIncomeNeeded,
    rentBurden30Plus,
    calculateJobMetrics,
    parseIndustries,
    calculateWageDistribution,
    calculateBaseline,
    calculateGrowthTarget,
    checkFastTrackEligibility,
    calculateFastTrackTimeline,
    getJurisdictionComplianceStatus,
    generateComplianceReport,
    lihtcSourceInfo,
    lihtcPopupHtml,
    countyFromGeoid,
    ensureGeographyRegistry,
    censusKey,
    lihtcFallbackForCounty,
    isSmallGeography,
    getSmallGeoWarning,
  };

  /**
   * Check if a geography has small population where ACS estimates
   * may have high margins of error (30-50% for geographies <5,000).
   * @param {object} profile - ACS profile data
   * @returns {boolean}
   */
  function isSmallGeography(profile) {
    if (!profile) return false;
    var pop = Number(profile.DP05_0001E);
    return Number.isFinite(pop) && pop > 0 && pop < 5000;
  }

  /**
   * Get a user-facing warning message for small geographies.
   * @param {object} profile - ACS profile data
   * @returns {string|null} Warning message or null if not small
   */
  function getSmallGeoWarning(profile) {
    if (!isSmallGeography(profile)) return null;
    var pop = Number(profile.DP05_0001E);
    return 'This geography has ' + fmtNum(pop) + ' residents. ACS 5-year estimates for populations under 5,000 ' +
      'may have margins of error of 30\u201350%. Percentages and counts shown here should be treated as ' +
      'approximate, not precise. For planning purposes, consider county-level data alongside place-level estimates.';
  }

})();

