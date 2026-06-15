# `js/components/methodology-stamp.js`

methodology-stamp.js — F250 (P2-7): Methodology version stamp helper.

Every score the site publishes should carry a methodology version
(e.g. "v2.4-2026-04-22") so a user who saved a ranking last month
can see if and how it would change today. This module renders a
compact pill next to scores + a tooltip with the most recent change.

Public API
----------
  MethodologyStamp.init() → Promise resolving when version data loads
  MethodologyStamp.versionFor(moduleKey) → string ("v2.4-2026-04-22") or null
  MethodologyStamp.changeLogFor(moduleKey) → array of {version, what_changed}
  MethodologyStamp.render(moduleKey, options) → HTML string for an inline pill

Module keys:
  opportunity_finder, housing_needs_scorecard, ami_gap,
  market_capture_advantage, pma_site_score, deal_calculator,
  pab_allocation

Usage
-----
  await MethodologyStamp.init();
  var html = MethodologyStamp.render('opportunity_finder', { inline: true });
  document.getElementById('ofScoreLabel').insertAdjacentHTML('beforeend', ' ' + html);

_No documented symbols — module has a file-header comment only._
