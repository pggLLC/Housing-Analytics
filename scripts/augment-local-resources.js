#!/usr/bin/env node
/**
 * augment-local-resources.js
 *
 * Idempotent augmentation of data/hna/local-resources.json with place-level
 * entries for the top 15 CO cities. Run once after a fresh
 * local-resources.json is published, or after adding more entries to the
 * PLACE_ENTRIES table below.
 *
 * Before this script: only 3 of 547 places had place-level entries —
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
 * Data sourced from public-facing city/county housing pages + CDOLA
 * Prop 123 commitment filings + each housing authority's own website.
 * Last verified 2026-05-26.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(__dirname, '..', 'data/hna/local-resources.json');

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
        url: 'https://bouldercolorado.gov/planning/boulder-valley-comprehensive-plan-bvcp' },
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
      { name: 'Greeley-Weld Housing Authority', url: 'https://gwhau.org/' }
    ],
    advocacy: [
      { name: 'Catholic Charities of Northern Colorado', url: 'https://ccncolorado.org/' }
    ]
  },
  // Longmont
  'place:0845970': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings' },
    housingLead: { name: 'City of Longmont Community Services', url: 'https://www.longmontcolorado.gov/departments/departments-a-d/community-services' },
    housingAuthority: [
      { name: 'Longmont Housing Authority', url: 'https://lhauthority.org/' },
      { name: 'Longmont Housing Authority Foundation', url: 'https://lhaf.org/' }
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
      { name: 'Housing Solutions for the Southwest', url: 'https://www.housingsolutionssw.com/' }
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
  // Aspen (Pitkin County)
  'place:0803455': {
    prop123: { status: 'Committed', link: 'https://cdola.colorado.gov/commitment-filings', fast_track: true },
    housingLead: { name: 'Aspen-Pitkin County Housing Authority (APCHA)', url: 'https://apcha.org/' },
    housingAuthority: [
      { name: 'Aspen-Pitkin County Housing Authority (APCHA)', url: 'https://apcha.org/' }
    ],
    housingPlans: [
      { type: 'Housing Strategy', year: 2024, name: 'Joint APCHA Strategic Plan',
        url: 'https://apcha.org/about-us/governance/' }
    ],
    notes: 'Most-mature resort-housing program in CO. APCHA manages ~3,000 deed-restricted units (50% of Aspen workforce housing supply). Model for other resort communities.'
  },
  // Vail
  'place:0680930': {
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
  }
};

function main() {
  const existing = JSON.parse(fs.readFileSync(TARGET, 'utf-8'));
  let added = 0, updated = 0;
  Object.entries(PLACE_ENTRIES).forEach(function ([key, value]) {
    if (existing[key]) {
      updated++;
    } else {
      added++;
    }
    existing[key] = value;
  });
  fs.writeFileSync(TARGET, JSON.stringify(existing, null, 2) + '\n');
  console.log(`Augmented ${TARGET}`);
  console.log(`  Added: ${added}  Updated: ${updated}  Total entries now: ${Object.keys(existing).length}`);
  console.log(`  Place-level entries now: ${Object.keys(existing).filter(k => k.startsWith('place:')).length}`);
}

main();
