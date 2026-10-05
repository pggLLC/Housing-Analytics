const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const doc = require('../data/market/redfin_place_market_tracker_co.json');
const housing = require('../data/market/census2020-place-tract-housing-co.json');
const builder = fs.readFileSync(path.join(root,'scripts/market/build_redfin_place_market_tracker.py'),'utf8');
assert.equal(doc.meta.source_url,'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz');
assert.equal(doc.meta.city_source_url,'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz');
assert.equal(doc.meta.source_page_url,'https://www.redfin.com/news/data-center/');
assert.equal(doc.meta.methodology_url,'https://www.redfin.com/news/data-center/methodology/');
assert.equal(doc.meta.terms_url,'https://www.redfin.com/about/terms-of-use');
assert.equal(doc.meta.crosswalk_file,'data/market/hud_zip_tract_crosswalk_co.json');
assert.equal(doc.meta.place_membership_file,'data/market/census2020-place-tract-housing-co.json');
assert.equal(doc.meta.housing_source_url,housing.meta.source_url);
assert.equal(doc.meta.state_fips,'08');
assert.equal(doc.meta.period_duration_days.zip_model,90);
assert.equal(doc.meta.months_retained,24);
for(const field of ['as_of','last_verified','review_by']) assert.match(doc.meta[field],/^\d{4}-\d{2}-\d{2}$/);
assert(doc.meta.attribution.includes('Redfin') && doc.meta.attribution.includes('does not redistribute raw Redfin rows'));
assert.equal(doc.meta.place_count,Object.keys(doc.places).length);
assert(doc.meta.place_count>=100);
assert(doc.meta.months_available_in_source>=100);
assert(doc.meta.source_zip_month_rows_used>10000);
assert(doc.meta.source_zip_month_rows_skipped_thin>0);
assert(doc.meta.suppressed_place_months_below_floor>0);
assert.equal(doc.zip5,undefined);assert.equal(doc.zips,undefined);
let modeled=0,observed=0,unavailable=0,months=0;
for(const [geoid,place] of Object.entries(doc.places)) {
  assert.match(geoid,/^08\d{5}$/);assert.equal(place.geoid,geoid);
  assert(Array.isArray(place.monthly));assert(place.latest);
  if(place.source_level==='unavailable') {
    assert.equal(place.latest.median_sale_price,null);assert(place.unavailable_reason);assert.equal(place.monthly.length,0);unavailable++;continue;
  }
  assert(place.monthly.length>0 && place.monthly.length<=doc.meta.months_retained);
  const direct=place.source_level==='redfin_city_observed';
  if(direct)observed++;else {assert.equal(place.source_level,'redfin_zip_to_place_modeled');modeled++;}
  for(const row of place.monthly) {
    assert.match(row.period,/^\d{4}-\d{2}$/);
    assert.equal(row.period,row.period_end.slice(0,7),'reported month is the end of the published window');
    assert(direct ? [30,90].includes(row.source_period_duration_days) : row.source_period_duration_days===90);
    assert(row.homes_sold_allocated>=5);
    assert(row.median_sale_price>0);
    assert(row.inventory_allocated===null || Number.isFinite(row.inventory_allocated));
    assert(row.sale_to_list_ratio===null || (row.sale_to_list_ratio>.5 && row.sale_to_list_ratio<1.5));
    assert(Array.isArray(row.source_zips));
    if(direct) {assert.equal(row.source_zip_count,0);assert(row.redfin_city_id);assert.equal(row.source_level,place.source_level);}
    else {assert(row.source_zip_count>=1);assert.equal(row.source_zip_count,row.source_zips.length);}
    months++;
  }
  const latest=place.monthly.at(-1);
  assert.equal(place.latest_period,latest.period);
  assert.equal(place.latest.median_sale_price,latest.median_sale_price);
  assert.equal(place.latest.source_period_duration_days,latest.source_period_duration_days);
}
assert(modeled>0 && observed>0 && months>0,'both pricing paths have actual observations');
for(const geoid of ['0820000','0828745','0845970']) assert(doc.places[geoid].latest.median_sale_price>0);
assert(doc.places['0816000'],'Colorado Springs has an explicit source record, including an unavailable reason if Redfin publishes no sales');
assert(!fs.readdirSync(path.join(root,'data/market')).some(n=>/^redfin.*\.(tsv|csv|gz)$/i.test(n)));
for(const key of ['REDFIN_MARKET_TRACKER_PATH','REDFIN_CITY_TRACKER_PATH','MIN_ALLOCATED_HOMES_SOLD','All Residential']) assert(builder.includes(key));
console.log(`redfin-place-market-tracker: PASS (${observed} observed, ${modeled} modeled, ${unavailable} unavailable; ${months} months)`);
