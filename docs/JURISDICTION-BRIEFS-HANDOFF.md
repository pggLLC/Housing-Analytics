# Jurisdictional briefs — handoff & audit package

**Audience:** the next agent or human auditor picking up the
`data/jurisdiction-briefs/` feature. This document explains what's
been built, what failed and how, what's live right now, what's
quarantined, and what the next reviewer needs to do.

**Last updated:** 2026-06-12. Maintain by appending; the prior state is
preserved in git history (see commit log under `data/jurisdiction-briefs/`).

---

## TL;DR

- **The feature:** curated narrative briefs about each Colorado
  jurisdiction's affordable-housing history (LIHTC, local funding,
  coalition memberships, recent ordinances). Surface: the
  password-gated [`indibuild-brief.html`](../indibuild-brief.html)
  page in Developer Tools.
- **Authoring discipline (mandatory):** every claim in a published
  brief must be backed by a verbatim WebFetch quote logged in
  `data/jurisdiction-briefs/_verified/<geoid>.json`. The
  validator now enforces this — `published: true` will fail QA without
  a verification report whose rows are all `supported` or `partial`.
- **What's live (6 briefs):** Carbondale, Aspen, Colorado Springs,
  Cortez, Rifle, and Pitkin County. Each live brief has a direct-fetch
  verification report and only supported cited source pairs.
- **What's quarantined (5 briefs):** Denver, Fort Collins, Glenwood
  Springs, Salida, and Garfield County. All remain `published: false`
  pending direct-WebFetch audit or repair.
- **Next reviewer's job:** re-audit those 5 with direct WebFetch (NOT
  WebSearch — the WebSearch reports already on disk are unreliable;
  see "The 2026-06-12 fabrication incident" below).

---

## Per-brief status snapshot

| GEOID | Jurisdiction | published | `_verified` | rows | supp | part | **unsup** | **inacc** | Audit method |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 0803455 | City of Aspen | ✓ | ✓ | 20 | 20 | 0 | 0 | 0 | direct WebFetch (strip) |
| 08045 | Garfield County | · | ✓ | 22 | 4 | 17 | 0 | 1 | direct WebFetch (strip; >80% broken) |
| 08097 | Pitkin County | ✓ | ✓ | 24 | 24 | 0 | 0 | 0 | direct WebFetch (strip) |
| **0812045** | **Town of Carbondale** | **✓** | ✓ | 16 | **16** | 0 | 0 | 0 | **direct WebFetch** |
| 0816000 | City of Colorado Springs | ✓ | ✓ | 15 | 15 | 0 | 0 | 0 | direct WebFetch (strip) |
| 0817375 | City of Cortez | ✓ | ✓ | 14 | 14 | 0 | 0 | 0 | direct WebFetch (strip) |
| 0820000 | City of Denver | · | ✗ | — | — | — | — | — | not audited |
| 0827425 | City of Fort Collins | · | ✓ | 33 | 26 | 7 | 0 | 0 | WebSearch (unreliable) |
| 0830780 | City of Glenwood Springs | · | ✓ | 30 | 21 | 9 | 0 | 0 | WebSearch (unreliable) |
| 0864255 | City of Rifle | ✓ | ✓ | 6 | 6 | 0 | 0 | 0 | direct WebFetch (strip) |
| 0867280 | City of Salida | · | ✓ | 27 | 18 | 9 | 0 | 0 | mixed |

**Reading the table.** Live briefs have direct-fetch verification
reports. Of the remaining quarantined briefs, several have a verifier report on disk but it was
produced via WebSearch over the source domain — a methodologically
weaker substitute that the original verifier agents fell back to when
WebFetch was sandbox-denied. WebSearch returns paraphrased snippets,
which inflate the "supported" count by matching topical keywords
without verifying the specific claim. **The Carbondale brief went from
~75% supported under WebSearch to 24% supported under direct WebFetch.
Treat the seven WebSearch reports as suspect, not authoritative.**
Three briefs (Cortez, Denver, Garfield County) have no audit at all.

---

## The 2026-06-12 fabrication incident

A spot-check on Carbondale by the project owner exposed a fabricated
source-to-claim mapping: brief source `s9` was supposed to back the
Artspace contract conclusion + Robert Schultz Consulting RFP claim,
but the cited Sopris Sun URL (a "Carbondale Report" about waste,
water, and ADUs) did not mention Artspace, contract conclusion, an
RFP, or anything related. The research agent that originally produced
the brief had invented the source ↔ excerpt mapping.

