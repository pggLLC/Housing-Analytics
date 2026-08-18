# Claude Handoff: Ownership Workflow Track Integration

**Purpose:** Design brief and implementation script for Claude to review, then hand to
Codex for implementation.  
**Companion issue:** `docs/issues/ownership-workflow-gap.md`  
**Auth:** Owner sign-off required before Codex begins (per AGENTS.md).

---

## Repo Context (read before starting)

- **Repo:** `pggLLC/Housing-Analytics` — static site, GitHub Pages, no bundler
- **JS pattern:** plain IIFE modules; all globals attached to `window.*`; loaded via
  hand-ordered `<script>` tags in each HTML file
- **State persistence:** `js/workflow-state-core.js` stores workflow state in localStorage
  under keys prefixed `coho_wf_`. `_wfSet(key, value)` / `_wfGet(key)` are the
  internal helpers. Public API is in `js/workflow-state-api.js` as `window.WorkflowState`.
- **Workflow progress bar:** Each HTML page renders its own `wf-progress-steps` div;
  there is no shared component — each page hard-codes its step labels.
- **Deal mode toggle:** `js/deal-calculator.js` reads `input[name="dc-deal-mode"]:checked`
  to determine rental vs. ownership mode (function `currentDealMode()`). The
  `updateDealModeUi()` function shows/hides elements with `data-dc-mode="rental"` and
  `data-dc-mode="ownership"` attributes.
- **Ownership modules already loaded** in `housing-needs-assessment.html` (lines 203–207)
  and `deal-calculator.html` (lines 77–80) — no new script tags needed there.

---

## The Gap

The 6-step LIHTC workflow (`lihtc-opportunity-finder.html` → `select-jurisdiction.html`
→ `housing-needs-assessment.html` → `market-analysis.html` → `hna-scenario-builder.html`
→ `deal-calculator.html`) is implicitly rental-first. A developer pursuing affordable
for-sale product has no guided path. All the underlying ownership logic exists; it just
isn't connected.

---

## Design: Fork After Step 2

```
Step 1: Opportunity Finder        (lihtc-opportunity-finder.html)   — unchanged
Step 2: Select Jurisdiction       (select-jurisdiction.html)        — ADD product-type fork here
        ↓ Rental track                                               ↓ Ownership track
Step 3: HNA (rental sections)     (housing-needs-assessment.html)   HNA (ownership sections)
Step 4: Market Analysis           (market-analysis.html)            For-Sale Market Study (for-sale-market-study.html)
Step 5: Scenario Builder          (hna-scenario-builder.html)       Ownership Strategy   (housing-needs-assessment.html#affordable-ownership-need-section)
Step 6: Deal Calculator (rental)  (deal-calculator.html)            Deal Calculator (ownership mode)
```

Note: Ownership step 5 re-uses the HNA page scrolled to the ownership section, which
already has the full strategy panel at line 1658.

---

## Implementation Script for Codex

### Phase 1 — Persist product type in workflow state

**File: `js/workflow-state-core.js`**

Add a `product_type` key to the stored state. After the existing step-metadata block,
add:

```js
// Product type — 'rental' (default) or 'ownership'
function _getProductType() {
  return _wfGet('product_type') || 'rental';
}
function _setProductType(type) {
  if (type !== 'rental' && type !== 'ownership') return;
  _wfSet('product_type', type);
}
```

Expose via `window._WorkflowInternal`:

```js
_WorkflowInternal.getProductType = _getProductType;
_WorkflowInternal.setProductType = _setProductType;
```

**File: `js/workflow-state-api.js`**

Add to the public `WorkflowState` object:

```js
getProductType: function () {
  return window._WorkflowInternal.getProductType();
},
setProductType: function (type) {
  window._WorkflowInternal.setProductType(type);
},
```

---

### Phase 2 — Add product-type fork UI to select-jurisdiction.html

After the existing jurisdiction picker section, add a product-type toggle.
Insert before the "next step" CTA button:

```html
<!-- Product-type selection — persisted in WorkflowState -->
<section class="chart-card" aria-labelledby="productTypeHeading" style="margin-top:var(--sp4);">
  <h2 id="productTypeHeading" style="font-size:1rem;font-weight:700;margin:0 0 var(--sp2)">
    What type of affordable housing are you developing?
  </h2>
  <div style="display:flex;gap:var(--sp3);flex-wrap:wrap;">
    <label class="dot-wrap" style="display:flex;align-items:center;gap:.5rem;min-height:44px;cursor:pointer;">
      <input type="radio" name="wf-product-type" value="rental" checked>
      <span><strong>Rental / LIHTC</strong> — tax-credit rental housing</span>
    </label>
    <label class="dot-wrap" style="display:flex;align-items:center;gap:.5rem;min-height:44px;cursor:pointer;">
      <input type="radio" name="wf-product-type" value="ownership">
      <span><strong>Ownership / For-Sale</strong> — deed-restricted or shared-equity homeownership</span>
    </label>
  </div>
</section>
```

