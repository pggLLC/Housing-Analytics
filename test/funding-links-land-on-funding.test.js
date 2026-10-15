#!/usr/bin/env node
/**
 * A link that promises funding programs opens the Funding Sources tab.
 *
 * Funding Sources lives inside colorado-deep-dive.html as #tab-funding. A link
 * to the bare page opens on the first tab, seven tabs away from what the link
 * said; local-incentives sent readers there twice until 2026-10-15.
 *
 * Agreement: any <a> whose text talks about funding or programs and points at
 * colorado-deep-dive.html must carry the hash of the tab that exists there.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const deepDive = fs.readFileSync(path.join(ROOT, 'colorado-deep-dive.html'), 'utf8');
assert.ok(/id="tab-funding"/.test(deepDive), 'colorado-deep-dive.html has no #tab-funding; update this guard with the new destination');

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
  .concat(fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f));
let scanned = 0;
const bad = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/<a\s[^>]*href=["']colorado-deep-dive\.html([^"']*)["'][^>]*>([\s\S]*?)<\/a>/g)) {
    scanned += 1;
    const text = m[2].replace(/<[^>]+>/g, ' ');
    // The promise can sit in the words just before the link ("State and
    // federal programs are on the <a>Colorado Deep Dive</a>").
    const lead = src.slice(Math.max(0, m.index - 60), m.index).replace(/<[^>]+>/g, ' ').split(/[.!?>]\s/).pop();
    if (/fund|program/i.test(lead + ' ' + text) && !/#tab-funding/.test(m[1])) bad.push(`${f}: "${(lead + text).trim()}" -> colorado-deep-dive.html${m[1]}`);
  }
}
assert.ok(scanned > 5, `scan found only ${scanned} links to colorado-deep-dive.html`);
assert.deepStrictEqual(bad, [], 'funding links that open the wrong tab:\n  ' + bad.join('\n  '));
console.log(`funding-links-land-on-funding: ${scanned} links to the Deep Dive checked`);
