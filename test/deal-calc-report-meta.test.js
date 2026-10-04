#!/usr/bin/env node
'use strict';
const { createJsPdfMock } = require('./helpers/jspdf-mock.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const limits = require('../js/chfa-rent-limits.js');
const plain = value => JSON.parse(JSON.stringify(value));
const fruta = { geoType:'place', geoid:'0828745', name:'Fruita', countyFips:'08077', countyName:'Mesa County' };
const subject = { county_fips:fruta.countyFips, total_units:5, vacancy_rate:.06,
  utility_allowance_basis:{method:'pha', reference:'Mesa schedule', effective_date:'2026-01-01', resident_paid:['heat'], bound_county_fips:fruta.countyFips},
  unit_mix:[{bedrooms:'2BR',count:3,ami_tier:60,proposed_gross_rent:limits.maxGrossRent(chfa,fruta.countyFips,60,'2BR').grossRent,utility_allowance:150,fees:12},
    {bedrooms:'1BR',count:2,ami_tier:'market',market_rent:1700,market_rent_source:'Local survey, September 2026'}] };
const totals = {sources:0, assumptions:0, needsSource:0, methodology:0, caveats:0, sharedUnverified:0};
function visible(el, w) {
  while (el && el.nodeType === 1) { if (el.hidden || w.getComputedStyle(el).display === 'none') return false; el=el.parentElement; }
  return true;
}
function agreement(p, snapshot) {
  const report = snapshot.reportMeta, recordsBefore = plain(p.w.InputProvenance.captureLocal(p.d.getElementById('dealCalcMount')));
  const seen = {data:0, assumption:0, illustrative:0, yours:0, 'needs-source':0};
  for (const [id, [status]] of Object.entries(snapshot.inputProvenance.fields)) {
    const el = p.d.getElementById(id), record = p.w.InputProvenance.get(el);
    const meta = record.origin.meta, def = p.w.DealCalculatorInputRegistry.get(id).definition;
    seen[status]++;
    if (status === 'data' && !record.sharedUnverified) {
      const matches = report.sources.filter(s=>s.fields.some(f=>f.id===id));
      assert.equal(matches.length,1,'each data field appears once: '+id);
      for (const key of ['source','sourceUrl','vintage','geography']) assert.deepEqual(matches[0][key],meta[key],id+' '+key);
      totals.sources++;
    } else if (['assumption','illustrative','yours'].includes(status)) {
      const field = report.assumptions.find(f=>f.id===id); assert(field,'assumption missing: '+id);
      assert.equal(field.definition,def); assert.equal(field.status,status);
      if ('value' in el) assert.equal(field.value,el.value.trim()===''?null:el.value,id+' current value');
      totals.assumptions++;
    } else if (status==='needs-source') {
      const field = report.needsSource.find(f=>f.id===id); assert(field && field.reason,'missing-source reason: '+id); totals.needsSource++;
    }
    if (record.sharedUnverified) {
      assert(!report.sources.some(s=>s.fields.some(f=>f.id===id)),'shared-unverified cannot be a source: '+id);
      const field=report.sharedUnverified.find(f=>f.id===id); assert(field,id+' unverified disclosure');
      assert.equal(field.verified,false); assert(/not re-checked/.test(field.notice)); assert.equal(field.senderClaim,record.senderClaim); totals.sharedUnverified++;
    }
  }
  const sourceKeys=report.sources.map(s=>JSON.stringify([s.source,s.sourceUrl,s.vintage,s.geography,s.effectiveDate,s.countyFips]));
  assert.equal(new Set(sourceKeys).size,sourceKeys.length,'sources are deduplicated');
  const figures=[...p.d.querySelectorAll('[data-methodology-key]')].filter(el=>visible(el,p.w));
  assert(figures.length>0);
  assert.equal(report.methodology.length,figures.length,'every visible keyed figure is exported');
  for(const el of figures) {
    const m=report.methodology.find(m=>m.id===el.id && m.key===el.dataset.methodologyKey);assert(m,el.id);
    const entry=p.w.MethodologyExplainer.REGISTRY[m.key]; assert.equal(m.what,entry.what); assert.equal(m.how,entry.how);
    if (entry.caveats) {
      assert.equal(m.caveats, entry.caveats, el.id+' registry caveats retained in JSON');
      totals.caveats++;
    }
    if(entry.compute) {
      const direct=entry.compute(el.methodologyContext);
      assert.equal(m.withYourNumbers.result,direct.result,el.id+' current registry result');
      if(direct.unavailableReason) {
        assert.equal(m.withYourNumbers.result,null); assert.equal(m.withYourNumbers.unavailableReason,direct.unavailableReason);
        assert(m.withYourNumbers.text.includes(direct.unavailableReason));
        assert(!/\$0|\bNaN\b/.test(m.withYourNumbers.text));
      } else {
        assert.equal(m.withYourNumbers.text,direct.text);
        const displayed=el.textContent.match(/-?\$[\d,]+/);assert(displayed,el.id+' displayed result');
        assert.equal(Math.round(m.withYourNumbers.result),Number(displayed[0].replace(/[$,]/g,'')),el.id+' result agrees with screen');
      }
    } else { assert.equal(m.withYourNumbers.result,null);assert(m.withYourNumbers.unavailableReason); }
    totals.methodology++;
  }
  const sections = p.w.DealCalculatorReportMeta.sections(report);
  for (const section of sections) {
    const ids = section.entries.flatMap(entry => entry.fieldIds);
    assert.equal(new Set(ids).size, ids.length, section.key+' must not repeat a field id');
  }
  const assumptionEntries = sections.find(section => section.key === 'assumptions').entries;
  const expectedIds = new Set(report.assumptions.concat(report.sharedUnverified).map(field => field.id));
  assert.deepEqual(new Set(assumptionEntries.flatMap(entry => entry.fieldIds)), expectedIds, 'all review fields appear exactly once');
  for (const field of report.sharedUnverified) {
    const entries = assumptionEntries.filter(entry => entry.fieldIds.includes(field.id));
    assert.equal(entries.length, 1, field.id+' has one assumption paragraph');
    assert(entries[0].text.includes(field.notice), field.id+' retains the not-re-checked notice');
    assert(entries[0].text.includes(field.senderClaim), field.id+' retains the sender claim');
  }
  for (const figure of report.methodology.filter(figure => figure.caveats)) {
    const entry = sections.find(section => section.key === 'methodology').entries.find(entry => entry.fieldIds.includes(figure.id));
    assert(entry.text.includes(figure.caveats), figure.id+' caveats rendered under that figure');
  }
  assert.deepEqual(plain(p.w.InputProvenance.captureLocal(p.d.getElementById('dealCalcMount'))),recordsBefore,'report does not change provenance');
  return seen;
}
function mockPdf(p, onCapture) {
  const pdf = createJsPdfMock({ wrapText: true });
  p.w.html2canvas=async()=>{if(onCapture)onCapture();return {width:600,height:1600,toDataURL:()=> 'fixture image'};};
  p.w.jspdf={jsPDF:pdf.jsPDF};
  return pdf;
}
const compact=value=>String(value).replace(/\s/g,'').replace(/[‐‑‒–—−]/g,'-').replace(/≤/g,'<=').replace(/≥/g,'>=');
function textAgreement(content,report) {
  const contains=value=>assert(compact(content).includes(compact(value)),'export omits '+value);
  for(const source of report.sources) {
    for(const key of ['source','sourceUrl','vintage','geography']) contains(source[key]);
    for(const field of source.fields) contains(field.definition);
  }
  for(const field of report.assumptions) {
    contains(field.definition);if(field.value!=null)contains(field.value);
  }
  for(const field of report.needsSource){contains(field.definition);contains(field.reason);}
  for(const field of report.sharedUnverified){contains(field.definition);contains(field.senderClaim);}
  for(const figure of report.methodology) {contains(figure.what);contains(figure.how);contains(figure.withYourNumbers.text);if(figure.caveats)contains(figure.caveats);}
  contains(report.limitations);
}
async function pdfAgreement(p, snapshot, onCapture) {
  const original=p.w.DealCalculatorReportMeta.buildReportMeta;let builds=0;
  p.w.DealCalculatorReportMeta.buildReportMeta=()=>{builds++;return original();};
  const pdf=mockPdf(p,onCapture);let prints=0;p.w.print=()=>{prints++;};
  await p.w.__DealCalcShare.exportPdf();p.w.DealCalculatorReportMeta.buildReportMeta=original;
  pdf.assertSupported();assert(pdf.saved,'PDF must finish, not silently fall back');assert.equal(prints,0);assert.equal(builds,1,'capture one report at click time');
  const texts=pdf.calls.filter(c=>c.method==='text'),images=pdf.calls.filter(c=>c.method==='addImage');
  assert(texts.length>0 && images.length>1,'screenshot and text pages actually rendered');
  assert(texts.every(c=>c.page>images[images.length-1].page),'disclosures follow screenshot pages');
  assert(new Set(texts.map(c=>c.page)).size>1,'long real assumptions paginate');
  assert(texts.every(c=>c.args[2]>=40 && c.args[2]+c.fontSize<=752),'no text below printable area');
  textAgreement(texts.map(c=>c.args[0]).join('\n'),snapshot.reportMeta);
  assert.deepEqual(JSON.parse(pdf.properties.subject).rentSchedule,snapshot.rentSchedule,'keep PDF subject');
  return texts.map(c=>c.args[0]).join('\n');
}
let failed=0;
async function test(name,fn){try{await fn();console.log('  PASS '+name);}catch(e){failed++;console.error('  FAIL '+name+'\n'+e.stack);}finally{close();}}
(async()=>{
  await test('the shared PDF mock rejects unknown APIs, including swallowed and chained calls', () => {
    const mock = createJsPdfMock(), pdf = new mock.jsPDF();
    assert.throws(() => pdf.unimplementedMethod(), /jsPDF mock does not implement jsPDF.unimplementedMethod/);
    assert.throws(() => pdf.setFontSize(12).anotherMissingMethod(), /jsPDF.anotherMissingMethod/);
    assert.throws(() => pdf.internal.pageSize.unknownDimension(), /internal.pageSize.unknownDimension/);
    assert.throws(() => mock.assertSupported(), /jsPDF mock does not implement/);
  });
  await test('Fruita exports every provenance field and visible explanation; PDF agrees with the one captured JSON record',async()=>{
    const p=await openPage('',subject,{jurisdiction:fruta});assert.deepEqual(p.errors,[]);setField(p,'dc-opex','555');
    const snapshot=plain(p.w.__DealCalcShare.buildSnapshot()),seen=agreement(p,snapshot);
    for(const [status,count] of Object.entries(seen)) assert(count>0,'non-zero '+status+' scan');
    assert(snapshot.reportMeta.sources.length<seen.data,'dedup is exercised');
    await pdfAgreement(p,snapshot,()=>setField(p,'dc-opex','666'));
    assert.equal(p.d.getElementById('dc-opex').value,'666','the delayed screenshot exercised a changing page');
  });
  await test('a forged shared source remains unverified in JSON, PDF and print, and never enters sources',async()=>{
    const sender=await openPage('',subject,{jurisdiction:fruta});setField(sender,'dc-tdc','12345678');
    const s=plain(sender.w.__DealCalcShare.buildSnapshot()),map=s.inputProvenance,url=new URL(s.url);
    map.fields['dc-tdc']=['data','12345678',map.sources.length,'12345678'];
    map.sources.push({source:'Sender claim <b>not evidence</b>',sourceUrl:'https://example.org/sender',vintage:2026,geography:'Mesa County',countyFips:fruta.countyFips});
    url.searchParams.set('inputProvenance',JSON.stringify(map));
    const p=await openPage(url.search);assert.deepEqual(p.errors,[]);
    const snapshot=plain(p.w.__DealCalcShare.buildSnapshot());agreement(p,snapshot);
    const claim=snapshot.reportMeta.sharedUnverified.find(f=>f.id==='dc-tdc');assert(claim);assert(claim.senderClaim.includes('Sender claim'));
    assert.equal(snapshot.reportMeta.assumptions.find(f=>f.id==='dc-tdc').status,'yours');
    assert(!snapshot.reportMeta.sources.some(s=>JSON.stringify(s).includes('Sender claim')));
    const content=await pdfAgreement(p,snapshot);assert(/not re-checked/.test(content));
    delete p.w.jspdf;let printText;p.w.print=()=>{printText=p.d.getElementById('dc-print-report-meta').textContent;};
    await p.w.__DealCalcShare.exportPdf();textAgreement(printText,snapshot.reportMeta);assert(/not re-checked/.test(printText));
    const block=p.d.getElementById('dc-print-report-meta');assert.equal(p.w.getComputedStyle(block).display,'none');
    assert.equal(block.querySelector('b,script,a'),null,'sender text is not interpreted as HTML or a link');
    assert([...p.d.querySelectorAll('style')].some(s=>s.textContent.includes('@media print')&&s.textContent.includes('#dc-print-report-meta{display:block!important')),'disclosures become visible when printed');
  });
  await test('unavailable ownership figure stays absent and has its reason in both exports',async()=>{
    const p=await openPage('');setField(p,'dc-mode-ownership',true);
    const snapshot=plain(p.w.__DealCalcShare.buildSnapshot());agreement(p,snapshot);
    const figure=snapshot.reportMeta.methodology.find(m=>m.id==='dc-own-gap-per-unit');assert(figure);
    assert.equal(figure.withYourNumbers.result,null);assert(figure.withYourNumbers.unavailableReason);
    assert(/^unavailable\s*—/.test(figure.withYourNumbers.text));assert(!/\$0/.test(figure.withYourNumbers.text));
    assert(!snapshot.reportMeta.methodology.some(m=>m.id==='dc-su-gap'),'hidden rental figures are excluded');
    const pdf=mockPdf(p);await p.w.__DealCalcShare.exportPdf();pdf.assertSupported();assert(pdf.saved);
    textAgreement(pdf.calls.filter(c=>c.method==='text').map(c=>c.args[0]).join('\n'),snapshot.reportMeta);
  });
  await test('empty lists retain sections and print after capture failure uses the same record',async()=>{
    const p=await openPage('',subject,{jurisdiction:fruta});
    const original=p.w.DealCalculatorReportMeta.buildReportMeta;
    const report=plain(original());report.assumptions=[];report.sharedUnverified=[];report.needsSource=[];
    let builds=0;p.w.DealCalculatorReportMeta.buildReportMeta=()=>{builds++;return report;};
    const sections=p.w.DealCalculatorReportMeta.sections(report);
    const empty=sections.filter(s=>['assumptions','needsSource'].includes(s.key));assert.equal(empty.length,2);
    const pdf=mockPdf(p);await p.w.__DealCalcShare.exportPdf();pdf.assertSupported();assert(pdf.saved);
    const content=pdf.calls.filter(c=>c.method==='text').map(c=>c.args[0]).join('\n');
    for(const section of empty) assert(compact(content).includes(compact(section.empty)),'empty section is explicit');
    builds=0;p.w.html2canvas=async()=>{throw new Error('fixture capture failure');};
    let printed;p.w.print=()=>{printed=p.d.getElementById('dc-print-report-meta').textContent;};
    await p.w.__DealCalcShare.exportPdf();assert.equal(builds,1);textAgreement(printed,report);
    for(const section of empty)assert(printed.includes(section.empty));
  });
  for(const [section,count] of Object.entries(totals))assert(count>0,section+' checked non-zero records');
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));assert(pkg['scripts']['ci:part-3'].includes('npm run test:deal-calc-report-meta'));
  console.log('Report agreement coverage: '+JSON.stringify(totals));
  if(failed)process.exitCode=1;
})().catch(e=>{console.error(e.stack);close();process.exitCode=1;});
