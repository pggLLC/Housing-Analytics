# `js/methodology-explainer.js`

methodology-explainer.js

Drop-in component that adds a hoverable "ℹ How is this computed?"
icon next to chart titles, with plain-language explanations of the
methodology behind each chart/score.

Adapted from striblab's editorial pattern (comparison-review C3):
make methodology auditable and visible at the point of consumption,
not buried in a docs page.

Usage
-----
Auto-attaches to any element with [data-methodology-key="<key>"]
on page load. Looks up the key in METHODOLOGY_REGISTRY and renders
a `<details>` summary/body next to the title.

Example HTML:
  <h2>Renter cost burden by AMI <span data-methodology-key="chas-cb"></span></h2>

Renders to:
  <h2>Renter cost burden by AMI
    <span class="me-icon" tabindex="0" title="How is this computed?">ℹ</span>
    <div class="me-pop" hidden>...</div>
  </h2>

_No documented symbols — module has a file-header comment only._
