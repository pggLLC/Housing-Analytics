'use strict';

/**
 * Guard: a place/CDP entry in local-resources.json must earn its place.
 *
 * `js/hna/hna-renderers.js` consults the containing county ONLY when no entry
 * exists for the geography:
 *
 *   let r = lrData[key] || lrData[geoid] || null;
 *   if (!r && (geoType === 'place' || geoType === 'cdp')) { ...county... }
 *
 * So an entry that carries little suppresses everything the county would have
 * shown, and the user sees less than if the entry did not exist.
 *
 * Palisade (`place:0856970`) was exactly that: its entry held only `prop123`
 * (identical to Mesa County's) and one advocacy org (already in Mesa's list).
 * It contributed nothing unique while hiding Mesa County's housing lead, the
 * Grand Junction and Fruita Housing Authorities — both with direct URLs — and
 * two contacts. Removing it lets the county fallback serve a strict superset,
 * labelled "Showing county-level resources".
 *
 * See issue #1540.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const lr = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/hna/local-resources.json'), 'utf8')
);

const registry = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/hna/geography-registry.json'), 'utf8')
).geographies || [];

function countyKeyFor(entryKey) {
  const geoid = entryKey.split(':')[1];
  const g = registry.find((x) => x.geoid === geoid);
  return g && g.containingCounty ? 'county:' + g.containingCounty : null;
}

const localKeys = Object.keys(lr).filter((k) => /^(place|cdp):/.test(k));
assert(localKeys.length > 0, 'fixture sanity: there should be place/CDP entries');

/** Does this entry give the reader a way to reach someone about housing? */
function hasHousingContact(e) {
  const lead = e.housingLead;
  if (lead && (lead.name || lead.url)) return true;
  return Array.isArray(e.housingAuthority) && e.housingAuthority.length > 0;
}

// ── An entry lacking a housing contact must inherit one from its county ────
// The renderer now inherits missing fields, so such an entry no longer hides
// the county's housing contact. What must NOT happen is an entry that lacks one
// AND whose county lacks one, which would leave the reader with nothing.
const strandedNoContact = localKeys.filter((k) => {
  if (hasHousingContact(lr[k])) return false;
  const ck = countyKeyFor(k);
  const c = ck && lr[ck];
  return !(c && hasHousingContact(c));
});
assert.deepStrictEqual(
  strandedNoContact, [],
  'these place/CDP entries have no housing contact and no county to inherit one ' +
  'from, so they show nothing actionable: ' + strandedNoContact.join(', ')
);

// ── The renderer must inherit missing fields rather than suppress them ─────
const renderer = fs.readFileSync(path.join(ROOT, 'js/hna/hna-renderers.js'), 'utf8');
assert(
  /INHERITABLE/.test(renderer),
  'hna-renderers must inherit missing local-resource fields from the county'
);
assert(
  /inheritedFields\.length/.test(renderer),
  'inheritance must be disclosed to the reader, not silent'
);

// How many entries actually rely on inheritance today?
const inheriting = localKeys.filter((k) => !hasHousingContact(lr[k]));

console.log(
  `local-resources-entry-completeness: PASS (${localKeys.length} place/CDP entries; ` +
  `${inheriting.length} inherit a housing contact from their county; none stranded)`
);
