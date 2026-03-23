/**
 * scenario-storage.js — COHO Analytics
 *
 * localStorage-backed persistence for user-defined projection scenarios.
 * Scenarios are stored as JSON under a namespaced key.
 *
 * Exposes: window.ScenarioStorage
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'coho_hna_scenarios';
  const MAX_SCENARIOS = 20;

  /**
   * @typedef {Object} Scenario
   * @property {string} id             - Unique identifier (auto-generated)
   * @property {string} name           - User-visible name
   * @property {number} year           - Year the scenario was created
   * @property {Object} assumptions    - Human-readable descriptions
   * @property {Object} parameters     - Numeric parameters for the model
   * @property {string} createdAt      - ISO-8601 timestamp
   * @property {string} baselineSource - Which built-in scenario this builds on
   */

  const ScenarioStorage = {
    /** Return all saved scenarios, newest first. */
    list() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (_) {
        return [];
      }
    },

    /** Return a single scenario by ID, or null. */
    get(id) {
      return this.list().find(s => s.id === id) || null;
    },

    /**
     * Save a scenario. If a scenario with the same ID exists it will be replaced.
     * @param {Object} opts
     * @param {string} opts.name
     * @param {Object} opts.parameters - {fertility_multiplier, mortality_multiplier, net_migration_annual}
     * @param {string} [opts.id]       - Omit to generate a new ID
     * @param {string} [opts.baselineSource]
     * @returns {Scenario} The saved scenario
     */
    save(opts) {
      if (!opts.name || !opts.parameters) throw new Error('ScenarioStorage.save: name and parameters are required');

      const id = opts.id || _generateId(opts.name);
      const now = new Date().toISOString();

      /** @type {Scenario} */
      const scenario = {
        id,
        name:            opts.name,
        year:            new Date().getFullYear(),
        assumptions:     opts.assumptions || {},
        parameters: {
          fertility_multiplier:  opts.parameters.fertility_multiplier  ?? 1.0,
          mortality_multiplier:  opts.parameters.mortality_multiplier  ?? 1.0,
          net_migration_annual:  opts.parameters.net_migration_annual  ?? 500,
        },
        createdAt:       opts.createdAt || now,
        baselineSource:  opts.baselineSource || 'DOLA 2024',
      };

      const scenarios = this.list().filter(s => s.id !== id);
      scenarios.unshift(scenario); // newest first

      // Trim to max
      if (scenarios.length > MAX_SCENARIOS) scenarios.splice(MAX_SCENARIOS);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
      } catch (err) {
        console.error('ScenarioStorage: could not persist scenarios:', err);
      }
      return scenario;
    },

    /** Delete a scenario by ID. Returns true if found and removed. */
    delete(id) {
      const scenarios = this.list().filter(s => s.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
        return true;
      } catch (_) {
        return false;
      }
    },

    /** Remove all saved scenarios. */
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) { /* ignore */ }
    },

    /** Export all scenarios as a JSON Blob for download. */
    exportAll() {
      const data = JSON.stringify({ exportedAt: new Date().toISOString(), scenarios: this.list() }, null, 2);
      return new Blob([data], { type: 'application/json' });
    },

    /**
     * Import scenarios from a JSON object (as produced by exportAll).
     * @param {Object} obj - Parsed JSON with { scenarios: Scenario[] }
     * @returns {number} Number of scenarios imported
     */
    importAll(obj) {
      if (!obj || !Array.isArray(obj.scenarios)) return 0;
      let count = 0;
      obj.scenarios.forEach(s => {
        try {
          this.save(s);
          count++;
        } catch (_) { /* skip invalid */ }
      });
      return count;
    },
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function _generateId(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const ts   = Date.now().toString(36);
    return `custom-${slug}-${ts}`;
  }

  window.ScenarioStorage = ScenarioStorage;
})();
