# CDOH / CHFA Rural vs Urban Designation & Jurisdictional Competitiveness — Reference

**Type:** methodology/reference. Feeds Tier-1 jurisdictional strategy output and the project funding path.
**Date:** 2026-08-04 · **Status:** reference; **all program-specific rules are VERIFY** against the current CHFA QAP, DOLA/DOH (Colorado Division of Housing) guidance, Prop 123 rules, and USDA RD eligibility before production use.
**Why this exists:** a jurisdiction's **rural vs urban designation** changes which funding pools it competes in, the per-unit cost limits and set-asides it can use, and what it must do to be competitive. The repo already carries the CHFA **`urban_rural`** classification on LIHTC properties (e.g. `urban_rural: "rural" | "urban"`, plus a `region` field) and uses **"rural set-aside" / "rural resort"** vocabulary — so the designation is data the tool can surface today.

---

## 1. Where the designation comes from (and what it governs)

There is no single "rural/urban" flag — several programs classify differently, and the tool should surface each that applies:

| Program / agency | Classification | What it governs |
|---|---|---|
| **CHFA QAP (LIHTC)** | urban / rural / **rural resort** (repo `urban_rural`) | A dedicated **rural set-aside** of annual 9% credits; different **per-unit cost limits** (rural/rural-resort vs metro); scoring nuances |
| **DOLA / CDOH (Colorado Division of Housing)** | rural / urban regions; **Prop 123** eligibility | Program set-asides, per-unit limits, and Prop 123 dedicated funding; rural-specific gap financing |
| **CDBG / HOME (HUD)** | **entitlement** (urban) vs **non-entitlement** (rural/small) | Entitlement cities/urban counties get **direct formula grants**; non-entitlement communities compete **through the State (DOLA)** |
| **USDA Rural Development** | rural-eligible (population + rural-in-character) | 502 Direct/Guaranteed buyer mortgages; site must be RD-eligible |

**Fruita/Mesa context (VERIFY specifics):** Grand Junction is the urban hub and is likely a **CDBG entitlement** city; **Fruita (~14k) is small and likely non-entitlement / rural** for CDBG and **USDA-eligible**, and likely **rural (or rural-resort-adjacent)** in the CHFA classification. That means Fruita generally **accesses CDBG/HOME through the State**, can use the **rural set-aside and USDA**, but has a smaller local capacity/match base than an urban entitlement jurisdiction.

---

## 2. What the designation *means* for a jurisdiction (both directions)

**Rural is not simply "disadvantaged" — it is a different competitive lane with its own advantages and burdens.**

**Rural advantages**
- A **dedicated rural set-aside** means rural projects compete against *other rural projects*, not the deep metro pool.
- **USDA RD** buyer financing (0% down) is available — a lever urban buyers don't have.
- **Rural-resort** cost limits recognize high construction costs in mountain/resort markets.
- Smaller deals can be decisive locally (one 50-unit project moves the needle on the Prop 123 3% goal).

**Rural burdens (the competitiveness gap to close)**
- Thinner **local capacity** (staff, developer, steward — see the housing-authority strength framework) and smaller **local match** (land, fees, trust funds).
- Fewer **comparable sales / market data** for appraisal and market study (the data-thinning documented in the statewide readiness review).
- No **direct CDBG/HOME** formula money — must compete through the State.
- Higher per-unit soft-cost burden spread over fewer units.

**Urban advantages/burdens (the "urban designation" to be competitive with)**
- Direct entitlement CDBG/HOME, deeper local revenue (linkage/inclusionary), more staff and developer capacity, richer market data — **but** deeper competition for 9% credits and higher land cost.

---

## 3. Steps a jurisdiction takes to be competitive

The tool should translate a jurisdiction's designation into a **concrete competitiveness checklist** (repo data supports most of these today):

1. **Adopt a current Housing Needs Assessment (≤3 years).** This is the gateway to **Prop 123 fast-track** eligibility — the repo already tracks HNA status in `data/policy/jurisdiction-housing-progress.json` (`'current' = within 3 yrs → qualifies`). *Fruita/Mesa: confirm the Root Policy Mesa Regional HNA vintage satisfies this.*
2. **File the Prop 123 commitment** (baseline + the ~3% affordable-stock increase) — repo `data/policy/prop123_jurisdictions.json`; Fruita already shows `prop123.status: "Committed"`.
3. **Establish or partner for capacity** — a *strong* housing authority, or a regional/multijurisdictional partner, or a steward (HRWC / CLT). A paper authority is not competitive (see `HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` §strength).
4. **Assemble local match** — public land, fee waivers/deferrals, infrastructure, trust-fund dollars (see `LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md`). Match is often the difference in scoring.
5. **Secure site control + entitlement readiness** — zoning, water/tap, density; expedited review.
6. **Align the project to QAP scoring** — use the repo's QAP simulator (`test:qap-simulator`) and the **rural set-aside**; for rural-resort, use the higher cost limits.
7. **Layer USDA RD** buyer financing where the site is RD-eligible (Fruita likely qualifies — VERIFY).
8. **Collaborate regionally** — a multijurisdictional authority (APCHA/Yampa Valley model) brings taxing power, scale, and shared staff that a small rural town cannot muster alone.

**"Competing with the urban designation"** does not mean becoming urban — it means **stacking the rural-lane advantages (set-aside, USDA, resort cost limits) with the capacity and match that urban jurisdictions have by default** (current HNA, committed match, staffed steward, QAP-aligned design). The tool's job is to show which of these a jurisdiction already has and which it must build.

---

## 4. Integration into the analysis

- **Data:** surface the CHFA `urban_rural` designation (already in the LIHTC property data), CDBG entitlement status (VERIFY per jurisdiction), USDA eligibility, and Prop 123 / HNA status (`jurisdiction-housing-progress.json`).
- **Tier-1 output:** for each jurisdiction, state its designation(s), what pools/limits/set-asides that opens, and the **competitiveness checklist** (§3) with each item marked done / gap.
- **Schema addition** (jurisdiction record):
```jsonc
"funding_competitiveness": {
  "chfa_designation": "rural|urban|rural_resort",       // from urban_rural
  "cdbg_status": "entitlement|non_entitlement",          // VERIFY
  "usda_rd_eligible": null,                              // VERIFY per site
  "current_hna": true, "prop123_status": "committed",
  "rural_set_aside_eligible": null,
  "competitiveness_gaps": ["capacity","local_match"],    // computed checklist gaps
  "source": "...", "last_verified": "2026-08-04", "classification": "observed|modeled"
}
```

## 5. Guardrails

- **Every program rule is VERIFY** against the *current* QAP / DOH / Prop 123 / USDA guidance — these change annually. The tool cites the framework and the jurisdiction's status, not fabricated set-aside percentages or cost limits.
- **Designation is not destiny.** Rural is a different lane, not a lower one; present both the advantages and the burdens.
- **Competitiveness ≠ guarantee.** The checklist improves odds; it does not award funding. Keep the availability-vs-commitment discipline (only awarded/committed counts).
