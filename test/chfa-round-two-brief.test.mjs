/**
 * The CHFA 2026 Round Two brief is pinned to its data, not its wording: the
 * bridge file's rows must add up to the totals CHFA prints (quoted in the file),
 * every award's income mix must add up to its homes, the brief must be exactly
 * what scripts/policy/build_chfa_round_two_brief.mjs builds from the data, and
 * the reader must load the map for it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build, buildBrief, BRIEF_ID, BRIDGE, FEED, LEDGER, COUNTS, AMI_BANDS } from '../scripts/policy/build_chfa_round_two_brief.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const R2 = json(BRIDGE);
const M = R2.metadata;
const feed = json(FEED);
const brief = feed.briefs.find((b) => b.id === BRIEF_ID);
const money = (s) => Number(String(s).replace(/[$,]/g, ''));

test('the award rows add up to the totals CHFA prints', () => {
  const quote = M.source_quotes.award_report_totals;
  const T = M.award_report_totals;
  assert.ok(quote.includes(`$${T.federal_4pct.toLocaleString('en-US')}`), 'federal total is in the quote');
  for (const k of ['accelerated_state', 'standard_state', 'toc', 'pab']) assert.ok(quote.includes(`$${T[k].toLocaleString('en-US')}`), `${k} is in the quote`);
  const sum = (f) => R2.awards.reduce((s, a) => s + (a[f] || 0), 0);
  assert.equal(sum('total_units'), T.total_units);
  assert.equal(R2.awards.length, M.press_release_total_developments);
  assert.equal(sum('total_units'), M.press_release_total_units);
  assert.ok(M.source_quotes.press_release.includes(`${M.press_release_total_units} affordable rental units`));
  // CHFA's PDF rounds: its rows add to one dollar more than its printed federal total
  assert.ok(Math.abs(sum('federal_4pct_credit') - T.federal_4pct) <= 1, 'federal credit rows');
  assert.equal(sum('accelerated_state_credit'), T.accelerated_state);
  assert.equal(sum('standard_state_credit'), T.standard_state);
  assert.equal(sum('toc_credit'), T.toc);
  assert.equal(sum('pab_amount'), T.pab);
  for (const a of R2.awards) assert.equal(a.state_credit, (a.accelerated_state_credit || 0) + (a.standard_state_credit || 0), `${a.name}: state_credit`);
});

test('every award\'s income mix adds up to its homes, and quotes CHFA\'s line', () => {
  for (const a of R2.awards) {
    const n = AMI_BANDS.reduce((s, b) => s + (a.ami_mix[b] || 0), 0);
    assert.equal(n, a.total_units, `${a.name}: AMI mix`);
    for (const b of AMI_BANDS) if (a.ami_mix[b]) assert.ok(a.ami_mix_raw.includes(`${a.ami_mix[b]} @ ${b}% AMI`), `${a.name}: ${b}% in the raw line`);
  }
});

test('a set-aside CHFA describes is shown, and its number is CHFA\'s', () => {
  const words = { 8: 'eight', 15: '15' };
  const rows = buildBrief(R2, json(LEDGER), json(COUNTS)).sections.find((s) => s.id === 'awards').table.rows;
  for (const a of R2.awards) {
    if (/set aside to serve households|Foster Youth/i.test(a.description)) assert.ok(a.set_aside, `${a.name}: CHFA lists a set-aside`);
    if (!a.set_aside) continue;
    const n = Number(a.set_aside.match(/\d+/)[0]);
    assert.ok(a.description.includes(words[n] || String(n)), `${a.name}: ${n} is in CHFA's description`);
    assert.ok(rows.find((r) => r[0] === a.name)[3].endsWith(a.set_aside), `${a.name}: shown in Who it serves`);
  }
});

test('applications not awarded and awards add up to the applicant report', () => {
  const T = M.applicant_report_totals;
  assert.ok(M.source_quotes.applicant_report_totals.includes(T.total_units.toLocaleString('en-US')));
  assert.equal(R2.awards.length + R2.not_awarded.length, M.applicants);
  const homes = [...R2.awards, ...R2.not_awarded].reduce((s, a) => s + a.total_units, 0);
  assert.equal(homes, T.total_units);
  const names = new Set(R2.awards.map((a) => a.name));
  for (const a of R2.not_awarded) assert.ok(!names.has(a.name), `${a.name} is listed as both`);
  // the not-awarded list agrees with the applications file's outcomes
  const apps = json('data/jurisdiction-briefs/_lihtc-applications.json').applications.filter((a) => a.round_label === '2026 Round Two');
  assert.deepEqual(apps.filter((a) => a.outcome === 'not_awarded').map((a) => a.name).sort(), R2.not_awarded.map((a) => a.name).sort());
  assert.deepEqual(apps.filter((a) => a.outcome === 'awarded').map((a) => a.name).sort(), [...names].sort());
});

test('points sit in Colorado and carry no contact fields', () => {
  for (const a of [...R2.awards, ...R2.not_awarded]) {
    assert.ok(a.lat > 36.99 && a.lat < 41.01 && a.lon > -109.07 && a.lon < -102.03, `${a.name}: outside Colorado`);
    assert.match(a.county_fips, /^08\d{3}$/);
    for (const k of Object.keys(a)) assert.ok(!/contact|email|phone/i.test(k), `${a.name}: ${k}`);
  }
  assert.ok(!/@[a-z0-9-]+\.[a-z]/i.test(read(BRIDGE)), 'an email address is in the file');
});

test('the brief is what the builder makes from the data', () => {
  assert.ok(brief, `curated feed has no ${BRIEF_ID}`);
  assert.equal(brief.is_curated, true);
  assert.equal(brief.source_reviewed, true);
  assert.equal(brief.related_data, BRIDGE);
  assert.deepEqual(brief, buildBrief(R2, json(LEDGER), json(COUNTS)));
  assert.equal(build()[FEED], read(FEED), 'run node scripts/policy/build_chfa_round_two_brief.mjs');
  assert.equal(feed.meta.brief_count, feed.briefs.length);
});

test('the brief\'s tables are the data, row for row', () => {
  const sec = (id) => brief.sections.find((s) => s.id === id);
  const aw = sec('awards').table.rows;
  assert.equal(aw.length, R2.awards.length);
  aw.forEach((r, i) => {
    const a = R2.awards[i];
    assert.equal(r[0], a.name);
    assert.equal(Number(r[2].replace(/,/g, '')), a.total_units);
    assert.equal(money(r[5]), a.federal_4pct_credit);
    assert.equal(money(r[6]), (a.accelerated_state_credit || 0) + (a.standard_state_credit || 0) + (a.toc_credit || 0));
  });
  const lost = sec('not-awarded').table.rows;
  assert.equal(lost.length, R2.not_awarded.length);
  lost.forEach((r, i) => {
    const a = R2.not_awarded[i];
    assert.equal(r[0], a.name);
    assert.equal(money(r[4]), a.federal_4pct_requested);
  });
  const hist = sec('history').table.rows;
  assert.deepEqual(hist.map((r) => r[0]), ['2023', '2024', '2025', '2026']);
  assert.equal(hist[3][2], String(R2.awards.length));
  assert.equal(hist[3][1], String(M.applicants));
});

test('every source the brief cites is CHFA\'s, dated, and quoted', () => {
  for (const a of brief.articles) {
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(a.link, /^https:\/\/www\.chfainfo\.com\//);
  }
  for (const q of brief.source_quotes) {
    assert.ok(brief.articles.some((a) => a.link === q.link), `quote without an article: ${q.link}`);
    assert.ok(q.quote.length > 20);
  }
});

test('the reader loads the Round Two map for this brief only', () => {
  const html = read('research-brief.html');
  assert.match(html, /item\.map === 'chfa-round-two'/);
  assert.match(html, /js\/chfa-round-two-map\.js/);
  const js = read('js/chfa-round-two-map.js');
  assert.ok(js.includes(BRIDGE) && js.includes('data/boundaries/counties_co.geojson'));
  assert.match(js, /COHOBasemaps\.standard/, 'streets + satellite switch, as every site map');
  assert.equal(brief.sections.filter((s) => s.map === 'chfa-round-two').length, 1);
  assert.equal(feed.briefs.filter((b) => (b.sections || []).some((s) => s.map === 'chfa-round-two')).length, 1);
});
