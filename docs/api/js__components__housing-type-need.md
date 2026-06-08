# `js/components/housing-type-need.js`

js/components/housing-type-need.js
Responsibility: data-driven 6-category ranking of which housing types the
  public data most supports for a given jurisdiction. Read-only pure
  compute over data the HNA already loads — no new fetches, no new deps.

Exposes: window.HousingTypeNeed.compute({
           acsProfile, chasRows, hudIncomeLimits, lihtcInventory,
           jurisdictionName
         })
         -> Array<{
              type, label, score, level, signals, confidence,
              confidenceReason, lihtcRelevance, plainEnglish,
              methodology
            }>

The 6 categories (each a distinct quadrant of tenure × size × AMI × form):
  1. deeplyAffordableRental  — rent · mixed size · ≤30% AMI · apartment
  2. workforceRental         — rent · mixed size · 60–80% AMI · apt/townhome
  3. familyRental            — rent · 2–3BR · mixed AMI · MF/townhome
  4. seniorRental            — rent · 1–2BR · mixed AMI · apt/cottage
  5. missingMiddleOwnership  — own · small · 80–120% AMI · townhome/duplex/4plex
  6. detachedSfOwnership     — own · 3BR+ · 100%+ AMI · SF

Scoring: each category has 4–5 weighted indicators normalised to 0–100.
  score = Σ (indicator_0to100 × weight). Weights inside a category sum to 1.0.
  Level: Low <30 · Moderate 30–49 · High 50–69 · VeryHigh ≥70.

Confidence: count of indicators that produced a non-null value.
  ≥4 → high · 2–3 → med · ≤1 → low.
  Adds a small-sample caveat when population < 5000 OR DP04 bedroom mix is missing.

_No documented symbols — module has a file-header comment only._
