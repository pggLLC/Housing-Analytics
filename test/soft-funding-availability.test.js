'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const SFT = require('../js/soft-funding-tracker');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// INVENTED program records and scenario. No client/project information.
const program = (available, extra = {}) => ({
  name: 'Invented Rental Fund', county: 'All', available, awarded: null, capacity: null,
  deadline: null, status: 'active', eligibleExecution: ['9%', '4%'], ...extra
});
const fixture = available => ({ lastUpdated: '2026-02-03', programs: { INVENTED: program(available) } });

async function main() {
  for (const value of [null, undefined, '', NaN, Infinity, -1]) {
    await SFT.load(fixture(value));
    const result = SFT.check('08999', 2026, 12345);
    assert.equal(result.available, null);
    assert.equal(result.unavailableReason, 'balance_not_published');
    assert.equal(result.confidence, null, 'unknown balance is not a confidence score');
    assert.equal(result.programs[0].available, null);
    assert.equal(result.warning, null, 'an unpublished balance is not exhaustion');
    assert(result.narrative.length > 0);
    assert(!/\$0|no funds/i.test(result.narrative + SFT._fmtDollars(value)));
    assert.equal(SFT.getEligiblePrograms('08999', '9%')[0].available, null);
    assert.equal(SFT.sumEligible('08999', '9%').total, null);
  }
  await SFT.load(fixture(0));
  assert.equal(SFT.check('08999').available, 0, 'measured zero survives');
  assert.equal(SFT.check('08999').unavailableReason, null);
  assert(SFT.check('08999').warning, 'measured exhaustion is a warning');
  assert.equal(SFT._fmtDollars(0), '$0');
  assert.equal(SFT.sumEligible('08999', '9%').total, 0);
  await SFT.load({ programs: { INVENTED: program(null), KNOWN: program(23100) } });
  assert.equal(SFT.check('08999').available, 23100, 'unknown is sorted separately from measured balances');
  assert.equal(SFT.sumEligible('08999', '9%').total, null, 'partial information is not a total');
  await SFT.load({ programs: { 'PAB-CO': program(null) } });
  assert.deepEqual([SFT.getPabStatus().totalCap, SFT.getPabStatus().committed,
    SFT.getPabStatus().remaining, SFT.getPabStatus().pctCommitted], [null, null, null, null]);

  const dom = new JSDOM('<div id="dcSoftFundingBreakdown"></div><div id="lihtcConceptCard"></div>', {
    url: 'https://example.com/market-analysis.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.setTimeout = () => 0; // no unrelated delayed bootstrap
  w.SoftFundingTracker = SFT;
  w.WorkflowState = { getActiveProject: () => ({ jurisdiction: { fips: '08999' } }) };
  let inputs;
  w.LIHTCDealPredictor = { predictConcept: value => { inputs = value; return {}; } };
  const handlers = {};
  w.PMAAnalysisRunner = { run: () => ({ on: (event, fn) => {
    handlers[event] = fn;
    return { on: function (event, fn) { handlers[event] = fn; return this; } };
  } }) };
  for (const file of ['js/lihtc-concept-card-renderer.js', 'js/pma-ui-controller.js', 'js/components/soft-funding-breakdown.js']) w.eval(read(file));
  try {
    for (const balance of [null, 0, 23100]) {
      await SFT.load(fixture(balance));
      w.PMAUIController.runEnhanced(39.1, -105.1);
      handlers.complete({ pma: { score: 61 } });
      if (balance === null) assert(!Object.hasOwn(inputs, 'softFundingAvailable'), 'PMA must omit unknown predictor inputs');
      else assert.equal(inputs.softFundingAvailable, balance, 'PMA passes the actual measured balance');
      // The market-analysis card uses this exact renderer and check() result.
      w.LIHTCConceptCardRenderer.render(w.document.getElementById('lihtcConceptCard'), {}, null, { softFunding: SFT.check('08999') });
      const fund = [...w.document.querySelectorAll('.lihtc-cc-constraint')].find(el => el.textContent.includes('Invented Rental Fund'));
      assert(fund, 'the real funding panel rendered');
      if (balance === null) assert(!/\$0|no funds/i.test(fund.textContent), 'unknown must stay unknown on screen');
    }
    // Closed rounds cannot displace open rounds or appear in the eligible UI.
    const data = fixture(null);
    data.programs.CLOSED = program(98765, { status: 'closed', name: 'Invented Closed Round' });
    await SFT.load(data);
    assert(!SFT.check('08999').programs.some(p => p.key === 'CLOSED'));
    assert.deepEqual(SFT.getEligiblePrograms('08999', '9%').map(p => p.key), ['INVENTED']);
    w.SoftFundingBreakdown.render('08999', '9%', null);
    await new Promise(resolve => setImmediate(resolve));
    const panel = w.document.getElementById('dcSoftFundingBreakdown');
    assert.equal(panel.querySelectorAll('tbody tr').length, 1, 'nonempty eligible list rendered');
    assert(panel.textContent.includes(data.programs.INVENTED.name));
    assert(!panel.textContent.includes(data.programs.CLOSED.name));
    assert(!/\$0|no funds/i.test(panel.textContent));
  } finally { dom.window.close(); }
  console.log('Soft funding: unknown/zero, partial totals, PAB, PMA handoff and both rendered panels pass (invented records).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
