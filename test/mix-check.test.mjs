#!/usr/bin/env node
/**
 * Contract for js/mix-check.js, the need and pencil checks every "ideal deal"
 * recommendation shares.
 *   - every pencil assumption comes from an adopted, sourced CHFA rule in
 *     data/policy/lihtc-underwriting-rules.json, and the quote is the QAP's words;
 *   - the year-1 and year-15 figures follow from those rules by hand arithmetic;
 *   - an unknown input gives a reason, never a zero;
 *   - the need notes fire on burdened bands and stay quiet without them.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const M = require(join(ROOT, 'js/mix-check.js'));
const rules = JSON.parse(readFileSync(join(ROOT, 'data/policy/lihtc-underwriting-rules.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

// 1. Assumptions come from the rules file, quoted from CHFA's QAP.
const a = M.assumptions(rules);
ok(a.ok && a.vacancy === 0.07 && a.rentGrowth === 0.02 && a.expGrowth === 0.03 && a.opex === 4500 && a.reserve === 350 && a.dscr === 1.15,
  'pencil must use CHFA\'s minimum pro forma assumptions from the rules file');
const R = rules.rules;
ok(/Seven percent on all project income/.test(R.pro_forma_vacancy.quote) && /\$4,500 excluding replacement reserves/.test(R.pupa_minimum.quote) &&
  /\$350\/unit annually for family projects/.test(R.replacement_reserve_minimum.quote), 'each assumption must carry the QAP\'s words');
for (const id of ['pro_forma_vacancy', 'pro_forma_rent_growth', 'pro_forma_expense_growth', 'pupa_minimum', 'replacement_reserve_minimum']) {
  ok(R[id].status === 'adopted' && rules.sources[R[id].source], `${id} must be adopted and name a listed source`);
  const broken = clone(rules); delete broken.rules[id].source;
  ok(!M.assumptions(broken).ok, `${id} without a source must stop the pencil check`);
}

// 2. Hand arithmetic for one tier.
const p = M.pencil({ limits: { '30': 834, '60': 1669 }, units: { '30': 10, '60': 30 }, rules });
const t30 = p.tiers.find((t) => t.tier === '30');
const egi1 = 834 * 12 * 0.93, cost1 = 4850;
ok(Math.abs(t30.noi1 - (egi1 - cost1)) < 0.01, '30% year-1 net must be rent × 12 × (1 − vacancy) − (operating cost + reserve)');
const n15 = egi1 * 1.02 ** 14 - cost1 * 1.03 ** 14;
ok(Math.abs(t30.noi15 - n15) < 0.01, '30% year-15 net must grow rents 2% and costs 3% a year');
ok(Math.abs(t30.breakevenCost - egi1 * (1.02 / 1.03) ** 14) < 0.01, 'operating cost a tier can bear must be set by its weakest year');
ok(p.mix && p.mix.units === 40 && Math.abs(p.mix.noi1 - (10 * t30.noi1 + 30 * p.tiers[1].noi1)) < 0.01, 'a mix must sum its units');
ok(/must-pay debt service at 1\.15 coverage/.test(M.mixSentence(p)), 'a mix that pays its way must say how much debt it carries');

// 3. A rent too low to cover costs is called short, with the year.
const low = M.pencil({ limits: { '30': 300 }, units: { '30': 5 }, rules });
ok(low.tiers[0].firstShortYear === 1 && low.tiers[0].debtServiceCapacity === 0, 'a tier short in year 1 carries no debt');
ok(/does not cover its own operating costs even in year 1/.test(M.mixSentence(low)), 'a short mix must say so');
const mid = M.pencil({ limits: { '30': 450 }, rules });
ok(mid.tiers[0].firstShortYear > 1, 'a tier that covers costs at first must name the year it runs short');

// 4. Unknowns give reasons, not zeros.
ok(!M.pencil({ limits: {}, rules }).ok, 'no rent limits must not pencil');
const unpriced = M.pencil({ limits: { '30': 834 }, units: { '30': 5, '70': 5 }, rules });
ok(unpriced.mix && /No CHFA rent limit for 70% AMI/.test(unpriced.mix.reason), 'a mix with an unpriced tier must say which');

// 5. Need notes.
const burden = M.burdenByBand([
  { key: '31to50', label: '31–50% AMI', households: 282, burdenedPct: 83 },
  { key: '51to80', label: '51–80% AMI', households: 268, burdenedPct: 28 },
  { key: '81to100', label: '81–100% AMI', households: 253, burdenedPct: 6 }]);
ok(burden['31to50'].burdened === 234 && burden['81to100'].burdened === 15, 'burdened households must be households × share');
const nn = M.needNotes({ burden, gap50: 22, lim70: 1947, lim80: 2226, rentRange: M.rentRange([{ rent: 1437 }, { rent: 2475 }]), ruralResort: true, mihtc: { name: 'Middle-income Housing Tax Credit' }, need20yr: 594 });
ok(nn.notes.some((n) => /31–50% AMI .* though only 22 homes/.test(n)), '0-short band with burdened renters must be called real need');
ok(nn.notes.some((n) => /inside the range of current rent measures here \(\$1,437–\$2,475\)/.test(n)), 'income averaging test must use the current-rent range');
ok(nn.workforce && nn.workforce.ruralResort && nn.notes.some((n) => /up to 140%/.test(n)), 'rural resort counties get the middle-income lane');
ok(nn.notes.some((n) => /20-year need \(594 homes\) is one total/.test(n)), 'the 20-year need must be named as unsplit');
const quiet = M.needNotes({ burden: M.burdenByBand([{ key: '51to80', label: 'x', households: 50, burdenedPct: 10 }]), gap50: 0 });
ok(quiet.notes.length === 0 && quiet.workforce === null, 'no burdened band and no resort county: no notes');
ok(M.rentRange([{ rent: null }, { rent: 0 }]) === null, 'no current rents: no range');

console.log(`mix-check: ${checks} checks passed`);
