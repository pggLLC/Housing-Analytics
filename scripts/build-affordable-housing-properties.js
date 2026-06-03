#!/usr/bin/env node
/**
 * build-affordable-housing-properties.js
 *
 * Combines the source-specific affordable-housing datasets into a single
 * unified `data/affordable-housing/properties.json` with a `program_type`
 * discriminator that lets downstream consumers (Opportunity Finder,
 * Colorado Deep Dive, etc.) filter by program without needing to know
 * which file each property came from.
 *
 * Sources combined (and how each becomes a program_type):
 *
 *   data/affordable-housing/lihtc/chfa-properties.json
 *     - 'lihtc-9pct'           — TypeOfCredits contains '9%'
 *     - 'lihtc-4pct'           — TypeOfCredits contains '4%' (not 9%)
 *     - 'lihtc-mihtc'          — TypeOfCredits contains 'MIHTC' (state-only)
 *     - 'lihtc-state-paired'   — TypeOfCredits contains 'State' (Prop 123 paired)
 *     - 'lihtc-toc-paired'     — TypeOfCredits contains 'TOC' (Transit-Oriented)
 *     (program_type is multi-valued — a "9% and State and TOC" project
 *      gets ['lihtc-9pct', 'lihtc-state-paired', 'lihtc-toc-paired'])
 *
 *   data/affordable-housing/preservation/chfa-preservation.json
 *     - 'preservation-candidate'
 *
 *   (Future) data/affordable-housing/locally-funded/prop123-awards.json
 *     - 'prop123-only'         — pure Prop 123 deals without LIHTC
 *       (Currently absent; would need DOLA's award announcements page
 *        which is bot-blocked. Tracked as audit P1 backlog.)
 *
 * Output schema (per property):
 *   {
 *     property_id: 'lihtc:925' | 'preservation:1' | ...,
 *     program_type: ['lihtc-9pct', 'lihtc-state-paired'],
 *     property_name: '...',
 *     address: '...',
 *     city: '...',
 *     county_fips: '...',
 *     state: 'CO',
 *     zip: '...',
 *     total_units: 60,
 *     assisted_units: 60,        // LIHTC: LowIncomeUnits; preservation: same as total
 *     latest_year: 2025,         // YR_PIS or AwardYear; null if unknown
 *     lat: 39.x,
 *     lng: -104.x,
 *     source: 'CHFA HousingTaxCreditProperties_view',
 *     source_id: 'unique-record-id-in-source'
 *   }
 *
 * Run:  node scripts/build-affordable-housing-properties.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIHTC_PATH         = path.join(ROOT, 'data/affordable-housing/lihtc/chfa-properties.json');
const PRESERVATION_PATH  = path.join(ROOT, 'data/affordable-housing/preservation/chfa-preservation.json');
const HUD_MF_PATH        = path.join(ROOT, 'data/affordable-housing/preservation/hud-multifamily-assisted.json');
const USDA_RD_PATH       = path.join(ROOT, 'data/affordable-housing/preservation/usda-rural-housing.json');
const LOCAL_PHA_DIR      = path.join(ROOT, 'data/affordable-housing/local-pha-roster');
const OUT_PATH           = path.join(ROOT, 'data/affordable-housing/properties.json');
const MANIFEST_PATH      = path.join(ROOT, 'data/affordable-housing/properties-manifest.json');

const crypto = require('crypto');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/**
 * Derive program_type array from a CHFA LIHTC project's TypeOfCredits string.
 * Returns an array — a single project may belong to multiple program types
 * (e.g., "9% and State and TOC" → 9%, state-paired, TOC).
 */
