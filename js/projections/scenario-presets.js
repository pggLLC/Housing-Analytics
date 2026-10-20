/**
 * scenario-presets.js — the Scenario Builder's preset scenarios.
 *
 * Each preset is a percentage of the State Demography Office's (SDO) own
 * forecast for the place loaded: births, deaths and net migration. 100 on all
 * three is SDO's forecast, the one the HNA page's 20-year figure uses. Because
 * the percentages apply to each place's own forecast, a preset means the same
 * thing in a small town as in Denver.
 *
 * The HNA page's low and high lines are not these presets: they scale the
 * projected growth by 15% either way (js/hna/hna-utils.js).
 *
 * Exposes: window.ScenarioPresets
 */
(function () {
  'use strict';

  const PRESETS = [
    {
      key: 'baseline',
      label: 'SDO forecast',
      short: 'All at 100%',
      description: 'The State Demography Office’s forecast for this place, with births, deaths and migration as SDO projects them. It gives the HNA page’s 20-year figure.',
      color: '#4a90d9',
      params: { births_pct: 100, deaths_pct: 100, migration_pct: 100 },
    },
    {
      key: 'low_growth',
      label: 'Half the migration',
      short: 'Moving in at 50%',
      description: 'SDO’s forecast with half as many net arrivals each year. Births and deaths follow SDO’s forecast.',
      color: '#e07b39',
      params: { births_pct: 100, deaths_pct: 100, migration_pct: 50 },
    },
    {
      key: 'high_growth',
      label: '1.5× the migration',
      short: 'Moving in at 150%',
      description: 'SDO’s forecast with one and a half times its net arrivals each year. Births and deaths follow SDO’s forecast.',
      color: '#4caf50',
      params: { births_pct: 100, deaths_pct: 100, migration_pct: 150 },
    },
  ];

  function cloneParams(params) {
    return {
      births_pct: params.births_pct,
      deaths_pct: params.deaths_pct,
      migration_pct: params.migration_pct,
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
