# `js/whitepaper/ripeness.js`

ripeness.js — "Ready to build" on the gated pipeline page: two lists, one of
communities (every pipeline place, kept as it is) and one of specific sites,
each row saying in one line why it sits where it does.

The data, data/ripeness.json, is built by the private backend at deploy time:
sites screened from data/market/development-activity.json for the pipeline's
places, plus readiness cards written from each site dossier. It is never in
this repository, so on any other copy of the page the section says where the
list lives instead of showing an empty one.

Suggested order: a community's best site first (ripe, ripening, a site on file
with no readiness sheet yet, a site studied and not yet ready, no site), then
the pipeline score. "My order" is the owner's own: rows moved, pinned or
selected are saved on the site (/api/ready-order) and in this browser.

Lives in js/whitepaper/ because the gated bundle copies that folder and the
public build excludes it. window.Ripeness in the browser; module.exports in Node.

_No documented symbols — module has a file-header comment only._
