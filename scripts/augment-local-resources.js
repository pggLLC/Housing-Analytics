#!/usr/bin/env node
/**
 * augment-local-resources.js
 *
 * Idempotent augmentation of data/hna/local-resources.json with place-level
 * entries for the top 15 CO cities. Run once after a fresh
 * local-resources.json is published, or after adding more entries to the
 * PLACE_ENTRIES table below.
 *
 * Before this script: only 3 of 546 jurisdictions had place-level entries —
 * Boulder city (one of CO's largest, with its own housing authority + comp
 * plan + IZ ordinance) was falling back to Boulder County data. Now any
 * city explicitly listed below gets its own block.
 *
 * Run:  node scripts/augment-local-resources.js
 *
 * To extend: add entries to PLACE_ENTRIES keyed by 'place:GEOID' format,
 * mirroring the existing county:* shape (prop123, housingLead,
 * housingAuthority, housingPlans, advocacy, contacts).
 *
 * MERGE SEMANTICS (non-destructive; see test/augment-local-resources-
 * nondestructive.test.js): the committed JSON is the source of truth.
 * local-resources.json is enriched after the fact by later processes —
 * F35 link healing (durable search URLs), discovery promotion, and
 * hand-curation (council_agenda_url, schoolDistrict, hospital,
 * majorEmployers, advocacy additions). This script therefore only FILLS IN
 * fields that are missing: new place keys are added whole, missing fields
 * on existing entries are added, plain objects are merged recursively, and
 * any field already present in the JSON (scalars AND arrays) is left
 * untouched. It never deletes or overwrites existing data.
 *
 * Data sourced from public-facing city/county housing pages + CDOLA
 * Prop 123 commitment filings + each housing authority's own website.
 * Last verified 2026-05-26; Greenwood Village verified 2026-07-14;
 * 2026-10-09 discovery intake (#2125) verified 2026-10-11.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// AUGMENT_TARGET override exists so the regression test can run this script
// end-to-end against a fixture copy instead of the committed JSON.
const TARGET = process.env.AUGMENT_TARGET
  || path.resolve(__dirname, '..', 'data/hna/local-resources.json');

// place:GEOID → resources block. GEOIDs are 7-digit CO place FIPS.
const PLACE_ENTRIES = {
  // Denver — largest CO city, robust ecosystem
  'place:0820000': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Denver Department of Housing Stability (HOST)', url: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Housing-Stability' },
    housingAuthority: [
      { name: 'Denver Housing Authority (DHA)', url: 'https://www.denverhousing.org/', totalUnits: 11000 }
    ],
    housingPlans: [
      { type: 'Housing Plan', year: 2022, name: 'Housing An Inclusive Denver 5-year strategic plan',
        url: 'https://denvergov.org/files/assets/public/v/2/housing-stability/documents/strategic_plan/housing-inclusive-denver-2022-revision.pdf' },
      { type: 'Comprehensive Plan', year: 2040, name: 'Comprehensive Plan 2040 + Housing Element',
        url: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Community-Planning-and-Development/Denveright/Comprehensive-Plan-2040' }
    ],
    advocacy: [
      { name: 'Brothers Redevelopment', url: 'https://brothersredevelopment.org/' },
      { name: 'Habitat for Humanity of Metro Denver', url: 'https://habitatmetrodenver.org/' },
      { name: 'Mile High Continuum of Care (CoC)', url: 'https://www.mdhi.org/' }
    ]
  },
  // Boulder — the user's specific call-out
  'place:0807850': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Boulder Housing & Human Services', url: 'https://bouldercolorado.gov/services/affordable-housing' },
    housingAuthority: [
      { name: 'Boulder Housing Partners (BHP)', url: 'https://boulderhousing.org/', totalUnits: 1300 }
    ],
    housingPlans: [
      { type: 'Comprehensive Plan', year: 2020, name: 'Boulder Valley Comprehensive Plan',
        url: 'https://www.google.com/search?q=%22Boulder%20Valley%20Comprehensive%20Plan%22%20Colorado' },
      { type: 'Housing Strategy', year: 2017, name: 'Middle Income Housing Strategy',
        url: 'https://bouldercolorado.gov/services/affordable-housing' }
    ],
    advocacy: [
      { name: 'Boulder County Housing Coalition', url: 'https://bouldercountyhousing.org/' },
      { name: 'Habitat for Humanity of the St. Vrain Valley', url: 'https://www.stvrainhabitat.org/' }
    ],
    notes: 'Boulder city has its own housing authority (BHP), inclusionary zoning (25% set-aside), and dedicated affordable-housing funding via the 0.46-cent sales tax. Strong civic capacity.'
  },
  // Aurora
  'place:0804000': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Aurora Housing Authority', url: 'https://www.aurora-housing.com/' },
    housingAuthority: [
      { name: 'Aurora Housing Authority', url: 'https://www.aurora-housing.com/' }
    ],
    advocacy: [
      { name: 'Aurora Mental Health & Recovery', url: 'https://www.aumhc.org/' }
    ]
  },
  // Fort Collins
  'place:0827425': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Fort Collins Social Sustainability', url: 'https://www.fcgov.com/socialsustainability/' },
    housingAuthority: [
      { name: 'Housing Catalyst (formerly Fort Collins HA)', url: 'https://housingcatalyst.com/', totalUnits: 1500 }
    ],
    housingPlans: [
      { type: 'Housing Strategy', year: 2021, name: 'Housing Strategic Plan',
        url: 'https://www.fcgov.com/socialsustainability/housing-strategic-plan' }
    ],
    advocacy: [
      { name: 'Neighbor to Neighbor', url: 'https://n2n.org/' },
      { name: 'Homeward Alliance', url: 'https://www.homewardalliance.org/' }
    ]
  },
  // Colorado Springs
  'place:0816000': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Colorado Springs Community Development Division', url: 'https://coloradosprings.gov/community-development' },
    housingAuthority: [
      { name: 'Colorado Springs Housing Authority', url: 'https://www.cshacolorado.org/' }
    ],
    advocacy: [
      { name: 'Partners In Housing', url: 'https://partnersinhousing.org/' },
      { name: 'Greccio Housing', url: 'https://greccio.org/' }
    ]
  },
  // Pueblo
  'place:0862000': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Pueblo Department of Housing & Citizen Services', url: 'https://www.pueblo.us/352/Housing-Citizen-Services' },
    housingAuthority: [
      { name: 'Pueblo Housing Authority', url: 'https://www.puebloha.org/' }
    ],
    advocacy: [
      { name: 'Posada (homeless services)', url: 'https://posadapueblo.org/' }
    ]
  },
  // Greeley
  'place:0832155': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Greeley Community Development', url: 'https://greeleygov.com/government/community-development' },
    housingAuthority: [
      { name: 'Housing Authority of the City of Greeley' }
    ],
    advocacy: [
      { name: 'Catholic Charities of Northern Colorado', url: 'https://ccncolorado.org/' }
    ]
  },
  // Greenwood Village
  'place:0833035': {
    housingLead: { name: 'Greenwood Village Community Development', url: 'https://www.greenwoodvillage.com/1064/Community-Development' },
    contacts: [
      { name: 'Greenwood Village Community Development', title: 'Community Development', jurisdiction: 'Greenwood Village', url: 'https://www.greenwoodvillage.com/1064/Community-Development' },
      { name: 'Greenwood Village Planning & Development Review', title: 'Planning & Development Review', jurisdiction: 'Greenwood Village', url: 'https://www.greenwoodvillage.com/1269/Planning-Development-Review' }
    ],
    notes: 'Official city site verified 2026-07-14. No dedicated affordable-housing page was found; Community Development is the city planning/development contact. Do not use townofgreenwood.org, a recurring wrong-state/squatter discovery candidate.'
  },
  // Longmont
  'place:0845970': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Longmont Community Services', url: 'https://www.longmontcolorado.gov/departments/departments-a-d/community-services' },
    housingAuthority: [
      // P5: lhauthority.org timing out in url-health-monitor — replaced
      // with a durable Google search per F35 pattern (memory:
      // project_local_resources_links).
      { name: 'Longmont Housing Authority', url: 'https://www.longmontcolorado.gov/departments/departments-e-m/housing-and-community-investment/housing-authority' }
    ],
    advocacy: [
      { name: 'OUR Center', url: 'https://www.ourcenter.org/' }
    ]
  },
  // Loveland
  'place:0846465': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Loveland Affordable Housing Commission', url: 'https://www.lovgov.org/government/boards-and-commissions/affordable-housing-commission' },
    housingAuthority: [
      { name: 'Loveland Housing Authority', url: 'https://lovelandhousing.org/' }
    ],
    advocacy: [
      { name: 'House of Neighborly Service', url: 'https://www.honservice.org/' }
    ]
  },
  // Lakewood
  'place:0843000': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Lakewood Community Resources', url: 'https://www.lakewood.org/Government/Departments/Community-Resources' },
    housingAuthority: [
      { name: 'Metro West Housing Solutions', url: 'https://mwhsolutions.org/' }
    ],
    advocacy: [
      { name: 'Jefferson Center for Mental Health', url: 'https://www.jcmh.org/' }
    ]
  },
  // Grand Junction
  'place:0831660': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'Grand Junction Housing Authority', url: 'https://www.gjha.org/' },
    housingAuthority: [
      { name: 'Grand Junction Housing Authority (GJHA)', url: 'https://www.gjha.org/' }
    ],
    advocacy: [
      { name: 'HomewardBound of the Grand Valley', url: 'https://homewardboundgv.org/' },
      { name: 'Grand Valley Catholic Outreach', url: 'https://gvch.org/' }
    ]
  },
  // Durango
  'place:0822035': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Durango Community Development', url: 'https://www.durangogov.org/333/Community-Development' },
    housingAuthority: [
      // Housing Solutions for the Southwest is a nonprofit, not an authority, and
      // its old domain now serves an unrelated site. The registered authority is
      // the Regional Housing Alliance (State Auditor local government 7307).
      { name: 'Regional Housing Alliance of La Plata County' }
    ],
    advocacy: [
      { name: 'Manna Soup Kitchen / Volunteers of America', url: 'https://www.mannasoupkitchen.org/' }
    ]
  },
  // Steamboat Springs
  'place:0874090': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings', fast_track: true },
    housingLead: { name: 'Yampa Valley Housing Authority', url: 'https://yvha.org/' },
    housingAuthority: [
      { name: 'Yampa Valley Housing Authority (YVHA)', url: 'https://yvha.org/' }
    ],
    notes: 'Resort/workforce market. YVHA is a multi-jurisdiction authority covering Steamboat + Routt County. Strong commitment to deed-restricted workforce housing.'
  },
  // Aspen (Pitkin County). GEOID fixed 2026-07-14: was 0803455, which is
  // Arvada — the old destructive rewrite stamped Aspen data onto Arvada's
  // entry. 0803620 is Aspen's actual CO place FIPS.
  'place:0803620': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings', fast_track: true },
    housingLead: { name: 'Aspen-Pitkin County Housing Authority (APCHA)', url: 'https://apcha.org/' },
    housingAuthority: [
      { name: 'Aspen-Pitkin County Housing Authority (APCHA)', url: 'https://apcha.org/' }
    ],
    housingPlans: [
      // /about-us/governance/ 404s (site alive, page gone). apcha.org now runs
      // CivicEngage; /27/About is what the homepage itself links to and returns
      // 200 ("About | APCHA, CO"). Verified 2026-09-09.
      { type: 'Housing Strategy', year: 2024, name: 'Joint APCHA Strategic Plan',
        url: 'https://apcha.org/27/About' }
    ],
    notes: 'Most-mature resort-housing program in CO. APCHA manages ~3,000 deed-restricted units (50% of Aspen workforce housing supply). Model for other resort communities.'
  },
  // Vail. GEOID fixed 2026-07-14: was 0680930, a California FIPS — earlier
  // runs created an orphan 'place:0680930' entry in the JSON. 0880040 is
  // Vail's actual CO place FIPS.
  'place:0880040': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings', fast_track: true },
    housingLead: { name: 'Vail Housing Department', url: 'https://www.vailgov.com/government/departments/housing' },
    housingAuthority: [
      { name: 'Vail Local Housing Authority', url: 'https://www.vailgov.com/government/boards-commissions/vail-local-housing-authority' }
    ],
    housingPlans: [
      { type: 'Housing Strategy', year: 2018, name: 'Vail Housing 2027 strategic plan',
        url: 'https://www.vailgov.com/government/departments/housing' }
    ],
    notes: 'Vail InDEED deed-restriction program is a national model. Goal: 1,000 new deed-restricted units by 2027.'
  },
  /* ── 2026-09-09 weekly discovery intake (#1551) ──────────────────────
     Every base URL below was fetched with a browser user-agent and checked
     for municipal markers (council/mayor/agenda/"Official Website"); each
     returned 200 with 5-37 such markers. Only Timnath had a housing
     sub-path the crawler could find, so it is the only deep link here —
     the rest point at the verified official site rather than a guessed
     /government/departments/... path (F35: prefer durable over guessed).

     Two candidates from the same run are deliberately NOT added, because
     they are not municipal sites at all — the crawler's "mentions
     Colorado" heuristic cannot tell a city from a chamber:
       place:0848445 Manitou Springs — manitousprings.org is the Chamber
         of Commerce / tourism site ("Visit Manitou Springs…"), 0 municipal
         markers.
       place:0886750 Yuma — cityofyuma.com is a visitor-guide content site
         ("Discover the Best of Yuma…"), 0 municipal markers.
     Both need the real municipal URL found by hand before they go in. */
  'place:0877510': {
    name: 'Timnath',
    housingLead: { name: 'Town of Timnath Community Development', url: 'https://timnath.org/community-development/' }
  },
  'place:0885485': {
    name: 'Windsor',
    housingLead: { name: 'Town of Windsor (official site)', url: 'https://www.windsorco.gov/' }
  },
  'place:0833640': {
    name: 'Gunnison',
    housingLead: { name: 'City of Gunnison (official site)', url: 'https://www.gunnisonco.gov/' }
  },
  'place:0839855': {
    name: 'Johnstown',
    housingLead: { name: 'Town of Johnstown (official site)', url: 'https://www.johnstownco.gov/' }
  },
  'place:0827700': {
    name: 'Fort Lupton',
    housingLead: { name: 'City of Fort Lupton (official site)', url: 'https://www.fortluptonco.gov/' }
  },
  'place:0826600': {
    name: 'Firestone',
    housingLead: { name: 'Town of Firestone (official site)', url: 'https://www.firestoneco.gov/' }
  },
  'place:0851800': {
    name: 'Monument',
    housingLead: { name: 'Town of Monument (official site)', url: 'https://www.townofmonument.org/' }
  },
  'place:0886090': {
    name: 'Woodland Park',
    housingLead: { name: 'City of Woodland Park (official site)', url: 'https://woodlandpark.gov/' }
  },
  'place:0851635': {
    name: 'Monte Vista',
    housingLead: { name: 'City of Monte Vista (official site)', url: 'https://www.montevista.gov/' }
  },
  'place:0883230': {
    name: 'Wellington',
    housingLead: { name: 'Town of Wellington (official site)', url: 'https://www.wellingtoncolorado.gov/' }
  },
  'place:0886310': {
    name: 'Wray',
    housingLead: { name: 'City of Wray (official site)', url: 'https://www.cityofwray.org/' }
  },
  /* ── 2026-10-09 weekly discovery intake (#2125) ──────────────────────
     Almost every URL the digest proposed was wrong: wrong-state sites
     (Florence -> Florence, SC; Evans -> Evans, NY), parked or for-sale
     domains (Glendale -> an Epik sale page), unrelated orgs (Sterling,
     Cañon City, Fort Morgan, Edgewater) and, for Las Animas, a tour-booking
     page on geo.org. Each URL below was found by hand on 2026-10-11,
     fetched with a browser user-agent (HTTP 200), and read: it is on the
     Colorado municipality's own site (or its housing authority's) and the
     page is about housing.

     Only places with a real housing page are added. A plain municipal
     homepage is NOT stored as `housingLead`: hna-renderers.js treats any
     housingLead as the place's housing contact and stops inheriting the
     county's lead and housing authorities, and lihtc-opportunity-finder.js
     uses a place entry without merging the county at all. So a homepage
     entry would hide e.g. Bent County's Las Animas Housing Authority.
     These places had a verified official site but no housing page, and are
     left to the county fallback (official sites recorded for the next
     intake, so the digest's wrong URLs are not retried):
       Las Animas 0843660 cityoflasanimasco.gov · Yuma 0886750
       cityofyuma.colorado.gov · Fairplay 0825610 fairplayco.us (not the
       stale townoffairplay.com) · Cripple Creek 0818530
       cityofcripplecreek.com · Center 0812855 centerco.gov · Glendale
       0830340 glendale.co.us · Federal Heights 0826270 fedheights.org ·
       Evans 0825280 evanscolorado.gov · Cañon City 0811810 canoncity.org ·
       Fort Morgan 0827810 cityoffortmorgan.com · Castle Pines 0812387
       castlepinesco.gov (Community Development only) · Florence 0827040
       cityofflorenceco.gov.

     Not added because the official site answers every non-browser request
     with HTTP 403, so the URL cannot be verified here and the URL-health
     sweep would report it as broken:
       place:0848445 Manitou Springs — manitouspringsco.gov (Cloudflare 403;
         the digest's manitousprings.org is the Chamber/tourism site).
       place:0823135 Edgewater — edgewaterco.gov (Akamai 403; the digest's
         edgewater.org is an unrelated chamber of commerce). */
  'place:0831605': {
    name: 'Granby',
    housingLead: { name: 'Town of Granby Housing', url: 'https://townofgranby.com/housing' },
    notes: 'Town housing page covers Nuche Village, the town\'s income- and asset-restricted workforce for-sale development, and the Community Housing Interest Form. Verified 2026-10-11.'
  },
  'place:0819080': {
    name: 'Dacono',
    housingLead: { name: 'City of Dacono Community Development', url: 'https://www.daconoco.gov/478/Community-Development' },
    notes: 'Final drafts of the 2026 HNA and Housing Action Plan were posted for public review in September 2026, ahead of City Council adoption (https://www.daconoco.gov/900/Comprehensive-Plan). They are not listed as plans until adopted, so the policy scorecard does not count a draft. Verified 2026-10-11.'
  },
  'place:0827865': {
    name: 'Fountain',
    housingLead: { name: 'Fountain Housing Authority', url: 'https://fountainhousingauthority.colorado.gov/' },
    housingAuthority: [
      { name: 'Fountain Housing Authority', url: 'https://fountainhousingauthority.colorado.gov/' }
    ],
    notes: 'City site is fountain.colorado.gov. Verified 2026-10-11.'
  },
  'place:0873935': {
    name: 'Sterling',
    housingLead: { name: 'Housing Authority of the City of Sterling', url: 'https://www.sterlingcolo.com/government/boards_and_commissions/housing_authority.php' },
    housingAuthority: [
      { name: 'Sterling Housing Authority', url: 'https://www.sterlingcolo.com/government/boards_and_commissions/housing_authority.php' }
    ],
    notes: 'The housing authority is a separate public body under C.R.S. 29-4-209 whose five commissioners are appointed by the Mayor; the page is on the official city site. Verified 2026-10-11.'
  }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively fill fields from `incoming` into `existing` without ever
 * overwriting or deleting anything already there. The committed JSON wins
 * every conflict: scalars and arrays present in `existing` are left as-is
 * (arrays are NOT merged element-wise — a healed URL or hand-added array
 * item must survive), plain objects recurse. Returns the number of fields
 * added. Mutates `existing`.
 */
