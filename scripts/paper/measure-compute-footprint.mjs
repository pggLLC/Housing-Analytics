#!/usr/bin/env node
/**
 * Measure the compute this project consumed, and refuse to guess the rest.
 *
 * The repository was built with heavy AI assistance. That is a material fact
 * about how the work was produced and it carries an energy cost, so it is
 * disclosed here on the same terms as every other figure: what is measured is
 * measured, what is not is null with a reason, and nothing is rounded into a
 * reassuring number.
 *
 * TWO SOURCES, BOTH IMPERFECT, BOTH STATED:
 *
 *   1. Continuous integration. Workflow runs and their wall-clock durations come
 *      from the GitHub API. Complete for the life of the repository.
 *
 *   2. Model inference. Assistant turns and token counts come from the local
 *      session transcripts under ~/.claude/projects. These are NOT complete:
 *      transcripts are rotated, and the surviving window is shorter than the
 *      project. The coverage window is recorded so the figure reads as the
 *      floor it is, not as a total.
 *
 * WHAT IS DELIBERATELY NOT COMPUTED HERE: kilowatt-hours and CO2e. Converting
 * turns to energy requires a per-query figure, and the published range spans
 * more than an order of magnitude — from sub-watt-hour for optimised serving to
 * roughly 33 Wh for a reasoning model on a long prompt. Collapsing that to a
 * point estimate would manufacture a precision the evidence does not support,
 * which is the exact failure this repository exists to avoid. The page shows the
 * range and the arithmetic, and lets the reader see how wide it is.
 *
 *   node scripts/paper/measure-compute-footprint.mjs         # write the JSON
 *   node scripts/paper/measure-compute-footprint.mjs --stdout
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'paper', 'compute-footprint.json');
const REPO = 'pggLLC/Housing-Analytics';

const unavailable = [];
const absent = (key, reason) => { unavailable.push({ key, reason }); return null; };

/* ── 1. continuous integration ───────────────────────────────────────────── */

function ci() {
  const gh = (args) => {
    try {
      return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return null; }
  };

  const total = gh(['api', `repos/${REPO}/actions/runs?per_page=1`, '--jq', '.total_count']);
  if (total == null) {
    return {
      total_runs: absent('ci.total_runs', 'the GitHub CLI is unavailable or unauthenticated'),
      mean_run_seconds: absent('ci.mean_run_seconds', 'the GitHub CLI is unavailable or unauthenticated'),
    };
  }

  // Sample rather than page through forty thousand runs. The sample size is
  // published alongside the mean so the reader can judge it.
  const durations = [];
  for (const page of [1, 2, 3]) {
    const raw = gh(['api', `repos/${REPO}/actions/runs?per_page=100&page=${page}&status=completed`,
      '--jq', '.workflow_runs[] | select(.run_started_at and .updated_at) '
      + '| ((.updated_at|fromdate) - (.run_started_at|fromdate))']);
    if (!raw) continue;
    for (const line of raw.split('\n')) {
      const n = Number(line);
      // A run whose recorded end precedes its start, or which sat queued for
      // hours, is a clock artefact rather than compute. Excluded, and the
      // exclusion is declared.
      if (Number.isFinite(n) && n >= 0 && n < 7200) durations.push(n);
    }
  }
  if (!durations.length) {
    return {
      total_runs: Number(total),
      mean_run_seconds: absent('ci.mean_run_seconds', 'no completed runs returned a usable duration'),
    };
  }
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    total_runs: Number(total),
    sample_size: durations.length,
    sample_note: 'most recent completed runs; runs over 2h excluded as queue artefacts',
    mean_run_seconds: Number(mean.toFixed(1)),
    median_run_seconds: sorted[Math.floor(sorted.length / 2)],
    estimated_runner_hours: Math.round((Number(total) * mean) / 3600),
  };
}

/* ── 2. model inference ──────────────────────────────────────────────────── */

