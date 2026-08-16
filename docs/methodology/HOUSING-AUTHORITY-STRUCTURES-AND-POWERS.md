# Housing Authority Structures & Powers — Reference for the Ownership Analysis

**Type:** methodology/reference. Feeds Tier-1 jurisdictional capacity analysis and the Tier-2 land/stewardship decision.
**Date:** 2026-08-04 · **Status:** reference; statutory citations marked VERIFY must be confirmed with counsel against current C.R.S.
**Why this exists:** *the organizational structure of the local housing authority materially changes what a jurisdiction can bring to an affordable-ownership project* — its land powers, bonding capacity, taxing ability, funding eligibility, and permanence as a steward. The tool should note the structure serving each jurisdiction and the strengths it brings as an independent, quasi-jurisdictional public developer. The repo already tracks **115 distinct housing authorities** in `data/hna/local-resources.json`; this document classifies them and states what each type can do.

---

## 1. What a housing authority *is* (the quasi-jurisdictional part)

A Colorado housing authority is a **separate body corporate and politic** — a public entity distinct from the city or county that creates it, established under **C.R.S. Title 29, Article 4** (Housing Authorities Law; the Deal Calculator already cites this family at `js/deal-calculator.js:755` alongside the tax exemption in **C.R.S. §39-3-112.5**). Being a distinct public corporation — not a line department — is the source of its strengths: it can own property, contract, sue and be sued, employ staff, act as a developer, and issue its own bonds **independent of the general municipal budget, debt limits, and election cycles**, while remaining a governmental instrumentality for tax-exemption and funding-eligibility purposes. That combination — public powers with corporate independence — is why it functions as a *quasi-jurisdictional public developer*.

> **Citation discipline:** the Title 29, Art. 4 framework and §39-3-112.5 exemption are repo-established. Specific part/section numbers below (e.g. the multijurisdictional act) are marked **VERIFY** and must be confirmed with counsel against current C.R.S. before appearing in production output — consistent with the repo's VERIFY policy for legal/funding terms.

---

## 2. Structure types (with real in-repo examples and their strengths)

Every example below is already present in `data/hna/local-resources.json`.

### Type A — Municipal (city/town) housing authority
- **Examples:** Fruita Housing Authority, Grand Junction Housing Authority (GJHA), Denver Housing Authority, Aurora Housing Authority, Housing Authority of the City of Salida.
- **Jurisdiction:** the municipality (and, by agreement, nearby areas).
- **Strengths:** closest alignment with local land-use, entitlement, and public land; direct pipeline to municipal land contribution and fee waivers; simplest governance.
- **Limits:** footprint and tax base are the single municipality; buyer pool and funding scale are local. *(Fruita Commons sits here — small municipal authority, which raises the capacity question in §5.)*

### Type B — County housing authority
- **Examples:** Boulder County Housing Authority, Garfield County Housing Authority, Arapahoe County Housing Authority, Jefferson County Housing Authority.
- **Jurisdiction:** unincorporated county + participating municipalities.
- **Strengths:** larger land base and tax base than a single town; can serve multiple small towns lacking their own capacity; county-owned parcels (`data/policy/county-ownership.json`) as land contribution.

### Type C — Multijurisdictional / regional housing authority (IGA-based)
- **Examples:** **APCHA** (Aspen/Pitkin County Housing Authority — a joint city-county authority), **Yampa Valley Housing Authority** (Routt/Steamboat), **Summit Combined Housing Authority**, **Eagle County Housing & Development Authority**, Grand County Housing Authority.
- **Basis:** formed by intergovernmental agreement among two or more local governments (Colorado multijurisdictional housing authority framework — **VERIFY** current cite, commonly **C.R.S. §29-1-204.5**).
- **Strengths (the strongest developer structure):** regional scale matched to real commute/market areas; **dedicated taxing power with voter approval** (Yampa Valley and several peers run voter-approved property-tax mill levies / sales taxes) → a recurring revenue stream for land banking, subsidy, and stewardship; shared professional staff; a regional buyer pool and deed-restriction program (APCHA administers thousands of restricted units in perpetuity — the benchmark for stewardship permanence).
- **Relevance to Fruita/Grand Valley:** the Fruita + Grand Junction + Mesa County market is regional (see the Fruita Mews PMA calibration, `internal/docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md`). A Grand Valley multijurisdictional authority (or a GJHA/Mesa County partnership) would bring taxing and scale a single small-town authority cannot.

### Type D — "Public developer" authority operating through nonprofit / LLC affiliates
- **Examples:** **Housing Catalyst** (formerly Fort Collins Housing Authority), **Boulder Housing Partners**, **Metro West Housing Solutions** (Lakewood), **Housing Solutions for the Southwest**.
- **Structure:** the authority creates affiliated 501(c)(3)s and single-purpose LLCs to hold property, serve as LIHTC general partner / managing member, isolate liability, and structure tax-exempt ownership.
- **Strengths:** full in-house development capacity; can be **master developer and co-GP**, cross-subsidize across projects, and layer tax-exempt bond + LIHTC + for-sale programs; the affiliate structure is exactly what enables durable tax-exempt land ownership feeding a for-sale/CLT program (Model A/D in the land-disposition analysis).
- **Trade-off:** greater legal/administrative complexity; requires real staff capacity.

