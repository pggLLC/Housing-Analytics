# Root File Cleanup — Audit Summary

**Date:** 2026-03  
**Branch:** `copilot/review-implementation-script`

This document records the audit of root-level guide, checklist, and process
files against the richer `docs/` folder.

---

## Files Reviewed

### `HOUSING-NEEDS-ASSESSMENT-USER-GUIDE.md`

**Decision: Keep at root**

This is a comprehensive, tool-specific user guide covering the HNA page
section-by-section. It is not duplicated in `docs/` and contains useful
operational detail (quick-start, section walkthroughs, troubleshooting, FAQ)
that would not be appropriate inside the technical `docs/` folder.

---

### `SETUP-DATA-SOURCES.md`

**Decision: Keep redirect stub at root**

The file already contains a notice:
> "📁 This file has moved. The canonical version is at
> `docs/SETUP-DATA-SOURCES.md`. This stub is retained at the root for
> backwards compatibility."

The canonical setup guide is at `docs/SETUP-DATA-SOURCES.md`. The root stub
exists to preserve any existing bookmarks or links.

---

### `TEST-CHECKLIST.md`

**Decision: Keep at root**

This is a detailed manual smoke-test checklist for deployment verification.
While `docs/TESTING_GUIDE.md` covers broader testing, `TEST-CHECKLIST.md` is
a concise, page-by-page QA checklist intended for quick use during deployment.
It is complementary, not redundant.

---

### `DATA-MANIFEST.json`

**Decision: Keep at root**

This is a comprehensive data-source inventory with per-source metadata
(file path, source URL, update method, status, fallback rules). It is distinct
from `data/manifest.json`, which is an auto-generated file inventory. The
root `DATA-MANIFEST.json` is a maintained documentation artifact describing
the *sources* of data, not the files themselves.

---

### `CHANGELOG.md`

**Decision: Keep at root**

Standard location for project changelogs. No duplication in `docs/`.

---

### `README.md`

**Decision: Keep at root**

Standard project README. Required at repository root.

---

## Summary

| File | Decision | Reason |
|------|----------|--------|
| `HOUSING-NEEDS-ASSESSMENT-USER-GUIDE.md` | ✅ Kept | Unique tool-specific guide, not duplicated in docs/ |
| `SETUP-DATA-SOURCES.md` | ✅ Kept (stub) | Redirect stub for backwards compatibility |
| `TEST-CHECKLIST.md` | ✅ Kept | Concise deployment smoke-test checklist |
| `DATA-MANIFEST.json` | ✅ Kept | Data-source inventory distinct from data/manifest.json |
| `CHANGELOG.md` | ✅ Kept | Standard changelog location |
| `README.md` | ✅ Kept | Required README |

No root files were moved to `_audit/` because none were determined to be
clearly redundant or superseded. Earlier cleanup (prior PR) already moved the
truly redundant root files (`CHANGED_FILES.txt`, `DEPLOYMENT-GUIDE.txt`,
`DATA-SOURCES.md`) to `_audit/`.

---

## Related

- Earlier quarantine actions: [`docs/repo-audit-summary.md`](repo-audit-summary.md)
- Architecture docs: [`docs/data-architecture.md`](data-architecture.md)
