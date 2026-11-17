#!/usr/bin/env node
// Builds the computed parts of the tariffs research brief
// (data/policy_briefs_curated.json, id tariffs-construction-costs-2026) and its
// picture (assets/briefs/tariffs-2026/price-changes.svg) from
// data/policy/tariffs-construction-costs.json: the tariffs in force, the Bureau
// of Labor Statistics price index values, the production records and the
// Colorado permit counts.
// It also writes data/policy/tariffs-cost-note.json: the brief's conclusions as a few
// plain lines, which the construction cost pages show with a link to the brief, so
// those pages and the brief cannot disagree.
// The prose is written by hand in the feed; every table, the picture, its alt
// text and the limits list are rebuilt here so a data change cannot leave them stale.
//
// Usage:
//   node scripts/policy/build_tariffs_brief.mjs           write
//   node scripts/policy/build_tariffs_brief.mjs --check   fail if anything committed differs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BRIEF_ID = 'tariffs-construction-costs-2026';
export const FEED = 'data/policy_briefs_curated.json';
export const DATA = 'data/policy/tariffs-construction-costs.json';
export const SVG = 'assets/briefs/tariffs-2026/price-changes.svg';
export const NOTE = 'data/policy/tariffs-cost-note.json';

const read = (f) => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Percent change between two index values, to one decimal. */
export const change = (from, to) => Math.round((to / from - 1) * 1000) / 10;
export const signed = (v) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(1)}%`;

/** Every price series with its one-year change and its change since the baseline month. */
export function priceChanges(data) {
  const { baseline, year_ago: yearAgo, latest } = data.meta.months;
  return data.prices
    .map((p) => ({ ...p, year: change(p.index[yearAgo], p.index[latest]), since: change(p.index[baseline], p.index[latest]) }))
    .sort((a, b) => b.year - a.year);
}

export function tariffRows(data) {
  return data.tariffs.map((t) => [t.title, `${t.rate} ${t.since}`, t.next]);
}

export function priceRows(rows, data) {
  const base = data.meta.month_labels[data.meta.months.baseline];
  return rows.map((p) => [p.label, `${signed(p.year)} in one year. ${signed(p.since)} since ${base}.`, p.outlook]);
}

const series = (data, id) => {
  const s = data.context_series.find((x) => x.id === id);
  if (!s) throw new Error(`${DATA}: no context series ${id}`);
  return s;
};

/** A jobs series as a sentence: level now, and the change since the baseline month. */
export function jobsResult(data, id) {
  const { baseline, latest } = data.meta.months;
  const L = data.meta.month_labels;
  const s = series(data, id);
  const now = Math.round(s.index[latest] * 1000);
  const diff = Math.round((s.index[latest] - s.index[baseline]) * 1000);
  const pct = Math.abs(change(s.index[baseline], s.index[latest])).toFixed(1);
  return `${now.toLocaleString('en-US')} in ${L[latest]}, ${diff >= 0 ? 'up' : 'down'} ${Math.abs(diff).toLocaleString('en-US')} (${pct}%) since ${L[baseline]}.`;
}

export function permitsResult(data) {
  const u = data.colorado_permits.units;
  const pct = Math.abs(change(u['2025'], u['2026'])).toFixed(1);
  return `${u['2026'].toLocaleString('en-US')} from January through September 2026, ${u['2026'] < u['2025'] ? 'down' : 'up'} ${pct}% from ${u['2025'].toLocaleString('en-US')} in the same months of 2025.`;
}

export function productionRows(data) {
  const short = (p) => p.source.publisher.split(',')[0];
  const rows = data.production.map((p) => [p.title, p.result, short(p)]);
  const after = (id) => rows.findIndex((r) => r[0] === data.production.find((p) => p.id === id).title) + 1;
  const metals = series(data, 'CES3133100001');
  const wood = series(data, 'CES3132100001');
  rows.splice(after('raw-steel'), 0, [metals.label, jobsResult(data, metals.id), 'U.S. Bureau of Labor Statistics']);
  rows.splice(after('sawmills'), 0, [wood.label, jobsResult(data, wood.id), 'U.S. Bureau of Labor Statistics']);
  rows.push([data.colorado_permits.label, permitsResult(data), 'U.S. Census Bureau']);
  return rows;
}

/** Dollars added per $100 of construction contract per square foot, to the nearest 10 cents. */
export function illustration(data) {
  const { year_ago: yearAgo, latest } = data.meta.months;
  const il = data.meta.illustration;
  const high = series(data, il.rise_high_series);
  const riseHigh = change(high.index[yearAgo], high.index[latest]);
  const dollars = (share, rise) => `$${(Math.round(share * rise * 10 + 1e-9) / 10).toFixed(2)}`;
  const pct = (v) => `${Math.round(v * 100)}%`;
  return {
    riseHigh,
    rows: [
      ['Materials as a share of the construction contract (COHO assumption)', pct(il.materials_share_low), pct(il.materials_share_high)],
      ['Rise in material prices in one year', `${il.rise_low_pct.toFixed(1)}% (${il.rise_low_label})`, `${riseHigh.toFixed(1)}% (${il.rise_high_label})`],
      ['Added cost for each $100 per square foot of contract', dollars(il.materials_share_low, il.rise_low_pct), dollars(il.materials_share_high, riseHigh)],
    ],
  };
}

export function figureAlt(rows, data) {
  const L = data.meta.month_labels;
  const m = data.meta.months;
  return `Bar chart of the change in US producer prices for ${rows.length} building materials from ${L[m.year_ago]} to ${L[m.latest]}. ` +
    rows.map((r) => `${r.label}: ${signed(r.year)}`).join('; ') + '.';
}

export function figureSvg(rows, data) {
  const L = data.meta.month_labels;
  const m = data.meta.months;
  const W = 420, left = 16, y0 = 84, rh = 34;
  const max = Math.max(...rows.map((r) => r.year));
  const span = W - left - 76;
  const x = (v) => left + (Math.max(v, 0) / max) * span;
  const H = y0 + rows.length * rh + 30;
  const t = (X, Y, s, size, weight, fill, anchor = 'start') =>
    `<text x="${X.toFixed(1)}" y="${Y.toFixed(1)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<title id="t">Building material prices, change in one year</title>`,
    `<desc id="d">${esc(figureAlt(rows, data))}</desc>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    t(16, 24, 'Building material prices, change in one year', 16, 700, '#1d2329'),
    t(16, 44, `US producer prices, ${L[m.year_ago]} to ${L[m.latest]}.`, 12, 400, '#55606b'),
    t(16, 62, 'Dark bars: metal and electrical. Light bars: everything else.', 12, 400, '#55606b'),
  ];
  rows.forEach((r, i) => {
    const y = y0 + i * rh;
    out.push(t(16, y - 2, r.label, 12, 600, '#1d2329'));
    const w = Math.max(x(r.year) - left, 2);
    out.push(`<rect x="${left}" y="${y + 4}" width="${w.toFixed(1)}" height="12" rx="2" fill="${r.metal ? '#1f5f99' : '#8fb3d1'}"/>`);
    out.push(t(left + w + 8, y + 14.5, signed(r.year), 12, 700, '#1d2329'));
  });
  out.push(t(16, H - 12, `Source: U.S. Bureau of Labor Statistics Producer Price Index. As of ${data.meta.as_of}.`, 10, 400, '#55606b'));
  out.push('</svg>');
  return out.join('\n') + '\n';
}

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const listed = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] || '');
const firstSentence = (s) => (String(s).match(/^.*?\.(?=\s|$)/) || [String(s)])[0];

/**
 * The brief's conclusions for the construction cost pages: the three largest one-year
 * rises among the materials tracked (with fuel, which rose more, named beside them), what held flat, the hand-written caution, what production did and who pays.
 */
export function costNote(rows, data, brief) {
  const L = data.meta.month_labels;
  const m = data.meta.months;
  const cn = data.meta.cost_note;
  const fuel = series(data, cn.fuel_series);
  const plain = (label) => lowerFirst(label.replace(/\s*\([^)]*\)/g, ''));
  const top = rows.slice(0, 3).map((r) => `${plain(r.label)} (${signed(r.year)})`);
  const flat = rows.filter((r) => r.group === 'flat').map((r) => lowerFirst(r.label));
  const made = cn.production_ids.map((id) => {
    const p = data.production.find((x) => x.id === id);
    if (!p) throw new Error(`${DATA}: cost_note names no production record ${id}`);
    return `${p.title}: ${lowerFirst(firstSentence(p.result))}`;
  });
  return {
    meta: {
      about: `Built by scripts/policy/build_tariffs_brief.mjs from ${DATA}. Do not edit by hand.`,
      as_of: data.meta.as_of,
      review_by: data.meta.review_by,
    },
    title: cn.title,
    lines: [
      `Among the ${rows.length} building materials the brief tracks, the largest price rises from ${L[m.year_ago]} to ${L[m.latest]} were ${listed(top)}. Fuel rose more: diesel is up ${change(fuel.index[m.year_ago], fuel.index[m.latest]).toFixed(1)}%.`,
      `Prices moved less than 3% for ${listed(flat)}.`,
      cn.caution,
      ...made,
      data.meta.renter_owner.note,
    ],
    source: {
      text: `U.S. Bureau of Labor Statistics Producer Price Index, ${L[m.latest]}; production figures from the sources in the brief. Checked ${data.meta.as_of}.`,
      url: 'https://www.bls.gov/ppi/',
    },
    note: 'The brief reads Bureau of Labor Statistics commodity price series, so a figure here can differ a little from the industry series shown elsewhere on this page.',
    brief: { id: BRIEF_ID, title: brief.title, href: `research-brief.html?id=${BRIEF_ID}` },
  };
}

/**
 * Who the cost reaches is written once, in meta.renter_owner: the brief's renters-and-owners section is made
 * from it, the takeaway must end with its reach line, and the cost note carries its note line.
 */
export function whoItReaches(brief, data) {
  const ro = data.meta.renter_owner;
  const s = brief.sections.find((x) => x.id === 'renters-owners');
  if (!s) throw new Error(`${BRIEF_ID}: no section renters-owners`);
  s.items = [ro.renters, ro.owners, ro.both];
  if (!brief.takeaway.endsWith(ro.reach)) throw new Error(`${BRIEF_ID}: the takeaway must end with meta.renter_owner.reach in ${DATA}`);
  return brief;
}

export function build() {
  const data = read(DATA);
  const feed = read(FEED);
  const brief = feed.briefs.find((b) => b.id === BRIEF_ID);
  if (!brief) throw new Error(`${FEED} has no brief ${BRIEF_ID}`);
  const sec = (id) => {
    const s = brief.sections.find((x) => x.id === id);
    if (!s) throw new Error(`${BRIEF_ID}: no section ${id}`);
    return s;
  };
  const rows = priceChanges(data);
  sec('tariffs').table.rows = tariffRows(data);
  sec('up').table.rows = priceRows(rows.filter((r) => r.group === 'up'), data);
  sec('up').figure.src = SVG;
  sec('up').figure.alt = figureAlt(rows, data);
  sec('flat').table.rows = priceRows(rows.filter((r) => r.group === 'flat'), data);
  sec('production').table.rows = productionRows(data);
  sec('colorado').table.rows = illustration(data).rows;
  sec('limits').items = [...data.meta.known_gaps];
  whoItReaches(brief, data);
  brief.verified = data.meta.as_of;
  feed.meta.brief_count = feed.briefs.length;
  return {
    [FEED]: JSON.stringify(feed, null, 2) + '\n',
    [SVG]: figureSvg(rows, data),
    [NOTE]: JSON.stringify(costNote(rows, data, brief), null, 2) + '\n',
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
    if (check) { console.error(`${rel} is stale: run node scripts/policy/build_tariffs_brief.mjs`); stale++; continue; }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    console.log(`wrote ${rel}`);
  }
  if (stale) process.exit(1);
  if (check) console.log('tariffs brief: up to date');
}
