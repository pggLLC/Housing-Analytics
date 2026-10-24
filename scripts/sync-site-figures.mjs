#!/usr/bin/env node
/**
 * Keep every hard-coded copy of a tracked figure on the site equal to the
 * data file it comes from.
 *
 * Figures such as the Novogradac equity price, the federal credit ceiling,
 * the Prop 123 fund estimate and the 2027 Round One dates are written into
 * page prose, callout text and script fallbacks. Each copy is listed in RULES
 * with the source figure it must show; a data refresh then rewrites them all:
 *
 *   node scripts/sync-site-figures.mjs           # rewrite copies from the data
 *   node scripts/sync-site-figures.mjs --check   # exit 1 on any mismatch
 *
 * test/site-figures-sync.test.mjs runs the check, and also fails when one of
 * these figures is typed into a page or script outside a rule, so a new copy
 * has to be added here (or read from the data at runtime) to land.
 *
 * Same approach as scripts/sync-hud-vintage-labels.mjs. Dossiers and the
 * working paper are dated documents and are not covered.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money2 = (n) => n.toFixed(2);
const thousands = (n) => Math.round(n).toLocaleString('en-US');
const dayMonYear = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const CONTENT = 'data/core/educational-content.json';
const GUIDE = 'lihtc-guide-for-stakeholders.html';
const DC = 'deal-calculator.html';
const DEEP = 'colorado-deep-dive.html';
const FUNDING = 'data/policy/co-developer-funding-guide.json';
const BRIEFS = 'data/policy_briefs_curated.json';

// Each rule: files, a pattern with one capture group, and the figure (key of
// readFigures()) or a function of the figures that the group must equal.
export const RULES = [
  // ── Equity price: data/market/novogradac-equity-pricing.json ──────────────
  { fig: 'quarter', files: [CONTENT], pattern: /Novogradac's (\d{4}-Q\d) national average/g },
  { fig: 'eq9', files: [CONTENT, DC], pattern: /national averages were \$(\d\.\d\d) (?:per credit dollar )?for 9%/g },
  { fig: 'eq4', files: [CONTENT, DC], pattern: /for 9% credits and \$(\d\.\d\d) for 4%/g },
  { fig: 'eq9', files: [CONTENT], pattern: /At \$(\d\.\d\d) per credit dollar \(Novogradac's/g },
  { value: (F) => (F.eq9 * 10).toFixed(1), files: [CONTENT], pattern: /a \$1M annual credit raises about \$(\d+\.\d)M/g },
  { value: (F) => (3.24 * F.eq9).toFixed(2), files: [CONTENT], pattern: /that's about \$(\d+\.\d\d)M in additional equity/g },
  { fig: 'quarter', files: [DC], pattern: /For (\d{4}-Q\d), Novogradac's national averages/g },
  { fig: 'eqCo', files: [DC], pattern: /Colorado median \(all credit types\) was \$(\d\.\d\d)/g },
  { fig: 'quarter', files: ['cra-expansion-analysis.html'], pattern: /Novogradac(?:<\/a>)? (\d{4}-Q\d): 9% \$/g },
  { fig: 'eq9', files: ['cra-expansion-analysis.html'], pattern: /: 9% \$(\d\.\d\d), 4% \$/g },
  { fig: 'eq4', files: ['cra-expansion-analysis.html'], pattern: /, 4% \$(\d\.\d\d)\), not only/g },
  // lihtc-guide spans are refilled from the data at runtime; these keep the
  // no-script text equal to it.
  { fig: 'eq9', files: [GUIDE], pattern: /id="lihtcGuide(?:9pct|Nat9|Mkt9)">\$(\d\.\d\d)</g },
  { fig: 'eq4', files: [GUIDE], pattern: /id="lihtcGuide(?:4pct|Nat4|Mkt4)">\$(\d\.\d\d)</g },
  { fig: 'eqCo', files: [GUIDE], pattern: /id="(?:lihtcGuideCoMedian|lihtcGuideCo|lihtcGuideMktCo|dgCoPrice)">\$(\d\.\d\d)</g },
  { fig: 'quarter', files: [GUIDE], pattern: /id="(?:lihtcGuideVintage|dgVintage|lihtcGuideMktVintage|lihtcGuideMktCoVintage)">(\d{4}-Q\d)</g },
  { fig: 'eqCo', files: ['cra-expansion-analysis.html'], pattern: /<span data-co-median>\$(\d\.\d\d)<\/span>/g },
  { fig: 'quarter', files: ['cra-expansion-analysis.html'], pattern: /<span data-co-vintage>(\d{4}-Q\d)<\/span>/g },
  { fig: 'eqNC', files: [GUIDE], pattern: /id="lihtcGuideRegion">\$(\d\.\d\d)</g },
  { value: (F) => (1.5 * 10 * F.eqCo).toFixed(2), files: [GUIDE], pattern: /id="dgCoEquity">\$(\d+\.\d\d)M</g },
  { value: (F) => money2(F.eqCo - 0.05), files: [GUIDE], pattern: /id="dgLowPrice">\$(\d\.\d\d)</g },
  { value: (F) => (1.5 * 10 * (F.eqCo - 0.05)).toFixed(2), files: [GUIDE], pattern: /id="dgLowEquity">\$(\d+\.\d\d)M</g },
  { fig: 'eq9', files: [GUIDE], pattern: /Purchase Price @ \$(\d\.\d\d)</g },
  { value: (F) => thousands(F.eq9 * 1e6), files: [GUIDE], pattern: /<td>\(\$([\d,]+)\)<\/td>\s*<td>Paid in Years 1-2/g },
  { fig: 'quarter', files: [GUIDE], pattern: /\(Novogradac (\d{4}-Q\d) average for 9% credits/g },
  // Script defaults and fallbacks.
  { fig: 'eq9', files: ['js/config/financial-constants.js'], pattern: /equityPrice9Pct:\s*(\d\.\d\d),/g },
  { fig: 'eq4', files: ['js/config/financial-constants.js'], pattern: /equityPrice4Pct:\s*(\d\.\d\d),/g },
  { fig: 'quarterWords', files: ['js/config/financial-constants.js'], pattern: /Novogradac LIHTC equity benchmark, (Q\d \d{4})/g },
  { fig: 'eq9', files: ['js/deal-calculator.js', 'js/lihtc-deal-predictor.js'], pattern: /equityPrice9Pct \|\| (\d\.\d\d)/g },
  { fig: 'eq4', files: ['js/deal-calculator.js', 'js/lihtc-deal-predictor.js'], pattern: /equityPrice4Pct \|\| (\d\.\d\d)/g },
  { fig: 'eq9', files: ['js/deal-calculator.js'], pattern: /id="dc-equity-price" [^>]*value="(\d\.\d\d)"/g },
  { fig: 'eq9', files: ['data/policy/lihtc-assumptions.json'], pattern: /"default9Pct": (\d\.\d\d)/g },
  { fig: 'eq4', files: ['data/policy/lihtc-assumptions.json'], pattern: /"default4Pct": (\d\.\d\d)/g },
  // The stress slider starts at today's price, so its first reading is no change.
  { fig: 'eq9', files: [DC], pattern: /id="dc-stress-equity-price-label"[^>]*>\$(\d\.\d\d)</g },
  { fig: 'eq9', files: [DC], pattern: /id="dc-stress-equity-price" [^>]*value="(\d\.\d\d)"/g },
  { fig: 'eq9', files: ['js/deal-engine.js'], pattern: /'dc-stress-equity-price', (\d\.\d\d)\)/g },
  { fig: 'eq9', files: ['js/cra-expansion-forecast.js'], pattern: /currentPricing = (\d\.\d\d)[,)]/g },

  // ── Federal 9% ceiling: data/policy/tax-credit-legislation.json, data/allocations.json
  { fig: 'perCapita', files: [CONTENT], pattern: /\(\$(\d\.\d{3}) per resident, IRS Rev\. Proc\./g },
  { fig: 'revProc', files: [CONTENT], pattern: /per resident, (IRS Rev\. Proc\. \d{4}-\d+)\)/g },
  { fig: 'year', files: [CONTENT], pattern: /For (\d{4}) the per-resident part of the ceiling is about \$[\d.]+M/g },
  { fig: 'coM', files: [CONTENT], pattern: /per-resident part of the ceiling is about \$(\d+\.\d)M in annual credits/g },
  { fig: 'year', files: [DC], pattern: /For (\d{4}) each state's 9% ceiling/g },
  { fig: 'perCapita', files: [DC], pattern: /9% ceiling is \$(\d\.\d{3}) per resident/g },
  { fig: 'coM', files: [DC], pattern: /about \$(\d+\.\d) million for Colorado/g },
  { fig: 'perCapita', files: [DEEP], pattern: /credit authority \(\$(\d\.\d{3}) per resident\)/g },
  { fig: 'perCapita', files: [DEEP], pattern: /\$(\d\.\d{3}) per resident under Rev\. Proc\./g },
  { fig: 'perCapita', files: [DEEP], pattern: /ceiling: \$(\d\.\d{3}) per resident times/g },
  { fig: 'perCapita', files: [DEEP], pattern: /">\$(\d\.\d{3}) per resident · <a/g },
  { fig: 'year', files: [DEEP], pattern: /credit ceiling for (\d{4}) is about/g },
  { fig: 'coM', files: [DEEP], pattern: /is about \$(\d+\.\d) million a year, and CHFA/g },
  { fig: 'year', files: [GUIDE], pattern: /residents at \$[\d.]+ per person\. [^<]*?minimum \(\$[\d,]+ for (\d{4})\)/g },
  { fig: 'perCapita', files: [GUIDE], pattern: /residents at \$(\d\.\d{3}) per person\./g },
  { value: (F) => (F.coM == null ? null : thousands(Math.round(F.coM * 1e6))), files: [GUIDE], pattern: /<td>\$([\d,]+) for \d{4}: [\d,]+ residents at/g },
  { fig: 'year', files: [GUIDE], pattern: /<td>\$[\d,]+ for (\d{4}): [\d,]+ residents at/g },
  { value: (F) => (F.coPop == null ? null : thousands(F.coPop)), files: [GUIDE], pattern: /<td>\$[\d,]+ for \d{4}: ([\d,]+) residents at/g },
  { fig: 'smallStateMin', files: [GUIDE], pattern: /small-state minimum \(\$([\d,]+) for \d{4}\)/g },
  { fig: 'revProc', files: [GUIDE], pattern: /<td>(IRS Rev\. Proc\. \d{4}-\d+) §4\.08 \(rate/g },
  { fig: 'revProcUrl', files: [DC, DEEP, GUIDE], pattern: /href="(https:\/\/www\.irs\.gov\/pub\/irs-drop\/rp-\d\d-\d+\.pdf)"/g },
  { fig: 'revProc', files: [DC, DEEP, GUIDE], pattern: /irs-drop\/rp-\d\d-\d+\.pdf" target="_blank" rel="noopener"[^>]*>(IRS Rev\. Proc\. \d{4}-\d+)</g },
  // The population notice the ceiling multiplies by: data/allocations.json source.
  { fig: 'noticeUrl', files: [DEEP, GUIDE], pattern: /href="(https:\/\/www\.irs\.gov\/irb\/\d{4}-\d+_IRB)"/g },
  { fig: 'notice', files: [DEEP, GUIDE], pattern: /irb\/\d{4}-\d+_IRB" target="_blank" rel="noopener"[^>]*>IRS (Notice \d{4}-\d+)/g },
  { fig: 'notice', files: [GUIDE], pattern: /Public Law 119-21\) and (Notice \d{4}-\d+) \(population\)/g },
  { value: (F) => /irb\/(\d{4}-\d+)_IRB/.exec(F.noticeUrl)?.[1] ?? null, files: [GUIDE], pattern: /IRS Notice \d{4}-\d+ \(IRB (\d{4}-\d+)\)</g },
  { fig: 'year', files: [DEEP], pattern: /class="kpi-label">(\d{4}) Federal Housing Credit Ceiling</g },
  { fig: 'year', files: [DEEP], pattern: />Colorado 9% Credit Ceiling \((\d{4})\)</g },
  { fig: 'year', files: [DEEP], pattern: />Federal Credit per Resident \((\d{4})\)</g },
  { fig: 'year', files: [DEEP], pattern: /class="stat-label">(\d{4}) Federal Ceiling</g },

  // ── Prop 123 fund estimate: data/policy/policy-timeline.json id prop123 ───
  { fig: 'p123M', files: [CONTENT, 'colorado-elections.html'], pattern: /estimated at \$(\d+) million a year from/g },
  { fig: 'p123From', files: [CONTENT, 'colorado-elections.html'], pattern: /estimated at \$\d+ million a year from (\d{4}-\d\d)/g },
  { fig: 'p123M', files: ['data/glossary.json', 'js/components/inline-glossary.js', CONTENT], pattern: /estimated at \$(\d+)M a year from/g },
  { fig: 'p123From', files: ['data/glossary.json', 'js/components/inline-glossary.js', CONTENT], pattern: /estimated at \$\d+M a year from (\d{4}-\d\d)/g },

  // ── 2027 Round One dates: data/chfa-qap-calendar.json ─────────────────────
  { fig: 'r1Loi', files: ['developer-submittal-review.html'], pattern: /Letter of intent due (\d{1,2} [A-Z][a-z]{2} \d{4});/g },
  { fig: 'r1App', files: ['developer-submittal-review.html'], pattern: /application due (\d{1,2} [A-Z][a-z]{2} \d{4})\./g },
  { value: (F) => longDate(F.r1Loi), files: [GUIDE], pattern: /Round One dates:<\/strong> letter of intent ([A-Z][a-z]+ \d{1,2}, \d{4});/g },
  { value: (F) => longDate(F.r1App), files: [GUIDE], pattern: /Round One dates:<\/strong> letter of intent [^;]+; application ([A-Z][a-z]+ \d{1,2}, \d{4})\./g },  { value: (F) => longDate(F.r1Loi), files: [FUNDING], pattern: /2027 Round One letter of intent due ([A-Z][a-z]+ \d{1,2}, \d{4}) and/g },
  { value: (F) => longDate(F.r1App), files: [FUNDING], pattern: /2027 Round One letter of intent due [^"]+? and application due ([A-Z][a-z]+ \d{1,2}, \d{4}) by/g },
  { value: (F) => longDate(F.r1Loi), files: [FUNDING], pattern: /The 2027 Round One dates \(LOI ([A-Z][a-z]+ \d{1,2}, \d{4});/g },
  { value: (F) => longDate(F.r1App), files: [FUNDING], pattern: /The 2027 Round One dates \(LOI [^;]+; application ([A-Z][a-z]+ \d{1,2}, \d{4})\)/g },
  { value: (F) => longDate(F.r1Loi), files: [FUNDING], pattern: /2027 Round One \(LOI ([A-Z][a-z]+ \d{1,2}, \d{4}), per/g },

  // ── Ceiling sentences in JSON that pages render ───────────────────────────
  { fig: 'year', files: [FUNDING], pattern: /For (\d{4}) the state housing credit ceiling is the greater of/g },
  { fig: 'perCapita', files: [FUNDING], pattern: /state housing credit ceiling is the greater of \$(\d\.\d{3}) per resident/g },
  { fig: 'smallStateMin', files: [FUNDING], pattern: /ceiling is the greater of \$[\d.]+ per resident or \$(\d{1,3}(?:,\d{3})+)/g },
  { fig: 'year', files: [BRIEFS], pattern: /For (\d{4}), IRS Rev\. Proc\. \d{4}-\d+ sets the amount/g },
  { fig: 'revProc', files: [BRIEFS], pattern: /For \d{4}, (IRS Rev\. Proc\. \d{4}-\d+) sets the amount/g },
  { fig: 'perCapita', files: [BRIEFS], pattern: /sets the amount at the greater of \$(\d\.\d{3}) per resident/g },
  { fig: 'smallStateMin', files: [BRIEFS], pattern: /sets the amount at the greater of \$[\d.]+ per resident or \$(\d{1,3}(?:,\d{3})+)/g },
];

// Text that looks like a tracked figure but is a different one: DOLA's
// January 2027 round shares CHFA's December 1, 2026 letter-of-intent date.
// Dated citations (a source list for a 2026 Act, a brief's reference list,
// code comments) keep naming the document they were read from.
const NOT_A_COPY = [
  { files: [DEEP], pattern: /^[ \t]*\/\/[^\n]*$/gm },
  { files: ['housing-legislation-2026.html'], pattern: /<p[^>]*>Sources: [^\n]*/g },
  { files: [FUNDING], pattern: /"label": "irs\.gov: rp-\d\d-\d+\.pdf \(PDF\)",\s*"url": "[^"]+"/g },
  { files: [BRIEFS], pattern: /"title": "Rev\. Proc\. \d{4}-\d+, \d{4} inflation-adjusted items[^"]*",[^{}]*?"link": "[^"]+"/g },
  { files: [FUNDING], pattern: /LOI [A-Z][a-z]+ \d{1,2}, \d{4}[,;] application January 15, 2027/g },
  { files: [FUNDING], pattern: /"quote": "Letter of Intent Deadline: [^"]+",\s*"url": "https:\/\/doh\.colorado\.gov\//g },
];

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

