# CHFA QAP Simulator

Interactive competitiveness estimator for CHFA 9% allocations, calibrated against 2015–2025 historical award patterns. Two distinct surfaces live in the Deal Calculator:

- **QAP Predictor** (`#dcQapPanel`) — derives a score **from deal-calculator inputs** (county / AMI mix / basis / softs). Non-interactive.
- **QAP Simulator** (`#qapSimulatorMount`) — **user-adjustable sliders** on each scoring category. Interactive.

Both present the same 0–100 scale; they just differ in what controls them.

**Primary code**: [`js/qap-simulator.js`](../../js/qap-simulator.js)
**Tests**: [`test/qap-simulator.test.js`](../../test/qap-simulator.test.js) — 64 assertions covering every driver of every category
**Surfaces in**: [`deal-calculator.html`](../../deal-calculator.html)

---

## What it does

Estimates how a proposed 9% LIHTC application would score under CHFA's Qualified Allocation Plan, expressed as a total out of 100 with a competitive band label (Weak / Moderate / Strong / Exceptional). Includes a percentile vs. historical winners, an award-likelihood estimate, and a per-category breakdown with specific drivers (e.g. \"soft funding > $500K\") that each add points.

---

## Inputs

### Shared — from the deal calculator
| Input | Purpose |
|---|---|
| County / metro selection | Seeds Geography & Site base points |
| QCT / DDA checkbox | +2.5 / +2.0 Geography points |
| Soft funding total | Drives Local Support points |
| AMI tier mix (`#dc-chk-30` etc.) | Drives Community Need base + \"AMI 30% need > 50 units\" driver |

### Simulator-only (slider overrides)
| Slider id | Range | Default | Category |
|---|---|---|---|
| `qsim_devScore` | 0–15 | Inferred | Developer Track Record |
| `qsim_designScore` | 0–10 | Inferred | Design & Green |
| `qsim_otherBonus` | 0–4 | Inferred | Other / Tiebreaker |

Non-slider drivers (public-land, HNA-backed documentation, government support letter) are toggled via in-panel checkboxes.

---

## Methodology

### Scoring categories (total weight = 100)

| Category | Max pts | Primary drivers |
|---|---:|---|
| Geography & Site | 20 | QCT (+2.5), DDA (+2.0), PMA ≥75 (+2.0), PMA ≥60 (+1.0), Rural (−1.5) |
| Community Need | 25 | Housing gap >200 units (+4.0), gap >50 (+2.0, else-if), AMI 30% need >50 (+2.0), HNA-backed data (+1.5) |
| Local Support | 22 | Soft funding >$500K (+5.0), >$100K (+2.5, else-if), government letter (+3.0), public land (+2.5) |
| Developer Track Record | 15 | Historical score base; slider override available |
| Design & Green | 10 | Green building cert (+2.0); slider override available |
| Other / Tiebreaker | 8 | Bonus slider 0–4 |

Each category's raw sum is **capped at its max** so over-stacking drivers can't push a single dimension above its cap.

### Predictor vs. Simulator

**Predictor** (`dcQapPanel`): reads deal-calculator state each time it re-renders. Doesn't update when you move a simulator slider — by design. Shows what the tool thinks this deal would score *based purely on the concrete inputs provided*.

**Simulator** (`qapSimulatorMount`): lets you override any category's points with the sliders, useful for asking _\"what if my developer track record improves by 3 points?\"_ — the total updates immediately. Tests verify total moves from 70 → 55 when the dev slider sweeps 15 → 0.

Both surface the same scoring-band label:
- ≤65 → **Weak Competitive Position**
- 65–74 → **Moderate**
- 74–82 → **Strong**
- ≥82 → **Exceptional**

### Award-likelihood estimate

A percentile map against 2015–2025 historical winners feeds a rough award-likelihood percentage (_\"12% estimated award likelihood\"_). This is a calibration against a historical base rate, not a forward-looking forecast.

### \"Improve Your Score\" callouts

Under the breakdown, the simulator lists concrete actions that would lift the score (e.g. _\"Secure local government support letters (+7 pts possible)\"_). These map back to specific drivers so a user can see what to pursue.

---

## Outputs

| Surface | What it shows |
|---|---|
| Total score | 0–100 out of CHFA's policy max |
| Competitive band label | Weak / Moderate / Strong / Exceptional |
| Percentile vs. winners | Where this score lands in the historical CHFA award distribution |
| Estimated award likelihood | Base-rate implication of that percentile |
| Per-category scores | 6 rows with \"X / maxPts\" and a short descriptive phrase |
| Improvement callouts | Named drivers with specific point gains |

---

## Limitations

| Limitation | Detail |
|---|---|
| **Not CHFA scoring** | This is a historical-pattern estimate. CHFA is the sole arbiter of actual QAP points |
| Calibration window | 2015–2025 award data. 2026 QAP changes may shift weights; the tool doesn't know about policy updates |
| Developer track record is defaulted | The simulator assumes a neutral historical score unless the user overrides it. Real applications score based on the developer's CHFA history |
| Supplementary scoring ignored | Tiebreaker logic, specific amenity scoring, and CHFA's discretionary factors aren't modeled |
| Dual-surface confusion | The Predictor and Simulator share a panel but don't interlink. Updating the simulator doesn't update the predictor (and vice versa). See the [#662 explainer tooltip](https://github.com/pggLLC/Housing-Analytics/pull/662) for the in-UI distinction |

---

## Related

- [Deal Predictor guide](./deal-predictor.md) — the upstream recommendation. If it says `9%`, this is your scoring tool
- [PMA Analysis guide](./pma-analysis.md) — the PMA score that drives Geography & Site points
- [Pro Forma guide](./pro-forma.md) — operating feasibility for the same deal concept

## Change log
- 2026-04-21: 64-assertion test suite landed in the session; QAP sim sliders verified to recalc in real-time via [#550 QA comment](https://github.com/pggLLC/Housing-Analytics/issues/550#issuecomment-4284360744).
