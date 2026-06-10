# Tone & Vocabulary Guide

> Outgoing messaging across this repo should sound like the voice in IndiBuild's actual application materials — humble, partnership-first, community-respecting. Sources of truth: indibuild.com homepage and the Fruita Mews Phase II application narrative, CHFA presentation, and clarification response.

## Core stance

We are a **collaborative of affordable housing professionals** — not consultants, not outsiders. Everything we publish should sound like we are speaking *with* communities and CHFA, not *about* them.

- We partner. We don't sort, score, or judge jurisdictions.
- CHFA is a partner whose framework we follow, not a system we critique.
- Communities make their own decisions. We support those decisions with information.
- We are grateful for the chances we've been given. We acknowledge that.

## Preferred vocabulary (drawn from Fruita Mews materials)

| Use this | Not this |
|---|---|
| residents | tenants / units / heads |
| community / communities | market / target / jurisdiction (as adjective) |
| partners, partnership | counterparties, vendors |
| in close collaboration with | working on |
| patient, relationship-driven | aggressive, opportunistic |
| demonstrated success / shovel-ready | proven track record |
| documented demand | unmet need |
| convergence of site readiness, financial tools, demonstrated demand, and community support | "right deal at the right time" |
| we humbly ask | we propose |
| thank you for | re: / regarding |
| earn (trust, respect) | win (deals) |
| shared risk, shared patience | risk transfer |
| build trust / build capacity | leverage |
| alignment with the community's vision | fit |
| dignity, belonging, stability | "affordability stack" |
| stewardship of resources | maximizing returns |
| continuum of housing | inventory |
| intergenerational | mixed-use (when wrong context) |
| place-based, neighborhood-rooted | site-agnostic |
| workforce community | "working class market" |
| community supported / community partnership | "captured" |

## Words and phrases that must go (or never appear)

These have shown up in this repo and read as either insulting, politically charged, or implying judgment that we don't have standing to make:

- **"Anti-Targets"** — frames jurisdictions as adversaries. Use **"On Pause"** or **"Not Currently Pursued"** internally; never put it in public-facing UI.
- **"Deferred" / "Considering"** as classifications applied to specific named jurisdictions in public view — implies COHO has decided this for the community. Frame *bucket descriptions* as planning categories, but never publish the specific list of which named community is in C or D on public surfaces.
- **"Liberal-leaning" / "conservative-leaning"** — political characterization of jurisdictions has no place in our application narrative or public messaging. Use **"communities that have adopted housing-supportive policies"** when relevant.
- **"Watchlist"** — surveillance language. Use **"partner pipeline"** or **"jurisdictions in active conversation"**.
- **"Saturation"** as pejorative — frame as **"recent CHFA investment in the area"** (neutral).
- **"Drought years"** when describing a place that hasn't received credits — use **"years since last CHFA award"** (factual).
- **"Penalized" / "punished" / "downgraded"** when describing scoring impacts — use **"reflects CHFA's PMA framework, which considers regional investment"**.
- **"CHFA underweights X" / "the QAP misses Y"** — never. We follow CHFA's framework as published; we don't grade it. If we're surfacing a pattern, describe it as **"in CHFA's framework, X is weighted at Y%"** without commentary.
- **"Failed application"** — use **"unsuccessful round"** or **"prior submittal"**. Never use the public word "failed" about another developer's work.
- **"Speculative"** when describing a competitor — only acceptable to describe our own caution against a speculative project.
- **"Local opposition"** — use **"in conversation about timing"** or **"council discussions ongoing"**.

## When we surface scores, rankings, or data

Always frame as **"per CHFA's framework"**, **"per the publicly available data"**, or **"per the community's adopted plan"** — never as our own judgment of a community.

- ❌ "Rifle was penalized for its 2023 win"
- ✅ "Per CHFA's PMA framework, recent investments in the area factor into next-round scoring"

- ❌ "Silt has zero LIHTC history → ready for a deal"
- ✅ "Silt has not yet received a LIHTC award — a partnership opportunity if the community is interested"

- ❌ "This community made an explicit decision against affordable housing"
- ✅ "Council discussions about housing density are ongoing"

## When we describe CHFA

CHFA gave us our start. The Fruita CHFA presentation thanks them explicitly:

> *"We'd also like to say thank you to CHFA and the City for taking a chance on Phase I. It was a risky proposition with a new developer in a community new to affordable housing."*

That posture is the right one. Anywhere we describe CHFA's process in repo materials:

- Use **"CHFA's framework"** or **"CHFA's QAP"** without modifiers
- Cite specific sections without commentary: *"Section 4 of the QAP weights..."*
- When our model adds a layer CHFA doesn't (e.g., our distance-weighted PMA rollup), describe it as **"our supplemental indicator that approximates CHFA's PMA spread logic"** — never as a correction

## When we describe city councils, boards, or staff

The Fruita materials are explicit about how slowly trust is built and how easily it can be lost:

> *"Phase I converted skeptics. But converting skeptics through demonstrated success is a one-time, relationship-specific process. The council members and housing authority board members who supported the partnership in 2024–2025 may not all be in their seats in 2027–2028."*

Take from that:

- Acknowledge that council and board composition matters and can change
- Never describe a council vote as "wrong" or "anti-housing"
- Use **"the council's current priorities include..."** to describe what we see in adopted plans
- When a council declined a project, say **"the council elected to pursue a different path"** — not **"rejected"**

## Where to apply this guide

This guide governs:
1. **Public-facing pages** (anything on pggllc.github.io/Housing-Analytics that doesn't require the developer gate)
2. **Methodology documents** (`docs/methodology/*`)
3. **The IndiBuild internal dashboard** (`indibuild.html` and friends) — internal staff still benefit from neutral language because it will leak to partners eventually
4. **Application materials we publish back into the repo** (presentations, briefs, narratives)

Tone audits should run as a pre-commit consideration whenever we add or change user-facing copy.