async function inference() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!existsSync(base)) {
    return { turns: absent('inference.turns', '~/.claude/projects is not present on this machine') };
  }
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl') && /Housing-Analytics/.test(full)) files.push(full);
    }
  };
  walk(base);
  if (!files.length) {
    return { turns: absent('inference.turns', 'no session transcripts for this repository were found') };
  }

  let turns = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let earliest = null;
  let latest = null;

  for (const f of files) {
    const st = statSync(f);
    if (!earliest || st.mtime < earliest) earliest = st.mtime;
    if (!latest || st.mtime > latest) latest = st.mtime;
    const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
    for await (const line of rl) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const m = o.message || o;
      if (o.type !== 'assistant' && m.role !== 'assistant') continue;
      turns += 1;
      const u = m.usage || o.usage;
      if (!u) continue;
      inputTokens += u.input_tokens || 0;
      outputTokens += u.output_tokens || 0;
      cacheTokens += (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
  }

  const day = (d) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    transcripts: files.length,
    turns,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    // Counted separately and never folded into a single total. Cached prefill
    // skips most of the computation that fresh tokens require, so adding the
    // two would overstate the work by orders of magnitude — a sum that looks
    // authoritative and is not.
    cache_tokens: cacheTokens,
    coverage_start: day(earliest),
    coverage_end: day(latest),
    coverage_is_partial: true,
    coverage_note: 'Session transcripts rotate. This window is shorter than the project, '
      + 'so every inference figure here is a floor, not a total.',
  };
}

/* ── 3. the conversion the reader has to make themselves ─────────────────── */

/**
 * Published per-query energy figures, with their sources.
 *
 * These are NOT multiplied out into a single answer. The range spans a factor
 * of about forty, and which end applies depends on serving efficiency and
 * context length — neither of which this project can observe from outside.
 */
const ENERGY_RANGE_WH_PER_QUERY = {
  low: {
    value: 0.24,
    basis: 'Google, reported median energy per Gemini text prompt',
    note: 'Short prompt, highly optimised serving. A lower bound, and almost '
      + 'certainly not what long agentic coding turns cost.',
  },
  high: {
    value: 33.6,
    basis: 'Jegham et al., "How Hungry is AI?" (arXiv:2505.09598), DeepSeek-R1, '
      + 'long prompt (10k input / 1.5k output)',
    note: 'A reasoning model on a long prompt. Agentic coding turns carry longer '
      + 'context than this benchmark, so this is not a ceiling either.',
  },
  grid_kg_co2e_per_kwh: {
    value: 0.39,
    basis: 'US average grid intensity, EPA eGRID (~0.38–0.40 kg CO2e/kWh)',
  },
  us_household_kwh_per_year: {
    value: 10364,
    basis: 'US EIA, average annual residential electricity consumption',
  },
};

/* ── emit ────────────────────────────────────────────────────────────────── */

const footprint = {
  measured_at: new Date().toISOString().slice(0, 10),
  disclosure: 'This repository was built with substantial AI assistance over roughly nine '
    + 'months. The figures below are what can be measured of its compute cost. They are '
    + 'published rather than omitted, and bounded rather than point-estimated, on the same '
    + 'terms this project applies to housing data.',
  ci: ci(),
  inference: await inference(),
  energy: ENERGY_RANGE_WH_PER_QUERY,
  unavailable,
};

const json = `${JSON.stringify(footprint, null, 2)}\n`;
if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`[paper] wrote ${path.relative(ROOT, OUT)}`);
  const inf = footprint.inference;
  if (inf.turns != null) {
    console.log(`[paper] ${inf.turns.toLocaleString()} model turns across `
      + `${inf.transcripts} transcripts (${inf.coverage_start} → ${inf.coverage_end}, PARTIAL)`);
  }
  if (footprint.ci.total_runs != null) {
    console.log(`[paper] ${footprint.ci.total_runs.toLocaleString()} CI runs, `
      + `~${footprint.ci.estimated_runner_hours?.toLocaleString()} runner-hours`);
  }
  if (unavailable.length) {
    console.log(`[paper] ${unavailable.length} figure(s) unavailable: `
      + unavailable.map((u) => u.key).join(', '));
  }
}
