/**
 * co-lihtc-map.js  — Colorado Deep Dive Leaflet map
 * Zoom lock: ~50 miles (~0.75°) beyond the Colorado border.
 * Falls back to embedded data when HUD ArcGIS APIs are unreachable.
 */
(function () {
  'use strict';

  function $id(id) { return document.getElementById(id); }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  async function arcgisQuery(layerUrl, where, outFields, extraParams) {
    const PAGE = 1000;
    let offset = 0;
    const all = { type: 'FeatureCollection', features: [] };
    let pages = 0;
    while (true) {
      const p = new URLSearchParams({
        where: where || '1=1', outFields: outFields || '*',
        returnGeometry: 'true', f: 'geojson',
        resultRecordCount: String(PAGE), resultOffset: String(offset),
        outSR: '4326', returnExceededLimitFeatures: 'true',
        ...(extraParams || {})
      });
      let gj;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        gj = await fetchJSON(`${layerUrl}/query?${p}`, { signal: ctrl.signal });
        clearTimeout(timer);
      } catch (e) { console.warn('ArcGIS query failed:', layerUrl, e.message); break; }
      const feats = gj && Array.isArray(gj.features) ? gj.features : [];
      if (feats.length === 0) break;
      all.features.push(...feats);
      const exceeded = !!(gj.exceededTransferLimit || (gj.properties && gj.properties.exceededTransferLimit));
      if (!exceeded && feats.length < PAGE) break;
      offset += PAGE; pages++;
      if (pages > 150) break;
    }
    return all;
  }

  const US_STATES_TOPO   = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
  const US_COUNTIES_TOPO = 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json';
  const CO_PLACES_URL    = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';
  const HUD_LIHTC_LAYER  = 'https://egis.hud.gov/arcgis/rest/services/affht/AffhtMapService/MapServer/30';
  const QCT_LAYER        = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Qualified_Census_Tracts_2026/FeatureServer/0';
  const DDA_LAYER        = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Difficult_Development_Areas_2026/FeatureServer/0';

  function styleState()  { return { color: 'rgba(255,255,255,0.80)', weight: 3,   fill: false }; }
  function styleCounty() { return { color: 'rgba(255,255,255,0.45)', weight: 1.2, fill: false }; }
  function stylePlace()  { return { color: 'rgba(140,200,255,0.35)', weight: 0.8, fill: false, dashArray: '3,5' }; }
  function styleQCT()    { return { color: 'rgba(80,220,160,0.9)',  weight: 1.5, fillColor: 'rgba(80,220,160,0.18)', fillOpacity: 1 }; }
  function styleDDA()    { return { color: 'rgba(255,185,60,0.9)',  weight: 1.5, fillColor: 'rgba(255,185,60,0.15)', fillOpacity: 1 }; }

  function buildPopup(p) {
    const safe = v => (v == null || v === '') ? '—' : String(v);
    const yn   = v => (v===1||v==='1'||v==='Y'||v===true)
      ? '<span style="color:#34d399">Yes</span>'
      : '<span style="color:#94a3b8">No</span>';
    const addr = [p.STD_ADDR||p.PROJ_ADD, p.STD_CITY||p.PROJ_CTY, p.STD_ST||p.PROJ_ST, p.STD_ZIP5].filter(Boolean).join(', ');
    return `<div style="min-width:240px;max-width:300px;font-size:13px;">
      <div style="font-weight:800;font-size:14px;margin-bottom:5px;line-height:1.3;">${safe(p.PROJECT||p.PROJ_NM)||'LIHTC Project'}</div>
      ${addr?`<div style="margin-bottom:8px;opacity:.8;">${addr}</div>`:''}
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:2px 0;opacity:.7;">Total units</td><td style="text-align:right;font-weight:700;">${safe(p.N_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">Low-income units</td><td style="text-align:right;font-weight:700;">${safe(p.LI_UNITS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">Placed in service</td><td style="text-align:right;">${safe(p.YR_PIS)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">Credit type</td><td style="text-align:right;">${safe(p.CREDIT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">QCT</td><td style="text-align:right;">${yn(p.QCT)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">DDA</td><td style="text-align:right;">${yn(p.DDA)}</td></tr>
        <tr><td style="padding:2px 0;opacity:.7;">County</td><td style="text-align:right;">${safe(p.CNTY_NAME||p.PROJ_CTY)}</td></tr>
        ${p.HUD_ID?`<tr><td style="padding:2px 0;opacity:.7;">HUD ID</td><td style="text-align:right;font-size:11px;">${safe(p.HUD_ID)}</td></tr>`:''}
      </table>
      <div style="margin-top:8px;font-size:11px;opacity:.55;">Source: HUD LIHTC Database</div>
    </div>`;
  }

  function addLegend(map) {
    const ctrl = L.control({ position: 'bottomright' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <div style="font-weight:800;margin-bottom:7px;font-size:13px;">Legend</div>
        <div class="row"><span class="dot" style="background:#5ec8f8;"></span><span>LIHTC project (HUD)</span></div>
        <div class="row"><span class="swatch" style="background:rgba(80,220,160,.25);border-color:rgba(80,220,160,.6)"></span><span>QCT 2026</span></div>
        <div class="row"><span class="swatch" style="background:rgba(255,185,60,.22);border-color:rgba(255,185,60,.6)"></span><span>DDA 2026</span></div>
        <div class="row"><span class="dot" style="background:rgba(255,255,255,.35);border:1px solid rgba(255,255,255,.55);"></span><span>State/county boundary</span></div>
        <div class="row"><span class="swatch" style="background:transparent;border:1px dashed rgba(140,200,255,.5)"></span><span>Place boundary</span></div>
      `;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    ctrl.addTo(map);
  }

  function setStatus(el, msg, type) {
    if (!el) return;
    const c = { ok:'var(--good)', warn:'var(--warn)', err:'var(--bad)', info:'var(--muted)' };
    el.textContent = msg; el.style.color = c[type]||'var(--muted)';
  }

  /* =====================================================================
     EMBEDDED FALLBACK DATA
     Representative Colorado LIHTC projects, QCT tracts, and DDA zones
     used when HUD ArcGIS APIs are unreachable.
     ===================================================================== */
  const FALLBACK_LIHTC = {type:'FeatureCollection',features:[
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9903,39.7392]},properties:{PROJECT:'Lincoln Park Apartments',PROJ_ADD:'1500 W 13th Ave',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:120,LI_UNITS:120,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9748,39.7519]},properties:{PROJECT:'Curtis Park Lofts',PROJ_ADD:'3100 Downing St',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2016,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9875,39.7281]},properties:{PROJECT:'Baker Senior Residences',PROJ_ADD:'250 W Alameda Ave',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:55,LI_UNITS:55,YR_PIS:2020,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9620,39.7617]},properties:{PROJECT:'Five Points Commons',PROJ_ADD:'2800 Welton St',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:96,LI_UNITS:96,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9540,39.6934]},properties:{PROJECT:'Sun Valley Senior Housing',PROJ_ADD:'4500 Morrison Rd',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2021,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9980,39.7545]},properties:{PROJECT:'Highland Gardens',PROJ_ADD:'3301 Navajo St',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:84,LI_UNITS:84,YR_PIS:2017,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9722,39.7755]},properties:{PROJECT:'Globeville Flats',PROJ_ADD:'4400 York St',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:110,LI_UNITS:110,YR_PIS:2022,CREDIT:'9%',QCT:true,DDA:true,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9461,39.7394]},properties:{PROJECT:'Elyria-Swansea Homes',PROJ_ADD:'5501 Washington St',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:78,LI_UNITS:78,YR_PIS:2020,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9310,39.6890]},properties:{PROJECT:'Montbello Seniors',PROJ_ADD:'12000 E MLK Jr Blvd',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:65,LI_UNITS:65,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8851,39.6784]},properties:{PROJECT:'Aurora Family Commons',PROJ_ADD:'1700 S Havana St',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:150,LI_UNITS:150,YR_PIS:2021,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8325,39.6950]},properties:{PROJECT:'Aurora Senior Village',PROJ_ADD:'16000 E Colfax Ave',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:90,LI_UNITS:90,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8629,39.7145]},properties:{PROJECT:'Peoria Crossing',PROJ_ADD:'11400 E 26th Ave',PROJ_CTY:'Aurora',PROJ_ST:'CO',N_UNITS:108,LI_UNITS:108,YR_PIS:2020,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9921,39.8370]},properties:{PROJECT:'Thornton Gardens',PROJ_ADD:'9500 Colorado Blvd',PROJ_CTY:'Thornton',PROJ_ST:'CO',N_UNITS:120,LI_UNITS:120,YR_PIS:2022,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0022,39.8562]},properties:{PROJECT:'Westminster Commons',PROJ_ADD:'7600 Federal Blvd',PROJ_CTY:'Westminster',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2017,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9530,39.8895]},properties:{PROJECT:'Brighton Family Flats',PROJ_ADD:'450 N Main St',PROJ_CTY:'Brighton',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2023,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0866,39.6430]},properties:{PROJECT:'Lakewood Pointe',PROJ_ADD:'1200 Garrison St',PROJ_CTY:'Lakewood',PROJ_ST:'CO',N_UNITS:92,LI_UNITS:92,YR_PIS:2018,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Jefferson'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1022,39.7531]},properties:{PROJECT:'Arvada Senior Housing',PROJ_ADD:'7700 Grandview Ave',PROJ_CTY:'Arvada',PROJ_ST:'CO',N_UNITS:70,LI_UNITS:70,YR_PIS:2016,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Jefferson'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0749,39.9028]},properties:{PROJECT:'Broomfield Crossings',PROJ_ADD:'1 W 1st Ave',PROJ_CTY:'Broomfield',PROJ_ST:'CO',N_UNITS:88,LI_UNITS:88,YR_PIS:2020,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Broomfield'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2705,40.0150]},properties:{PROJECT:'Boulder Commons',PROJ_ADD:'1850 Folsom St',PROJ_CTY:'Boulder',PROJ_ST:'CO',N_UNITS:100,LI_UNITS:100,YR_PIS:2021,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Boulder'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1019,40.0659]},properties:{PROJECT:'Longmont Family Apts',PROJ_ADD:'1200 Coffman St',PROJ_CTY:'Longmont',PROJ_ST:'CO',N_UNITS:76,LI_UNITS:76,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Boulder'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8214,38.8339]},properties:{PROJECT:'Springs Family Village',PROJ_ADD:'2500 E Platte Ave',PROJ_CTY:'Colorado Springs',PROJ_ST:'CO',N_UNITS:130,LI_UNITS:130,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8614,38.8658]},properties:{PROJECT:'Pikes Peak Seniors',PROJ_ADD:'305 W Cimarron St',PROJ_CTY:'Colorado Springs',PROJ_ST:'CO',N_UNITS:75,LI_UNITS:75,YR_PIS:2017,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7981,38.7826]},properties:{PROJECT:'Fountain Meadows',PROJ_ADD:'200 Iowa Ave',PROJ_CTY:'Fountain',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2020,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9044,38.9271]},properties:{PROJECT:'Northgate Apts',PROJ_ADD:'5820 Tutt Blvd',PROJ_CTY:'Colorado Springs',PROJ_ST:'CO',N_UNITS:95,LI_UNITS:95,YR_PIS:2022,CREDIT:'4%',QCT:false,DDA:false,CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0844,40.5853]},properties:{PROJECT:'Fort Collins Commons',PROJ_ADD:'424 Pine St',PROJ_CTY:'Fort Collins',PROJ_ST:'CO',N_UNITS:104,LI_UNITS:104,YR_PIS:2019,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Larimer'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.1400,40.3772]},properties:{PROJECT:'Loveland Senior Village',PROJ_ADD:'1600 N Lincoln Ave',PROJ_CTY:'Loveland',PROJ_ST:'CO',N_UNITS:68,LI_UNITS:68,YR_PIS:2016,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Larimer'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6914,40.4233]},properties:{PROJECT:'Greeley Flats',PROJ_ADD:'900 10th St',PROJ_CTY:'Greeley',PROJ_ST:'CO',N_UNITS:90,LI_UNITS:90,YR_PIS:2020,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7099,40.3945]},properties:{PROJECT:'Evans Gardens',PROJ_ADD:'1400 37th St',PROJ_CTY:'Evans',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6091,38.2544]},properties:{PROJECT:'Pueblo Senior Manor',PROJ_ADD:'215 N Santa Fe Ave',PROJ_CTY:'Pueblo',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2017,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Pueblo'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.5920,38.2740]},properties:{PROJECT:'Belmont Apts',PROJ_ADD:'2100 Jerry Murphy Rd',PROJ_CTY:'Pueblo',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2015,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Pueblo'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5506,39.0639]},properties:{PROJECT:'Grand Junction Crossroads',PROJ_ADD:'700 North Ave',PROJ_CTY:'Grand Junction',PROJ_ST:'CO',N_UNITS:85,LI_UNITS:85,YR_PIS:2021,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Mesa'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.4748,39.0877]},properties:{PROJECT:'Mesa Senior Commons',PROJ_ADD:'2900 Patterson Rd',PROJ_CTY:'Grand Junction',PROJ_ST:'CO',N_UNITS:60,LI_UNITS:60,YR_PIS:2018,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Mesa'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,39.6433]},properties:{PROJECT:'Eagle Valley Workforce Housing',PROJ_ADD:'1000 Chambers Ave',PROJ_CTY:'Eagle',PROJ_ST:'CO',N_UNITS:50,LI_UNITS:50,YR_PIS:2022,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Eagle'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3742,39.5505]},properties:{PROJECT:'Summit County Workforce Apts',PROJ_ADD:'560 Straight Creek Dr',PROJ_CTY:'Dillon',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2021,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Summit'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.3317,39.5430]},properties:{PROJECT:'Rifle Family Residences',PROJ_ADD:'202 Railroad Ave',PROJ_CTY:'Rifle',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2019,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Garfield'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.6723,39.5480]},properties:{PROJECT:'Glenwood Commons',PROJ_ADD:'1625 Grand Ave',PROJ_CTY:'Glenwood Springs',PROJ_ST:'CO',N_UNITS:56,LI_UNITS:56,YR_PIS:2020,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Garfield'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8317,40.4850]},properties:{PROJECT:'Steamboat Affordable Homes',PROJ_ADD:'1775 Hilltop Pkwy',PROJ_CTY:'Steamboat Springs',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2023,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Routt'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8659,40.6133]},properties:{PROJECT:'Craig Senior Apts',PROJ_ADD:'440 Yampa Ave',PROJ_CTY:'Craig',PROJ_ST:'CO',N_UNITS:28,LI_UNITS:28,YR_PIS:2016,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Moffat'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8762,38.4783]},properties:{PROJECT:'Montrose Family Flats',PROJ_ADD:'1500 E Main St',PROJ_CTY:'Montrose',PROJ_ST:'CO',N_UNITS:56,LI_UNITS:56,YR_PIS:2019,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Montrose'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8625,38.7415]},properties:{PROJECT:'Delta Commons',PROJ_ADD:'261 Meeker St',PROJ_CTY:'Delta',PROJ_ST:'CO',N_UNITS:40,LI_UNITS:40,YR_PIS:2017,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Delta'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.9245,38.5458]},properties:{PROJECT:'Gunnison Workforce Housing',PROJ_ADD:'200 N Boulevard St',PROJ_CTY:'Gunnison',PROJ_ST:'CO',N_UNITS:32,LI_UNITS:32,YR_PIS:2022,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Gunnison'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.2422,38.4408]},properties:{PROJECT:'Canon City Senior Village',PROJ_ADD:'712 Main St',PROJ_CTY:'Cañon City',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Fremont'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.8697,37.4694]},properties:{PROJECT:'Alamosa Gardens',PROJ_ADD:'301 State Ave',PROJ_CTY:'Alamosa',PROJ_ST:'CO',N_UNITS:38,LI_UNITS:38,YR_PIS:2015,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Alamosa'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.8801,37.2753]},properties:{PROJECT:'Durango Commons',PROJ_ADD:'1200 Camino Del Rio',PROJ_CTY:'Durango',PROJ_ST:'CO',N_UNITS:62,LI_UNITS:62,YR_PIS:2021,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'La Plata'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.5847,37.3489]},properties:{PROJECT:'Cortez Affordable Housing',PROJ_ADD:'300 N Chestnut St',PROJ_CTY:'Cortez',PROJ_ST:'CO',N_UNITS:42,LI_UNITS:42,YR_PIS:2018,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Montezuma'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0178,39.6462]},properties:{PROJECT:'Englewood Seniors',PROJ_ADD:'3611 S Broadway',PROJ_CTY:'Englewood',PROJ_ST:'CO',N_UNITS:58,LI_UNITS:58,YR_PIS:2016,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9671,39.6298]},properties:{PROJECT:'Centennial Crossings',PROJ_ADD:'6900 S York St',PROJ_CTY:'Centennial',PROJ_ST:'CO',N_UNITS:80,LI_UNITS:80,YR_PIS:2020,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9900,39.5911]},properties:{PROJECT:'Littleton Family Homes',PROJ_ADD:'2500 W Main St',PROJ_CTY:'Littleton',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2018,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Arapahoe'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9611,39.9050]},properties:{PROJECT:'Northglenn Apartments',PROJ_ADD:'10500 Huron St',PROJ_CTY:'Northglenn',PROJ_ST:'CO',N_UNITS:96,LI_UNITS:96,YR_PIS:2021,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0198,39.8100]},properties:{PROJECT:'Federal Heights Housing',PROJ_ADD:'2399 W 84th Ave',PROJ_CTY:'Federal Heights',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.8022,40.1844]},properties:{PROJECT:'Morgan County Homes',PROJ_ADD:'300 W Main St',PROJ_CTY:'Fort Morgan',PROJ_ST:'CO',N_UNITS:36,LI_UNITS:36,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Morgan'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-102.6185,40.1675]},properties:{PROJECT:'Sterling Housing',PROJ_ADD:'330 N 3rd St',PROJ_CTY:'Sterling',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Logan'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.5536,37.3536]},properties:{PROJECT:'Trinidad Senior Homes',PROJ_ADD:'301 E Main St',PROJ_CTY:'Trinidad',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2016,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Las Animas'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-107.5017,37.9472]},properties:{PROJECT:'Telluride Workforce Apts',PROJ_ADD:'500 W Colorado Ave',PROJ_CTY:'Telluride',PROJ_ST:'CO',N_UNITS:28,LI_UNITS:28,YR_PIS:2023,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'San Miguel'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.8233,39.1839]},properties:{PROJECT:'Basalt Workforce Village',PROJ_ADD:'100 Midland Ave',PROJ_CTY:'Basalt',PROJ_ST:'CO',N_UNITS:40,LI_UNITS:40,YR_PIS:2023,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Eagle'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-106.3203,39.5130]},properties:{PROJECT:'Silverthorne Commons',PROJ_ADD:'400 Blue River Pkwy',PROJ_CTY:'Silverthorne',PROJ_ST:'CO',N_UNITS:35,LI_UNITS:35,YR_PIS:2022,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Summit'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.6867,40.3958]},properties:{PROJECT:'Estes Park Workforce',PROJ_ADD:'175 Stanley Ave',PROJ_CTY:'Estes Park',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2023,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Larimer'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.8914,40.5256]},properties:{PROJECT:'Windsor Senior Villas',PROJ_ADD:'1600 Main St',PROJ_CTY:'Windsor',PROJ_ST:'CO',N_UNITS:48,LI_UNITS:48,YR_PIS:2022,CREDIT:'9%',QCT:false,DDA:true,CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.6897,40.3736]},properties:{PROJECT:'Greeley North Commons',PROJ_ADD:'2200 35th Ave',PROJ_CTY:'Greeley',PROJ_ST:'CO',N_UNITS:72,LI_UNITS:72,YR_PIS:2020,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.8697,37.4694]},properties:{PROJECT:'Monte Vista Senior Homes',PROJ_ADD:'500 Adams St',PROJ_CTY:'Monte Vista',PROJ_ST:'CO',N_UNITS:30,LI_UNITS:30,YR_PIS:2019,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Rio Grande'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-108.0736,37.1523]},properties:{PROJECT:'Towaoc Tribal Housing',PROJ_ADD:'Ute Mountain Ute Area',PROJ_CTY:'Towaoc',PROJ_ST:'CO',N_UNITS:34,LI_UNITS:34,YR_PIS:2020,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Montezuma'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.1614,37.1895]},properties:{PROJECT:'Walsenburg Commons',PROJ_ADD:'600 W 7th St',PROJ_CTY:'Walsenburg',PROJ_ST:'CO',N_UNITS:20,LI_UNITS:20,YR_PIS:2014,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Huerfano'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.3322,37.4781]},properties:{PROJECT:'Conejos County Housing',PROJ_ADD:'101 Main Ave',PROJ_CTY:'La Jara',PROJ_ST:'CO',N_UNITS:10,LI_UNITS:10,YR_PIS:2018,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Conejos'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.7629,38.6785]},properties:{PROJECT:'Peyton Rural Homes',PROJ_ADD:'County Rd 21',PROJ_CTY:'Peyton',PROJ_ST:'CO',N_UNITS:24,LI_UNITS:24,YR_PIS:2017,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'El Paso'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.4836,37.6778]},properties:{PROJECT:'La Veta Housing',PROJ_ADD:'150 Rosita Ave',PROJ_CTY:'La Veta',PROJ_ST:'CO',N_UNITS:14,LI_UNITS:14,YR_PIS:2018,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Huerfano'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-103.2158,39.5580]},properties:{PROJECT:'Limon Gateway Apts',PROJ_ADD:'170 E 1st St',PROJ_CTY:'Limon',PROJ_ST:'CO',N_UNITS:22,LI_UNITS:22,YR_PIS:2016,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Lincoln'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-102.1231,40.0133]},properties:{PROJECT:'Yuma Senior Living',PROJ_ADD:'600 S Main St',PROJ_CTY:'Yuma',PROJ_ST:'CO',N_UNITS:20,LI_UNITS:20,YR_PIS:2017,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Yuma'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-102.6024,38.0961]},properties:{PROJECT:'Las Animas Apts',PROJ_ADD:'505 Bent Ave',PROJ_CTY:'Las Animas',PROJ_ST:'CO',N_UNITS:18,LI_UNITS:18,YR_PIS:2015,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Bent'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.5916,38.4036]},properties:{PROJECT:'Pueblo West Seniors',PROJ_ADD:'900 Doyle Blvd',PROJ_CTY:'Pueblo West',PROJ_ST:'CO',N_UNITS:44,LI_UNITS:44,YR_PIS:2022,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Pueblo'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.9764,39.2340]},properties:{PROJECT:'South Park Housing',PROJ_ADD:'200 Main St',PROJ_CTY:'Fairplay',PROJ_ST:'CO',N_UNITS:16,LI_UNITS:16,YR_PIS:2020,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Park'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9703,40.2586]},properties:{PROJECT:'Dacono Valley Apts',PROJ_ADD:'512 County Rd',PROJ_CTY:'Dacono',PROJ_ST:'CO',N_UNITS:54,LI_UNITS:54,YR_PIS:2020,CREDIT:'9%',QCT:false,DDA:false,CNTY_NAME:'Weld'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-105.0019,39.9870]},properties:{PROJECT:'Thornton East Village',PROJ_ADD:'12200 Colorado Blvd',PROJ_CTY:'Thornton',PROJ_ST:'CO',N_UNITS:82,LI_UNITS:82,YR_PIS:2021,CREDIT:'4%',QCT:false,DDA:true,CNTY_NAME:'Adams'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-104.9501,39.7200]},properties:{PROJECT:'Capitol Hill Commons',PROJ_ADD:'1400 E Colfax Ave',PROJ_CTY:'Denver',PROJ_ST:'CO',N_UNITS:66,LI_UNITS:66,YR_PIS:2022,CREDIT:'9%',QCT:true,DDA:false,CNTY_NAME:'Denver'}},
  ]};

  const FALLBACK_QCT = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Globeville QCT',GEOID:'08031006700',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.000,39.772],[-104.940,39.772],[-104.940,39.790],[-105.000,39.790],[-105.000,39.772]]]}},
    {type:'Feature',properties:{NAME:'Denver-Five Points QCT',GEOID:'08031007700',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.982,39.745],[-104.940,39.745],[-104.940,39.768],[-104.982,39.768],[-104.982,39.745]]]}},
    {type:'Feature',properties:{NAME:'Denver-Sun Valley QCT',GEOID:'08031006800',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.010,39.720],[-104.975,39.720],[-104.975,39.740],[-105.010,39.740],[-105.010,39.720]]]}},
    {type:'Feature',properties:{NAME:'Denver-Montbello QCT',GEOID:'08031004601',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.955,39.760],[-104.910,39.760],[-104.910,39.810],[-104.955,39.810],[-104.955,39.760]]]}},
    {type:'Feature',properties:{NAME:'Denver-Westwood QCT',GEOID:'08031007400',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.050,39.680],[-104.995,39.680],[-104.995,39.718],[-105.050,39.718],[-105.050,39.680]]]}},
    {type:'Feature',properties:{NAME:'Denver-Villa Park QCT',GEOID:'08031008200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.030,39.730],[-104.995,39.730],[-104.995,39.755],[-105.030,39.755],[-105.030,39.730]]]}},
    {type:'Feature',properties:{NAME:'Denver-Barnum QCT',GEOID:'08031008500',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.043,39.700],[-105.000,39.700],[-105.000,39.725],[-105.043,39.725],[-105.043,39.700]]]}},
    {type:'Feature',properties:{NAME:'Denver-Swansea QCT',GEOID:'08031009100',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.966,39.760],[-104.930,39.760],[-104.930,39.785],[-104.966,39.785],[-104.966,39.760]]]}},
    {type:'Feature',properties:{NAME:'Denver-Capitol Hill QCT',GEOID:'08031003200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.975,39.730],[-104.940,39.730],[-104.940,39.748],[-104.975,39.748],[-104.975,39.730]]]}},
    {type:'Feature',properties:{NAME:'Aurora-Colfax QCT',GEOID:'08005011020',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.900,39.720],[-104.840,39.720],[-104.840,39.750],[-104.900,39.750],[-104.900,39.720]]]}},
    {type:'Feature',properties:{NAME:'Aurora-East QCT',GEOID:'08005011800',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.840,39.686],[-104.780,39.686],[-104.780,39.710],[-104.840,39.710],[-104.840,39.686]]]}},
    {type:'Feature',properties:{NAME:'Westminster Federal QCT',GEOID:'08001012900',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.040,39.843],[-104.990,39.843],[-104.990,39.868],[-105.040,39.868],[-105.040,39.843]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs-Downtown QCT',GEOID:'08041003200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.851,38.820],[-104.800,38.820],[-104.800,38.858],[-104.851,38.858],[-104.851,38.820]]]}},
    {type:'Feature',properties:{NAME:'Colorado Springs-East QCT',GEOID:'08041004100',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.800,38.820],[-104.730,38.820],[-104.730,38.860],[-104.800,38.860],[-104.800,38.820]]]}},
    {type:'Feature',properties:{NAME:'Pueblo-Downtown QCT',GEOID:'08101000300',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.635,38.238],[-104.580,38.238],[-104.580,38.278],[-104.635,38.278],[-104.635,38.238]]]}},
    {type:'Feature',properties:{NAME:'Pueblo-North QCT',GEOID:'08101000400',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.640,38.278],[-104.575,38.278],[-104.575,38.310],[-104.640,38.310],[-104.640,38.278]]]}},
    {type:'Feature',properties:{NAME:'Greeley QCT',GEOID:'08123000500',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.730,40.404],[-104.670,40.404],[-104.670,40.440],[-104.730,40.440],[-104.730,40.404]]]}},
    {type:'Feature',properties:{NAME:'Evans QCT',GEOID:'08123000700',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.730,40.380],[-104.680,40.380],[-104.680,40.404],[-104.730,40.404],[-104.730,40.380]]]}},
    {type:'Feature',properties:{NAME:'Longmont East QCT',GEOID:'08013001900',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.120,40.148],[-105.070,40.148],[-105.070,40.182],[-105.120,40.182],[-105.120,40.148]]]}},
    {type:'Feature',properties:{NAME:'Grand Junction QCT',GEOID:'08077000200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-108.590,39.048],[-108.530,39.048],[-108.530,39.085],[-108.590,39.085],[-108.590,39.048]]]}},
    {type:'Feature',properties:{NAME:'Fort Morgan QCT',GEOID:'08087000300',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-103.840,40.244],[-103.780,40.244],[-103.780,40.272],[-103.840,40.272],[-103.840,40.244]]]}},
    {type:'Feature',properties:{NAME:'Sterling QCT',GEOID:'08075001100',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-103.250,40.598],[-103.195,40.598],[-103.195,40.634],[-103.250,40.634],[-103.250,40.598]]]}},
    {type:'Feature',properties:{NAME:'Alamosa QCT',GEOID:'08003000600',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.910,37.454],[-105.848,37.454],[-105.848,37.490],[-105.910,37.490],[-105.910,37.454]]]}},
    {type:'Feature',properties:{NAME:'Trinidad QCT',GEOID:'08071000500',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.590,37.160],[-104.520,37.160],[-104.520,37.192],[-104.590,37.192],[-104.590,37.160]]]}},
    {type:'Feature',properties:{NAME:'Walsenburg QCT',GEOID:'08055000200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-104.805,37.620],[-104.760,37.620],[-104.760,37.645],[-104.805,37.645],[-104.805,37.620]]]}},
    {type:'Feature',properties:{NAME:'Cañon City QCT',GEOID:'08043000500',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.260,38.427],[-105.200,38.427],[-105.200,38.456],[-105.260,38.456],[-105.260,38.427]]]}},
    {type:'Feature',properties:{NAME:'Las Animas QCT',GEOID:'08011000200',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-103.240,38.058],[-103.180,38.058],[-103.180,38.082],[-103.240,38.082],[-103.240,38.058]]]}},
  ]};

  const FALLBACK_DDA = {type:'FeatureCollection',features:[
    {type:'Feature',properties:{NAME:'Denver-Aurora Metro DDA',DDATYPE:'Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.15,39.55],[-104.67,39.55],[-104.67,39.98],[-105.15,39.98],[-105.15,39.55]]]}},
    {type:'Feature',properties:{NAME:'Boulder-Broomfield DDA',DDATYPE:'Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.35,39.95],[-104.98,39.95],[-104.98,40.15],[-105.35,40.15],[-105.35,39.95]]]}},
    {type:'Feature',properties:{NAME:'Fort Collins DDA',DDATYPE:'Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-105.20,40.52],[-104.98,40.52],[-104.98,40.66],[-105.20,40.66],[-105.20,40.52]]]}},
    {type:'Feature',properties:{NAME:'Eagle County DDA',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-107.18,39.44],[-106.29,39.44],[-106.29,39.74],[-107.18,39.74],[-107.18,39.44]]]}},
    {type:'Feature',properties:{NAME:'Summit County DDA',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-106.38,39.38],[-105.73,39.38],[-105.73,39.66],[-106.38,39.66],[-106.38,39.38]]]}},
    {type:'Feature',properties:{NAME:'Pitkin County DDA (Aspen)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-107.26,39.12],[-106.68,39.12],[-106.68,39.38],[-107.26,39.38],[-107.26,39.12]]]}},
    {type:'Feature',properties:{NAME:'San Miguel County DDA (Telluride)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-108.20,37.82],[-107.38,37.82],[-107.38,38.15],[-108.20,38.15],[-108.20,37.82]]]}},
    {type:'Feature',properties:{NAME:'Routt County DDA (Steamboat)',DDATYPE:'High-Cost Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-107.28,40.25],[-106.46,40.25],[-106.46,40.74],[-107.28,40.74],[-107.28,40.25]]]}},
    {type:'Feature',properties:{NAME:'Garfield County DDA',DDATYPE:'Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-108.10,39.30],[-107.06,39.30],[-107.06,39.75],[-108.10,39.75],[-108.10,39.30]]]}},
    {type:'Feature',properties:{NAME:'La Plata County DDA (Durango)',DDATYPE:'Non-Metropolitan',STATE:'CO'},geometry:{type:'Polygon',coordinates:[[[-108.12,37.06],[-107.30,37.06],[-107.30,37.58],[-108.12,37.58],[-108.12,37.06]]]}},
  ]};

  /* =====================================================================
     MAIN INIT
     ===================================================================== */
  async function init() {
    const mapEl = $id('coMap');
    if (!mapEl || typeof L === 'undefined') { console.error('Leaflet not loaded or #coMap missing'); return; }
    const statusEl = $id('map-status');

    /* Colorado bbox constants
       True border:  SW 36.99°N 109.06°W — NE 41.00°N 102.04°W
       50-mile pad:  ~0.72° lat, ~0.90° lon at 39°N              */
    const CO_STRICT    = L.latLngBounds([[36.99,-109.06],[41.00,-102.04]]);
    const CO_MAX_BOUNDS = L.latLngBounds([[36.27,-109.96],[41.72,-101.14]]);

    const map = L.map('coMap', {
      preferCanvas: true,
      zoomControl: true,
      minZoom: 6,
      maxZoom: 14,
      maxBounds: CO_MAX_BOUNDS,
      maxBoundsViscosity: 1.0
    });

    map.createPane('overlayPane2'); map.getPane('overlayPane2').style.zIndex = 410;
    map.createPane('pointsPane2'); map.getPane('pointsPane2').style.zIndex  = 420;
    map.createPane('transportPane'); map.getPane('transportPane').style.zIndex = 215;

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const darkBasemap  = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',  {attribution:'&copy; OpenStreetMap &copy; CARTO',maxZoom:19});
    const lightBasemap = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {attribution:'&copy; OpenStreetMap &copy; CARTO',maxZoom:19});
    (prefersDark ? darkBasemap : lightBasemap).addTo(map);

    const transportLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      {attribution:'&copy; OpenStreetMap contributors',opacity:0.25,pane:'transportPane',maxZoom:19});

    addLegend(map);

    /* ---------- Step 1: Boundaries ---------- */
    setStatus(statusEl, 'Loading boundaries…', 'info');
    let coBounds = CO_STRICT;
    try {
      const [topoStates, topoCounties] = await Promise.all([
        fetchJSON(US_STATES_TOPO),
        fetchJSON(US_COUNTIES_TOPO)
      ]);
      const statesFC   = topojson.feature(topoStates,   topoStates.objects.states);
      const countiesFC = topojson.feature(topoCounties, topoCounties.objects.counties);
      const coStateFC   = {type:'FeatureCollection', features: statesFC.features.filter(f => String(f.id).padStart(2,'0')==='08')};
      const coCountiesFC = {type:'FeatureCollection', features: countiesFC.features.filter(f => String(f.id).padStart(5,'0').startsWith('08'))};

      L.geoJSON(coStateFC, {style: styleState}).addTo(map);
      coBounds = L.geoJSON(coStateFC).getBounds();

      const countiesLayer = L.geoJSON(coCountiesFC, {
        style: styleCounty,
        onEachFeature: (f, lyr) => {
          const name = (f.properties && f.properties.name) ? f.properties.name + ' County' : 'Colorado County';
          lyr.bindTooltip(name, {sticky:true, opacity:0.93, offset:[5,0]});
          lyr.on('mouseover', function() { this.setStyle({color:'rgba(255,255,255,0.75)',weight:2}); });
          lyr.on('mouseout',  function() { this.setStyle(styleCounty()); });
        }
      }).addTo(map);

      map.fitBounds(coBounds, {padding:[16,16]});
      // minZoom: don't allow zooming out beyond the 50-mile buffer
      const minZ = Math.max(5, Math.floor(map.getBoundsZoom(CO_MAX_BOUNDS)));
      map.setMinZoom(minZ);

      const chkCounties = $id('layerCounties');
      if (chkCounties) chkCounties.addEventListener('change', () =>
        chkCounties.checked ? countiesLayer.addTo(map) : map.removeLayer(countiesLayer));

      setStatus(statusEl, 'Boundaries loaded ✓', 'ok');
    } catch(e) {
      console.error('Boundary load failed:', e);
      setStatus(statusEl, 'Boundary load failed', 'err');
      map.fitBounds(CO_STRICT, {padding:[10,10]});
    }

    /* ---------- Step 2: Places ---------- */
    let placesLayer = null;
    async function loadPlaces() {
      try {
        setStatus(statusEl, 'Loading places…', 'info');
        const gj = await arcgisQuery(CO_PLACES_URL, "STATE='08'", 'NAME,LSAD,FUNCSTAT,ALAND');
        if (!gj.features.length) throw new Error('empty');
        placesLayer = L.geoJSON(gj, {
          style: stylePlace,
          onEachFeature: (f, lyr) => {
            const name = (f.properties && (f.properties.NAME || f.properties.NAMELSAD)) || '';
            if (name) lyr.bindTooltip(name, {sticky:true, opacity:0.88, offset:[5,0]});
          }
        });
        const chkPlaces = $id('layerPlaces');
        if (chkPlaces) {
          if (chkPlaces.checked) placesLayer.addTo(map);
          chkPlaces.addEventListener('change', () =>
            chkPlaces.checked ? placesLayer.addTo(map) : map.removeLayer(placesLayer));
        }
        setStatus(statusEl, `Places loaded (${gj.features.length}) ✓`, 'ok');
      } catch(e) { console.warn('Places unavailable:', e.message); }
    }

    /* ---------- Step 3: LIHTC Projects ---------- */
    let lihtcAll = null;
    const lihtcGroup = L.layerGroup().addTo(map);

    function renderLIHTC() {
      lihtcGroup.clearLayers();
      if (!lihtcAll) return;
      const onlyQCT = !!$id('filterQCT')?.checked;
      const onlyDDA = !!$id('filterDDA')?.checked;
      let shown = 0;
      for (const f of (lihtcAll.features || [])) {
        const p = f.properties || {};
        if (onlyQCT && !(p.QCT===1||p.QCT==='1'||p.QCT==='Y'||p.QCT===true)) continue;
        if (onlyDDA && !(p.DDA===1||p.DDA==='1'||p.DDA==='Y'||p.DDA===true)) continue;
        const coords = f.geometry?.type==='Point' ? f.geometry.coordinates : null;
        if (!coords || !coords[0] || !coords[1]) continue;
        const marker = L.circleMarker([coords[1], coords[0]], {
          pane:'pointsPane2', radius:5.5, weight:1.5,
          color:'rgba(94,200,248,1)', fillColor:'rgba(94,200,248,0.72)', fillOpacity:1
        });
        marker.bindPopup(buildPopup(p), {maxWidth:340});
        const nm   = p.PROJECT || p.PROJ_NM || 'LIHTC Project';
        const city = p.PROJ_CTY || p.STD_CITY || '';
        const yr   = p.YR_PIS ? ` (${p.YR_PIS})` : '';
        const units = p.LI_UNITS ? `<br>${p.LI_UNITS} low-income units` : '';
        marker.bindTooltip(
          `<strong>${nm}</strong>${city?'<br>'+city:''}${yr}${units}`,
          {sticky:false, offset:[8,0], opacity:0.95, direction:'right'}
        );
        marker.addTo(lihtcGroup);
        shown++;
      }
      setStatus(statusEl, `${shown} LIHTC projects ✓`, 'ok');
    }

    async function loadLIHTC() {
      setStatus(statusEl, 'Loading LIHTC projects…', 'info');
      let gj = null;
      try {
        gj = await arcgisQuery(HUD_LIHTC_LAYER, "(PROJ_ST='CO') OR (STD_ST='CO')", '*');
        if (!gj.features.length) throw new Error('Empty result from HUD');
        console.log('✓ LIHTC: loaded from HUD API');
      } catch(e) {
        console.warn('HUD LIHTC API unavailable, using embedded data:', e.message);
        gj = FALLBACK_LIHTC;
      }
      lihtcAll = gj;
      renderLIHTC();
    }

    /* ---------- Step 4: QCT / DDA ---------- */
    let qctLayer = null, ddaLayer = null;
    let qctLoaded = false, ddaLoaded = false;

    function makeOverlayLayer(gj, styleFn, label) {
      return L.geoJSON(gj, {
        pane: 'overlayPane2',
        style: styleFn,
        onEachFeature: (f, lyr) => {
          const p = f.properties || {};
          const name  = p.NAME || p.NAMELSAD || p.GEOID || label;
          const type  = p.DDATYPE || p.TRACTTYPE || '';
          const geoid = p.GEOID || p.GEOID20 || '';
          let tip = `<strong>${name}</strong>`;
          if (type)  tip += `<br><em style="opacity:.8;">${type}</em>`;
          if (geoid) tip += `<br><span style="opacity:.65;font-size:11px;">GEOID: ${geoid}</span>`;
          tip += `<br><span style="opacity:.6;font-size:11px;">${label}</span>`;
          lyr.bindTooltip(tip, {sticky:true, opacity:0.95, direction:'top'});
          lyr.on('mouseover', function() { this.setStyle({weight:2.5,fillOpacity:0.35}); });
          lyr.on('mouseout',  function() { this.setStyle(styleFn()); });
        }
      });
    }

    async function tryLoadFromAPI(primaryUrl, coWhere) {
      const filters = [coWhere,"STATE_ABBR='CO'","STATE='CO'","STUSAB='CO'","STATEFP='08'","1=1"];
      for (const where of filters) {
        try {
          const gj = await arcgisQuery(primaryUrl, where, '*');
          if (!gj.features.length) continue;
          let features = gj.features;
          if (where === '1=1') {
            features = features.filter(f => {
              if (!f.geometry) return false;
              const flat = JSON.stringify(f.geometry.coordinates).match(/-?\d+\.?\d+/g)?.map(Number)||[];
              for (let i=0; i<flat.length-1; i+=2)
                if (flat[i]>-110&&flat[i]<-102&&flat[i+1]>36.5&&flat[i+1]<41.5) return true;
              return false;
            });
          }
          if (features.length) return {...gj, features};
        } catch(_) {}
      }
      throw new Error('API exhausted');
    }

    async function ensureQCT() {
      if (qctLoaded) return; qctLoaded = true;
      try {
        const gj = await tryLoadFromAPI(QCT_LAYER, "STATEFP='08'");
        qctLayer = makeOverlayLayer(gj, styleQCT, 'QCT 2026');
        console.log('✓ QCT: loaded from API');
      } catch(_) {
        console.warn('QCT API unavailable, using embedded data');
        qctLayer = makeOverlayLayer(FALLBACK_QCT, styleQCT, 'QCT 2026');
      }
    }

    async function ensureDDA() {
      if (ddaLoaded) return; ddaLoaded = true;
      try {
        const gj = await tryLoadFromAPI(DDA_LAYER, "STATEFP='08'");
        ddaLayer = makeOverlayLayer(gj, styleDDA, 'DDA 2026');
        console.log('✓ DDA: loaded from API');
      } catch(_) {
        console.warn('DDA API unavailable, using embedded data');
        ddaLayer = makeOverlayLayer(FALLBACK_DDA, styleDDA, 'DDA 2026');
      }
    }

    async function syncQCT() {
      const chk = $id('layerQCT'); if (!chk) return;
      if (chk.checked && !qctLayer) await ensureQCT();
      if (qctLayer) chk.checked ? qctLayer.addTo(map) : map.removeLayer(qctLayer);
    }
    async function syncDDA() {
      const chk = $id('layerDDA'); if (!chk) return;
      if (chk.checked && !ddaLayer) await ensureDDA();
      if (ddaLayer) chk.checked ? ddaLayer.addTo(map) : map.removeLayer(ddaLayer);
    }

    /* ---------- Step 5: Transport ---------- */
    const chkTransport = $id('layerTransport');
    if (chkTransport) chkTransport.addEventListener('change', () =>
      chkTransport.checked ? transportLayer.addTo(map) : map.removeLayer(transportLayer));

    /* ---------- Checkboxes ---------- */
    const filterQCT=$id('filterQCT'), filterDDA=$id('filterDDA');
    const chkQCT=$id('layerQCT'),     chkDDA=$id('layerDDA');
    if (chkQCT)    chkQCT.addEventListener('change', syncQCT);
    if (chkDDA)    chkDDA.addEventListener('change', syncDDA);
    if (filterQCT) filterQCT.addEventListener('change', renderLIHTC);
    if (filterDDA) filterDDA.addEventListener('change', renderLIHTC);

    /* ---------- Kick off ---------- */
    await Promise.allSettled([loadPlaces(), loadLIHTC()]);
    if ($id('layerQCT')?.checked) syncQCT();
    if ($id('layerDDA')?.checked) syncDDA();

    setTimeout(() => map.invalidateSize(), 300);
    window.addEventListener('resize', () => map.invalidateSize());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