/** The value each copy must show, read from the data it comes from. */
export function readFigures(root = ROOT) {
  const nov = readJson(root, 'data/market/novogradac-equity-pricing.json');
  const quarter = nov.meta?.vintage ?? null;
  const law = readJson(root, 'data/policy/tax-credit-legislation.json');
  const entry = (law.items || law.entries || law.legislation || Object.values(law).find(Array.isArray) || [])
    .find((e) => e.id === 'obbba-lihtc-ceiling-12pct') || {};
  const ceilings = Object.keys(entry).filter((k) => /^ceiling_\d{4}$/.test(k)).sort();
  const ceiling = ceilings.length ? entry[ceilings[ceilings.length - 1]] : {};
  const alloc = readJson(root, 'data/allocations.json');
  const co = alloc.states?.CO?.allocation;
  const p123 = (readJson(root, 'data/policy/policy-timeline.json').events || []).find((e) => e.id === 'prop123')?.fund_estimate || {};
  const cal = readJson(root, 'data/chfa-qap-calendar.json');
  const ev = (id) => (cal.events || []).find((e) => e.id === id)?.date ?? null;
  const revProc = /IRS Rev\. Proc\. \d{4}-\d+/.exec(ceiling.source || '')?.[0] ?? null;
  return {
    eq9: nov.pricing?.national_avg?.credit_9pct ?? null,
    eq4: nov.pricing?.national_avg?.credit_4pct ?? null,
    eqCo: nov.pricing?.by_state?.CO?.median_all_credits ?? null,
    eqNC: nov.pricing?.by_region?.north_central?.median_all_credits ?? null,
    quarter,
    quarterWords: quarter ? quarter.replace(/^(\d{4})-(Q\d)$/, '$2 $1') : null,
    year: ceiling.year ?? null,
    perCapita: ceiling.per_capita ?? null,
    smallStateMin: ceiling.small_state_minimum ?? null,
    revProc,
    revProcUrl: ceiling.source_url ?? null,
    notice: alloc.year === ceiling.year ? (/Notice \d{4}-\d+/.exec(alloc.source?.name || '')?.[0] ?? null) : null,
    noticeUrl: alloc.year === ceiling.year ? (alloc.source?.populationUrl ?? null) : null,
    // The allocation must be for the ceiling's year, or the two disagree.
    coM: Number.isFinite(co) && alloc.year === ceiling.year ? co / 1e6 : null,
    coPop: alloc.year === ceiling.year ? (alloc.states?.CO?.population ?? null) : null,
    p123M: p123.amount_millions ?? null,
    p123From: p123.from_budget_year ?? null,
    r1Loi: ev('2027-r1-loi'),
    r1App: ev('2027-r1-deadline'),
  };
}

