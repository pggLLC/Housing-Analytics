# `js/components/private-workspace.js`

private-workspace.js — reads the developer's private working files on the
gated site and answers "what do I know about this place?".

The five CSVs (network contacts, pipeline, signal log, anti-targets, outreach
templates) live in the owner's private workspace, never in this repository.
The gated deployment copies them to docs/developer-pipeline-prototype/; the
public build excludes that folder (scripts/build-public-site.mjs) and the
public-artifact guard fails on it. On any site without them every file reads
as unreachable and the pages say so, rather than showing an empty pipeline as
if it were a real one.

Nothing here feeds the jurisdiction report: these rows are shown only on the
gated working-tools screens, which do not print.

window.PrivateWorkspace in the browser; module.exports under Node (tests).

_No documented symbols — module has a file-header comment only._
