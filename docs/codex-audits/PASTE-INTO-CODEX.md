# Paste this into Codex

The single prompt below kicks off the full audit + repair + republish
of all 10 quarantined jurisdictional briefs. Copy everything between
the `---` fences and paste it into a fresh Codex (or Claude Code,
Cursor, etc.) session that already has this repo as its working
directory.

---

Audit and repair the 10 quarantined jurisdictional briefs in this repo.

Background: on 2026-06-12 we discovered the original briefs had fabricated source-to-claim mappings (a brief cited an article that didn't contain what was claimed). Carbondale was repaired with direct WebFetch verification — see data/jurisdiction-briefs/_verified/0812045.json for the gold-standard format. The other 10 briefs are quarantined (published: false).

Per-brief audit packages are at docs/codex-audits/<geoid>.md. Each package has the brief content inlined, every cite-pair tabled, the exact WebFetch prompt to use, the verification report schema, and the commit steps.

Work through these 10 GEOIDs in order from smallest cite-count to largest:
  0864255, 08045, 0803455, 08097, 0817375, 0816000, 0867280, 0830780, 0827425, 0820000

For each one:
1. Open docs/codex-audits/<geoid>.md.
2. WebFetch every URL in the plan with the prompt block from each row's detail section. NEVER use WebSearch instead — it gives false positives. The Carbondale brief went from 75% supported under WebSearch to 24% under direct WebFetch.
3. Write the verification report to data/jurisdiction-briefs/_verified/<geoid>.json with audit_method containing the literal string "direct WebFetch".
4. For any unsupported or inaccessible rows: either fix the brief sentence to match what the source actually says, swap the URL for one that DOES support the claim (re-verifying via WebFetch), or drop the paragraph and its orphaned sources. Never keep an unsupported claim.
5. Run: python3 scripts/validate-jurisdiction-briefs.py — must exit 0.
6. Set published: true on the brief.
7. Commit and push with message: "audit(briefs): <jurisdiction> — direct-WebFetch verification".
8. Update the brief's row in docs/JURISDICTION-BRIEFS-HANDOFF.md to show ✓ published and "direct WebFetch" method.

Stop and ask if: the validator fails for a reason not covered in the package, more than 50% of a brief's cite-pairs come back unsupported, or you'd need to invent a source to make a claim work.

---

That's it. After Codex finishes, verify with:

```bash
python3 scripts/validate-jurisdiction-briefs.py
grep -l "direct WebFetch" data/jurisdiction-briefs/_verified/*.json
```

You should see all 11 briefs pass the validator, and all 11
verification reports should match `direct WebFetch` (Carbondale was
already at this state going in).
