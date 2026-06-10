# Controlled Vocabulary

Use these exact values in the Google Sheet so we can later import cleanly into COHO's `/pipeline/data/*.json`. **Mixing freeform values with controlled vocabulary is the #1 reason structured workflows fall apart.**

If you find yourself wanting to invent a new value, stop and either:
- pick the closest controlled value + clarify in `notes`, OR
- propose a new value (Slack/email) and update this file before using

---

## `signal_type` (Signal Log)

| Value | When to use |
|---|---|
| `HNA` | Housing Needs Assessment activity — start, draft, adoption, refresh |
| `Land` | Land bank, public land disposition, school district land, annexation parcel |
| `Funding` | Dedicated income stream, trust fund, sales tax, lodging tax, marijuana tax |
| `IZ` | Inclusionary zoning ordinance — adoption, amendment, in-lieu fee change |
| `Annexation` | Annexation application, hearing, approval |
| `TIF` | Tax Increment Financing district creation, modification, URA action |
| `RFP` | Request for proposals — affordable / workforce / land partnership |
| `Personnel` | New director, manager, council member, planning commissioner |
| `Council Mtg` | Council action specifically about housing (vote, resolution, ordinance) |
| `Comp Plan` | Comprehensive plan update — start, draft, adoption |
| `Press Release` | City / Authority press release with housing implications |
| `Other` | Use sparingly — explain in `summary` |

---

## `strength` (Signal Log)

| Value | Definition |
|---|---|
| `weak` | Interesting but not actionable. Default to this. Examples: rumor, year-out signal, generic council mention. |
| `moderate` | Actionable within 30–90 days. Examples: HNA draft expected, RFP cycle approaching, new personnel that affects partnerships. |
| `strong` | Should drive a same-week action. Examples: open RFP with deadline < 60 days, immediate land disposition, direct partnership invitation. |

**Honesty check:** if more than 30% of your signals are `strong`, you're inflating. Recalibrate.

---

## `stage` (Pipeline)

| Stage | Entry criteria |
|---|---|
| `Screen` | Passed initial OF / lens filter; no specific signal yet |
| `Signal` | At least 1 moderate+ signal logged in past 90 days |
| `Outreach` | Email sent or call scheduled in past 30 days |
| `IC` | Feasibility or IC packet underway; partner identified |
| `Active` | LOI / MOU / executed agreement |

**Demotion criteria:** if a jurisdiction sits in any stage for 90+ days with no progress, demote one stage with a `notes` entry explaining why.

---

## `classification` (Pipeline + On Pause)

The IndiBuild opportunity classification from the strategy doc.

| Code | Meaning |
|---|---|
| `A` | Real development opportunity — IndiBuild as primary developer |
| `B` | Planning-to-development consulting opportunity — fee work that may convert to A |
| `C` | Relationship / monitor opportunity — long-cycle but worth nurturing |
| `D` | Not worth current time — move to On Pause |

---

## `confidence` (Pipeline)

| Value | When |
|---|---|
| `high` | In the COHO curated 33 + recent ACS/CHAS + ZORI or AL coverage |
| `medium` | Recent ACS/CHAS but limited policy data |
| `low` | Sparse data; small CDP; no recent HNA |

**Behavioral rule:** never put a `low` confidence jurisdiction in `Outreach` stage without an explicit human override note.

---

## `relationship_tier` (Network)

| Tier | Definition |
|---|---|
| `1` | Strong / recurring contact — quarterly+ touch, will return your call |
| `2` | Warm / introduced — met 1–2 times, will probably remember you |
| `3` | Cold / research-only — found via city website; never met |

**Send-rule:** T1 / T2 templates → tier 2–3 OK. T3 (land bank probe) → tier 1–2 only. T4 (personnel reset) → tier 3 OK if within 30 days of role change. T5 (dormant check-in) → tier 1 only.

---

## `owner` (everywhere)

Use one of: `Paul`, `Kim`, `shared`. Use `shared` sparingly — every action should have a single accountable owner.

---

## `status` (Signal Log)

| Value | Meaning |
|---|---|
| `open` | Follow-up action not yet complete |
| `done` | Follow-up complete; signal archived |
| `dropped` | Decided not to pursue; signal archived |

---

## `product_type` (Pipeline)

Match the IndiBuild lane categories from the strategy doc:

- `9% LIHTC`
- `4% LIHTC`
- `Workforce rental`
- `Older adult housing`
- `Mixed-income rental`
- `Attainable ownership`
- `Preservation` (existing affordable, expiring covenants)

Compound types OK (`4% LIHTC + Workforce` — separate with ` + `).