function derivePrograms(typeOfCredits) {
  const t = (typeOfCredits || '').toUpperCase();
  const out = [];
  // Order: most-specific first (so consumer can pick first match if they want a single label)
  if (t.includes('MIHTC') && !t.includes('%'))  out.push('lihtc-mihtc');        // pure MIHTC, no LIHTC
  if (t.includes('9%') || t.includes('9 %'))    out.push('lihtc-9pct');
  if (t.includes('4%') || t.includes('4 %'))    out.push('lihtc-4pct');
  if (t.includes('TAX EXEMPT'))                 out.push('lihtc-4pct');         // "4% Tax Exempt" without explicit "4%"
  if (t.includes('STATE'))                      out.push('lihtc-state-paired'); // Prop 123 / MIHTC paired
  if (t.includes('TOC'))                        out.push('lihtc-toc-paired');   // Transit-Oriented Communities
  // Catch-all if nothing matched
  if (out.length === 0) out.push('lihtc-unknown');
  // Dedupe
  return Array.from(new Set(out));
}

function normalizeLihtc(feature, idx) {
  const p = feature.properties || {};
  const g = feature.geometry || {};
  const coords = g.coordinates || [null, null];
  return {
    property_id: 'lihtc:' + (p.UniqueLocationID || idx),
    program_type: derivePrograms(p.TypeOfCredits),
    property_name: p.PROJECT || p.ReportedName || null,
    address: p.PROJ_ADD || null,
    city: p.PROJ_CTY || null,
    county_fips: p.CNTY_FIPS || null,
    state: p.PROJ_ST || 'CO',
    zip: null,                                // not in LIHTC fields
    total_units: p.N_UNITS || null,
    assisted_units: p.LI_UNITS || p.N_UNITS || null,
    latest_year: p.YR_PIS || p.AwardYear || null,  // YR_PIS = year placed in service
    // F103 — Preserve CHFA award metadata so the brief can distinguish
    // "awarded in 2025 but not yet placed in service" from "placed 2025".
    // This is the data developers actually care about when scanning recent
    // LIHTC activity for a market.
    award_year: p.AwardYear || null,
    award_date: p.AwardDate || null,
    reservation_year: p.ReservationYear || null,
    year_placed_in_service: p.YR_PIS || null,
    lat: Number.isFinite(coords[1]) ? coords[1] : null,
    lng: Number.isFinite(coords[0]) ? coords[0] : null,
    source: p._source || 'CHFA LIHTC',
    source_id: p.UniqueLocationID || null,
    // Pass-through extra fields useful for filtering
    compliance_status: p.ComplianceStatus || null,
    project_type: p.ProjectType || null,
    type_of_credits: p.TypeOfCredits || null,
    region: p.Region || null,
    urban_rural: p.UrbanRural || null,
    // Population targeting (preserved when present)
    senior_units: p.PopulationUnits?.senior || 0,
    family_units: p.PopulationUnits?.family || 0,
    homeless_units: p.PopulationUnits?.homeless || 0,
    veteran_units: p.PopulationUnits?.veteran || 0,
    supportive_units: p.PopulationUnits?.supportive || 0
  };
}

function normalizePreservation(feature, idx) {
  const p = feature.properties || {};
  const g = feature.geometry || {};
  const coords = g.coordinates || [null, null];
  return {
    property_id: 'preservation:' + (p.UniqueProjID || p.RecordID || idx),
    program_type: ['preservation-candidate'],
    property_name: p.PROJECT || null,
    address: p.PROJ_ADD || null,
    city: p.PROJ_CTY || null,
    county_fips: null,                        // not in source
    state: p.PROJ_ST || 'CO',
    zip: p.Zip || null,
    total_units: p.N_UNITS || null,
    assisted_units: p.N_UNITS || null,
    latest_year: null,
    lat: Number.isFinite(coords[1]) ? coords[1] : null,
    lng: Number.isFinite(coords[0]) ? coords[0] : null,
    source: p._source || 'CHFA Preservation',
    source_id: p.UniqueProjID || null,
    subsidy_type: null,                       // not in CHFA preservation source
    years_to_expiration: null,
    compliance_status: null, project_type: null, type_of_credits: null,
    region: null, urban_rural: null,
    senior_units: 0, family_units: 0, homeless_units: 0,
    veteran_units: 0, supportive_units: 0
  };
}

