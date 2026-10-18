#!/usr/bin/env node
/**
 * The "ideal deal" recommenders outside the white paper read the full range of
 * need and test the recommended mix with js/mix-check.js:
 *   - js/lihtc-deal-predictor.js (Deal Calculator and Market Analysis concept card),
 *     its enhanced wrapper, js/lihtc-concept-card-renderer.js and the inline
 *     fallback in js/pma-ui-controller.js;
 *   - js/hna/hna-market-bridge.js and js/market-analysis/housing-needs-fit-analyzer.js.
 *
 * Pins each figure to the file it comes from (CHAS burden, CHFA limits, the
 * county AMI gap file, the underwriting rules), and the accuracy fix: the
 * county gap file's thresholds are cumulative, so they are converted to
 * non-overlapping bands before anything sums them. Sabotage cases prove each
 * check fails when its source disagrees.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const P = require(join(ROOT, 'js/lihtc-deal-predictor.js'));
const E = require(join(ROOT, 'js/lihtc-deal-predictor-enhanced.js'));
const M = require(join(ROOT, 'js/mix-check.js'));
const R = require(join(ROOT, 'js/lihtc-concept-card-renderer.js'));
const Bridge = require(join(ROOT, 'js/hna/hna-market-bridge.js'));
const Fit = require(join(ROOT, 'js/market-analysis/housing-needs-fit-analyzer.js'));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const files = {};
for (const [k, p] of Object.entries(P.MIX_FILES)) files[k] = read(p);
files.underwritingRules = read('data/policy/lihtc-underwriting-rules.json');
const gapFile = read('data/co_ami_gap_by_county.json');

// 1. Cumulative thresholds become bands; their sum is the largest shortfall, never the overlap.
let overlapped = 0;
for (const c of gapFile.counties) {
  const s = P.amiShortfallFromCounty(c);
  const g = c.gap_units_minus_households_le_ami_pct;
  const cum = ['30', '50', '60'].map((t) => Math.max(0, -g[t]));
  ok(s.amiGapCumulative['30'] === cum[0] && s.amiGapCumulative['50'] === cum[1] && s.amiGapCumulative['60'] === cum[2], `${c.fips}: cumulative shortfalls must equal the gap file`);
  const sum = s.ami30UnitsNeeded + s.ami50UnitsNeeded + s.ami60UnitsNeeded;
  ok(sum === Math.max(...cum), `${c.fips}: bands must add to the largest cumulative shortfall (${sum} vs ${Math.max(...cum)})`);
  if (cum[0] + cum[1] + cum[2] > Math.max(...cum)) overlapped++;
}
ok(overlapped > 10, 'the scan must find counties where summing the cumulative figures double-counts (found ' + overlapped + ')');
{
  const no30 = P.amiShortfallFromCounty({ gap_units_minus_households_le_ami_pct: { '50': -40, '60': -70 } });
  ok(no30.ami30UnitsNeeded === null && no30.ami50UnitsNeeded === null && no30.ami60UnitsNeeded === null, 'an unknown 30% threshold must leave the higher bands unknown, not guessed');
  const no50 = P.amiShortfallFromCounty({ gap_units_minus_households_le_ami_pct: { '30': -10, '60': -70 } });
  ok(no50.ami50UnitsNeeded === null && no50.ami60UnitsNeeded === null, 'an unknown 50% threshold must leave the 51-60% band unknown');
}
ok(P.amiShortfallFromCounty({ gap_units_minus_households_le_ami_pct: {} }) === null && P.amiShortfallFromCounty(null) === null, 'no gap figures: null, not zeros');

// Every caller uses the conversion, not the raw cumulative values.
for (const f of ['js/deal-calculator.js', 'js/pma-ui-controller.js', 'test/lihtc-deal-predictor-backtest.test.js']) {
  ok(/amiShortfallFromCounty\(/.test(src(f)), `${f} must convert the cumulative gap with amiShortfallFromCounty`);
  ok(!/ami50UnitsNeeded\s*[=:][^;\n]*-\(\s*g(aps)?\['50'\]/.test(src(f)), `${f} must not pass the cumulative ≤50% figure as the 31–50% band`);
}

// 2. Mix context agrees with the CHFA limits and CHAS files for every county.
let withBurden = 0;
for (const lim of files.chfaLimits.counties) {
  const ctx = P.buildMixContext(files, lim.fips);
  for (const t of ['30', '40', '50', '60', '70', '80']) {
    const want = lim.regular_tiers[t] ? lim.regular_tiers[t].max_rents['2br'] : undefined;
    ok(ctx.limits[t] === want, `${lim.fips} ${t}% limit must equal the CHFA file`);
  }
  ok(ctx.ruralResort === !!lim.rural_resort, `${lim.fips} rural resort flag must follow the CHFA file`);
  const chas = files.countyChas.records.find((r) => r.fips === lim.fips);
  if (chas) {
    const b = ctx.burdenBands.find((x) => x.key === '31to50');
    ok(b.households === chas.renter_hh_by_ami['31to50'].total && Math.abs(b.burdenedPct - chas.renter_hh_by_ami['31to50'].pct_cost_burdened_30 * 100) < 1e-9, `${lim.fips} 31–50% burden must equal CHAS`);
    withBurden++;
  }
}
ok(withBurden === 64, 'all 64 counties must carry CHAS burden (found ' + withBurden + ')');
ok(P.buildMixContext(files, '0833640') === null, 'a place GEOID is not a county: no context, not a wrong one');

// 3. Gunnison: the recommendation carries notes and a pencil that follow from the files.
const gunGap = P.amiShortfallFromCounty(gapFile.counties.find((c) => c.fips === '08051'));
const gunInputs = Object.assign({ proposedUnits: 44, countyFips: '08051', geoid: '08051', ami30Scope: 'area', mixContext: P.buildMixContext(files, '08051') }, gunGap);
const rec = P.predictConcept(gunInputs);
const mc = rec.mixCheck;
const chasGun = files.countyChas.records.find((r) => r.fips === '08051').renter_hh_by_ami;
const burd3150 = Math.round(chasGun['31to50'].total * chasGun['31to50'].pct_cost_burdened_30);
ok(mc.notes.some((n) => n.startsWith(burd3150.toLocaleString('en-US') + ' renter households at 31–50% AMI')), '31–50% note must use the CHAS count (' + burd3150 + ')');
const lim = files.chfaLimits.counties.find((c) => c.fips === '08051').regular_tiers;
ok(mc.notes.some((n) => n.includes('$' + lim['70'].max_rents['2br'].toLocaleString('en-US') + ' at 70%')), '70% test must quote the CHFA limit');
ok(mc.workforce && mc.workforce.ruralResort, 'Gunnison is a CHFA rural resort county: the workforce lane must show');
const units = { '30': rec.suggestedAMIMix.ami30, '40': rec.suggestedAMIMix.ami40, '50': rec.suggestedAMIMix.ami50, '60': rec.suggestedAMIMix.ami60 };
const limits = {}; for (const t of ['30', '40', '50', '60']) limits[t] = lim[t].max_rents['2br'];
const hand = M.pencil({ limits, units, rules: files.underwritingRules });
ok(mc.sentence === M.mixSentence(hand) && hand.mix.units === 44, 'pencil sentence must be the recommended mix × CHFA two-bedroom limits');
ok(rec.conceptType !== 'seniors' && mc.pencil.assumptions.reserve === 350, 'a family concept must use the $350 family reserve');
{
  const sr = P.predictConcept(Object.assign({}, gunInputs, { seniorsDemand: true }));
  ok(sr.conceptType === 'seniors' && sr.mixCheck.pencil.assumptions.reserve === 300, 'a seniors concept must use CHFA\'s $300 senior reserve');
}
ok(mc.tierLines.length === Object.values(units).filter((n) => n > 0).length, 'one tier line per tier in the mix');
ok(/^CHFA minimum pro forma assumptions/.test(mc.assumptionsText), 'assumptions line must be present');
ok(JSON.stringify(rec.suggestedAMIMix) === JSON.stringify(P.predictConcept(Object.assign({}, gunInputs, { mixContext: undefined, countyFips: null, geoid: null })).suggestedAMIMix), 'the mix check must not change the typical mix');

// Sabotage: burden below the threshold silences the note; a missing rule stops the pencil with a reason.
const quietFiles = clone(files);
quietFiles.countyChas.records.find((r) => r.fips === '08051').renter_hh_by_ami['31to50'].pct_cost_burdened_30 = 0.05;
const quiet = P.predictConcept(Object.assign({}, gunInputs, { mixContext: P.buildMixContext(quietFiles, '08051') })).mixCheck;
ok(!quiet.notes.some((n) => /31–50% AMI/.test(n)), 'sabotage: 5% burdened at 31–50% must drop that note');
const noRule = clone(files); delete noRule.underwritingRules.rules.pupa_minimum.source;
const stop = P.predictConcept(Object.assign({}, gunInputs, { mixContext: P.buildMixContext(noRule, '08051') })).mixCheck;
ok(stop.sentence === null && /not on file: pupa/.test(stop.unavailableReason) && stop.tierLines.length === 0, 'sabotage: an unsourced rule must stop the pencil with its name, not a $0');
const noCounty = P.predictConcept({ proposedUnits: 44 }).mixCheck;
ok(!noCounty.sentence && /No county/.test(noCounty.unavailableReason), 'no county: the reason, not numbers');

// 4. Renderer: escapes, says what is unavailable, and adds no em-dash to new copy.
const html = R.mixCheckHtml(mc);
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
ok(html.includes(escHtml(mc.sentence)) && html.includes('Renters the homes-short counts miss') && !html.includes('—'), 'card shows notes and the pencil sentence without em-dashes');
ok(html.includes('Mix tested (homes by AMI level, two-bedroom rents): ' + ['30', '40', '50', '60'].filter((t) => units[t] > 0).map((t) => units[t] + ' at ' + t + '%').join(', ')), 'the tested mix shown must be the recommended AMI mix');
ok(/Not available: CHFA underwriting rule not on file: pupa/.test(R.mixCheckHtml(stop)), 'card shows why the pencil is missing');
ok(!R.mixCheckHtml({ notes: ['<b>x</b>'], sentence: null }).includes('<b>x'), 'notes are escaped');
ok(/mixCheckHtml\(rec\.mixCheck\)/.test(src('js/deal-calculator.js')) && /_mixCheckFallbackHtml\(rec\.mixCheck\)/.test(src('js/pma-ui-controller.js')), 'both concept cards render rec.mixCheck');

// 5. Enhanced wrapper carries the pencil and notes into its summary.
const enh = E.predictEnhanced(gunInputs);
ok(enh.summary.includes(mc.sentence) && enh.summary.includes(mc.notes[0]), 'enhanced summary must carry the pencil sentence and need notes');

// 6. Bridge: cumulative input is banded, CHAS burden adds segments and notes.
const prof = Bridge.buildNeedProfile({ ami30Cumulative: 357, ami50Cumulative: 0, ami60Cumulative: 0, future_units_needed_20yr: 594 }, null, { chas: files.countyChas.records.find((r) => r.fips === '08051'), ruralResort: true });
ok(prof.affordabilityGap.totalUndersupply === 357 && prof.affordabilityGap.ami50UnitsNeeded === 0, 'bridge must not sum cumulative figures (total 357, not 357 + 0 + 0 counted per band)');
const prof2 = Bridge.buildNeedProfile({ ami30Cumulative: 100, ami50Cumulative: 150, ami60Cumulative: 160 }, null);
ok(prof2.affordabilityGap.totalUndersupply === 160 && prof2.affordabilityGap.ami50UnitsNeeded === 50, 'bridge total must be the ≤60% shortfall, not 410');
ok(prof.prioritySegments.some((s) => s.band === '31to50' && s.burdenedHouseholds === burd3150), 'bridge must add the burdened 31–50% band from CHAS');
ok(prof.needNotes.some((n) => /20-year need \(594 homes\)/.test(n)) && prof.workforce, 'bridge must carry the 20-year and workforce notes');
ok(Bridge.toDealInputs(prof).amiGapCumulative['30'] === 357, 'bridge hands the cumulative figures to the predictor');
ok(Bridge.buildNeedProfile({ ami30UnitsNeeded: 10 }, null).prioritySegments.every((s) => !s.band), 'no CHAS record: no burden segments');

// 7. Fit analyzer: predictor counts are counts, and the burden and pencil reach its gaps.
const fit = Fit.analyzeHousingNeedsFit(prof, rec, { proposedUnits: 44 });
ok(fit.needCoverage && fit.paysItsWay === true && fit.needNotes === mc.notes, 'fit carries the pencil verdict and need notes');
const fitCov = Fit.analyzeHousingNeedsFit({ geography: { name: 'x' }, affordabilityGap: { ami30UnitsNeeded: 357 } }, { suggestedAMIMix: { ami30: 26, ami40: 4, ami50: 7, ami60: 7 }, suggestedUnitMix: { twoBR: 44 } });
ok(fitCov.alignmentPoints[0].startsWith('28 units at 30% AMI'), 'fit must read 26 + half of 4 units, not 26% of 44 (' + fitCov.alignmentPoints[0] + ')');
const noDeep = Object.assign({}, rec, { suggestedAMIMix: { ami30: 22, ami40: 0, ami50: 0, ami60: 22 } });
ok(Fit.analyzeHousingNeedsFit(prof, Object.assign(noDeep, { mixCheck: mc }), { proposedUnits: 44 }).gaps.some((g) => /31–50% AMI pay more than 30% of income, and this mix has no 40–50% AMI units/.test(g)), 'a mix with no 40–50% units must name the burdened 31–50% renters');

// 8. Pages load the shared module before its consumers.
for (const page of ['deal-calculator.html', 'market-analysis.html']) {
  const h = src(page);
  const i = h.indexOf('src="js/mix-check.js"'), j = h.indexOf('src="js/lihtc-deal-predictor.js"');
  ok(i > -1 && i < j, `${page} must load js/mix-check.js before the predictor`);
}
const dc = src('deal-calculator.html');
ok(dc.indexOf('src="js/lihtc-concept-card-renderer.js"') > -1 && dc.indexOf('src="js/lihtc-concept-card-renderer.js"') < dc.indexOf('src="js/deal-calculator.js"'), 'deal-calculator.html must load the card renderer before deal-calculator.js');

console.log(`deal-recommenders-mix-check: ${checks} checks passed`);
