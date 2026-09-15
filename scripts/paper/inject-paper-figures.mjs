#!/usr/bin/env node
/**
 * Write the figures from data/paper/figures.json into working-paper.html.
 *
 * working-paper.html is a GENERATED file in the same sense as the place pages
 * and the jurisdiction digests: its prose is authored, its numbers are not.
 * Editing a number by hand is undone by the next run, and
 * test/paper-figures-fresh.test.js fails CI when the page and the data disagree.
 *
 * Two mechanisms:
 *
 *   data-figure="path.to.value"   replaces that element's text content.
 *     data-figure-format="comma"   1622  -> "1,622"
 *     data-figure-format="percent" 0.2   -> "20%"
 *     data-figure-add="other.path" renders the sum of the two figures
 *
 *   data-figure-block="name"      replaces that element's inner HTML with a
 *                                 generated block (tables, the commit chart)
 *
 * A figure that is null in figures.json renders as its stated reason in a
 * .wp-unknown span — never as 0, never as a blank that reads as nothing to
 * report. That is the paper obeying the rule it is about.
 *
 *   node scripts/paper/inject-paper-figures.mjs          # rewrite the page
 *   node scripts/paper/inject-paper-figures.mjs --check  # exit 1 if it would change
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Overridable so test/paper-figures-fresh.test.js can drive the injector with a
// figures file containing a deliberate null, and assert what the page then
// shows. Without that, the absence rule is only tested when a figure happens to
// be missing — which is to say, tested on no build that matters.
const FIGURES = process.env.PAPER_FIGURES || path.join(ROOT, 'data', 'paper', 'figures.json');
const PAGE = process.env.PAPER_PAGE || path.join(ROOT, 'working-paper.html');
const CHECK = process.argv.includes('--check');

if (!existsSync(FIGURES)) {
  console.error(`[paper] ${path.relative(ROOT, FIGURES)} is missing. `
    + 'Run: node scripts/paper/build-paper-figures.mjs');
  process.exit(1);
}
const figures = JSON.parse(readFileSync(FIGURES, 'utf8'));
let html = readFileSync(PAGE, 'utf8');

/* ── value lookup ────────────────────────────────────────────────────────── */

/** Resolve "a.b.0.c" against the figures object. Missing path -> undefined. */
function at(objPath) {
  return objPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), figures);
}

