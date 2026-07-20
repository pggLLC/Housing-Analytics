# `scripts/audit/repo-link-audit.mjs`

Repo-wide link audit.

Scans text-like files across the repository for:
  - external http(s) URLs
  - local HTML href/src/action/poster attributes
  - Markdown links/images

The built-in url-health sweep intentionally monitors a curated subset.
This script is broader and audit-oriented: it records sources, classifies
template/dev/vendor noise, validates local file targets, and can probe
unique external URLs with HEAD/GET fallback.

_No documented symbols — module has a file-header comment only._