/** The text a figure is written as on the page. */
export function formatFigure(key, F) {
  const v = F[key];
  if (v == null) return null;
  switch (key) {
    case 'eq9': case 'eq4': case 'eqCo': case 'eqNC': return money2(v);
    case 'perCapita': return v.toFixed(3);
    case 'smallStateMin': return thousands(v);
    case 'coM': return v.toFixed(1);
    case 'year': case 'p123M': return String(v);
    case 'r1Loi': case 'r1App': return dayMonYear(v);
    default: return String(v);
  }
}

function want(rule, F) {
  if (!rule.value) return formatFigure(rule.fig, F);
  try {
    const v = rule.value(F);
    return /NaN/.test(v) ? null : v;
  } catch {
    return null;
  }
}

/**
 * Every copy that disagrees with its figure, each file's corrected text, and
 * the character spans the rules cover (for the stray-copy scan).
 */
export function plan(F, read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const texts = new Map();
  const covered = new Map();
  const mismatches = [];
  let matches = 0;
  RULES.forEach((rule, i) => {
    const w = want(rule, F);
    if (w == null) throw new Error(`rule ${i} (${rule.pattern}): its figure is missing from the data; refusing to guess`);
    for (const file of rule.files) {
      if (!texts.has(file)) texts.set(file, read(file));
      const before = texts.get(file);
      const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace('d', '') + 'd');
      const edits = [];
      let hits = 0;
      for (const m of before.matchAll(re)) {
        hits += 1;
        if (!covered.has(file)) covered.set(file, []);
        covered.get(file).push([m.index, m.index + m[0].length, i]);
        const [s, e] = m.indices[1];
        if (m[1] === w) continue;
        mismatches.push({ file, rule: i, found: m[1], want: w });
        edits.push({ s, e, text: w });
      }
      if (!hits) throw new Error(`rule ${i} (${rule.pattern}) matched nothing in ${file}; update RULES`);
      matches += hits;
      let after = before;
      for (const ed of edits.sort((a, b) => b.s - a.s)) after = after.slice(0, ed.s) + ed.text + after.slice(ed.e);
      texts.set(file, after);
    }
  });
  const rewrites = new Map();
  for (const m of mismatches) rewrites.set(m.file, texts.get(m.file));
  return { matches, mismatches, rewrites, covered };
}

