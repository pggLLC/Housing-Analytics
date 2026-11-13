'use strict';

// The glossary is written to one style, so that it cannot drift back into
// three (found 2026-11-13: 16 phrase terms in Title Case, 23 in lower case,
// 40 definitions that repeated the full name, seven pairs of duplicate
// entries, and tooltip text that disagreed with the pop-up text).
//
// The rule, checked here against data/glossary.json:
//
//   Names
//   1. One entry per thing. Another spelling goes in `aliases`, and no name or
//      alias is used twice.
//   2. The name shown starts with a capital, a digit or "§". `term` is the
//      case-sensitive text the pages are matched on, so it is never recased:
//      `label` carries the display name, and differs from `term` by case only.
//
//   Definitions (the pop-up text)
//   3. Start with what the thing is. Do not open by repeating the term, its
//      label, an alias or its full name.
//   4. Start with a capital or a digit and end with a full stop.
//   5. 60 words at most, except the method notes listed in LONG.
//   6. The site calls itself "this site". No "e.g.".
//   7. A percent or ratio range uses an en dash (75–85%), not a hyphen.
//
//   Tooltips (`short`)
//   8. 55 words at most (LONG aside), and never a different claim: every figure in the
//      tooltip also appears in the definition.
//
//   Sources
//   9. An entry that states a percent, a dollar amount, a year or a number of
//      years names where that was read (`source.name`, `source.url`) and when
//      (`checked`, not after the file's `updated` date).

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.GLOSSARY_PATH || path.join(ROOT, 'data/glossary.json');
const glossary = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const terms = glossary.terms;

// Method notes kept whole: each was reviewed for accuracy as written, and a
// test or a figure sync reads its text.
const LONG = new Set(['Walkability Score', 'Bikeability Score', 'EPA SLD', 'Prop 123']);

const failures = [];
const fail = (t, msg) => failures.push(`${t.term}: ${msg}`);
const nameOf = (t) => t.label || t.term;
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Figures as a reader sees them: "1.15", "65,000", "½", "30". A trailing dot
// or comma is punctuation, not part of the figure.
const figures = (s) => (String(s || '').match(/½|\d[\d,.]*/g) || []).map((f) => f.replace(/[.,]+$/, ''));
const needsSource = (s) => /%|\$\d|\b(19|20)\d\d\b|\b\d+(?:-| )?(?:taxable )?years?\b/.test(String(s || ''));

assert.ok(Array.isArray(terms) && terms.length > 100, 'data/glossary.json has no terms to check');
assert.ok(/^\d{4}-\d{2}-\d{2}/.test(glossary.updated || ''), 'data/glossary.json has no updated date');
const updated = glossary.updated.slice(0, 10);

// 1. One entry per thing.
const seen = new Map();
for (const t of terms) {
  for (const key of [t.term, ...(t.aliases || [])]) {
    if (seen.has(key)) fail(t, `"${key}" is already used by ${seen.get(key)}`);
    seen.set(key, t.term);
  }
}

let withFigures = 0;
for (const t of terms) {
  const name = nameOf(t);
  const def = String(t.definition || '');

  // 2. Display name.
  if (!/^[A-Z0-9§]/.test(name)) fail(t, `the name shown ("${name}") starts in lower case; add a label`);
  if (t.label && t.label.toLowerCase() !== t.term.toLowerCase()) fail(t, `label "${t.label}" is more than a recasing of the term`);

  // 3. No name repeated at the start.
  const openers = [t.term, t.label, t.full, ...(t.aliases || [])].filter(Boolean);
  for (const o of openers) {
    if (new RegExp('^(?:An? |The )?' + esc(o) + '\\s+(?:—|–|-|is|are|means|describes|refers)\\s', 'i').test(def)) {
      fail(t, `the definition opens by repeating "${o}"`);
    }
  }

  // 4. Shape.
  if (!/^[A-Z0-9]/.test(def)) fail(t, 'the definition does not start with a capital or a digit');
  if (!/[.)]$/.test(def.trim())) fail(t, 'the definition does not end with a full stop');

  // 5. Length.
  if (!LONG.has(t.term) && words(def) > 60) fail(t, `the definition is ${words(def)} words (60 at most)`);
  if (words(def) < 3) fail(t, 'the definition is a stub');

  // 6, 7. Wording.
  for (const [field, text] of [['definition', def], ['short', String(t.short || '')]]) {
    if (/\be\.g\./.test(text)) fail(t, `${field} uses "e.g."`);
    if (/\bthis platform\b|\bCOHO\b|\bOn this page\b|\bUsed here\b/.test(text)) fail(t, `${field} does not call the site "this site"`);
    if (/\d(?:\.\d+)?-\d+(?:\.\d+)?%|\b\d\.\d+-\d\.\d+\b/.test(text)) fail(t, `${field} writes a range with a hyphen`);
  }

  // 8. The tooltip never says something the definition does not.
  if (t.short) {
    if (!LONG.has(t.term) && words(t.short) > 55) fail(t, `the tooltip is ${words(t.short)} words (55 at most)`);
    const inDef = new Set(figures(def));
    // The name itself may carry digits ("Section 515", "9% LIHTC", "B25064").
    const inName = new Set(figures([t.term, t.label, t.full, ...(t.aliases || [])].filter(Boolean).join(' ')));
    const extra = figures(t.short).filter((f) => !inDef.has(f) && !inName.has(f));
    if (extra.length) fail(t, `the tooltip states ${extra.join(', ')}, which the definition does not`);
  }

  // 9. Sources.
  if (needsSource(def) || needsSource(t.short)) {
    withFigures += 1;
    if (!t.source || !t.source.name || !t.source.url) fail(t, 'states a figure, year or rule but names no source');
    else if (!/^https:\/\//.test(t.source.url)) fail(t, `source url is not an https link: ${t.source.url}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.checked || '')) fail(t, 'states a figure, year or rule but has no checked date');
  }
  if (t.checked && t.checked > updated) fail(t, `checked ${t.checked} is after the file's updated date ${updated}`);
  if (t.checked && !t.source) fail(t, 'has a checked date but no source');
}

// Non-vacuity: the scan found entries to hold to each rule.
assert.ok(terms.some((t) => t.label), 'no entry carries a label; rule 2 checked nothing');
assert.ok(terms.some((t) => (t.aliases || []).length), 'no entry carries aliases; rule 1 checked nothing');
assert.ok(terms.filter((t) => t.short).length > 80, 'too few tooltips to check');
assert.ok(withFigures >= 25, `only ${withFigures} entries state a figure; rule 9 checked too little`);

if (failures.length) {
  console.log(failures.map((f) => '  ✗ ' + f).join('\n'));
  console.log(`\nglossary style: ${failures.length} problem(s) in ${path.relative(ROOT, FILE)}`);
  process.exit(1);
}
console.log(`glossary style: ${terms.length} entries, ${withFigures} with a sourced figure, all pass`);
