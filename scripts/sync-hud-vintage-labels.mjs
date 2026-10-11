#!/usr/bin/env node
/**
 * Keep every hard-coded HUD vintage label on the site equal to the vintage
 * of the data it describes.
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
 * Each rule names one label pattern with the year as its only capture group.
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

export const RULES = [
  // Fair Market Rents: data/hud-fmr-income-limits.json meta.fiscal_year
  { vintage: 'fmr', files: SOURCE_LIST_PAGES, pattern: /FMR FY(\d{4}) · IL FY\d{4}/g },
  { vintage: 'fmr', files: ['developer-brief.html', 'js/deal-calculator.js', 'js/hna/hna-export.js', 'js/market-analysis.js'], pattern: /HUD FMR FY(\d{4})/g },
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
  { vintage: 'il', files: ['hna-what-households-can-afford.html', 'housing-needs-assessment.html', 'hna-where-its-heading.html', 'developer-brief.html', 'js/hna/hna-export.js'], pattern: /HUD MTSP FY(\d{4})/g },
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

/** The vintage each label must name, read from the data it describes. */
export function readVintages(root = ROOT) {
  const hud = readJson(root, 'data/hud-fmr-income-limits.json').meta || {};
  return {
    fmr: hud.fiscal_year ?? null,
    il: hud.income_limits_fiscal_year ?? null,
    qct: designationYear(readJson(root, 'data/qct-colorado.json')),
    dda: designationYear(readJson(root, 'data/dda-colorado.json')),
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
      let hits = 0;
      const after = before.replace(rule.pattern, (whole, year) => {
        hits += 1;
        if (Number(year) === want) return whole;
        mismatches.push({ file, rule: i, found: Number(year), want });
        return whole.replace(year, String(want));
      });
      if (!hits) throw new Error(`rule ${i} (${rule.pattern}) matched nothing in ${file}; update RULES`);
      matches += hits;
      texts.set(file, after);
    }
  });
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
    console.log(`${matches} HUD vintage labels checked against ${JSON.stringify(vintages)}; ${mismatches.length} disagree.`);
    process.exit(mismatches.length ? 1 : 0);
  }
  for (const [file, text] of rewrites) fs.writeFileSync(path.join(ROOT, file), text);
  console.log(`${matches} HUD vintage labels; rewrote ${mismatches.length} in ${rewrites.size} files to ${JSON.stringify(vintages)}.`);
  for (const file of rewrites.keys()) console.log(`  ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
