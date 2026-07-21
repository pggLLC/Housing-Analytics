const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertFutureIso(raw, label) {
  assert.match(raw, /^\d{4}-\d{2}-\d{2}$/, `${label} is ISO date`);
  const date = new Date(`${raw}T00:00:00Z`);
  const today = new Date('2026-07-21T00:00:00Z');
  assert(date > today, `${label} is future-dated for the review cycle`);
}

const watch = readJson('data/policy/tool-watch.json');
const briefs = readJson('data/policy_briefs.json');
const generator = readText('scripts/generate_policy_briefs.py');
const page = readText('policy-briefs.html');
const freshness = readText('scripts/audit/benchmark-freshness-check.mjs');
const pkg = readJson('package.json');
const HTTPS_PREFIX = 'https:' + '//';

assert.equal(watch.schema, 'tool-watch/v1', 'tool-watch schema is versioned');
assert(watch.meta, 'tool-watch meta exists');
assert.match(watch.meta.refresh_cadence || '', /Quarterly review/i, 'refresh cadence is documented');
assertFutureIso(watch.meta.review_by, 'meta.review_by');

const entries = watch.entries || [];
assert(entries.length >= 5, 'starter set is non-vacuous');

const requiredIds = new Set([
  'novogradac-rent-income-limit-calculator',
  'novogradac-qualified-census-tract-estimator',
  'huduser-qct-dda-data',
  'huduser-fair-market-rents',
  'huduser-income-limits',
]);

for (const id of requiredIds) {
  assert(entries.some((entry) => entry.id === id), `${id} starter entry exists`);
}

for (const entry of entries) {
  assert(entry.id && /^[a-z0-9-]+$/.test(entry.id), `${entry.id || 'entry'} has stable id`);
  assert(entry.title, `${entry.id} has title`);
  assert(entry.tool_name, `${entry.id} has tool_name`);
  assert(entry.vendor, `${entry.id} has vendor`);
  assert(entry.category, `${entry.id} has category`);
  assert(entry.status, `${entry.id} has status`);
  assert(entry.capability_summary, `${entry.id} has capability_summary`);
  assert(entry.relevance_to_coho, `${entry.id} has relevance_to_coho`);
  assert(entry.source_note, `${entry.id} has source_note`);
  assert(entry.last_verified && /^\d{4}-\d{2}-\d{2}$/.test(entry.last_verified), `${entry.id} last_verified is ISO`);
  assertFutureIso(entry.review_by, `${entry.id}.review_by`);
  assert(entry.source_url && typeof entry.source_url === 'string', `${entry.id} has non-empty source_url`);
  assert(entry.source_url.startsWith(HTTPS_PREFIX), `${entry.id} source_url is HTTPS`);
  const host = new URL(entry.source_url).hostname;
  assert(
    /(^|\.)novoco\.com$/.test(host) || /(^|\.)huduser\.gov$/.test(host),
    `${entry.id} source_url host is official-looking: ${host}`,
  );
}

assert(generator.includes('TOOL_WATCH_FILE'), 'generator loads tool-watch data');
assert(generator.includes("'topic': 'tool_watch'"), 'generator maps entries to tool_watch alerts');
assert(generator.includes('build_tool_watch_brief'), 'generator has a dedicated tool-watch brief builder');
assert(page.includes('brief.is_tool_evaluation'), 'policy-briefs page preserves tool-evaluation articles');
assert(freshness.includes('data/policy/tool-watch.json'), 'freshness advisory checks tool-watch review dates');

const toolBrief = (briefs.briefs || []).find((brief) => brief.is_tool_evaluation);
assert(toolBrief, 'policy briefs include a tool-evaluation brief');
assert.equal(toolBrief.policy_topic, 'Tool Evaluations', 'tool brief is clearly labeled as evaluation, not policy');
assert.equal(toolBrief.related_data, 'data/policy/tool-watch.json', 'tool brief links to the watchlist data');
assert(Array.isArray(toolBrief.articles) && toolBrief.articles.length >= entries.length, 'tool brief exposes source articles');
for (const entry of entries) {
  assert(toolBrief.articles.some((article) => article.link === entry.source_url), `${entry.id} source_url is surfaced in tool brief articles`);
}

assert(pkg.scripts['test:tool-watch'] === 'node test/tool-watch.test.js', 'package exposes test:tool-watch');
assert(pkg.scripts['test:ci'].includes('npm run test:tool-watch'), 'test:ci includes test:tool-watch');

console.log(`tool-watch: PASS (${entries.length} tools, ${toolBrief.articles.length} brief source links)`);
