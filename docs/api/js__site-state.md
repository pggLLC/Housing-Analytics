# `js/site-state.js`

site-state.js — Shared site state manager for COHO Analytics

Provides persistent county / geography / PMA context across pages via
localStorage, with a subscribe/event pattern for reactive updates and
automatic DOM wiring through [data-state-key] attributes.

Usage:
  SiteState.setCounty('08013', 'Boulder County');
  const { fips, name } = SiteState.getCounty();
  SiteState.subscribe('county', ({ fips, name }) => { … });

See docs/SITE_STATE_USAGE.md for full documentation.

_No documented symbols — module has a file-header comment only._
