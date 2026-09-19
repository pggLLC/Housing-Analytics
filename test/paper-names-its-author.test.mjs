#!/usr/bin/env node
/**
 * The paper says who wrote it, what they wrote it with, and what it is for.
 *
 * ── Why this needs a guard ──
 *
 * working-paper.html and methods.html are rewritten by `npm run paper:build`
 * on most PRs that touch the HNA chain — 119 figures and 4 generated blocks
 * injected into one, 17 and 3 into the other. Prose that lives near generated
 * content is prose that can be regenerated away without anyone noticing, and
 * this particular prose is a claim about authorship.
 *
 * ── What it holds ──
 *
 * Before 2026-09-19 the byline read only "COHO Analytics — the sole product of
 * pggLLC". It did not name a person, did not mention IndiBuild, and did not
 * disclose that the work was done with AI. A reader assessing the paper could
 * not tell any of that from the paper.
 *
 * The spellings are the repo's own: "Paul Glasgow, pggLLC" is how
 * docs/JAPA-VIEWPOINT-DRAFT.md already attributes it, and "IndiBuild" is the
 * capitalisation used in prose elsewhere in the site.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['working-paper.html', 'methods.html'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('both pages exist and are substantial', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.ok(src.length > 20000, `${p} is only ${src.length} bytes; did a build truncate it?`);
  }
});

test('the author is named on both pages', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.ok(src.includes('Paul Glasgow'),
      `${p} does not name its author`);
    assert.ok(/name="author" content="[^"]*Paul Glasgow/.test(src),
      `${p} has no machine-readable author, so citation tools and search cannot attribute it`);
  }
});

test('the organisation is credited, and the domain resolves to a link', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.ok(src.includes('pggLLC'), `${p} does not credit pggLLC`);
    // IndiBuild is deliberately NOT asserted here. scripts/audit/public-artifact-guard.mjs
    // lists /\bindibuild\b/i under SENSITIVE_PATTERNS — alongside developer
    // passwords, the gate hash and contact CSV fields — as "legacy IndiBuild
    // brand text", added by the commit that renamed the public pipeline
    // surface, so test:public-build fails on any public artifact containing
    // it. Crediting IndiBuild would mean narrowing a rule whose other entries
    // are secrets.
    //
    // Asked on #1757 and answered on 2026-09-19: leave it out. The paper
    // credits Paul Glasgow and pggLLC. This is a recorded decision, not an
    // oversight — if the rebrand is ever reversed, narrow the guard first.
    assert.ok(/href="https:\/\/pggllc\.com"/.test(src),
      `${p} mentions pggLLC but never links pggllc.com`);
  }
});

test('the use of AI is disclosed where the author is named', () => {
  // /\bAI\b/ over the whole page is not a disclosure check: the paper cites
  // Jegham et al., "How Hungry is AI?", which satisfies it on its own. The
  // first version of this test passed with every real disclosure removed.
  for (const p of PAGES) {
    const src = read(p);
    // The two pages use different byline classes (wp-byline, mx-byline), so
    // match on the role rather than one page's class name.
    const byline = (src.match(/<p class="[^"]*byline[^"]*">[\s\S]*?<\/p>/) || [])[0] || '';
    assert.ok(byline, `${p} has no byline block`);
    assert.ok(/with AI/.test(byline),
      `${p}'s byline names the author but not that the work was done with AI`);
  }
  // And the body has to say it too, not just the standfirst.
  const paper = read('working-paper.html');
  assert.ok(/collaboration with AI|with substantial AI assistance/.test(paper),
    'the paper body no longer discloses that it was built with AI');
});

test('the paper says what it is an experiment in', () => {
  // The framing the owner asked for, and the reason the corrections in §01
  // belong in the paper rather than in a changelog.
  const src = read('working-paper.html');
  assert.ok(/experiment/i.test(src), 'the paper never says it is an experiment');
  for (const claim of ['targets housing need', 'evaluates the market', 'Colorado']) {
    assert.ok(src.includes(claim),
      `the experiment framing does not say it ${claim}`);
  }
  // An experiment that only reports successes is not measuring anything, so
  // the disclosure that AI also introduced defects has to survive too.
  assert.ok(/introduced some/.test(src),
    'the paper credits AI for the work but no longer admits it also introduced defects');
});
