# `js/components/pipeline-add-button.js`

js/components/pipeline-add-button.js — F161
===============================================================
"Add to IndiBuild Pipeline" button + inline form. Mounts on
jurisdiction-context pages inside the IndiBuild gate (briefs,
where-should-I-build) so a single click adds the active
jurisdiction to a local-storage pipeline draft.

Usage:
  PipelineAddButton.attach(container, {
    jurisdiction: 'New Castle',
    geoid:        '0853395',
    defaults: {
      stage:          'Signal',     // optional pre-fill
      ioi_score:      71,
      confidence:     'medium',
      classification: 'C',
      product_type:   '9% LIHTC',
      next_action:    '...',
      next_action_due:'2026-07-15',
      notes:          '...'
    }
  });

Re-attaching with the same options replaces the existing
button (idempotent). The form is rendered inline beneath the
button — no global modal — so it never conflicts with leaflet
or chart event listeners.

_No documented symbols — module has a file-header comment only._
