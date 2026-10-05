'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {openPage, setField, close} = require('./helpers/deal-calculator-page.cjs');
const utils = require('../js/components/zori-rent-utils.js');
const zori = require('../data/market/zori_rents_co.json');
const mix = require('../data/market/acs_renter_bedrooms_co.json');
const acs = require('../data/market/acs_median_rent_co.json');
const hud = require('../data/hud-fmr-income-limits.json');
const keys=['studio','1br','2br','3br','4br'];
const fields=['efficiency','one_br','two_br','three_br','four_br'];
const api={getMeta:()=>hud.meta,getFmrByFips:fips=>hud.counties.find(c=>c.fips===fips)?.fmr};
const norm=s=>s.replace(/\s*\((city|town|cdp)\)$/i,'').toLowerCase();
const dollars=n=>'$'+Math.round(n).toLocaleString('en-US');
let checked=0, cityChecked=0, reviewed=0;
for(const [kind,records] of Object.entries({counties:mix.counties,places:mix.places})) {
  for(const [geoid,row] of Object.entries(records)) {
    const county=row.county_fips, options={geoid:kind==='places'?geoid:null,bedroomMix:mix};
    const city=kind==='places' && Object.values(zori.cities).find(c=>norm(c.name)===norm(row.name));
    const source=city || zori.counties[county];
    const rents=utils.getPerBedroomRent(zori,county,api,options);
    if(!source || source.rent<=0) {assert.equal(rents,null);continue;}
    const sourceMix=city ? row : mix.counties[county];
    if(sourceMix.unavailable_reason) {assert.equal(rents,null);continue;}
    assert(rents,geoid+' has complete source records');
    const c=sourceMix.bedrooms, weights=[c.studio,c['1br'],c['2br'],c['3br'],c['4br']+c['5plus']];
    const total=weights.reduce((a,b)=>a+b,0), fmr=api.getFmrByFips(county);
    const denominator=fields.reduce((sum,key,i)=>sum+fmr[key]*weights[i],0)/total;
    for(const [i,key] of keys.entries()) assert.equal(rents[key],Math.round(source.rent*fmr[fields[i]]/denominator),geoid+'/'+key);
    const mean=keys.reduce((sum,key,i)=>sum+rents[key]*weights[i],0)/total;
    assert(Math.abs(mean-source.rent)<=1,geoid+' weighted mean equals all-homes ZORI');
    assert.equal(rents._meta.rent,source.rent);
    assert.equal(rents._meta.geoid,city?geoid:county);
    assert.equal(rents._meta.sourceUrl,city?zori.meta.city_url:zori.meta.county_url);
    assert.equal(rents._meta.bedroomMixVintage,mix.meta.vintage);
    if(rents['2br']<fmr.two_br) {
      assert.equal(rents._meta.review_flag.reason,'zori_2br_below_fmr');
      assert.equal(rents._meta.review_flag.fmr_2br,fmr.two_br); reviewed++;
    }
    checked++;if(city)cityChecked++;
  }
}
assert(checked>20 && cityChecked>0 && reviewed>0,'all source cases are non-vacuous');
assert.equal(utils.getPerBedroomRent(zori,'08077',api),null,'missing mix stays unavailable');
assert.equal(utils.getPerBedroomRent(zori,'08077',{getFmrByFips:()=>({two_br:1})},{bedroomMix:mix}),null,'no invented FMR ratios');
assert.equal(utils.getMarketRent(zori,'08031',{bedroomMix:mix,geoid:'0828745'}).geoid,'08031','wrong-county place cannot bind');
for(const [kind,records] of Object.entries({counties:acs.counties,places:acs.places})) for(const [geoid,row] of Object.entries(records)) {
  const source=require('../data/hna/summary/'+geoid+'.json').acsProfile.DP04_0134E;
  assert.equal(row.median_gross_rent,source>0?source:null,kind+'/'+geoid);
}
(async()=>{
  try {
    const jurisdiction={geoType:'place',geoid:'0828745',name:'Fruita',countyFips:'08077',countyName:'Mesa County'};
    const p=await openPage('',null,{jurisdiction});
    assert.deepEqual(p.errors,[]);
    const expected=utils.getPerBedroomRent(zori,'08077',api,{geoid:jurisdiction.geoid,bedroomMix:mix});
    assert.deepEqual(JSON.parse(JSON.stringify(p.w.__DealCalc.getZoriPerBrRent('08077'))),expected,'real page delegates the same records');
    // Current geography, not a one-time load binding.
    p.w.WorkflowState.setJurisdiction({geoType:'place',geoid:'0807850',name:'Boulder',countyFips:'08013',countyName:'Boulder County'});
    setField(p,'dc-county-select','08013');
    assert.equal(p.w.__DealCalc.getZoriPerBrRent('08013')._meta.geoid,'0807850');
    // Real triangulation renders the published place rent and premium, not a tract average.
    const host=p.d.createElement('div');p.d.body.append(host);
    p.w.eval(fs.readFileSync(path.join(__dirname,'../js/components/rent-triangulation.js'),'utf8'));
    p.w.RentTriangulation.attach(host,{placeGeoid:jurisdiction.geoid,placeName:'Fruita',countyFips:'08077',countyName:'Mesa County'});
    await new Promise(r=>setTimeout(r,50));
    assert(host.textContent.includes(dollars(acs.places[jurisdiction.geoid].median_gross_rent)));
    assert(host.textContent.includes(dollars(zori.cities.fruita.rent-acs.places[jurisdiction.geoid].median_gross_rent)), 'rendered premium uses the published B25064');
    assert(!/NaN/.test(host.textContent));
    console.log(`market-construction: PASS (${checked} rent distributions; ${cityChecked} city selections; ${reviewed} review flags; all ACS rows; real page)`);
  } finally {close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