/**
 * Normalize a HUD Multifamily Assisted property. Adds subsidy_type detail
 * (Section 8 PBRA, HUD 202/811, FHA-insured, etc.) that CHFA preservation
 * source lacks.
 */
function normalizeHudMf(feature, idx) {
  const p = feature.properties || {};
  const g = feature.geometry || {};
  const coords = g.coordinates || [null, null];
  return {
    property_id: 'hud-mf:' + (p.PROPERTY_ID || idx),
    program_type: ['preservation-candidate', 'hud-multifamily'],
    property_name: p.PROJECT || null,
    address: p.PROJ_ADD || null,
    city: p.PROJ_CTY || null,
    county_fips: p.CNTY_FIPS || null,
    state: p.PROJ_ST || 'CO',
    zip: p.Zip || null,
    total_units: p.N_UNITS || null,
    assisted_units: p.LI_UNITS || p.N_UNITS || null,
    latest_year: null,
    lat: Number.isFinite(coords[1]) ? coords[1] : null,
    lng: Number.isFinite(coords[0]) ? coords[0] : null,
    source: p._source || 'HUD MULTIFAMILY_PROPERTIES_ASSISTED',
    source_id: p.PROPERTY_ID || null,
    subsidy_type: p.subsidy_type || 'unknown',
    years_to_expiration: null,
    property_category: p.property_category || null,
    has_use_restriction: p.has_use_restriction || false,
    is_troubled: p.is_troubled || false,
    compliance_status: null, project_type: null, type_of_credits: null,
    region: null, urban_rural: null,
    senior_units: 0, family_units: 0, homeless_units: 0,
    veteran_units: 0, supportive_units: 0
  };
}

/**
 * Normalize a USDA Rural Housing property. Adds restrictive-clause-expiration
 * date — the single most-actionable preservation signal (a property
 * expiring 0-5y is much hotter than one expiring 20y+).
 */
function normalizeUsdaRd(feature, idx) {
  const p = feature.properties || {};
  const g = feature.geometry || {};
  const coords = g.coordinates || [null, null];
  return {
    property_id: 'usda-rd:' + idx,
    program_type: ['preservation-candidate', 'usda-rural-development'],
    property_name: p.PROJECT || null,
    address: p.PROJ_ADD || null,
    city: p.PROJ_CTY || null,
    county_fips: p.CNTY_FIPS || null,
    state: p.PROJ_ST || 'CO',
    zip: p.Zip || null,
    total_units: p.N_UNITS || null,
    assisted_units: p.LI_UNITS || p.N_UNITS || null,
    latest_year: null,
    lat: Number.isFinite(coords[1]) ? coords[1] : null,
    lng: Number.isFinite(coords[0]) ? coords[0] : null,
    source: p._source || 'USDA Rural Housing Assets',
    source_id: null,
    subsidy_type: p.subsidy_type || 'usda-rd',
    restrictive_expiration: p.restrictive_expiration || null,
    years_to_expiration: p.years_to_expiration ?? null,
    ra_units: p.ra_units || 0,
    hud_units: p.hud_units || 0,
    rental_designation: p.rental_designation || null,
    compliance_status: null, project_type: null, type_of_credits: null,
    region: null, urban_rural: 'Rural',
    senior_units: 0, family_units: 0, homeless_units: 0,
    veteran_units: 0, supportive_units: 0
  };
}

/**
 * Normalize a locally-administered PBV property from a curated local-PHA
 * roster file. These records cover the Silt-style gaps where a PHA runs
 * its own PBV contract that doesn't appear in any federal feed (no LIHTC,
 * no HUD PBRA contract, no USDA RD financing).
 *
 * Source files live in data/affordable-housing/local-pha-roster/ and
 * follow the schema documented in that directory's README.md.
 */
