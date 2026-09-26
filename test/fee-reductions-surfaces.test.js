'use strict';
/**
 * Fee reductions on the existing surfaces — data/policy/fee-reductions.json
 * is the single source of truth for local fee waivers; these checks hold the
 * surfaces that show it to that file rather than to their own copy.
 *
 *  1. The two older fee datasets point at it: every tap_fee_reduction row in
 *     jurisdiction-housing-progress.json and every fee-waiver program in
 *     tax-abatement-inventory.json either names dataset entries for its own
 *     geography, or says "not yet verified" and carries no magnitude.
 *     A row is "active" exactly when the dataset holds a verified one-time
 *     waiver/reduction/reimbursement for that geography.
 *  2. The HNA block renders dataset entries for the selected geography, says
 *     "none verified yet" (never a bare "none") when there are none, and says
 *     "Unavailable" when the file cannot load.
 *  3. A deferral is shown as still owed, with no "how it is paid for" line.
 *  4. The deal calculator shows the measures as context and never writes an
 *     input; its statute note quotes wording the dataset's legal basis holds.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const fees = json('data/policy/fee-reductions.json');
const byId = new Map(fees.entries.map((e) => [e.id, e]));
const COST_MEASURES = new Set(['waived', 'reduced', 'reimbursed']);
// Only a standing program makes a row "active"; a one-off project award
// or a repealed program is a record, not an offer.
const costCutAt = (geoid) => fees.entries.some((e) =>
  e.geoid === geoid && e.kind === 'program' && e.recurrence === 'one_time' && COST_MEASURES.has(e.measure));

// ── 1a. jurisdiction-housing-progress.json tap_fee_reduction ──────────────
const progress = json('data/policy/jurisdiction-housing-progress.json');
let progressRows = 0;
for (const [geoid, rec] of Object.entries(progress.by_geoid)) {
  const t = rec.tap_fee_reduction;
  if (!t) continue;
  progressRows++;
  const ids = t.fee_reductions_ids || [];
  ids.forEach((id) => {
    assert.ok(byId.has(id), `${rec.name}: tap_fee_reduction names ${id}, which the dataset does not hold`);
    assert.strictEqual(byId.get(id).geoid, geoid, `${rec.name}: ${id} belongs to another geography`);
  });
  if (costCutAt(geoid)) {
    assert.strictEqual(t.status, 'active', `${rec.name}: the dataset has a verified fee cut, so the row must be active`);
    assert.ok(ids.length, `${rec.name}: active row must name its dataset entries`);
  } else {
    assert.notStrictEqual(t.status, 'active', `${rec.name}: "active" with no verified fee cut in the dataset`);
    assert.ok(['not_yet_verified', 'deferral_only', 'rate_discount_only', 'project_award_only'].includes(t.status),
      `${rec.name}: status ${t.status} — an unverified row says not_yet_verified, not a status`);
  }
}
assert.ok(progressRows >= 30, `only ${progressRows} progress rows scanned`);

// Every status the progress rows use has its own opportunity-finder marker,
// so none of them falls through to the "none" symbol.
const lof = read('js/lihtc-opportunity-finder.js');
new Set(Object.values(progress.by_geoid).map((r) => r.tap_fee_reduction && r.tap_fee_reduction.status).filter(Boolean))
  .forEach((st) => assert.ok(lof.includes(`s === '${st}'`), `opportunity finder has no marker for status ${st}`));

// ── 1b. tax-abatement-inventory.json fee-waiver programs ──────────────────
const inventory = json('data/tax-abatement-inventory.json');
let feeRows = 0, backedRows = 0;
inventory.jurisdictions.forEach((j) => {
  const geoids = (j.geoKeys || []).map((k) => k.split(':')[1]);
  (j.programs || []).filter((p) => p.category === 'fee-waiver').forEach((p) => {
    feeRows++;
    const ids = p.fee_reductions_ids || [];
    if (ids.length) {
      backedRows++;
      ids.forEach((id) => {
        assert.ok(byId.has(id), `${j.name}: fee-waiver names ${id}, which the dataset does not hold`);
        assert.ok(geoids.includes(byId.get(id).geoid), `${j.name}: ${id} is for another geography`);
      });
    } else {
      assert.ok(/not yet verified/i.test(p.verification_note || ''), `${j.name}: unbacked fee-waiver must say not yet verified`);
      assert.ok(!p.magnitude, `${j.name}: an unverified fee-waiver carries no magnitude`);
    }
  });
});
assert.ok(feeRows >= 15 && backedRows >= 5, `fee-waiver scan found ${feeRows} rows, ${backedRows} backed`);

// ── 2–3. Render the HNA block against the real dataset ────────────────────
function loadComponent(fetchImpl) {
  const sandbox = {
    console: { warn() {}, log() {} },
    fetch: fetchImpl,
    document: {
      getElementById: () => ({}), // styles already "present"
      createElement: () => ({}),
      head: { appendChild() {} },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = read('js/components/tax-abatement.js');
  new Function('window', 'globalThis', 'fetch', 'document', 'console', src)(
    sandbox, sandbox, sandbox.fetch, sandbox.document, sandbox.console);
  return sandbox.TaxAbatement;
}
const okFetch = (url) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(/tax-abatement-inventory/.test(url) ? inventory : fees),
});

function render(TA, opts) {
  const box = { innerHTML: '' };
  TA.attachCostReductions(box, opts);
  return new Promise((r) => setTimeout(() => r(box.innerHTML), 20));
}

(async () => {
  const TA = loadComponent(okFetch);
  const withFee = fees.entries.find((e) => e.state === 'CO' && e.geoid && e.geoid.length === 7 && e.measure === 'waived');
  const html = await render(TA, { geoid: withFee.geoid, jurisName: withFee.jurisdiction });
  const ownCount = fees.entries.filter((e) => e.geoid === withFee.geoid).length;
  assert.strictEqual((html.match(/data-fee-entry=/g) || []).length, ownCount,
    'the HNA block shows exactly the dataset entries for the selected geography');
  assert.ok(html.includes(withFee.id), 'renders the entry for the geography');
  assert.ok(/Screening context, not a study/.test(html), 'says it is screening context (PC-5)');

  // Past awards and repealed programs are grouped apart from standing programs.
  const withAward = fees.entries.find((e) => e.kind === 'repealed');
  const ah = await render(TA, { geoid: withAward.geoid, jurisName: withAward.jurisdiction });
  const pastAt = ah.indexOf('Past project awards and repealed programs');
  assert.ok(pastAt > 0 && ah.indexOf('data-fee-entry="' + withAward.id + '"') > pastAt,
    'a repealed program is listed under past awards, not as a standing program');

  const deferral = fees.entries.find((e) => e.measure === 'deferred' && e.geoid);
  if (deferral) {
    const dh = await render(TA, { geoid: deferral.geoid, jurisName: deferral.jurisdiction });
    const block = dh.slice(dh.indexOf('data-fee-entry="' + deferral.id + '"'));
    const item = block.slice(0, block.indexOf('</li>'));
    assert.ok(/still owed/.test(item), 'a deferral is labelled as still owed');
    assert.ok(!/How the waived amount is paid for/.test(item), 'a deferral has no backfill line');
  }

  const geoWithNothing = '0800760'; // Aguilar (town)
  assert.ok(!fees.entries.some((e) => e.geoid === geoWithNothing), 'fixture must have no entries');
  const none = await render(TA, { geoid: geoWithNothing, countyFips: '08071', jurisName: 'Aguilar' });
  assert.ok(/none verified yet for Aguilar/.test(none), 'absence reads as none verified yet');
  assert.ok(/not the same as none/i.test(none), 'absence is not presented as none');

  const TAdown = loadComponent(() => Promise.reject(new Error('offline')));
  const down = await render(TAdown, { geoid: withFee.geoid, jurisName: 'X' });
  assert.ok(/^<p class="ta-empty">Unavailable/.test(down), 'a failed load says Unavailable, and why');
  // An HTTP error resolves fetch() normally; it must still read as unavailable.
  const TA404 = loadComponent(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }));
  const notFound = await render(TA404, { geoid: withFee.geoid, jurisName: 'X' });
  assert.ok(/^<p class="ta-empty">Unavailable/.test(notFound), 'an HTTP 404 says Unavailable, not "none verified"');

  // The intro must not claim every item was read at the primary source
  // while the dataset holds reported entries.
  if (fees.entries.some((e) => e.verification.level === 'reported')) {
    assert.ok(/as reported by/.test(html) && !/Each item below was read from the jurisdiction/.test(html),
      'the intro distinguishes primary from reported items');
  }

  // A tax-abatement inventory row shared by several places shows only the
  // selected place's own verified entries.
  let sharedChecked = 0;
  for (const j of inventory.jurisdictions) {
    const geoids = (j.geoKeys || []).map((k) => k.split(':')[1]);
    if (geoids.length < 2) continue;
    if (!(j.programs || []).some((x) => x.category === 'fee-waiver' && (x.fee_reductions_ids || []).length)) continue;
    for (const g of geoids) {
      const box = { innerHTML: '' };
      TA.attach(box, { geoKey: 'place:' + g, jurisName: g });
      await new Promise((r) => setTimeout(r, 20));
      const shown = [...box.innerHTML.matchAll(/data-fee-entry="([^"]+)"/g)].map((m) => m[1]);
      shown.forEach((id) => assert.strictEqual(byId.get(id).geoid, g,
        `${j.name}: selecting ${g} shows ${id}, which belongs to ${byId.get(id).geoid}`));
      sharedChecked++;
    }
  }
  assert.ok(sharedChecked >= 4, `only ${sharedChecked} shared-row selections checked`);

  // ── HNA wiring ──
  const hna = read('js/hna/hna-renderers.js');
  assert.ok(/id="lr-cost-reductions-mount"/.test(hna) && /attachCostReductions\(crMount/.test(hna),
    'HNA local resources mounts the verified cost-reduction block');

  // ── 4. Deal calculator: context only, statute note agrees with the dataset ──
  const dc = read('js/deal-calculator.js');
  const fn = dc.slice(dc.indexOf('function _dcAppendFeeContext'), dc.indexOf('// Hook into the existing render lifecycle'));
  assert.ok(fn.length > 200, 'fee context function found');
  assert.ok(!/\.value\s*=|dispatchEvent|_dcSet|setInput/.test(fn), 'fee context never writes an input');
  assert.ok(/context only, not applied/.test(fn), 'fee context says it is not applied');
  const note = (dc.match(/k: 'impact_fee_loan'[\s\S]*?notes: '([^']*(?:\\'[^']*)*)'/) || [])[1] || '';
  const quoted = (note.match(/"([^"]+)"/) || [])[1];
  assert.ok(quoted, 'the impact-fee note quotes the statute');
  const statute = fees.meta.legal_basis.find((l) => /29-20-104\.5/.test(l.citation));
  assert.ok(statute && statute.evidence.some((ev) => ev.quote.includes(quoted)),
    `the note's quoted words "${quoted}" must be in the dataset's C.R.S. 29-20-104.5 evidence`);
  assert.ok(!/CO statute permits waivers for income-restricted units/.test(dc), 'the uncited statute note is gone');

  console.log('fee-reductions surfaces: all checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
