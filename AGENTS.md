# AGENTS.md — Housing-Analytics

Instructions for AI coding agents (OpenAI Codex, GitHub Copilot coding agent, Claude) working in this repo. Both Codex and Copilot read this file automatically; `.github/copilot-instructions.md` (the 18 governance rules) remains authoritative and this file defers to it on data-integrity matters.

## What this repo is
A public-interest **static site** for Colorado affordable-housing data, deployed on **GitHub Pages** (custom domain `cohoanalytics.com` via CNAME). No bundler — ~257 client JS files attach to `window.*` via hand-ordered `<script>` tags. ~257 build/fetch scripts (`.mjs` + Python), ~1,640 data files, 67 GitHub Actions workflows (~55 crons that fetch data and commit it back).

## Agent pipeline (stay in your lane)
- **Claude** — strategic planning + QA. Owns the remediation plan; reviews every agent PR against it before merge.
- **Codex** — implementation. Executes the phased remediation script; one PR per phase.
- **Copilot** — review. Reviews Codex PRs (automated first pass); also honors this file.

**No two agents edit the same branch/files in the same window.** Implementation happens on branches, never on `main`.

## Hard constraints (do not violate)
1. **Keep the `salida2026` developer gate.** It is *intentional* UI gating for `/developer*` pages pending Cloudflare Access (see `js/developer-gate.js`, `docs/codex-audits/PASTE-INTO-CODEX.md`). Do **not** delete the gate or its hash. You may remove the *plaintext password from comments/docs* — that is the only change allowed here.
2. **Obey `.github/copilot-instructions.md` (18 rules).** In particular: Colorado county FIPS are 5-digit strings (`"08001"`); any statewide file carries all **64** counties; required numeric fields are never null; `baseYear`/`pyramidYear` = `2024`.
3. **On ANY change to `data/` or the file inventory:** run `python scripts/rebuild_manifest.py` **and** `node scripts/validate-schemas.js` before committing, or CI fails. This is not optional — Sprint 3 (data architecture) touches data heavily.
4. **Branch + PR only.** Never push to `main`. Never merge your own PR. Open the PR and stop for human/Claude review.
5. **Prefer relocation over deletion.** Before moving or removing any file (esp. under `docs/` or `data/`), `grep` the repo **including `.github/workflows/`** for references — several workflows read from `docs/` (`docs-sync.yml`, the audit pipeline). Don't break a workflow.

## Commands
```bash
# local preview (static, like Pages)
npx http-server . -p 8765 --silent      # or: python3 -m http.server 8765 --bind 127.0.0.1
# tests
npm test                                 # JS suite (test/)
pytest tests/ -v                         # Python suite — NOTE: add `jsonschema` to the env or the schema test silently skips
node scripts/validate-schemas.js         # schema validation (run after any data change)
python scripts/rebuild_manifest.py       # regenerate data/manifest.json (run after any data change)
```

## Verified inventory baseline (2026-08-01 — use these; do not re-derive or trust stale doc counts)
- Pages: **53** top-level HTML, **553** total `.html` repo-wide. (README's "38" is wrong — fix it.)
- Workflows: **67**. Client JS under `js/`: **257** (252 excl. `vendor/`). `docs/` markdown: **473**.
- Geographies (`data/hna/geo-config.json`): **547** = 64 counties / 273 places / 210 CDPs.
- CHFA LIHTC features (`data/chfa-lihtc.json`): **926** (the CHANGELOG's 716 is stale — update it).
- Working tree **353 MB**; true `.git` history **132 MB** / 5,591 commits (NOT the ~46 MB a shallow clone reports).
- `data/hna/place-chas.json` currently fails `schemas/place-chas.schema.json` with **482 errors** — all `acs_anchor` + `tenure_anchor` rejected by `PlaceChasRecord` (`additionalProperties:false`). Fix = add those two keys to the record schema (do **not** touch the open `meta` subschema).

## Full remediation sequence
See the merged remediation plan (in the project brief / `MERGED-PLAN.md`). Order: P0 quick wins → P1 CSP headers + trust/docs track → Sprint 3A geometry simplification → **hold Sprint 3B (R2 migration + history purge) until the data-committing workflows are converted** → P3 maintainability. Every phase ends in a commit + PR; nothing merges without review.
