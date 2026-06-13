# Claude QA/QC Prompt For Link Audit Fixes

Copy this into Claude when you want an independent QA/QC pass.

```text
You are doing a QA/QC review of the Housing Analytics repo after a repo-wide link audit stabilization pass.

Repository context:
- Main audit report: docs/audits/REPO-LINK-AUDIT-2026-06-13.md
- Machine-readable audit data: data/reports/repo-link-audit.json
- Audit runner: scripts/audit/repo-link-audit.mjs
- Live GitHub Pages fallback URL: https://pggllc.github.io/Housing-Analytics/
- Custom domain target: cohoanalytics.com, but do not treat it as canonical unless key pages return HTTP 200.

Your job:
1. Review the git diff for changes that affect URLs, link auditing, sitemap behavior, deployment docs, domain/security docs, and QA docs.
2. Verify that fixes preserve or improve usable links. Flag any change that replaces a working public URL with a dead, less authoritative, or unverified URL.
3. Confirm that the audit script excludes generated audit Markdown and classifies non-browser links appropriately:
   - template/example URLs
   - localhost/dev URLs
   - test fixture domains
   - authenticated settings pages
   - POST-only API endpoints
   - API-key or parameterized machine endpoints
   - bot-protected or rate-limited pages
4. Inspect data/reports/repo-link-audit.json and summarize:
   - local missing link count
   - external ok/auth/skipped/failure counts
   - top remaining failure domains
   - any surprising source files that should not contain external links
5. For jurisdictional brief source links, recommend replacements only when the replacement is:
   - the same official document at a new URL,
   - an official agency page that supersedes the dead page,
   - or a more authoritative government/agency source.
   Do not recommend generic search pages as fixes.
6. Review docs/security/GODADDY-TO-CLOUDFLARE-DOMAIN-MIGRATION.md for operational safety:
   - no missing email/DNS caveats,
   - no premature HSTS advice,
   - no instruction that would break GitHub Pages,
   - clear rollback path.
7. Run or request these checks if available:
   - node scripts/audit/repo-link-audit.mjs --dry-run
   - npm run audit:repo-links:probe
   - node tools/check-links.mjs
   - node --check scripts/audit/repo-link-audit.mjs
   - git diff --check

Output format:
- Findings first, ordered by severity.
- Include exact file paths and line numbers where possible.
- Separate true bugs from residual external-link rot.
- End with a short "Approve / Do not approve" recommendation.
```
