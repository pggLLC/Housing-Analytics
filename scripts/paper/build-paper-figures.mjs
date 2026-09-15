#!/usr/bin/env node
/**
 * Measure the repository, and emit every figure the working paper cites.
 *
 * The paper argues that a data system earns trust by refusing to publish what
 * it cannot support. A paper about that system whose own numbers were typed in
 * by hand would contradict itself the first time the data moved — and it did:
 * an earlier draft reported 498 test files because the counting glob matched
 * every *.test.js twice. The true number was 267. That is the whole reason this
 * file exists.
 *
 * So: no figure in working-paper.html is authored. Each one is written by
 * scripts/paper/inject-paper-figures.mjs from what this emits, and
 * test/paper-figures-fresh.test.js fails CI if the published page and the
 * repository ever disagree.
 *
 * ABSENCE DISCIPLINE (AGENTS.md): a figure that cannot be read is emitted as
 * null with a stated reason, recorded in `unavailable`. Never 0. `Number(null)`
 * is 0 and 0 is finite, so a coerced zero passes every downstream check and
 * renders as a real measurement — which in a paper is a false claim about
 * Colorado, not merely a wrong pixel.
 *
 *   node scripts/paper/build-paper-figures.mjs            # write data/paper/figures.json
 *   node scripts/paper/build-paper-figures.mjs --stdout   # print, write nothing
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'paper', 'figures.json');
const R = (p) => path.join(ROOT, p);

/** The worked example. Palisade is the paper's case study throughout §03. */
const CASE_GEOID = '0856970';

/* ── absence-aware accumulator ───────────────────────────────────────────── */

const unavailable = [];
/** Record a figure that could not be read. Returns null so callers can assign. */
function absent(key, reason) {
  unavailable.push({ key, reason });
  return null;
}

function readJson(rel) {
  const p = R(rel);
  if (!existsSync(p)) return { ok: false, reason: `${rel} is not present` };
  try {
    return { ok: true, data: JSON.parse(readFileSync(p, 'utf8')) };
  } catch (e) {
    return { ok: false, reason: `${rel} did not parse: ${e.message}` };
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Count files under `dir` matching `test`, recursively.
 *
 * Deliberately NOT a shell glob. The 498-vs-267 error came from a glob whose
 * two patterns both matched *.test.js, double-counting every one of them. A set
 * of resolved paths cannot double-count.
 */
function countFiles(dir, test, { skip = [] } = {}) {
  const base = R(dir);
  if (!existsSync(base)) return null;
  const seen = new Set();
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (skip.includes(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (test(e.name, full)) seen.add(path.resolve(full));
    }
  };
  walk(base);
  return seen.size;
}

/** Tracked files only — untracked scratch must never inflate a published count. */
function trackedMatching(re) {
  const out = git(['ls-files']);
  if (out == null) return null;
  return out.split('\n').filter((f) => f && re.test(f)).length;
}

/* ── 1. emergence ────────────────────────────────────────────────────────── */

function emergence() {
  // origin/main where it exists, else HEAD: a fresh clone in CI may have no
  // remote-tracking ref, and silently counting a feature branch's commits would
  // publish a number that is not the project's.
  const ref = git(['rev-parse', '--verify', '--quiet', 'origin/main']) ? 'origin/main' : 'HEAD';
  const dates = git(['log', '--format=%cs', ref]);
  if (!dates) {
    return {
      ref: null,
      first_commit: absent('repo.first_commit', 'git log produced no output'),
      last_commit: absent('repo.last_commit', 'git log produced no output'),
      total_commits: absent('repo.total_commits', 'git log produced no output'),
      commits_by_month: absent('repo.commits_by_month', 'git log produced no output'),
    };
  }
  const list = dates.split('\n').filter(Boolean);
  const byMonth = new Map();
  for (const d of list) {
    const m = d.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, commits]) => ({ month, commits }));
  const peak = months.reduce((mx, m) => Math.max(mx, m.commits), 0);
  return {
    ref,
    first_commit: list[list.length - 1] || null,
    last_commit: list[0] || null,
    total_commits: list.length,
    // The final month is partial; saying so is the difference between a
    // measurement and a trend that appears to be collapsing.
    partial_month: months.length ? months[months.length - 1].month : null,
    commits_by_month: months.map((m) => ({
      ...m,
      pct_of_peak: peak ? Number(((m.commits / peak) * 100).toFixed(1)) : null,
    })),
  };
}

/* ── 2. inventory ────────────────────────────────────────────────────────── */

