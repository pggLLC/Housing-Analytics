'use strict';
// Codex site audit F7 (2026-10-31): ACS B25003_001E is the tenure universe
// (occupied units = owners + renters), not all housing units. The field must
// say so, and must not be confused with the year-built universe (B25034_001E).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/census-acs-state.json'), 'utf8'));
assert.equal(d.meta.variables.B25003_001E, 'occupied_housing_units', 'B25003_001E is named occupied_housing_units');
for (const r of d.data) {
  assert.ok(!('housing_units_total' in r), `${r.state_name}: no misleading housing_units_total field`);
  if (r.occupied_housing_units != null && r.owner_occupied != null && r.renter_occupied != null) {
    assert.equal(r.occupied_housing_units, r.owner_occupied + r.renter_occupied,
      `${r.state_name}: occupied units equal owners + renters`);
  }
}
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/fetch-census-acs.yml'), 'utf8');
assert.ok(!/"housing_units_total"/.test(wf), 'fetch workflow no longer writes housing_units_total');
console.log('census-acs-state-tenure-field: all checks passed');