// ── Stray copies ────────────────────────────────────────────────────────────
// Where a typed copy would reach a visitor: pages, scripts and the text data
// the glossary and callouts render.
const SKIP_JS = [/^js\/vendor\//, /^js\/state-allocations-20\d\d(-actual)?\.js$/, /^js\/state-allocations-historical\.js$/];
export function scannedFiles(root = ROOT) {
  const out = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  const walk = (dir, keep) => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(rel, keep);
      else if (keep(rel)) out.push(rel);
    }
  };
  walk('js', (rel) => rel.endsWith('.js') && !SKIP_JS.some((re) => re.test(rel)));
  // The generated place pages are visitor pages too. (assets/ holds generated
  // map embeds and docs/ internal notes; neither carries these figures.)
  walk('places', (rel) => rel.endsWith('.html'));
  out.push(CONTENT, 'data/glossary.json', 'data/table-header-tips.json', FUNDING, BRIEFS);
  return out;
}

// Figures too common in other contexts to scan for: a bare year or quarter
// label, and the 2023 start of Prop 123 revenue, appear all over the site
// with other meanings.
export const NOT_SCANNED = ['year', 'quarter', 'quarterWords', 'p123From'];

/** The written forms of each figure that must only appear inside a rule. */
// Prices skip a trailing "s": "the low $0.80s" names a range, not a median.
export function strayPatterns(F) {
  const f = (k) => formatFigure(k, F).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [
    ['eq9', new RegExp(`\\$${f('eq9')}(?![\\ds])`, 'g')],
    ['eq4', new RegExp(`\\$${f('eq4')}(?![\\ds])`, 'g')],
    ['eqCo', new RegExp(`\\$${f('eqCo')}(?![\\ds])`, 'g')],
    ['eqNC', new RegExp(`\\$${f('eqNC')}(?![\\ds])`, 'g')],
    ['coPop', new RegExp(`(?<![\\d,])${thousands(F.coPop)}(?![\\d,])`, 'g')],
    ['revProc', new RegExp(`${f('revProc').replace(/^IRS /, '')}(?!\\d)`, 'g')],
    ['revProcUrl', new RegExp(f('revProcUrl'), 'g')],
    ['notice', new RegExp(`${f('notice')}(?!\\d)`, 'g')],
    ['noticeUrl', new RegExp(f('noticeUrl'), 'g')],
    ['perCapita', new RegExp(`\\$${f('perCapita')}(?!\\d)`, 'g')],
    ['smallStateMin', new RegExp(`\\$${f('smallStateMin')}(?!\\d)`, 'g')],
    ['coM', new RegExp(`\\$${f('coM')} ?(?:million|M)\\b`, 'g')],
    ['p123M', new RegExp(`\\$${f('p123M')} ?(?:million|M)\\b`, 'g')],
  ];
  for (const k of ['r1Loi', 'r1App']) {
    const [y, m, d] = F[k].split('-').map(Number);
    const mon = MONTHS[m - 1];
    const long = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    pats.push([k, new RegExp(`\\b(?:${d} (?:${mon}|${long})\\.? ${y}|(?:${mon}|${long})\\.? ${d},? ${y})\\b`, 'g')]);
  }
  return pats;
}

