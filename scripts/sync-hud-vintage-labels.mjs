#!/usr/bin/env node
/**
 * Keep every hard-coded HUD, ACS and LODES vintage label on the site equal to
 * the vintage of the data it describes.
 *
 * The FMR and QCT/DDA fetchers now take the year in effect (FY2027 Fair
 * Market Rents from 2026-10-01; each year's QCT/DDA designations from
 * Jan 1), but ~20 labels name the year in page and script source. A data
 * refresh that left them alone would publish FY2027 rents captioned FY2026.
 * The fetch workflows run this after fetching and commit what it changes;
 * test/hud-vintage-labels-sync.test.mjs runs --check so a label edited by
 * hand cannot drift from the data either.
 *
 *   node scripts/sync-hud-vintage-labels.mjs           # rewrite labels
 *   node scripts/sync-hud-vintage-labels.mjs --check   # exit 1 on any mismatch
 *
 * Each rule names one label pattern with the year as its only capture group,
 * or, with `span: true`, an ACS 5-year range ("ACS 2020–2024") whose second
 * group is the data year and whose first is four years earlier.
 *
 * ACS and LODES change only when a builder's year changes in code
 * (ACS_START_YEAR in scripts/hna/build_hna_data.py, ACS_YEAR in
 * scripts/market/build_public_market_data.py, LODES_YEAR in
 * build-hna-data.yml), so the test fails that PR until the labels follow.
 * js/data-source-inventory.js is covered too: its mtimes are generated, but
 * its descriptions and URLs are not. Docs and the working paper are not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE_LIST_PAGES = [
  'deal-calculator.html', 'hna-what-households-can-afford.html', 'hna-what-housing-exists.html',
  'hna-what-to-do.html', 'hna-where-its-heading.html', 'hna-who-lives-here.html',
  'housing-needs-assessment.html', 'market-analysis.html',
];

const HNA_PAGES = [
  'housing-needs-assessment.html', 'hna-what-households-can-afford.html', 'hna-what-housing-exists.html',
  'hna-what-to-do.html', 'hna-where-its-heading.html', 'hna-who-lives-here.html',
];

export const RULES = [
  // Fair Market Rents: data/hud-fmr-income-limits.json meta.fiscal_year
  { vintage: 'fmr', files: SOURCE_LIST_PAGES, pattern: /FMR FY(\d{4}) · IL FY\d{4}/g },
  { vintage: 'fmr', files: ['js/deal-calculator.js', 'js/hna/hna-export.js', 'js/market-analysis.js'], pattern: /HUD FMR FY(\d{4})/g },
  { vintage: 'fmr', files: ['js/deal-calculator.js'], pattern: /HUD FMR by bedroom size \(FY(\d{4}),/g },
  { vintage: 'fmr', files: ['js/data-connectors/hud-fmr.js'], pattern: /FY(\d{4}) FMR \/ mo/g },
  { vintage: 'fmr', files: ['hna-what-households-can-afford.html', 'housing-needs-assessment.html'], pattern: /HUD Fair Market Rents \(FY(\d{4})\)/g },
  { vintage: 'fmr', files: ['lihtc-opportunity-finder.html'], pattern: /2BR FMR \(FY(\d{4})\)/g },
  { vintage: 'fmr', files: ['market-analysis.html'], pattern: /HUD FMR \(FY(\d{4})\)/g },
  { vintage: 'fmr', files: ['js/config/financial-constants.js'], pattern: /hudFmrYear:\s*'FY(\d{4})'/g },
  { vintage: 'fmr', files: ['js/data-source-inventory.js'], pattern: /all 64 Colorado counties \(FY(\d{4})\)\. Combined with income limits/g },
  // Income Limits: meta.income_limits_fiscal_year
  { vintage: 'il', files: SOURCE_LIST_PAGES, pattern: /FMR FY\d{4} · IL FY(\d{4})/g },
  { vintage: 'il', files: ['hna-what-households-can-afford.html', 'housing-needs-assessment.html'], pattern: /by bedroom size and FY(\d{4}) county Income Limits/g },
  { vintage: 'il', files: ['hna-what-households-can-afford.html', 'housing-needs-assessment.html', 'hna-where-its-heading.html', 'js/hna/hna-export.js'], pattern: /HUD MTSP FY(\d{4})/g },
  { vintage: 'il', files: ['js/co-ami-gap.js'], pattern: /FY (\d{4}) county Income Limits/g },
  // QCT/DDA designations: data/qct-colorado.json and data/dda-colorado.json
  { vintage: 'qct', files: ['js/hna/hna-utils.js', 'js/data-source-inventory.js'], pattern: /Qualified_Census_Tracts_(\d{4})/g },
  { vintage: 'qct', files: ['lihtc-opportunity-finder.html'], pattern: />HUD QCT (\d{4})</g },
  { vintage: 'qct', files: ['colorado-deep-dive.html'], pattern: / QCT (\d{4})<\/label>/g },
  { vintage: 'qct', files: ['js/compare.js'], pattern: /Source: HUD QCT (\d{4}) \(/g },
  { vintage: 'dda', files: ['js/hna/hna-utils.js', 'js/data-source-inventory.js'], pattern: /Difficult_Development_Areas_(\d{4})/g },
  { vintage: 'dda', files: ['lihtc-opportunity-finder.html'], pattern: />HUD DDA (\d{4})</g },
  { vintage: 'dda', files: ['colorado-deep-dive.html'], pattern: / DDA (\d{4})<\/label>/g },
  { vintage: 'dda', files: ['js/compare.js'], pattern: /\+ HUD DDA (\d{4}) \(/g },
  { vintage: 'fmr', files: ['market-analysis.html'], pattern: /data-vintage="CHFA \d{4} · HUD FMR FY(\d{4})"/g },
  { vintage: 'il', files: ['market-analysis.html'], pattern: / · HUD FY(\d{4}) limits"/g },
  // ACS 5-year on the HNA pages: data/hna/summary/08.json acsProfile._acsYear
  { vintage: 'acs5', span: true, files: [...HNA_PAGES, 'hna-comparative-analysis.html'], pattern: /ACS (\d{4})[–-](\d{4})/g },
  { vintage: 'acs5', files: HNA_PAGES, pattern: /data\.census\.gov\/table\/ACS(?:DP|ST)5Y(\d{4})\./g },
  { vintage: 'acs5', files: ['hna-what-to-do.html', 'housing-needs-assessment.html'], pattern: /data-vintage="ACS (\d{4}) 5-year"/g },
  // ACS 5-year tract metrics: data/market/acs_tract_metrics_co.json meta.vintage
  { vintage: 'acsTract', span: true, files: ['market-analysis.html', 'colorado-deep-dive.html', 'js/components/vacancy-context.js'], pattern: /ACS (?:5-yr )?(\d{4})[–-](\d{4})/g },
  { vintage: 'acsTract', files: ['index.html', 'market-analysis.html'], pattern: /data\.census\.gov\/table\/ACS(?:DP|DT)5Y(\d{4})\./g },
  // LODES commute flows on the HNA pages: data/hna/lehd/<county>.json year
  { vintage: 'lodes', files: ['hna-where-its-heading.html', 'housing-needs-assessment.html'], pattern: /LODES (\d{4})/g },
  // LODES on Market Analysis: data/market/lodes_co.json meta.vintage
  { vintage: 'lodesTract', files: ['market-analysis.html', 'js/pma-commute-context.js', 'js/pma-commute-shaped.js', 'js/pma-commuting.js'], pattern: /LODES (\d{4})/g },
  { vintage: 'lodesTract', files: ['js/market-analysis.js'], pattern: /LEHD WAC (\d{4})|LODES (\d{4})/g },
];

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

// A cache written before designationYear was recorded names its layer in
// `source` ("HUD ArcGIS Qualified_Census_Tracts_2026 FeatureServer").
function designationYear(doc) {
  if (Number.isInteger(doc.designationYear)) return doc.designationYear;
  const m = /_(\d{4}) FeatureServer/.exec(doc.source || '');
  return m ? Number(m[1]) : null;
}

function readOptional(root, rel) {
  try { return readJson(root, rel); } catch { return null; }
}

function year(v) {
  const n = Number(v);
  return v != null && v !== '' && Number.isInteger(n) ? n : null;
}

// Every county file must carry the same OD year, or no label can name one.
function lodesCountyYear(root) {
  const dir = path.join(root, 'data/hna/lehd');
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^08\d{3}\.json$/.test(f)); } catch { return null; }
  const years = new Set(files.map((f) => year(readJson(root, `data/hna/lehd/${f}`).year)));
  return files.length && years.size === 1 ? [...years][0] : null;
}

// Notes that describe next year's designations before the site carries them.
// Each is one <p id="..."> block, removed once its vintage reaches `until`;
// it must live in a file some RULE names, so the workflow commits it.
export const EXPIRING_NOTES = [
  { vintage: 'dda', until: 2027, file: 'js/deal-calculator.js', id: 'dc-dda-2027' },
];

function noteBlock(id) {
  return new RegExp(`\\n[ \\t]*<p id="${id}"[^>]*>[\\s\\S]*?<\\/p>`);
}

/** The vintage each label must name, read from the data it describes. */
export function readVintages(root = ROOT) {
  const hud = readJson(root, 'data/hud-fmr-income-limits.json').meta || {};
  return {
    fmr: hud.fiscal_year ?? null,
    il: hud.income_limits_fiscal_year ?? null,
    qct: designationYear(readJson(root, 'data/qct-colorado.json')),
    dda: designationYear(readJson(root, 'data/dda-colorado.json')),
    acs5: year(readOptional(root, 'data/hna/summary/08.json')?.acsProfile?._acsYear),
    acsTract: year(readOptional(root, 'data/market/acs_tract_metrics_co.json')?.meta?.vintage),
    lodes: lodesCountyYear(root),
    lodesTract: year(readOptional(root, 'data/market/lodes_co.json')?.meta?.vintage),
  };
}

