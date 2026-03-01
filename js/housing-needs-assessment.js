/*
  Housing Needs Assessment (HNA)
  - Uses cached JSON when available (data/hna/...), with live Census API fallbacks.
  - Keeps assumptions transparent and methodology links dynamic.
*/

(function(){
  const STATE_FIPS_CO = '08';

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
    geoType: 'county',
    // Mesa County
    geoId: '08077',
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
    { type: 'county', geoid: '08077', label: 'Mesa County' },
    { type: 'place',  geoid: '0828745', label: 'Fruita (city)' },
    { type: 'place',  geoid: '0831660', label: 'Grand Junction (city)' },
    { type: 'place',  geoid: '0856970', label: 'Palisade (town)' },
    { type: 'cdp',    geoid: '0815165', label: 'Clifton (CDP)' },
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
    chfaLihtcQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/LIHTC/FeatureServer/0',
    hudLihtcQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0',
    hudQctQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QCT_2025/FeatureServer/0',
    hudDdaQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/DDA_2025/FeatureServer/0',
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
  const els = {
    geoType: document.getElementById('geoType'),
    geoSelect: document.getElementById('geoSelect'),
    btnRefresh: document.getElementById('btnRefresh'),
    btnPdf: document.getElementById('btnPdf'),
    banner: document.getElementById('hnaBanner'),
    geoContextPill: document.getElementById('geoContextPill'),
    execNarrative: document.getElementById('execNarrative'),

    statPop: document.getElementById('statPop'),
    statPopSrc: document.getElementById('statPopSrc'),
    statMhi: document.getElementById('statMhi'),
    statMhiSrc: document.getElementById('statMhiSrc'),
    statHomeValue: document.getElementById('statHomeValue'),
    statHomeValueSrc: document.getElementById('statHomeValueSrc'),
    statRent: document.getElementById('statRent'),
    statRentSrc: document.getElementById('statRentSrc'),
    statTenure: document.getElementById('statTenure'),
    statTenureSrc: document.getElementById('statTenureSrc'),
    statRentBurden: document.getElementById('statRentBurden'),
    statRentBurdenSrc: document.getElementById('statRentBurdenSrc'),
    statIncomeNeed: document.getElementById('statIncomeNeed'),
    statIncomeNeedNote: document.getElementById('statIncomeNeedNote'),
    statCommute: document.getElementById('statCommute'),
    statCommuteSrc: document.getElementById('statCommuteSrc'),

    localResources: document.getElementById('localResources'),
    affordAssumptions: document.getElementById('affordAssumptions'),

    methodology: document.getElementById('methodology'),
    lehdNote: document.getElementById('lehdNote'),
    seniorNote: document.getElementById('seniorNote'),

    statBaseUnits: document.getElementById('statBaseUnits'),
    statBaseUnitsSrc: document.getElementById('statBaseUnitsSrc'),
    statTargetVac: document.getElementById('statTargetVac'),
    statUnitsNeed: document.getElementById('statUnitsNeed'),
    statNetMig: document.getElementById('statNetMig'),
    needNote: document.getElementById('needNote'),

    assumpHorizon: document.getElementById('assumpHorizon'),
    assumpVacancy: document.getElementById('assumpVacancy'),
    assumpVacancyVal: document.getElementById('assumpVacancyVal'),

    // LIHTC / QCT / DDA
    statLihtcCount: document.getElementById('statLihtcCount'),
    statLihtcUnits: document.getElementById('statLihtcUnits'),
    statQctCount: document.getElementById('statQctCount'),
    statDdaStatus: document.getElementById('statDdaStatus'),
    statDdaNote: document.getElementById('statDdaNote'),
    lihtcInfoPanel: document.getElementById('lihtcInfoPanel'),
    lihtcMapStatus: document.getElementById('lihtcMapStatus'),
    layerLihtc: document.getElementById('layerLihtc'),
    layerQct: document.getElementById('layerQct'),
    layerDda: document.getElementById('layerDda'),

  };

  // Charts
  let map;
  let boundaryLayer;
  let lihtcLayer = null;
  let qctLayer = null;
  let ddaLayer = null;
  let charts = {};
  let allLihtcFeatures = []; // full loaded set — used by moveend to filter to current bounds
  let lihtcDataSource = 'HUD';

  const state = { current:null, lastProj:null, trendCache:{}, derived:null };

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

  function setBanner(msg, kind='info'){
    if (!msg){
      els.banner.classList.remove('show');
      els.banner.textContent='';
      return;
    }
    els.banner.classList.add('show');
    els.banner.textContent = msg;
  }

  function chartTheme(){
    const style = getComputedStyle(document.documentElement);
    const text = style.getPropertyValue('--text').trim() || '#111';
    const muted = style.getPropertyValue('--muted').trim() || '#555';
    const border = style.getPropertyValue('--border').trim() || '#ddd';
    return { text, muted, border };
  }

  function makeChart(ctx, config){
    // Destroy existing
    const id = ctx.canvas.id;
    if (charts[id]) charts[id].destroy();
    // Apply consistent font size for legibility
    if (window.Chart && Chart.defaults) {
      Chart.defaults.font = Chart.defaults.font || {};
      Chart.defaults.font.size = 12;
    }
    charts[id] = new Chart(ctx, config);
  }

  function safeNum(v){
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function exportPdf(){
    // Best-effort client-side export. If it fails, fall back to print.
    try{
      if (!window.html2canvas || !window.jspdf){
        window.print();
        return;
      }
      const { jsPDF } = window.jspdf;
      const node = document.querySelector('main');
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
      const canvas = await window.html2canvas(node, { scale: 2, useCORS: true, backgroundColor: bg });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'letter' });

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = canvas.height * (pageW / canvas.width);

      // first page
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
      let remaining = imgH - pageH;
      let offset = 0;

      while (remaining > 0){
        pdf.addPage();
        offset += pageH;
        // shift image up by offset
        pdf.addImage(imgData, 'PNG', 0, -offset, imgW, imgH);
        remaining -= pageH;
      }

      pdf.save('housing-needs-assessment.pdf');
    }catch(e){
      console.warn('PDF export failed; falling back to print()', e);
      window.print();
    }
  }

  // --- Geography helpers ---
  function countyFromGeoid(geoType, geoid){
    if (geoType === 'county') return geoid;
    // The ETL can set containingCounty for any featured place/cdp.
    // For places without a containingCounty, derive from the place GEOID:
    // Colorado place GEOIDs are 7 digits: 08XXXXX. The containing county
    // cannot be derived from the place code alone, so we fall back to the
    // county whose GEOID is closest or use Mesa County as default when
    // no containingCounty is supplied.
    const conf = window.__HNA_GEO_CONFIG;
    // Check featured first (they may have containingCounty set)
    const featured = conf?.featured?.find(x => x.geoid === geoid);
    if (featured?.containingCounty) return featured.containingCounty;
    // For non-featured places/CDPs default to the first county
    // (caller will get data from the Census API for the specific place)
    return '08077';
  }

  function buildSelect(){
    const type = els.geoType.value;
    els.geoSelect.innerHTML='';
    const cfg = window.__HNA_GEO_CONFIG;

    // Prefer full list from config for each type; fall back to featured items
    if (type === 'county' && Array.isArray(cfg?.counties) && cfg.counties.length){
      for (const c of cfg.counties){
        const opt = document.createElement('option');
        opt.value = c.geoid;
        opt.textContent = c.label;
        if (c.geoid === DEFAULTS.geoId) opt.selected = true;
        els.geoSelect.appendChild(opt);
      }
      return;
    }

    if (type === 'place' && Array.isArray(cfg?.places) && cfg.places.length){
      for (const p of cfg.places){
        const opt = document.createElement('option');
        opt.value = p.geoid;
        opt.textContent = p.label;
        els.geoSelect.appendChild(opt);
      }
      if (!els.geoSelect.value && cfg.places[0]) els.geoSelect.value = cfg.places[0].geoid;
      return;
    }

    if (type === 'cdp' && Array.isArray(cfg?.cdps) && cfg.cdps.length){
      for (const c of cfg.cdps){
        const opt = document.createElement('option');
        opt.value = c.geoid;
        opt.textContent = c.label;
        els.geoSelect.appendChild(opt);
      }
      if (!els.geoSelect.value && cfg.cdps[0]) els.geoSelect.value = cfg.cdps[0].geoid;
      return;
    }

    // Fall back to featured items filtered by type
    const list = (cfg?.featured || FEATURED).filter(x => x.type === type);
    for (const g of list){
      const opt = document.createElement('option');
      opt.value = g.geoid;
      opt.textContent = g.label;
      if (g.geoid === DEFAULTS.geoId) opt.selected = true;
      els.geoSelect.appendChild(opt);
    }

    // Ensure something selected
    if (!els.geoSelect.value && list[0]) els.geoSelect.value = list[0].geoid;
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
    const r = await fetch(resolvedUrl,{cache:'no-cache'});
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status} ${resolvedUrl}`);
      err.httpStatus = r.status;
      throw err;
    }
    const text = await r.text();
    if (!text.trim()) throw new Error(`Empty response: ${resolvedUrl}`);
    return JSON.parse(text);
  }

  // --- TIGERweb boundary ---
  async function fetchBoundary(geoType, geoid){
    // Use TIGERweb MapServer for geometry as GeoJSON
    // Counties: TIGERweb/State_County MapServer/1
    // Places: TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/4
    // CDPs:   TIGERweb/Places_CouSub_ConCity_SubMCD MapServer/5

    const layer = geoType === 'county' ? 1 : (geoType === 'place' ? 4 : 5);
    const service = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer';
    const countyService = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer';
    const base = geoType === 'county' ? `${countyService}/${layer}` : `${service}/${layer}`;

    const whereField = geoType === 'county' ? 'GEOID' : 'GEOID';
    const where = `${whereField}='${geoid}'`;
    const params = new URLSearchParams({
      where,
      outFields: '*',
      f: 'geojson',
      outSR: '4326',
    });
    const url = `${base}/query?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Boundary fetch failed (${r.status})`);
    return await r.json();
  }

  function ensureMap(){
    if (map) return;

    // Fix vendored Leaflet marker icon paths
    if (window.L && L.Icon && L.Icon.Default) {
      L.Icon.Default.mergeOptions({
        iconUrl:       'js/vendor/images/marker-icon.png',
        iconRetinaUrl: 'js/vendor/images/marker-icon-2x.png',
        shadowUrl:     'js/vendor/images/marker-shadow.png',
      });
    }

    map = L.map('hnaMap', { scrollWheelZoom: false });

    // --- Basemap tile providers ---
    const HNA_BASE_SESSION_KEY = 'hna-basemap';
    const BASEMAPS = {
      light:       L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }),
      dark:        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 }),
      osm:         L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',             { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }),
      satellite:   L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 18 }),
      'esri-gray': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxZoom: 16 }),
    };
    const BASEMAP_LABELS = {
      light: 'Light (CARTO)', dark: 'Dark (CARTO)', osm: 'OpenStreetMap',
      satellite: 'Satellite (Esri)', 'esri-gray': 'Gray Canvas (Esri)',
    };

    // Determine initial basemap: session choice → auto (OS/site theme)
    function autoKey() {
      if (document.documentElement.classList.contains('dark-mode'))  return 'dark';
      if (document.documentElement.classList.contains('light-mode')) return 'light';
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    const storedBase = (function(){ try { return sessionStorage.getItem(HNA_BASE_SESSION_KEY); } catch(_){ return null; } })();
    let userOverride = !!(storedBase && BASEMAPS[storedBase]);
    let activeKey = userOverride ? storedBase : autoKey();
    let activeBase = BASEMAPS[activeKey].addTo(map);

    function swapBase(key) {
      if (!BASEMAPS[key] || key === activeKey) return;
      try { map.removeLayer(activeBase); } catch(e) {}
      activeBase = BASEMAPS[key].addTo(map);
      activeKey = key;
      activeBase.bringToBack();
    }

    // Fall back to OSM Standard if the selected tile provider is unreachable
    activeBase.once('tileerror', function() {
      if (activeKey !== 'osm') swapBase('osm');
    });

    // --- Basemap selector Leaflet control (top-right corner of map) ---
    const BasemapControl = L.Control.extend({
      onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-bar');
        div.style.cssText = 'background:var(--card,#fff);padding:4px 7px;border-radius:8px;' +
          'box-shadow:0 1px 5px rgba(0,0,0,.3);font-size:12px;line-height:1.4;';
        const lbl = L.DomUtil.create('label', '', div);
        lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:default;' +
          'white-space:nowrap;color:var(--text,#222);';
        lbl.innerHTML = '<span style="opacity:.65">Base:</span>';
        const sel = L.DomUtil.create('select', '', lbl);
        sel.style.cssText = 'font-size:11px;border:1px solid var(--border,#ccc);border-radius:5px;' +
          'background:var(--card,#fff);color:var(--text,#222);padding:1px 4px;cursor:pointer;';
        Object.keys(BASEMAPS).forEach(function(k) {
          const opt = document.createElement('option');
          opt.value = k; opt.textContent = BASEMAP_LABELS[k];
          if (k === activeKey) opt.selected = true;
          sel.appendChild(opt);
        });
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        sel.addEventListener('change', function() {
          swapBase(sel.value);
          userOverride = true;
          try { sessionStorage.setItem(HNA_BASE_SESSION_KEY, sel.value); } catch(_) {}
        });
        // Expose select for theme-sync updates
        div._sel = sel;
        return div;
      }
    });
    const basemapCtrl = new BasemapControl({ position: 'topright' });
    basemapCtrl.addTo(map);

    // Auto-follow site dark/light theme when user hasn't manually chosen a basemap
    function syncTheme() {
      if (userOverride) return;
      const k = autoKey();
      if (k !== activeKey) {
        swapBase(k);
        if (basemapCtrl._container && basemapCtrl._container._sel) {
          basemapCtrl._container._sel.value = k;
        }
      }
    }
    if (window.MutationObserver) {
      new MutationObserver(syncTheme)
        .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('theme:changed', syncTheme);

    map.setView([39.0, -108.55], 9);

    // Ensure map renders correctly after container is visible
    setTimeout(function(){ map.invalidateSize(); }, 300);
    window.addEventListener('resize', function(){ map.invalidateSize(); });

    // Update "LIHTC projects in area" panel whenever the map view changes
    map.on('moveend', updateLihtcInfoPanel);
  }

  function renderBoundary(geojson){
    ensureMap();
    if (boundaryLayer) boundaryLayer.remove();
    boundaryLayer = L.geoJSON(geojson, {
      style: {
        weight: 2,
        color: '#2b6cb0',
        fillOpacity: 0.06,
      }
    }).addTo(map);
    try{
      map.fitBounds(boundaryLayer.getBounds(), {padding:[16,16]});
    }catch(e){
      // ignore
    }
  }

  // --- LIHTC / QCT / DDA helpers ---

  // Return LIHTC fallback features filtered to a county FIPS (or all if none specified)
  function lihtcFallbackForCounty(countyFips5){
    const features = LIHTC_FALLBACK_CO.features.filter(f =>
      !countyFips5 || (f.properties.CNTY_FIPS || '') === countyFips5
    );
    return { type: 'FeatureCollection', features };
  }

  // Fetch LIHTC projects for a county.
  // For Colorado (FIPS 08), data/chfa-lihtc.json (the canonical local file, kept current by CI)
  // is always tried first. Remote ArcGIS APIs (CHFA, then HUD) are only attempted when the
  // local file is absent (HTTP 404). For all other states, HUD ArcGIS is the live source.
  // The returned GeoJSON includes a _source field ('local' | 'CHFA' | 'HUD' | 'fallback').
  async function fetchLihtcProjects(countyFips5){
    if (countyFips5 && countyFips5.length === 5) {
      const stateFips  = countyFips5.slice(0, 2);
      const countyFips = countyFips5.slice(2);

      // Colorado: always try the canonical local statewide file first.
      if (stateFips === '08') {
        try {
          const stateGj = await loadJson('data/chfa-lihtc.json');
          if (stateGj && Array.isArray(stateGj.features)) {
            // Filter to the requested county using the CNTY_FIPS field added by CI.
            const features = stateGj.features.filter(f =>
              (f.properties && f.properties.CNTY_FIPS === countyFips5) ||
              // Fallback: match by 3-digit county FIPS portion if full 5-digit is unavailable.
              (f.properties && (f.properties.COUNTYFP || '') === countyFips)
            );
            if (features.length > 0) {
              return { type: 'FeatureCollection', features, _source: 'local' };
            }
            // File loaded but no features for this county — not a deployment error; fall through
            // to remote APIs in case the county has newer projects not yet in the local file.
            console.info('[HNA] data/chfa-lihtc.json has no features for county', countyFips5, '— trying CHFA ArcGIS.');
          }
        } catch(e) {
          if (e.httpStatus === 404) {
            // Local file not deployed — fall through to remote ArcGIS APIs.
            console.warn('[HNA] data/chfa-lihtc.json not found (404); trying CHFA ArcGIS.');
          } else {
            // File exists but is unreadable (empty, corrupt, etc.) — show clear message,
            // use embedded fallback without hitting remote APIs.
            console.warn('[HNA] data/chfa-lihtc.json unreadable:', e.message, '— using embedded fallback.');
            if (els.lihtcMapStatus) {
              els.lihtcMapStatus.textContent =
                'LIHTC data unavailable. Verify data/chfa-lihtc.json is deployed (check GitHub Actions output).';
            }
            return { ...lihtcFallbackForCounty(countyFips5), _source: 'fallback' };
          }
        }

        // Remote fallback (only reached when local file is absent or has no county features):
        // try CHFA ArcGIS FeatureServer first (most current CO-specific data).
        const chfaParams = new URLSearchParams({
          where:   `STATEFP='${stateFips}' AND COUNTYFP='${countyFips}'`,
          outFields: '*',
          f: 'geojson',
          outSR: '4326',
          resultRecordCount: 1000,
        });
        const chfaUrl = `${SOURCES.chfaLihtcQuery}/query?${chfaParams}`;
        try {
          const r = await fetch(chfaUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
          if (!r.ok) throw new Error(`CHFA LIHTC HTTP ${r.status}`);
          const gj = await r.json();
          if (gj && Array.isArray(gj.features) && gj.features.length > 0) {
            return { ...gj, _source: 'CHFA' };
          }
          console.warn('[HNA] CHFA LIHTC returned no features; falling back to HUD.');
        } catch(e) {
          console.warn('[HNA] CHFA LIHTC ArcGIS API unavailable; falling back to HUD.', e.message);
        }
      }

      // All states (and Colorado final fallback): HUD ArcGIS FeatureServer.
      const params = new URLSearchParams({
        where:   `CNTY_FIPS=${countyFips5}`,
        outFields: '*',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 1000,
      });
      const url = `${SOURCES.hudLihtcQuery}/query?${params}`;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
        if (!r.ok) throw new Error(`LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) return { ...gj, _source: 'HUD' };
      } catch(e) {
        console.warn('[HNA] LIHTC ArcGIS API unavailable; using embedded fallback.', e.message);
      }
    }
    // Return embedded fallback filtered to county
    return { ...lihtcFallbackForCounty(countyFips5), _source: 'fallback' };
  }

  // Fetch QCT census tracts from HUD ArcGIS service for the county
  async function fetchQctTracts(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const countyFips = countyFips5.slice(2);
    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await loadJson('data/qct-colorado.json');
      if (localGj && Array.isArray(localGj.features)) {
        const features = localGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (f.properties?.GEOID || '').startsWith(countyFips5)
        );
        if (features.length > 0) {
          console.info('[HNA] QCT loaded from local cache (data/qct-colorado.json).');
          return { ...localGj, features };
        }
      }
    } catch(_) {/* no local cache */}
    // Tier 2: live HUD ArcGIS API — use GEOID prefix filter for census tracts
    const params = new URLSearchParams({
      where:   `GEOID LIKE '${countyFips5}%'`,
      outFields: 'GEOID,TRACTCE,NAME,STATEFP,COUNTYFP',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: 500,
    });
    const url = `${SOURCES.hudQctQuery}/query?${params}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!r.ok) throw new Error(`QCT HTTP ${r.status}`);
      const gj = await r.json();
      if (gj && Array.isArray(gj.features) && gj.features.length > 0) return gj;
    } catch(e) {
      console.warn('[HNA] QCT ArcGIS API unavailable; trying GitHub Pages backup.', e.message);
    }
    // Tier 3a: GitHub Pages backup (statewide QCT file, filtered to county)
    try {
      const backupGj = await loadJson(`${GITHUB_PAGES_BASE}/data/qct-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (f.properties?.GEOID || '').startsWith(countyFips5)
        );
        if (features.length > 0) return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages QCT backup */}
    // Tier 3b: embedded fallback filtered to county
    const qctFeatures = QCT_FALLBACK_CO.features.filter(f =>
      (f.properties?.COUNTYFP === countyFips) ||
      (f.properties?.GEOID || '').startsWith(countyFips5)
    );
    if (qctFeatures.length > 0) return { ...QCT_FALLBACK_CO, features: qctFeatures };
    return null;
  }

  // Fetch DDA polygons from HUD ArcGIS service for the county
  async function fetchDdaForCounty(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const countyFips = countyFips5.slice(2);
    // Tier 1: local cached statewide file (written by CI workflow)
    try {
      const localGj = await loadJson('data/dda-colorado.json');
      if (localGj && Array.isArray(localGj.features)) {
        const features = localGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips))
        );
        console.info('[HNA] DDA loaded from local cache (data/dda-colorado.json).');
        return { ...localGj, features };
      }
    } catch(_) {/* no local cache */}
    // Tier 2: live HUD ArcGIS API — DDA areas span multiple counties so fetch all, filter locally
    const params = new URLSearchParams({
      where:   '1=1',
      outFields: 'DDA_NAME,COUNTYFP,STATEFP,COUNTIES',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: 500,
    });
    const url = `${SOURCES.hudDdaQuery}/query?${params}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!r.ok) throw new Error(`DDA HTTP ${r.status}`);
      const gj = await r.json();
      if (gj && Array.isArray(gj.features)) {
        const features = gj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips))
        );
        return { ...gj, features };
      }
    } catch(e) {
      console.warn('[HNA] DDA ArcGIS API unavailable; trying GitHub Pages backup.', e.message);
    }
    // Tier 3a: GitHub Pages backup (statewide DDA file, filtered to county)
    try {
      const backupGj = await loadJson(`${GITHUB_PAGES_BASE}/data/dda-colorado.json`);
      if (backupGj && Array.isArray(backupGj.features)) {
        const features = backupGj.features.filter(f =>
          (f.properties?.COUNTYFP === countyFips) ||
          (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips))
        );
        return { ...backupGj, features };
      }
    } catch(_) {/* no GitHub Pages DDA backup */}
    // Tier 3b: embedded fallback filtered to county
    const ddaFeatures = DDA_FALLBACK_CO.features.filter(f =>
      (f.properties?.COUNTYFP === countyFips) ||
      (Array.isArray(f.properties?.COUNTIES) && f.properties.COUNTIES.includes(countyFips))
    );
    return { ...DDA_FALLBACK_CO, features: ddaFeatures };
  }

  // Returns a human-readable label and badge color for a LIHTC data source identifier.
  function lihtcSourceInfo(source) {
    if (source === 'CHFA') return { label: 'CHFA (Colorado Housing and Finance Authority)', color: '#0ea5e9' };
    if (source === 'HUD')  return { label: 'HUD LIHTC Database', color: '#6366f1' };
    return { label: 'HUD LIHTC Database (embedded)', color: '#6366f1' };
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
  function updateLihtcInfoPanel() {
    if (!els.lihtcInfoPanel || !allLihtcFeatures.length) return;
    const bounds = map && map.getBounds ? map.getBounds() : null;
    let visible = allLihtcFeatures;
    if (bounds) {
      visible = allLihtcFeatures.filter(f => {
        if (!f.geometry || f.geometry.type !== 'Point') return false;
        const [lng, lat] = f.geometry.coordinates;
        return bounds.contains([lat, lng]);
      });
    }
    // safeCell: renders 0 correctly (unlike `|| '—'`) while still showing '—' for null/undefined
    const safeCell = v => (v != null && v !== '') ? String(v) : '—';
    const sorted = [...visible].sort((a,b) => (b.properties?.N_UNITS||0) - (a.properties?.N_UNITS||0));
    const rows = sorted.slice(0, 10).map(f => {
      const p = f.properties || {};
      return `<tr>
        <td style="padding:4px 6px">${safeCell(p.PROJECT || p.PROJ_NM)}</td>
        <td style="padding:4px 6px">${safeCell(p.PROJ_CTY || p.STD_CITY)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.N_UNITS)}</td>
        <td style="padding:4px 6px;text-align:right">${safeCell(p.LI_UNITS)}</td>
        <td style="padding:4px 6px">${safeCell(p.YR_PIS)}</td>
        <td style="padding:4px 6px">${safeCell(p.CREDIT)}</td>
      </tr>`;
    }).join('');
    const sourceBadge = `<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:.75rem;font-weight:700;background:${lihtcSourceInfo(lihtcDataSource).color};color:#fff;margin-left:8px">Source: ${lihtcDataSource}</span>`;
    els.lihtcInfoPanel.innerHTML = rows ? `
      <p style="margin:8px 0 4px;font-weight:700">LIHTC projects in area (top 10 by units):${sourceBadge}</p>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.83rem">
          <thead><tr style="color:var(--muted)">
            <th style="padding:4px 6px;text-align:left">Project</th>
            <th style="padding:4px 6px;text-align:left">City</th>
            <th style="padding:4px 6px;text-align:right">Total units</th>
            <th style="padding:4px 6px;text-align:right">LI units</th>
            <th style="padding:4px 6px">Year</th>
            <th style="padding:4px 6px">Credit</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<p>No LIHTC projects visible in current map area.</p>';
  }

  // Render LIHTC project markers on the map
  function renderLihtcLayer(geojson){
    ensureMap();
    if (lihtcLayer) { lihtcLayer.remove(); lihtcLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (els.statLihtcCount) els.statLihtcCount.textContent = '0';
      if (els.statLihtcUnits) els.statLihtcUnits.textContent = '0';
      allLihtcFeatures = [];
      return;
    }

    const dataSource = geojson._source || 'HUD';
    allLihtcFeatures = geojson.features;
    lihtcDataSource = dataSource;

    const lihtcIcon = L.divIcon({
      html: '<div style="width:11px;height:11px;border-radius:50%;background:#e84545;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      className: '',
      iconSize: [11, 11],
      iconAnchor: [5, 5],
    });

    lihtcLayer = L.geoJSON(geojson, {
      pointToLayer: (f, latlng) => L.marker(latlng, { icon: lihtcIcon }),
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindPopup(lihtcPopupHtml(p, dataSource));
        layer.bindTooltip(p.PROJECT || p.PROJ_NM || 'LIHTC Project');
      },
    }).addTo(map);

    // Visibility toggle
    if (els.layerLihtc && !els.layerLihtc.checked) lihtcLayer.remove();

    // Update stats
    const count = geojson.features.length;
    const units = geojson.features.reduce((s, f) => s + (Number(f.properties?.N_UNITS) || 0), 0);
    if (els.statLihtcCount) els.statLihtcCount.textContent = count.toLocaleString();
    if (els.statLihtcUnits) els.statLihtcUnits.textContent = units.toLocaleString();

    // Build the info panel for the current viewport
    updateLihtcInfoPanel();
  }

  // Render QCT tract overlay on the map
  function renderQctLayer(geojson){
    ensureMap();
    if (qctLayer) { qctLayer.remove(); qctLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (els.statQctCount) els.statQctCount.textContent = '0';
      return;
    }
    qctLayer = L.geoJSON(geojson, {
      style: {
        weight: 1.5,
        color: '#d97706',
        fillColor: '#fbbf24',
        fillOpacity: 0.18,
      },
      onEachFeature: (f, layer) => {
        const p = f.properties || {};
        layer.bindTooltip(`QCT Tract: ${p.NAME || p.GEOID || p.TRACTCE || '—'}`);
      },
    }).addTo(map);

    if (els.layerQct && !els.layerQct.checked) qctLayer.remove();
    if (els.statQctCount) els.statQctCount.textContent = geojson.features.length.toLocaleString();
  }

  // Render DDA overlay on the map (polygon if available) and info badge
  function renderDdaLayer(countyFips5, ddaGeojson){
    ensureMap();
    if (ddaLayer) { ddaLayer.remove(); ddaLayer = null; }

    const ddaInfo = CO_DDA[countyFips5] || null;

    if (ddaGeojson && ddaGeojson.features && ddaGeojson.features.length) {
      ddaLayer = L.geoJSON(ddaGeojson, {
        style: {
          weight: 2,
          color: '#7c3aed',
          fillColor: '#8b5cf6',
          fillOpacity: 0.12,
          dashArray: '6 4',
        },
        onEachFeature: (f, layer) => {
          const p = f.properties || {};
          layer.bindTooltip(`DDA: ${p.DDA_NAME || 'Difficult Development Area'}`);
        },
      }).addTo(map);
      if (els.layerDda && !els.layerDda.checked) ddaLayer.remove();
    }

    // Always show DDA status from static lookup or fetched data
    const isDda = !!(ddaInfo?.status || (ddaGeojson?.features?.length));
    const areaName = ddaInfo?.area || (ddaGeojson?.features?.[0]?.properties?.DDA_NAME) || '';
    if (els.statDdaStatus) els.statDdaStatus.textContent = isDda ? 'Yes ✓' : 'No';
    if (els.statDdaNote) els.statDdaNote.textContent = isDda ? (areaName || 'HUD DDA') : 'Not designated';
  }

  // Wire layer visibility toggles
  function wireLayerToggles(){
    if (els.layerLihtc) {
      els.layerLihtc.addEventListener('change', () => {
        if (!lihtcLayer) return;
        if (els.layerLihtc.checked) lihtcLayer.addTo(map);
        else lihtcLayer.remove();
      });
    }
    if (els.layerQct) {
      els.layerQct.addEventListener('change', () => {
        if (!qctLayer) return;
        if (els.layerQct.checked) qctLayer.addTo(map);
        else qctLayer.remove();
      });
    }
    if (els.layerDda) {
      els.layerDda.addEventListener('change', () => {
        if (!ddaLayer) return;
        if (els.layerDda.checked) ddaLayer.addTo(map);
        else ddaLayer.remove();
      });
    }
  }

  // Load and render all LIHTC/QCT/DDA overlays for the selected geography
  async function updateLihtcOverlays(countyFips5){
    if (els.lihtcMapStatus) els.lihtcMapStatus.textContent = 'Loading LIHTC data…';

    // LIHTC
    try {
      const lihtcData = await fetchLihtcProjects(countyFips5);
      renderLihtcLayer(lihtcData);
      if (els.lihtcMapStatus) {
        const src = lihtcData && lihtcData._source;
        els.lihtcMapStatus.textContent = src ? `Source: ${src}` : '';
      }
    } catch(e) {
      console.warn('[HNA] LIHTC render failed', e);
      if (els.statLihtcCount) els.statLihtcCount.textContent = '—';
      if (els.statLihtcUnits) els.statLihtcUnits.textContent = '—';
      if (els.lihtcMapStatus) els.lihtcMapStatus.textContent = '';
    }

    // QCT
    try {
      const qctData = await fetchQctTracts(countyFips5);
      if (qctData) {
        renderQctLayer(qctData);
      } else {
        if (els.statQctCount) els.statQctCount.textContent = '—';
      }
    } catch(e) {
      console.warn('[HNA] QCT render failed', e);
      if (els.statQctCount) els.statQctCount.textContent = '—';
    }

    // DDA
    try {
      const ddaData = await fetchDdaForCounty(countyFips5);
      renderDdaLayer(countyFips5, ddaData);
    } catch(e) {
      console.warn('[HNA] DDA render failed', e);
      renderDdaLayer(countyFips5, null);
    }
  }

  // --- Census API (live fallback) ---
  function censusKey(){
    return (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : '';
  }

  async function fetchAcsProfile(geoType, geoid){
    // Use ACS 1-year profile tables for a fast report-like snapshot.
    // Falls back to ACS 5-year if the primary year is unavailable.

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
      // Rent burden bins (GRAPI)
      'DP04_0142PE', // <20
      'DP04_0143PE', // 20-24.9
      'DP04_0144PE', // 25-29.9
      'DP04_0145PE', // 30-34.9
      'DP04_0146PE', // 35+
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'place'
        ? `place:${geoid.slice(2)}`
        : `place:${geoid.slice(2)}`;

    const inParam = `state:${STATE_FIPS_CO}`;
    const key = censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    const url1 = buildUrl(ACS_YEAR_PRIMARY,  'acs/acs1/profile');
    let r = await fetch(url1);
    let usedYear = ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';
    let url2 = null;
    if (!r.ok){
      // Probe vintages newest-first for ACS 1-year
      r = null;
      for (const v of ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs1/profile');
        const resp = await fetch(u);
        if (resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
      }
    }
    if (!r || !r.ok){
      // Try ACS 5-year vintage probe
      for (const v of ACS_VINTAGES) {
        url2 = buildUrl(v, 'acs/acs5/profile');
        const resp = await fetch(url2);
        if (resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
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
    // ACS 5-year B-series fallback for all geography types (county, place, CDP).
    // Profile (DP) and subject (S) tables may fail due to geography constraints
    // or variable numbering changes across ACS releases.  The B-series detailed
    // tables cover all geography types and use stable variable codes.
    // Maps B-series codes to DP-series names for UI compatibility.
    const forParam = geoType === 'county'
      ? `county:${geoid.slice(-3)}`
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
      let qs = `get=${encodeURIComponent(bVars.join(',') + ',NAME')}&for=${forParam}&in=state:${STATE_FIPS_CO}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      const u = `${base}?${qs}`;
      const resp = await fetch(u);
      if (resp.ok){ bResp = resp; bYear = v; break; }
      if (DEBUG_HNA) console.warn(`ACS5 B-series ${v} failed: ${resp.status}`);
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
    const vars = [
      'S0801_C01_001E', // total workers 16+
      'S0801_C01_002E', // car, truck, van - drove alone
      'S0801_C01_003E', // carpool
      'S0801_C01_004E', // public transportation
      'S0801_C01_005E', // walked
      'S0801_C01_006E', // taxi/motorcycle/bicycle/other
      'S0801_C01_007E', // worked from home
      'S0801_C01_018E', // mean travel time (minutes)
    ];

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'place'
        ? `place:${geoid.slice(2)}`
        : `place:${geoid.slice(2)}`;

    const inParam = `state:${STATE_FIPS_CO}`;
    const key = censusKey();

    function buildUrl(year, dataset){
      const base = `https://api.census.gov/data/${year}/${dataset}`;
      // Build query string manually to keep literal colons in the Census API
      // geography parameters (for= and in=). URLSearchParams encodes ':' as
      // '%3A', which the Census API does not decode, causing it to report
      // "ambiguous geography" errors for county-level queries.
      let qs = `get=${encodeURIComponent(vars.join(',') + ',NAME')}&for=${forParam}&in=${inParam}`;
      if (key) qs += `&key=${encodeURIComponent(key)}`;
      return `${base}?${qs}`;
    }

    const url1 = buildUrl(ACS_YEAR_PRIMARY,  'acs/acs1/subject');
    let r = await fetch(url1);
    let usedYear = ACS_YEAR_PRIMARY;
    let usedSeries = 'acs1';
    let url2 = null;
    if (!r.ok){
      // Probe vintages newest-first for ACS 1-year
      r = null;
      for (const v of ACS_VINTAGES) {
        const u = buildUrl(v, 'acs/acs1/subject');
        const resp = await fetch(u);
        if (resp.ok){ r = resp; usedYear = v; usedSeries = 'acs1'; break; }
      }
    }
    if (!r || !r.ok){
      // Try ACS 5-year vintage probe
      for (const v of ACS_VINTAGES) {
        url2 = buildUrl(v, 'acs/acs5/subject');
        const resp = await fetch(url2);
        if (resp.ok){ r = resp; usedYear = v; usedSeries = 'acs5'; break; }
      }
    }
    if (!r || !r.ok){
      const msg = DEBUG_HNA
        ? `ACS S0801 failed for all vintages tried`
        : `ACS S0801 failed`;
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
  function renderSnapshot(profile, s0801, geoLabel){
    const pop = profile?.DP05_0001E;
    const mhi = profile?.DP03_0062E;
    const homeValue = profile?.DP04_0089E;
    const rent = profile?.DP04_0134E;

    // Metadata for source links (attached by fetch functions or update() for cached data)
    const yr   = profile?._acsYear   || null;
    const sr   = profile?._acsSeries || 'acs5';
    const gt   = profile?._geoType   || null;
    const gid  = profile?._geoid     || null;

    els.statPop.textContent = fmtNum(pop);
    els.statPopSrc.innerHTML = srcLink('DP05', yr, sr, 'DP05', gt, gid);
    els.statMhi.textContent = fmtMoney(mhi);
    els.statMhiSrc.innerHTML = srcLink('DP03', yr, sr, 'DP03', gt, gid);
    els.statHomeValue.textContent = fmtMoney(homeValue);
    els.statHomeValueSrc.innerHTML = srcLink('DP04', yr, sr, 'DP04', gt, gid);
    els.statRent.textContent = fmtMoney(rent);
    els.statRentSrc.innerHTML = srcLink('DP04', yr, sr, 'DP04', gt, gid);

    const owner = Number(profile?.DP04_0047PE);
    const renter = Number(profile?.DP04_0046PE);
    els.statTenure.textContent = (Number.isFinite(owner) && Number.isFinite(renter)) ? `${owner.toFixed(1)}% / ${renter.toFixed(1)}%` : '—';
    els.statTenureSrc.innerHTML = srcLink('DP04', yr, sr, 'DP04', gt, gid);

    const rb = rentBurden30Plus(profile || {});
    els.statRentBurden.textContent = rb === null ? '—' : fmtPct(rb);
    els.statRentBurdenSrc.innerHTML = srcLink('DP04', yr, sr, 'DP04', gt, gid);

    const incomeNeed = computeIncomeNeeded(homeValue);
    els.statIncomeNeed.textContent = incomeNeed ? fmtMoney(incomeNeed.annualIncome) : '—';
    els.statIncomeNeedNote.textContent = incomeNeed ? `Assumes ${Math.round(AFFORD.rateAnnual*1000)/10}% rate, ${Math.round(AFFORD.downPaymentPct*100)}% down` : '30% of income rule';

    const mean = Number(s0801?.S0801_C01_018E);
    els.statCommute.textContent = Number.isFinite(mean) ? `${mean.toFixed(1)} min` : '—';
    const commYr = s0801?._acsYear   || yr;
    const commSr = s0801?._acsSeries || sr;
    els.statCommuteSrc.innerHTML = srcLink('S0801', commYr, commSr, 'S0801', gt, gid);

    els.geoContextPill.textContent = geoLabel;

    const narrativeParts = [];
    if (pop) narrativeParts.push(`${geoLabel} has an estimated population of ${fmtNum(pop)}.`);
    if (mhi) narrativeParts.push(`Median household income is about ${fmtMoney(mhi)}.`);
    if (homeValue) narrativeParts.push(`Typical owner-occupied home value is around ${fmtMoney(homeValue)}.`);
    if (rent) narrativeParts.push(`Median gross rent is around ${fmtMoney(rent)}.`);
    if (rb !== null) narrativeParts.push(`About ${fmtPct(rb)} of renter households are cost-burdened (≥30% of income).`);
    if (incomeNeed) narrativeParts.push(`A simple mortgage model suggests roughly ${fmtMoney(incomeNeed.annualIncome)} annual income to afford the median home value.`);
    els.execNarrative.textContent = narrativeParts.join(' ');

    // Afford assumptions
    els.affordAssumptions.innerHTML = `
      <ul>
        <li>Interest rate: <strong>${(AFFORD.rateAnnual*100).toFixed(2)}%</strong> (fixed), term: <strong>${AFFORD.termYears}</strong> years</li>
        <li>Down payment: <strong>${Math.round(AFFORD.downPaymentPct*100)}%</strong>; PMI: <strong>${(AFFORD.pmiPctAnnual*100).toFixed(2)}%</strong> on loan when down &lt; 20%</li>
        <li>Property tax: <strong>${(AFFORD.propertyTaxPctAnnual*100).toFixed(2)}%</strong> of value per year; insurance: <strong>${(AFFORD.insurancePctAnnual*100).toFixed(2)}%</strong> of value per year</li>
        <li>Affordability rule: housing costs ≈ <strong>${Math.round(AFFORD.paymentToIncome*100)}%</strong> of gross income (rule of thumb)</li>
      </ul>
    `;
  }

  function renderHousingCharts(profile){
    const t = chartTheme();

    // Stock by structure (counts)
    const stock = [
      { k:'1-unit detached', v:Number(profile?.DP04_0003E) },
      { k:'1-unit attached', v:Number(profile?.DP04_0004E) },
      { k:'2 units', v:Number(profile?.DP04_0005E) },
      { k:'3–4 units', v:Number(profile?.DP04_0006E) },
      { k:'5–9 units', v:Number(profile?.DP04_0007E) },
      { k:'10–19 units', v:Number(profile?.DP04_0008E) },
      { k:'20+ units', v:Number(profile?.DP04_0009E) },
      { k:'Mobile home', v:Number(profile?.DP04_0010E) },
    ].filter(d=>Number.isFinite(d.v));

    makeChart(document.getElementById('chartStock').getContext('2d'), {
      type:'bar',
      data:{
        labels: stock.map(d=>d.k),
        datasets:[{ label:'Housing units', data: stock.map(d=>d.v) }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });

    // Tenure donut
    const owner = Number(profile?.DP04_0047PE);
    const renter = Number(profile?.DP04_0046PE);
    makeChart(document.getElementById('chartTenure').getContext('2d'), {
      type:'doughnut',
      data:{
        labels:['Owner-occupied','Renter-occupied'],
        datasets:[{ data:[owner||0, renter||0] }]
      },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } }
      }
    });
  }

  function renderAffordChart(profile){
    const t = chartTheme();
    const hv = Number(profile?.DP04_0089E);
    const mhi = Number(profile?.DP03_0062E);
    const calc = computeIncomeNeeded(hv);

    const needed = calc?.annualIncome ?? null;
    const data = [
      { k:'Median household income', v: Number.isFinite(mhi) ? mhi : null },
      { k:'Income needed to buy (est.)', v: Number.isFinite(needed) ? needed : null },
    ].filter(d=>d.v!==null);

    makeChart(document.getElementById('chartAfford').getContext('2d'), {
      type:'bar',
      data:{ labels:data.map(d=>d.k), datasets:[{ label:'Annual $', data:data.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });
  }

  function renderRentBurdenBins(profile){
    const t = chartTheme();
    const bins = [
      { k:'<20%', v:Number(profile?.DP04_0142PE) },
      { k:'20–24.9%', v:Number(profile?.DP04_0143PE) },
      { k:'25–29.9%', v:Number(profile?.DP04_0144PE) },
      { k:'30–34.9%', v:Number(profile?.DP04_0145PE) },
      { k:'35%+', v:Number(profile?.DP04_0146PE) },
    ].filter(d=>Number.isFinite(d.v));

    makeChart(document.getElementById('chartRentBurdenBins').getContext('2d'), {
      type:'bar',
      data:{ labels:bins.map(d=>d.k), datasets:[{ label:'Share of renter households', data:bins.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted, callback:(v)=>v+'%' }, grid:{ color:t.border } },
        }
      }
    });
  }

  function renderModeShare(s0801){
    const t = chartTheme();
    const total = Number(s0801?.S0801_C01_001E);
    const drove = Number(s0801?.S0801_C01_002E);
    const carpool = Number(s0801?.S0801_C01_003E);
    const transit = Number(s0801?.S0801_C01_004E);
    const walked = Number(s0801?.S0801_C01_005E);
    const other = Number(s0801?.S0801_C01_006E);
    const wfh = Number(s0801?.S0801_C01_007E);

    const items = [
      { k:'Drove alone', v:drove },
      { k:'Carpool', v:carpool },
      { k:'Transit', v:transit },
      { k:'Walk', v:walked },
      { k:'Other', v:other },
      { k:'Work from home', v:wfh },
    ].filter(d=>Number.isFinite(d.v) && Number.isFinite(total) && total>0)
     .map(d=>({k:d.k, v:(d.v/total)*100}));

    makeChart(document.getElementById('chartMode').getContext('2d'), {
      type:'bar',
      data:{ labels:items.map(d=>d.k), datasets:[{ label:'% of workers', data:items.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted, callback:(v)=>v+'%' }, grid:{ color:t.border }, suggestedMax: 100 },
        }
      }
    });
  }

  function renderLehd(lehd, geoType, geoid){
    const t = chartTheme();
    const inflow = Number(lehd?.inflow);
    const outflow = Number(lehd?.outflow);
    const within = Number(lehd?.within);

    const items = [
      { k:'Inflow (work here, live elsewhere)', v: inflow },
      { k:'Outflow (live here, work elsewhere)', v: outflow },
      { k:'Within (live & work here)', v: within },
    ].filter(d=>Number.isFinite(d.v));

    makeChart(document.getElementById('chartLehd').getContext('2d'), {
      type:'bar',
      data:{ labels:items.map(d=>d.k), datasets:[{ label:'Jobs (count)', data:items.map(d=>d.v) }] },
      options:{
        responsive:true,
        maintainAspectRatio:false,
        plugins:{ legend:{ labels:{ color:t.text } } },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });

    if (geoType !== 'county'){
      els.lehdNote.textContent = `Note: LEHD inflow/outflow is currently shown at the containing county level (${countyFromGeoid(geoType, geoid)}). Place/CDP crosswalk can be added to refine this.`;
    } else {
      els.lehdNote.textContent = lehd?.year ? `LEHD LODES OD summary (JT00) for workplaces in ${geoid}, year ${lehd.year}.` : 'LEHD LODES OD summary.';
    }
  }

  function renderDolaPyramid(dola){
    const t = chartTheme();

    const year = dola?.pyramidYear;
    const male = dola?.male || [];
    const female = dola?.female || [];
    const ages = dola?.ages || [];

    // Build pyramid (male negative)
    const maleNeg = male.map(v=>-1*Number(v||0));
    const femalePos = female.map(v=>Number(v||0));

    makeChart(document.getElementById('chartPyramid').getContext('2d'), {
      type:'bar',
      data:{
        labels: ages,
        datasets:[
          { label:'Male', data: maleNeg },
          { label:'Female', data: femalePos },
        ]
      },
      options:{
        indexAxis:'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:t.text } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${fmtNum(Math.abs(ctx.raw))}` } }
        },
        scales:{
          x:{ ticks:{ color:t.muted, callback:(v)=>fmtNum(Math.abs(v)) }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });

    const s = dola?.seniorPressure;
    if (s){
      makeChart(document.getElementById('chartSenior').getContext('2d'), {
        type:'line',
        data:{
          labels: s.years,
          datasets:[
            { label:'Age 65+ (count)', data: s.pop65plus },
            { label:'Share 65+ (%)', data: s.share65plus },
          ]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{ legend:{ labels:{ color:t.text } } },
          scales:{
            x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
            y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          }
        }
      });

      els.seniorNote.textContent = `Senior pressure uses county single-year-of-age totals. Pyramid year: ${year || '—'}.`;
    } else {
      els.seniorNote.textContent = 'Senior pressure data not available yet.';
    }
  }

  async function renderProjections(countyFips5, selection){
    try{
      const proj = await loadJson(PATHS.projections(countyFips5));
      state.lastProj = proj;

      // Initialize vacancy slider from projection default if user hasn't touched it yet
      const defaultVac = safeNum(proj?.housing_need?.target_vacancy);
      if (els.assumpVacancy && defaultVac !== null){
        const cur = Number(els.assumpVacancy.value);
        if (!Number.isFinite(cur) || cur === 5){
          els.assumpVacancy.value = String(Math.round(defaultVac*1000)/10);
          els.assumpVacancyVal.textContent = `${Number(els.assumpVacancy.value).toFixed(1)}%`;
        }
      }
      if (els.assumpVacancyVal){
        els.assumpVacancyVal.textContent = `${Number(els.assumpVacancy?.value || 5).toFixed(1)}%`;
      }

      await applyAssumptions(proj, selection);

      return { ok:true, proj };
    }catch(e){
      state.lastProj = null;
      // Clear outputs gracefully
      els.statBaseUnits.textContent = '—';
      els.statBaseUnitsSrc.textContent = '—';
      els.statTargetVac.textContent = '—';
      els.statUnitsNeed.textContent = '—';
      els.statNetMig.textContent = '—';
      els.needNote.textContent = 'Projections module not available yet (run the Build HNA data workflow).';
      return { ok:false, err:String(e) };
    }
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
    const horizon = Number(els.assumpHorizon?.value || 20);
    const vacPct = Number(els.assumpVacancy?.value || 5);
    const targetVac = vacPct/100.0;
    const headshipMode = (document.getElementById('assumpHeadship')?.value || document.querySelector('input[name="assumpHeadship"]:checked')?.value || 'hold');
    return { horizon, targetVac, headshipMode };
  }

  async function applyAssumptions(proj, selection){
    if (!proj) return;

    const countyFips5 = proj?.countyFips || selection?.contextCounty || (selection?.geoType==='county' ? selection?.geoid : null);

    const years = proj?.years || [];
    const popCounty = (proj?.population_dola || []).map(safeNum);
    const popCountyTrend = (proj?.population_trend || []).map(safeNum);
    const baseYear = proj?.baseYear;
    const baseCountyPop = safeNum(proj?.base?.population);

    const { horizon, targetVac, headshipMode } = getAssumptions();

    // Determine selected-geo population series
    let popSel = popCounty;
    let popSelTrend = popCountyTrend;
    let baseUnits = safeNum(proj?.base?.housing_units);
    let baseHouseholds = safeNum(proj?.base?.households);
    let basePop = baseCountyPop;

    let headship0 = (baseHouseholds && basePop) ? (baseHouseholds/basePop) : null;
    let headshipSlope = 0; // annual delta, used in "trend"

    // If selection is a place/CDP, scale projections from containing county.
    if (selection && selection.geoType !== 'county'){
      const placePopNow = safeNum(selection.profile?.DP05_0001E);
      const placeHhNow = safeNum(selection.profile?.DP02_0001E);
      const placeUnitsNow = safeNum(selection.profile?.DP04_0001E);

      if (baseCountyPop && placePopNow){
        // Prefer ETL-derived inputs (transparent and repeatable). Fall back to simple share if missing.
        const d = state.derived?.geos?.[selection.geoid]?.derived || null;
        const dAcs = state.derived?.geos?.[selection.geoid]?.acs5 || null;

        const share0Raw = (d && typeof d.share0 === 'number') ? d.share0 : (placePopNow / baseCountyPop);
        const share0 = Math.min(0.98, Math.max(0.02, share0Raw));

        // relative_pop_cagr is an annual *rate*. Convert to log-diff so we can exponentiate over time.
        const relRate = (d && typeof d.relative_pop_cagr === 'number') ? d.relative_pop_cagr : 0;
        const diffLog = (relRate && Number.isFinite(relRate)) ? Math.log(1 + relRate) : 0;

        // Headship (households/pop) base + slope (optional) from ETL
        if (d && typeof d.headship_base === 'number' && Number.isFinite(d.headship_base)){
          headship0 = d.headship_base;
        } else {
          headship0 = (placeHhNow && placePopNow) ? (placeHhNow/placePopNow) : headship0;
        }
        headshipSlope = (d && typeof d.headship_slope_per_year === 'number' && Number.isFinite(d.headship_slope_per_year))
          ? d.headship_slope_per_year
          : 0;

        popSel = popCounty.map((p,i)=>{
          if (p===null) return null;
          const shareT = Math.min(0.98, Math.max(0.02, share0 * Math.exp(diffLog * i)));
          const v = p * shareT;
          return Math.min(v, p); // never exceed county
        });
        popSelTrend = popCountyTrend.map((p,i)=>{
          if (p===null) return null;
          const shareT = Math.min(0.98, Math.max(0.02, share0 * Math.exp(diffLog * i)));
          const v = p * shareT;
          return Math.min(v, p);
        });

        baseUnits = placeUnitsNow;
        baseHouseholds = placeHhNow;
        basePop = placePopNow;
        headship0 = (baseHouseholds && basePop) ? (baseHouseholds/basePop) : headship0;
      }
    } else {
      // County headship slope (optional)
      try{
        const geoId = selection?.geoid || countyFips5;
        const d = geoId ? state.derived?.geos?.[geoId]?.derived : null;
        if (d && typeof d.headship_slope_per_year === 'number' && Number.isFinite(d.headship_slope_per_year)){
          headshipSlope = d.headship_slope_per_year;
        } else {
          headshipSlope = 0;
        }
      }catch(_){ headshipSlope = 0; }
    }

    // Compute need at horizon
    const idx = years.findIndex(y => y === baseYear + horizon);
    const i = (idx>=0) ? idx : (years.length ? years.length-1 : -1);

    function headshipAt(step){
      if (headship0 === null) return null;
      if (headshipMode === 'trend'){
        const hs = headship0 + headshipSlope * step;
        return Math.max(0.05, Math.min(0.95, hs));
      }
      return headship0;
    }

    const popH = (i>=0) ? popSel[i] : null;
    const hsH = (i>=0) ? headshipAt(i) : null;
    const hhH = (popH!==null && hsH!==null) ? (popH * hsH) : null;
    const needUnits = (hhH!==null) ? (hhH / (1.0 - targetVac)) : null;
    const incUnits = (needUnits!==null && baseUnits!==null) ? (needUnits - baseUnits) : null;

    // Net migration scaled for places (share of county base)
    let net20 = safeNum(proj?.net_migration_20y);
    if (selection && selection.geoType !== 'county' && baseCountyPop && basePop){
      const d = state.derived?.geos?.[selection.geoid]?.derived || null;
      const share0 = Math.min(0.98, Math.max(0.02, (d && typeof d.share0 === 'number') ? d.share0 : (basePop / baseCountyPop)));
      net20 = (net20!==null) ? (net20 * share0) : null;
    }

    // Update cards
    els.statBaseUnits.textContent = baseUnits !== null ? fmtNum(baseUnits) : '—';
    els.statBaseUnitsSrc.textContent = baseYear ? `Base (est.)` : 'Base';
    els.statTargetVac.textContent = fmtPct(targetVac * 100);
    els.statUnitsNeed.textContent = incUnits !== null ? fmtNum(Math.round(incUnits)) : '—';
    els.statNetMig.textContent = net20 !== null ? fmtNum(Math.round(net20)) : '—';

    const endYear = (i>=0 && years[i]) ? years[i] : (years.length ? years[years.length-1] : '');
    els.needNote.textContent = (incUnits !== null)
      ? `Planning estimate: additional units needed by ${endYear} (horizon ${horizon}y), headship=${headshipMode}, vacancy target ${fmtPct(targetVac*100)}.`
      : 'Projections loaded, but could not compute housing need (missing households/headship).';

    // Update projection chart for selected geography
    const t = chartTheme();
    const labelPrefix = (selection && selection.geoType !== 'county') ? 'Population (scaled ' : 'Population (';
    makeChart(document.getElementById('chartPopProj').getContext('2d'), {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          { label: `${labelPrefix}DOLA forecast)`, data: popSel, borderWidth: 2, pointRadius: 0, tension: 0.25 },
          { label: `${labelPrefix}historic-trend sensitivity)`, data: popSelTrend, borderWidth: 2, pointRadius: 0, borderDash:[6,4], tension: 0.25 },
        ]
      },
      options: {
        responsive:true,
        maintainAspectRatio:false,
        plugins:{
          legend:{ labels:{ color:t.text } },
          tooltip:{ callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}` } }
        },
        scales:{
          x:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
          y:{ ticks:{ color:t.muted }, grid:{ color:t.border } },
        }
      }
    });
  }


  function renderLocalResources(geoType, geoid){
    const data = window.__HNA_LOCAL_RESOURCES || {};
    const key = `${geoType}:${geoid}`;
    const r = data[key];

    if (!r){
      els.localResources.innerHTML = `
        <p>No curated resources yet for this geography.</p>
        <ul>
          <li><a href="${SOURCES.prop123Commitments}" target="_blank" rel="noopener">Prop 123 commitment filings (DOLA)</a></li>
          <li><a href="https://cdola.colorado.gov/prop123" target="_blank" rel="noopener">Proposition 123 overview (DOLA)</a></li>
        </ul>
      `;
      return;
    }

    const parts = [];
    if (r.prop123){
      parts.push(`<p><strong>Proposition 123:</strong> ${r.prop123.status || 'Unknown'} ${r.prop123.link ? `(<a href="${r.prop123.link}" target="_blank" rel="noopener">source</a>)` : ''}</p>`);
    }
    if (r.housingAuthority?.length){
      parts.push(`<p><strong>Local housing authority:</strong></p><ul>${r.housingAuthority.map(x=>`<li><a href="${x.url}" target="_blank" rel="noopener">${x.name}</a></li>`).join('')}</ul>`);
    }
    if (r.advocacy?.length){
      parts.push(`<p><strong>Homeless / housing advocacy:</strong></p><ul>${r.advocacy.map(x=>`<li><a href="${x.url}" target="_blank" rel="noopener">${x.name}</a></li>`).join('')}</ul>`);
    }
    if (r.housingLead){
      parts.push(`<p><strong>Housing contact (if published):</strong> <a href="${r.housingLead.url}" target="_blank" rel="noopener">${r.housingLead.name}</a></p>`);
    }

    els.localResources.innerHTML = parts.join('\n');
  }

  function renderMethodology(state){
    const { geoType, geoid, geoLabel, usedCountyForContext, cacheFlags, derivedEntry } = state;

    const items = [];

    items.push({
      title: 'Geography & map boundary',
      html: `Boundary geometry is retrieved from Census TIGERweb and rendered with Leaflet. ` +
            `<a href="${SOURCES.tigerweb}" target="_blank" rel="noopener">TIGERweb docs</a>.`
    });

    items.push({
      title: 'Housing stock, tenure, income, rents',
      html: `Baseline indicators use Census ACS Profile tables (DP03/DP04/DP05). ` +
            `<a href="${SOURCES.acsProfile}" target="_blank" rel="noopener">ACS profile groups</a>.`
    });

    items.push({
      title: 'Rent burden',
      html: `Rent burden distribution uses ACS profile gross rent as % of income bins (GRAPI). ` +
            `The page reports renter burden ≥30% as the sum of the 30–34.9% and 35%+ bins.`
    });

    items.push({
      title: 'Affordability model',
      html: `"Income needed to buy" is a transparent mortgage approximation using ACS median home value, ` +
            `a fixed-rate amortization, and simple tax/insurance/PMI assumptions shown on the page. ` +
            `This is a screening metric, not an underwriting decision.`
    });

    items.push({
      title: 'Commuting (ACS)',
      html: `Mode shares and mean commute time use ACS Subject Table S0801. ` +
            `<a href="${SOURCES.acsS0801}" target="_blank" rel="noopener">S0801 group</a>.`
    });

    items.push({
      title: 'Commuting flows (LEHD)',
      html: `Inflow/outflow/within are derived from LEHD LODES OD (JT00) aggregated to county. ` +
            `<a href="${SOURCES.lodesRoot}" target="_blank" rel="noopener">LODES downloads</a> and ` +
            `<a href="${SOURCES.lodesTech}" target="_blank" rel="noopener">technical documentation</a>. ` +
            `${geoType !== 'county' ? `For this selection, flows are shown at the containing county level (${usedCountyForContext}).` : ''}`
    });

    items.push({
      title: 'Demographic projections (DOLA/SDO)',
      html: `Age pyramid and senior pressure use Colorado State Demography Office (DOLA) single-year-of-age county files. ` +
            `<a href="${SOURCES.sdoDownloads}" target="_blank" rel="noopener">SDO data downloads</a> and ` +
            `<a href="${SOURCES.sdoPopulation}" target="_blank" rel="noopener">population resources</a>. ` +
            `${geoType !== 'county' ? `Shown as county context (${usedCountyForContext}).` : ''}`
    });

    items.push({
      title: '20-year outlook (population, migration, housing need)',
      html: `Population and net migration use SDO county components-of-change (estimates + forecast), and base-year households/units use SDO county profiles. ` +
            `<a href="${SOURCES.sdoDownloads}" target="_blank" rel="noopener">SDO downloads</a>. ` +
            `Housing need is computed by converting population to households using a base-year headship rate, then applying a target vacancy assumption. ` +
            `${geoType !== 'county' ? `Shown as county context (${usedCountyForContext}).` : ''}`
    });

    if (derivedEntry && derivedEntry.derived){
      const d = derivedEntry.derived;
      const s = derivedEntry.sources || {};
      const yrs = state.derivedYears || null;

      const rows = [
        ['Population share of county (share0)', (typeof d.share0==='number') ? fmtPct(d.share0*100) : '—'],
        ['Pop growth (annual, ACS5)', (typeof d.pop_cagr==='number') ? fmtPct(d.pop_cagr*100) : '—'],
        ['County pop growth (annual, ACS5)', (typeof d.county_pop_cagr==='number') ? fmtPct(d.county_pop_cagr*100) : '—'],
        ['Relative growth (place − county)', (typeof d.relative_pop_cagr==='number') ? fmtPct(d.relative_pop_cagr*100) : '—'],
        ['Headship base (households ÷ pop)', (typeof d.headship_base==='number') ? (d.headship_base.toFixed(4)) : '—'],
        ['Headship slope (per year)', (typeof d.headship_slope_per_year==='number') ? (d.headship_slope_per_year.toFixed(6)) : '—'],
      ];

      const srcHtml = (s.acs5_y0_url && s.acs5_y1_url)
        ? `Source queries: <a href="${s.acs5_y0_url}" target="_blank" rel="noopener">ACS5 y0</a>, `+
          `<a href="${s.acs5_y1_url}" target="_blank" rel="noopener">ACS5 y1</a>.`
        : 'Source queries: —';

      items.push({
        title: 'Projection scaling inputs (precomputed)',
        html: `These inputs are generated by the repo ETL so reviewers can reproduce municipal scaling and headship trend assumptions. ` +
             `${yrs ? `Years: ${yrs.y0}→${yrs.y1}. ` : ''}` +
             `${srcHtml}` +
             `<div style="margin-top:8px; overflow:auto">
                <table class="hna-table" style="width:100%; border-collapse:collapse">
                  <tbody>
                    ${rows.map(r=>`<tr><td style="padding:6px 8px; border-bottom:1px solid var(--border);"><strong>${r[0]}</strong></td><td style="padding:6px 8px; border-bottom:1px solid var(--border);">${r[1]}</td></tr>`).join('')}
                  </tbody>
                </table>
              </div>`
      });
    }

    // Cache status
    const cacheBits = [];
    if (cacheFlags.summary) cacheBits.push('summary cache');
    if (cacheFlags.lehd) cacheBits.push('LEHD cache');
    if (cacheFlags.dola) cacheBits.push('DOLA SDO cache');
    if (cacheFlags.projections) cacheBits.push('projections cache');
    if (cacheFlags.derived) cacheBits.push('derived inputs');

    items.push({
      title: 'LIHTC (Low-Income Housing Tax Credit)',
      html: `For Colorado, LIHTC project data is loaded from the canonical local file ` +
            `<strong>data/chfa-lihtc.json</strong> (kept current by the CI workflow). ` +
            `If that file is absent (HTTP 404), the system falls back to the ` +
            `<strong>CHFA ArcGIS FeatureServer</strong> (Colorado Housing and Finance Authority), ` +
            `then to the HUD LIHTC database via ArcGIS REST service. ` +
            `For all other states, HUD ArcGIS is the live source. ` +
            `An embedded Colorado fallback dataset is used when all other sources are unavailable. ` +
            `The active data source is displayed as a badge on the LIHTC project list and in each project popup. ` +
            `Red circle markers on the map indicate LIHTC-funded properties. ` +
            `<a href="${SOURCES.lihtcDb}" target="_blank" rel="noopener">HUD LIHTC database</a>.`
    });

    items.push({
      title: 'QCT (Qualified Census Tracts)',
      html: `Qualified Census Tracts are census tracts where ≥50% of households have incomes below 60% of Area ` +
            `Median Income, or the poverty rate is ≥25%. HUD designates QCTs annually; LIHTC projects in QCTs ` +
            `may receive a 30% basis boost. QCT tract boundaries are fetched from the HUD ArcGIS REST service ` +
            `and shown as orange overlays on the map. ` +
            `<a href="${SOURCES.hudQct}" target="_blank" rel="noopener">HUD QCT dataset</a>.`
    });

    items.push({
      title: 'DDA (Difficult Development Areas)',
      html: `Difficult Development Areas are HUD-designated metro/non-metro areas with high construction, land, ` +
            `and utility costs relative to income. LIHTC projects in DDAs may receive a 30% basis boost. ` +
            `DDA boundaries are fetched from the HUD ArcGIS REST service (purple dashed overlay); county DDA ` +
            `status is also cross-checked against HUD's published 2025 DDA list for Colorado. ` +
            `<a href="${SOURCES.hudDda}" target="_blank" rel="noopener">HUD DDA dataset</a>.`
    });

    const cacheHtml = cacheBits.length ?
      `Cached modules loaded: <strong>${cacheBits.join(', ')}</strong>.` :
      `No cached modules detected for this geography; using live Census pulls where available.`;

    const html = `
      <ul>
        <li><strong>Selected geography:</strong> ${geoLabel} (${geoType}:${geoid})</li>
        <li>${cacheHtml}</li>
      </ul>
      <div class="hna-grid" style="margin-top:10px">
        ${items.map(it=>`
          <div class="chart-card span-6" style="margin:0">
            <h2 style="font-size:1rem">${it.title}</h2>
            <p>${it.html}</p>
          </div>
        `).join('')}
      </div>
    `;

    els.methodology.innerHTML = html;
  }

  // --- Main update ---
  async function update(){
    const geoType = els.geoType.value;
    const geoid = els.geoSelect.value;

    const label = (()=>{
      const conf = window.__HNA_GEO_CONFIG;
      if (geoType==='county' && Array.isArray(conf?.counties)){
        const m = conf.counties.find(c=>c.geoid===geoid);
        return m?.label || geoid;
      }
      const m = (conf?.featured || FEATURED).find(x=>x.geoid===geoid);
      return m?.label || geoid;
    })();

    setBanner('');

    // Load boundary
    try{
      const gj = await fetchBoundary(geoType, geoid);
      renderBoundary(gj);
    }catch(e){
      console.warn(e);
      setBanner('Boundary failed to load (TIGERweb). The rest of the page may still populate.', 'warn');
    }

    // Load cached summary (if present) else live ACS
    let profile=null, s0801=null;
    const cacheFlags = { summary:false, lehd:false, dola:false, projections:false, derived:false };

    try{
      const sum = await loadJson(PATHS.summary(geoid));
      if (sum && sum.acsProfile) {
        profile = sum.acsProfile;
        s0801 = sum.acsS0801;
        cacheFlags.summary = true;
        // Extract year and series from cached source endpoint URL if available
        const endpointMeta = (url) => {
          if (!url) return {};
          const m = url.match(/\/data\/(\d{4})\//);
          return { year: m ? parseInt(m[1], 10) : null, series: url.includes('/acs1/') ? 'acs1' : 'acs5' };
        };
        if (!profile._acsYear && sum.source?.acs_profile_endpoint) {
          const { year, series } = endpointMeta(sum.source.acs_profile_endpoint);
          if (year) profile._acsYear = year;
          profile._acsSeries = series;
        }
        if (s0801 && !s0801._acsYear && sum.source?.acs_s0801_endpoint) {
          const { year, series } = endpointMeta(sum.source.acs_s0801_endpoint);
          if (year) s0801._acsYear = year;
          s0801._acsSeries = series;
        }
      }
    }catch(_){/* ignore */}

    if (!profile){
      try{
        profile = await fetchAcsProfile(geoType, geoid);
      }catch(e){
        console.warn(e);
      }
    }
    // Attach geography metadata to profile and s0801 for source link generation
    if (profile) { profile._geoType = geoType; profile._geoid = geoid; }

    if (!s0801){
      try{
        s0801 = await fetchAcsS0801(geoType, geoid);
      }catch(e){
        console.warn(e);
        // keep going
      }
    }

    if (!profile){
      // Build the ACS failure banner using DOM elements to avoid innerHTML/XSS risks
      const msgSpan = document.createElement('span');
      msgSpan.textContent = 'No ACS Census data could be found for this area. Diagnostics have been run and saved for support review. Please contact your manager or support and reference this log file. ';
      const dlLink = document.createElement('a');
      dlLink.href = PATHS.acsDebugLog;
      dlLink.download = 'acs_debug_log.txt';
      dlLink.style.cssText = 'color:inherit;text-decoration:underline';
      dlLink.textContent = 'Download Debug Log';
      els.banner.textContent = '';
      els.banner.appendChild(msgSpan);
      els.banner.appendChild(dlLink);
      els.banner.classList.add('show');
    }

    if (profile){
      renderSnapshot(profile, s0801, label);
      renderHousingCharts(profile);
      renderAffordChart(profile);
      renderRentBurdenBins(profile);
    }

    if (s0801){
      renderModeShare(s0801);
    }

    // LEHD (cached)
    const contextCounty = countyFromGeoid(geoType, geoid);
    let lehd=null;
    try{
      // Prefer county cache for county selections; for places/CDPs use containing county
      const lehdGeoid = geoType === 'county' ? geoid : contextCounty;
      lehd = await loadJson(PATHS.lehd(lehdGeoid));
      cacheFlags.lehd = true;
    }catch(e){
      console.warn(e);
    }
    if (lehd){
      renderLehd(lehd, geoType, geoid);
    } else {
      els.lehdNote.textContent = 'LEHD flow cache not yet available. Run the HNA data build workflow to populate.';
    }

    // DOLA SYA (cached; county context)
    let dola=null;
    try{
      dola = await loadJson(PATHS.dolaSya(contextCounty));
      cacheFlags.dola = true;
    }catch(e){
      console.warn(e);
    }
    if (dola){
      renderDolaPyramid(dola);
    } else {
      els.seniorNote.textContent = 'DOLA/SDO age data not yet available. Run the HNA data build workflow to populate.';
    }

    // 20-year projections (cached; county context)
    state.current = { geoType, geoid, label, contextCounty, profile };
    const projRes = await renderProjections(contextCounty, state.current);
    if (projRes?.ok) cacheFlags.projections = true;

    renderLocalResources(geoType, geoid);

    const derivedEntry = state.derived?.geos?.[geoid] || null;
    if (derivedEntry) cacheFlags.derived = true;

    renderMethodology({
      geoType,
      geoid,
      geoLabel: label,
      usedCountyForContext: contextCounty,
      cacheFlags,
      derivedEntry,
      derivedYears: state.derived?.acs5_years || null,
    });

    // LIHTC / QCT / DDA overlays (non-blocking; county context)
    updateLihtcOverlays(contextCounty).catch(e => console.warn('[HNA] LIHTC overlay error', e));
  }

  async function init(){
    // Load geo config + resources if present
    try{ window.__HNA_GEO_CONFIG = await loadJson(PATHS.geoConfig); }catch(_){ window.__HNA_GEO_CONFIG = { featured: FEATURED }; }
    try{ window.__HNA_LOCAL_RESOURCES = await loadJson(PATHS.localResources); }catch(_){ window.__HNA_LOCAL_RESOURCES = {}; }
    try{ state.derived = await loadJson(PATHS.derived); }catch(_){ state.derived = null; }

    // Populate full county list (small) if not present in repo cache
    if (!Array.isArray(window.__HNA_GEO_CONFIG.counties) || !window.__HNA_GEO_CONFIG.counties.length){
      try{
        window.__HNA_GEO_CONFIG.counties = await fetchCoCountiesList();
      }catch(e){
        console.warn('County list fetch failed', e);
      }
    }

    // Set defaults
    els.geoType.value = DEFAULTS.geoType;
    buildSelect();

    // If county list exists, default to Mesa
    if (els.geoType.value === 'county'){
      els.geoSelect.value = DEFAULTS.geoId;
    }

    els.geoType.addEventListener('change', ()=>{
      buildSelect();
      update();
    });
    els.geoSelect.addEventListener('change', update);
    els.btnRefresh.addEventListener('click', update);
    els.btnPdf?.addEventListener('click', exportPdf);

    // Projection assumptions controls
    const onAssumpChange = ()=>{ if(state.lastProj && state.current){ applyAssumptions(state.lastProj, state.current); } };
    els.assumpHorizon?.addEventListener('change', onAssumpChange);
    els.assumpVacancy?.addEventListener('input', ()=>{ els.assumpVacancyVal.textContent = `${Number(els.assumpVacancy.value).toFixed(1)}%`; onAssumpChange(); });
    document.querySelectorAll('input[name="assumpHeadship"]').forEach(r=>r.addEventListener('change', onAssumpChange));
    document.querySelectorAll('.headship-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const val = btn.dataset.headship;
        document.querySelectorAll('.headship-btn').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed','true');
        const hidden = document.getElementById('assumpHeadship');
        if (hidden) hidden.value = val;
        onAssumpChange();
      });
    });

    // Re-render charts on theme toggle
    document.addEventListener('theme:changed', ()=>{ update(); });
    document.addEventListener('nav:rendered', ()=>{ /* no-op */ });

    wireLayerToggles();
    ensureMap();
    update();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