### Type E — Council-of-governments / coalition-administered & "limited" authorities
- **Examples:** Northwest Colorado Council of Governments (housing programs), San Luis Valley Housing Coalition, SECHA (Southeast Colorado Housing), NE Colorado Housing Authority; and "limited" authorities administered through a neighbor (Hinsdale via Gunnison; Elbert, Ouray, Rio Blanco marked "limited").
- **Strengths:** pools capacity for rural jurisdictions too small to staff their own authority; regional administration of counseling, DPA, and stewardship.
- **Signal for the tool:** where a jurisdiction is served only by a "limited" or coalition arrangement, Tier 1 should lean toward the **"Permanent ownership stewardship capacity not established"** flag (§15 of the refinement) unless a qualified administrator is confirmed.

### Type F — Housing trust / community land trust variants
- **Examples:** Chaffee Housing Trust; CLT organizations in `data/policy/county-ownership.json` (e.g. Boulder County Community Land Trust, Elevation CLT already in `resale-conventions.json`).
- **Role:** not a statutory housing authority, but the natural **stewardship partner** for retained-land for-sale ownership; pairs with an authority under land-disposition Models A/D.

---

## 3. Powers & strengths as an independent public developer

| Power / strength | What it enables | Structure types that have it |
|---|---|---|
| **Separate body corporate** | Act as developer independent of municipal budget, debt limit, and election cycle | All (A–E) |
| **Property-tax exemption** (C.R.S. §39-3-112.5; Title 29 Art. 4) | Zero property tax **while the authority owns** — the land-retention lever (worth ~$30k/unit buyer power at 100% AMI; see study QA Addendum A3) | All authority types |
| **Revenue / private-activity bond issuance** | Tax-exempt financing **off** the municipality's GO debt limit; conduit issuer for buyer mortgages (MRBs/MCCs) | All; strongest at C/D |
| **Dedicated taxing power** (mill levy / sales tax, voter-approved) | Recurring revenue for land banking, per-unit subsidy, and stewardship | **C (multijurisdictional)** primarily |
| **Land assembly / banking / eminent domain** | Hold land long-term (99-yr ground lease), assemble sites; condemnation for housing (used rarely) | All; scale at B/C |
| **PILOT (payment in lieu of taxes)** | Negotiated public-purpose tax treatment | All |
| **Master-developer + LIHTC GP capacity** | Enter master development agreements, phase projects, co-GP with private developers, cross-subsidize | **D** (via affiliates); C |
| **PHA-reserved funding eligibility** | Access to sources reserved to public entities/PHAs (certain HUD, DOLA, FHLBank, Prop 123 set-asides) | All authority types |
| **Perpetual stewardship** | Administer deed restrictions / resale formulas in perpetuity (institutional continuity beyond any developer) | C/D strongest; A/B if staffed; F as partner |

**The core value proposition for a for-sale program:** a housing authority can **retain the land tax-exempt, finance with off-balance-sheet bonds, contribute public land as subsidy, and steward the resale restrictions permanently** — the exact levers that turn an unaffordable market home into a durably affordable ownership unit. No private developer can do all four.

---

## 4. What this means for Fruita Commons

- **Fruita Housing Authority is a Type A municipal authority** — well-aligned to Fruita land and entitlement, but small; it delivered the LIHTC rental **Fruita Mews** as a limited partnership with a private developer (named in the Fruita jurisdiction brief), which is the normal way a small authority accesses developer capacity.
- **The land-retention hypothesis (Model A, 99-yr ground lease) is squarely within its powers** and is where its tax-exemption and land-contribution strengths are decisive.
- **Capacity and stewardship are the open questions**, not powers. A small municipal authority may lack in-house master-developer or perpetual resale-administration capacity. Options the tool should surface: (a) partner with a **Type C/D regional or public-developer authority** (a Grand Valley/GJHA/Mesa arrangement) for bonding and scale; (b) contract stewardship to **HRWC** or a **CLT** (Type F); (c) use an LLC/nonprofit affiliate for the LIHTC-style GP role, as Housing Catalyst / Boulder Housing Partners do.
- **"FHA" in this project = Fruita Housing Authority**, not the Federal Housing Administration mortgage — keep them separate in every output.

---

## 5. Integration into the analysis (schema + Tier-1 output)

Extend the stewardship/housing-authority record in `data/hna/local-resources.json` (Revision-2 §5.4) with structure fields:

