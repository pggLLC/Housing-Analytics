#!/usr/bin/env node
/**
 * verify-opportunity-finder.mjs — QA/QC harness for the LIHTC Opportunity Finder.
 *
 * Codex handoff target. Run this to verify the programming behind the
 * jurisdiction-level rollup that powers `lihtc-opportunity-finder.html`
 * and `js/lihtc-opportunity-finder.js`. The script independently re-implements
 * the rollup math in Node so it can detect regressions in:
 *
 *   1. Data file integrity (all 10 source files load + have expected shape)
 *   2. QCT tract count (HUD 2025 publication)
 *   3. DDA county FIPS count (HUD 2025 publication — CO has 10 nonmetro)
 *   4. LIHTC project geometry filtering (drop YR_PIS=8888 placeholders)
 *   5. Place-tract membership rollup (TIGER 2024)
 *   6. Place→county containment (every place has a 5-digit county FIPS)
 *   7. Score weight invariants (each target's weights sum to 1.0)
 *   8. Composite score range (every output in [0, 100])
 *   9. Civic-capacity data joins (policy scorecard + local-resources + prop123)
 *  10. Known-case spot checks (Sugar City, Cortez, Crowley, Montezuma)
 *  11. Default-filter result count (QCT+DDA, no CDPs, 9% target → 5 jurisdictions)
 *
 * USAGE
 *   node scripts/audit/verify-opportunity-finder.mjs
 *   node scripts/audit/verify-opportunity-finder.mjs --verbose
 *   node scripts/audit/verify-opportunity-finder.mjs --json
 *
 * EXIT CODES
 *   0  — every check passed
 *   1  — at least one check failed (regression)
 *   2  — internal script error (e.g. a configured file is missing)
 *
 * RELATED
 *   - js/lihtc-opportunity-finder.js   — the production rollup module
 *   - lihtc-opportunity-finder.html    — the UI consumer
 *   - test/qa-recent-changes.js        — broader QA harness (smoke / urls / schema)
 *   - docs/audits/                     — methodology audit docs
 *
 * Updated 2026-05-25. Bump expectations only after intentional data-vintage
 * advances (e.g. HUD's 2026 QCT list publishes — adjust QCT count expectation).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');
const ARGV      = new Set(process.argv.slice(2));
const VERBOSE   = ARGV.has('--verbose');
const JSON_OUT  = ARGV.has('--json');

const CURRENT_YEAR = 2026;

/* ── Score weights — must match js/lihtc-opportunity-finder.js ────── */
const SCORE_WEIGHTS = {
  '9pct': { recency: 0.40, need: 0.30, basis: 0.20, pop: 0.10 },
  '4pct': { recency: 0.25, need: 0.25, basis: 0.15, pop: 0.35 },
  'any':  { recency: 0.35, need: 0.30, basis: 0.20, pop: 0.15 }
};

