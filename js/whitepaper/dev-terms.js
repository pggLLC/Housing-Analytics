/**
 * dev-terms.js — plain definitions for the developer site's own words
 * (signal, ripeness, IOI, tiers), shown as tooltips on the first use of each
 * term on a page: <abbr data-glossary="signal">signal</abbr>. A tap opens one
 * on a phone. Definitions follow the rules the pages apply: signal strength
 * from the Pipeline method, ripeness from the dossier readiness cards, tiers
 * from Where to build.
 *
 * Loaded after js/components/inline-glossary.js, which shows the tooltips.
 * Lives in js/whitepaper/ because only the gated bundle ships it.
 */
(function (root) {
  'use strict';
  var TERMS = {
    'signal': 'A dated public event in a place that could open a deal: an RFP, land offered, a funding move, a new housing needs assessment or a council vote. Each is logged with its source link and a strength: weak, moderate or strong.',
    'strong signal': 'A signal that calls for action this week: an RFP closing within 60 days, land being offered now, or a direct invitation to partner. If more than 30% of signals are strong, the bar is set too low.',
    'moderate signal': 'A signal to act on within 30 to 90 days: a needs assessment draft due, an RFP cycle coming up, or a key staff change.',
    'weak signal': 'Interesting but not yet actionable, such as a rumor or a passing mention at a council meeting.',
    'signal log': 'Your dated list of every signal seen: place, what happened, source link, strength and the follow-up.',
    'ripeness': 'How close a specific site is to a tax credit application, judged in its site dossier on seven questions: need, a path to site control, firm entitlements, a deal that closes, local support, a funding window within 12 months, and hard blockers cleared.',
    'Ripe': 'The site dossier finds the site ready for an application now on the seven ripeness questions.',
    'Ripening': 'Getting close: the site dossier finds some of the seven ripeness questions still open, and names the one thing that would change the reading.',
    'Not yet': 'Studied in a site dossier and not ready: key ripeness questions, such as site control or entitlements, are unresolved.',
    'Site on file': 'A site from public program records (a Prop 123 land banking award or a tax credit application since 2023) with no dossier yet, so it has no ripeness reading.',
    'No open site': 'Every site on file in this place already has a developer on it.',
    'No site on file': 'No site for this place in public program records yet.',
    'IOI': 'Opportunity Index: a 0 to 100 score for each Colorado place from the Opportunity Finder, blending housing need, how recently the place won tax credits, basis boost eligibility, population and civic readiness, weighted by deal type. Places above about 60 enter the pipeline at Screen.',
    'anti-target': 'A place set aside on purpose, with the reason and a date to look again.',
    'tier': 'Where to build groups places by this page\'s score: Tier 1 Target at 70 or more (not low confidence), Tier 2 Promising at 50 to 69 (or 70+ with low confidence), Tier 3 Monitor at 35 to 49. Below 35 is left off.',
    'confidence': 'How much of your weight the score rests on: the share of the total weight on factors that have been checked. High = 80% or more, Medium = 50 to 79%, Low = under 50%. Not yet checked is left out of the score, never counted as zero.'
  };
  // The glossary may already have scanned the page (deferred scripts run once the
  // document is parsed), so decorate the explicit marks again now that these terms
  // are known. Only the marks: a second automatic scan would wrap a second use.
  if (root.InlineGlossary && root.InlineGlossary.define) {
    root.InlineGlossary.define(TERMS);
    if (root.document && root.InlineGlossary.decorateMarks) root.InlineGlossary.decorateMarks(root.document);
  }
  if (typeof module === 'object' && module.exports) module.exports = TERMS;
})(typeof self !== 'undefined' ? self : this);
