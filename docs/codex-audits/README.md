# Codex audit packages — jurisdictional briefs

One self-contained markdown file per quarantined brief. Each package
walks a code-review agent through the source-first verification +
rewrite workflow for that single brief, with the brief content
inlined, the verification plan tabled, the exact WebFetch prompts
ready to copy, the verification report schema, the decision rules,
and the validator + commit steps.

The packages are produced by
[`scripts/build-codex-audit-package.py`](../../scripts/build-codex-audit-package.py)
and can be regenerated at any time.

## Required reading before starting any package

1. [`docs/JURISDICTION-BRIEFS-HANDOFF.md`](../JURISDICTION-BRIEFS-HANDOFF.md)
   — the full incident write-up, per-brief status snapshot, and risk
   register.
2. [`data/jurisdiction-briefs/README.md`](../../data/jurisdiction-briefs/README.md)
   — the schema, curation rules, scope rules, and the mandatory
   source-first authoring + verification gate.
3. [`data/jurisdiction-briefs/_verified/0812045.json`](../../data/jurisdiction-briefs/_verified/0812045.json)
   — the gold-standard example: Carbondale's post-rewrite report,
   every cite-pair backed by a verbatim WebFetch quote.

## Packages

| GEOID | Jurisdiction | Cite-pairs to verify |
|---|---|---|
| [`0803455`](0803455.md) | City of Aspen | 25 |
| [`08045`](08045.md) | Garfield County | 22 |
| [`08097`](08097.md) | Pitkin County | 25 |
| [`0816000`](0816000.md) | City of Colorado Springs | 27 |
| [`0817375`](0817375.md) | City of Cortez | 26 |
| [`0820000`](0820000.md) | City of Denver | 37 |
| [`0827425`](0827425.md) | City of Fort Collins | 33 |
| [`0830780`](0830780.md) | City of Glenwood Springs | 30 |
| [`0864255`](0864255.md) | City of Rifle | 21 |
| [`0867280`](0867280.md) | City of Salida | 27 |

Total: **273 cite-pairs across 10 briefs.** Carbondale's already-clean
brief isn't in this list because it was audited via direct WebFetch on
2026-06-12 (commit `b92a7a0b`).

## Workflow at a glance

For each package:

1. WebFetch every URL in the audit plan with the prompt block from
   the row's detail section.
2. Record a verdict per row in
   `data/jurisdiction-briefs/_verified/<geoid>.json` (the verification
   report). `audit_method` MUST contain the literal phrase "direct
   WebFetch" so the next reviewer can tell the report is reliable.
3. For any row that comes back `unsupported` or `inaccessible`:
   - **Best:** replace the URL with one that does support the claim,
     re-verifying via WebFetch.
   - **Acceptable:** rewrite the brief sentence to match what the
     current source actually says.
   - **Acceptable:** drop the paragraph (and the source if orphaned).
   - **Forbidden:** keep the unsupported claim and republish.
4. Run `python3 scripts/validate-jurisdiction-briefs.py` — must exit 0.
5. Set `published: true` on the brief JSON.
6. Commit with the suggested message format inside the package.
7. Update the per-brief status table in
   [`docs/JURISDICTION-BRIEFS-HANDOFF.md`](../JURISDICTION-BRIEFS-HANDOFF.md)
   so the next reviewer sees a green row.

## Regenerating packages

If a brief is edited (e.g., a curator adds a new section), regenerate
its package so the audit plan reflects the current state:

```bash
# One specific brief
python3 scripts/build-codex-audit-package.py --geoid 0820000 --force

# All quarantined briefs (default heuristic skips clean reports)
python3 scripts/build-codex-audit-package.py --all-quarantined --force
```