```jsonc
"housingAuthority": [{
  "name": "Fruita Housing Authority",
  "url": "https://www.fruita.org/694/Fruita-Housing-Authority",
  "structure_type": "municipal|county|multijurisdictional|public_developer_affiliated|cog_coalition|limited|housing_trust_clt",
  "enabling_framework": "C.R.S. Title 29, Art. 4",       // VERIFY exact part; MJHA ~ §29-1-204.5 VERIFY
  "taxing_authority": false,                               // true typically only for multijurisdictional
  "bonding_authority": true,
  "affiliated_entities": [],                               // 501(c)(3)/LLC dev or GP affiliates (Type D)
  "powers": ["property_tax_exemption","land_banking","revenue_bonds","pilot","master_developer","perpetual_stewardship"],
  "strengths": ["local_land_alignment"],                   // structure-derived
  "capacity": "verify",                                    // developer/steward capacity — NOT implied by existence
  "stewardship_capacity": "established|not_established",
  "source": "...", "last_verified": "2026-08-04", "classification": "observed|user_entered"
}]
```

**Tier-1 output (§16) should state, per jurisdiction:** the serving authority's **structure type**, the **powers it brings** (taxing? bonding? land?), and a **capacity finding** — and where capacity is limited, name the regional/partner/steward path rather than assuming the local authority can do it all. Having an authority listed is **not** evidence of developer or stewardship capacity; the capacity finding is a separate, verifiable field.

---

## 5b. Authority STRENGTH — structure is not capacity (some are paper entities)

**Existence on a list is not capacity.** Of the 115 authorities in `local-resources.json`, many are **nominal / dormant "paper" entities** — created by ordinance but with no staff, no completed projects, no bonding history, and no stewardship track record. A paper authority **cannot** master-develop or steward a for-sale program, and treating it as if it can is a core risk this tool must guard against. The analysis must assess **strength**, not just presence, and say so plainly.

### Capacity tiers (assess and label per jurisdiction)

| Tier | Meaning | Typical signals |
|---|---|---|
| **Active developer / steward** | Delivers and stewards projects | Recent LIHTC/for-sale project delivery; acts as GP/co-GP or via a development affiliate; dedicated staff; bonding history; administers deed restrictions in perpetuity |
| **Administrative / programmatic** | Runs programs, partners for development | Administers vouchers/DPA/counseling; delivers **via partnership** (as Fruita HA did with Fruita Mews) rather than in-house; limited or no bonding |
| **Nominal / dormant (paper)** | Exists on paper only | No staff, no completed projects, no recent activity; often "limited" or administered through a neighbor |

### Signals the repo can use to infer strength (mostly already present)
- **Project delivery** — `data/affordable-housing/` LIHTC award data carries developer/owner, `award_year`, `urban_rural`, `region`; an authority (or its affiliate) appearing as owner/GP is the strongest activity signal.
- **Prop 123 commitment + current HNA** — `data/policy/jurisdiction-housing-progress.json` (a committed, HNA-current jurisdiction is demonstrably active).
- **Funding/fee-waiver track record** — `data/policy/chfa-watchlist.json` `evidence_summary` already captures fee-waiver dollars, CHDF, and "best-stack jurisdiction" signals.
- **Dedicated revenue** — a voter-approved mill levy / sales tax (multijurisdictional authorities) is a strong capacity signal.
- **Stewardship track record** — an existing deed-restriction/resale program (APCHA is the benchmark).

### Rule and output
- Emit a **`capacity_tier` + `activity_evidence`** per authority; where the tier is nominal/dormant, fire the **"Permanent ownership stewardship capacity not established"** flag (§15 of the refinement) and recommend a capacity path: a **regional/multijurisdictional partner**, a **public-developer-affiliated authority** (Type D) as co-developer, or a **contracted steward** (HRWC / CLT).
- **Fruita Housing Authority** is **Administrative/programmatic → active-via-partnership**: it delivered Fruita Mews as a limited partnership with a private developer (named in the Fruita jurisdiction brief), so it is *not* a paper entity, but its in-house master-developer and perpetual-stewardship capacity for a for-sale/CLT program is **unproven and must be verified** — the study should plan a capacity partner rather than assume the authority can steward 50 for-sale homes in perpetuity alone.

### Schema addition (extends §5)
```jsonc
"capacity_tier": "active_developer|administrative|nominal_paper",
"activity_evidence": { "recent_projects": [], "bonding_history": null, "dedicated_revenue": null,
                       "stewardship_program": null, "prop123_committed": true, "current_hna": true },
"capacity_source": "...", "capacity_last_verified": "2026-08-04"
```

## 6. Guardrails

- **Structure ≠ capacity.** The existence of a housing authority does not mean it can master-develop or steward in perpetuity. Keep the capacity finding separate and evidence-based (ties to the §15 "stewardship capacity not established" flag).
- **Do not assert taxing/bonding powers a specific authority hasn't exercised.** Mark `taxing_authority`/`bonding_authority` per verified fact, not per type default.
- **Statutory citations are VERIFY** until confirmed with counsel; the tool cites the framework, not made-up section numbers.
- **Powers are enabling, not automatic.** Every structural strength (tax exemption on retained land, bond issuance, PILOT, land contribution) still requires the specific legal, lender, appraiser, and bond-counsel steps listed in the study's external-validation section.
