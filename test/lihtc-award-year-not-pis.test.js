'use strict';
/**
 * test/lihtc-award-year-not-pis.test.js
 *
 * CHFA's HousingTaxCreditProperties_view publishes no placed-in-service year.
 * scripts/fetch-chfa-lihtc.js copies AwardYear into YR_PIS so HUD-schema
 * consumers keep working, which means every "YR_PIS" on this site is the year
 * CHFA awarded the credits — typically two to three years before the building
 * opens. Rendered as "placed in service", a 2025 award reads as housing that is
 * already operating.
 *
 * The guard is conditioned on the data, not on copy. While every YR_PIS in the
 * feed files equals AwardYear:
 *
 *   1. No client file (js/**, top-level *.html) and no homepage-snapshot
 *      builder reads YR_PIS. The award year is read by its own name
 *      (AwardYear, or YR_ALLOC for HUD-schema records).
 *   2. No file that consumes the feed labels a year "placed in service" /
 *      "PIS", unless that line reads a real placed-in-service field
 *      (year_placed_in_service) or is a disclosure saying the feed has none.
 *   3. Every LIHTC project record embedded in client JS names a project that
 *      exists in data/chfa-lihtc.json. Three stand-in lists (97 invented
 *      projects between them) used to be served as real comps when a load
 *      failed; an embedded record now has to agree with the feed.
 *
 * If CHFA ever publishes a real placed-in-service year, check 1 and 2 stand
 * down on their own and the page copy can say "placed in service" again.
 *
 * Run: node test/lihtc-award-year-not-pis.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── The data condition ─────────────────────────────────────────────────────
const FEEDS = [
  'data/chfa-lihtc.json',
  'data/market/hud_lihtc_co.geojson',
  'data/affordable-housing/lihtc/chfa-properties.json',
];
let feedRecordsWithPis = 0;
const proxyByFeed = FEEDS.map((f) => {
  const props = JSON.parse(read(f)).features.map((x) => x.properties || {});
  const withPis = props.filter((p) => p.YR_PIS != null);
  feedRecordsWithPis += withPis.length;
  return withPis.length > 0 && withPis.every((p) => String(p.YR_PIS) === String(p.AwardYear));
});
assert(feedRecordsWithPis > 0, 'non-vacuity: the feed files carry YR_PIS at all');
const pisIsProxy = proxyByFeed.every(Boolean);

const chfaNames = new Set(
  JSON.parse(read('data/chfa-lihtc.json')).features
    .map((f) => String((f.properties || {}).PROJECT || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
);

// ── The files under test ───────────────────────────────────────────────────
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); }
    else if (/\.m?js$/.test(e.name) && !/ \d\./.test(e.name)) out.push(p);
  }
  return out;
}
const jsFiles = walk(path.join(ROOT, 'js'), []).map(rel);
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !/ \d\./.test(f));
const builderFiles = ['scripts/build-home-snapshot.mjs'];
const files = jsFiles.concat(htmlFiles, builderFiles);

// Comments explain the proxy by naming YR_PIS; only code and markup count.
function dropHtmlComments(src) {
  let out = '';
  let i = 0;
  for (;;) {
    const open = src.indexOf('<!--', i);
    if (open === -1) return out + src.slice(i);
    out += src.slice(i, open);
    const close = src.indexOf('-->', open + 4);
    if (close === -1) return out;
    i = close + 3;
  }
}
function strip(src) {
  return dropHtmlComments(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([;,{}()\]])\s*\/\/.*$/gm, '$1');
}
const code = new Map(files.map((f) => [f, strip(read(f))]));

// A file consumes the feed when it names a feed file, the connector, a feed
// year field, or a file built from the feed (home-snapshot.json's LIHTC pace
// is averaged over award years). HTML pages consume it through their scripts.
const FEED_REF = /chfa-lihtc\.json|hud_lihtc_co|chfa-properties\.json|HudLihtc|\bAwardYear\b|\bYR_ALLOC\b|\bYEAR_ALLOC\b|lihtc-trends-by-county|yr_pis_distribution|home-snapshot\.json/;
const consumerJs = new Set(jsFiles.filter((f) => FEED_REF.test(code.get(f))));
const consumers = files.filter((f) => {
  if (FEED_REF.test(code.get(f))) return true;
  if (!f.endsWith('.html')) return false;
  const srcs = [...code.get(f).matchAll(/<script[^>]+src="([^"?#]+)/g)].map((m) => m[1].replace(/^\.?\//, ''));
  return srcs.some((s) => consumerJs.has(s));
});
assert(consumers.length >= 20, `non-vacuity: found ${consumers.length} feed-consuming files, expected at least 20`);

const failures = [];

if (pisIsProxy) {
  // 1. No reads of YR_PIS (any case) in client code or the snapshot builder.
  for (const f of files) {
    code.get(f).split('\n').forEach((line, i) => {
      if (/\byr_pis\b/i.test(line)) {
        failures.push(`${f}:${i + 1} reads YR_PIS, which is AwardYear under another name in the CHFA feed — read AwardYear (or YR_ALLOC) and label it an award year:\n    ${line.trim().slice(0, 160)}`);
      }
    });
  }

  // 2. No placed-in-service labels in feed consumers.
  //    A label is the phrase, or PIS as an upper-case abbreviation. A line is
  //    exempt when it reads the real field. Disclosures — saying the feed has
  //    no such year, or placing the award relative to it ("2–3 years before
  //    placed-in-service") — are cut out first, with the tail of the previous
  //    line for wrapped prose, and whatever label is left still fails.
  const LABEL = /placed[- ]in[- ]service|\bYear PIS\b/i;
  const LABEL_ABBR = /\(PIS\)|['">]\s*PIS\b|\bPIS \d/;
  const REAL_FIELD = /year_placed_in_service/;
  const DISCLOSURE = /\b(?:no|not|never|none|without|before|after|until|lags?)\b[^.]{0,80}?placed[- ]in[- ]service|rather than HUD's "Year Placed in Service"/gi;
  let labelLinesScanned = 0;
  for (const f of consumers) {
    const lines = code.get(f).split('\n');
    lines.forEach((line, i) => {
      labelLinesScanned++;
      if (!(LABEL.test(line) || LABEL_ABBR.test(line)) || REAL_FIELD.test(line)) return;
      const prevTail = (lines[i - 1] || '').slice(-80);
      const rest = (prevTail + '\u0000' + line).replace(DISCLOSURE, '').split('\u0000').pop();
      if (!LABEL.test(rest) && !LABEL_ABBR.test(rest)) return;
      failures.push(`${f}:${i + 1} labels a year "placed in service" in a file that reads the CHFA feed, whose only year is the award year:\n    ${line.trim().slice(0, 160)}`);
    });
  }
  assert(labelLinesScanned > 1000, `non-vacuity: scanned ${labelLinesScanned} consumer lines`);
}

// 3. Embedded project records must agree with the feed. None is embedded
//    today, so non-vacuity is shown on the matcher: it must catch the shape
//    the removed stand-in lists used.
const PROJECT_LITERAL = /\bPROJECT\s*:\s*(['"])((?:(?!\1).)+)\1/g;
assert([..."{PROJECT:'Lincoln Park Apartments',PROJ_CTY:'Denver'}".matchAll(PROJECT_LITERAL)].length === 1,
  'non-vacuity: the embedded-record matcher recognises the removed fallback shape');
let embedded = 0;
for (const f of jsFiles) {
  for (const m of code.get(f).matchAll(PROJECT_LITERAL)) {
    embedded++;
    const key = m[2].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!chfaNames.has(key)) {
      failures.push(`${f} embeds a LIHTC project record "${m[2]}" that is not in data/chfa-lihtc.json — a stand-in record rendered as a real project`);
    }
  }
}

if (failures.length) {
  console.error(failures.map((x) => '  ✗ ' + x).join('\n'));
  console.error(`\nlihtc award-year guard: FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`lihtc award-year guard: PASS (feed YR_PIS is ${pisIsProxy ? 'the AwardYear proxy' : 'a real placed-in-service year'} across ${feedRecordsWithPis} records; ${consumers.length} feed-consuming files; ${embedded} embedded project records)`);
