'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const chfa = require('../data/chfa-income-rent-limits-2026.json');
const read = p => fs.readFileSync(p, 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(setImmediate);
(async () => {
  const w = new JSDOM('<button id="pmaExportJson"></button><button id="pmaExportMeta"></button>', {
    url: 'https://example.org/market-analysis.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole() }).window;
  const downloads = [];
  w.Blob = function(parts) { downloads.push(JSON.parse(parts.join(''))); };
  w.URL.createObjectURL = () => 'blob:test'; w.HTMLAnchorElement.prototype.click = () => {};
  w.fetch = async () => ({json: async () => chfa});
  try {
    for (const file of ['js/chfa-rent-limits.js', 'js/components/subject-project.js', 'js/market-analysis/market-analysis-utils.js',
      'js/market-analysis-scoring.js', 'js/market-analysis-enhancements.js', 'js/market-analysis.js']) w.eval(read(file));
    await settle();
    const E = w.PMAEngine, SP = w.SubjectProject;
    const acs = {renter_hh:200,total_hh:400,pop:1000,cost_burden_rate:0.4,vacancy_rate:0.05,median_gross_rent:1500,median_hh_income:60000};
    const result = Object.assign(E.computePma(acs,10,0,39.74,-104.99,[],95000,[],{}), {acs});
    E._setLastResultForTest(result); const before = plain(result);
    const subject = {county_fips:'08077',total_units:2,vacancy_rate:0.05,
      utility_allowance_basis:{method:'owner_pays_all',resident_paid:[]},
      unit_mix:[{count:2,bedrooms:'2BR',ami_tier:60,proposed_gross_rent:w.ChfaRentLimits.maxGrossRent(chfa,'08077',60,'2BR').grossRent,utility_allowance:0,fees:0}]};
    for (const scenario of ['complete','blank-rent','no-subject','table-unavailable']) {
      const saved = plain(subject); if (scenario === 'blank-rent') saved.unit_mix[0].proposed_gross_rent = '';
      w.localStorage.setItem('coho.subjectProject.v1',JSON.stringify(saved));
      w.SubjectProject = scenario === 'no-subject' ? null : SP;
      let resolve, reject;
      SP.loadChfa = () => new Promise((yes,no) => { resolve=yes; reject=no; });
      downloads.length=0;
      w.document.getElementById('pmaExportJson').click();
      if (resolve) { scenario === 'table-unavailable' ? reject(new Error('fixture')) : resolve(chfa); await settle(); }
      w.document.getElementById('pmaExportMeta').click();
      // A change while the shared CHFA table is loading must not alter this click's snapshot.
      w.localStorage.setItem('coho.subjectProject.v1',JSON.stringify({...saved,total_units:99}));
      if (resolve) { scenario === 'table-unavailable' ? reject(new Error('fixture')) : resolve(chfa); await settle(); }
      assert.equal(downloads.length,2, scenario);
      assert.deepEqual(downloads[1].rentSchedule,downloads[0].rentSchedule, scenario + ': both export paths agree');
      if (scenario === 'no-subject') assert.equal(downloads[1].rentSchedule.unavailableReason,'subject_project_unavailable');
      else if (scenario === 'table-unavailable') assert.equal(downloads[1].rentSchedule.unavailableReason,'chfa_table_unavailable');
      else assert.deepEqual(downloads[1].rentSchedule,plain(w.ChfaRentLimits.rentSchedule(saved,{chfaTable:chfa})));
      assert.deepEqual(plain(result),before,'exports never mutate the analysis result');
    }
    console.log('PASS full-metadata schedule matches JSON for complete, unpriced and unavailable states; click-time snapshot and result immutability');
  } finally { w.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
