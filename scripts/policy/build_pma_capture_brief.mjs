#!/usr/bin/env node
// Builds the computed parts of the market area and capture rate research brief
// (data/policy_briefs_curated.json, id co-pma-capture-small-town-2026) and its
// picture (assets/briefs/pma-capture-2026/capture-by-design.svg) from
// data/policy/pma-capture-example.json: CHFA's rules, the precedents, the
// market area designs and the in-migration cases for an anonymous small town.
// The prose is written by hand in the feed; the tables, the figure's alt text,
// the method and the limits list are rebuilt here so a data change cannot leave
// them stale.
//
// Usage:
//   node scripts/policy/build_pma_capture_brief.mjs           write
//   node scripts/policy/build_pma_capture_brief.mjs --check   fail if anything committed differs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRIEF_ID = 'co-pma-capture-small-town-2026';
export const DATA = 'data/policy/pma-capture-example.json';
export const FEED = 'data/policy_briefs_curated.json';
export const SVG = 'assets/briefs/pma-capture-2026/capture-by-design.svg';
export const LIMIT = 85;

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => v.toLocaleString('en-US');
const p1 = (v) => `${v.toFixed(1)}%`;

export function ruleRows(ex) {
  return ex.rules.map((r) => [r.topic, r.rule, `QAP p. ${r.source.page}`]);
}

export function designRows(ex) {
  return ex.designs.map((d) => [
    d.short,
    d.family,
    `${n(d.land_sq_mi)}`,
    `${n(d.qualified_renter_households)}`,
    `${n(d.existing_comparable_homes)}`,
    p1(d.capture),
    `${d.highest_ami_level}% AMI: ${p1(d.highest_ami_rate)}`,
    `${d.rental_vacancy}%`,
  ]);
}

export function projectRows(ex) {
  const mix = ex.meta.project.mix;
  return [...Object.keys(mix).map((k) => [`${k}% AMI`, String(mix[k])]), ['All homes', String(ex.meta.project.homes)]];
}

export function inMigrationRows(ex) {
  return ex.in_migration.map((c) => [`${c.outside_share}%`, c.basis, n(c.qualifying), p1(c.capture)]);
}

export function precedentRows(ex) {
  return ex.precedents.map((r) => [r.project, r.round, r.setting, r.in_migration, r.capture, r.basis]);
}

const short = (d) => d.short;

export function figureAlt(ex) {
  return `Bar chart of the CHFA capture rate for the same ${ex.meta.project.homes}-home family project in the same small town under ${ex.designs.length} ways of drawing the market area, counting renter households only, with CHFA's ${LIMIT}% limit marked. ` +
    ex.designs.map((d) => `${d.label} (${d.family.toLowerCase()}): ${p1(d.capture)}`).join('; ') + '.';
}

export function figureSvg(ex) {
  const W = 420, left = 16, right = 404, y0 = 122, rh = 30;
  const rows = ex.designs;
  const top = Math.max(140, Math.ceil(Math.max(...rows.map((d) => d.capture)) / 20) * 20);
  const x = (v) => left + (v / top) * (right - left - 44);
  const H = y0 + rows.length * rh + 52;
  const t = (X, Y, s, size, weight, fill, anchor = 'start') =>
    `<text x="${X.toFixed(1)}" y="${Y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<title id="t">One project, ${rows.length} market areas: the CHFA capture rate</title>`,
    `<desc id="d">${esc(figureAlt(ex))}</desc>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    t(16, 24, `One project, ${rows.length} market areas: CHFA capture rate`, 16, 700, '#1d2329'),
    t(16, 44, `Same ${ex.meta.project.homes} family homes, same small town. Renter households only.`, 12, 400, '#55606b'),
    t(16, 62, `Dashed line: CHFA's ${LIMIT}% limit. Dark bars: whole census tracts,`, 12, 400, '#55606b'),
    t(16, 78, 'the only shape CHFA accepts. Light bars: not allowed as drawn.', 12, 400, '#55606b'),
  ];
  for (let v = 0; v <= top; v += 20) {
    out.push(`<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${y0 - 12}" y2="${y0 + rows.length * rh - 8}" stroke="#e3e6ea"/>`);
    out.push(t(x(v), y0 + rows.length * rh + 6, `${v}%`, 11, 400, '#55606b', 'middle'));
  }
  rows.forEach((d, i) => {
    const y = y0 + i * rh;
    out.push(t(16, y - 1, `${short(d)} · ${d.family.toLowerCase()}`, 11, 600, '#1d2329'));
    const fill = d.whole_tracts ? '#1f5f99' : '#9db8d3';
    out.push(`<rect x="${x(0).toFixed(1)}" y="${y + 4}" width="${(x(Math.min(d.capture, top)) - x(0)).toFixed(1)}" height="11" rx="2" fill="${fill}"/>`);
    out.push(t(x(Math.min(d.capture, top)) + 5, y + 14, p1(d.capture), 11, 700, '#1d2329'));
  });
  out.push(`<line x1="${x(LIMIT).toFixed(1)}" x2="${x(LIMIT).toFixed(1)}" y1="${y0 - 30}" y2="${y0 + rows.length * rh - 8}" stroke="#b3261e" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  out.push(t(x(LIMIT) + 4, y0 - 20, `${LIMIT}% limit`, 11, 700, '#b3261e'));
  out.push(t(16, H - 26, 'Source: COHO estimate; HUD CHAS 2018-2022, ACS 2020-2024, HUD LIHTC,', 10, 400, '#55606b'));
  out.push(t(16, H - 12, `LODES 2024, CHFA 2027-2028 QAP rules. As of ${ex.meta.as_of}.`, 10, 400, '#55606b'));
  out.push('</svg>');
  return out.join('\n') + '\n';
}

export function build() {
  const ex = read(DATA);
  const feed = read(FEED);
  const brief = feed.briefs.find((b) => b.id === BRIEF_ID);
  if (!brief) throw new Error(`${FEED} has no brief ${BRIEF_ID}`);
  const sec = (id) => {
    const s = brief.sections.find((x) => x.id === id);
    if (!s) throw new Error(`${BRIEF_ID}: no section ${id}`);
    return s;
  };
  sec('rules').table.rows = ruleRows(ex);
  sec('example').table.rows = projectRows(ex);
  sec('designs').table.rows = designRows(ex);
  sec('designs').figure.alt = figureAlt(ex);
  sec('in-migration').table.rows = inMigrationRows(ex);
  sec('precedents').table.rows = precedentRows(ex);
  sec('method').paragraphs = [ex.meta.method, ex.meta.capture_formula];
  sec('limits').items = [...ex.meta.known_gaps];
  brief.verified = ex.meta.last_verified;
  feed.meta.brief_count = feed.briefs.length;
  return {
    [FEED]: JSON.stringify(feed, null, 2) + '\n',
    [SVG]: figureSvg(ex),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = build();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, body] of Object.entries(files)) {
    const full = join(ROOT, rel);
    const now = existsSync(full) ? readFileSync(full, 'utf8') : null;
    if (now === body) continue;
    if (check) { console.error(`${rel} is stale: run node scripts/policy/build_pma_capture_brief.mjs`); stale++; continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    console.log(`wrote ${rel}`);
  }
  if (stale) process.exit(1);
  if (check) console.log('market area capture brief: up to date');
}
