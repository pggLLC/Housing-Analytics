/**
 * js/hna/hna-utils.js
 * Responsibility: Pure utility functions, constants, Census API helpers, and shared-state initialisation.
 * Dependencies: window.fetchWithTimeout (js/fetch-helper.js), window.resolveAssetUrl (js/path-resolver.js)
 * Exposes: window.__HNA_STATE (shared mutable state), window.__HNA_UTILS (utility function object)
 */
(function () {
  'use strict';

  const STATE_FIPS_CO = '08';

  // fetchWithTimeout is provided globally by js/fetch-helper.js (window.fetchWithTimeout).
  // Alias it locally so in-file calls work without modification.
  var fetchWithTimeout = window.fetchWithTimeout || function (url, options, timeoutMs) {
    // Minimal inline fallback in case fetch-helper.js is not loaded first.
    // Uses the same 15s default as the shared implementation in fetch-helper.js.
    timeoutMs = timeoutMs || 15000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var merged = Object.assign({}, options || {}, { signal: ctrl.signal });
    return fetch(url, merged).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  };

  // Probe vintages newest-first to always surface the most recent data available.
  const ACS_VINTAGES = [2024, 2023, 2022, 2021, 2020];
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
  };

  const SOURCES = {
    tigerweb: 'https://www.census.gov/data/developers/data-sets/TIGERweb.html',
    acsProfile: 'https://api.census.gov/data/2023/acs/acs1/profile/groups.html',
    acsS0801: 'https://api.census.gov/data/2023/acs/acs1/subject/groups/S0801.html',
    lodesRoot: 'https://lehd.ces.census.gov/data/lodes/LODES8/',
    lodesTech: 'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf',
    sdoDownloads: 'https://demography.dola.colorado.gov/assets/html/sdodata.html',
    sdoPopulation: 'https://demography.dola.colorado.gov/assets/html/population.html',
    prop123Commitments: 'https://cdola.colorado.gov/commitment-filings',
    lihtcDb: 'https://lihtc.huduser.gov/',
    hudQct: 'https://www.huduser.gov/portal/datasets/qct.html',
    hudDda: 'https://www.huduser.gov/portal/datasets/dda.html',
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
  // Source: https://www.huduser.gov/portal/datasets/dda.html
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
    return v.toLocaleString(undefined,{maximumFractionDigits:0});
  }
  function fmtMoney(n){
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return v.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});
  }
  function fmtPct(n){
    if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
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

  function chartTheme(){
    const style = getComputedStyle(document.documentElement);
    const text = style.getPropertyValue('--text').trim() || '#111';
    const muted = style.getPropertyValue('--muted').trim() || '#555';
    const border = style.getPropertyValue('--border').trim() || '#ddd';
    // Chart palette tokens (var(--chart-1) … var(--chart-7), Rule 10)
    const chartColors = [1,2,3,4,5,6,7].map(n =>
      style.getPropertyValue(`--chart-${n}`).trim() || ['#1e5799','#0369a1','#096e65','#7c3d00','#166534','#92400e','#991b1b'][n-1]
    );
    return { text, muted, border, chartColors };
  }

  function safeNum(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // --- Geography helpers ---
  function countyFromGeoid(geoType, geoid){
    if (geoType === 'county') return geoid;
    // State-level selection has no single county context.
    if (geoType === 'state') return null;
    // Check all config arrays (featured, places, cdps) for a containingCounty mapping.
    const conf = window.__HNA_GEO_CONFIG;
    const allEntries = [
      ...(conf?.featured || []),
      ...(conf?.places   || []),
      ...(conf?.cdps     || []),
    ];
    const match = allEntries.find(x => x.geoid === geoid);
    if (match?.containingCounty) return match.containingCounty;
    // For non-featured places/CDPs default to the first county
    // (caller will get data from the Census API for the specific place)
    return '08077';
  }

  async function fetchCoCountiesList(){
    // TIGERweb county layer (State_County MapServer/1)
    const base = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';
    const params = new URLSearchParams({
      where: `STATEFP='${STATE_FIPS_CO}'`,
      outFields: 'NAME,GEOID',
      f: 'json',
      returnGeometry: 'false',
      orderByFields: 'NAME'
    });
    const url = `${base}?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Failed to fetch county list');
    const d = await r.json();
    const counties = (d.features || []).map(f => {
        const name = f.attributes.NAME || '';
        const label = name.toLowerCase().endsWith('county') ? name : `${name} County`;
        return { geoid: f.attributes.GEOID, label };
      });
    return counties;
  }

  async function loadJson(url){
    // Resolve local paths through APP_BASE_PATH so they work on GitHub Pages sub-paths
    // (e.g. /Housing-Analytics/data/...) and on custom domains (/).
    const resolvedUrl = (!/^https?:\/\//i.test(url) && typeof window.resolveAssetUrl === 'function')
      ? window.resolveAssetUrl(url)
      : url;
    const r = await fetchWithTimeout(resolvedUrl, {cache:'no-cache'}, 20000);
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} ${resolvedUrl}`);
      err.httpStatus = r.status;
      throw err;
    }
    const text = await r.text();
    if (!text.trim()) throw new Error(`Empty response: ${resolvedUrl}`);
    return JSON.parse(text);
  }

  // Return LIHTC fallback features filtered to a county FIPS (or all if none specified)
  function lihtcFallbackForCounty(countyFips5){
    const features = LIHTC_FALLBACK_CO.features.filter(f =>
      !countyFips5 || (f.properties.CNTY_FIPS || '') === countyFips5
    );
    return { type: 'FeatureCollection', features };
  }

  function censusKey(){
    return (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : '';
  }

  // Warn once per page load when CENSUS_API_KEY is absent so developers can
  // diagnose 400/403 failures without digging through network traffic.
  let _censusApiWarnDone = false;
  function _censusApiWarn() {
    if (!_censusApiWarnDone && !censusKey()) {
      _censusApiWarnDone = true;
      console.warn('[HNA] CENSUS_API_KEY is not configured — Census profile and subject ' +
        'table requests may be rate-limited or rejected for some geographies. ' +
        'Set window.APP_CONFIG.CENSUS_API_KEY or add it to js/config.js. ' +
        'Free key signup: https://api.census.gov/data/key_signup.html');
    }
  }

  // Fetch a Census API URL with timeout/retry (via fetchWithTimeout) and
  // detailed error logging.  Handles transient HTTP errors (408, 429, 5xx)
  // by waiting and retrying once.  Returns the Response object on any HTTP
  // reply (callers check resp.ok), or null on unrecoverable network failure.
  async function _fetchCensusUrl(url, contextLabel) {
    const safeUrl = redactKey(url);
    const label = contextLabel || 'Census API';
    const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

    async function tryFetch(retries) {
      try {
        return await fetchWithTimeout(url, {}, 15000, retries);
      } catch (e) {
        console.warn('[HNA] ' + label + ' network error (' + safeUrl + '): ' + e.message);
        return null;
      }
    }

    let resp = await tryFetch(2);
    if (!resp) return null;

    // One additional retry on transient HTTP status codes
    if (!resp.ok && TRANSIENT.has(resp.status)) {
      const backoffMs = resp.status === 429 ? 3000 : 1000;
      if (DEBUG_HNA) {
        console.warn('[HNA] ' + label + ' HTTP ' + resp.status + ' (transient); retrying in ' + backoffMs + 'ms (' + safeUrl + ')');
      }
      await new Promise(function (res) { setTimeout(res, backoffMs); });
      const retried = await tryFetch(1);
      if (retried) resp = retried;
    }

    if (!resp.ok) {
      let bodyExcerpt = '';
      try { bodyExcerpt = (await resp.text()).slice(0, 500); } catch (e) {
        console.warn('[HNA] ' + label + ' failed to read error response body: ' + e.message);
      }
      console.warn('[HNA] ' + label + ' HTTP ' + resp.status + ' for ' + safeUrl +
        (bodyExcerpt ? ': ' + bodyExcerpt : ''));
    }

    return resp;
  }

  async function fetchAcsProfile(geoType, geoid){
    // Use ACS 1-year profile tables for a fast report-like snapshot.
    // Falls back to ACS 5-year if the primary year is unavailable.

    _censusApiWarn();

    // Validate GEOID format before building Census API URLs.
    if (geoType === 'county' && !/^\d{5}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsProfile: county GEOID "' + geoid + '" is not 5 digits; Census API call may fail.');
    }
    if ((geoType === 'place' || geoType === 'cdp') && !/^\d{7}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsProfile: place GEOID "' + geoid + '" is not 7 digits; Census API call may fail.');
    }

    // Variables
    const vars = [
      // DP05 population
      'DP05_0001E',
      // DP02 households
      'DP02_0001E',
      // DP03 income
      'DP03_0062E',
      // DP04 housing
      'DP04_0001E', // housing units
      'DP04_0047PE', // owner-occupied %
      'DP04_0046PE', // renter-occupied %
      'DP04_0089E',  // median value (owner-occupied)
      'DP04_0134E',  // median gross rent
      // Structure
      'DP04_0003E', // 1-unit detached
      'DP04_0004E', // 1-unit attached
      'DP04_0005E', // 2 units
      'DP04_0006E', // 3-4 units
      'DP04_0007E', // 5-9 units
      'DP04_0008E', // 10-19
      'DP04_0009E', // 20+ units
      'DP04_0010E', // mobile home
      // Rent burden bins (GRAPI) — only DP04_0142PE and DP04_0143PE exist in
      // ACS 1-year profile across vintages 2020-2024.  The 25-29.9%, 30-34.9%,
      // and 35%+ bins (formerly DP04_0144PE through DP04_0146PE) were removed
      // from the DP04 profile table and are no longer valid ACS variables;
      // those values are derived from the B25070 B-series fallback instead.
      'DP04_0142PE', // <20%
      'DP04_0143PE', // 20-24.9%
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'state'
        ? `state:${STATE_FIPS_CO}`
        : geoType === 'place'
          ? `place:${geoid.slice(2)}`
          : `place:${geoid.slice(2)}`;

    const inParam = geoType === 'state' ? null : `state:${STATE_FIPS_CO}`;
    const key = censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}`;
      if (inParam) qs += `&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    const url1 = buildUrl(ACS_YEAR_PRIMARY,  'acs/acs1/profile');
    let r = await _fetchCensusUrl(url1, 'ACS1 profile ' + geoType + ':' + geoid + ' y=' + ACS_YEAR_PRIMARY);
    let usedYear = ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';
    let url2 = null;
    if (!r || !r.ok){
      // Probe vintages newest-first for ACS 1-year
      r = null;
      for (const v of ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs1/profile');
        const resp = await _fetchCensusUrl(u, 'ACS1 profile ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
      }
    }
    if (!r || !r.ok){
      if (DEBUG_HNA) console.warn('[HNA] fetchAcsProfile: ACS1 exhausted for ' + geoType + ':' + geoid + '; trying ACS5 profile');
      // Try ACS 5-year vintage probe
      for (const v of ACS_VINTAGES) {
        url2 = buildUrl(v, 'acs/acs5/profile');
        const resp = await _fetchCensusUrl(url2, 'ACS5 profile ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
      if (DEBUG_HNA) console.warn('[HNA] fetchAcsProfile: ACS5 profile exhausted for ' + geoType + ':' + geoid + '; falling back to B-series');
      // ACS profile/subject tables may not support this geography or these
      // variable codes for the requested year.  Fall back to ACS 5-year
      // B-series which covers all geography types (county, place, CDP) and
      // uses stable variable codes.
      return await fetchAcs5BSeries(geoType, geoid);
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
    out._acsYear = usedYear;
    out._acsSeries = usedSeries;
    return out;
  }

  async function fetchAcs5BSeries(geoType, geoid){
    // ACS 5-year B-series fallback for all geography types (county, place, CDP, state).
    // Profile (DP) and subject (S) tables may fail due to geography constraints
    // or variable numbering changes across ACS releases.  The B-series detailed
    // tables cover all geography types and use stable variable codes.
    // Maps B-series codes to DP-series names for UI compatibility.
    const isState = geoType === 'state';
    const forParam = geoType === 'county'
      ? `county:${geoid.slice(-3)}`
      : isState
        ? `state:${STATE_FIPS_CO}`
        : `place:${geoid.slice(2)}`;
    const key = censusKey();
    const bVars = [
      'B01003_001E', // total population        → DP05_0001E
      'B11001_001E', // total households         → DP02_0001E
      'B19013_001E', // median household income  → DP03_0062E
      'B25001_001E', // total housing units      → DP04_0001E
      'B25003_001E', // occupied housing units
      'B25003_002E', // owner-occupied
      'B25003_003E', // renter-occupied
      'B25077_001E', // median home value        → DP04_0089E
      'B25064_001E', // median gross rent        → DP04_0134E
      'B25024_002E', 'B25024_003E', 'B25024_004E', 'B25024_005E',
      'B25024_006E', 'B25024_007E', 'B25024_008E', 'B25024_009E',
      'B25024_010E', // housing structure types  → DP04_0003E–0010E
      'B25070_001E', // renter-occupied paying rent (GRAPI denominator)
      'B25070_006E', // 25–29.9%
      'B25070_007E', // 30–34.9%                → DP04_0145PE
      'B25070_008E', // 35–39.9%
      'B25070_009E', // 40–49.9%
      'B25070_010E', // 50%+
    ];

    // Probe vintages newest-first for ACS 5-year B-series
    let bResp = null;
    let bYear = ACS_YEAR_FALLBACK;
    for (const v of ACS_VINTAGES) {
      const base = `https://api.census.gov/data/${v}/acs/acs5`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      // For state-level queries omit the &in= parameter (it is not needed).
      let qs = `get=${encodeURIComponent(bVars.join(',') + ',NAME')}&for=${forParam}`;
      if (!isState) qs += `&in=state:${STATE_FIPS_CO}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      const u = `${base}?${qs}`;
      const resp = await _fetchCensusUrl(u, 'ACS5 B-series ' + geoType + ':' + geoid + ' y=' + v);
      if (resp && resp.ok){ bResp = resp; bYear = v; break; }
    }
    if (!bResp){
      throw new Error(`ACS profile unavailable for this geography`);
    }
    const arr = await bResp.json();
    const header = arr[0];
    const row = arr[1] || [];
    const raw = {};
    header.forEach((h,i)=>{ raw[h]=row[i]; });

    const si = v => { const n=parseInt(v,10); return Number.isFinite(n) && n>=0 ? n : null; };
    const occ = si(raw.B25003_001E);
    const owner = si(raw.B25003_002E);
    const renter = si(raw.B25003_003E);
    const grapiTot = si(raw.B25070_001E);
    const pct = (n) => (grapiTot && n!==null) ? String(Math.round(n/grapiTot*10000)/100) : null;
    const b35 = [raw.B25070_008E,raw.B25070_009E,raw.B25070_010E].map(si).filter(n=>n!==null);
    const burden35 = b35.length ? b35.reduce((a,b)=>a+b,0) : null;
    const s20_49 = si(raw.B25024_008E);
    const s50p = si(raw.B25024_009E);
    const units20p = (s20_49!==null||s50p!==null) ? (s20_49||0)+(s50p||0) : null;

    return {
      DP05_0001E: raw.B01003_001E,
      DP02_0001E: raw.B11001_001E,
      DP03_0062E: raw.B19013_001E,
      DP04_0001E: raw.B25001_001E,
      DP04_0047PE: (occ && owner!==null) ? String(Math.round(owner/occ*1000)/10) : null,
      DP04_0046PE: (occ && renter!==null) ? String(Math.round(renter/occ*1000)/10) : null,
      DP04_0089E:  raw.B25077_001E,
      DP04_0134E:  raw.B25064_001E,
      DP04_0003E:  raw.B25024_002E,
      DP04_0004E:  raw.B25024_003E,
      DP04_0005E:  raw.B25024_004E,
      DP04_0006E:  raw.B25024_005E,
      DP04_0007E:  raw.B25024_006E,
      DP04_0008E:  raw.B25024_007E,
      DP04_0009E:  units20p!==null ? String(units20p) : null,
      DP04_0010E:  raw.B25024_010E,
      DP04_0142PE: null,
      DP04_0143PE: null,
      DP04_0144PE: pct(si(raw.B25070_006E)),
      DP04_0145PE: pct(si(raw.B25070_007E)),
      DP04_0146PE: pct(burden35),
      NAME: raw.NAME,
      _acsYear: bYear,
      _acsSeries: 'acs5',
    };
  }

  async function fetchAcsS0801(geoType, geoid){
    // Subject table S0801: commuting characteristics

    _censusApiWarn();

    // Validate GEOID format before building Census API URLs.
    if (geoType === 'county' && !/^\d{5}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsS0801: county GEOID "' + geoid + '" is not 5 digits; Census API call may fail.');
    }
    if ((geoType === 'place' || geoType === 'cdp') && !/^\d{7}$/.test(geoid)) {
      console.warn('[HNA] fetchAcsS0801: place GEOID "' + geoid + '" is not 7 digits; Census API call may fail.');
    }

    const vars = [
      'S0801_C01_001E', // total workers 16+ (count)
      'S0801_C01_002E', // car, truck, or van — total (parent; drove-alone + carpooled)
      'S0801_C01_003E', // drove alone (%)
      'S0801_C01_004E', // carpooled (%)
      'S0801_C01_005E', // public transportation (%)
      'S0801_C01_006E', // walked (%)
      'S0801_C01_007E', // taxicab, motorcycle, bicycle, or other means (%)
      'S0801_C01_008E', // worked at home (%)
      'S0801_C01_018E', // mean travel time to work (minutes)
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'state'
        ? `state:${STATE_FIPS_CO}`
        : geoType === 'place'
          ? `place:${geoid.slice(2)}`
          : `place:${geoid.slice(2)}`;

    const inParam = geoType === 'state' ? null : `state:${STATE_FIPS_CO}`;
    const key = censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}`;
      if (inParam) qs += `&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    // ACS 1-year data is not published for geographic units with fewer than
    // 65,000 residents (CDPs are the main example in Colorado). For CDPs, skip
    // the ACS1 probe entirely and go directly to ACS 5-year subject tables,
    // avoiding up to 5 unnecessary failing requests.
    let r = null;
    let usedYear = ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';

    if (geoType !== 'cdp') {
      const url1 = buildUrl(ACS_YEAR_PRIMARY, 'acs/acs1/subject');
      r = await _fetchCensusUrl(url1, 'ACS1 S0801 ' + geoType + ':' + geoid + ' y=' + ACS_YEAR_PRIMARY);
      if (!r || !r.ok){
        // Probe vintages newest-first for ACS 1-year
        r = null;
        for (const v of ACS_VINTAGES) {
          const u = buildUrl(v, 'acs/acs1/subject');
          const resp = await _fetchCensusUrl(u, 'ACS1 S0801 ' + geoType + ':' + geoid + ' y=' + v);
          if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
        }
      }
    }
    if (!r || !r.ok){
      if (DEBUG_HNA) console.warn('[HNA] fetchAcsS0801: ACS1 exhausted for ' + geoType + ':' + geoid + '; trying ACS5 subject');
      // Try ACS 5-year vintage probe
      for (const v of ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs5/subject');
        const resp = await _fetchCensusUrl(u, 'ACS5 S0801 ' + geoType + ':' + geoid + ' y=' + v);
        if (resp && resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
      const msg = 'ACS S0801 failed for ' + geoType + ':' + geoid + ' (tried ACS1 and ACS5 across all vintages)';
      throw new Error(msg);
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
    out._acsYear = usedYear;
    out._acsSeries = usedSeries;
    return out;
  }

  // --- Computations ---

  // ---------------------------------------------------------------
  // Labor Market helpers
  // ---------------------------------------------------------------

  // NAICS 2-digit sector labels (LEHD WAC CNS01-CNS20)

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
    if (!entries.length) return [];
    entries.sort(function(a, b) { return b.count - a.count; });
    return entries.slice(0, topN);
  }

  /**
   * Calculate wage distribution from LEHD WAC CE01/CE02/CE03 fields.
   * @param {object} lehd
   * @returns {{low, medium, high, total}|null}
   */
  function calculateWageDistribution(lehd) {
    if (!lehd) return null;
    const low    = Number(lehd.CE01);  // ≤ $1,250/month
    const medium = Number(lehd.CE02);  // $1,251–$3,333/month
    const high   = Number(lehd.CE03);  // > $3,333/month
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
   * Estimate count of 60% AMI rental units from ACS profile data.
   * Uses ACS DP04 GRAPI bins as a proxy:
   *   - Total renter-occupied units (DP04_0003E - vacant, or derived from tenure pct)
   *   - Affordability proxy: units paying < 30% income (not rent-burdened) as a proxy for
   *     units affordable at ≤60% AMI.  This is an approximation — true 60% AMI counts
   *     require ACS B25106 cross-tabulations not in the DP04 profile.
   *
   * ACS DP04 fields used:
   *   DP04_0001E  - Total housing units
   *   DP04_0046PE - Renter-occupied (%)
   *   DP04_0003E  - Occupied housing units
   *   DP04_0144PE - GRAPI <15%
   *   DP04_0145PE - GRAPI 15-19.9%
   *   DP04_0146PE - GRAPI 20-24.9%  (not burdened)
   *
   * @param {object} profile - ACS profile (DP04 fields)
   * @returns {{baseline60Ami, totalRentals, pctOfStock, method}|null}
   */
  function calculateBaseline(profile) {
    if (!profile) return null;

    const totalUnits  = Number(profile.DP04_0001E);
    const renterPct   = Number(profile.DP04_0046PE);  // e.g. 27.5
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
      baseline60Ami = Math.round(totalRentals * (notBurdenedPct / 100) * 0.70);
      method = 'acs-grapi-proxy';
    } else {
      // Fallback national average: roughly 40% of renter-occupied units are estimated to be
      // affordable at ≤60% AMI based on national ACS income/rent cross-tabulations (HUD
      // Worst Case Housing Needs reports consistently find ~38–42% of rentals affordable at
      // this level nationally). This fallback is used only when GRAPI data is unavailable.
      baseline60Ami = Math.round(totalRentals * 0.40);
      method = 'national-avg-proxy';
    }

    const pctOfStock = totalRentals > 0 ? (baseline60Ami / totalRentals) * 100 : 0;
    return { baseline60Ami, totalRentals, pctOfStock, method };
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

  async function fetchAcs5Trend(year, geoType, geoid){
    // Minimal ACS5 profile pull used for trend estimates (population + households).
    // This is only used for municipal scaling and headship trend when user selects "Trend".
    const vars = ['DP05_0001E','DP02_0001E'].join(',');
    const key = censusKey();
    const stateF = geoid.slice(0,2);
    const code = geoid.slice(2);

    const dataset = `https://api.census.gov/data/${year}/acs/acs5/profile`;
    const forPart = (geoType==='county') ? `county:${code}` : `place:${code}`;
    const inPart = `state:${stateF}`;

    const url = `${dataset}?get=${encodeURIComponent(vars)}&for=${encodeURIComponent(forPart)}&in=${encodeURIComponent(inPart)}${key?`&key=${encodeURIComponent(key)}`:''}`;
    const r = await fetch(url);
    if (!r.ok){
      // For CDPs, ACS5 profile may not support CDP geography; fall back to B-series.
      if (geoType === 'cdp'){
        const bUrl = `https://api.census.gov/data/${year}/acs/acs5?get=${encodeURIComponent('B01003_001E,B11001_001E,NAME')}&for=${encodeURIComponent(`place:${code}`)}&in=${encodeURIComponent(inPart)}${key?`&key=${encodeURIComponent(key)}`:''}`;
        const rb = await fetch(bUrl);
        if (!rb.ok) throw new Error(`ACS5 trend HTTP ${rb.status}`);
        const jb = await rb.json();
        const hb = jb[0], rowb = jb[1] || [];
        const ob = {};
        hb.forEach((k,i)=> ob[k]=rowb[i]);
        return { pop: safeNum(ob.B01003_001E), hh: safeNum(ob.B11001_001E), year };
      }
      throw new Error(`ACS5 trend HTTP ${r.status}`);
    }
    const j = await r.json();
    const h = j[0], row = j[1] || [];
    const out = {};
    h.forEach((k,i)=> out[k]=row[i]);
    return { pop: safeNum(out.DP05_0001E), hh: safeNum(out.DP02_0001E), year };
  }

  function getAssumptions(){
    const _els = window.__HNA_STATE.els;
    const horizon = Number(_els && _els.assumpHorizon ? _els.assumpHorizon.value : 20);
    const vacPct = Number(_els && _els.assumpVacancy ? _els.assumpVacancy.value : 5);
    const targetVac = vacPct/100.0;
    const headshipMode = (document.getElementById('assumpHeadship')?.value || document.querySelector('input[name="assumpHeadship"]:checked')?.value || 'hold');
    return { horizon, targetVac, headshipMode };
  }

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

  // ---------------------------------------------------------------------------
  // Shared state initialisation
  // ---------------------------------------------------------------------------

  window.__HNA_STATE = {
    // Constants (set once by hna-utils.js)
    STATE_FIPS_CO: STATE_FIPS_CO,
    ACS_VINTAGES: ACS_VINTAGES,
    ACS_YEAR_PRIMARY: ACS_YEAR_PRIMARY,
    ACS_YEAR_FALLBACK: ACS_YEAR_FALLBACK,
    DEBUG_HNA: DEBUG_HNA,
    DEFAULTS: DEFAULTS,
    AFFORD: AFFORD,
    FEATURED: FEATURED,
    PATHS: PATHS,
    SOURCES: SOURCES,
    GITHUB_PAGES_BASE: GITHUB_PAGES_BASE,
    LIHTC_FALLBACK_CO: LIHTC_FALLBACK_CO,
    QCT_FALLBACK_CO: QCT_FALLBACK_CO,
    DDA_FALLBACK_CO: DDA_FALLBACK_CO,
    CO_DDA: CO_DDA,
    NAICS_LABELS: NAICS_LABELS,
    WAGE_BAND_ANNUAL: WAGE_BAND_ANNUAL,
    PROP123_MUNICIPALITY_THRESHOLD: PROP123_MUNICIPALITY_THRESHOLD,
    PROP123_COUNTY_THRESHOLD: PROP123_COUNTY_THRESHOLD,
    PROP123_GROWTH_RATE: PROP123_GROWTH_RATE,
    PROJECTION_SCENARIOS: PROJECTION_SCENARIOS,
    AMI_TIER_LABELS: AMI_TIER_LABELS,
    AMI_TIER_COLORS: AMI_TIER_COLORS,
    // Mutable runtime state
    state: { current: null, lastProj: null, trendCache: {}, derived: null, prevProfile: {}, chasData: null },
    els: null,
    charts: {},
    map: null,
    boundaryLayer: null,
    lihtcLayer: null,
    qctLayer: null,
    ddaLayer: null,
    allLihtcFeatures: [],
    lihtcDataSource: 'HUD',
    _lihtcRequestSeq: 0,
    scenarioState: { current: 'baseline' },
    fetchWithTimeout: fetchWithTimeout,
  };

  window.__HNA_UTILS = {
    redactKey: redactKey,
    fmtNum: fmtNum,
    fmtMoney: fmtMoney,
    fmtPct: fmtPct,
    safeNum: safeNum,
    censusSourceUrl: censusSourceUrl,
    srcLink: srcLink,
    countyFromGeoid: countyFromGeoid,
    loadJson: loadJson,
    fetchCoCountiesList: fetchCoCountiesList,
    lihtcFallbackForCounty: lihtcFallbackForCounty,
    censusKey: censusKey,
    fetchAcsProfile: fetchAcsProfile,
    fetchAcs5BSeries: fetchAcs5BSeries,
    fetchAcsS0801: fetchAcsS0801,
    fetchAcs5Trend: fetchAcs5Trend,
    calculateJobMetrics: calculateJobMetrics,
    parseIndustries: parseIndustries,
    calculateWageDistribution: calculateWageDistribution,
    calculateBaseline: calculateBaseline,
    calculateGrowthTarget: calculateGrowthTarget,
    checkFastTrackEligibility: checkFastTrackEligibility,
    computeIncomeNeeded: computeIncomeNeeded,
    rentBurden30Plus: rentBurden30Plus,
    getAssumptions: getAssumptions,
    chartTheme: chartTheme,
  };

})();
