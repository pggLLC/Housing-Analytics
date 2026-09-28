#!/usr/bin/env node
// Every served page carries a "Last updated" date: the last commit that changed
// the page's visible text (scripts/lib/page-dates.mjs, stamped by
// scripts/build-public-site.mjs).
// Unit checks run everywhere; the whole-artifact checks run only with full
// history, because a shallow clone cannot date anything and must not pretend to.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { contentChangedDate, formatLongDate, isArticle, isStampable, parseHistory, stampPage, STAMP_CLASS, visibleText } from '../scripts/lib/page-dates.mjs';

// parseHistory lists each path's commits newest first.
const history = parseHistory('@aaa1111 2026-09-25\n\na.html\nb.html\n@bbb2222 2026-07-01\n\na.html\nc.html\n');
assert.deepEqual(history.get('a.html'), [{ sha: 'aaa1111', date: '2026-09-25' }, { sha: 'bbb2222', date: '2026-07-01' }]);
assert.deepEqual(history.get('c.html'), [{ sha: 'bbb2222', date: '2026-07-01' }]);

// Markup, scripts, styles and comments are not content.
assert.equal(visibleText('<p class="a">Hello <b>world</b></p><script>x=1</script><!-- c -->'),
  visibleText('<div style="x"><p>Hello   world</p></div><style>p{}</style>'));
assert.notEqual(visibleText('<p>Pending in the Senate</p>'), visibleText('<p>Became law July 11, 2026</p>'));
// Embedded JSON data IS content: place profiles render their figures from it.
const placeV1 = '<script id="place-data" type="application/json">{"renter_gap": 103}</script><main><h1>Fruita</h1></main><script>render()</script>';
assert.notEqual(visibleText(placeV1), visibleText(placeV1.replace('103', '118')), 'a data-only rebuild must change the date');
assert.equal(visibleText(placeV1), visibleText(placeV1.replace('render()', 'renderAll()')), 'executable script edits are not content');

// A layout-only commit on top of a text change keeps the text change's date:
// the defect this rule exists for (AHCIA page text from June, last commit a
// September layout sweep).
const versions = {
  s3: '<main class="v2"><h1>AHCIA</h1><p>Two provisions enacted.</p></main>',   // 2026-09-22 layout sweep
  s2: '<main><h1>AHCIA</h1><p>Two provisions enacted.</p></main>',              // 2026-06-10 text written
  s1: '<main><h1>AHCIA</h1><p>Pending.</p></main>'                             // 2026-03-01 older text
};
const read = async (sha) => (sha in versions ? visibleText(versions[sha]) : null);
assert.equal(await contentChangedDate([{ sha: 's3', date: '2026-09-22' }, { sha: 's2', date: '2026-06-10' }, { sha: 's1', date: '2026-03-01' }], read), '2026-06-10');
// A real text change is dated by its own commit.
versions.s4 = '<main class="v2"><h1>AHCIA</h1><p>Remaining provisions pending.</p></main>';
assert.equal(await contentChangedDate([{ sha: 's4', date: '2026-10-01' }, { sha: 's3', date: '2026-09-22' }, { sha: 's2', date: '2026-06-10' }], read), '2026-10-01');
// Text never changed: the oldest commit. Unreadable version: unknown, not guessed.
assert.equal(await contentChangedDate([{ sha: 's3', date: '2026-09-22' }, { sha: 's2', date: '2026-06-10' }], read), '2026-06-10');
assert.equal(await contentChangedDate([{ sha: 's3', date: '2026-09-22' }, { sha: 'gone', date: '2026-06-10' }], read), null);
assert.equal(await contentChangedDate([], read), null);

assert.equal(formatLongDate('2026-09-05'), 'September 5, 2026');
assert.equal(formatLongDate(''), null);
assert.equal(formatLongDate('2026-13-01'), null);

assert(isStampable('index.html') && isStampable('places/0828745.html'));
assert(!isStampable('404.html') && !isStampable('og-card.html') && !isStampable('places/_template.html'));
assert(!isStampable('assets/co-housing-costs/maps/x.html'), 'iframe map fragments are not pages');
assert(!isStampable('research-brief.html'), 'the brief reader dates each brief from its own record');
assert(isArticle('article-pricing.html') && isArticle('help-for-homebuyers.html') && !isArticle('deal-calculator.html'));