/**
 * Every label that disagrees with its vintage, and each file's corrected text.
 * Returns { matches, mismatches: [{file, rule, found, want}], rewrites: Map }.
 */
export function plan(vintages, read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const texts = new Map();
  const mismatches = [];
  let matches = 0;
  RULES.forEach((rule, i) => {
    const want = vintages[rule.vintage];
    if (!Number.isInteger(want)) throw new Error(`no ${rule.vintage} vintage in the data; refusing to guess one`);
    for (const file of rule.files) {
      if (!texts.has(file)) texts.set(file, read(file));
      const before = texts.get(file);
      // Rewrite by the captured groups' own offsets ('d' flag), never by
      // searching the match for equal digits: "CHFA 2026 · HUD FMR FY2026"
      // keeps its CHFA year, and "FMR FY2026 · IL FY2026" its IL year.
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace('d', '') + 'd');
      const edits = [];
      let hits = 0;
      for (const m of before.matchAll(re)) {
        hits += 1;
        const spans = m.indices.slice(1).map((ix, g) => ix && { at: ix, text: m[g + 1] }).filter(Boolean);
        if (rule.span) {
          const [start, end] = spans;
          if (Number(end.text) === want && Number(start.text) === want - 4) continue;
          mismatches.push({ file, rule: i, found: `${start.text}–${end.text}`, want });
          edits.push({ at: start.at, text: String(want - 4) }, { at: end.at, text: String(want) });
        } else {
          // A pattern with alternatives fills one group per branch.
          const [year] = spans;
          if (Number(year.text) === want) continue;
          mismatches.push({ file, rule: i, found: Number(year.text), want });
          edits.push({ at: year.at, text: String(want) });
        }
      }
      let after = before;
      for (const e of edits.sort((a, b) => b.at[0] - a.at[0])) {
        after = after.slice(0, e.at[0]) + e.text + after.slice(e.at[1]);
      }
      if (!hits) throw new Error(`rule ${i} (${rule.pattern}) matched nothing in ${file}; update RULES`);
      matches += hits;
      texts.set(file, after);
    }
  });
  for (const note of EXPIRING_NOTES) {
    const want = vintages[note.vintage];
    if (!Number.isInteger(want) || want < note.until) continue;
    if (!RULES.some((r) => r.files.includes(note.file))) throw new Error(`${note.file} is in no RULE; the workflow would not commit it`);
    if (!texts.has(note.file)) texts.set(note.file, read(note.file));
    const before = texts.get(note.file);
    const after = before.replace(noteBlock(note.id), '');
    if (after === before) continue;
    mismatches.push({ file: note.file, rule: `note ${note.id}`, found: 'present', want: `removed at ${note.vintage} ${note.until}` });
    texts.set(note.file, after);
  }
  const rewrites = new Map();
  for (const m of mismatches) rewrites.set(m.file, texts.get(m.file));
  return { matches, mismatches, rewrites };
}

function main() {
  const check = process.argv.includes('--check');
  const vintages = readVintages();
  const { matches, mismatches, rewrites } = plan(vintages);
  if (check) {
    for (const m of mismatches) console.error(`${m.file}: label says ${m.found}, data is ${m.want} (rule ${m.rule})`);
    console.log(`${matches} vintage labels checked against ${JSON.stringify(vintages)}; ${mismatches.length} disagree.`);
    process.exit(mismatches.length ? 1 : 0);
  }
  for (const [file, text] of rewrites) fs.writeFileSync(path.join(ROOT, file), text);
  console.log(`${matches} vintage labels; rewrote ${mismatches.length} in ${rewrites.size} files to ${JSON.stringify(vintages)}.`);
  for (const file of rewrites.keys()) console.log(`  ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