function normalizeLocalPbv(p, phaMeta, idx, fileBaseName) {
  return {
    property_id: 'local-pbv:' + fileBaseName + ':' + idx,
    program_type: ['preservation-candidate', 'pbv-local'],
    property_name: p.property_name || null,
    address: p.address || null,
    city: p.city || null,
    county_fips: p.county_fips || null,
    state: p.state || 'CO',
    zip: p.zip || null,
    total_units: p.total_units || null,
    assisted_units: p.assisted_units || p.total_units || null,
    latest_year: null,
    lat: Number.isFinite(p.lat) ? p.lat : null,
    lng: Number.isFinite(p.lng) ? p.lng : null,
    source: 'Local PHA roster (curated)',
    source_id: p.property_name || null,
    subsidy_type: p.subsidy_type || 'pbv-local',
    years_to_expiration: null,
    pha_administered_by: p.pha_administered_by || (phaMeta && phaMeta.pha_name) || null,
    pbv_contract_sunset: p.pbv_contract_sunset || null,
    notes: p.notes || null,
    compliance_status: null, project_type: null, type_of_credits: null,
    region: null, urban_rural: null,
    senior_units:    p.population_target === 'senior'    ? (p.assisted_units || 0) : 0,
    family_units:    p.population_target === 'family'    ? (p.assisted_units || 0) : 0,
    homeless_units:  p.population_target === 'homeless'  ? (p.assisted_units || 0) : 0,
    veteran_units:   p.population_target === 'veteran'   ? (p.assisted_units || 0) : 0,
    supportive_units: p.population_target === 'supportive' ? (p.assisted_units || 0) : 0
  };
}

/**
 * Read every roster file in data/affordable-housing/local-pha-roster/
 * (skipping README + non-JSON). Each file is expected to follow the
 * schema in that directory's README.md.
 *
 * Returns a flat array of normalized records, ready to combine with the
 * other sources.
 */
