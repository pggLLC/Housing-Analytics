# `js/projections/scenario-storage.js`

scenario-storage.js — COHO Analytics

localStorage-backed persistence for user-defined projection scenarios.
Scenarios are stored as JSON under a namespaced key.

Exposes: window.ScenarioStorage

## Symbols

### `ScenarioStorage`

@typedef {Object} Scenario
@property {string} id             - Unique identifier (auto-generated)
@property {string} name           - User-visible name
@property {number} year           - Year the scenario was created
@property {Object} assumptions    - Human-readable descriptions
@property {Object} parameters     - Numeric parameters for the model
@property {string} createdAt      - ISO-8601 timestamp
@property {string} baselineSource - Which built-in scenario this builds on
