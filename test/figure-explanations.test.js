#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const { openPage, setField, close } = require('./helpers/deal-calculator-page.cjs');
const read = p => fs.readFileSync(p,'utf8'), json = p => JSON.parse(read(p));
const FRUITA = { geoType:'place',geoid:'0828745',countyFips:'08077',name:'Fruita',countyName:'Mesa County' };
const LONGMONT = { geoType:'place',geoid:'0845970',countyFips:'08013',name:'Longmont' };
const chfa = json('data/chfa-income-rent-limits-2026.json');
const limits = require('../js/chfa-rent-limits.js');
const FIGURES = [
  ['deal-calculator.html','dc-su-gap','funding-gap'],
  ['deal-calculator.html','dc-own-gap-per-unit','ownership-subsidy-gap'],
  ['deal-calculator.html','dc-r-rents','scheduled-rent-revenue'],
  ['market-analysis.html','pmaProposedCaptureRate','project-capture'],
  ['market-analysis.html','pmaAbsorptionRiskBody','absorption-risk'],
  ['market-analysis.html','subject-scheduled-rent-1','scheduled-row-rent'],
  ['market-analysis.html','subject-scheduled-rent-2','scheduled-row-rent'],
];
const HNA_PAGES = ['housing-needs-assessment.html','hna-what-households-can-afford.html'];
const HNA_BANDS = [30,40,50,60,70,80,100];
const placeGap = json('data/co_ami_gap_by_place.json'), countyGap = json('data/co_ami_gap_by_county.json');
const frutaGap = placeGap.places[FRUITA.geoid];
let priorHh = 0, priorUnits = 0;
const positiveBands = HNA_BANDS.filter(b => {
  const hh = frutaGap.households_le_ami_pct[b], units = frutaGap.units_priced_affordable_le_ami_pct[b];
  const positive = hh - priorHh > units - priorUnits; priorHh = hh; priorUnits = units; return positive;
});
assert(positiveBands.length > 0, 'Fruita must exercise actual shortfall rows');
for (const page of HNA_PAGES) {
  for (const b of HNA_BANDS) {
    FIGURES.push([page,'statGap'+b,'renter-demand-cumulative'],[page,'statTierGap'+b,'renter-demand-tier']);
  }
  for (const b of positiveBands) FIGURES.push([page,'hnaGapToday'+b,'rental-shortfall-band']);
  FIGURES.push([page,'hnaGapNetLine','rental-shortfall-summary']);
}
const checked = new Set();
function explanation(w,page,id,expected) {
  const listed = FIGURES.find(r=>r[0]===page && r[1]===id); assert(listed,'figure must be listed: '+id);
  const el = w.document.getElementById(id); assert(el,'real page figure missing: '+id);
  assert.equal(el.dataset.methodologyKey,listed[2],id+' must carry its registry key');
  const entry = w.MethodologyExplainer.REGISTRY[listed[2]]; assert(entry,id+' resolves');
  for (const key of ['what','how','source','next']) assert.equal(typeof entry[key],'string',id+' '+key);
  for (const key of ['what','how','source','next']) assert(entry[key].trim(),id+' empty '+key);
  assert.equal(typeof entry.compute,'function');
  assert(!/\b(underwritten|appraised|approved|formal market study)\b/i.test([entry.what,entry.how,entry.source,entry.next].join(' ')));
  w.MethodologyExplainer.attach();
  const icon = el._methodologyIcon; assert(icon,id+' accessible explanation');
  assert.equal(icon.getAttribute('tabindex'),'0'); icon.focus();
  assert.equal(icon.getAttribute('aria-expanded'),'true');
  const pop = icon.nextElementSibling; assert.equal(pop.hidden,false);
  assert.equal(icon.getAttribute('aria-controls'),pop.id);
  pop.focus(); assert.equal(pop.hidden,false,'keyboard can enter and scroll long explanations');
  pop.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(pop.hidden,true); icon.click();
  const line = pop.querySelector('.me-calculation'); assert(line);
  assert(!/NaN/.test(line.textContent));
  if (expected === null) {
    assert.equal(line.dataset.result,''); assert(line.dataset.unavailableReason);
    assert(!/\b0\b/.test(line.textContent),'missing inputs must not be displayed as zero');
  } else {
    assert.equal(line.dataset.unavailableReason,'',id+' available explanation');
    const result = Number(line.dataset.result);
    const rounded = /capture|absorption/.test(listed[2]) ? Number(result.toFixed(1)) : Math.round(result);
    assert.equal(rounded,expected,id+' explanation must equal displayed figure');
    assert(pop.querySelector('.me-source-context').textContent.length>30,id+' actual source context');
  }
  icon.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(pop.hidden,true); icon.click(); assert.equal(pop.hidden,false);
  checked.add(page+'#'+id);
  return line;
}
function number(text) {
  const match = text.match(/-?\$?([\d,]+(?:\.\d+)?)/); assert(match,'displayed number: '+text);
  return Number(match[0].replace(/[$,]/g,''));
}
const subject = { county_fips:FRUITA.countyFips,total_units:5,vacancy_rate:.06,
  utility_allowance_basis:{method:'pha',reference:'Mesa schedule',effective_date:'2026-01-01',resident_paid:['heat'],bound_county_fips:FRUITA.countyFips},
  unit_mix:[{bedrooms:'2BR',count:3,ami_tier:60,proposed_gross_rent:limits.maxGrossRent(chfa,FRUITA.countyFips,60,'2BR').grossRent,utility_allowance:150,fees:12},
    {bedrooms:'1BR',count:2,ami_tier:'market',market_rent:1700,market_rent_source:'Local survey, September 2026'}] };
