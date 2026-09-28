#!/usr/bin/env node
// Insights-area statements must agree with the source they summarise (#2008).
// Each check names what the copy has to agree with — the legislation page's
// own status line, the policy watchlist, a data file's meta year, a file on
// disk — so rewording either side together stays green and a stale claim
// fails. Nothing here pins a sentence.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

// 1. The Research & Analysis card for the legislation page must carry that
//    page's status. If the page says Enacted <date>, the card must say the
//    bill became law on that date and must not describe it as still moving.
//    Cards render from data/insights/catalog.json, so the card text is the
//    catalog entry's title and summary.
const legislation = read('housing-legislation-2026.html');
const status = legislation.match(/H\.R\. 6644 Status:\s*(Enacted)\s+([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
assert(status, 'housing-legislation-2026.html no longer prints an "H.R. 6644 Status: Enacted <date>" line; update this guard with it');
const catalogEntry = JSON.parse(read('data/insights/catalog.json')).entries.find((e) => e.url === 'housing-legislation-2026.html');
assert(catalogEntry, 'the Research & Analysis catalog has no card linking to housing-legislation-2026.html');
const cardText = `${catalogEntry.title} ${catalogEntry.summary}`;
const shortMonth = status[2].slice(0, 3);
assert(new RegExp(`became law\\s+(${status[2]}|${shortMonth})\\.?\\s+${status[3]},\\s+${status[4]}`, 'i').test(cardText),
  `the Insights ROAD Act card must say it became law ${status[2]} ${status[3]}, ${status[4]}, as the legislation page does`);
assert(!/awaiting|back in the Senate|pending in/i.test(cardText),
  'the Insights ROAD Act card still describes an enacted law as pending');

// 2. The glossary's AHCIA definition must agree with the watchlist: if the
//    AHCIA provisions carried by the 2025 reconciliation law are enacted
//    there, the definition cannot call AHCIA purely proposed.
const watch = JSON.parse(read('data/policy/tax-credit-legislation.json')).entries;
const ahciaEnacted = watch.filter((e) => /^obbba-lihtc-/.test(e.id) && e.status === 'enacted');
assert(ahciaEnacted.length > 0 || watch.some((e) => /^obbba-lihtc-/.test(e.id)), 'watchlist has no obbba-lihtc-* entries to compare against');
const glossary = read('js/components/inline-glossary.js').match(/'AHCIA':\s*'((?:[^'\\]|\\.)*)'/);
assert(glossary, 'inline-glossary.js has no AHCIA entry');
if (ahciaEnacted.length) {
  assert(/enacted|became law/i.test(glossary[1]),
    `the watchlist marks ${ahciaEnacted.map((e) => e.id).join(', ')} enacted, but the AHCIA glossary entry does not say any of it is enacted`);
}

// 3. A HUD income-limit year shown beside the AMI-gap figures must come from
//    the data file, never be typed. co_ami_gap_by_*.json carry
//    meta.hud_income_limits_year; a literal "HUD 20xx income limits" in a
//    renderer of those files is the defect this replaced.
const meta = JSON.parse(read('data/co_ami_gap_by_county.json')).meta;
assert(Number.isInteger(meta.hud_income_limits_year), 'co_ami_gap_by_county.json lost meta.hud_income_limits_year');
for (const file of ['colorado-deep-dive.html', 'js/hna/hna-renderers.js', 'ic-summary.html']) {
  const src = read(file);
  assert(src.includes('co_ami_gap_by_') || src.includes('acsAmiData'), `${file} no longer reads the AMI-gap files; drop it from this guard`);
  // A year may appear only inside a [data-ami-il-year] slot the page fills
  // from meta, and that slot's no-JS fallback must match the data.
  const slots = [...src.matchAll(/<span data-ami-il-year>([^<]*)<\/span>/g)].map((m) => m[1]);
  for (const slot of slots) {
    assert.equal(slot, `FY${meta.hud_income_limits_year}`, `${file}: a [data-ami-il-year] fallback reads ${slot}, the data says FY${meta.hud_income_limits_year}`);
  }
  if (slots.length) {
    assert(/querySelectorAll\('\[data-ami-il-year\]'\)[\s\S]{0,200}hud_income_limits_year/.test(src),
      `${file} has [data-ami-il-year] slots but never fills them from meta.hud_income_limits_year`);
  }
  const unslotted = src.replace(/<span data-ami-il-year>[^<]*<\/span>/g, 'SLOT');
  const typed = unslotted.match(/(?:FY\s?)?20\d\d\s+(?:county\s+)?income limits/gi);
  assert(!typed, `${file} types a HUD income-limit year (${typed && typed[0]}); put it in a [data-ami-il-year] slot or read meta.hud_income_limits_year`);
}

// 4. Every data file a page cites by path in <code> must exist. The scan is
//    the non-vacuity check: it has to find citations to check.
let cited = 0;
const missing = [];
for (const file of readdirSync('.').filter((f) => f.endsWith('.html'))) {
  for (const m of read(file).matchAll(/<code>(data\/[A-Za-z0-9_./-]+\.(?:json|geojson|csv))<\/code>/g)) {
    cited++;
    if (!existsSync(m[1])) missing.push(`${file}: ${m[1]}`);
  }
}
assert(cited >= 5, `expected pages to cite data files in <code>, found ${cited}`);
assert.deepEqual(missing, [], `pages cite data files that do not exist:\n${missing.join('\n')}`);

console.log(`Insights agreement: PASS (ROAD card = page status ${status[1]} ${status[2]} ${status[3]}, ${status[4]}; ` +
  `AHCIA glossary vs ${ahciaEnacted.length} enacted watchlist entries; HUD year from meta (${meta.hud_income_limits_year}); ${cited} cited data paths exist)`);