/* ── Pretty printing ──────────────────────────────────────────────── */

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};
function pass(msg, detail) {
  if (JSON_OUT) return { status: 'pass', msg, detail };
  console.log(`  ${C.green}✓${C.reset} ${msg}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  return { status: 'pass', msg, detail };
}
function fail(msg, detail) {
  if (JSON_OUT) return { status: 'fail', msg, detail };
  console.log(`  ${C.red}✗${C.reset} ${msg}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  return { status: 'fail', msg, detail };
}
function info(msg) {
  if (!VERBOSE || JSON_OUT) return;
  console.log(`    ${C.dim}${msg}${C.reset}`);
}
function header(name) {
  if (JSON_OUT) return;
  console.log(`\n${C.bold}${C.cyan}━━ ${name} ━━${C.reset}`);
}

/* ── Loader helpers ───────────────────────────────────────────────── */

async function loadJson(rel) {
  try {
    const buf = await fs.readFile(path.join(ROOT, rel), 'utf-8');
    return JSON.parse(buf);
  } catch (e) {
    throw new Error(`Cannot load ${rel}: ${e.message}`);
  }
}

async function loadFirstJson(rels) {
  const errors = [];
  for (const rel of rels) {
    try {
      return await loadJson(rel);
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error(`Cannot load any LIHTC source: ${errors.join(' | ')}`);
}

/* ── Rollup math (mirror of js/lihtc-opportunity-finder.js) ───────── */

function placeNameToCity(label) {
  if (!label) return '';
  return label.replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function recencyScore(lastYear) {
  if (lastYear == null) return 100;
  const years = Math.max(0, CURRENT_YEAR - lastYear);
  return Math.min(100, Math.round((years / 25) * 100));
}

function buildNeedDistribution(chasByFips) {
  const dist = [];
  Object.keys(chasByFips).forEach(fips => {
    const s = chasByFips[fips].summary || {};
    const renterHH = +s.total_renter_hh || 0;
    const ownerHH  = +s.total_owner_hh  || 0;
    const total = renterHH + ownerHH;
    if (!total || s.pct_renter_cb30 == null || s.pct_owner_cb30 == null) return;
    const blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
    const severe = +s.pct_renter_cb50 || 0;
    dist.push(blended * 0.7 + severe * 0.3);
  });
  dist.sort((a, b) => a - b);
  return dist;
}

function needCompositeFor(chasByFips, fips) {
  const rec = chasByFips[fips];
  if (!rec || !rec.summary) return null;
  const s = rec.summary;
  const renterHH = +s.total_renter_hh || 0;
  const ownerHH  = +s.total_owner_hh  || 0;
  const total = renterHH + ownerHH;
  if (!total) return null;
  const blended = (s.pct_renter_cb30 * renterHH + s.pct_owner_cb30 * ownerHH) / total;
  const severe = +s.pct_renter_cb50 || 0;
  return blended * 0.7 + severe * 0.3;
}

function needScoreFor(chasByFips, fips, dist) {
  const comp = needCompositeFor(chasByFips, fips);
  if (comp == null) return 30;
  let below = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < comp) below++;
    else if (dist[i] === comp) below += 0.5;
  }
  return Math.round((below / dist.length) * 100);
}

function basisBoostScore(isQct, isDda) {
  if (isQct && isDda) return 100;
  if (isQct || isDda) return 60;
  return 0;
}

function populationScore(pop) {
  if (pop == null || !Number.isFinite(+pop)) return 0;
  const n = +pop;
  if (n < 500) return 0;
  if (n < 2000) return 30;
  if (n < 5000) return 60;
  if (n < 15000) return 85;
  return 100;
}

function composite(rec, need, basis, pop, target) {
  const w = SCORE_WEIGHTS[target] || SCORE_WEIGHTS.any;
  return Math.round(rec * w.recency + need * w.need + basis * w.basis + pop * w.pop);
}

/* ── Main rollup ──────────────────────────────────────────────────── */

async function buildOpportunities() {
  const [
    qct, dda, lihtc, chas, pm, amiGap, gc,
    scorecard, localRes, prop123
  ] = await Promise.all([
    loadJson('data/qct-colorado.json'),
    loadJson('data/dda-colorado.json'),
    loadFirstJson(['data/chfa-lihtc.json', 'data/market/hud_lihtc_co.geojson']),
    loadJson('data/hna/chas_affordability_gap.json'),
    loadJson('data/hna/place-tract-membership.json'),
    loadJson('data/co_ami_gap_by_place.json'),
    loadJson('data/hna/geo-config.json'),
    loadJson('data/policy/housing-policy-scorecard.json').catch(() => null),
    loadJson('data/hna/local-resources.json').catch(() => null),
    loadJson('data/policy/prop123_jurisdictions.json').catch(() => null)
  ]);

  const qctIds = new Set();
  (qct.features || []).forEach(f => {
    const g = f.properties?.GEOID;
    if (g) qctIds.add(g);
  });

  const ddaFips = new Set();
  (dda.features || []).forEach(f => {
    const g = f.properties?.GEOID;
    if (g && g.length === 5) ddaFips.add(g);
  });

  const projects = (lihtc.features || []).filter(f => {
    const y = parseInt(f.properties?.YR_PIS, 10);
    return Number.isFinite(y) && y >= 1980 && y <= 2030;
  });

  const projectsByCity = {};
  projects.forEach(p => {
    const c = (p.properties?.PROJ_CTY || '').toUpperCase().trim();
    if (!c) return;
    (projectsByCity[c] = projectsByCity[c] || []).push(p);
  });

  const placeMeta = {};
  [].concat(gc.featured || [], gc.places || [], gc.cdps || []).forEach(p => {
    if (!p.geoid) return;
    const labelLower = (p.label || '').toLowerCase();
    let type = 'place';
    if (labelLower.includes('cdp')) type = 'cdp';
    else if (labelLower.includes('city')) type = 'city';
    else if (labelLower.includes('town')) type = 'town';
    else if (p.type) type = p.type;
    placeMeta[p.geoid] = { label: p.label, containingCounty: p.containingCounty, type };
  });

  const countyName = {};
  (gc.counties || []).forEach(c => { countyName[c.geoid] = c.label; });

  const chasByFips = chas.counties || {};
  const needDist = buildNeedDistribution(chasByFips);

  const policyScores = (scorecard && scorecard.scores) || {};
  const lr = localRes || {};
  const p123ByName = {};
  if (prop123 && Array.isArray(prop123.jurisdictions)) {
    prop123.jurisdictions.forEach(j => {
      const key = (j.name || '').toUpperCase()
        .replace(/^CITY AND COUNTY OF\s+/, '')
        .replace(/^TOWN OF\s+/, '')
        .replace(/^CITY OF\s+/, '')
        .replace(/\s+COUNTY$/, '')
        .trim();
      if (key) p123ByName[key] = j;
    });
  }

  const ops = [];
  Object.keys(pm.places || {}).forEach(geoid => {
    const membership = pm.places[geoid];
    const meta = placeMeta[geoid] || {};
    const label = membership.name || meta.label || geoid;
    let containingCounty = meta.containingCounty;
    if (!containingCounty) {
      const t = (membership.tracts || [])[0];
      if (t?.tract_geoid) containingCounty = t.tract_geoid.substring(0, 5);
    }
    const type = meta.type || ((label || '').toLowerCase().includes('cdp') ? 'cdp' : 'place');

    const qctTracts = (membership.tracts || []).filter(t => {
      if (!qctIds.has(t.tract_geoid)) return false;
      const sp = +t.share_of_place_area || 0;
      const st = +t.share_of_tract_area || 0;
      return sp > 0.05 || st > 0.20;
    });
    const hasQct = qctTracts.length > 0;
    const hasDda = containingCounty && ddaFips.has(containingCounty);
    // Note: do not pre-filter to basis-eligible (production code allows the
    // user to opt into all 482 jurisdictions via the 'no requirement' basis
    // option). Harness still asserts the basis-eligible counts below.

    const cityLookup = placeNameToCity(label).toUpperCase();
    const inside = projectsByCity[cityLookup] || [];
    let lastYear = -Infinity;
    inside.forEach(p => {
      const y = parseInt(p.properties.YR_PIS, 10);
      if (Number.isFinite(y) && y > lastYear) lastYear = y;
    });
    if (lastYear === -Infinity) lastYear = null;
    const totalUnits = inside.reduce((s, p) => s + (+p.properties.N_UNITS || 0), 0);

    const amiRec = (amiGap.places || {})[geoid];
    let pop = null;
    if (amiRec?.households_le_ami_pct?.['100']) {
      pop = Math.round((+amiRec.households_le_ami_pct['100'] || 0) * 2.5);
    }

    const recScore = recencyScore(lastYear);
    const needPct = needScoreFor(chasByFips, containingCounty, needDist);
    const bbScore = basisBoostScore(hasQct, hasDda);
    const popScore = populationScore(pop);

    const civic = policyScores[geoid] || (containingCounty ? policyScores[containingCounty] : null);
    const localResRec = lr['place:' + geoid] || lr['cdp:' + geoid] ||
                        (containingCounty ? lr['county:' + containingCounty] : null);
    const p123Detail = p123ByName[placeNameToCity(label).toUpperCase()] || null;

    const civicRawScore = civic && Number.isFinite(civic.totalScore) ? civic.totalScore : null;
    const civicMax = civic && Number.isFinite(civic.maxPossible) && civic.maxPossible > 0
      ? civic.maxPossible
      : 7;
    const civicPct = civicRawScore != null ? Math.round((civicRawScore / civicMax) * 100) : null;

    ops.push({
      geoid, name: placeNameToCity(label), type,
      countyFips: containingCounty,
      countyName: countyName[containingCounty] || '—',
      hasQct, hasDda, hasBoth: hasQct && hasDda,
      qctCount: qctTracts.length,
      projectCount: inside.length, totalUnits, lastYear,
      yearsSince: lastYear != null ? CURRENT_YEAR - lastYear : null,
      population: pop,
      recencyScore: recScore, needScore: needPct,
      basisBoostScore: bbScore, populationScore: popScore,
      score9:   composite(recScore, needPct, bbScore, popScore, '9pct'),
      score4:   composite(recScore, needPct, bbScore, popScore, '4pct'),
      scoreAny: composite(recScore, needPct, bbScore, popScore, 'any'),
      civic, localRes: localResRec, prop123Detail: p123Detail,
      civicScore: civicPct, civicRawScore, civicMax
    });
  });

  return {
    ops, qctIds, ddaFips, projects, chasByFips, placeMeta, countyName,
    policyScores, localRes: lr, p123ByName
  };
}

/* ── Tests ────────────────────────────────────────────────────────── */

async function main() {
  const results = [];
  let failures = 0;

  if (!JSON_OUT) {
    console.log(`${C.bold}LIHTC Opportunity Finder — verification harness${C.reset}`);
    console.log(`${C.dim}data root: ${ROOT}${C.reset}`);
    console.log(`${C.dim}current year: ${CURRENT_YEAR}${C.reset}`);
  }

  let rollup;
  try {
    rollup = await buildOpportunities();
  } catch (e) {
    fail('Rollup build threw', e.message);
    process.exit(2);
  }

  const { ops, qctIds, ddaFips, projects, placeMeta, policyScores, localRes, p123ByName } = rollup;

  /* ── 1. Data integrity ───────────────────────────────────────────── */
  header('Data integrity');
  const dataChecks = [
    { name: 'QCT tract count',        actual: qctIds.size,    min: 200, max: 260, note: 'HUD 2025: 224 expected' },
    { name: 'DDA county-FIPS count',  actual: ddaFips.size,   min: 8,   max: 15,  note: 'HUD 2025: 10 nonmetro CO counties' },
    { name: 'LIHTC project count',    actual: projects.length, min: 500, max: 1000, note: 'CHFA/HUD LIHTC, ~702 valid YR_PIS' },
    { name: 'Place-meta entries',     actual: Object.keys(placeMeta).length, min: 400, max: 600, note: 'CO geo-config' },
    { name: 'Policy-scorecard entries', actual: Object.keys(policyScores).length, min: 500, max: 600, note: '~547 expected (counties + places + CDPs)' },
    { name: 'Local-resources entries', actual: Object.keys(localRes).length, min: 50, max: 1000, note: 'sparse — 64 counties + sample places' },
    { name: 'Prop 123 commitments',   actual: Object.keys(p123ByName).length, min: 150, max: 250, note: '~217 jurisdictions' }
  ];
  dataChecks.forEach(c => {
    const ok = c.actual >= c.min && c.actual <= c.max;
    const r = ok ? pass(c.name, `${c.actual} (${c.note})`) : fail(c.name, `${c.actual} out of [${c.min}, ${c.max}] — ${c.note}`);
    results.push(r);
    if (!ok) failures++;
  });

  /* ── 2. Rollup invariants ────────────────────────────────────────── */
  header('Rollup invariants');
  const both = ops.filter(o => o.hasBoth).length;
  const qctOnly = ops.filter(o => o.hasQct && !o.hasDda).length;
  const ddaOnly = ops.filter(o => o.hasDda && !o.hasQct).length;
  const eligible = ops.filter(o => o.hasQct || o.hasDda).length;
  const never = ops.filter(o => o.lastYear == null).length;

  const inv = [
    { name: 'Total places scored',       actual: ops.length, min: 450, max: 510, note: '~482 expected (all CO places in TIGER place-tract-membership)' },
    { name: 'Basis-boost-eligible (QCT or DDA)', actual: eligible, min: 130, max: 200, note: '158 expected' },
    { name: 'QCT + DDA (both)',          actual: both,       min: 4,   max: 12,  note: '6 expected' },
    { name: 'QCT only',                  actual: qctOnly,    min: 70,  max: 110, note: '92 expected' },
    { name: 'DDA only',                  actual: ddaOnly,    min: 45,  max: 80,  note: '60 expected' },
    { name: 'Never-funded jurisdictions (within basis-eligible)', actual: ops.filter(o => (o.hasQct || o.hasDda) && o.lastYear == null).length, min: 80, max: 130, note: '105 expected' }
  ];
  inv.forEach(c => {
    const ok = c.actual >= c.min && c.actual <= c.max;
    const r = ok ? pass(c.name, `${c.actual} (${c.note})`) : fail(c.name, `${c.actual} out of [${c.min}, ${c.max}] — ${c.note}`);
    results.push(r);
    if (!ok) failures++;
  });

  /* ── 3. Weight invariants ────────────────────────────────────────── */
  header('Score weight invariants');
  Object.entries(SCORE_WEIGHTS).forEach(([target, w]) => {
    const sum = w.recency + w.need + w.basis + w.pop;
    const ok = Math.abs(sum - 1) < 1e-9;
    const r = ok ? pass(`weights[${target}] sum to 1.0`, `${sum.toFixed(4)}`)
                 : fail(`weights[${target}] sum != 1.0`, `${sum.toFixed(4)}`);
    results.push(r); if (!ok) failures++;
  });

  /* ── 4. Score range invariants ───────────────────────────────────── */
  header('Score range invariants');
  const ranges = [
    { k: 'score9', name: '9% Competitive' },
    { k: 'score4', name: '4% Bond' },
    { k: 'scoreAny', name: 'Balanced' }
  ];
  ranges.forEach(({ k, name }) => {
    const out = ops.filter(o => o[k] < 0 || o[k] > 100);
    const r = out.length === 0
      ? pass(`${name} scores ∈ [0, 100]`, `n=${ops.length}`)
      : fail(`${name} scores out of range`, `${out.length} bad — sample: ${out.slice(0, 3).map(x => x.name + '=' + x[k]).join(', ')}`);
    results.push(r); if (out.length) failures++;
  });
  const civicOut = ops.filter(o => o.civicScore != null && (o.civicScore < 0 || o.civicScore > 100));
  results.push(civicOut.length === 0
    ? pass('Civic scores ∈ [0, 100]', `n=${ops.filter(o => o.civicScore != null).length}`)
    : (failures++, fail('Civic scores out of range', `${civicOut.length} bad — sample: ${civicOut.slice(0, 3).map(x => x.name + '=' + x.civicScore).join(', ')}`)));

  /* ── 5. Place → county containment ───────────────────────────────── */
  header('Place→county containment');
  const noCounty = ops.filter(o => !o.countyFips || !/^\d{5}$/.test(o.countyFips));
  results.push(noCounty.length === 0
    ? pass('Every opportunity has a 5-digit county FIPS', `n=${ops.length}`)
    : (failures++, fail('Missing containingCounty', `${noCounty.length} ops without county — sample: ${noCounty.slice(0, 3).map(x => x.name).join(', ')}`)));

  /* ── 6. Default-filter result count ──────────────────────────────── */
  header('Default-filter results (requireBoth=true, includeCdps=false, 9pct)');
  const defaultView = ops
    .filter(o => o.hasBoth)
    .filter(o => o.type !== 'cdp');
  const defaultExpectedCount = 5;
  results.push(defaultView.length === defaultExpectedCount
    ? pass(`Default view = ${defaultExpectedCount} jurisdictions`, defaultView.map(x => x.name).join(', '))
    : (failures++, fail(`Default view count`, `Got ${defaultView.length}, expected ${defaultExpectedCount} (${defaultView.map(x => x.name).join(', ')})`)));

  /* ── 7. Known-case spot checks ────────────────────────────────────── */
  header('Known-case spot checks');
  const cases = [
    { name: 'Sugar City',  county: '08025', expects: { hasBoth: true,  type: 'city', lastYear: null } },
    { name: 'Crowley',     county: '08025', expects: { hasBoth: true,  type: 'town', lastYear: null } },
    { name: 'Olney Springs', county: '08025', expects: { hasBoth: true, type: 'town', lastYear: null } },
    { name: 'Ordway',      county: '08025', expects: { hasBoth: true,  type: 'town', lastYear: null } },
    { name: 'Montezuma',   county: '08117', expects: { hasBoth: true,  type: 'town', lastYear: null } },
    { name: 'Cortez',      county: '08083', expects: { hasQct: true,   type: 'city' } }
  ];
  cases.forEach(c => {
    const o = ops.find(x => x.name === c.name && x.countyFips === c.county);
    if (!o) {
      results.push(fail(`Case "${c.name}"`, `Not found in opportunities (county ${c.county})`));
      failures++;
      return;
    }
    let allOk = true;
    const mismatches = [];
    for (const [k, v] of Object.entries(c.expects)) {
      if (o[k] !== v) { allOk = false; mismatches.push(`${k}: got ${o[k]} want ${v}`); }
    }
    if (allOk) {
      info(`  ${c.name} → ${c.county} · score9=${o.score9} · score4=${o.score4} · civic=${o.civicScore}/100 (${o.civicRawScore}/${o.civicMax})`);
      results.push(pass(`Case "${c.name}"`, `9%=${o.score9} 4%=${o.score4} civic=${o.civicScore ?? '—'}/100`));
    } else {
      results.push(fail(`Case "${c.name}"`, mismatches.join(' | ')));
      failures++;
    }
  });

  /* ── 8. Civic-capacity join coverage ─────────────────────────────── */
  header('Civic-capacity joins');
  const withCivic   = ops.filter(o => o.civicScore != null).length;
  const withLocalRes = ops.filter(o => o.localRes != null).length;
  const civicCov = (withCivic / ops.length) * 100;
  const lrCov    = (withLocalRes / ops.length) * 100;
  results.push(civicCov >= 70
    ? pass('Civic policy-score coverage', `${withCivic}/${ops.length} = ${civicCov.toFixed(0)}%`)
    : (failures++, fail('Civic policy-score coverage low', `${civicCov.toFixed(0)}% — expected ≥70%`)));
  results.push(lrCov >= 60
    ? pass('Local-resources coverage', `${withLocalRes}/${ops.length} = ${lrCov.toFixed(0)}%`)
    : (failures++, fail('Local-resources coverage low', `${lrCov.toFixed(0)}% — expected ≥60%`)));

  /* ── Output ───────────────────────────────────────────────────────── */
  if (JSON_OUT) {
    console.log(JSON.stringify({
      summary: {
        total: results.length,
        passed: results.length - failures,
        failed: failures,
        defaultView: defaultView.map(o => ({ name: o.name, county: o.countyName, score9: o.score9, score4: o.score4 }))
      },
      results
    }, null, 2));
  } else {
    console.log('');
    if (failures === 0) {
      console.log(`${C.bold}${C.green}━━ ALL ${results.length} CHECKS PASSED ━━${C.reset}`);
      console.log(`${C.dim}Default filter view (QCT+DDA, no CDPs, 9% target):${C.reset}`);
      defaultView.forEach(o => {
        console.log(`  • ${o.name} (${o.type}, ${o.countyName}) — 9%·${o.score9} 4%·${o.score4} civic=${o.civicScore ?? '—'}/100`);
      });
    } else {
      console.log(`${C.bold}${C.red}━━ ${failures} OF ${results.length} CHECKS FAILED ━━${C.reset}`);
      console.log(`${C.dim}Run with --verbose for more detail, --json for machine-readable output.${C.reset}`);
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(`${C.red}Internal error:${C.reset} ${e.stack || e.message}`);
  process.exit(2);
});
