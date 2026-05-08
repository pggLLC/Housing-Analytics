# External Reference Documents

Mirror of upstream data publishers' technical documentation, kept in-repo
so that future debugging doesn't depend on those publishers' availability.

## Why this directory exists

During the 2026-05-08 CHAS audit, the parsing bug investigation was delayed
~1 hour because HUD's CDN gates direct downloads of the CHAS data dictionary
behind a WAF challenge — returns HTTP 202 with empty body for non-browser
User-Agents (urllib, curl default, etc.). The dictionary was initially
sourced from Wayback Machine, but follow-up QA verified that **HUD direct
fetch works fine with a browser User-Agent** (`Mozilla/5.0 ... Chrome/...`).

Wayback was a dead end — not because Wayback is bad, but because we never
needed it. The fetcher in `scripts/audit/refresh-external-references.mjs`
now pulls directly from HUD with a browser UA, eliminating the third-party
dependency.

## Refresh workflow

```bash
# Verify all mirrored docs match upstream + pinned hashes (CI default)
node scripts/audit/refresh-external-references.mjs --check

# Pull fresh copies + bump provenance (when upstream legitimately updates)
node scripts/audit/refresh-external-references.mjs --refresh

# Initialize provenance.json after first download (one-time)
node scripts/audit/refresh-external-references.mjs --pin
```

The weekly `external-references-check.yml` workflow runs `--check` and
opens a tracking issue when upstream drifts from the pinned SHA-256.

## Provenance

Each mirrored file has a sibling `<file>.provenance.json` recording:
- Source URL (canonical, not Wayback)
- Retrieval timestamp (UTC ISO-8601)
- SHA-256 of pinned content
- Size in bytes
- Fetch method (always `https + browser User-Agent` for HUD)
- Notes on why this doc is mirrored

Drift detection compares (a) local copy SHA against pinned and (b) live
upstream SHA against pinned. Both must match every weekly check. When
upstream legitimately ships a corrected version, run `--refresh` to
update both the file and its provenance.json.

## What lives here

| File | Provenance file | Source URL |
|---|---|---|
| `HUD-CHAS-data-dictionary-2018-2022.xlsx` | `…provenance.json` | https://www.huduser.gov/portal/datasets/cp/CHAS-data-dictionary-18-22.xlsx |

## Adding a new reference

When you add a new external data source pipeline, also mirror its primary
reference doc here:

1. Download the canonical version (data dictionary, methodology PDF, etc.)
   using a browser UA if behind a WAF.
2. Save with a name that includes the publisher + vintage.
3. Add an entry to `TRACKED` in `scripts/audit/refresh-external-references.mjs`
   with the source URL and notes on why it's mirrored.
4. Run `node scripts/audit/refresh-external-references.mjs --pin` to write
   the initial provenance.json.
5. Add a row to the table above.

## Why mirror at all (vs always fetching live)?

1. **Debugging speed.** When a parser breaks at 11pm and the publisher's
   CDN is slow, having the dict already on disk shaves minutes.
2. **WAF resilience.** HUD's WAF behavior could tighten further; having
   a known-good copy means we don't lose access to the document overnight.
3. **Audit trail.** SHA-256 + retrieval timestamp creates a verifiable
   chain of custody — important when a parsing bug forensic investigation
   asks "what version of the dictionary did this commit assume?"

## Licensing

These mirrors are copies of public-domain US Government documents (HUD,
Census Bureau, BLS, FRED). No license-tracking required, but if you mirror
a non-government source, capture its license alongside the file.
