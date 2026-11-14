// The member pages in the new pages' header, menu, footer and look (member switch, paul 14 Nov 2026).
// scripts/build-member-chrome.mjs writes marked blocks into every developer*.html; this fails when a page is out of
// date with the script, the hub page's header and footer or hub/palette.css, or has lost a block.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, build } from '../scripts/build-member-chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const pages = fs.readdirSync(ROOT).filter((f) => /^developer.*\.html$/.test(f) && !/http-equiv="refresh"/i.test(read(f)));
ok(pages.length >= 9, 'non-vacuous: ' + pages.length + ' member pages');
const b = blocks(read('deal-hub.html'), read('hub/palette.css'));
for (const f of pages) {
  const src = read(f);
  ok(build(src, b, f) === src, f + ' is up to date (run node scripts/build-member-chrome.mjs)');
  for (const k of ['theme', 'head', 'header', 'footer', 'scripts']) ok(src.includes('<!-- member-chrome:' + k + ' ') && src.includes('<!-- /member-chrome:' + k + ' -->'), f + ' carries the ' + k + ' block');
  ok(!/src="js\/navigation\.js"/.test(src), f + ' no longer loads the old header (js/navigation.js)');
  ok(/<body[^>]*\bmember-page\b/.test(src), f + ' names itself a member page');
  ok(src.includes('src="js/whitepaper/developer-nav.js"'), f + ' keeps the member menu');
  ok((src.match(/<header class="site-header">/g) || []).length === 1 && (src.match(/<footer class="site-footer">/g) || []).length === 1, f + ' has one header and one footer');
  const skip = /<a class="skip-link" href="#([^"]+)"/.exec(src);
  ok(skip && src.includes('id="' + skip[1] + '"'), f + ' has a skip link that lands on the page');
}
// The member home's links go to the new pages first; the older pages it still links are the member tools that need them.
const home = read('developer.html');
for (const href of ['places-hub.html', 'opportunities-hub.html', 'deal-hub.html#/projects', 'places-hub.html#/places/compare', 'developer-finder.html']) ok(home.includes('href="' + href + '"'), 'the member home links ' + href);
for (const old of ['housing-needs-assessment.html', 'lihtc-opportunity-finder.html']) ok(!home.includes('href="' + old + '"'), 'the member home no longer links ' + old);
ok(/Member home<\/a>/.test(home) && !/>Member sign in</.test(home), 'the member footer says Member home, not Member sign in');
console.log(`member-chrome: ${checks} checks passed`);
