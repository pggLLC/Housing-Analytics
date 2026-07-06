# `js/components/mhi-ami-clarifier.js`

js/components/mhi-ami-clarifier.js — F159
===============================================================
Surfaces both *Median Household Income* (ACS, place-level) and
*HUD Area Median Income* (county-level program limit) side-by-side
so they're not conflated. The conceptual confusion that produced
COHO's New Castle bug report — chat answer said "~\$95K AMI" while
the HNA showed \$80K MHI — is the most common housing-data error.

Usage:
  MhiAmiClarifier.attach(container, {
    placeGeoid: '0853395',           // optional
    placeName:  'New Castle',
    countyFips: '08045',
    countyName: 'Garfield County',
    placeMhi:   80084                 // optional: pass-through to avoid re-fetch
  });

Returns silently with an explainer if no data available. Always
labels the source + the program it's used for.

_No documented symbols — module has a file-header comment only._
