# `js/hna/hna-section-takeaways.js`

hna-section-takeaways.js

F216 — Layer 2 of the data-derived narrative work. Each section on
the HNA opens with a 1–2 sentence takeaway that surfaces what THIS
jurisdiction's data actually shows — not a generic chart caption.

Mirrors the F211 hna-dev-context module: matches h2 nodes by text or
id, looks up a builder, builds a sentence from the loaded profile +
CHAS + ranking-index, and injects an aside under the existing intro
<p>. Idempotent — re-running the inject pass doesn't duplicate the
takeaways.

Dependencies: window.HNAState, window.PlaceChas (optional),
window.HNANarratives (for the shared ranking-index cache).
Exposes: window.HnaSectionTakeaways

Style: takeaways are short, declarative, data-bound, and never
lead with the comparator (same rule as F215b — surface the acute
finding for THIS jurisdiction, don't bury it).

_No documented symbols — module has a file-header comment only._