const tick = ()=>new Promise(r=>setImmediate(r));
async function marketPage() {
  const vc=new VirtualConsole(), errors=[]; vc.on('jsdomError',e=>{if(!e.message.startsWith('Not implemented')) errors.push(e.message);});
  const w=new JSDOM(read('market-analysis.html'),{url:'http://127.0.0.1/market-analysis.html',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}).window;
  w.alert=()=>{}; w.fetch=url=>{const p=new URL(url,w.location.href).pathname.slice(1);return Promise.resolve({ok:fs.existsSync(p),json:()=>Promise.resolve(fs.existsSync(p)?json(p):null)});};
  w.DataService={baseData:p=>'data/'+p,getJSON:p=>Promise.resolve(json(p))};
  const files=['js/site-state.js','js/workflow-state-core.js','js/workflow-state-api.js','js/components/jurisdiction-url-context.js',
    'js/market-analysis-cache-fix.js','js/data-connectors/hud-fmr.js','js/utils/format-money.js',
    'js/market-analysis/market-analysis-utils.js','js/market-analysis/market-report-renderers.js','js/market-analysis-scoring.js',
    'js/market-analysis-supply.js','js/market-analysis-enhancements.js','js/methodology-explainer.js','js/market-analysis.js',
    'js/pma-competitive-set.js','js/pma-justification.js','js/pma-ui-controller.js','js/chfa-rent-limits.js','js/components/subject-project.js'];
  const body=w.document.body.innerHTML; w.document.body.innerHTML='';
  files.slice(0,3).forEach(p=>w.eval(read(p)));w.WorkflowState.setJurisdiction(FRUITA);w.document.body.innerHTML=body;
  files.slice(3).forEach(p=>w.eval(read(p)));
  const binding=[...w.document.scripts].find(s=>s.textContent.includes('figure.methodologyContext = function ()'));
  assert(binding,'use the page’s absorption binding'); w.eval(binding.textContent);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await tick();await w.HudFmr.load();await w.PMAEngine.whenDataReady();await tick();assert.deepEqual(errors,[]);
  return w;
}
(async()=>{
  try {
    const p=await openPage('',subject,{jurisdiction:FRUITA}); assert.deepEqual(p.errors,[]);
    for (const id of ['dc-su-gap','dc-r-rents']) explanation(p.w,'deal-calculator.html',id,number(p.d.getElementById(id).textContent));
    explanation(p.w,'deal-calculator.html','dc-su-gap',number(p.d.getElementById('dc-su-gap').textContent));
    setField(p,'dc-tdc',Number(p.d.getElementById('dc-tdc').value)+100000);
    explanation(p.w,'deal-calculator.html','dc-su-gap',number(p.d.getElementById('dc-su-gap').textContent));
    setField(p,'dc-mode-ownership',true);
    explanation(p.w,'deal-calculator.html','dc-own-gap-per-unit',number(p.d.getElementById('dc-own-gap-per-unit').textContent));
    const absent=await openPage('');setField(absent,'dc-mode-ownership',true);
    explanation(absent.w,'deal-calculator.html','dc-own-gap-per-unit',null);
    close();
    const w=await marketPage();
    try {
      const coords=json('data/co-place-centroids.json').byGeoid[FRUITA.geoid];
      w.document.getElementById('pmaProposedUnits').value='18'; w.document.getElementById('pmaAmi60').value='18';
      w.PMAEngine.runAnalysis(coords.lat,coords.lng,{method:'buffer',bufferMiles:3});await tick();
      const result=w.PMAEngine._state.getLastResult();assert(result && result.tractCount>0,'real Fruita tracts');
      explanation(w,'market-analysis.html','pmaProposedCaptureRate',number(w.document.getElementById('pmaProposedCaptureRate').textContent));
      assert.equal(w.MethodologyExplainer.REGISTRY['project-capture'].compute({proposedUnits:3,qualifiedRenters:2000}).formattedResult,'0.2%','capture uses the engine rounding at a half step');
      const captureContext = w.document.getElementById('pmaProposedCaptureRate').methodologyContext;
      for (const link of w.document.querySelectorAll('[data-methodology-key="project-capture"]')) {
        link._methodologyIcon.click();
        assert.equal(Number(link._methodologyIcon.nextElementSibling.querySelector('.me-calculation').dataset.result), w.MethodologyExplainer.REGISTRY['project-capture'].compute(captureContext).result,'capture references use the same current context');
      }
      const projects=json('data/chfa-lihtc.json').features.filter(f=>{
        const c=f.geometry && f.geometry.coordinates;return c && Math.abs(c[0]-coords.lng)<.15 && Math.abs(c[1]-coords.lat)<.15;
      }).map(f=>({units:Number(f.properties.LI_UNITS || f.properties.N_UNITS)})).filter(r=>Number.isFinite(r.units)&&r.units>0);
      assert(projects.length>0,'nonempty Fruita competitive properties');
      const run=w.PMAJustification.synthesizePMA({});run.pma=result;
      run.absorptionRisk=w.PMACompetitiveSet.calculateAbsorptionRisk(projects,18);
      w.PMADataCache.saveLastResult(coords.lat,coords.lng,{method:'buffer',bufferMiles:3},run);
      w.PMAUIController.restoreLastRun();await tick();
      const pct=w.document.getElementById('pmaAbsorptionRiskBody').textContent.match(/([\d.]+)%/);assert(pct);
      explanation(w,'market-analysis.html','pmaAbsorptionRiskBody',Number(pct[1]));
      w.SubjectProject.set(subject);w.SubjectProject.mount(w.document.getElementById('subjectProjectMount'));
      for(let i=0;i<40&&!w.document.getElementById('subject-scheduled-rent-1');i++) await new Promise(r=>setTimeout(r,50));
      for(const id of ['subject-scheduled-rent-1','subject-scheduled-rent-2']) explanation(w,'market-analysis.html',id,number(w.document.getElementById(id).textContent));
    } finally {w.close();}
    for (const page of HNA_PAGES) {
      const h = new JSDOM(read(page),{url:'http://127.0.0.1/'+page+'?geoid='+FRUITA.geoid,runScripts:'outside-only',pretendToBeVisual:true}).window;
      try {
        h.HNAState={state:{lastProj:json('data/hna/projections/08077.json')}};
        for (const file of ['js/hna/hna-utils.js','js/hna/hna-renderers.js','js/methodology-explainer.js']) h.eval(read(file));
        const frutaGeo = {type:'place',geoid:FRUITA.geoid};
        h.HNARenderers.renderGapCoverageStats(FRUITA.countyFips,json('data/hna/chas_affordability_gap.json'),countyGap,frutaGeo,placeGap,null);
        const frutaContexts = new Map();
        for (const [,id] of FIGURES.filter(f=>f[0]===page)) {
          const figure = h.document.getElementById(id), context = figure.methodologyContext;
          assert.strictEqual(context.sourceContext.record,frutaGap,'handoff the same selected record');
          assert.strictEqual(context.sourceContext.meta,placeGap.meta,'handoff the same source metadata');
          assert.strictEqual(context.sourceContext.selectedGeo,frutaGeo,'handoff the same geography');
          assert.equal(Math.round(context.displayedValue),number(figure.textContent),'handoff the exact displayed value');
          frutaContexts.set(id,context);
          const line = explanation(h,page,id,number(figure.textContent));
          const source = line.parentNode.querySelector('.me-source-context').textContent;
          for (const fact of [FRUITA.geoid,placeGap.meta.acs_year,placeGap.meta.hud_income_limits_year]) assert(source.includes(String(fact)),id+' source context matches the selected record');
        }
        // Keep the summary explanation open across a real jurisdiction render.
        await tick();
        h.HNAState.state.lastProj=json('data/hna/projections/08013.json');
        const longmontGeo={type:'place',geoid:LONGMONT.geoid};
        h.HNARenderers.renderGapCoverageStats(LONGMONT.countyFips,null,countyGap,longmontGeo,placeGap,null);
        await tick();
        const summary=h.document.getElementById('hnaGapNetLine');
        assert.equal(Number(summary._methodologyIcon.nextElementSibling.querySelector('.me-calculation').dataset.result),number(summary.textContent),'open explanation follows the Longmont render');
        let longmontChecked=0, changed=0;
        for(const [id,oldContext] of frutaContexts) {
          const figure=h.document.getElementById(id);
          if(!figure) { assert(id.startsWith('hnaGapToday'),'only no-longer-positive table rows disappear'); continue; }
          const context=figure.methodologyContext;
          assert.notStrictEqual(context,oldContext,'new render replaces context: '+id);
          assert.strictEqual(context.sourceContext.record,placeGap.places[LONGMONT.geoid],'no Fruita source record survives');
          assert.strictEqual(context.sourceContext.selectedGeo,longmontGeo);
          assert.equal(Math.round(context.displayedValue),number(figure.textContent));
          const line=explanation(h,page,id,number(figure.textContent));
          const source=line.parentNode.querySelector('.me-source-context').textContent;
          assert(source.includes(LONGMONT.geoid) && !source.includes(FRUITA.geoid),'source geography follows Longmont');
          if(context.displayedValue!==oldContext.displayedValue) changed++;
          longmontChecked++;
        }
        assert.equal(longmontChecked,14+1+h.document.querySelectorAll('#hnaProjectedDeficit tbody tr').length,'every Longmont figure checked');
        assert(changed>0,'jurisdiction fixture must change figures');
        // An unavailable displayed household count is handed off as null.
        const absentCount=JSON.parse(JSON.stringify(placeGap));
        absentCount.places[LONGMONT.geoid].households_le_ami_pct['80']=null;
        h.HNARenderers.renderGapCoverageStats(LONGMONT.countyFips,null,countyGap,longmontGeo,absentCount,null);
        for(const id of ['statGap80','statTierGap80']) {
          assert.equal(h.document.getElementById(id).textContent,'—');
          assert.equal(h.document.getElementById(id).methodologyContext.displayedValue,null);
          assert.equal(h.document.getElementById(id).methodologyContext.households,null);
          explanation(h,page,id,null);
        }
        // Demand tiles are not the net shortfall: a supply absence must not
        // create a measured zero in their net-gap explanation.
        const missing = JSON.parse(JSON.stringify(placeGap));
        missing.places[FRUITA.geoid].units_priced_affordable_le_ami_pct['80'] = null;
        h.HNARenderers.renderGapCoverageStats(FRUITA.countyFips,null,countyGap,{type:'place',geoid:FRUITA.geoid},missing,null);
        explanation(h,page,'hnaGapNetLine',null);
        // CHAS fallback has an explicit existing reason, which must travel.
        h.HNARenderers.renderGapCoverageStats(FRUITA.countyFips,json('data/hna/chas_affordability_gap.json'),null,frutaGeo,null,null);
        const unavailableSummary=h.document.getElementById('hnaGapNetLine');
        assert.equal(unavailableSummary.methodologyContext.displayedValue,null);
        assert.equal(unavailableSummary.methodologyContext.unavailableReason,unavailableSummary.textContent);
        explanation(h,page,'hnaGapNetLine',null);
      } finally {h.close();}
    }
    assert.equal(checked.size,FIGURES.length,'checked every listed figure');
    console.log('figure-explanations: PASS ('+checked.size+'/'+FIGURES.length+' real-page figures, Fruita → Longmont, source identity and absence)');
  } finally {close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