Follow-on direct-WebFetch audit of Carbondale's 25 cite-pairs found
**24% solidly supported, 36% partial, 24% unsupported, 16%
inaccessible** — twelve specific blocking corrections, including:

- $2.7M donation valuation (actual: $2.4M per assessor)
- Resolution #9-2023 (actual: #8-2023)
- "Good Deeds buy-down program" in the resolution (actual:
  "Regional Deed Restriction Purchase Program" — Good Deeds is the
  coalition's later public brand)
- Pitkin County WMRHC contribution $1M (actual: $2M)
- WMRHC 30-by-2026 cost $8M–$10M (actual: $13.5M)
- 30% / 3% / $1.5M buy-down structure sourced to articles about Eagle
  County's 5% / 15% Good Deeds (wrong coalition entirely)
- Cavern Springs MHP April 2024 $500K LoI (actual: June 25, 2025 $1M
  pledge for **two** parks at $43M total)
- WMRHC formation 2020/2023 (actual: "Established in 2022")
- 4 cited URLs returned 404 / 429 / unreadable

Response:
1. **Quarantine.** All 11 briefs flipped to `published: false`
   (commit `4ffae5d3`).
2. **Validator hardened.** `scripts/validate-jurisdiction-briefs.py`
   now refuses `published: true` without a verification report whose
   rows are all `supported` or `partial`.
3. **Surgical strip of Carbondale** (commit `863844ba`) — kept only
   the 7 cite-pairs that came back fully supported; published a
   shorter but honest brief.
4. **Source-first rewrite of Carbondale** (commit `016d1ed2`) —
   expanded back to 16 cite-pairs, each backed by a WebFetch verbatim
   quote written into `_verified/0812045.json`.

Full forensic trail:
```
712eb307  audit(briefs): source-provenance verdicts for 8 of 11 briefs
4ffae5d3  quarantine(briefs): unpublish all 11 pending source-provenance audit
863844ba  strip(briefs): Carbondale to 7 verified cite-pairs; re-publish honestly
016d1ed2  rewrite(briefs): source-first Carbondale — 16 verbatim-quoted cite-pairs
```

---

## Source-first authoring discipline (mandatory for the next reviewer)

The only acceptable workflow now for any new or republished brief:

1. **Decide what claim you want to make.**
2. **WebFetch a candidate URL** with a verification prompt of the
   form:
   > "Does the article at this URL materially support the following
   > claim? Quote supporting sentences VERBATIM, or say 'NOT
   > SUPPORTED'. Claim: \<text>"
3. If the response is supported, **write the brief sentence to match
   what the source actually says** (not the other way around — never
   write the claim first and try to source it).
4. **Record the verdict** in `data/jurisdiction-briefs/_verified/<geoid>.json`
   under that paragraph + source.
5. **Run the validator.** `published: true` will fail if any row is
   `unsupported`, any row is `inaccessible`, or the report doesn't
   exist at all.

Do **not**:
- Treat a search-engine snippet as a verification. WebSearch
  returns paraphrased text that overstates "support" by keyword
  match. WebFetch returns the actual article.
- Trust a research agent to map URLs ↔ excerpts. The 2026-06-12
  incident proved that hallucinated mappings will reach the brief if
  not checked end-to-end.
- Set `published: true` on a brief that has `inaccessible` (404 / 429
  / unreadable PDF) cites. Replace the URL or drop the claim.

---

## Verification report schema

Path: `data/jurisdiction-briefs/_verified/<geoid>.json`

```json
{
  "brief_geoid": "0812045",
  "brief_jurisdiction": "Town of Carbondale",
  "audited_at": "2026-06-12",
  "audit_method": "Direct WebFetch from the main conversation. Each cited URL fetched; verbatim quotes captured below.",
  "rows": [
    {
      "section_id": "lihtc-history",
      "paragraph_index": 0,
      "source_id": "s1",
      "source_url": "https://www.artspace.org/towncenter",
      "verdict": "supported",
      "supporting_quote": "<verbatim text from the article>",
      "notes": "<one-liner; mandatory unless verdict=supported>"
    }
  ],
  "summary": {
    "total": 16, "supported": 16, "partial": 0,
    "unsupported": 0, "inaccessible": 0
  }
}
```

The validator (`scripts/validate-jurisdiction-briefs.py`, rule 8) reads
this file when a brief is `published: true` and blocks publish if any
row is `unsupported` or `inaccessible`.

---

## Architecture overview

- **Brief content:** `data/jurisdiction-briefs/<geoid>.json` —
  schema in `_schema.json`, curation rules in `README.md`.
- **Renderer:** `js/components/jurisdiction-brief.js`. No auth gate on
  the component itself; the host page (`indibuild-brief.html`) provides
  the password gate via `js/indibuild-gate.js`.
- **Mount:** only `indibuild-brief.html` loads the brief component
  and mounts it in the curated card section. HNA + PMA do **not**
  surface briefs.
- **Validator:** `scripts/validate-jurisdiction-briefs.py`. Enforces
  single-jurisdiction QA, source-citation integrity, the
  `published: true` gate (no `kind: search` sources, no
  `needs_source: true` flags), AND the new verification-report
  requirement.
- **Curator tools:**
  - `scripts/list-brief-candidates.py` — counties + places ≥ 2,000
    pop without a brief on file.
  - `scripts/find-stale-briefs.py` — briefs whose `last_curated` is
    older than `--days` (default 30).
  - `scripts/draft-jurisdiction-brief.py` — emits a `published: false`
    skeleton for any in-scope GEOID. Skeleton is for structure only —
    every claim still needs source-first verification before flipping
    `published`.
  - `scripts/verify-brief-sources.py` — enumerates every (claim,
    source) pair in a brief as a JSON verification plan.
- **Monthly cron:**
  `.github/workflows/jurisdiction-briefs-monthly.yml` — runs candidate
  + stale snapshots on the 1st of each month and opens a PR.
- **Decisions log:** `data/jurisdiction-briefs/_decisions.md`
  (append-only — every user-picked option is recorded with the option
  text and its downstream effect).
- **Generated indexes (gitignored-friendly conventions, kept in
  repo for cron output):**
  - `data/jurisdiction-briefs/_candidates.json` — 174-entry curator
    backlog as of last run.
  - `data/jurisdiction-briefs/_stale.json` — stale-detector output.
  - `data/jurisdiction-briefs/_verification-plan.json` — current
    298-row plan across all 11 briefs.

---

## Outstanding work

### High priority — direct-WebFetch audit of the 10 quarantined briefs

The 7 WebSearch-based reports on disk are indicative, not authoritative.
Per-brief audit packages are pre-built and waiting in
[`docs/codex-audits/`](codex-audits/) — one self-contained markdown
file per brief, each with the brief content inlined, the verification
plan tabled, the exact WebFetch prompts ready to copy, the verification
report schema, the decision rules, and the validator + commit steps.

| GEOID | Jurisdiction | Cite-pairs | Package |
|---|---|---|---|
| 0803455 | City of Aspen | 25 | [codex-audits/0803455.md](codex-audits/0803455.md) |
| 08045 | Garfield County | 22 | [codex-audits/08045.md](codex-audits/08045.md) |
| 08097 | Pitkin County | 25 | [codex-audits/08097.md](codex-audits/08097.md) |
| 0816000 | City of Colorado Springs | 27 | [codex-audits/0816000.md](codex-audits/0816000.md) |
| 0817375 | City of Cortez | 26 | [codex-audits/0817375.md](codex-audits/0817375.md) |
| 0820000 | City of Denver | 37 | [codex-audits/0820000.md](codex-audits/0820000.md) |
| 0827425 | City of Fort Collins | 33 | [codex-audits/0827425.md](codex-audits/0827425.md) |
| 0830780 | City of Glenwood Springs | 30 | [codex-audits/0830780.md](codex-audits/0830780.md) |
| 0864255 | City of Rifle | 21 | [codex-audits/0864255.md](codex-audits/0864255.md) |
| 0867280 | City of Salida | 27 | [codex-audits/0867280.md](codex-audits/0867280.md) |

**273 cite-pairs total.** Each package is self-contained — the agent
working a package does NOT need to load other docs at runtime; the
brief content, verification plan, WebFetch prompts, schema, and steps
are all inlined.

Regenerate packages after editing a brief:
```bash
python3 scripts/build-codex-audit-package.py --geoid <GEOID> --force
```

### Medium priority — wire the verifier into the monthly cron

`scripts/verify-brief-sources.py` currently produces only the plan,
not the verdicts. The cron should be extended to drive WebFetch
verification per (claim, source) pair and refuse to publish any brief
that regresses. Today's `.github/workflows/jurisdiction-briefs-monthly.yml`
only surfaces backlog and stale snapshots — it does not re-verify.

### Low priority

- Drop the `_unpublished_reason` field from briefs once they're
  re-audited and republished.
- Consider promoting `_decisions.md` to a top-level decisions log if
  other features adopt the pattern.

---

## Reproduction commands

```bash
# Validate everything
python3 scripts/validate-jurisdiction-briefs.py

# What's still missing a brief
python3 scripts/list-brief-candidates.py --top 25

# What's stale (over 30 days)
python3 scripts/find-stale-briefs.py

# Build a verification plan (rows × cite-pairs)
python3 scripts/verify-brief-sources.py --geoid 0812045

# Draft a stub for a missing GEOID (curator only; never publishes itself)
python3 scripts/draft-jurisdiction-brief.py --geoid 0843000
```

---

## Risk register

| Risk | Status | Mitigation |
|---|---|---|
| Research-agent fabrications reach published briefs | **Observed and contained for Carbondale; risk live for the other 10 briefs** | Validator now requires `_verified/<geoid>.json`; this doc requires direct-WebFetch audit before republish |
| WebSearch-based audit overstates support | **Active** — 7 reports on disk reflect this | Mark them as method-tagged unreliable; re-audit with direct WebFetch |
| Subagents lose WebFetch capability | Possible recurrence | The verification workflow must run from the main conversation or from a CI job that has live network egress + an LLM-callable verifier |
| Stale brief drift | Mitigated | Monthly cron + `find-stale-briefs.py` surface backlog |
| Cross-jurisdiction contamination in non-regional sections | Mitigated | Validator rule 7 catches it; section IDs starting `coalition-` or `regional-` get the looser scope rule |

---

## Pointer to prior state

Every brief's history is preserved in git. To inspect Carbondale's
trajectory specifically:

```bash
git log --oneline -- data/jurisdiction-briefs/0812045.json
git log --oneline -- data/jurisdiction-briefs/_verified/0812045.json
```

The append-only decisions log (`data/jurisdiction-briefs/_decisions.md`)
captures every option the project owner picked along the way, with
downstream effects. Read it before changing scope or methodology.

---

## Methodology audit findings (2026-06-12)

Scope reviewed:

- `scripts/validate-jurisdiction-briefs.py`
- `js/indibuild-gate.js`
- `scripts/build-codex-audit-package.py`
- `scripts/verify-brief-sources.py`
- `data/jurisdiction-briefs/README.md`

Findings:

- **Fixed inline - stale or skeletal verification reports could pass the publish gate.** The validator already required `audit_method` to contain `direct WebFetch` or `direct URL fetch` and required non-empty `supporting_quote` values for `supported` rows, but it did not verify that the report covered every current cited `(section, paragraph, source)` pair in the brief. A stale report with no blocking rows could therefore miss a newly added cite-pair. Fixed in `scripts/validate-jurisdiction-briefs.py:214` by deriving expected cite-pairs from the live brief and rejecting reports with missing pairs.
- **Fixed inline - invalid verdict strings were not rejected.** Rule 8 blocked only `unsupported` and `inaccessible`, so a typo such as `supportedd` would not be caught as a blocking row. Fixed in `scripts/validate-jurisdiction-briefs.py:239` by requiring verdicts to be exactly one of `supported`, `partial`, `unsupported`, or `inaccessible`.
- **Fixed inline - quarantine heuristic lagged validator wording.** The validator accepts either `direct WebFetch` or `direct URL fetch`, but `scripts/build-codex-audit-package.py:64` trusted only `direct WebFetch`. Fixed so direct URL fetch reports are treated consistently with the validator.
- **No code change - password gate threat model is documented honestly.** `js/indibuild-gate.js:1` documents the gate as a temporary bridge until Cloudflare Access, and `js/indibuild-gate.js:14` explicitly says it is security through obscurity, bypassable via DevTools/sessionStorage, and suitable only for casual visitors. This matches the 2026-06-12 decision to keep plain JSON and UI gating.
- **No code change - verification-plan enumeration covers current cite-pair shape.** `scripts/verify-brief-sources.py:54` walks every paragraph and emits one row for each source id in `cites`; it also emits `needs_source` rows when an unsourced paragraph is explicitly flagged. The validator already catches malformed or missing cites before publish.
- **No code change - README blocks WebSearch substitution.** `data/jurisdiction-briefs/README.md:77` documents that the JSON is plain and the password gate is UI-level. `data/jurisdiction-briefs/README.md:96` requires WebFetch first, verbatim quotes, and a verification report before publish; `data/jurisdiction-briefs/README.md:111` states that WebSearch is not an acceptable substitute.

Issues filed: none. The actionable gaps found in this pass were small enough to fix inline.