/** Why a figure is null, as the generator recorded it. */
function reasonFor(objPath) {
  const hit = (figures.unavailable || []).find((u) => u.key === objPath);
  return hit ? hit.reason : 'not available in this build';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const comma = (n) => Number(n).toLocaleString('en-US');

function render(objPath, format) {
  const v = at(objPath);
  if (v === undefined) {
    // A path that does not exist is an authoring error in the page, not an
    // absent measurement. Fail loudly rather than printing a plausible dash.
    throw new Error(`data-figure="${objPath}" does not exist in figures.json`);
  }
  if (v === null) return `<span class="wp-unknown">not available &mdash; ${esc(reasonFor(objPath))}</span>`;
  if (format === 'comma') return esc(comma(v));
  if (format === 'percent') return esc(`${Math.round(Number(v) * 100)}%`);
  // A confidence FLOOR of 0.85 means a maximum penalty of 15%. Printing the
  // floor where the prose says "penalty" would invert the claim.
  if (format === 'complement-pct') return esc(`${Math.round((1 - Number(v)) * 100)}%`);
  if (format === 'list') return esc(Array.isArray(v) ? v.join(' and ') : String(v));
  return esc(v);
}

/* ── generated blocks ────────────────────────────────────────────────────── */

const unknownCell = (p) => `<span class="wp-unknown">n/a</span>`;
const cell = (v) => (v == null ? '<span class="wp-unknown">n/a</span>' : comma(v));

const BLOCKS = {
  'commit-bars'() {
    const months = at('repo.commits_by_month');
    if (!months) return `<p class="wp-unknown">Commit history not available &mdash; ${esc(reasonFor('repo.commits_by_month'))}</p>`;
    return months.map((m) => `
        <div class="wp-bar-row"><span>${esc(m.month)}</span><span class="wp-bar-track"><span class="wp-bar-fill" style="width:${m.pct_of_peak}%"></span></span><span class="v">${comma(m.commits)}</span></div>`).join('');
  },

  'case-bands'() {
    const bands = at('case.bands');
    if (!bands) return `<tr><td colspan="7" class="wp-unknown">Band detail not available &mdash; ${esc(reasonFor('case.name'))}</td></tr>`;
    return bands.map((b) => `
              <tr><th scope="row">${esc(b.label)}</th><td>${cell(b.renters)}</td><td>${cell(b.renters_cb30)}</td><td>${cell(b.renters_cb50)}</td><td>${cell(b.owners)}</td><td>${cell(b.owners_cb30)}</td><td>${cell(b.owners_cb50)}</td></tr>`).join('');
  },

  'case-subtotal'() {
    const s = at('case.subtotal_lte80');
    if (!s) return '';
    return `
              <tr><th scope="row">&le;80% AMI subtotal</th><td>${cell(s.renters)}</td><td>${cell(s.renters_cb30)}</td><td>${cell(s.renters_cb50)}</td><td>${cell(s.owners)}</td><td>${cell(s.owners_cb30)}</td><td>${cell(s.owners_cb50)}</td></tr>`;
  },

  'affordability-models'() {
    const models = at('methods.affordability.models');
    if (!Array.isArray(models)) {
      return `<tr><td colspan="8" class="mx-unknown">Registry not readable &mdash; ${esc(reasonFor('methods.model_count'))}</td></tr>`;
    }
    const pct = (v) => (v == null ? '<span class="mx-unknown">n/a</span>' : `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`);
    return models.map((m) => `
              <tr><th scope="row">${esc(m.id)}${m.is_default ? ' <strong>(default)</strong>' : ''}</th><td class="lbl">${esc(m.housing_ratio_type)}-end</td><td>${pct(m.housing_ratio)}</td><td>${m.front_end_ratio_cap == null ? '&mdash;' : pct(m.front_end_ratio_cap)}</td><td>${pct(m.property_tax_rate)}</td><td>${pct(m.insurance_rate)}</td><td>${m.pmi_rate == null ? '<span class="mx-unknown">n/a</span>' : pct(m.pmi_rate)}</td><td class="lbl">${m.pmi_ltv_gate === true ? 'yes' : m.pmi_ltv_gate === false ? 'no' : '<span class="mx-unknown">n/a</span>'}</td></tr>`).join('');
  },

  'affordability-divergence'() {
    const rows = at('methods.affordability.divergence');
    if (!Array.isArray(rows)) return `<tr><td colspan="3" class="mx-unknown">not readable</td></tr>`;
    if (!rows.length) {
      return `
              <tr><td colspan="3">The registry default and the constants file currently agree on every compared parameter.</td></tr>`;
    }
    return rows.map((d) => `
              <tr><th scope="row">${esc(d.parameter)}</th><td>${esc(d.registry_default)}</td><td>${esc(d.constants_file)}</td></tr>`).join('');
  },

  'ranking-weights'() {
    const r = at('methods.ranking');
    if (!r || !r.community_need_weights) {
      return `<tr><td colspan="3" class="mx-unknown">Weights not readable</td></tr>`;
    }
    const rows = [];
    const push = (group, name, w) => rows.push(
      `\n              <tr><th scope="row">${esc(group)}</th><td class="lbl">${esc(name)}</td><td>${w == null ? '<span class="mx-unknown">n/a</span>' : w}</td></tr>`);
    for (const [k, v] of Object.entries(r.axis_weights || {})) push('Axis', k, v);
    for (const [k, v] of Object.entries(r.community_need_weights || {})) push('Community need', k, v);
    for (const [k, v] of Object.entries(r.opportunity_weights || {})) push('Opportunity', k, v);
    const sw = r.subscore_weights || {};
    for (const [group, parts] of Object.entries(sw)) {
      for (const [k, v] of Object.entries(parts || {})) push(`Sub-score: ${group}`, k, v);
    }
    return rows.join('');
  },

  'tractable-rows'() {
    const rows = at('tractable.top');
    if (!rows) return `<tr><td colspan="6" class="wp-unknown">Screen not available &mdash; ${esc(reasonFor('tractable.eligible'))}</td></tr>`;
    const flag = (profile) => {
      const cls = profile === 'both tenures' || profile === 'even split' ? 'wp-flag-crit' : 'wp-flag-watch';
      return `<span class="wp-flag ${cls}">${esc(profile)}</span>`;
    };
    return rows.map((r) => `
              <tr><th scope="row">${esc(r.name)}</th><td>${cell(r.households)}</td><td>${cell(r.burdened_lte80)}</td><td>${esc(r.share_pct)}%</td><td>${cell(r.renters_burdened)} / ${cell(r.owners_burdened)}</td><td class="lbl">${flag(r.tenure_profile)}</td></tr>`).join('');
  },
};

/* ── rewrite ─────────────────────────────────────────────────────────────── */

/**
 * Find the index just past the element opened at `openEnd`, counting nesting.
 *
 * A non-greedy /([\s\S]*?)<\/tag>/ stops at the FIRST closing tag, which for
 * `<div data-figure-block>` wrapping `<div class="wp-bar-row">` is the inner
 * one. That made the injector non-idempotent: it produced valid output on a
 * clean page and mangled it on the second run, so the --check gate reported
 * STALE immediately after a successful build. Depth counting is the fix.
 */
function closeIndex(source, tag, openEnd) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, 'gi');
  re.lastIndex = openEnd;
  let depth = 1;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[2] === '/') continue;            // self-closing, no depth change
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return { start: m.index, end: re.lastIndex };
  }
  throw new Error(`unclosed <${tag}> starting at offset ${openEnd}`);
}

