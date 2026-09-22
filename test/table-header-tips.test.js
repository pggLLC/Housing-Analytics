// Every table column header on the site's table pages must have a
// definition a reader can actually reach: either the header carries its own
// title / data-tip, or its normalized text has an entry in
// data/table-header-tips.json, which js/components/table-header-tips.js
// turns into a visible "?" control with an accessible popover.
//
// Guards three things:
//   1. the definitions map is well-formed and every entry is a real sentence;
//   2. every page that contains a <table> (or is one of the HNA views, whose
//      tables are built in JS) loads the component;
//   3. every static <th> on those pages is covered — by a title, a data-tip,
//      or a map entry — using the component's own normalization.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const componentSrc = read('js/components/table-header-tips.js');
const mapDoc = JSON.parse(read('data/table-header-tips.json'));
const tips = mapDoc.tips;

// Same normalization the component applies (kept in step by assertion below).
// Static markup carries HTML entities the browser would have decoded; the
// test decodes the ones that occur in header text.
// Single-pass decode of the named entities that occur in header text. One
// pass (not chained replaces) so an entity produced by one replacement is
// never re-decoded by the next. This is decoding for comparison, not
// sanitization — the result is only ever compared against map keys.
const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&le;': '≤', '&ge;': '≥', '&nbsp;': ' ' };
function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|le|ge|nbsp);/g, (m) => ENTITY[m]);
}
function normalize(text) {
  return decodeEntities(String(text || '')).replace(/\s+/g, ' ').replace(/[▲▼↑↓⇅↕?]+\s*$/, '').trim().toLowerCase();
}

// Coverage is enforced where a reader is making a decision from the table:
// the tool and data pages. Prose pages (the working paper, methods, the
// guide, articles, policy analyses) label their tables in the surrounding
// text; the component still adds a "?" there for any header that has a
// definition, but their headers are not required to.
const CORE_PAGES = [
  'hna-comparative-analysis.html', 'lihtc-opportunity-finder.html', 'compare.html',
  'lihtc-allocations.html', 'chfa-portfolio.html', 'preservation.html',
  'hna-scenario-builder.html', 'market-analysis.html', 'historical-trends.html',
  'insights.html', 'developer-pipeline.html', 'developer-brief.html',
  'data-status.html', 'data-review-hub.html', 'dashboard-data-sources-ui.html',
  'dashboard-data-quality.html', 'colorado-deep-dive.html', 'housing-needs-assessment.html',
];
assert.ok(componentSrc.includes("replace(/\\s+/g, ' ')") && componentSrc.includes('.toLowerCase()'),
  'component normalizes header text the way this test does');

// 1. Map well-formedness.
assert.ok(tips && typeof tips === 'object' && Object.keys(tips).length >= 40, 'definitions map has entries');
for (const [key, def] of Object.entries(tips)) {
  assert.equal(key, normalize(key), `map key is normalized: "${key}"`);
  assert.ok(typeof def === 'string' && def.trim().length >= 20, `definition for "${key}" is a real sentence`);
}

// 2. Wiring: pages with tables load the component.
const GENERATED_VIEWS = ['hna-what-housing-exists.html', 'hna-who-lives-here.html', 'hna-what-households-can-afford.html', 'hna-where-its-heading.html', 'hna-what-to-do.html'];
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !f.startsWith('og-'));
const tablePages = pages.filter((p) => /<table\b/.test(read(p)) || GENERATED_VIEWS.includes(p) || p === 'housing-needs-assessment.html');
assert.ok(tablePages.length >= 25, `found ${tablePages.length} pages with tables`);
const unwired = tablePages.filter((p) => !read(p).includes('js/components/table-header-tips.js'));
assert.deepEqual(unwired, [], `pages with tables that do not load table-header-tips.js: ${unwired.join(', ')}`);

// 3. Coverage of static headers on the core pages.
for (const p of CORE_PAGES) assert.ok(fs.existsSync(path.join(ROOT, p)), `core page exists: ${p}`);
const thRe = /<th\b([^>]*)>([\s\S]*?)<\/th>/g;
const uncovered = [];
for (const p of CORE_PAGES) {
  const html = read(p);
  let m;
  while ((m = thRe.exec(html))) {
    const attrs = m[1];
    const inner = m[2];
    if (/\btitle=|data-tip=|data-tip-skip/.test(attrs)) continue;
    if (/<(input|select|button|textarea)\b/.test(inner)) continue;
    const text = normalize(inner.replace(/<[^>]+>/g, ''));
    if (!text) continue;
    if (!Object.prototype.hasOwnProperty.call(tips, text)) uncovered.push(`${p}: "${text}"`);
  }
}
assert.deepEqual(uncovered, [], 'static table headers with no title, data-tip, or map definition:\n  ' + uncovered.join('\n  '));

// The component never overwrites a definition a header already carries, and
// re-runs for JS-rendered tables.
assert.ok(componentSrc.includes('MutationObserver'), 'component re-decorates JS-rendered tables');
assert.ok(componentSrc.includes("th.getAttribute('data-tip')") && componentSrc.includes("th.getAttribute('title')"),
  'component prefers the header\'s own title/data-tip over the map');

console.log(`table-header-tips: PASS — ${tablePages.length} table pages wired, ${Object.keys(tips).length} definitions, every static header covered`);
