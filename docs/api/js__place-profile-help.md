# `js/place-profile-help.js`

js/place-profile-help.js — adds a plain-language "What do these AMI tiers mean?"
explainer to place-profile pages.

Loaded on demand by navigation.js only on place profiles. Idempotent: skips if the
static explainer (.place-explain, baked into places/_template.html) is already present,
so it never double-renders once pages are regenerated from the updated template.

_No documented symbols — module has a file-header comment only._
