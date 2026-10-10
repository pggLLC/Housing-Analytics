'use strict';
// Real calculator, invented records only. Pin status/amount/source agreement,
// not the sentence surrounding those claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const invented = require('./fixtures/predictor-policy.cjs');
const root = path.resolve(__dirname, '..');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
const money = n => '$' + n.toLocaleString('en-US');
async function open(browser, width, sources) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== 'http://example.org') return route.abort();
    const rel = decodeURIComponent(u.pathname.slice(1));
    if (Object.hasOwn(sources, rel)) return route.fulfill({ json: sources[rel] });
    if (rel.startsWith('data/')) return route.fulfill({ status: 404, json: { unavailableReason: 'not_in_invented_fixture' } });
    if (rel === 'js/deal-calculator.js') {
      await page.waitForFunction(() => window.__DealCalcChfaTablePromise);
      await page.evaluate(() => window.__DealCalcChfaTablePromise);
    }
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://example.org/deal-calculator.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => [...document.querySelectorAll('#dc-county-select option')].some(o => o.value === '08001'));
  await page.selectOption('#dc-county-select', '08001');
  if (sources['data/policy/soft-funding-status.json']) await page.waitForSelector('[data-predictor-missing]');
  // Eligibility is not the subject of this guard. Supply an invented eligible
  // context through the real public hook; assert the resulting policy text.
  await page.evaluate(() => {
    window.TransitZone = { fundingPath: () => ({ eligible: true }) };
    window.__DealCalc.setTransitZoneContext({ status: 'eligible', designation: 'invented', program: { programRule: 'Invented eligible context' } });
  });
  return page;
}
async function pairingText(page, data) {
  await page.evaluate(data => window.__DealCalc.setTzCreditPairing(data), data);
  return page.locator('[data-qap-status]').textContent();
}
async function run() {
  const bundled = chromium.executablePath();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(bundled) ? bundled : await require('puppeteer').executablePath());
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  let programsChecked = 0, statusesChecked = 0;
  try {
    for (const width of [1280, 390]) {
      const sources = structuredClone(invented);
      // A second cap proves the panel does not merely happen to match one fixture.
      sources['data/policy/soft-funding-status.json'].programs['CHFA-CMF'].max_rule.max_amount += width;
      const page = await open(browser, width, sources);
      const missing = await page.locator('[data-missing-input]').evaluateAll(els => els.map(el => ({ key: el.dataset.missingInput, reason: el.dataset.unavailableReason, text: el.textContent })));
      assert.deepEqual(missing.map(m => [m.key, m.reason]).sort(), [['pmaScore', 'pma_score_missing'], ['softFundingAvailable', 'soft_funding_missing']]);
      assert(missing.every(m => m.text.trim()), 'each missing input has a visible reason');
      assert(!/\$500K|PMA score:?\s*50/.test(await page.locator('#dc-concept-rec').textContent()));
      const legislation = sources['data/policy/tax-credit-legislation.json'];
      for (const status of ['draft', 'adopted']) {
        legislation.entries[0].tz_credit_pairing.status = status;
        const p = legislation.entries[0].tz_credit_pairing;
        const text = await pairingText(page, legislation);
        assert.equal(await page.locator('[data-qap-status]').getAttribute('data-qap-status'), status);
        assert(text.includes(p.source) && text.includes(p.source_date), 'source title and its date rendered');
        assert(text.includes(money(p.nine_percent['2027'])) && text.includes(money(p.nine_percent['2028'])), 'amounts agree with selected policy record');
        assert.equal(/draft|not yet adopted|final QAP/i.test(text), status === 'draft', 'only draft policy may claim pending adoption');
        if (status === 'adopted') assert(/adopted/i.test(text), 'adopted status visible');
        statusesChecked++;
      }
      // Missing metadata never borrows the prior policy's conclusion/amount.
      for (const key of ['status', 'source', 'source_date']) {
        const bad = structuredClone(legislation);
        delete bad.entries[0].tz_credit_pairing[key];
        delete bad.entries[0].last_verified;
        const text = await pairingText(page, bad);
        assert(/unavailable/i.test(text), key + ' must block unverified policy amounts');
        assert(!text.includes(money(legislation.entries[0].tz_credit_pairing.nine_percent['2027'])));
      }
      assert(!/\$[\d,]+/.test(await pairingText(page, null)), 'failed policy load has no per-project amounts');
      const fallback = structuredClone(legislation);
      delete fallback.entries[0].tz_credit_pairing.source_date;
      const checked = await pairingText(page, fallback);
      assert(checked.includes('checked ' + fallback.entries[0].last_verified), 'verification date is not presented as publication date');
      const programs = sources['data/policy/soft-funding-status.json'].programs;
      for (const [id, p] of Object.entries(programs)) {
        const card = page.locator('[data-program-id="' + id + '"]');
        const text = await card.textContent();
        for (const fact of [p.name, p.source_note, p.last_verified, p.max_rule.text, money(p.max_rule.max_amount)]) assert(text.includes(fact), id + ': policy fact ' + fact);
        assert.equal(await card.locator('a').getAttribute('href'), p.source_url, 'program authority link agrees with record');
        assert.equal(await card.locator('[data-program-type]').textContent(), p.funding_type.replace(/_/g, ' '));
        programsChecked++;
      }
      assert.equal(await page.locator('[data-program-id="CHFA-CMF"] [data-program-cap]').textContent().then(t => t.includes(money(programs['CHFA-CMF'].max_rule.max_amount))), true);
      assert.equal(await page.locator('#dc-soft-funding-ref-list a[href*="housing-trust-fund"]').count(), 0, 'no retired CHFA HTF URL retained');
      await page.locator('#dc-soft-funding-ref-list').evaluate(el => { el.closest('details').open = true; });
      const overflowing = await page.locator('[data-program-reference]').evaluateAll(els => els.filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.dataset.programReference));
      assert.deepEqual(overflowing, [], 'reference cards fit ' + width + 'px');
      if (process.env.PREDICTOR_POLICY_SCREENSHOTS) {
        await page.locator('[data-program-id="CHFA-CMF"]').screenshot({ path: '/tmp/2121-cmf-' + width + '.png' });
        await page.locator('#dc-concept-rec').screenshot({ path: '/tmp/2121-predictor-' + width + '.png' });
        await page.locator('#dc-tz-note').screenshot({ path: '/tmp/2121-qap-' + width + '.png' });
      }
      console.log('Chromium calculator @ ' + width + 'px: source facts, draft/adopted, missing inputs and card widths pass');
      await page.close();
    }
    const noPolicy = structuredClone(invented);
    noPolicy['data/policy/soft-funding-status.json'] = { programs: {} };
    const page = await open(browser, 390, noPolicy);
    assert.equal(await page.locator('[data-program-cap]').count(), 0, 'missing program records never restore hard-coded caps');
    assert.equal(await page.locator('#dc-soft-funding-ref-list [data-unavailable-reason="program_terms_missing"]').count(), 14);
    await page.close();
  } finally { await browser.close(); }
  assert.equal(programsChecked, 14, 'all seven sourced reference programs checked at both widths');
  assert.equal(statusesChecked, 4, 'both policy statuses checked at both widths');
  console.log('predictor-policy browser: PASS (invented data only)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