function mergeMissing(existing, incoming) {
  let added = 0;
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in existing)) {
      existing[key] = value;
      added++;
    } else if (isPlainObject(existing[key]) && isPlainObject(value)) {
      added += mergeMissing(existing[key], value);
    }
    // else: existing wins — never overwrite committed scalars or arrays
  }
  return added;
}

function main() {
  const existing = JSON.parse(fs.readFileSync(TARGET, 'utf-8'));
  let added = 0, filled = 0, untouched = 0;
  Object.entries(PLACE_ENTRIES).forEach(function ([key, value]) {
    if (!existing[key]) {
      existing[key] = value;
      added++;
    } else {
      const n = mergeMissing(existing[key], value);
      if (n > 0) filled++; else untouched++;
    }
  });
  if (added === 0 && filled === 0) {
    console.log(`No changes needed for ${TARGET} (${untouched} entries already complete)`);
    return;
  }
  fs.writeFileSync(TARGET, JSON.stringify(existing, null, 2) + '\n');
  console.log(`Augmented ${TARGET}`);
  console.log(`  New entries: ${added}  Entries with fields filled in: ${filled}  Already complete: ${untouched}`);
  console.log(`  Total entries now: ${Object.keys(existing).length}`);
  console.log(`  Place-level entries now: ${Object.keys(existing).filter(k => k.startsWith('place:')).length}`);
}

module.exports = { PLACE_ENTRIES, mergeMissing, TARGET };

if (require.main === module) {
  main();
}
