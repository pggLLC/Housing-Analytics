# `js/hna/hna-narratives.js`

hna-narratives.js
Responsibility: Narrative text builders and copy generation.
Dependencies: window.HNAUtils, window.HNAState, window.PlaceChas (optional)
Exposes: window.HNANarratives

F215 — Executive-summary narrative. Replaces the single placeholder
paragraph at the top of the HNA with a 4-paragraph data-derived
narrative built from values already in the loaded profile, CHAS,
and ranking-index. Mirrors the structure professional HNAs
(Points Consulting, Root Policy Research) use to lead each
jurisdiction-level report:
  1. Where this jurisdiction sits + headline cost-burden framing
  2. Deep-need concentration vs broad distribution
  3. Income / rent / home-value math at the 30%-rule line
  4. 20-year projection + supply implications

Template-driven, not free-form. Variables flow from data; the
phrasing is a small library of pre-written sentence pieces so
every jurisdiction reads consistently and stays data-correct on
the next CHAS/ACS refresh.

_No documented symbols — module has a file-header comment only._
