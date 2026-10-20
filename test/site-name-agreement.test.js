#!/usr/bin/env node
/**
 * The site calls itself one name: the one in the header.
 *
 * Until 2026-10-15 the header said "Colorado Housing Data", the homepage tab
 * "Colorado Affordable Housing Data Reference", thirteen pages "Colorado
 * Public Data Reference", forty-one "COHO Analytics" and the gated pages
 * "COHO". Codex's site review counted five names for one site.
 *
 * Agreement, not copy: whatever the header brand is (js/navigation.js), every
 * top-level page's <title> must end with it (or, for the homepage, start with
 * it), and the footer must use it. That includes the generated place
 * profiles and the paper pages, whose titles live in their own sources. Rename the header and every title must
 * follow.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const nav = fs.readFileSync(path.join(ROOT, 'js/navigation.js'), 'utf8');
const brand = (nav.match(/<div class="brand">\s*<a href="[^"]*">([^<]+)<\/a>/) || [])[1];
assert.ok(brand, 'could not read the header brand from js/navigation.js');

// Pages left out, each with the reason.
const EXEMPT = {};

// Top-level pages, and the 482 place profiles that
// scripts/hna/build_place_pages.py generates from places/_template.html.
const top = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !EXEMPT[f]);
const placePages = fs.readdirSync(path.join(ROOT, 'places')).filter((f) => f.endsWith('.html')).map((f) => `places/${f}`);
assert.ok(top.length > 50, `scan found only ${top.length} top-level pages`);
assert.ok(placePages.length > 400, `scan found only ${placePages.length} place pages`);
const pages = [...top, ...placePages];
const bad = [];
for (const f of pages) {
  const t = ((fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<title>([^<]*)<\/title>/) || [])[1] || '').trim();
  if (!t) continue;
  const ok = f === 'index.html' ? t.startsWith(brand) : (t === brand || new RegExp(`[|·—-]\\s*${brand}(\\s+developer tools)?$`).test(t));
  if (!ok) bad.push(`${f}: "${t}"`);
}
assert.deepStrictEqual(bad, [], `page titles that do not use the header's name "${brand}":\n  ` + bad.join('\n  '));

const footerName = (nav.match(/<div class="footer-col">\s*<strong>([^<]+)<\/strong>/) || [])[1];
assert.strictEqual(footerName, brand, `footer calls the site "${footerName}", header "${brand}"`);

console.log(`site-name-agreement: ${pages.length} page titles (${placePages.length} place profiles) and the footer use "${brand}"`);