/**
 * Replace the inner HTML of every element carrying `attr`, innermost-safe.
 *
 * Walks left to right and re-scans from just after each replacement's opening
 * tag, so a marker nested inside another marker is still visited.
 */
function replaceInner(source, attr, produce) {
  const open = new RegExp(`<(\\w+)([^>]*\\b${attr}="([^"]+)"[^>]*)>`, 'g');
  let out = source;
  let from = 0;
  let count = 0;
  for (;;) {
    open.lastIndex = from;
    const m = open.exec(out);
    if (!m) break;
    const [full, tag, attrs, key] = m;
    const openEnd = m.index + full.length;
    const close = closeIndex(out, tag, openEnd);
    const replacement = produce(key, attrs);
    out = out.slice(0, openEnd) + replacement + out.slice(close.start);
    count += 1;
    from = openEnd;                        // re-scan inside what we just wrote
  }
  return { html: out, count };
}

// Blocks first. Their generated rows carry no data-figure attributes, so doing
// them first keeps the scalar pass from walking generated markup.
const blockPass = replaceInner(html, 'data-figure-block', (name) => {
  const fn = BLOCKS[name];
  if (!fn) throw new Error(`data-figure-block="${name}" has no generator in inject-paper-figures.mjs`);
  return `${fn()}\n          `;
});
html = blockPass.html;
const blocks = blockPass.count;

// Scalars. The opening tag is left untouched so the markers survive: this file
// must be re-runnable against its own output, and the freshness gate depends on
// that being exactly true.
const scalarPass = replaceInner(html, 'data-figure', (figPath, attrs) => {
  const fmt = (attrs.match(/\bdata-figure-format="([^"]+)"/) || [])[1];
  const add = (attrs.match(/\bdata-figure-add="([^"]+)"/) || [])[1];
  if (add) {
    const a = at(figPath);
    const b = at(add);
    if (a == null || b == null) {
      // One unreadable operand makes the sum unreadable. Summing through a null
      // would coerce it to 0 and silently understate the total — the exact
      // defect this paper is about.
      return '<span class="wp-unknown">not available</span>';
    }
    const sum = Number(a) + Number(b);
    return fmt === 'comma' ? comma(sum) : String(sum);
  }
  return render(figPath, fmt);
});
html = scalarPass.html;
const scalars = scalarPass.count;

const before = readFileSync(PAGE, 'utf8');
if (CHECK) {
  if (before !== html) {
    console.error(`[paper] ${path.basename(PAGE)} is STALE — its figures disagree with data/paper/figures.json`);
    console.error('[paper] regenerate with: npm run paper:build');
    process.exit(1);
  }
  console.log(`[paper] ${path.basename(PAGE)} is current (${scalars} figures, ${blocks} generated blocks)`);
} else {
  writeFileSync(PAGE, html);
  console.log(`[paper] injected ${scalars} figures and ${blocks} generated blocks into ${path.basename(PAGE)}`);
  const n = (figures.unavailable || []).length;
  if (n) console.log(`[paper] ${n} figure(s) rendered as a stated reason rather than a number`);
}