/** 2026-12-01 → "December 1, 2026". */
function longDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${d}, ${y}`;
}

export function strays(F, root = ROOT, coveredSpans = plan(F).covered) {
  const found = [];
  const pats = strayPatterns(F);
  for (const file of scannedFiles(root)) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    const spans = [...(coveredSpans.get(file) || [])];
    for (const n of NOT_A_COPY) {
      if (n.files.includes(file)) for (const m of text.matchAll(n.pattern)) spans.push([m.index, m.index + m[0].length]);
    }
    for (const [fig, re] of pats) {
      for (const m of text.matchAll(re)) {
        if (spans.some(([s, e]) => m.index >= s && m.index < e)) continue;
        const line = text.slice(0, m.index).split('\n').length;
        found.push({ file, line, fig, text: m[0] });
      }
    }
  }
  return found;
}

function main() {
  const check = process.argv.includes('--check');
  const F = readFigures();
  const { matches, mismatches, rewrites } = plan(F);
  if (check) {
    for (const m of mismatches) console.error(`${m.file}: shows ${m.found}, data is ${m.want} (rule ${m.rule})`);
    const s = strays(F);
    for (const x of s) console.error(`${x.file}:${x.line}: ${x.text} is typed outside a rule (${x.fig}); add a rule or read it from the data`);
    console.log(`${matches} figure copies checked; ${mismatches.length} disagree; ${s.length} stray copies.`);
    process.exit(mismatches.length || s.length ? 1 : 0);
  }
  for (const [file, text] of rewrites) fs.writeFileSync(path.join(ROOT, file), text);
  console.log(`${matches} figure copies; rewrote ${mismatches.length} in ${rewrites.size} files.`);
  for (const file of rewrites.keys()) console.log(`  ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