/**
 * Read the repository's own inventory declaration out of AGENTS.md.
 *
 * scripts/compute-inventory.mjs already counts HTML pages, workflows, scripts,
 * docs, data files, geographies and LIHTC features, and ci-checks fails when
 * that line goes stale. Recomputing them here would make this file a SECOND
 * producer of the same numbers with its own counting rules — and it did: an
 * earlier version reported 239 build scripts and 1,622 data files against the
 * canonical 256 and 1,651, because it filtered by extension and the canonical
 * script does not. Two producers of one number is how this repository once
 * published Denver's overcrowding as both 51.2% and 2.9% on the same day.
 *
 * So the paper defers. A figure it cannot parse from the canonical line is
 * null with a reason, never a recount.
 */
function canonicalInventory() {
  const p = R('AGENTS.md');
  if (!existsSync(p)) return { ok: false, reason: 'AGENTS.md is not present' };
  const line = readFileSync(p, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('Inventory (derived'));
  if (!line) {
    return { ok: false, reason: 'AGENTS.md has no line starting "Inventory (derived"' };
  }
  const nums = [...line.matchAll(/\*\*([\d,]+)\*\*/g)].map((m) => Number(m[1].replace(/,/g, '')));
  // The line's shape is fixed by scripts/compute-inventory.mjs. If it changes,
  // the positions below stop meaning what they say, so the count is asserted.
  if (nums.length !== 14) {
    return { ok: false, reason: `AGENTS.md inventory line has ${nums.length} figures, expected 14 — its shape changed` };
  }
  const [topLevelHtml, totalHtml, workflows, clientJs, clientJsNonVendor,
    scripts, docs, dataFiles, geoConfigRows, geographies, counties, places, cdps,
    lihtcFeatures] = nums;
  return {
    ok: true,
    data: {
      html_pages_toplevel: topLevelHtml,
      html_pages_total: totalHtml,
      workflows,
      client_js: clientJs,
      client_js_non_vendor: clientJsNonVendor,
      scripts,
      docs,
      data_files: dataFiles,
      geo_config_rows: geoConfigRows,
      geographies,
      counties,
      incorporated_places: places,
      cdps,
      lihtc_features: lihtcFeatures,
    },
  };
}

function inventory() {
  const chas = readJson('data/hna/place-chas.json');
  const inv = {};

  // Geographies, counted from the generated data rather than asserted.
  if (chas.ok && chas.data.places) {
    const ids = Object.keys(chas.data.places);
    inv.places_with_chas = ids.length;
  } else {
    inv.places_with_chas = absent('inventory.places_with_chas', chas.reason || 'no places key');
  }

  // Everything the canonical inventory already declares comes from there, not
  // from a second count taken here.
  const canon = canonicalInventory();
  const CANON_KEYS = ['html_pages_toplevel', 'html_pages_total', 'workflows', 'scripts',
    'docs', 'data_files', 'geographies', 'counties', 'incorporated_places', 'cdps'];
  for (const k of CANON_KEYS) {
    inv[k] = canon.ok && canon.data[k] != null
      ? canon.data[k]
      : absent(`inventory.${k}`, canon.reason || `AGENTS.md inventory line has no ${k}`);
  }

  // Only figures the canonical line does NOT carry are counted here.
  inv.place_pages = trackedMatching(/^places\/[^/]+\.html$/)
    ?? absent('inventory.place_pages', 'git ls-files is unavailable');


  // Workflows and their schedules.
  const wfDir = R('.github/workflows');
  if (existsSync(wfDir)) {
    const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
    let scheduled = 0;
    for (const f of files) {
      const src = readFileSync(path.join(wfDir, f), 'utf8');
      // Strip comments first: several workflows discuss cron in prose, and a
      // commented-out schedule is not a schedule.
      const live = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
      if (/^\s*-\s*cron:/m.test(live)) scheduled += 1;
    }
    inv.scheduled_workflows = scheduled;
  } else {
    inv.scheduled_workflows = absent('inventory.scheduled_workflows', '.github/workflows is not present');
  }

  // Test files. One resolved-path set, never a glob — see countFiles.
  const testCount = countFiles('test', (n) => /\.(test|spec)\.(js|mjs|cjs)$/.test(n));
  const pyTestCount = countFiles('tests', (n) => /^test_.*\.py$/.test(n));
  inv.test_files = (testCount == null && pyTestCount == null)
    ? absent('inventory.test_files', 'neither test/ nor tests/ is present')
    : (testCount || 0) + (pyTestCount || 0);

  // Tests that exist specifically to stop the system asserting an unknown as a
  // zero. The paper's central claim rests on this number, so how it is counted
  // matters more than the number itself.
  //
  // It counts a file only when an assertion's own NAME declares absence as its
  // subject. An earlier version scanned whole file bodies for /null/ plus any
  // absence word and returned 95 — it was matching caching.test.js and
  // analytics.test.js, which merely mention a missing key in passing. Measuring
  // declared intent rather than incidental vocabulary is the difference between
  // a figure and a coincidence.
  const ABSENCE_SUBJECT = /(never\s+(0|zero)|not\s+(0|zero)\b|rather\s+than\s+(0|zero)|instead\s+of\s+(0|zero)|coerc\w*|\bnull\b|unknown|absen\w*|unmeasur\w*|missing|unavailable|no\s+data|not\s+published)/i;
  const TEST_NAME = /\b(?:test|it|describe)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

  inv.absence_tests = (() => {
    const base = R('test');
    if (!existsSync(base)) return absent('inventory.absence_tests', 'test/ is not present');
    const matched = new Set();
    let cases = 0;
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(test|spec)\.(js|mjs|cjs)$/.test(e.name)) continue;
        const src = readFileSync(full, 'utf8');
        let m;
        TEST_NAME.lastIndex = 0;
        while ((m = TEST_NAME.exec(src)) !== null) {
          if (ABSENCE_SUBJECT.test(m[2])) {
            matched.add(path.resolve(full));
            cases += 1;
          }
        }
      }
    };
    walk(base);
    inv.absence_test_cases = cases;
    return matched.size;
  })();

  inv.lihtc_features = canon.ok && canon.data.lihtc_features != null
    ? canon.data.lihtc_features
    : absent('inventory.lihtc_features', canon.reason || 'AGENTS.md inventory line has no LIHTC figure');

  return inv;
}

