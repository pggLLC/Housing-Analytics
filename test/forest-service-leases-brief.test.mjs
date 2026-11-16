/**
 * The Forest Service site-lease brief is pinned to what it must agree with, not to its wording:
 * the county table is recomputed from data/policy/forest-service-admin-sites.json (offices, forest
 * share), data/hna/workforce-need.json (worker households, one in four moving closer),
 * data/hna/chas_affordable_available.json (renters at or below 50% short of a home) and
 * data/dda-colorado.json (2026 boost areas); the statewide counts in its prose are the data file's;
 * every other figure in its prose sits in a recorded quote from a cited source. The reader must
 * render it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const FEED = json('data/policy_briefs_curated.json');
const FS = json('data/policy/forest-service-admin-sites.json');
const WF = json('data/hna/workforce-need.json');
const CHAS = json('data/hna/chas_affordable_available.json');
const DDA = json('data/dda-colorado.json');
const ID = 'forest-service-admin-site-leases-2026';
const brief = FEED.briefs.find((b) => b.id === ID);
const section = (id) => brief.sections.find((s) => s.id === id);
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const fmt = (n) => n.toLocaleString('en-US');
const byName = Object.fromEntries(Object.entries(FS.counties).map(([g, c]) => [c.name.replace(/ County$/, ''), g]));
// HUD's 2027 nonmetro list (91 FR 63573; the ArcGIS layer named 2026 has held it since 2026-10-23,
// see scripts/hud/designation-year.js). The 2026 column itself is read from data/dda-colorado.json.
const DDA_2027 = { '08015': 'added', '08007': 'added', '08113': 'dropped' };

test('the brief is curated, dated and names the data it is checked against', () => {
  assert.ok(brief, `curated feed has no ${ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, 'data/policy/forest-service-admin-sites.json');
  assert.equal(FS.meta.brief, ID);
  assert.match(brief.verified, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(FEED.meta.brief_count, FEED.briefs.length);
});

test('the data file covers all 64 counties and every office sits in one of them', () => {
  assert.equal(Object.keys(FS.counties).length, 64);
  for (const g of Object.keys(FS.counties)) assert.match(g, /^08\d{3}$/);
  assert.equal(FS.offices.length, FS.meta.office_count);
  for (const o of FS.offices) assert.ok(FS.counties[o.county_geoid], `${o.name}: no county`);
  for (const [g, c] of Object.entries(FS.counties)) {
    assert.equal(c.office_count, FS.offices.filter((o) => o.county_geoid === g).length, `${c.name}: office count`);
    assert.ok(c.nfs_share >= 0 && c.nfs_share <= 1, `${c.name}: share`);
  }
});

test('the county table is the data, row for row', () => {
  const rows = section('counties').table.rows;
  assert.ok(rows.length >= 10, 'too few rows to compare');
  const dda26 = new Set(DDA.features.filter((f) => f.properties.DDA_KIND === 'county').map((f) => f.properties.GEOID));
  for (const r of rows) {
    const g = byName[r[0]];
    assert.ok(g, `${r[0]} is not a county`);
    const c = FS.counties[g];
    assert.ok(c.office_count > 0, `${r[0]} is listed but has no Forest Service office`);
    assert.equal(r[1], c.office_cities.join(', '), `${r[0]}: offices`);
    assert.equal(r[2], `${Math.round(c.nfs_share * 100)}%`, `${r[0]}: forest share`);
    assert.equal(r[3], fmt(WF.counties[g].present_incommuter_need.move_closer_25), `${r[0]}: worker households`);
    assert.equal(r[4], fmt(CHAS.counties[g].tiers['50'].homes_short), `${r[0]}: renter shortfall`);
    assert.ok(r[5].startsWith(dda26.has(g) ? 'Yes' : 'No'), `${r[0]}: 2026 boost area`);
    assert.equal(r[5].includes('for 2027'), g in DDA_2027, `${r[0]}: 2027 note`);
    if (g in DDA_2027) assert.ok(r[5].includes(DDA_2027[g]), `${r[0]}: 2027 change`);
  }
  assert.equal(rows[0][0], 'Summit', 'the first signed lease leads');
});

test('the statewide counts in the county section are the data file\'s', () => {
  const text = section('counties').paragraphs[0];
  const counties = Object.values(FS.counties);
  const withLand = counties.filter((c) => c.nfs_acres > 0).length;
  const withOffice = counties.filter((c) => c.office_count > 0).length;
  const towns = counties.reduce((n, c) => n + c.towns_within_1_mile.length, 0);
  assert.ok(text.startsWith(`${withLand} of Colorado's 64 counties`), 'counties with forest land');
  assert.ok(text.includes(`${withOffice} have a Forest Service office`), 'counties with an office');
  assert.ok(text.includes(`${towns} of the state's 272 towns`), 'towns within a mile');
  assert.match(section('counties').table.caption, /as of November 16, 2026/);
  const note = section('counties').note;
  assert.ok(note.includes(WF.meta.income_cut_label.replace('households ', '').replace('area median income', '')), 'note names the income cut');
  assert.ok(note.includes(CHAS.meta.vintage), 'note names the CHAS vintage');
});

test('renters and owners are kept apart', () => {
  const text = section('counties').paragraphs.join(' ');
  assert.match(text, /rental housing/);
  assert.match(text, /homes people own/);
  assert.match(section('counties').table.columns[4], /^Renter/);
});

// Citations are names, not figures: Pub. L. 115-334, sec. 8623, 36 CFR 251.50, 91 FR 68887.
const CITATION = /\bPub\. L\. \d+-\d+|\bsec(?:tion)?\.? \d+\b|\b36 CFR [\d.]+(?: and [\d.]+)?|\b\d+ FR \d+|\b\d+ U\.S\.C\. [\d\w ]+/gi;
const FIGURE = /\$\d[\d,]*|\d+(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+\b|\b(?!(?:19|20)\d{2}\b)[1-9]\d+\b/g;
function prose() {
  const parts = [brief.title, brief.takeaway, brief.summary, brief.implications];
  for (const s of brief.sections) {
    if (s.id === 'counties') continue; // pinned to the data above
    parts.push(...(s.paragraphs || []), ...(s.items || []));
  }
  parts.push(...section('counties').table.rows.map((r) => r[6])); // the "on record" column is quoted
  return squash(parts.join(' ')).replace(CITATION, '');
}

test('every figure in the prose sits in a recorded quote from a cited source', () => {
  const cited = new Set(brief.articles.map((a) => a.link));
  for (const q of brief.source_quotes) assert.ok(cited.has(q.link), `quote from an uncited source: ${q.link}`);
  const quoted = squash(brief.source_quotes.map((q) => q.quote).join(' ')).replace(/(\d+) percent/g, '$1%');
  const figures = prose().match(FIGURE) || [];
  assert.ok(figures.length >= 15, `the scan found only ${figures.length} figures`);
  for (const f of figures) assert.ok(quoted.includes(f), `${f} is in the brief but in no source quote`);
});

test('the deadline and the rule dates are the quoted ones', () => {
  const quoted = brief.source_quotes.map((q) => q.quote).join(' ');
  assert.match(quoted, /effective December 2, 2026/);
  assert.match(quoted, /inserting "2028"|inserting ``2028''/);
  assert.match(brief.takeaway, /December 2, 2026/);
  assert.match(brief.takeaway, /October 1, 2028/);
  assert.match(section('deadline').heading, /October 1, 2028/);
});

test('the old reader renders every section, list and table the feed carries', async (t) => {
  const dom = new JSDOM(read('research-brief.html'), {
    url: 'https://pggllc.github.io/Housing-Analytics/research-brief.html?id=' + ID,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => structuredClone(FEED) });
      window.print = () => {};
    },
  });
  t.after(() => dom.window.close());
  const host = dom.window.document.getElementById('brief-content');
  for (let i = 0; i < 100 && host.hidden; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(host.hidden, false, 'the reader never rendered');
  for (const item of brief.sections) {
    const node = dom.window.document.querySelector(`[data-section="${item.id}"]`);
    assert.ok(node, `section ${item.id} not rendered`);
    if (item.items) assert.equal(node.querySelectorAll('li').length, item.items.length);
    if (item.table) assert.equal(node.querySelectorAll(`table[data-table="${item.id}"] tbody tr`).length, item.table.rows.length);
  }
});
