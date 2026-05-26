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
const OUT_PATH           = path.join(ROOT, 'data/affordable-housing/properties.json');

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
    latest_year: p.YR_PIS || null,             // AwardYear (mapped to YR_PIS)
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
    county_fips: null,                        // not in preservation source — would need a city→county join
    state: p.PROJ_ST || 'CO',
    zip: p.Zip || null,
    total_units: p.N_UNITS || null,
    assisted_units: p.N_UNITS || null,        // assume all units assisted (these ARE preservation-tracked)
    latest_year: null,                         // preservation source lacks date — would need NHPD join
    lat: Number.isFinite(coords[1]) ? coords[1] : null,
    lng: Number.isFinite(coords[0]) ? coords[0] : null,
    source: p._source || 'CHFA Preservation',
    source_id: p.UniqueProjID || null,
    // Preservation source doesn't have these — explicit nulls for shape consistency
    compliance_status: null,
    project_type: null,
    type_of_credits: null,
    region: null,
    urban_rural: null,
    senior_units: 0,
    family_units: 0,
    homeless_units: 0,
    veteran_units: 0,
    supportive_units: 0
  };
}

function main() {
  console.log('Build unified affordable-housing properties.json\n');

  const lihtc = readJson(LIHTC_PATH);
  const preservation = readJson(PRESERVATION_PATH);

  if (!lihtc || !lihtc.features) {
    throw new Error('Missing or malformed: ' + LIHTC_PATH);
  }
  if (!preservation || !preservation.features) {
    throw new Error('Missing or malformed: ' + PRESERVATION_PATH);
  }

  const lihtcNorm = lihtc.features.map((f, i) => normalizeLihtc(f, i));
  const presNorm  = preservation.features.map((f, i) => normalizePreservation(f, i));

  console.log(`  LIHTC properties:        ${lihtcNorm.length}`);
  console.log(`  Preservation properties: ${presNorm.length}`);

  // Combine + dedupe (some LIHTC properties also appear in preservation;
  // for now we keep both — they have different program_type values).
  // Future: detect LIHTC properties also in preservation and union their
  // program_type arrays into a single record.
  const all = [...lihtcNorm, ...presNorm];

  // Program-type breakdown
  const programs = {};
  all.forEach(p => p.program_type.forEach(t => programs[t] = (programs[t] || 0) + 1));
  console.log('\n  Program-type breakdown:');
  Object.entries(programs).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`    ${t.padEnd(25)} ${n}`);
  });

  const output = {
    metadata: {
      generated: new Date().toISOString(),
      sources: {
        'CHFA LIHTC': lihtcNorm.length,
        'CHFA Preservation': presNorm.length
      },
      total_records: all.length,
      program_type_counts: programs,
      notes: [
        'This file is BUILT from per-source files in data/affordable-housing/ — do not edit by hand.',
        'Regenerate via: node scripts/build-affordable-housing-properties.js',
        'A property may have multiple program_type values (e.g. ["lihtc-9pct","lihtc-state-paired"]).',
        'preservation-candidate records are CHFA-tracked rental properties at risk of subsidy loss; specific subsidy (Section 8 / HUD MF / RD / HOME / LIHTC Y15) is not in the source layer.',
        'Pure Prop 123 awards without LIHTC are not yet ingested — DOLA award page is bot-blocked. P1 backlog.'
      ]
    },
    properties: all
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output));
  const size = fs.statSync(OUT_PATH).size;
  console.log(`\n  Wrote ${OUT_PATH} (${(size / 1024).toFixed(1)} KB)`);
}

main();