/* ── 3. the worked example ───────────────────────────────────────────────── */

const BANDS = [
  ['lte30', '≤30% AMI'],
  ['31to50', '31–50%'],
  ['51to80', '51–80%'],
  ['81to100', '81–100%'],
  ['100plus', '>100%'],
];

/** CHAS counts are apportioned and land on fractions; the paper shows households. */
const hh = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

function caseStudy() {
  const chas = readJson('data/hna/place-chas.json');
  if (!chas.ok || !chas.data.places || !chas.data.places[CASE_GEOID]) {
    return {
      geoid: CASE_GEOID,
      name: absent('case.name', chas.reason || `place ${CASE_GEOID} is not in place-chas.json`),
    };
  }
  const p = chas.data.places[CASE_GEOID];
  const s = p.summary || {};

  // Schema guard. The first version of this file spelled the top band `gt100`
  // when place-chas.json calls it `100plus`. Every cell in that row came back
  // undefined, rendered as "n/a", and the build still reported "every figure
  // resolved" — the page asserted an absence that the data did not support,
  // which is the same error as a coerced zero pointing the other way. A band
  // key that is not in the data is a bug in this file, so say so and stop.
  const present = new Set(Object.keys(p.renter_hh_by_ami || {}));
  const unknownKeys = BANDS.map(([k]) => k).filter((k) => !present.has(k));
  if (unknownKeys.length) {
    throw new Error(
      `place-chas AMI band keys have changed: ${unknownKeys.join(', ')} not found. `
      + `Data has: ${[...present].join(', ')}. Update BANDS in this file — do not let `
      + 'the missing rows render as absences.',
    );
  }

  const bands = BANDS.map(([key, label]) => {
    const r = (p.renter_hh_by_ami || {})[key] || {};
    const o = (p.owner_hh_by_ami || {})[key] || {};
    return {
      key,
      label,
      renters: hh(r.total),
      renters_cb30: hh(r.cost_burdened_30pct),
      renters_cb50: hh(r.cost_burdened_50pct),
      owners: hh(o.total),
      owners_cb30: hh(o.cost_burdened_30pct),
      owners_cb50: hh(o.cost_burdened_50pct),
    };
  });

  // Subtotal across the three bands at or below 80% AMI — the population every
  // federal and state affordable programme is actually scoped to.
  const lte80 = bands.filter((b) => ['lte30', '31to50', '51to80'].includes(b.key));
  const sum = (f) => {
    const vals = lte80.map((b) => b[f]);
    return vals.every((v) => v != null) ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const subtotal = {
    renters: sum('renters'),
    renters_cb30: sum('renters_cb30'),
    renters_cb50: sum('renters_cb50'),
    owners: sum('owners'),
    owners_cb30: sum('owners_cb30'),
    owners_cb50: sum('owners_cb50'),
  };

  const totalRenter = hh(s.total_renter_hh);
  const totalOwner = hh(s.total_owner_hh);

  return {
    geoid: CASE_GEOID,
    name: p.name || absent('case.name', 'place record carries no name'),
    source: p.source || null,
    low_confidence: p.low_confidence ?? null,
    coverage_share: p.coverage_share ?? null,
    total_renter_hh: totalRenter,
    total_owner_hh: totalOwner,
    total_hh: (totalRenter != null && totalOwner != null) ? totalRenter + totalOwner : null,
    bands,
    subtotal_lte80: subtotal,
    // The paper's Finding 1: severe burden below 80% AMI is an owner problem.
    // Emitted as a computed ratio so the claim cannot drift from the table.
    severe_ratio_owner_to_renter:
      (subtotal.owners_cb50 != null && subtotal.renters_cb50)
        ? Number((subtotal.owners_cb50 / subtotal.renters_cb50).toFixed(1))
        : absent('case.severe_ratio', 'severe-burden subtotals are not both available'),
  };
}

/* ── 4. tractability screen ──────────────────────────────────────────────── */

/**
 * DECLARED: analyst-constructed, not repository methodology.
 *
 * These cut points were chosen for the paper and have no validation beyond face
 * plausibility. They encode a judgment that one municipal programme can address
 * several hundred households but not several thousand. §06.6 says so in the
 * text, and they live here as named constants so a reader can change them and
 * re-run rather than having to trust them.
 */
const SCREEN = { MIN_HOUSEHOLDS: 400, MIN_BURDEN_SHARE: 0.20, MAX_TARGET: 600 };

function tractability() {
  const chas = readJson('data/hna/place-chas.json');
  if (!chas.ok || !chas.data.places) {
    return { screen: SCREEN, eligible: absent('tractable.eligible', chas.reason || 'no places key') };
  }
  const rows = [];
  let eligible = 0;
  for (const [geoid, p] of Object.entries(chas.data.places)) {
    const r = p.renter_hh_by_ami || {};
    const o = p.owner_hh_by_ami || {};
    const keys = ['lte30', '31to50', '51to80'];
    const burdenedR = keys.reduce((a, k) => a + ((r[k] || {}).cost_burdened_30pct || 0), 0);
    const burdenedO = keys.reduce((a, k) => a + ((o[k] || {}).cost_burdened_30pct || 0), 0);
    const total = (p.summary || {}).total_renter_hh + (p.summary || {}).total_owner_hh;
    if (!Number.isFinite(total) || total < SCREEN.MIN_HOUSEHOLDS) continue;
    if (p.low_confidence) continue;
    eligible += 1;
    const burdened = burdenedR + burdenedO;
    const share = burdened / total;
    if (share < SCREEN.MIN_BURDEN_SHARE) continue;
    if (burdened > SCREEN.MAX_TARGET) continue;
    rows.push({
      geoid,
      name: p.name || geoid,
      households: hh(total),
      burdened_lte80: hh(burdened),
      share_pct: Number((share * 100).toFixed(1)),
      renters_burdened: hh(burdenedR),
      owners_burdened: hh(burdenedO),
      // The operationally decisive column, and the one county data cannot
      // produce: two towns can share a burden share and need opposite programmes.
      // Zero BURDENED RENTERS means the problem is entirely an owner problem,
      // and vice versa. The first version of this had the two labels the wrong
      // way round and published Air Force Academy — 266 burdened renters, 0
      // burdened owners — as "owner only". A jurisdiction reading that column
      // would have built the wrong programme, which is precisely the failure
      // this paper is about. test/paper-figures-fresh.test.js now pins it.
      tenure_profile: burdenedO === 0 ? 'renter only'
        : burdenedR === 0 ? 'owner only'
          : burdenedR >= burdenedO * 2 ? 'renter-dominant'
            : burdenedO >= burdenedR * 2 ? 'owner-dominant'
              : Math.abs(burdenedR - burdenedO) / Math.max(burdenedR, burdenedO) < 0.15 ? 'even split'
                : 'both tenures',
    });
  }
  rows.sort((a, b) => b.share_pct - a.share_pct);
  return {
    screen: SCREEN,
    eligible,
    tractable: rows.length,
    top: rows.slice(0, 9),
  };
}


/* ── build scope, and a declared estimate over it ────────────────────────── */

/**
 * ANALYST-CONSTRUCTED, like the tractability screen in §04 — not a measurement.
 *
 * The SCOPE below is measured. The per-workstream person-weeks are a judgment,
 * they carry no validation beyond face plausibility, and they live here as named
 * constants so a reader can change them and re-run rather than having to trust
 * them.
 *
 * What the estimate IS: what a commissioned team would plausibly bill to build
 * this from a specification. What it is NOT: a claim that this much human effort
 * was expended here. Those are different quantities — a commissioned build
 * carries requirements negotiation, review cycles, sign-off and status reporting
 * that a single maintainer does not — and conflating them would be exactly the
 * unsupported claim this paper argues against.
 */
const BUILD_ESTIMATE_WEEKS = {
  domain_discovery: [8, 16],
  design_system: [4, 6],
  page_design: [10, 16],
  tool_ux: [14, 20],
  accessibility: [3, 5],
  frontend_build: [78, 152],
  data_engineering: [63, 126],
  derived_pipelines: [16, 24],
  analytics_methodology: [12, 20],
  qa_and_test: [30, 50],
  devops_platform: [12, 20],
};
const PM_OVERHEAD = 0.12;          // coordination, reporting, ceremony
const PARALLELISM_LOSS = 0.25;     // a team of seven is not seven times one
const TEAM_SIZE = 7;
const PRODUCTIVE_WEEKS_PER_YEAR = 46;

function buildScope() {
  const tracked = git(['ls-files']);
  if (tracked == null) return { total_lines: absent('scope.total_lines', 'git ls-files unavailable') };
  const list = tracked.split('\n').filter(Boolean);

  const countLines = (re) => {
    let n = 0;
    for (const f of list) {
      if (!re.test(f)) continue;
      try { n += readFileSync(R(f), 'utf8').split('\n').length; } catch { /* unreadable */ }
    }
    return n;
  };

  // Top-level HTML carries heavy shared boilerplate — nav, script tags, head.
  // Counting it as authored work overstates the build, so distinct lines are
  // measured rather than assumed.
  const pages = list.filter((f) => /^[^/]+\.html$/.test(f));
  const seen = new Map();
  let nonBlank = 0;
  for (const f of pages) {
    let src;
    try { src = readFileSync(R(f), 'utf8'); } catch { continue; }
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      nonBlank += 1;
      seen.set(line, (seen.get(line) || 0) + 1);
    }
  }
  let distinct = 0;
  for (const c of seen.values()) if (c === 1) distinct += 1;

  const scope = {
    hand_written_lines: countLines(/^(js|scripts|test|tests|css)\/.*\.(js|mjs|py|css)$/)
      + countLines(/^\.github\/workflows\/.*\.ya?ml$/) + countLines(/^[^/]+\.html$/),
    generated_place_page_lines: countLines(/^places\/[^/]+\.html$/),
    top_level_pages: pages.length,
    html_nonblank_lines: nonBlank,
    html_distinct_lines: distinct,
    html_distinct_share: nonBlank ? Number((distinct / nonBlank).toFixed(3)) : null,
    substantial_tools: pages.filter((f) => {
      try { return readFileSync(R(f), 'utf8').split('\n').length > 600; } catch { return false; }
    }).length,
    declared_data_sources: (() => {
      const f = R('js/data-source-inventory.js');
      if (!existsSync(f)) return absent('scope.declared_data_sources', 'js/data-source-inventory.js is not present');
      const m = readFileSync(f, 'utf8').match(/\bid:\s*['"][\w-]+['"]/g);
      return m ? m.length : absent('scope.declared_data_sources', 'no source ids parsed');
    })(),
  };

  const lo = Object.values(BUILD_ESTIMATE_WEEKS).reduce((a, [x]) => a + x, 0);
  const hi = Object.values(BUILD_ESTIMATE_WEEKS).reduce((a, [, y]) => a + y, 0);
  const loPm = Math.round(lo * (1 + PM_OVERHEAD));
  const hiPm = Math.round(hi * (1 + PM_OVERHEAD));

  scope.estimate = {
    declared: 'analyst-constructed; not repository methodology',
    means: 'what a commissioned team would bill to build this from a specification, '
      + 'NOT the effort expended here',
    workstream_weeks: BUILD_ESTIMATE_WEEKS,
    pm_overhead: PM_OVERHEAD,
    parallelism_loss: PARALLELISM_LOSS,
    team_size: TEAM_SIZE,
    person_weeks_low: loPm,
    person_weeks_high: hiPm,
    person_years_low: Number((loPm / PRODUCTIVE_WEEKS_PER_YEAR).toFixed(1)),
    person_years_high: Number((hiPm / PRODUCTIVE_WEEKS_PER_YEAR).toFixed(1)),
    calendar_months_low: Math.round((loPm / TEAM_SIZE) * (1 + PARALLELISM_LOSS) / 4.33),
    calendar_months_high: Math.round((hiPm / TEAM_SIZE) * (1 + PARALLELISM_LOSS) / 4.33),
  };
  return scope;
}

/* ── emit ────────────────────────────────────────────────────────────────── */

/**
 * Figures that legitimately change on every commit.
 *
 * This repository takes roughly thirty commits a day, so a freshness gate that
 * compared the commit count would fail every pull request and be switched off
 * within a week — and a gate nobody can leave on protects nothing. These paths
 * are refreshed on a weekly cadence and excluded from the per-PR drift check;
 * everything else — every figure about Colorado — is gated strictly.
 *
 * Adding a path here is a decision to stop checking it. Keep the list short,
 * and keep it to figures about the repository rather than about housing.
 */
const VOLATILE = [
  'generated_from_commit',
  'repo.total_commits',
  'repo.last_commit',
  'repo.partial_month',
  'repo.commits_by_month',
];

const figures = {
  generated_from_commit: git(['rev-parse', '--short', 'HEAD']),
  repo: emergence(),
  inventory: inventory(),
  case: caseStudy(),
  tractable: tractability(),
  // Measured separately by scripts/paper/measure-compute-footprint.mjs, because
  // it reads session transcripts that live outside the repository and are not
  // available in CI. Committed so the paper can cite it; declared partial so it
  // reads as the floor it is.
  // Constants and weights read out of the code that uses them, by
  // scripts/paper/extract-model-parameters.mjs. A methods paper is only
  // peer-reviewable if the formulas it prints are the ones that run.
  scope: buildScope(),
  methods: (() => {
    const r = readJson('data/paper/model-parameters.json');
    if (!r.ok) return { model_count: absent('methods.model_count', r.reason) };
    return r.data;
  })(),
  footprint: (() => {
    const r = readJson('data/paper/compute-footprint.json');
    if (!r.ok) return { turns: absent('footprint.turns', r.reason) };
    const f = r.data;
    const turns = f.inference && f.inference.turns;
    const lo = f.energy && f.energy.low && f.energy.low.value;
    const hi = f.energy && f.energy.high && f.energy.high.value;
    const grid = f.energy && f.energy.grid_kg_co2e_per_kwh && f.energy.grid_kg_co2e_per_kwh.value;
    const band = (perQueryWh) => (turns != null && perQueryWh != null
      ? Math.round((turns * perQueryWh) / 1000) : null);
    const kwhLow = band(lo);
    const kwhHigh = band(hi);
    return {
      measured_at: f.measured_at || null,
      ci_runs: (f.ci && f.ci.total_runs) ?? absent('footprint.ci_runs', 'CI run count unavailable'),
      ci_runner_hours: (f.ci && f.ci.estimated_runner_hours) ?? null,
      turns: turns ?? absent('footprint.turns', 'no transcript turn count'),
      output_tokens: (f.inference && f.inference.output_tokens) ?? null,
      coverage_start: (f.inference && f.inference.coverage_start) ?? null,
      coverage_end: (f.inference && f.inference.coverage_end) ?? null,
      wh_per_query_low: lo ?? null,
      wh_per_query_high: hi ?? null,
      kwh_low: kwhLow,
      kwh_high: kwhHigh,
      // Never a midpoint. The spread IS the finding; averaging it away would
      // publish a confidence the evidence does not carry.
      spread_factor: (lo && hi) ? Math.round(hi / lo) : null,
      kg_co2e_low: (kwhLow != null && grid != null) ? Math.round(kwhLow * grid) : null,
      kg_co2e_high: (kwhHigh != null && grid != null) ? Math.round(kwhHigh * grid) : null,
    };
  })(),
};
figures.volatile = VOLATILE;
figures.unavailable = unavailable;

const json = `${JSON.stringify(figures, null, 2)}\n`;

if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  const n = unavailable.length;
  console.log(`[paper] wrote ${path.relative(ROOT, OUT)}`);
  console.log(n === 0
    ? '[paper] every figure resolved'
    : `[paper] ${n} figure(s) unavailable and emitted as null: ${unavailable.map((u) => u.key).join(', ')}`);
}
