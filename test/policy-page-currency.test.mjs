#!/usr/bin/env node
// The Policy & Legislation page (housing-legislation-2026.html) has drifted from
// its own data more than once: typed "Updated" and "reviewed on" dates months
// behind the record they describe, "not yet loaded" notes about ballot measures
// and candidates long after both were loaded, and an HB26-1313 effective date
// that disagreed with the bill. Each check below pins the page or a data note to
// the record it has to agree with, not to its current wording: re-check the
// record and the page together and this stays green; update one and it fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const MONTH_RE = `(?:${MONTHS.join('|')})`;
const toIso = (text) => {
  let m = text.match(new RegExp(`(${MONTH_RE}) (\\d{1,2}), (\\d{4})`));
  if (m) return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = text.match(new RegExp(`(\\d{1,2}) (${MONTHS.map((x) => x.slice(0, 3)).join('|')})[a-z]* (\\d{4})`));
  if (m) return `${m[3]}-${String(MONTHS.findIndex((x) => x.startsWith(m[2])) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = text.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const page = read('housing-legislation-2026.html');
const watchlist = json('data/policy/tax-credit-legislation.json');
const watch = json('data/policy/policy-watch.json');
const road = watchlist.entries.find((e) => e.id === 'hr6644-road-act');
assert(road, 'the watchlist has no hr6644-road-act record for the ROAD Act section to agree with');

// ── 1. The ROAD Act section's typed dates are the record's dates ───────────
{
  const updated = page.match(new RegExp(`<span>Updated: (${MONTH_RE} \\d{1,2}, \\d{4})</span>`));
  assert(updated, 'the page no longer prints "Updated: <date>"; point this guard at what replaced it');
  assert.equal(toIso(updated[1]), road.last_verified,
    `the page says "Updated: ${updated[1]}" but the ROAD Act record was last verified ${road.last_verified}: re-check both together`);
  const rechecked = [...page.matchAll(new RegExp(`re-checked (?:on )?(${MONTH_RE} \\d{1,2}, \\d{4})`, 'g'))].map((m) => m[1]);
  assert(rechecked.length >= 2, `expected the status callout and the disclaimer to name the re-check date; found ${rechecked.length}`);
  for (const d of rechecked) assert.equal(toIso(d), road.last_verified, `the page says re-checked ${d}; the record says ${road.last_verified}`);
  const status = page.match(new RegExp(`H\\.R\\. 6644 Status: Enacted (${MONTH_RE} \\d{1,2}, \\d{4})`));
  assert(status && toIso(status[1]) === road.effective_date, `the page's enacted date must be the record's effective_date ${road.effective_date}`);
  const law = road.title.match(/Public Law (\d+-\d+)/);
  assert(law, 'the ROAD Act record title no longer names its public law number');
  assert(page.includes(`Public Law ${law[1]}`), `the page must name Public Law ${law[1]}, as the record does`);
}

// ── 2. "Not yet covered" says only what the data has not covered ───────────
{
  const gaps = watch.meta.known_gaps;
  const statewide = json('data/policy/ballot-2026/statewide.json');
  const reviewedStatewide = (statewide.coverage || []).some((c) => /reviewed|found/.test(c.coverage_state));
  assert(reviewedStatewide, 'statewide ballot coverage is no longer marked reviewed; this guard has nothing to check');
  assert(!gaps.some((g) => /statewide ballot/i.test(g) && /not yet/i.test(g)),
    'a known gap says statewide ballot measures are not covered, but data/policy/ballot-2026/statewide.json records a review');
  assert(!gaps.some((g) => /not yet loaded/i.test(g) && /ballot|candidate/i.test(g)),
    'a known gap says ballot or candidate data is "not yet loaded"; both are loaded and shown on Colorado Elections');
  const races = json('data/policy/candidate-platforms-2026.json').races;
  assert(races.length > 0, 'no candidate races to check');
  const candidateGap = gaps.filter((g) => /candidate/i.test(g)).join(' ');
  for (const r of races) {
    const office = r.office.split('/')[0];
    if (r.coverage_state === 'complete') {
      assert(!new RegExp(`${office}[^.]*not yet`, 'i').test(candidateGap), `${r.office} is covered but a gap says it is not`);
    } else {
      assert(candidateGap.includes(office), `${r.office} is ${r.coverage_state} but no known gap names it`);
    }
  }
}

// ── 3. HB26-1313's effective date agrees everywhere it is stated ───────────
{
  const law = watch.entries.find((e) => e.id === 'law-hb26-1313-prop123-targets');
  assert(law && /^\d{4}-\d{2}-\d{2}$/.test(law.date), 'the policy watch has no dated HB26-1313 record');
  const mentions = [];
  for (const file of ['data/policy/prop123_jurisdictions.json', 'apa-white-paper.html', 'housing-legislation-2026.html', 'data/policy/policy-watch.json']) {
    const src = read(file).replace(/<[^>]+>/g, ' ');
    for (const m of src.matchAll(/HB26-1313[^]{0,160}?effective[^]{0,22}/gi)) {
      const iso = toIso(m[0].slice(m[0].toLowerCase().lastIndexOf('effective')));
      if (iso) mentions.push({ file, iso, text: m[0] });
    }
  }
  assert(mentions.length >= 2, `expected HB26-1313 effective dates in the Prop 123 note and the white paper; found ${mentions.length}`);
  for (const { file, iso, text } of mentions) {
    assert.equal(iso, law.date, `${file} gives HB26-1313 an effective date of ${iso} ("${text.trim().slice(0, 90)}…"); the bill record says ${law.date}`);
  }
}

console.log(`policy-page-currency: PASS (ROAD Act dates = record ${road.last_verified}; gaps agree with ballot and candidate data; HB26-1313 effective ${longDate(watch.entries.find((e) => e.id === 'law-hb26-1313-prop123-targets').date)} everywhere)`);
