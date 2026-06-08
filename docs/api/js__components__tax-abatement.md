# `js/components/tax-abatement.js`

js/components/tax-abatement.js — F141
======================================
Renders the curated tax-abatement / PILOT / fee-waiver / linkage
inventory for a jurisdiction. Pulls from data/tax-abatement-inventory.json.

Two-layer lookup:
  1. If the jurisdiction (by GEOID) has its own entry, render it.
  2. Otherwise render the statewide statutory baseline (C.R.S.
     §39-3-112.5 nonprofit exemption) so the developer always
     sees something defensible.

Usage:
  TaxAbatement.attach(container, {
    geoKey:    'place:0830780',   // place or county geoKey
    jurisName: 'Glenwood Springs'
  });

_No documented symbols — module has a file-header comment only._
