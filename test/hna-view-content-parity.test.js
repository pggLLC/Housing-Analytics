#!/usr/bin/env node
/**
 * hna-view-content-parity — the five generated Housing Needs Assessment views
 * must carry each kept section EXACTLY as the canonical page carries it.
 *
 * Why this exists. 49 test files pin housing-needs-assessment.html; before this
 * one, zero pinned a view slug. Every disclosure, provenance, vintage-label and
 * absence assertion in the suite was verified on the canonical page only, while
 * the five views published the same figures to the same audience with nothing
 * asserting them. Two content defects shipped through that gap: a section's
 * markup surviving on views that declared it removed, and a whole chart panel
 * left behind without its heading.
 *
 * The invariant here is deliberately narrow and strong: for every section a
 * view keeps, the card that owns it is byte-identical to the canonical page's,
 * once the generator's own declared rewrites are normalised away. If that
 * holds, every canonical-page content assertion transitively covers the views,
 * and the suite does not need 49 more tests.
 *
 * On boundaries: this walks up from each <h2> to its owning .chart-card or
 * <section>, the same unit the generator uses. That is safe HERE in a way it
 * was not for the generator's own leftover guard, because this is a comparison,
 * not a boundary judgement -- a wrong boundary makes both sides wrong the same
 * way and the comparison still detects divergence inside it. Boundary errors
 * themselves are caught by build_hna_views.py's headless-card check, which
 * asks a different question on purpose.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANON = 'housing-needs-assessment.html';
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hna/hna-views.json'), 'utf8'));

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Unescape entities rather than blanking them: "LIHTC, QCT &amp; DDA" must
 *  match the mapping's literal "LIHTC, QCT & DDA", and a <title> carrying
 *  &#x27; must match the view's nav label. */
const unescape = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/** Every <section>/<div> span, by one stack pass. */
function containers(src) {
  const stack = [], out = [];
  const rx = /<(\/?)(section|div)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    const [, closing, tag, attrs, selfClose] = m;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { out.push({ lo: stack[i].lo, hi: rx.lastIndex, attrs: stack[i].attrs }); stack.splice(i, 1); break; }
      }
    } else if (!selfClose) {
      stack.push({ lo: m.index, tag, attrs });
    }
  }
  return out;
}

/** title -> owning card markup, for every <h2> in the document. */
function cards(src) {
  const spans = containers(src);
  const out = new Map();
  const rx = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = rx.exec(src)) !== null) {
    const title = unescape(m[1]
      .replace(/<(button|span|details)\b[^>]*class="[^"]*(method|tooltip|tt)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]+>/g, ' '))
      .split(/\s+/).filter(Boolean).join(' ');
    if (!title) continue;
    const enclosing = spans.filter((s) => s.lo < m.index && m.index < s.hi);
    if (!enclosing.length) continue;
    const units = enclosing.filter((s) => /class="[^"]*\bchart-card\b/.test(s.attrs || '') || /^<section/.test(src.slice(s.lo, s.lo + 8)));
    const pick = (units.length ? units : enclosing).reduce((a, b) => (b.lo > a.lo ? b : a));
    out.set(title, src.slice(pick.lo, pick.hi));
  }
  return out;
}

/**
 * Normalise the generator's DECLARED rewrites, and nothing else. Every entry
 * here is a change build_hna_views.py makes on purpose; anything it does not
 * cover is a real divergence and should fail.
 */
const normalise = (s) => s
  .replace(/<!--[\s\S]*?-->/g, ' ')                     // removal notes + inherited source comments
  .replace(/href="[a-z0-9-]+\.html#/g, 'href="#')       // cross-view anchor relinking
  .replace(/\s+/g, ' ')
  .trim();

const canonSrc = fs.readFileSync(path.join(ROOT, CANON), 'utf8');
const canonCards = cards(canonSrc);
const sharedTitles = mapping.shared.sections.map((s) => s.title);
const startsWith = (title, want) => title.toLowerCase().startsWith(want.toLowerCase().slice(0, 44));

console.log('hna-view-content-parity\n');

let compared = 0;
for (const view of mapping.views) {
  const file = path.join(ROOT, view.slug);
  if (!fs.existsSync(file)) { fail(`${view.slug} does not exist`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const viewCards = cards(src);
  const kept = [...view.sections.map((s) => s.title), ...sharedTitles];

  let divergent = 0, missing = 0;
  for (const title of kept) {
    const canonKey = [...canonCards.keys()].find((k) => startsWith(k, title));
    if (!canonKey) { fail(`${view.slug}: mapping names "${title}", absent from ${CANON}`); continue; }
    const viewKey = [...viewCards.keys()].find((k) => startsWith(k, title));
    if (!viewKey) { fail(`${view.slug} keeps "${title}" per the mapping but the page has no such heading`); missing++; continue; }
    compared++;
    const a = normalise(canonCards.get(canonKey));
    const b = normalise(viewCards.get(viewKey));
    if (a === b) continue;
    divergent++;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    fail(`${view.slug}: "${title.slice(0, 46)}" diverges from ${CANON} at char ${i}`);
    console.error(`      canonical: ${JSON.stringify(a.slice(i, i + 110))}`);
    console.error(`      view     : ${JSON.stringify(b.slice(i, i + 110))}`);
  }

  // Every shared section must be on every view — that is what "shared" means.
  for (const title of sharedTitles) {
    if (![...viewCards.keys()].some((k) => startsWith(k, title))) fail(`${view.slug} is missing shared section "${title}"`);
  }

  // Disclosures a reader is entitled to on any page that publishes these figures.
  if (!/Screening tool only/.test(src)) fail(`${view.slug} drops the "Screening tool only" disclaimer`);
  if (!/id="hnaDecisionStrip"/.test(src)) fail(`${view.slug} drops the executive decision strip`);
  const pageTitle = unescape((src.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  if (!pageTitle.includes(view.nav)) fail(`${view.slug} <title> does not name the view: ${JSON.stringify(pageTitle)}`);

  if (!divergent && !missing) ok(`${view.slug.padEnd(38)} ${kept.length} kept sections identical to ${CANON}`);
}

console.log(`\n${compared} section(s) compared across ${mapping.views.length} views`);
if (failures) { console.error(`\nhna-view-content-parity: FAIL (${failures})`); process.exit(1); }
console.log('hna-view-content-parity: PASS');
