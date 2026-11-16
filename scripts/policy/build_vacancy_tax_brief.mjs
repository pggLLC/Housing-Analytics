#!/usr/bin/env node
// Builds the computed parts of the vacancy tax research brief
// (data/policy_briefs_curated.json, id co-vacancy-tax-2026) and its picture
// (assets/briefs/vacancy-tax-2026/revenue-by-town.svg) from:
//   data/policy/vacancy-tax.json        measures, cases, municipal types, gaps
//   data/hna/vacancy-status.json        ACS 2020-2024 B25004
//   data/hna/housing-units-b25001.json  ACS 2020-2024 B25001
// The prose is written by hand in the feed; the tables, the figure's alt text
// and the limits list are rebuilt here so a data change cannot leave them stale.
//
// Usage:
//   node scripts/policy/build_vacancy_tax_brief.mjs           write
//   node scripts/policy/build_vacancy_tax_brief.mjs --check   fail if anything committed differs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefRows, money, pct, count } from './vacancy-tax.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRIEF_ID = 'co-vacancy-tax-2026';
export const FEED = 'data/policy_briefs_curated.json';
export const SVG = 'assets/briefs/vacancy-tax-2026/revenue-by-town.svg';
export const FIGURE_ROWS = 15;

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATUS = {
  adopted: 'Adopted by voters',
  failing_unofficial: 'Failing (unofficial count)',
  failed: 'Failed at the ballot',
  not_referred: 'Council did not send it to voters',
};
const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function measureRows(tax) {
  return tax.measures.map((m) => [
    m.jurisdiction,
    `${m.measure}: ${STATUS[m.status] || m.status}, ${longDate(m.decided)}`,
    m.rate,
    m.expected_revenue_usd == null ? m.expected_revenue_note : `$${m.expected_revenue_usd.toLocaleString('en-US')} a year. ${m.expected_revenue_note}`,
    m.use,
  ]);
}

export function levyRows(rows) {
  return rows.map((r) => [
    r.name,
    `${money(r.middle)} (${money(r.low)} to ${money(r.high)})`,
    pct(r.base_share),
    count(r.seasonal, r.seasonal_moe),
  ]);
}

export function statutoryRows(rows) {
  return rows.map((r) => [`${r.name} (${r.type.toLowerCase()})`, money(r.middle), pct(r.base_share), count(r.seasonal, r.seasonal_moe)]);
}

export function caseRows(est) {
  return ['low', 'middle', 'high'].map((k) => {
    const c = est.cases[k];
    return [k[0].toUpperCase() + k.slice(1), pct(c.seasonal_share), pct(c.other_share), pct(c.collected)];
  });
}

export function figureAlt(rows, est) {
  return `Dot-and-range chart of the yearly revenue a $${est.rate_usd.toLocaleString('en-US')} vacancy tax could raise, paid by owners of vacant homes, in the ${rows.length} home-rule places with the largest middle case. ` +
    rows.map((r) => `${r.name}: middle ${money(r.middle)}, range ${money(r.low)} to ${money(r.high)}`).join('; ') + '.';
}

export function figureSvg(rows, est, asOf) {
  const W = 420, left = 16, right = 404, y0 = 92, rh = 36;
  const max = Math.max(...rows.map((r) => r.high));
  const step = max > 15e6 ? 5e6 : max > 6e6 ? 2e6 : 1e6;
  const top = max;
  const x = (v) => left + (v / top) * (right - left - 52);
  const H = y0 + rows.length * rh + 54;
  const t = (X, Y, s, size, weight, fill, anchor = 'start') =>
    `<text x="${X.toFixed(1)}" y="${Y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<title id="t">What a $${est.rate_usd.toLocaleString('en-US')} vacancy tax could raise a year</title>`,
    `<desc id="d">${esc(figureAlt(rows, est))}</desc>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    t(16, 24, `What a $${est.rate_usd.toLocaleString('en-US')} vacancy tax could raise a year`, 16, 700, '#1d2329'),
    t(16, 44, 'Home-rule places. Dot: middle case. Line: low to high case.', 12, 400, '#55606b'),
    t(16, 62, 'Paid by owners of vacant homes; renters pay nothing.', 12, 400, '#55606b'),
  ];
  for (let v = 0; v <= top + 1; v += step) {
    out.push(`<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${y0 - 14}" y2="${y0 + rows.length * rh - 6}" stroke="#e3e6ea"/>`);
    out.push(t(x(v), y0 + rows.length * rh + 10, v === 0 ? '$0' : `$${v / 1e6}M`, 11, 400, '#55606b', 'middle'));
  }
  rows.forEach((r, i) => {
    const y = y0 + i * rh;
    out.push(t(16, y - 2, r.name, 12, 600, '#1d2329'));
    const ly = y + 12;
    out.push(`<line x1="${x(r.low).toFixed(1)}" x2="${x(r.high).toFixed(1)}" y1="${ly}" y2="${ly}" stroke="#1f5f99" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>`);
    out.push(`<circle cx="${x(r.middle).toFixed(1)}" cy="${ly}" r="5.5" fill="#1f5f99"/>`);
    out.push(t(x(r.high) + 8, ly + 4, money(r.middle), 12, 700, '#1d2329'));
  });
  out.push(t(16, H - 12, `Source: COHO estimate, ACS 2020-2024 B25004 and B25001. As of ${asOf}.`, 10, 400, '#55606b'));
  out.push('</svg>');
  return out.join('\n') + '\n';
}

export function build() {
  const tax = read('data/policy/vacancy-tax.json');
  const vac = read('data/hna/vacancy-status.json');
  const hu = read('data/hna/housing-units-b25001.json');
  const feed = read(FEED);
  const est = tax.meta.estimate;
  const { levy, statutory } = briefRows(tax, vac, hu);
  const brief = feed.briefs.find((b) => b.id === BRIEF_ID);
  if (!brief) throw new Error(`${FEED} has no brief ${BRIEF_ID}`);
  const sec = (id) => {
    const s = brief.sections.find((x) => x.id === id);
    if (!s) throw new Error(`${BRIEF_ID}: no section ${id}`);
    return s;
  };
  sec('tried').table.rows = measureRows(tax);
  sec('estimates').table.rows = levyRows(levy);
  sec('estimates').figure.alt = figureAlt(levy.slice(0, FIGURE_ROWS), est);
  sec('statutory').table.rows = statutoryRows(statutory);
  sec('method').table.rows = caseRows(est);
  sec('limits').items = [...tax.meta.known_gaps];
  feed.meta.brief_count = feed.briefs.length;
  return {
    [FEED]: JSON.stringify(feed, null, 2) + '\n',
    [SVG]: figureSvg(levy.slice(0, FIGURE_ROWS), est, tax.meta.as_of),
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
    if (check) { console.error(`${rel} is stale: run node scripts/policy/build_vacancy_tax_brief.mjs`); stale++; continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    console.log(`wrote ${rel}`);
  }
  if (stale) process.exit(1);
  if (check) console.log('vacancy tax brief: up to date');
}
