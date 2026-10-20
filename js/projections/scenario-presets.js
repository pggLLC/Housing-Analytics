/**
 * scenario-presets.js — canonical projection scenario preset definitions.
 *
 * Exposes: window.ScenarioPresets
 */
(function () {
  'use strict';

  const PRESETS = [
    {
      key: 'baseline',
      label: 'Baseline (illustrative)',
      // D10 — These presets are one fixed set of inputs for every place, not
      // a forecast fitted to the selected place. The text says so.
      description: 'Illustrative assumption, the same for every place: fertility and mortality hold at current rates and 500 more people move in than move out each year. It is not fitted to this place; for a small town 500 people a year is far above its recent migration, so compare it with the DOLA forecast.',
      color: '#4a90d9',
      params: {
        fertility_multiplier: 1.0,
        mortality_multiplier: 1.0,
        net_migration_annual: 500,
      },
    },
    {
      key: 'low_growth',
      label: 'Low growth (illustrative)',
      description: 'Illustrative assumption, the same for every place: 250 more people move in than move out each year, fertility 10% below current rates and mortality 2% above. It is not fitted to this place.',
      color: '#e07b39',
      params: {
        fertility_multiplier: 0.90,
        mortality_multiplier: 1.02,
        net_migration_annual: 250,
      },
    },
    {
      key: 'high_growth',
      label: 'High growth (illustrative)',
      description: 'Illustrative assumption, the same for every place: 1,000 more people move in than move out each year, fertility 5% above current rates and mortality 2% below. It is not fitted to this place.',
      color: '#4caf50',
      params: {
        fertility_multiplier: 1.05,
        mortality_multiplier: 0.98,
        net_migration_annual: 1000,
      },
    },
  ];

  function cloneParams(params) {
    return {
      fertility_multiplier: params.fertility_multiplier,
      mortality_multiplier: params.mortality_multiplier,
      net_migration_annual: params.net_migration_annual,
    };
  }

  const byKey = {};
  PRESETS.forEach(function (preset) {
    byKey[preset.key] = preset;
  });

  window.ScenarioPresets = {
    list: PRESETS,
    byKey: byKey,
    keys: PRESETS.map(function (preset) { return preset.key; }),
    paramsFor: function (key) {
      return byKey[key] ? cloneParams(byKey[key].params) : null;
    },
  };
})();