Add inline script (after `workflow-state-api.js` is loaded) to persist the choice:

```js
(function () {
  var radios = document.querySelectorAll('input[name="wf-product-type"]');
  // Restore saved value
  var saved = window.WorkflowState && window.WorkflowState.getProductType();
  if (saved) {
    radios.forEach(function (r) { r.checked = r.value === saved; });
  }
  // Persist on change
  radios.forEach(function (r) {
    r.addEventListener('change', function () {
      if (r.checked && window.WorkflowState) {
        window.WorkflowState.setProductType(r.value);
      }
    });
  });
}());
```

---

### Phase 3 — Update wf-progress-steps bars

Each HTML page hard-codes its own step bar. For the ownership track the step labels
in positions 3–6 differ. Add a `data-wf-track` attribute to each step div so JS can
relabel them on page load.

**Pattern to apply to all 6 workflow pages:**

```html
<div class="wf-step" data-step="3"
     data-label-rental="Needs Assessment"
     data-label-ownership="Needs Assessment">
  <span class="wf-step__num">3</span>
  <span class="wf-step__label">Needs Assessment</span>
</div>
<div class="wf-step" data-step="4"
     data-label-rental="Market Analysis"
     data-label-ownership="For-Sale Market Study">
  ...
</div>
<div class="wf-step" data-step="5"
     data-label-rental="Scenarios"
     data-label-ownership="Ownership Strategy">
  ...
</div>
<div class="wf-step" data-step="6"
     data-label-rental="Deal"
     data-label-ownership="Deal">
  ...
</div>
```

Add a shared relabeling snippet (inline, after `workflow-state-api.js`):

```js
(function () {
  var pt = window.WorkflowState && window.WorkflowState.getProductType();
  if (!pt || pt === 'rental') return;
  document.querySelectorAll('[data-step]').forEach(function (el) {
    var lbl = el.getAttribute('data-label-' + pt);
    if (lbl) {
      var span = el.querySelector('.wf-step__label');
      if (span) span.textContent = lbl;
    }
  });
}());
```

---

### Phase 4 — Auto-activate ownership mode in deal-calculator.html

Add to the inline init block (after `workflow-state-api.js` loads, before
`deal-calculator.js` runs its `DOMContentLoaded` handler):

```js
(function () {
  var pt = window.WorkflowState && window.WorkflowState.getProductType();
  if (pt === 'ownership') {
    var radio = document.querySelector('input[name="dc-deal-mode"][value="ownership"]');
    if (radio) radio.checked = true;
    // updateDealModeUi() will be called by deal-calculator.js on DOMContentLoaded
  }
}());
```

---

### Phase 5 — Scroll HNA to ownership section when track is ownership

Add to `housing-needs-assessment.html` inline init (after `workflow-state-api.js`):

```js
(function () {
  var pt = window.WorkflowState && window.WorkflowState.getProductType();
  if (pt !== 'ownership') return;
  var section = document.getElementById('affordable-ownership-need-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}());
```

---

### Phase 6 — Add wf-progress-steps to for-sale-market-study.html

`for-sale-market-study.html` currently has no workflow progress bar.
Add the standard bar markup (ownership track, step 4 active) and apply
the relabeling snippet from Phase 3.

---

## CI / Test Checklist

After implementation:

```bash
npm test                           # JS suite — must pass
pytest tests/ -v                   # Python suite — must pass
node scripts/validate-schemas.js   # schema validation — must be 85/85
# data/manifest.json NOT needed — no data files changed
```

Watch for:
- `test:place-pages-fresh` — should be unaffected (place pages don't include wf-steps)
- Workflow-progress coupling test — confirm step labels update correctly

---

## Disclosure Requirement

All ownership-track UI must preserve the existing disclosure language:

> "This is a screening estimate, not a completed market study."  
> "potential buyer pool (moderate-income renter households) — not committed demand"

Do **not** remove or soften this language.

---

## Branch / PR Convention

- Branch: `feat/ownership-workflow-track`
- PR title: `feat(workflow): add ownership/for-sale track fork after step 2`
- Assign Copilot as reviewer
- Reference this file and `docs/issues/ownership-workflow-gap.md` in the PR description

---

*Generated 2026-08-18 by Copilot Task Agent from morning session analysis.*  
*Discovery sessions: `5339d007`, `e20dac9f`, `f68912e6`*
