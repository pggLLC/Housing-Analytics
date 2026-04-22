# `js/projections/scenario-builder.js`

scenario-builder.js — COHO Analytics

Interactive UI controller for the projection scenario builder page.
Wires slider inputs → CohortComponentModel → Chart.js results chart.
Reads DOLA SYA data for the selected county/municipality as the base population.

Dependencies (must be loaded before this script):
  - js/projections/cohort-component-model.js
  - js/projections/scenario-storage.js
  - Chart.js (CDN)
  - js/fetch-helper.js

Exposes: window.ScenarioBuilder

_No documented symbols — module has a file-header comment only._
