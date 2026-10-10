#!/usr/bin/env node
/**
 * Contract for data/policy/co-developer-funding-guide.json, the Developer
 * Funding tab on colorado-deep-dive.html (rendered by js/co-developer-funding.js).
 *
 * What it pins is agreement, not copy:
 *   - every award size, rate, term, AMI restriction and affordability period
 *     carries a verbatim quote and the URL it came from, and that URL is in
 *     the program's visible source list; a term with no quote is null with a
 *     reason, never a guess;
 *   - where data/policy/soft-funding-status.json describes the same program,
 *     the dollar limits and rate it records must appear in the guide's award
 *     size and rate (the Deal Calculator reads that file; the two must agree);
 *   - the status and funding-type values are ones the renderer has a label
 *     for, and the AMI file the guide cites is the one the renderer loads;
 *   - the page has the tab, the panel, the script and the tab-switch wiring.
 * The second half mutates a copy and proves each check fires, and that a
 * rewording that keeps the numbers stays green.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const GUIDE_PATH = 'data/policy/co-developer-funding-guide.json';
const GUIDE = readJson(GUIDE_PATH);
const SOFT = readJson('data/policy/soft-funding-status.json');
const JS = read('js/co-developer-funding.js');
const PAGE = read('colorado-deep-dive.html');

// Terms a developer underwrites against: each needs a quote when stated.
const QUOTED_TERMS = ['award_size', 'rate', 'term', 'ami_restriction', 'affordability_period'];
const ALL_TERMS = QUOTED_TERMS.concat(['application_cycle']);
const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Keys of an object literal in the renderer, e.g. STATUS_LABELS = { open: ..., }.
function rendererKeys(name) {
  const m = JS.match(new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\};'));
  assert.ok(m, `renderer defines ${name}`);
  return new Set([...m[1].matchAll(/^\s*([a-z_]+):/gm)].map((x) => x[1]));
}
const STATUS_KEYS = rendererKeys('STATUS_LABELS');
const TYPE_KEYS = rendererKeys('TYPE_LABELS');
const FIELD_KEYS = new Set([...JS.matchAll(/\['([a-z_]+)', '[^']+'\]/g)].map((m) => m[1]));

// Dollar amounts written in prose: $6,000,000, $1.5 million, $750K, $1.5M.
function dollars(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|M\b|K\b)?/g)) {
    let v = Number(m[1].replace(/,/g, ''));
    if (m[2] === 'million' || m[2] === 'M') v *= 1e6;
    if (m[2] === 'K') v *= 1e3;
    out.push(Math.round(v));
  }
  return out;
}

function check(g, soft) {
  const errors = [];
  const err = (m) => errors.push(m);
  const meta = g.meta || {};
  if (!ISO.test(meta.last_checked || '')) err('meta.last_checked is not a date');
  if (!ISO.test(meta.review_by || '')) err('meta.review_by is not a date');
  const days = (Date.parse(meta.review_by) - Date.parse(meta.last_checked)) / 864e5;
  if (!(days > 0 && days <= 120)) err(`review_by must fall within 120 days after last_checked (got ${days})`);

  const cats = new Set((g.categories || []).map((c) => c.id));
  const ids = new Set();
  const programs = g.programs || [];
  if (programs.length < 30) err(`expected the full program list, found ${programs.length}`);
  for (const c of cats) if (!programs.some((p) => p.category === c)) err(`category ${c} has no programs`);

  for (const p of programs) {
    const where = `program ${p.id}`;
    if (ids.has(p.id)) err(`${where}: duplicate id`);
    ids.add(p.id);
    if (!cats.has(p.category)) err(`${where}: unknown category ${p.category}`);
    if (!HTTPS.test(p.official_url || '')) err(`${where}: official_url is not https`);
    if (p.status != null && !STATUS_KEYS.has(p.status)) err(`${where}: status ${p.status} has no label in the renderer`);
    for (const t of [].concat(p.funding_type || [])) if (!TYPE_KEYS.has(t)) err(`${where}: funding type ${t} has no label in the renderer`);
    if (!ISO.test(p.last_checked || '') || p.last_checked > meta.last_checked) err(`${where}: last_checked missing or after meta.last_checked`);
    for (const f of ALL_TERMS) if (!FIELD_KEYS.has(f)) err(`renderer does not show ${f}`);

    const sourceUrls = new Set((p.sources || []).map((s) => s.url));
    if (!sourceUrls.has(p.official_url)) err(`${where}: official page missing from sources`);
    for (const s of p.sources || []) if (!HTTPS.test(s.url || '') || !s.label) err(`${where}: bad source ${s.url}`);
    for (const e of p.evidence || []) {
      if (!e.quote || !String(e.quote).trim()) err(`${where}: empty quote for ${e.field}`);
      if (!sourceUrls.has(e.url)) err(`${where}: quote for ${e.field} cites ${e.url}, which is not in the source list`);
    }
    const quoted = new Set((p.evidence || []).map((e) => e.field));
    const reasons = new Set((p.unverified || []).filter((u) => u.reason && String(u.reason).trim()).map((u) => u.field));
    for (const f of ALL_TERMS) {
      const v = p[f];
      if (v == null) {
        if (!reasons.has(f)) err(`${where}: ${f} is null with no reason`);
        continue;
      }
      if (typeof v !== 'string' || !v.trim()) err(`${where}: ${f} is not text`);
      const needsQuote = QUOTED_TERMS.includes(f) || /\b20\d\d\b/.test(v);
      if (needsQuote && !quoted.has(f)) err(`${where}: ${f} is stated with no quoted source`);
    }

    if (p.soft_funding_id) {
      const s = soft.programs[p.soft_funding_id];
      if (!s) { err(`${where}: soft_funding_id ${p.soft_funding_id} not in soft-funding-status.json`); continue; }
      const stated = dollars(p.award_size);
      const rule = s.max_rule || {};
      for (const k of ['max_amount', 'min_amount', 'max_per_unit']) {
        if (typeof rule[k] === 'number' && !stated.includes(rule[k])) {
          err(`${where}: soft-funding-status.json ${k} ${rule[k]} does not appear in the guide's award size (${stated.join(', ') || 'none'})`);
        }
      }
      if (typeof s.rate_pct === 'number' && !new RegExp('(^|[^\\d.])' + String(s.rate_pct).replace('.', '\\.') + '%').test(p.rate || '')) {
        err(`${where}: soft-funding-status.json rate ${s.rate_pct}% does not appear in the guide's rate`);
      }
    }
  }

  for (const c of g.considerations || []) {
    if (!c.title || !c.body) err(`consideration ${c.id}: missing title or body`);
    if (!(c.sources || []).length) err(`consideration ${c.id}: no source`);
    for (const s of c.sources || []) if (!HTTPS.test(s.url || '')) err(`consideration ${c.id}: bad source ${s.url}`);
  }
  if ((g.considerations || []).length < 8) err('too few considerations');
  if ((g.stack || []).length < 4) err('capital stack overview missing');
  return errors;
}

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('co-developer-funding-guide');

ok('the committed guide passes every check', () => {
  assert.deepEqual(check(GUIDE, SOFT), []);
});

ok('non-vacuous: quoted terms and soft-funding cross-checks actually ran', () => {
  const quotedTerms = GUIDE.programs.reduce((n, p) => n + QUOTED_TERMS.filter((f) => p[f] != null).length, 0);
  assert.ok(quotedTerms >= 100, `only ${quotedTerms} quoted terms`);
  const linked = GUIDE.programs.filter((p) => p.soft_funding_id && SOFT.programs[p.soft_funding_id]);
  assert.ok(linked.length >= 5, `only ${linked.length} programs cross-checked`);
  const amounts = linked.reduce((n, p) => n + ['max_amount', 'min_amount', 'max_per_unit']
    .filter((k) => typeof (SOFT.programs[p.soft_funding_id].max_rule || {})[k] === 'number').length, 0);
  assert.ok(amounts >= 6, `only ${amounts} dollar limits compared`);
});

ok('the AMI file the guide cites is the one the renderer loads, with every tier it shows', () => {
  const m = JS.match(/var LIMITS_FILE = '([^']+)'/);
  assert.ok(m);
  assert.equal('data/' + m[1], GUIDE.meta.ami_limits_file);
  const limits = readJson(GUIDE.meta.ami_limits_file);
  assert.equal(limits.counties.length, 64);
  const tiers = JSON.parse(JS.match(/var AMI_TIERS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const c of limits.counties) for (const t of tiers) {
    assert.ok(c.regular_tiers[t], `${c.county_name} lacks the ${t}% tier`);
  }
  const g = JS.match(/var GUIDE_FILE = '([^']+)'/);
  assert.equal('data/' + g[1], GUIDE_PATH);
});

ok('the page carries the tab, the panel, the script and the tab-switch wiring', () => {
  assert.match(PAGE, /<button role="tab" id="btn-funding"[^>]*aria-controls="tab-funding"/);
  assert.match(PAGE, /<div role="tabpanel" id="tab-funding" aria-labelledby="btn-funding" hidden>/);
  assert.match(PAGE, /<script defer src="js\/co-developer-funding\.js"><\/script>/);
  assert.match(PAGE, /querySelectorAll\('[^']*#tab-funding[^']*'\)/);
  assert.match(PAGE, /targetId === 'tab-funding' && window\.CoDeveloperFunding/);
  for (const id of ['dfMeta', 'dfStack', 'dfConsiderations', 'dfFilters', 'dfPrograms', 'dfAmiCounty', 'dfAmiBody']) {
    assert.ok(PAGE.includes(`id="${id}"`), `page lacks #${id}`);
    assert.ok(JS.includes(`'${id}'`), `renderer never fills #${id}`);
  }
});

// ── Sabotage: each mutation must apply, and must be caught ──
const clone = () => JSON.parse(JSON.stringify(GUIDE));
const gapIdx = GUIDE.programs.findIndex((p) => p.id === 'prop123-ahff-lihtc-gap');
assert.ok(gapIdx >= 0 && GUIDE.programs[gapIdx].soft_funding_id, 'sabotage target is cross-checked');

function sabotage(name, mutate, expect) {
  ok('sabotage: ' + name, () => {
    const g = clone();
    const before = JSON.stringify(g);
    mutate(g);
    assert.notEqual(JSON.stringify(g), before, 'mutation applied');
    const errors = check(g, SOFT);
    assert.ok(errors.some((e) => expect.test(e)), `expected ${expect}, got ${JSON.stringify(errors.slice(0, 3))}`);
  });
}

sabotage('a term with its quotes removed', (g) => {
  const p = g.programs[gapIdx];
  p.evidence = p.evidence.filter((e) => e.field !== 'rate');
}, /rate is stated with no quoted source/);

sabotage('a null term with no reason', (g) => {
  const p = g.programs.find((x) => x.unverified.some((u) => QUOTED_TERMS.includes(u.field)) && QUOTED_TERMS.some((f) => x[f] == null));
  const f = QUOTED_TERMS.find((k) => p[k] == null);
  p.unverified = p.unverified.filter((u) => u.field !== f);
}, /is null with no reason/);

sabotage('a quote citing a page missing from the source list', (g) => {
  g.programs[gapIdx].evidence[0].url = 'https://example.org/not-listed';
}, /not in the source list/);

sabotage('a guide cap that disagrees with soft-funding-status.json', (g) => {
  const p = g.programs[gapIdx];
  p.award_size = p.award_size.replace('$6,000,000', '$7,000,000');
}, /max_amount 6000000 does not appear/);

sabotage('a guide rate that disagrees with soft-funding-status.json', (g) => {
  const p = g.programs[gapIdx];
  p.rate = p.rate.replace('2.5%', '3.5%');
}, /rate 2.5% does not appear/);

sabotage('a status the renderer cannot label', (g) => {
  g.programs[gapIdx].status = 'paused';
}, /status paused has no label/);

sabotage('an insecure official link', (g) => {
  g.programs[gapIdx].official_url = 'http://coloradoaffordablehousingfinancingfund.com/';
}, /official_url is not https/);

sabotage('a stale review date', (g) => {
  g.meta.review_by = '2028-01-01';
}, /review_by must fall within 120 days/);

ok('a rewording that keeps the numbers stays green', () => {
  const g = clone();
  const p = g.programs[gapIdx];
  const before = p.award_size;
  p.award_size = 'Loans run from $400,000 up to $6 million, capped at 10% of project cost and 1.05 coverage on must-pay debt.';
  p.rate = 'Fixed at 2.5%, servicing fee included.';
  assert.notEqual(p.award_size, before, 'mutation applied');
  assert.deepEqual(check(g, SOFT), []);
});

console.log(`\nco-developer-funding-guide: ${passed} passed`);
