# `scripts/audit/source-lines-ratchet.mjs`

source-lines-ratchet.mjs
Rendered check for the standing rule "every figure carries a linked, dated
public source".

Each public page is loaded in Chromium. For every visible figure ($ amount,
percentage, or number with thousands separators) the check looks for a
source link -- an outside URL, or the site's own /data or /docs copy -- in
the same card, section or table wrapper (or the line right after it), and
for a date in that link's text. A figure with no such link counts as "unsourced"; a figure with a link
but no date counts as "undated".

Today's misses are recorded per page in source-lines-baseline.json. The
check fails only when a page, or any card or section on it, shows MORE
unsourced or undated figures than its baseline, so new pages and cards must arrive sourced while the existing
backlog is worked down. A page, card or section missing from the baseline has
a baseline of 0 and no slack. Pages are read after network idle so cards
that load late are counted the same way on every run.

Exemptions: put data-no-source="definition|input|estimate" on an element
(or an ancestor) whose numbers are definitions ("30% of income"), form
inputs, or the site's own labelled estimates.

Usage:
  AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/source-lines-ratchet.mjs
  ... --update     rewrite the baseline from this run (after a fix lowers it)
  ... page.html    check only the named pages

_No documented symbols — module has a file-header comment only._