function loadLocalPhaRoster() {
  if (!fs.existsSync(LOCAL_PHA_DIR)) return [];
  const out = [];
  const files = fs.readdirSync(LOCAL_PHA_DIR).filter(f => f.endsWith('.json'));
  files.forEach(f => {
    const fullPath = path.join(LOCAL_PHA_DIR, f);
    const doc = readJson(fullPath);
    if (!doc || !Array.isArray(doc.properties)) return;
    const baseName = f.replace(/\.json$/, '');
    doc.properties.forEach((p, i) => {
      out.push(normalizeLocalPbv(p, doc.metadata, i, baseName));
    });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Cross-source deduplication
// ─────────────────────────────────────────────────────────────────────
// The same physical property frequently lands in multiple feeds (a
// Section-8 LIHTC senior building shows up in CHFA LIHTC + CHFA
// Preservation + HUD MF). Keeping all of them produces 3-4 markers on
// the map and a triple-counted unit total in opportunity-finder market
// scans. Merge them.
//
// Strategy:
//   1. Build a stable key per record: (norm_name, norm_city). The name
//      is the only field present in EVERY source — addresses are
//      sometimes blank, lat/lng can drift by ~150m between sources, and
//      county_fips is null on some preservation records. Name+city is
//      the only thing that matches every overlap we've seen.
//   2. Group records by key. For each group:
//      - Pick the canonical record by source priority (LIHTC > HUD MF >
//        USDA RD > CHFA Preservation > Local PHA). LIHTC records have
//        the richest metadata (award_year, type_of_credits,
//        compliance_status), so they're the best base.
//      - Union the program_type[] across all members.
//      - Backfill nulls on the canonical record from non-canonical
//        members (e.g. canonical LIHTC record gets subsidy_type from
//        the HUD MF duplicate; PBV-local sunset bleeds onto the LIHTC
//        record if the same property exists in both).
//      - Track every contributing source in merged_from[] for
//        downstream transparency.
const SOURCE_PRIORITY = [
  // most-metadata-rich first
  /CHFA HousingTaxCreditProperties|CHFA LIHTC/i, // LIHTC
  /HUD MULTIFAMILY|HUD MF/i,                     // HUD MF
  /USDA/i,                                       // USDA RD
  /CHFA Preservation/i,                          // CHFA Preservation
  /Local PHA roster/i,                           // PBV-local curated
];
function _sourceRank(src) {
  const s = String(src || '');
  for (let i = 0; i < SOURCE_PRIORITY.length; i++) {
    if (SOURCE_PRIORITY[i].test(s)) return i;
  }
  return SOURCE_PRIORITY.length;
}

// Normalize a property name for dedupe: lowercase, collapse whitespace,
// strip trailing punctuation. Conservative — won't try to equate
// "Phase II" with "Phase 2" or "Building A" with "A Building".
function _normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,’']/g, '')  // strip dots/commas/apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}
function _normCity(s) {
  return String(s || '').toLowerCase().trim();
}

function dedupeProperties(records) {
  const groups = new Map();
  let nullKeyCount = 0;
  records.forEach(rec => {
    const nm = _normName(rec.property_name);
    const ct = _normCity(rec.city);
    if (!nm || !ct) {
      // Can't safely dedupe without a name+city. Keep with a unique key.
      groups.set('__nokey__' + (++nullKeyCount), [rec]);
      return;
    }
    const key = nm + '|' + ct;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });

  const merged = [];
  let mergedCount = 0;
  groups.forEach(group => {
    if (group.length === 1) { merged.push(group[0]); return; }

    // Sort by source rank — canonical (best metadata) first.
    group.sort((a, b) => _sourceRank(a.source) - _sourceRank(b.source));
    const canonical = JSON.parse(JSON.stringify(group[0]));  // clone

    // Union program_type across all members.
    const allPrograms = new Set();
    group.forEach(r => (r.program_type || []).forEach(t => allPrograms.add(t)));
    canonical.program_type = Array.from(allPrograms);

    // Track every contributing source for downstream transparency.
    canonical.merged_from = group.map(r => r.source).filter(Boolean);
    canonical.source = canonical.merged_from.join(' + ');

    // Backfill nulls on the canonical record from non-canonical members.
    // The list of fields covers the union of all per-source schemas.
    const FILLABLE = [
      'address', 'city', 'county_fips', 'state', 'zip',
      'total_units', 'assisted_units', 'latest_year',
      'lat', 'lng',
      'subsidy_type', 'years_to_expiration', 'restrictive_expiration',
      'ra_units', 'hud_units', 'rental_designation',
      'property_category', 'has_use_restriction', 'is_troubled',
      'pha_administered_by', 'pbv_contract_sunset',
      'compliance_status', 'project_type', 'type_of_credits',
      'region', 'urban_rural',
      'award_year', 'award_date', 'reservation_year', 'year_placed_in_service',
      'notes'
    ];
    for (let i = 1; i < group.length; i++) {
      const r = group[i];
      FILLABLE.forEach(field => {
        const cur = canonical[field];
        const next = r[field];
        const curEmpty = (cur == null || cur === '' || cur === 0 || cur === false);
        const nextHasValue = (next != null && next !== '' && next !== 0 && next !== false);
        // Only fill if canonical is empty AND incoming has a value
        if (curEmpty && nextHasValue) canonical[field] = next;
      });
      // Population-target units (max across members so a senior LIHTC
      // record stays "senior" even if a generic preservation copy is 0).
      ['senior_units','family_units','homeless_units','veteran_units','supportive_units']
        .forEach(f => {
          if ((r[f] || 0) > (canonical[f] || 0)) canonical[f] = r[f];
        });
    }
    merged.push(canonical);
    mergedCount += (group.length - 1);
  });

  console.log(`\n  Deduplication: ${records.length} raw → ${merged.length} unique (` +
              `${mergedCount} duplicates collapsed)`);
  return merged;
}

function main() {
  console.log('Build unified affordable-housing properties.json\n');

  const lihtc        = readJson(LIHTC_PATH);
  const preservation = readJson(PRESERVATION_PATH);
  const hudMf        = readJson(HUD_MF_PATH);
  const usdaRd       = readJson(USDA_RD_PATH);

  if (!lihtc || !lihtc.features)        throw new Error('Missing: ' + LIHTC_PATH);
  if (!preservation || !preservation.features) throw new Error('Missing: ' + PRESERVATION_PATH);
  // HUD MF + USDA RD are soft — site keeps working if either is missing
  const hudMfFeats  = (hudMf && hudMf.features)   || [];
  const usdaRdFeats = (usdaRd && usdaRd.features) || [];
  // Local-PHA roster — curated supplement for PBV-only properties that
  // aren't in any federal feed (e.g. Silt Senior Housing).
  const localPbvNorm = loadLocalPhaRoster();

  // F116 — Watchdog: emit a warning when the CHFA ArcGIS feed has caught
  // up to 2026 awards. The bridge file at data/affordable-housing/chfa-
  // awards/2026-round-one.json was added because the feed lagged the
  // 2026 R1 announcement by months. Once any AwardYear >= 2026 appears
  // in the live feed, the bridge is redundant and should be retired so
  // we don't double-count awards. Surfaced as an actionable warning
  // (not a hard fail) so the build keeps working — operators decide
  // when to drop the bridge.
  const liveMaxAwardYear = lihtc.features.reduce(function (max, f) {
    var y = parseInt((f.properties || {}).AwardYear, 10);
    return (Number.isFinite(y) && y > max) ? y : max;
  }, 0);
  if (liveMaxAwardYear >= 2026) {
    const BRIDGE_PATH = path.join(ROOT, 'data/affordable-housing/chfa-awards/2026-round-one.json');
    const bridgeExists = fs.existsSync(BRIDGE_PATH);
    console.log('');
    console.log('  ⚠ WARNING: CHFA ArcGIS feed has caught up to ' + liveMaxAwardYear + '.');
    console.log('    The 2026 R1 bridge file is now redundant — consider dropping it:');
    if (bridgeExists) {
      console.log('      git rm ' + path.relative(ROOT, BRIDGE_PATH));
      console.log('      then remove the soft-load + tagging blocks marked F116/F105 across:');
      console.log('        - js/lihtc-opportunity-finder.js');
      console.log('        - js/compare.js');
      console.log('        - indibuild-brief.html');
      console.log('        - chfa-portfolio.html');
    } else {
      console.log('      (bridge already removed — clean-up complete)');
    }
    console.log('');
  }

  const lihtcNorm   = lihtc.features.map((f, i) => normalizeLihtc(f, i));
  const presNorm    = preservation.features.map((f, i) => normalizePreservation(f, i));
  const hudMfNorm   = hudMfFeats.map((f, i) => normalizeHudMf(f, i));
  const usdaRdNorm  = usdaRdFeats.map((f, i) => normalizeUsdaRd(f, i));

  console.log(`  LIHTC properties:                ${lihtcNorm.length}`);
  console.log(`  CHFA preservation properties:    ${presNorm.length}`);
  console.log(`  HUD Multifamily assisted (CO):   ${hudMfNorm.length}`);
  console.log(`  USDA Rural Housing assets (CO):  ${usdaRdNorm.length}`);
  console.log(`  Local PHA roster (PBV-only):     ${localPbvNorm.length}`);

  // Combine all five sources, then collapse cross-source duplicates so
  // a property that lives in CHFA LIHTC + CHFA Preservation + HUD MF
  // appears as ONE map marker with the union of program types and the
  // richest available metadata, rather than 3 stacked markers + triple
  // unit count.
  const rawAll = [...lihtcNorm, ...presNorm, ...hudMfNorm, ...usdaRdNorm, ...localPbvNorm];
  const all = dedupeProperties(rawAll);

  // Program-type breakdown
  const programs = {};
  all.forEach(p => p.program_type.forEach(t => programs[t] = (programs[t] || 0) + 1));
  console.log('\n  Program-type breakdown:');
  Object.entries(programs).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`    ${t.padEnd(25)} ${n}`);
  });

  // Subsidy-type breakdown (preservation records carry subsidy_type detail)
  const subsidies = {};
  all.forEach(p => {
    if (p.subsidy_type) subsidies[p.subsidy_type] = (subsidies[p.subsidy_type] || 0) + 1;
  });
  if (Object.keys(subsidies).length) {
    console.log('\n  Subsidy-type breakdown:');
    Object.entries(subsidies).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
      console.log(`    ${t.padEnd(25)} ${n}`);
    });
  }

  // Urgency breakdown for USDA RD (years to expiration)
  const expBuckets = { '0-5y': 0, '5-10y': 0, '10-20y': 0, '20y+': 0 };
  all.forEach(p => {
    const y = p.years_to_expiration;
    if (y == null) return;
    if (y <= 5) expBuckets['0-5y']++;
    else if (y <= 10) expBuckets['5-10y']++;
    else if (y <= 20) expBuckets['10-20y']++;
    else expBuckets['20y+']++;
  });
  if (Object.values(expBuckets).some(n => n > 0)) {
    console.log('\n  Restrictive-clause expiration (USDA RD where known):');
    Object.entries(expBuckets).forEach(([k, n]) => console.log(`    ${k.padEnd(8)} ${n}`));
  }

  const output = {
    metadata: {
      generated: new Date().toISOString(),
      sources: {
        'CHFA LIHTC':           lihtcNorm.length,
        'CHFA Preservation':    presNorm.length,
        'HUD MF Assisted':      hudMfNorm.length,
        'USDA Rural Housing':   usdaRdNorm.length,
        'Local PHA roster':     localPbvNorm.length
      },
      total_records: all.length,
      program_type_counts: programs,
      subsidy_type_counts: subsidies,
      notes: [
        'BUILT from per-source files in data/affordable-housing/ — do not edit by hand.',
        'Regenerate via: node scripts/build-affordable-housing-properties.js',
        'A property may have multiple program_type values (e.g. ["lihtc-9pct","lihtc-state-paired"]).',
        'preservation-candidate records come from 4 sources: CHFA Preservation (1,688 — no subsidy_type detail), HUD MF Assisted (343 — has subsidy_type detail), USDA Rural Housing (116 — has years_to_expiration), Local PHA roster (curated PBV gap-fill — has pha_administered_by + pbv_contract_sunset).',
        'Many properties overlap across sources (e.g. a Section-8 LIHTC property in CHFA LIHTC + CHFA Preservation + HUD MF). Current build keeps all records; consumers can dedupe by address + city.',
        'pbv-local records (Silt Senior Housing, etc.) cover gaps where a PHA runs a Project-Based Voucher contract that does not appear in any federal feed — these properties are invisible to CHFA + HUD MF + USDA RD ingest. Curate new records in data/affordable-housing/local-pha-roster/ per the README schema.',
        'Pure Prop 123 awards without LIHTC are not yet ingested — DOLA award page is bot-blocked. P1 backlog.'
      ]
    },
    properties: all
  };

  const serialized = JSON.stringify(output);
  fs.writeFileSync(OUT_PATH, serialized);
  const size = fs.statSync(OUT_PATH).size;
  console.log(`\n  Wrote ${OUT_PATH} (${(size / 1024).toFixed(1)} KB)`);

  // ── Cache-bust manifest ──
  // properties.json is 2 MB and we want browsers to cache it long-term,
  // but ALSO pick up fresh data immediately after each build (the Silt
  // Senior Housing addition in F122 took multiple refreshes to land
  // because of stale browser cache). The fix: a tiny manifest file
  // fetched with no-store on every page load, which exposes a hash of
  // the current properties.json. The map layer appends that hash as
  // ?v=<hash> when fetching properties.json — different content →
  // different URL → fresh fetch, identical content → cache hit.
  const hash = crypto.createHash('sha1').update(serialized).digest('hex').slice(0, 12);
  const manifest = {
    v: hash,
    generated: output.metadata.generated,
    total_records: output.metadata.total_records,
    size_bytes: size
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`  Wrote ${MANIFEST_PATH} (v=${hash})`);
}

main();
