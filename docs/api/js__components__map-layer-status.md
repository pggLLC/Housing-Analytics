# `js/components/map-layer-status.js`

js/components/map-layer-status.js
Shows the integration depth of each data layer on the PMA page.

Each data connector on the market-analysis page can participate at
up to three levels:
  1. Map — visible as a toggleable map layer
  2. Report — data appears in a report section
  3. Scoring — data feeds into the site-selection score

This component renders a compact legend showing which level each
source reaches, so users understand what's informing the analysis
vs. what's display-only vs. what's unavailable.

Usage:
  MapLayerStatus.render('mapLayerStatusPanel', [
    { name: 'LIHTC Projects', map: true, report: true, scoring: true },
    { name: 'NHPD Properties', map: false, report: false, scoring: false },
  ]);

Exposes window.MapLayerStatus.

## Symbols

### `buildPMALayers()`

Build the PMA layer status from the current connector state.
Reads window globals to determine what's actually loaded.
