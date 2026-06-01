# `scripts/build-affordable-housing-properties.js`

## Symbols

### `derivePrograms(typeOfCredits)`

build-affordable-housing-properties.js

Combines the source-specific affordable-housing datasets into a single
unified `data/affordable-housing/properties.json` with a `program_type`
discriminator that lets downstream consumers (Opportunity Finder,
Colorado Deep Dive, etc.) filter by program without needing to know
which file each property came from.

Sources combined (and how each becomes a program_type):

  data/affordable-housing/lihtc/chfa-properties.json
    - 'lihtc-9pct'           — TypeOfCredits contains '9%'
    - 'lihtc-4pct'           — TypeOfCredits contains '4%' (not 9%)
    - 'lihtc-mihtc'          — TypeOfCredits contains 'MIHTC' (state-only)
    - 'lihtc-state-paired'   — TypeOfCredits contains 'State' (Prop 123 paired)
    - 'lihtc-toc-paired'     — TypeOfCredits contains 'TOC' (Transit-Oriented)
    (program_type is multi-valued — a "9% and State and TOC" project
     gets ['lihtc-9pct', 'lihtc-state-paired', 'lihtc-toc-paired'])

  data/affordable-housing/preservation/chfa-preservation.json
    - 'preservation-candidate'

  (Future) data/affordable-housing/locally-funded/prop123-awards.json
    - 'prop123-only'         — pure Prop 123 deals without LIHTC
      (Currently absent; would need DOLA's award announcements page
       which is bot-blocked. Tracked as audit P1 backlog.)

Output schema (per property):
  {
    property_id: 'lihtc:925' | 'preservation:1' | ...,
    program_type: ['lihtc-9pct', 'lihtc-state-paired'],
    property_name: '...',
    address: '...',
    city: '...',
    county_fips: '...',
    state: 'CO',
    zip: '...',
    total_units: 60,
    assisted_units: 60,        // LIHTC: LowIncomeUnits; preservation: same as total
    latest_year: 2025,         // YR_PIS or AwardYear; null if unknown
    lat: 39.x,
    lng: -104.x,
    source: 'CHFA HousingTaxCreditProperties_view',
    source_id: 'unique-record-id-in-source'
  }

Run:  node scripts/build-affordable-housing-properties.js
/

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIHTC_PATH         = path.join(ROOT, 'data/affordable-housing/lihtc/chfa-properties.json');
const PRESERVATION_PATH  = path.join(ROOT, 'data/affordable-housing/preservation/chfa-preservation.json');
const HUD_MF_PATH        = path.join(ROOT, 'data/affordable-housing/preservation/hud-multifamily-assisted.json');
const USDA_RD_PATH       = path.join(ROOT, 'data/affordable-housing/preservation/usda-rural-housing.json');
const OUT_PATH           = path.join(ROOT, 'data/affordable-housing/properties.json');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/**
Derive program_type array from a CHFA LIHTC project's TypeOfCredits string.
Returns an array — a single project may belong to multiple program types
(e.g., "9% and State and TOC" → 9%, state-paired, TOC).

### `normalizeHudMf(feature, idx)`

Normalize a HUD Multifamily Assisted property. Adds subsidy_type detail
(Section 8 PBRA, HUD 202/811, FHA-insured, etc.) that CHFA preservation
source lacks.

### `normalizeUsdaRd(feature, idx)`

Normalize a USDA Rural Housing property. Adds restrictive-clause-expiration
date — the single most-actionable preservation signal (a property
expiring 0-5y is much hotter than one expiring 20y+).
