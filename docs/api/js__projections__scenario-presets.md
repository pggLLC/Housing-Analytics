# `js/projections/scenario-presets.js`

scenario-presets.js — the Scenario Builder's preset scenarios.

Each preset is a percentage of the State Demography Office's (SDO) own
forecast for the place loaded: births, deaths and net migration. 100 on all
three is SDO's forecast, the one the HNA page's 20-year figure uses. Because
the percentages apply to each place's own forecast, a preset means the same
thing in a small town as in Denver.

The HNA page's low and high lines are not these presets: they scale the
projected growth by 15% either way (js/hna/hna-utils.js).

Exposes: window.ScenarioPresets

_No documented symbols — module has a file-header comment only._
