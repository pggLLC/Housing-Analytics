/**
 * The market area and capture rate brief (co-pma-capture-small-town-2026) is
 * pinned to what it must agree with, not to its wording:
 *   - every CHFA rule and every precedent in data/policy/pma-capture-example.json
 *     carries a source with a quote, a check date and a later review date, and is
 *     watched by the review reminders;
 *   - the tables, picture, method and limits are what the builder makes from the
 *     committed data (so a data change cannot leave them stale);
 *   - the capture arithmetic is rechecked here from the rounded counts;
 *   - every percent or count in the prose sits in a recorded quote from a cited
 *     source; COHO's estimates live only in the computed tables;
 *   - the example stays anonymous: no place, county, tract number or coordinates;
 *   - every figure says it counts renter households;
 *   - the reader renders every section, table and the picture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { build, BRIEF_ID, DATA, FEED, SVG, LIMIT } from '../scripts/policy/build_pma_capture_brief.mjs';
import { FILES } from '../scripts/audit/policy-review-reminders.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const EX = json(DATA);
const FEEDDATA = json(FEED);
const brief = FEEDDATA.briefs.find((b) => b.id === BRIEF_ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;

test('the brief is curated, dated and names its data file', () => {
  assert.ok(brief, `curated feed has no ${BRIEF_ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, DATA);
  assert.equal(brief.verified, EX.meta.last_verified);
  assert.match(EX.meta.as_of, DAY);
  assert.ok(EX.meta.review_by > EX.meta.as_of, 'review_by must come after as_of');
  assert.equal(FEEDDATA.meta.brief_count, FEEDDATA.briefs.length);
});

test('every rule and precedent has a quoted, dated source and a later review date', () => {
  assert.ok(EX.rules.length >= 8 && EX.precedents.length >= 5, 'too few records');
  for (const r of [...EX.rules, ...EX.precedents]) {
    assert.match(r.source.url, /^https:\/\/www\.chfainfo\.com\//, `${r.id}: source url`);
    assert.ok(r.source.quote && r.source.quote.length > 15, `${r.id}: source has no quote`);
    assert.ok(r.source.title && r.source.publisher && r.source.page > 0, `${r.id}: source is not named with a page`);
    assert.match(r.verification.checked, DAY, `${r.id}: check date`);
    assert.equal(r.verification.level, 'primary', `${r.id}: verification level`);
    assert.match(r.review_by, DAY, `${r.id}: review date`);
    assert.ok(r.review_by > r.verification.checked, `${r.id}: review_by must come after the check`);
  }
});

test('the review reminders watch every rule and precedent', () => {
  for (const key of ['rules', 'precedents']) {
    assert.ok(FILES.some((f) => f.file === DATA && f.key === key), `${key} is not watched`);
  }
});

test('the tables, picture, method and limits are what the builder makes from the committed data', () => {
  const out = build();
  assert.equal(read(FEED), out[FEED], `${FEED} is stale: run node scripts/policy/build_pma_capture_brief.mjs`);
  assert.equal(read(SVG), out[SVG], `${SVG} is stale: run node scripts/policy/build_pma_capture_brief.mjs`);
  assert.deepEqual(section('limits').items, EX.meta.known_gaps);
  assert.equal(section('designs').table.rows.length, EX.designs.length);
  assert.equal(section('precedents').table.rows.length, EX.precedents.length);
});

test('the capture arithmetic holds on the rounded counts', () => {
  const homes = EX.meta.project.homes;
  assert.equal(Object.values(EX.meta.project.mix).reduce((a, b) => a + b, 0), homes, 'mix adds to the project');
  for (const d of EX.designs) {
    // Counts are rounded to the nearest 10, so recompute with that much slack.
    const lo = (homes + Math.max(0, d.existing_comparable_homes - 5)) / (d.qualified_renter_households + 5);
    const hi = (homes + d.existing_comparable_homes + 5) / Math.max(1, d.qualified_renter_households - 5);
    assert.ok(d.capture / 100 >= lo - 0.005 && d.capture / 100 <= hi + 0.005, `${d.id}: capture ${d.capture}% is not (homes + existing) / qualified`);
    assert.ok(d.highest_ami_rate >= d.capture, `${d.id}: the hardest AMI level cannot be easier than the whole`);
    assert.equal(d.land_sq_mi % 100, 0, `${d.id}: land is not rounded`);
    assert.equal(d.qualified_renter_households % 10, 0, `${d.id}: households are not rounded`);
    assert.equal(d.existing_comparable_homes % 10, 0, `${d.id}: homes are not rounded`);
  }
  const best = EX.designs.find((d) => d.id === 'best');
  for (const id of ['r10w', 'shed5']) {
    assert.equal(EX.designs.find((d) => d.id === id).capture, best.capture, `${id} should pick the same tracts as the best fit`);
  }
  let prev = Infinity;
  for (const c of EX.in_migration) {
    assert.ok(c.capture < prev, 'more in-migration must lower the rate');
    prev = c.capture;
    assert.ok(Math.abs(c.capture - (homes / c.qualifying) * 100) < 1.5, `${c.outside_share}%: capture`);
  }
  assert.equal(EX.in_migration[0].capture, best.capture, 'the base case is the best fit');
  assert.ok(EX.designs.some((d) => d.capture > LIMIT) && EX.designs.some((d) => d.capture < LIMIT), 'the example should straddle the limit');
});

const FIGURE = /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;
const SPELLED = (t) => t.replace(/(\d+(?:\.\d+)?) percent/gi, '$1%');
function prose() {
  const parts = [brief.title, brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    if (s.id === 'limits' || s.id === 'method') continue; // the data file's own text, pinned above
    parts.push(...(s.paragraphs || []), ...(s.items || []));
  }
  return squash(parts.join(' '));
}

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  for (const r of [...EX.rules, ...EX.precedents]) assert.ok(cited.has(r.source.url), `${r.id}: ${r.source.url} is not cited`);
  for (const a of brief.articles) assert.match(a.date, DAY, `${a.title}: date`);
  const quoted = SPELLED(squash(brief.source_quotes.map((q) => q.quote).join(' ')));
  const figures = prose().replace(/\b20\d{2}-20\d{2}\b/g, '').match(FIGURE) || [];
  assert.ok(figures.length >= 10, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(quoted.includes(f), `${f} is in the brief but in no source quote`);
});

// The real place, nearby places and project names, kept only as hashes so this
// public test does not itself name the site. Each one- and two-word run of the
// published text is hashed and checked against the list.
const WITHHELD = new Set(["af72c81c0123601f","ec80b5b888d60bef","ec24c54f23e434f8","d3534f945c19afb2","f87f26c2458f8e54","5715507fc0f441a7","bcdcbeac174b93d2","68566dc699f6bb9e","6a7f5bfb6b97e894","87e94ad7d5047b37","2a32bcc092b902d7","e7c09cd48f004a86","22a2bfe27ad6f645"]);
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

test('the example stays anonymous', () => {
  const pub = [read(DATA), JSON.stringify(brief), read(SVG)].join('\n');
  const words = pub.toLowerCase().match(/[a-z]+/g) || [];
  for (let i = 0; i < words.length; i++) {
    for (const run of [words[i], `${words[i]} ${words[i + 1]}`]) assert.ok(!WITHHELD.has(hash(run)), 'the brief names a withheld place or project');
  }
  assert.equal(WITHHELD.size, 13, 'the hash list is wired up');
  assert.doesNotMatch(pub, /\b08\d{9}\b|\b\d{4}\.\d{2}\b|\b08\d{3}\b/, 'a census tract or county code');
  assert.doesNotMatch(pub, /-10[2-9]\.\d{3,}|\b(3[7-9]|40)\.\d{4,}/, 'coordinates');
  assert.match(EX.meta.method, /name, county and tracts are withheld/);
});

test('every figure says it counts renter households', () => {
  assert.match(brief.takeaway, /renter households; owners are not part of tax credit demand/);
  assert.match(section('designs').table.caption, /renter households only/);
  assert.match(section('in-migration').table.caption, /renter households/);
  assert.match(section('designs').figure.alt, /counting renter households only/);
  assert.match(read(SVG), /Renter households only/);
  assert.match(EX.meta.renter_owner, /RENTER households/);
});

test('the reader renders every section, table and the picture', async (t) => {
  const dom = new JSDOM(read('research-brief.html'), {
    url: 'https://pggllc.github.io/Housing-Analytics/research-brief.html?id=' + BRIEF_ID,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => structuredClone(FEEDDATA) });
      window.print = () => {};
    },
  });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const host = doc.getElementById('brief-content');
  for (let i = 0; i < 100 && host.hidden; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(host.hidden, false, 'the reader never rendered');
  for (const item of brief.sections) {
    const node = doc.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length, `${item.id}: list`);
    if (item.table) assert.equal(node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`).length, item.table.rows.length, `${item.id}: table`);
  }
  const img = doc.querySelector('[data-figure="designs"] img');
  assert.ok(img, 'the picture is not rendered');
  assert.equal(img.getAttribute('src'), SVG);
  assert.equal(doc.querySelectorAll('#brief-sources li').length, brief.articles.length);
});
