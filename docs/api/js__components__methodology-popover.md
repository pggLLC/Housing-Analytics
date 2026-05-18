# `js/components/methodology-popover.js`

methodology-popover.js

Per-chart / per-stat plain-language methodology disclosure. Drops
an ℹ summary next to a heading; when the user opens it, surfaces
five structured fields: what, source, method, drift, caveats.

Why
---
The page-level PageContext panel covers "what's this page for"; this
component fills the same need at the metric level so a user can
ask "what's actually behind this number" without leaving the page.

Public API
----------
  window.MethodologyPopover.attach(targetEl, {
    what:        'Share of renter HH by gross rent as % of income',
    source:      'ACS DP04 GRAPI bins (2024)',
    method:      'Counts of households in each bin / total rented HH',
    drift:       'ACS 2023 bins changed — DP04_0143-46PE no longer exist',
    caveats:     '≥30%=cost-burdened; ≥50%=severely burdened. Self-reported.'
  });

  window.MethodologyPopover.attachAll([
    { selector: '#rentBurdenHeading', meta: { ... } },
    ...
  ]);

Idempotent — attaching twice replaces the existing popover.

_No documented symbols — module has a file-header comment only._
