#!/usr/bin/env node
// Sunday digest: every edition listed in data/news-digest/index.json exists, is dated,
// carries only safe links, and holds nothing the public site must never show. The
// renderer escapes HTML before adding markup and drops javascript: links.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { isSensitive } from '../scripts/lib/public-sensitive-patterns.mjs';

const { render, safeHref } = createRequire(import.meta.url)('../js/sunday-digest.js');

const idx = JSON.parse(readFileSync('data/news-digest/index.json', 'utf8'));
assert(Array.isArray(idx.editions) && idx.editions.length > 0, 'index lists no editions');

const seen = new Set();
for (const ed of idx.editions) {
  assert.match(ed.date, /^\d{4}-\d{2}-\d{2}$/, `bad date ${ed.date}`);
  assert(!seen.has(ed.date), `duplicate edition ${ed.date}`);
  seen.add(ed.date);
  assert.equal(new Date(ed.date + 'T12:00:00Z').getUTCDay(), 0, `${ed.date} is not a Sunday`);
  assert(ed.window_start <= ed.window_end && ed.window_end === ed.date, `${ed.date}: window must end on the edition's Sunday`);
  assert.equal(ed.file, `data/news-digest/${ed.date}.md`, `${ed.date}: file path`);
  assert(existsSync(ed.file), `${ed.file} is missing`);
  assert(Array.isArray(ed.summary) && ed.summary.length >= 1 && ed.summary.length <= 5, `${ed.date}: summary needs 1 to 5 items`);

  const md = readFileSync(ed.file, 'utf8');
  assert.match(md, /^# .+/m, `${ed.file}: no title`);
  assert(!isSensitive(md), `${ed.file}: holds text the public site must never show`);
  assert(!/\bfruita\b/i.test(md), `${ed.file}: names Fruita (deal figures stay out of the repo)`);
  // Every link must be one the renderer keeps.
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    assert(safeHref(m[1]), `${ed.file}: unsafe link ${m[1]}`);
  }
  // Every section item carries at least one dated source.
  assert(/\[[A-Z][a-z]{2} \d{1,2}, \d{4}\]/.test(md), `${ed.file}: no dated sources`);
}

// Renderer safety.
const evil = render('Hello <script>alert(1)</script> [x](javascript:alert(1)) **b** [ok](https://example.com/?q=1&r=2)');
assert(!/<script/i.test(evil), 'script tag survived');
assert(!/javascript:/i.test(evil), 'javascript: link survived');
assert(/<strong>b<\/strong>/.test(evil), 'bold not rendered');
assert(/href="https:\/\/example\.com\/\?q=1&amp;r=2"/.test(evil), 'safe link not rendered');
assert(/<h2>Section<\/h2>/.test(render('## Section')), '## renders as h2');
assert(/<ul><li>a<ul><li>b<\/li><\/ul><\/li><\/ul>/.test(render('- a\n  - b')), 'nested list');

for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '/\\evil.example', '\\\\evil', ' JavaScript:x']) {
  assert.equal(safeHref(bad), null, `safeHref kept ${bad}`);
}
for (const good of ['https://example.com/', 'policy-briefs.html', 'data/news-digest/2026-11-08.md']) {
  assert(safeHref(good), `safeHref dropped ${good}`);
}

// The page and Housing News link to it.
assert(readFileSync('sunday-digest.html', 'utf8').includes('js/sunday-digest.js'), 'page does not load the renderer');
assert(readFileSync('policy-briefs.html', 'utf8').includes('href="sunday-digest.html"'), 'Housing News does not link to the digest');

console.log(`sunday-digest: ${idx.editions.length} edition(s) OK`);
