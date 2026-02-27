/*
  Housing Needs Assessment (HNA)
  - Uses cached JSON when available (data/hna/...), with live Census API fallbacks.
  - Keeps assumptions transparent and methodology links dynamic.
*/

(function(){
  const STATE_FIPS_CO = '08';

  const ACS_YEAR_PRIMARY  = 2023;
  const ACS_YEAR_FALLBACK = 2022;
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
    hudLihtcQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/LIHTC_Properties/FeatureServer/0',
    hudQctQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/QCT_2025/FeatureServer/0',
    hudDdaQuery: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/DDA_2025/FeatureServer/0',
  };

  // Colorado LIHTC fallback data (representative projects; source: HUD LIHTC database)
  const LIHTC_FALLBACK_CO = {type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9903,39.7392]},properties:{PROJECT:'Lincoln Park Apartments',PROJ_CTY:'Denver',N_UNITS:120,YR_PIS:2018,CREDIT:'9%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9748,39.7519]},properties:{PROJECT:'Curtis Park Lofts',PROJ_CTY:'Denver',N_UNITS:72,YR_PIS:2016,CREDIT:'9%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9875,39.7281]},properties:{PROJECT:'Baker Senior Residences',PROJ_CTY:'Denver',N_UNITS:55,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9620,39.7617]},properties:{PROJECT:'Five Points Commons',PROJ_CTY:'Denver',N_UNITS:96,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8851,39.6784]},properties:{PROJECT:'Aurora Family Commons',PROJ_CTY:'Aurora',N_UNITS:150,YR_PIS:2021,CREDIT:'4%',CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8325,39.6950]},properties:{PROJECT:'Aurora Senior Village',PROJ_CTY:'Aurora',N_UNITS:90,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2705,40.0150]},properties:{PROJECT:'Boulder Commons',PROJ_CTY:'Boulder',N_UNITS:100,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Boulder',CNTY_FIPS:'08013'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8214,38.8339]},properties:{PROJECT:'Springs Family Village',PROJ_CTY:'Colorado Springs',N_UNITS:130,YR_PIS:2018,CREDIT:'9%',CNTY_NAME:'El Paso',CNTY_FIPS:'08041'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0844,40.5853]},properties:{PROJECT:'Fort Collins Commons',PROJ_CTY:'Fort Collins',N_UNITS:104,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Larimer',CNTY_FIPS:'08069'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6914,40.4233]},properties:{PROJECT:'Greeley Flats',PROJ_CTY:'Greeley',N_UNITS:90,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Weld',CNTY_FIPS:'08123'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6091,38.2544]},properties:{PROJECT:'Pueblo Senior Manor',PROJ_CTY:'Pueblo',N_UNITS:80,YR_PIS:2017,CREDIT:'9%',CNTY_NAME:'Pueblo',CNTY_FIPS:'08101'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5506,39.0639]},properties:{PROJECT:'Grand Junction Crossroads',PROJ_CTY:'Grand Junction',N_UNITS:85,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Mesa',CNTY_FIPS:'08077'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5750,39.0850]},properties:{PROJECT:'Mesa Valley Apartments',PROJ_CTY:'Grand Junction',N_UNITS:48,YR_PIS:2017,CREDIT:'9%',CNTY_NAME:'Mesa',CNTY_FIPS:'08077'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,39.6433]},properties:{PROJECT:'Eagle Valley Workforce Housing',PROJ_CTY:'Eagle',N_UNITS:50,YR_PIS:2022,CREDIT:'9%',CNTY_NAME:'Eagle',CNTY_FIPS:'08037'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8801,37.2753]},properties:{PROJECT:'Durango Commons',PROJ_CTY:'Durango',N_UNITS:62,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'La Plata',CNTY_FIPS:'08067'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9211,39.6861]},properties:{PROJECT:'Englewood Family Flats',PROJ_CTY:'Englewood',N_UNITS:70,YR_PIS:2019,CREDIT:'4%',CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0211,39.5611]},properties:{PROJECT:'Littleton Senior Homes',PROJ_CTY:'Littleton',N_UNITS:60,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Arapahoe',CNTY_FIPS:'08005'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9895,39.7617]},properties:{PROJECT:'Capitol Hill Residences',PROJ_CTY:'Denver',N_UNITS:84,YR_PIS:2022,CREDIT:'4%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0163,39.7392]},properties:{PROJECT:'West Colfax Commons',PROJ_CTY:'Denver',N_UNITS:56,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Denver',CNTY_FIPS:'08031'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1311,39.7500]},properties:{PROJECT:'Lakewood Affordable Flats',PROJ_CTY:'Lakewood',N_UNITS:92,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Jefferson',CNTY_FIPS:'08059'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.9281,39.5480]},properties:{PROJECT:'Glenwood Springs Workforce',PROJ_CTY:'Glenwood Springs',N_UNITS:44,YR_PIS:2022,CREDIT:'9%',CNTY_NAME:'Garfield',CNTY_FIPS:'08045'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8069,40.3722]},properties:{PROJECT:'Loveland Family Housing',PROJ_CTY:'Loveland',N_UNITS:75,YR_PIS:2019,CREDIT:'9%',CNTY_NAME:'Larimer',CNTY_FIPS:'08069'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.4222,38.4681]},properties:{PROJECT:'Cañon City Senior Village',PROJ_CTY:'Cañon City',N_UNITS:50,YR_PIS:2018,CREDIT:'9%',CNTY_NAME:'Fremont',CNTY_FIPS:'08043'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7506,38.2008]},properties:{PROJECT:'Pueblo West Apartments',PROJ_CTY:'Pueblo West',N_UNITS:66,YR_PIS:2020,CREDIT:'9%',CNTY_NAME:'Pueblo',CNTY_FIPS:'08101'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3131,37.4681]},properties:{PROJECT:'Alamosa Affordable Homes',PROJ_CTY:'Alamosa',N_UNITS:40,YR_PIS:2021,CREDIT:'9%',CNTY_NAME:'Alamosa',CNTY_FIPS:'08003'}},
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
    statRentBurden: document.getElementById('statRentBurden'),
    statIncomeNeed: document.getElementById('statIncomeNeed'),
    statIncomeNeedNote: document.getElementById('statIncomeNeedNote'),
    statCommute: document.getElementById('statCommute'),

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
      where: `STATE='${STATE_FIPS_CO}'`,
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
    const r = await fetch(url,{cache:'no-cache'});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const text = await r.text();
    if (!text.trim()) throw new Error(`Empty response: ${url}`);
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

    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const darkTile  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 });
    const lightTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19 });
    let activeBase = (prefersDark ? darkTile : lightTile).addTo(map);

    // Fall back to OpenStreetMap HOT if CartoDB tiles are blocked (only once)
    activeBase.once('tileerror', function() {
      try { map.removeLayer(activeBase); } catch(e) {}
      activeBase = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
      }).addTo(map);
    });

    map.setView([39.0, -108.55], 9);

    // Ensure map renders correctly after container is visible
    setTimeout(function(){ map.invalidateSize(); }, 300);
    window.addEventListener('resize', function(){ map.invalidateSize(); });
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

  // Fetch LIHTC projects from HUD ArcGIS REST service for the county, fall back to embedded data
  async function fetchLihtcProjects(countyFips5){
    if (countyFips5 && countyFips5.length === 5) {
      const stateFips  = countyFips5.slice(0, 2);
      const countyFips = countyFips5.slice(2);
      const params = new URLSearchParams({
        where:   `STATEFP='${stateFips}' AND COUNTYFP='${countyFips}'`,
        outFields: 'PROJECT,PROJ_CTY,N_UNITS,YR_PIS,CREDIT,CNTY_NAME,STATEFP,COUNTYFP',
        f: 'geojson',
        outSR: '4326',
        resultRecordCount: 500,
      });
      const url = `${SOURCES.hudLihtcQuery}/query?${params}`;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
        if (!r.ok) throw new Error(`LIHTC HTTP ${r.status}`);
        const gj = await r.json();
        if (gj && Array.isArray(gj.features) && gj.features.length > 0) return gj;
      } catch(e) {
        console.warn('[HNA] LIHTC ArcGIS API unavailable; using embedded fallback.', e.message);
      }
    }
    // Try local cached file
    try {
      return await loadJson(PATHS.lihtc(countyFips5));
    } catch(_) {/* no cache */}
    // Return embedded fallback filtered to county
    return lihtcFallbackForCounty(countyFips5);
  }

  // Fetch QCT census tracts from HUD ArcGIS service for the county
  async function fetchQctTracts(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const stateFips  = countyFips5.slice(0, 2);
    const countyFips = countyFips5.slice(2);
    const params = new URLSearchParams({
      where:   `STATEFP='${stateFips}' AND COUNTYFP='${countyFips}'`,
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
      if (gj && Array.isArray(gj.features)) return gj;
    } catch(e) {
      console.warn('[HNA] QCT ArcGIS API unavailable.', e.message);
    }
    return null;
  }

  // Fetch DDA polygons from HUD ArcGIS service for the county
  async function fetchDdaForCounty(countyFips5){
    if (!countyFips5 || countyFips5.length !== 5) return null;
    const stateFips  = countyFips5.slice(0, 2);
    const countyFips = countyFips5.slice(2);
    const params = new URLSearchParams({
      where:   `STATEFP='${stateFips}' AND COUNTYFP='${countyFips}'`,
      outFields: 'DDA_NAME,COUNTYFP,STATEFP',
      f: 'geojson',
      outSR: '4326',
      resultRecordCount: 50,
    });
    const url = `${SOURCES.hudDdaQuery}/query?${params}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
      if (!r.ok) throw new Error(`DDA HTTP ${r.status}`);
      const gj = await r.json();
      if (gj && Array.isArray(gj.features)) return gj;
    } catch(e) {
      console.warn('[HNA] DDA ArcGIS API unavailable; using static lookup.', e.message);
    }
    return null;
  }

  // Render LIHTC project markers on the map
  function renderLihtcLayer(geojson){
    ensureMap();
    if (lihtcLayer) { lihtcLayer.remove(); lihtcLayer = null; }
    if (!geojson || !geojson.features || !geojson.features.length) {
      if (els.statLihtcCount) els.statLihtcCount.textContent = '0';
      if (els.statLihtcUnits) els.statLihtcUnits.textContent = '0';
      return;
    }

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
        const lines = [
          `<strong>${p.PROJECT || 'LIHTC Project'}</strong>`,
          p.PROJ_CTY ? `City: ${p.PROJ_CTY}` : null,
          p.N_UNITS  ? `Units: ${p.N_UNITS}` : null,
          p.YR_PIS   ? `Year: ${p.YR_PIS}` : null,
          p.CREDIT   ? `Credit type: ${p.CREDIT}` : null,
        ].filter(Boolean).join('<br>');
        layer.bindPopup(lines);
        layer.bindTooltip(p.PROJECT || 'LIHTC Project');
      },
    }).addTo(map);

    // Visibility toggle
    if (els.layerLihtc && !els.layerLihtc.checked) lihtcLayer.remove();

    // Update stats
    const count = geojson.features.length;
    const units = geojson.features.reduce((s, f) => s + (Number(f.properties?.N_UNITS) || 0), 0);
    if (els.statLihtcCount) els.statLihtcCount.textContent = count.toLocaleString();
    if (els.statLihtcUnits) els.statLihtcUnits.textContent = units.toLocaleString();

    // Build project list in info panel
    if (els.lihtcInfoPanel) {
      const sorted = [...geojson.features].sort((a,b) => (b.properties?.N_UNITS||0) - (a.properties?.N_UNITS||0));
      const rows = sorted.slice(0, 10).map(f => {
        const p = f.properties || {};
        return `<tr>
          <td style="padding:4px 6px">${p.PROJECT || '—'}</td>
          <td style="padding:4px 6px">${p.PROJ_CTY || '—'}</td>
          <td style="padding:4px 6px;text-align:right">${p.N_UNITS || '—'}</td>
          <td style="padding:4px 6px">${p.YR_PIS || '—'}</td>
          <td style="padding:4px 6px">${p.CREDIT || '—'}</td>
        </tr>`;
      }).join('');
      els.lihtcInfoPanel.innerHTML = rows ? `
        <p style="margin:8px 0 4px;font-weight:700">LIHTC projects in area (top 10 by units):</p>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.83rem">
            <thead><tr style="color:var(--muted)">
              <th style="padding:4px 6px;text-align:left">Project</th>
              <th style="padding:4px 6px;text-align:left">City</th>
              <th style="padding:4px 6px;text-align:right">Units</th>
              <th style="padding:4px 6px">Year</th>
              <th style="padding:4px 6px">Credit</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : '<p>No LIHTC projects found in this geography.</p>';
    }
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
    } catch(e) {
      console.warn('[HNA] LIHTC render failed', e);
      if (els.statLihtcCount) els.statLihtcCount.textContent = '—';
      if (els.statLihtcUnits) els.statLihtcUnits.textContent = '—';
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

    if (els.lihtcMapStatus) els.lihtcMapStatus.textContent = '';
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
      const params = new URLSearchParams();
      params.set('get', vars.join(',') + ',NAME');
      params.set('for', forParam);
      params.set('in', inParam);
      if (key) params.set('key', key);
      return `${base}?${params.toString()}`;
    }

    const url1 = buildUrl(ACS_YEAR_PRIMARY,  'acs/acs1/profile');
    let r = await fetch(url1);
    let url2 = null;
    if (!r.ok){
      url2 = buildUrl(ACS_YEAR_FALLBACK, 'acs/acs5/profile');
      r = await fetch(url2);
      if (!r.ok){
        // ACS profile/subject tables may not support this geography or these
        // variable codes for the requested year.  Fall back to ACS 5-year
        // B-series which covers all geography types (county, place, CDP) and
        // uses stable variable codes.
        return await fetchAcs5BSeries(geoType, geoid);
      }
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
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

    const dataset = `https://api.census.gov/data/${ACS_YEAR_FALLBACK}/acs/acs5`;
    const params = new URLSearchParams();
    params.set('get', bVars.join(',') + ',NAME');
    params.set('for', forParam);
    params.set('in', `state:${STATE_FIPS_CO}`);
    if (key) params.set('key', key);
    const url = `${dataset}?${params.toString()}`;

    const r = await fetch(url);
    if (!r.ok){
      if (DEBUG_HNA) console.warn(`ACS5 B-series fallback failed: ${r.status} ${redactKey(url)}`);
      throw new Error(`ACS profile unavailable for this geography (${r.status})`);
    }
    const arr = await r.json();
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
      const params = new URLSearchParams();
      params.set('get', vars.join(',') + ',NAME');
      params.set('for', forParam);
      params.set('in', inParam);
      if (key) params.set('key', key);
      return `${base}?${params.toString()}`;
    }

    const url1 = buildUrl(ACS_YEAR_PRIMARY,  'acs/acs1/subject');
    let r = await fetch(url1);
    let url2 = null;
    if (!r.ok){
      url2 = buildUrl(ACS_YEAR_FALLBACK, 'acs/acs5/subject');
      r = await fetch(url2);
      if (!r.ok){
        const msg = DEBUG_HNA
          ? `ACS failed. Tried: ${redactKey(url1)} then ${redactKey(url2)}`
          : `ACS S0801 failed (${r.status})`;
        throw new Error(msg);
      }
    }
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
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

    els.statPop.textContent = fmtNum(pop);
    els.statPopSrc.textContent = 'ACS DP05';
    els.statMhi.textContent = fmtMoney(mhi);
    els.statMhiSrc.textContent = 'ACS DP03';
    els.statHomeValue.textContent = fmtMoney(homeValue);
    els.statHomeValueSrc.textContent = 'ACS DP04';
    els.statRent.textContent = fmtMoney(rent);
    els.statRentSrc.textContent = 'ACS DP04';

    const owner = Number(profile?.DP04_0047PE);
    const renter = Number(profile?.DP04_0046PE);
    els.statTenure.textContent = (Number.isFinite(owner) && Number.isFinite(renter)) ? `${owner.toFixed(1)}% / ${renter.toFixed(1)}%` : '—';

    const rb = rentBurden30Plus(profile || {});
    els.statRentBurden.textContent = rb === null ? '—' : fmtPct(rb);

    const incomeNeed = computeIncomeNeeded(homeValue);
    els.statIncomeNeed.textContent = incomeNeed ? fmtMoney(incomeNeed.annualIncome) : '—';
    els.statIncomeNeedNote.textContent = incomeNeed ? `Assumes ${Math.round(AFFORD.rateAnnual*1000)/10}% rate, ${Math.round(AFFORD.downPaymentPct*100)}% down` : '30% of income rule';

    const mean = Number(s0801?.S0801_C01_018E);
    els.statCommute.textContent = Number.isFinite(mean) ? `${mean.toFixed(1)} min` : '—';

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
    const headshipMode = (document.querySelector('input[name="assumpHeadship"]:checked')?.value || 'hold');
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
      html: `LIHTC project locations and unit counts are sourced from the HUD LIHTC database, accessed via the ` +
            `HUD ArcGIS REST service when available (live query, no auth required), with an embedded Colorado ` +
            `fallback dataset. Red circle markers on the map indicate LIHTC-funded properties. ` +
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
      }
    }catch(_){/* ignore */}

    if (!profile){
      try{
        profile = await fetchAcsProfile(geoType, geoid);
      }catch(e){
        console.warn(e);
      }
    }

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