const page = '<html><head><title>t</title></head><body><main><h1>Title</h1><p>Body</p></main></body></html>';
// Unknown date: nothing is written — never a guessed date.
assert.equal(stampPage(page, null), page);
assert.equal(stampPage(page, 'not-a-date'), page);
// Article: under the title. Tool page: at the foot of <main>.
const art = stampPage(page, '2026-09-25', { article: true });
assert(art.includes('</h1>\n<p class="coho-page-date"'), 'article date goes under the title');
assert(art.includes('<meta name="coho:page-updated" content="2026-09-25">'));
assert(art.includes('<time datetime="2026-09-25">September 25, 2026</time>'));
const tool = stampPage(page, '2026-09-25');
assert(/<p>Body<\/p><p class="coho-page-date"[^>]*>Last updated <time[^>]*>September 25, 2026<\/time><\/p>\n<\/main>/.test(tool), 'tool page date goes at the foot of main');
// Idempotent.
assert.equal(stampPage(art, '2026-09-25', { article: true }), art);
// An article that already prints its own editorial date is not given a second
// date under the heading.
const editorial = '<html><head></head><body><main><h1>T</h1><div>Published: June 10, 2026</div></main></body></html>';
const ed = stampPage(editorial, '2026-07-20', { article: true });
assert(!ed.includes('</h1>\n<p class="coho-page-date"') && ed.includes('<p class="coho-page-date"'), 'editorial-dated article: stamp at the foot');

const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() !== 'false';
if (shallow) {
  console.log('Page dates: unit checks PASS; artifact checks SKIPPED (shallow clone has no page history).');
  process.exit(0);
}

execFileSync(process.execPath, ['scripts/build-public-site.mjs'], { stdio: 'ignore' });
const fileHistory = parseHistory(execFileSync('git',
  ['log', '--format=@%H %cs', '--name-only', '--', '*.html'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
const MONTH = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

let checked = 0;
const missing = [];
const wrong = [];
async function walk(rel = '') {
  for (const entry of await readdir(path.join('dist', rel || '.'), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { await walk(childRel); continue; }
    if (!isStampable(childRel)) continue;
    const html = await readFile(path.join('dist', childRel), 'utf8');
    if (/<meta[^>]+http-equiv=["']?refresh/i.test(html)) continue;
    checked++;
    const m = html.match(new RegExp(`class="${STAMP_CLASS}"[^>]*>Last updated <time datetime="(\\d{4}-\\d{2}-\\d{2})">`));
    if (!m) { missing.push(childRel); continue; }
    const commits = (fileHistory.get(childRel) || []).map((c) => c.date);
    // The date must be one of the page's own commits, never the build day.
    if (!commits.includes(m[1])) wrong.push(`${childRel}: shows ${m[1]}, which is not a commit date of this file`);
    // Agreement with the page's own words: an article that prints
    // "Updated: July 16, 2026" cannot be stamped as last changed before that.
    const src = await readFile(childRel, 'utf8');
    for (const e of src.matchAll(/\b(?:Published|Updated)\s*:?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/g)) {
      const printed = `${e[3]}-${String(MONTH[e[1]]).padStart(2, '0')}-${e[2].padStart(2, '0')}`;
      if (m[1] < printed) wrong.push(`${childRel}: stamped ${m[1]} but the page itself says ${e[0]}`);
    }
  }
}
await walk();
// Non-vacuity on the scan: the artifact has hundreds of pages to check.
assert(checked >= 500, `expected to check at least 500 served pages, checked ${checked}`);
assert.deepEqual(missing, [], `served pages with no "Last updated" date:\n${missing.join('\n')}`);
assert.deepEqual(wrong, [], `served pages whose date disagrees with the page's history or its own printed date:\n${wrong.join('\n')}`);

// The sitemap must carry the same per-page dates, not one deploy-day date for
// every URL (the defect this replaced: all 547 live URLs read 2026-09-28).
const sitemap = await readFile('dist/sitemap.xml', 'utf8');
const about = await readFile('dist/about.html', 'utf8');
const aboutStamp = about.match(/<meta name="coho:page-updated" content="([^"]+)">/);
const aboutLastmod = sitemap.match(/<loc>https:\/\/[^<]+\/about\.html<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/);
assert(aboutStamp && aboutLastmod, 'about.html needs both a page stamp and a sitemap <lastmod>');
assert.equal(aboutLastmod[1], aboutStamp[1], 'sitemap <lastmod> and the page\'s visible date must agree');
// Each research brief URL is dated by its own record, not by the shared feed.
const curated = JSON.parse(await readFile('data/policy_briefs_curated.json', 'utf8'));
const briefs = curated.briefs.filter((b) => b.is_curated);
assert(briefs.length > 0, 'no curated briefs to check');
for (const brief of briefs) {
  const re = new RegExp(`research-brief\\.html\\?id=${brief.id}</loc>\\s*<lastmod>([^<]+)</lastmod>`);
  const hit = sitemap.match(re);
  assert(hit, `sitemap has no <lastmod> for brief ${brief.id}`);
  assert.equal(hit[1], String(brief.generated).slice(0, 10), `brief ${brief.id} must carry its own date`);
}
const distinct = new Set(sitemap.match(/<lastmod>[^<]+<\/lastmod>/g) || []);
assert(distinct.size > 1, 'every sitemap URL has the same <lastmod>: pages are being dated by the build, not by their history');

console.log(`Page dates: PASS (${checked} served pages dated from their text history; ${distinct.size} distinct sitemap dates)`);
