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
      label: 'Baseline',
      description: 'Moderate growth following recent historical trends. Fertility holds steady; migration reflects the 2018–2023 average.',
      color: '#4a90d9',
      params: {
        fertility_multiplier: 1.0,
        mortality_multiplier: 1.0,
        net_migration_annual: 500,
      },
    },
    {
      key: 'low_growth',
      label: 'Low growth',
      description: 'Slowing in-migration, modest fertility decline, slightly elevated mortality. Reflects affordability-driven headwinds.',
      color: '#e07b39',
      params: {
        fertility_multiplier: 0.90,
        mortality_multiplier: 1.02,
        net_migration_annual: 250,
      },
    },
    {
      key: 'high_growth',
      label: 'High growth',
      description: 'Accelerated in-migration driven by economic expansion, slightly above-trend fertility, continued mortality improvement.',
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
