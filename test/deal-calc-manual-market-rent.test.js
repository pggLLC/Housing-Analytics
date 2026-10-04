#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const { createJsPdfMock } = require('./helpers/jspdf-mock.cjs');
const limits = require('../js/chfa-rent-limits.js');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const zori = require('../data/market/zori_rents_co.json');
const hud = require('../data/hud-fmr-income-limits.json');
const county = '08077';
const jurisdiction = { geoType:'place', geoid:'0828745', name:'Fruita', countyFips:county, countyName:'Mesa County' };
const bedrooms = { studio:'efficiency', '1br':'1BR', '2br':'2BR', '3br':'3BR', '4br':'4BR' };
const money = n => '$' + Math.round(n).toLocaleString('en-US');
const text = (p,id) => p.d.getElementById(id).textContent.trim();
const record = (p,id) => p.w.InputProvenance.get(p.d.getElementById(id));
const plain = v => JSON.parse(JSON.stringify(v));
function mix(p, rows, total) {
  for (const tier of p.w.__DealCalc.getAmiBands()) {
    p.d.getElementById('dc-chk-'+tier).checked = rows.some(r=>r.tier===tier);
    p.d.getElementById('dc-units-'+tier).value = 0;
    for (const br of Object.keys(bedrooms)) p.d.getElementById('dc-units-'+tier+'-'+br).value = 0;
  }
  for (const row of rows) p.d.getElementById('dc-units-'+row.tier+'-'+row.br).value = row.units;
  setField(p,'dc-unit-mix-source','manual');
  setField(p,'dc-units',total);
  setField(p,'dc-achievable-cap',false);
  setField(p,'dc-auto-noi',true);
}
const restricted = [{ tier:60, br:'1br', units:24 }, { tier:60, br:'2br', units:24 }];
function restrictedRevenue(rows, fips=county) {
  return rows.reduce((sum,r)=>sum+limits.maxGrossRent(chfa,fips,r.tier,bedrooms[r.br]).grossRent*r.units*12,0);
}
function explanation(p) {
  const el=p.d.getElementById('dc-r-rents');
  return p.w.MethodologyExplainer.REGISTRY[el.dataset.methodologyKey].compute(el.methodologyContext);
}
function checkRevenue(p, expected) {
  assert.equal(text(p,'dc-r-rents'),money(expected));
  const computed=explanation(p);
  assert.equal(computed.result,expected,'explanation includes the exact same market and restricted rows');
  assert.equal(computed.formattedResult,text(p,'dc-r-rents'));
  const snapshot=p.w.__DealCalcShare.buildSnapshot();
  assert.equal(snapshot.reportMeta.methodology.find(m=>m.id==='dc-r-rents').withYourNumbers.result,expected);
  return snapshot;
}
let failed=0;
async function test(name,fn) {
  try { await fn(); console.log('PASS '+name); } catch(e) { failed++; console.error('FAIL '+name+'\n'+e.stack); } finally { close(); }
}
(async()=>{
  await test('ZORI remainder rents, whole-unit bedroom split, credits, provenance, explanation and PDF agree with records',async()=>{
    const p=await openPage('',null,{jurisdiction}); assert.deepEqual(p.errors,[]);
    const style=p.d.createElement('style');
    style.textContent=fs.readFileSync(path.join(__dirname,'../css/site-theme.css'),'utf8');
    p.d.head.appendChild(style);
    mix(p,restricted,60);
    const rents=p.w.__DealCalc.getZoriPerBrRent(county);
    assert(rents && rents['1br']>0 && rents['2br']>0);
    const fmr=hud.counties.find(c=>c.fips===county).fmr;
    for(const [br,key] of Object.entries({studio:'efficiency','1br':'one_br','2br':'two_br','3br':'three_br','4br':'four_br'}))
      assert.equal(rents[br],Math.round(zori.counties[county].rent*fmr[key]/fmr.two_br),'ZORI and HUD records price '+br);
    // Hydration can populate readonly fields; ZORI mode must display the
    // same local record that prices the rows, regardless of that stored value.
    p.d.getElementById('dc-market-rent-2br').value='1';
    p.w.__DealCalc.recalculate();
    assert.equal(p.d.getElementById('dc-market-rent-2br').value,String(rents['2br']));
    const expected=restrictedRevenue(restricted)+(6*rents['1br']+6*rents['2br'])*12;
    const snapshot=checkRevenue(p,expected);
    const markets=snapshot.rentSchedule.rows.filter(r=>r.tier==='market');
    assert.deepEqual(plain(markets.map(r=>[r.bedrooms,r.units,r.rent])),[['1BR',6,rents['1br']],['2BR',6,rents['2br']]]);
    assert.equal(p.d.getElementById('dc-market-rent-status').dataset.units,'12');
    assert(!p.d.getElementById('dc-units-sync-warn').hidden);
    assert.equal(p.w.getComputedStyle(p.d.getElementById('dc-market-source-wrap')).display,'none',
      'ZORI mode does not display a required override source field');
    assert.equal(p.w.getComputedStyle(p.d.getElementById('dc-market-bedroom-wrap')).display,'none',
      'a known bedroom mix does not display the no-mix fallback control');
    const basis=(+p.d.getElementById('dc-tdc').value)*(+p.d.getElementById('dc-basis-pct').value/100)*(48/60);
    assert.equal(text(p,'dc-r-basis'),money(basis),'market units never enter LIHTC eligible basis');
    assert.equal(text(p,'dc-r-credits'),money(basis*0.09),'market units earn no credits');
    for(const br of ['1br','2br']) {
      const id='dc-market-rent-'+br, origin=record(p,id);
      assert.equal(origin.status,'data'); assert.equal(origin.origin.value,String(rents[br]));
      assert.equal(origin.origin.meta.countyFips,county);
      assert.equal(origin.origin.meta.geography,zori.counties[county].name);
      assert.equal(origin.origin.meta.vintage,zori.counties[county].vintage_month);
      assert.equal(origin.origin.meta.sourceUrl,zori.meta.county_url);
      assert(p.w.DealCalculatorInputRegistry.get(id).dataSource);
      const source=snapshot.reportMeta.sources.find(s=>s.fields.some(f=>f.id===id));
      assert(source); assert.equal(source.vintage,origin.origin.meta.vintage); assert.equal(source.geography,origin.origin.meta.geography);
      assert(text(p,'dc-market-rent-vintage').includes(source.vintage));
    }
    p.w.html2canvas=async()=>({width:600,height:600,toDataURL:()=> 'image'});
    const pdf=createJsPdfMock(); p.w.jspdf={jsPDF:pdf.jsPDF};
    await p.w.__DealCalcShare.exportPdf(); pdf.assertSupported();
    assert(pdf.text.join('\n').includes(zori.meta.county_url),'PDF text includes the actual market-rent source');
    // The PDF sections are built from the same report record as JSON.
    assert(p.w.DealCalculatorReportMeta.sections(snapshot.reportMeta).find(s=>s.key==='sources').entries.some(e=>e.text.includes(zori.meta.county_url)));
    mix(p,[{tier:60,br:'studio',units:1},{tier:60,br:'4br',units:2}],8);
    const split=p.w.__DealCalc.getRentScheduleMetadata().rows.filter(r=>r.tier==='market');
    assert.deepEqual(plain(split.map(r=>[r.bedrooms,r.units])),[['efficiency',2],['4BR',3]],'largest remainders preserve exactly five whole market homes');
  });
  await test('overrides require a source note, retain the ZORI origin, and round-trip with their report citation',async()=>{
    const p=await openPage('',null,{jurisdiction}); mix(p,restricted,60);
    const origin=plain(record(p,'dc-market-rent-2br').origin);
    setField(p,'dc-market-rent-mode','override');
    setField(p,'dc-market-rent-1br',1801); setField(p,'dc-market-rent-2br',2203);
    assert.equal(p.d.getElementById('dc-r-rents').dataset.unavailableReason,'market_rent_source_missing');
    assert(!/\$[0-9]/.test(text(p,'dc-r-rents')));
    const note='Mesa comparable-rent survey, 2026-10-04'; setField(p,'dc-market-rent-source',note);
    const snapshot=checkRevenue(p,restrictedRevenue(restricted)+(6*1801+6*2203)*12);
    assert.equal(record(p,'dc-market-rent-2br').status,'yours');
    assert.deepEqual(plain(record(p,'dc-market-rent-2br').origin),origin);
    assert(snapshot.reportMeta.assumptions.some(f=>f.id==='dc-market-rent-source' && f.value===note));
    assert(snapshot.reportMeta.methodology.find(m=>m.id==='dc-r-rents').currentSource.includes(note));
    const recipient=await openPage(new URL(snapshot.url).search);
    for(const id of ['dc-r-rents','dc-r-noi-stab','dc-su-gap']) assert.equal(text(recipient,id),text(p,id));
    assert.equal(record(recipient,'dc-market-rent-2br').status,'yours');
    assert.equal(record(recipient,'dc-market-rent-2br').sharedUnverified,true);
    assert.deepEqual(recipient.errors,[]);
  });
  await test('absent county ZORI blocks dependent figures with a reason, never partial revenue or zero',async()=>{
    const missing=hud.counties.find(c=>!zori.counties[c.fips] && limits.maxGrossRent(chfa,c.fips,60,'2BR').grossRent>0).fips;
    const p=await openPage(''); setField(p,'dc-county-select',missing); mix(p,[{tier:60,br:'2br',units:48}],60);
    assert.equal(p.w.__DealCalc.getZoriPerBrRent(missing),null,'real county has no ZORI');
    for(const id of ['dc-r-rents','dc-noi-computed','dc-r-noi-stab','dc-r-mortgage','dc-su-mortgage','dc-su-gap']) {
      assert.equal(p.d.getElementById(id).dataset.unavailableReason,'market_rent_missing',id);
      assert(!/\$\s*\d/.test(text(p,id)),id+' is unavailable, not zero or a partial total');
      assert(text(p,id).includes('12'),'the reason identifies the unpriced unit count');
    }
    assert.equal(explanation(p).result,null);
    const snapshot=p.w.__DealCalcShare.buildSnapshot();
    assert.equal(snapshot.rentSchedule.rows.find(r=>r.tier==='market').rent,null);
    assert.equal(snapshot.reportMeta.methodology.find(m=>m.id==='dc-r-rents').withYourNumbers.result,null);
    assert.equal(snapshot.reportMeta.methodology.find(m=>m.id==='dc-su-gap').withYourNumbers.result,null,
      'missing revenue must propagate through mortgage and funding-gap arithmetic, not just the labels');
    assert(snapshot.reportMeta.needsSource.some(f=>f.id==='dc-market-rent-2br'));
    setField(p,'dc-market-rent-mode','override'); setField(p,'dc-market-rent-2br',1719);
    setField(p,'dc-market-rent-source','Local rent survey, 2026-10-04');
    checkRevenue(p,restrictedRevenue([{tier:60,br:'2br',units:48}],missing)+12*1719*12);
    for(const absent of ['',0,-1]) {
      setField(p,'dc-market-rent-2br',absent);
      assert.equal(p.d.getElementById('dc-r-rents').dataset.unavailableReason,'market_rent_missing');
      assert.equal(explanation(p).result,null);
    }
  });
  await test('zero remainder leaves existing revenue unchanged; an all-market deal uses the visible fallback bedroom choice',async()=>{
    const p=await openPage('',null,{jurisdiction}); mix(p,restricted,48);
    checkRevenue(p,restrictedRevenue(restricted));
    assert(p.d.getElementById('dc-manual-market-rents').hidden);
    setField(p,'dc-market-rent-mode','override'); setField(p,'dc-market-rent-2br','');
    checkRevenue(p,restrictedRevenue(restricted));
    setField(p,'dc-market-rent-mode','zori'); mix(p,[],12);
    assert(!p.d.getElementById('dc-market-bedroom-wrap').hidden);
    assert.equal(p.d.getElementById('dc-market-bedroom').value,'2br');
    const rents=p.w.__DealCalc.getZoriPerBrRent(county);
    checkRevenue(p,12*rents['2br']*12);
    setField(p,'dc-market-bedroom','1br'); checkRevenue(p,12*rents['1br']*12);
    assert.equal(text(p,'dc-r-credits'),money(0));
  });
  if(failed) process.exitCode=1;
})();
