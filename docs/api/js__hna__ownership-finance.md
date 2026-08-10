# `js/hna/ownership-finance.js`

js/hna/ownership-finance.js
Authoritative homeownership affordability engine (Phase 1 of the
for-sale market-study plan — docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md).

Pure computation: no DOM. Dual export (window.OwnershipFinance +
module.exports), mirroring js/deal-calculator-math.js. The model registry
(data/policy/affordability-models.json) is loaded lazily: synchronously via
require() in Node, and via a fire-and-forget fetch in the browser
(`OwnershipFinance.registryReady` resolves when models are available).

Backward-compatibility contract (hard):
  maxAffordablePrice(100000, 0.80) === 289983
i.e. a call with no model/options reproduces the existing
HNAOwnershipNeed kernel (rate 6.5%, 30yr, 10% down, 30% front-end,
tax 0.65%, ins 0.35%, PMI 0.5% unconditional) bit-for-bit.

Model selection: the third argument of maxAffordablePrice /
computeBuyerCapacity accepts (a) a legacy assumptions object, (b) a
registry model id string ('conventional_dti'), or (c) an options object
{ modelId, ...overrides } — overrides win over model params.

Model selection guardrail: "best outcome" means best-matched to the
actual buyer, product, and lender — NOT the model that shrinks the gap.
recommendedModel() only ever returns the registry default; results more
permissive than the default — judged on RESOLVED assumptions, including
custom overrides — carry a mandatory buyer-risk disclosure.

## Symbols

### `resolveInput(third)`

Resolve the third argument of maxAffordablePrice/computeBuyerCapacity:
legacy assumptions object, a model id string, or { modelId, ...overrides }.

### `computeBuyerCapacity(ami4Person, amiPct, optionsOrModelId)`

Full computation: max price + loan + buyer cash under one model.
Returns null when income is unusable (missing, zero, or NEGATIVE ami /
amiPct — bad income is null, never 0); price 0 when fixed monthly costs
consume the entire budget (explicit negative-capacity handling).

### `maxAffordablePrice(ami4Person, amiPct, optionsOrModelId)`

Back-compat surface: identical signature + output to the HNA kernel.

### `incomeNeededForHomeValue(homeValue, optionsOrModelId)`

Binary-search inversion at 100% of the supplied income (same as kernel).

### `incomeRequiredForPrice(price, optionsOrModelId)`

Closed-form monthly carrying cost + required income for a KNOWN price.
Exact algebraic counterpart of computeBuyerCapacity (no search), used by
HNAUtils.computeIncomeNeeded and the affordability metrics panel so all
surfaces share one formula. Returns raw floats (callers format).

### `recommendedModel()`

Guardrail: the recommended model is ALWAYS the registry default
(conservative screening). The engine never auto-selects a more
permissive model; users must choose one explicitly and see its
implications.

### `modelParams(model)`

Translate registry param naming to the engine's canonical keys.
The registry path is new (no legacy-parity constraint), so aliases are
FULLY honored here — unlike resolveAssumptions, whose alias shadowing
deliberately mirrors the legacy kernel.

### `permissivenessRankResolved(a)`

Permissiveness is judged on RESOLVED assumptions (model params merged
with any overrides) — a "custom" model with aggressive entered ratios
ranks permissive and gets the risk disclosure just like a named
permissive model. Higher rank = more buying power claimed from the same
income. The effective housing ratio honors a binding front-end cap.

### `compareModels(ami4Person, amiPct, modelIds, opts)`

Compare models side-by-side.
opts: { overrides?: object, targetPrice?: number }
Every result more permissive than the default (on resolved assumptions)
carries riskDisclosureRequired: true and the model's buyer_risk text —
consumers MUST render it. When targetPrice is supplied each result
carries the signed gap:
  gapVsTargetPrice = maxPrice − targetPrice  (negative ⇒ buyer falls
  short of the target; positive ⇒ headroom), and
  subsidyNeededPerUnit = max(0, targetPrice − maxPrice).
