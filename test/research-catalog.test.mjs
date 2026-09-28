/**
 * Research & Analysis and the Housing News "Latest research" panel: one list.
 *
 * Until 2026-09-28 insights.html listed articles as typed cards and the
 * Housing News panel listed curated briefs, and neither showed the other's.
 * Several cards also claimed currency they did not have: a "Published Feb
 * 10, 2026" card for a live-data page, a "$287M" figure the page it linked had
 * already removed, and a trends block last checked in March shown as current.
 * Both now render from data/insights/catalog.json plus the curated briefs
 * (js/components/research-catalog.js). This guard renders both pages from the
 * committed data and asserts:
 *   - every catalog entry and every curated brief is on the hub exactly once;
 *   - each card says how current it is, from the right place: a reviewed item
 *     shows the check date held by the file it names, a dated item its
 *     publication date, a live-data page says so;
 *   - the Housing News panel shows the hub's newest dated research, in order;
 *   - the no-JavaScript fallback lists exactly the catalog's pages.
 * The expected values are recomputed here from the data files, not taken
 * from the renderer.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const CATALOG = json('data/insights/catalog.json');
const CURATED = json('data/policy_briefs_curated.json');
const BASE = 'https://pggllc.github.io/Housing-Analytics/';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const briefs = CURATED.briefs.filter((b) => b.is_curated);

function stubFetch(window) {
  window.fetch = (url) => {
    const p = new URL(String(url), BASE).pathname;
    const rel = p.slice(p.indexOf('data/'));
    if (rel.startsWith('data/') && fs.existsSync(path.join(ROOT, rel))) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(json(rel)) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  };
}

async function hub() {
  const dom = new JSDOM(read('insights.html'), {
    runScripts: 'dangerously', url: BASE + 'insights.html',
    beforeParse(window) {
      stubFetch(window);
      window.eval(read('js/components/review-status.js'));
      window.eval(read('js/components/research-catalog.js'));
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 300 && !doc.querySelector('.rc-card'); i++) await new Promise((r) => setTimeout(r, 5));
  return doc;
}

async function news() {
  const dom = new JSDOM(read('policy-briefs.html'), {
    runScripts: 'dangerously', url: BASE + 'policy-briefs.html',
    beforeParse(window) {
      stubFetch(window);
      window.console.warn = () => {};
      window.eval(read('js/workflow/recommendation-contract.js'));
      window.eval(read('js/components/policy-watch.js'));
      window.eval(read('js/components/research-catalog.js'));
    },
  });
  const doc = dom.window.document;
  for (let i = 0; i < 300 && !doc.querySelector('#researchList .research-card'); i++) await new Promise((r) => setTimeout(r, 5));
  return doc;
}

// Expected review dates, straight from the files the catalog names.
function expectedCheck(entry) {
  const doc = json(entry.review_from.file);
  if (entry.review_from.ids) {
    return entry.review_from.ids.map((id) => doc.entries.find((e) => e.id === id).last_verified).sort()[0];
  }
  return doc.meta.last_verified || doc.meta.as_of;
}

test('the catalog is well formed and points at real pages and files', () => {
  const sections = new Set(CATALOG.meta.sections.map((s) => s.key));
  assert.ok(CATALOG.entries.length >= 10, 'the catalog is nearly empty; this guard would pass vacuously');
  const ids = new Set();
  for (const e of CATALOG.entries) {
    assert.ok(!ids.has(e.id), `duplicate catalog id ${e.id}`); ids.add(e.id);
    assert.ok(sections.has(e.section), `${e.id}: unknown section ${e.section}`);
    assert.ok(fs.existsSync(path.join(ROOT, e.url)), `${e.id}: ${e.url} does not exist`);
    assert.ok(['reviewed', 'dated', 'generated', 'live-data'].includes(e.maintenance), `${e.id}: unknown maintenance ${e.maintenance}`);
    if (e.maintenance === 'dated' || e.maintenance === 'generated') assert.match(e.published || '', /^\d{4}-\d{2}-\d{2}$/, `${e.id} has no publication date`);
    if (e.review_from) {
      assert.ok(fs.existsSync(path.join(ROOT, e.review_from.file)), `${e.id}: ${e.review_from.file} does not exist`);
      for (const id of e.review_from.ids || []) {
        assert.ok(json(e.review_from.file).entries.some((x) => x.id === id), `${e.id}: ${id} is not in ${e.review_from.file}`);
      }
    }
    if (e.maintenance === 'reviewed') assert.ok(e.review_from, `${e.id} is reviewed but names no file to take its dates from`);
    assert.ok(!('last_verified' in e) && !('review_by' in e), `${e.id} copies review dates; name the file that holds them instead`);
  }
});

test('the hub lists every catalog entry and brief once, each saying how current it is', async () => {
  const doc = await hub();
  const cards = [...doc.querySelectorAll('#researchCatalog .rc-card')];
  const shown = cards.map((c) => c.dataset.catalogId).sort();
  const expected = [...CATALOG.entries.map((e) => e.id), ...briefs.map((b) => 'brief:' + b.id)].sort();
  assert.deepEqual(shown, expected, 'the hub does not show exactly the catalog and the curated briefs');
  for (const e of CATALOG.entries) {
    const card = cards.find((c) => c.dataset.catalogId === e.id);
    const date = card.querySelector('.rc-card__date').textContent;
    assert.equal(card.querySelector('a').getAttribute('href'), e.url);
    if (e.maintenance === 'reviewed') assert.equal(date, `Checked ${fmt(expectedCheck(e))}`, `${e.id}: "${date}"`);
    if (e.maintenance === 'dated' || e.maintenance === 'generated') assert.ok(date.startsWith(`Published ${fmt(e.published)}`), `${e.id}: "${date}"`);
    if (e.maintenance === 'live-data') assert.match(date, /^Live data/, `${e.id}: "${date}"`);
  }
  for (const b of briefs) {
    const card = cards.find((c) => c.dataset.catalogId === 'brief:' + b.id);
    assert.equal(card.querySelector('.rc-card__date').textContent, `Published ${fmt(b.generated)}`);
    assert.equal(new URL(card.querySelector('a').href).searchParams.get('id'), b.id);
  }
});

test('the Housing News panel shows the hub\'s newest dated research, in order', async () => {
  const [hubDoc, newsDoc] = await Promise.all([hub(), news()]);
  const dated = [
    ...CATALOG.entries.filter((e) => e.section === 'analysis' && e.published).map((e) => ({ id: e.id, published: e.published })),
    ...briefs.map((b) => ({ id: 'brief:' + b.id, published: b.generated.slice(0, 10) })),
  ].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 3).map((x) => x.id);
  assert.equal(dated.length, 3, 'fewer than three dated research items; the panel check would be trivial');
  const panel = [...newsDoc.querySelectorAll('#researchList .research-card')].map((c) => c.dataset.catalogId);
  assert.deepEqual(panel, dated, 'the Housing News panel is not the newest three dated research items');
  const hubAnalysis = [...hubDoc.querySelectorAll('[data-catalog-section="analysis"] .rc-card')].map((c) => c.dataset.catalogId);
  assert.deepEqual(hubAnalysis.slice(0, 3), dated, 'the hub\'s analysis section does not lead with the same items');
});

test('without JavaScript the hub still lists every catalog page', () => {
  const doc = new JSDOM(read('insights.html')).window.document;
  const noscript = doc.querySelector('#researchCatalog noscript');
  assert.ok(noscript, 'the hub has no no-JavaScript fallback');
  // With scripting off, jsdom parses <noscript> content as elements.
  const hrefs = [...new JSDOM(noscript.innerHTML).window.document.querySelectorAll('a')].map((a) => a.getAttribute('href')).sort();
  assert.ok(hrefs.length > 0, 'the fallback lists no links');
  assert.deepEqual(hrefs, CATALOG.entries.map((e) => e.url).sort(), 'the fallback list and the catalog disagree');
});
