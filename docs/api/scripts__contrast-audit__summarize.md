# `scripts/contrast-audit/summarize.js`

scripts/contrast-audit/summarize.js
Builds the per-page table of contrast-audit.yml's report from the JSON
reports scripts/contrast-audit/run.js writes, one per page.

Usage:
  node scripts/contrast-audit/summarize.js <reports-dir> <pages-file>

<pages-file> lists one page per line (the workflow's discovered pages).
Prints the markdown table + summary to stdout, and "key=value" counts to
the file named by $GITHUB_OUTPUT when set.

Every page lands in exactly one of four states, read from its report and
never from run.js's exit code alone:
  ✅ Pass         scanned, no violations
  ❌ Fail         scanned, N violations (the count is totals.violations;
                  the table used to read a .summary key that does not exist
                  at the top level, so every failing page showed 0)
  ⚠️ Not scanned  the page errored, or no report was written. This used to
                  print as "✅ Pass | 0": run.js swallowed the error and
                  exited 0.
  ↪️ Redirect     a meta-refresh page; its target is audited on its own row

_No documented symbols — module has a file-header comment only._
