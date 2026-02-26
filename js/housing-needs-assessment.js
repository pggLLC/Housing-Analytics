/*
  Housing Needs Assessment (HNA)
  - Uses cached JSON when available (data/hna/...), with live Census API fallbacks.
  - Keeps assumptions transparent and methodology links dynamic.
*/

(function(){
  const STATE_FIPS_CO = '08';

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
  };

  const SOURCES = {
    tigerweb: 'https://www.census.gov/data/developers/data-sets/TIGERweb.html',
    acsProfile: 'https://api.census.gov/data/2024/acs/acs1/profile/groups.html',
    acsS0801: 'https://api.census.gov/data/2024/acs/acs1/subject/groups/S0801.html',
    lodesRoot: 'https://lehd.ces.census.gov/data/lodes/LODES8/',
    lodesTech: 'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf',
    sdoDownloads: 'https://demography.dola.colorado.gov/assets/html/sdodata.html',
    sdoPopulation: 'https://demography.dola.colorado.gov/assets/html/population.html',
    prop123Commitments: 'https://cdola.colorado.gov/commitment-filings',
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

  };

  // Charts
  let map;
  let boundaryLayer;
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
    // Featured places are all in Mesa County right now; keep config-driven.
    // The ETL can set containingCounty for any place/cdp.
    const conf = window.__HNA_GEO_CONFIG;
    const item = conf?.featured?.find(x => x.geoid === geoid);
    return item?.containingCounty || '08077';
  }

  function buildSelect(){
    const type = els.geoType.value;
    els.geoSelect.innerHTML='';
    const list = (window.__HNA_GEO_CONFIG?.featured || FEATURED).filter(x => x.type === type);

    // If county, append full county list if present
    if (type === 'county' && Array.isArray(window.__HNA_GEO_CONFIG?.counties) && window.__HNA_GEO_CONFIG.counties.length){
      for (const c of window.__HNA_GEO_CONFIG.counties){
        const opt = document.createElement('option');
        opt.value = c.geoid;
        opt.textContent = c.label;
        if (c.geoid === DEFAULTS.geoId) opt.selected = true;
        els.geoSelect.appendChild(opt);
      }
      return;
    }

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
    const counties = (d.features || []).map(f => ({
      geoid: f.attributes.GEOID,
      label: `${f.attributes.NAME} County`,
    }));
    return counties;
  }

  async function loadJson(url){
    const r = await fetch(url,{cache:'no-cache'});
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return await r.json();
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
    map = L.map('hnaMap', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    map.setView([39.0, -108.55], 9);
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

  // --- Census API (live fallback) ---
  function censusKey(){
    return (window.APP_CONFIG && window.APP_CONFIG.CENSUS_API_KEY) ? window.APP_CONFIG.CENSUS_API_KEY : '';
  }

  async function fetchAcsProfile(geoType, geoid){
    // Use ACS 1-year profile tables for a fast report-like snapshot.
    // NOTE: For smaller places/CDPs, ACS1 may have gaps. The cached ETL can switch to ACS5 if needed.

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

    const base = 'https://api.census.gov/data/2024/acs/acs1/profile';

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'place'
        ? `place:${geoid.slice(2)}`
        : `census%20designated%20place:${geoid.slice(2)}`;

    const inParam = `state:${STATE_FIPS_CO}`;

    const params = new URLSearchParams();
    params.set('get', vars.join(',') + ',NAME');
    params.set('for', forParam);
    if (geoType !== 'county') params.set('in', inParam);
    const key = censusKey();
    if (key) params.set('key', key);

    const url = `${base}?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ACS profile failed (${r.status})`);
    const arr = await r.json();
    const header = arr[0];
    const row = arr[1];
    const out = {};
    header.forEach((h,i)=>{out[h]=row[i];});
    return out;
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
    const base = 'https://api.census.gov/data/2024/acs/acs1/subject';

    const forParam = geoType === 'county'
      ? `county:${geoid.slice(2,5)}`
      : geoType === 'place'
        ? `place:${geoid.slice(2)}`
        : `census%20designated%20place:${geoid.slice(2)}`;

    const inParam = `state:${STATE_FIPS_CO}`;

    const params = new URLSearchParams();
    params.set('get', vars.join(',') + ',NAME');
    params.set('for', forParam);
    if (geoType !== 'county') params.set('in', inParam);
    const key = censusKey();
    if (key) params.set('key', key);

    const url = `${base}?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ACS S0801 failed (${r.status})`);
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
    if (!r.ok) throw new Error(`ACS5 trend HTTP ${r.status}`);
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
        setBanner('ACS profile data failed to load for this geography. Try again later or rely on cached builds.', 'warn');
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

    ensureMap();
    update();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
