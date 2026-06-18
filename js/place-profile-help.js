/**
 * js/place-profile-help.js — adds a plain-language "What do these AMI tiers mean?"
 * explainer to place-profile pages.
 *
 * Loaded on demand by navigation.js only on place profiles. Idempotent: skips if the
 * static explainer (.place-explain, baked into places/_template.html) is already present,
 * so it never double-renders once pages are regenerated from the updated template.
 */
(function () {
  'use strict';

  var tierRow = document.getElementById('psTier100p');
  if (!tierRow) return;                                   // not a place profile
  var card = tierRow.closest('.place-card');
  if (!card || card.querySelector('.place-explain')) return; // already explained

  if (!document.getElementById('place-explain-styles')) {
    var st = document.createElement('style');
    st.id = 'place-explain-styles';
    st.textContent =
      '.place-explain{margin-top:.75rem;font-size:.82rem;color:var(--muted)}' +
      '.place-explain summary{cursor:pointer;color:var(--accent,#096e65);font-weight:600;font-size:.85rem}' +
      '.place-explain p{margin:.5rem 0;line-height:1.5}' +
      '.place-explain ul{margin:.4rem 0;padding-left:1.1rem}' +
      '.place-explain li{margin:.15rem 0}';
    document.head.appendChild(st);
  }

  var d = document.createElement('details');
  d.className = 'place-explain';
  d.innerHTML =
    '<summary>What do these AMI tiers mean?</summary>' +
    '<p><strong>AMI = Area Median Income</strong> — HUD’s annual median household income for the area. ' +
    'Affordable-housing programs set eligibility as a share of AMI, so renter households are grouped into income bands:</p>' +
    '<ul>' +
    '<li><strong>≤30% AMI</strong> — extremely low income</li>' +
    '<li><strong>31-50% AMI</strong> — very low income</li>' +
    '<li><strong>51-80% AMI</strong> — low income (the typical LIHTC band)</li>' +
    '<li><strong>81-100% AMI</strong> — near the median</li>' +
    '<li><strong>&gt;100% AMI</strong> — above the median</li>' +
    '</ul>' +
    '<p>Counts come from HUD’s CHAS file (2018-2022), apportioned to this place from its underlying ' +
    'census tracts (see Methodology). A <strong>0</strong> means CHAS attributes essentially no renter ' +
    'households in that band to this place — common for very small towns.</p>';
  card.appendChild(d);
})();
