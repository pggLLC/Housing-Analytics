# `scripts/fix-advocacy-mismatches.js`

fix-advocacy-mismatches.js — F129
==================================
Surgical fix for two classes of bug in data/hna/local-resources.json:

  1. Lake/La Plata FIPS swap. The entire contents of county:08065 (Lake)
     and county:08067 (La Plata) were authored against the wrong FIPS —
     08065 holds La Plata housing authority + Durango advocates, 08067
     holds Lake County HA + advocates plus stray La Plata plans. This
     script untangles them.

  2. Catholic Charities of Southern Colorado misassigned to El Paso
     (08041, Colorado Springs Diocese) and Teller (08119, also CO
     Springs Diocese). CCSC serves the Diocese of Pueblo, NOT the
     Diocese of Colorado Springs. The correct local org is Catholic
     Charities of Central Colorado.

Run:  node scripts/fix-advocacy-mismatches.js

_No documented symbols — module has a file-header comment only._
