// Every table column header on the site's table pages must have a
// definition a reader can actually reach: either the header carries its own
// title / data-tip, or its normalized text has an entry in
// data/table-header-tips.json, which js/components/table-header-tips.js
// shows from the header itself (dotted underline; hover, focus or tap)
// in an accessible popover.
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
  'chfa-portfolio.html', 'preservation.html',
  'hna-scenario-builder.html', 'market-analysis.html',
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
    // Strip markup until none remains — a header's inner HTML can nest
    // (a sort icon inside a span), and one pass can leave a fragment behind.
    let plain = inner;
    for (let prev = null; prev !== plain;) { prev = plain; plain = plain.replace(/<[^>]*>/g, ''); }
    const text = normalize(plain);
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

// The definition glyphs are inline, text-sized controls. css/responsive.css
// gives every button and summary a 44px minimum box for touch; applied to a
// glyph inside a header, that turned a 17px "?" into a 44px circle, wrapped
// headers and broke their alignment (2026-10-15). The fix moves the touch
// target, not shrinks it: each glyph resets the box minimum and draws a
// ::before at least as large as the touch rule's minimum (Rule 14 in
// .github/copilot-instructions.md). Headers share a bottom edge, and the
// glyph is glued to the label's last word.
const responsiveCss = read('css/responsive.css');
const themeCss = read('css/site-theme.css');
const ruleBody = (css, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|[}\\s])' + esc + '\\s*\\{([^}]*)\\}', 'm').exec(css);
  return m ? m[1] : null;
};
const touchRule = /(^|\n)a,\s*\nbutton,[\s\S]*?summary,[\s\S]*?\{([^}]*)\}/.exec(responsiveCss);
assert.ok(touchRule, 'found the touch-target rule in css/responsive.css');
const touchMin = touchRule && /min-height:\s*(\d+)px/.exec(touchRule[2]);
assert.ok(touchMin, 'the touch-target rule in css/responsive.css sets a pixel min-height');
const minPx = Number(touchMin[1]);
const GLYPHS = ['.th-sort', '.info-tooltip > summary', '.methodology-popover__summary'];
for (const sel of GLYPHS) {
  const body = ruleBody(themeCss, sel);
  assert.ok(body, `site-theme.css has a rule for ${sel}`);
  assert.ok(/min-width:\s*0/.test(body) && /min-height:\s*0/.test(body),
    `${sel} resets the box minimum from css/responsive.css so the glyph stays text-sized`);
  assert.ok(/position:\s*relative/.test(body), `${sel} anchors its ::before touch target`);
  const hit = ruleBody(themeCss, sel + '::before');
  assert.ok(hit, `${sel}::before draws the touch target`);
  const w = /width:\s*(?:max\([^,]*,\s*)?(\d+)px/.exec(hit);
  const h = /height:\s*(\d+)px/.exec(hit);
  assert.ok(w && h && Number(w[1]) >= minPx && Number(h[1]) >= minPx,
    `${sel}::before is at least ${minPx} x ${minPx}px (Rule 14), got ${w && w[1]} x ${h && h[1]}`);
}
assert.ok(/th\.th-tip\s*\{[^}]*height:\s*(\d+)px/.test(themeCss) && Number(/th\.th-tip\s*\{[^}]*height:\s*(\d+)px/.exec(themeCss)[1]) >= minPx,
  'a tip header is tall enough to hold the glyph\'s touch target');
// The header label is the trigger (paul, 2026-10-18): no circled "i"
// glyph, a dotted underline on the label, and on touch a tap on the header
// opens the definition before any sort handler sees it. The sort arrow is
// left out of the label so a renderer's or table-sort.js's arrow stays a
// direct child of the header.
assert.ok(!componentSrc.includes("'th-tip__btn'"), 'no separate glyph control');
assert.ok(componentSrc.includes("'th-tip__label'") && /\.th-tip__label\s*\{[^}]*underline dotted/.test(themeCss),
  'the label carries a dotted underline');
assert.ok(/stopImmediatePropagation\(\)[\s\S]{0,200}?\}, true\);/.test(componentSrc),
  'a tap on the header opens the definition in the capture phase, before sort handlers');
assert.ok(componentSrc.includes("contains('th-sort')"), 'the sort arrow is kept out of the label');
assert.ok(/table th\s*\{[^}]*vertical-align:\s*bottom/.test(themeCss), 'header cells share a bottom edge');

// A header that already carries a link (a footnote reference) gets no
// glyph, since two 44px targets side by side would overlap; its definition
// stays on the header as a title for hover and for the export dictionary.
assert.ok(/th\.querySelector\('a\[href\]'\)\)\s*\{[\s\S]{0,400}?setAttribute\('title'[\s\S]{0,80}?return;/.test(componentSrc),
  'headers that already link to their explanation keep the link as their one control');

console.log(`table-header-tips: PASS — ${tablePages.length} table pages wired, ${Object.keys(tips).length} definitions, every static header covered`);
