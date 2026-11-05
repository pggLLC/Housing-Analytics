#!/usr/bin/env node
/**
 * Contract for data/market/local-players.json (scripts/market/build_local_players.py), the
 * basic who-works-here card on the place pages, and the gated Local players section of the
 * Jurisdiction Report.
 *   - the public file names only public bodies and nonprofits: no company, private land
 *     owner or person, and nothing the brand guard blocks;
 *   - a county whose parcels are not shared has land null with a reason, never zeros;
 *   - the place template carries the card, the builder feeds it, and the report renders
 *     the section from a detail file and says so when there is none.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const { isSensitive } = await import(join(ROOT, 'scripts/lib/public-sensitive-patterns.mjs'));
const doc = JSON.parse(read('data/market/local-players.json'));
const PUBLIC = new Set(['federal', 'state', 'tribal', 'county', 'municipal', 'school', 'special_district', 'housing_authority']);
let checks = 0;
// Mirrors GOV_FORM in scripts/market/build_local_players.py.
const CO_ = '(?:(?:CO|COLORADO) )?';
const GOV_FORM = new RegExp('(?:^| )(?:(?:A|AN) )?(?:' + CO_ + '(?:HOME RULE |STATUTORY |QUASI ?)?MUNICIPAL CORP\\w*|' + CO_ + '(?:HOME RULE )?MUNICIPALITY|' + CO_ + 'HOME RULE CORP\\w*|BODY (?:CORP\\w*|POLITIC)(?: AND (?:POL\\w*|CORP\\w*))?|POLITICAL SUB\\w*|(?<=A )' + CO_ + 'SPECIAL DISTRICT)(?: (?:OF|STATE OF|FINANCE) .*)?$');
const ok = (c, m) => { assert.ok(c, m); checks++; };

ok(Object.keys(doc.areas).length >= 64, 'every county is in the file');
ok(!isSensitive(JSON.stringify(doc)), 'the public file trips the public-artifact guard');
for (const [g, a] of Object.entries(doc.areas)) {
  ok(a.geoid === g, `${g}: geoid key`);
  const d = a.developers;
  ok(!('organisations_list' in d) && Array.isArray(d.public_and_nonprofit), `${g}: developer names are only public and nonprofit`);
  ok(Number.isInteger(d.organisations), `${g}: developer count`);
  if (a.land) {
    const publicLabels = new Set(a.land.by_type.filter((t) => t.public).map((t) => t.label));
    for (const o of a.land.largest_public_owners) ok(publicLabels.has(o.type_label), `${g}: ${o.owner} is not a public owner`);
    // A public label is not proof: a legal entity or a trust is never listed as a public owner
    // (federal land held "in trust" for a tribe is the one trust wording allowed).
    // A government's own legal form ("a Municipal Corporation", "a Body Politic") is set
    // aside first; "Co" is read as company only when it ends a name that does not open
    // like a government ("Town of Mountain Village Co" is the town).
    for (const o of a.land.largest_public_owners) {
      const name = o.owner.replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
      const bare = name.replace(GOV_FORM, '').trim();
      ok(!/\b(LLC|L L C|LLLP|LLP|LP|INC|CORP|CORPORATION|LTD|COMPANY|ESTATE|TRUSTEES?)\b/.test(bare), `${g}: ${o.owner} is a private entity listed as public`);
      ok(!/ CO$/.test(bare) || /^(THE )?(CITY|TOWN|STATE|COUNTY|BOARD OF (THE )?COUNTY) OF |^(\w+ ){1,2}COUNTY /.test(bare), `${g}: ${o.owner} reads as a company listed as public`);
      ok(!/\bTRUST\b/i.test(o.owner) || /^united states of america in trust$/i.test(o.owner), `${g}: ${o.owner} is a trust listed as public`);
    }
    for (const t of a.land.by_type) ok(!('owner' in t), `${g}: land types carry no names`);
    ok(a.land.by_type.every((t) => t.public === PUBLIC.has(t.type)), `${g}: public flag matches the type`);
  } else if (a.kind === 'county') {
    ok(typeof a.land_unavailable_reason === 'string' && a.land_unavailable_reason.length > 20, `${g}: missing land says why`);
  }
}
ok(!/largest_private_organisations|most_parcels_private/.test(JSON.stringify(doc)), 'private owner lists stay out of the public file');
// County totals are computed before the named top-15 cut (Denver has far more than 15 sponsors).
ok(doc.areas['08031'].developers.organisations > 15, 'county developer totals are not cut to the named list');
// Nonprofit counts are taken before the named top-15 cut (Codex, PR #2701).
ok(doc.areas['08013'].providers.housing_nonprofits > 15, 'Boulder County nonprofit count is not cut to the named list');
// Acreage past the largest owners has no owner type: the place card shows it apart, never as people.
{
  const bpp = read('scripts/hna/build_place_pages.py');
  ok(/'unsorted'/.test(bpp) && !/key == 'people':\s*\n\s*acres \+=/.test(bpp), 'unsorted acreage is its own group on the place card');
}
// Nonprofit only on evidence (IRS list or the name says so): a company using
// "community development partners" is not named (Codex, PR #2701).
ok(!JSON.stringify(doc).includes('Community Development Partners'), 'a company is not published as a nonprofit builder');
// A joint sponsor is split before it is classified: the company half is never
// published as a public builder (Codex, PR #2701).
for (const a of Object.values(doc.areas)) ok(!a.developers.public_and_nonprofit.some((n) => /\b(group|llc|lllp|lp)\b/i.test(n)), `${a.geoid}: no company name among public and nonprofit builders`);
// Restricted homes are LI_UNITS as published: a 0 stays 0, never total units (Codex, PR #2701).
{
  const feats = JSON.parse(read('data/chfa-lihtc.json')).features;
  const want = {};
  for (const f of feats) { const p = f.properties; if (p.CNTY_FIPS && p.LI_UNITS != null && p.LI_UNITS !== '') want[p.CNTY_FIPS] = (want[p.CNTY_FIPS] || 0) + Number(p.LI_UNITS); }
  for (const g of ['08001', '08031', '08049']) ok(doc.areas[g].developers.tax_credit_properties.homes === want[g], `${g}: restricted homes equal the published LI_UNITS sum`);
}
// Totals use the same canonical sponsors as the detail: Mesa's run-in housing authority row is one body.
ok(doc.areas['08077'].developers.by_kind['housing authority'] === 1, 'Mesa counts one housing authority, not the run-in row as a second');
// Counties that share parcels without owner names have no land section, and say why.
for (const g of ['08041', '08117', '08121']) ok(!doc.areas[g].land && /owner names/.test(doc.areas[g].land_unavailable_reason), `${g}: owner-less parcels are not shown as land holders`);
ok(/\('people', 'People and family trusts', \{'individual', 'trust'\}\)/.test(read('scripts/hna/build_place_pages.py')), 'records with no owner are not counted as people');
// A city that writes its legal form after its name is still a city (Codex, PR #2701).
ok(doc.areas['08101'].land.largest_public_owners.some((o) => /^City of Pueblo/.test(o.owner) && o.type_label === 'City and town governments'), 'City of Pueblo a Municipal Corporation counts as a city');

const tpl = read('places/_template.html');
ok(tpl.includes('id="psPlayersCard"') && tpl.includes('data.local_players'), 'place template renders the card');
ok(read('scripts/hna/build_place_pages.py').includes("'local_players'"), 'place builder feeds the card');

const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
const { loadSources, build } = await import(join(ROOT, 'scripts/whitepaper/build-whitepaper.mjs'));
const src = loadSources();
const html = build('08077', { src }).html;
ok(/id="players"/.test(html) && /load on the gated developer site only/.test(html), 'report says the section is gated when no detail file is present');
ok(WP.localPlayersPath('08077') === 'data/jurisdiction-briefs/_local-players/08077.json', 'detail path');
ok(WP.countyOf(src, '0831660') === '08077' && WP.countyOf(src, '08077') === null, 'town reads its county');
console.log(`local-players: ${checks} checks passed`);
