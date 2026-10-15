(function () {
  'use strict';

  function fmtInt(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString();
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function initResumeStrip() {
    if (typeof window.WorkflowState === 'undefined') return;
    var proj = WorkflowState.getActiveProject();
    if (!proj) return;
    var jur = WorkflowState.getStep('jurisdiction');
    if (!jur || !jur.name) return;

    var progress = WorkflowState.getProgress();
    var strip  = document.getElementById('homeResumeStrip');
    var jurEl  = document.getElementById('homeResumeJurisdiction');
    var stepEl = document.getElementById('homeResumeStep');
    var ctaEl  = document.getElementById('homeResumeCta');
    if (!strip) return;

    if (jurEl) jurEl.textContent = jur.name;
    // F57 follow-up: WorkflowState's nextStepNum is 1..totalCount for
    // trackable steps (jurisdiction…deal). The canonical user-facing
    // counter adds 1 for the Opportunity Finder, which the progress bar
    // shows as step 1 but WorkflowState doesn't track (it's a discovery
    // step). Derive the denominator from progress.totalCount so this
    // strip stays in sync with STEP_META if the tracked-step list ever
    // changes — F57 originally hardcoded 6 here, which we missed in the
    // same sweep that fixed workflow-next-action.js.
    var totalSteps = (progress.totalCount || 5) + 1;
    if (stepEl) stepEl.textContent = 'Step ' + (progress.nextStepNum + 1) + ' of ' + totalSteps + ' — ' + progress.nextStepLabel;
    if (ctaEl) ctaEl.href = progress.nextStepUrl;
    strip.hidden = false;

    var newBtn = document.getElementById('homeResumeNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        WorkflowState.newProject();
        window.location.href = 'select-jurisdiction.html';
      });
    }
  }

  function loadSnapshot() {
    var DS = window.DataService;
    if (!DS) return;

    // Renter homes that are affordable AND available to each income group,
    // from HUD CHAS Tables 15C, 14B and 7 (scripts/hna/build_chas_affordable_available.py).
    // A cheap home rented by a higher-income household is not available to
    // anyone in the group, so it does not count. Tiers are cumulative
    // (≤50% includes ≤30%). A missing value stays '—', never a 0.
    DS.getJSON(DS.baseData('hna/chas_affordable_available.json'))
      .then(function (data) {
        var tiers = data && data.statewide && data.statewide.tiers;
        if (!tiers) return;
        var count = function (v) {
          return (typeof v === 'number' && isFinite(v) && v >= 0) ? fmtInt(v) : '—';
        };
        var vintage = (data.meta && data.meta.vintage) || '—';
        ['30', '50'].forEach(function (tier) {
          var t = tiers[tier];
          if (!t) return;
          var per100 = t.homes_per_100_households;
          setText('snapGap' + tier, count(t.homes_short));
          setText('snapGap' + tier + 'Households', count(t.renter_households));
          setText('snapGap' + tier + 'Homes', count(t.affordable_available_homes));
          setText('snapGap' + tier + 'Per100', (typeof per100 === 'number' && isFinite(per100)) ? String(Math.round(per100)) : '—');
          setText('snapGapVintage' + tier, vintage);
        });
        if (data.meta && data.meta.vintage) setText('snapVintage', 'Shortfall: HUD CHAS ' + data.meta.vintage);
      })
      .catch(function () {});

    DS.getJSON(DS.baseData('hna/summary/08.json'))
      .then(function (data) {
        var profile = data && data.acsProfile;
        var households = profile && profile.DP02_0001E;
        setText('snapHouseholds', fmtInt(Number(households)));
      })
      .catch(function () {});

    DS.getJSON(DS.baseData('hna/projections/08.json'))
      .then(function (data) {
        var need = data && data.housing_need && data.housing_need.incremental_units_needed_dola;
        if (Array.isArray(need) && need.length) {
          var last = Number(need[need.length - 1]);
          if (Number.isFinite(last)) setText('snapUnits20', fmtInt(Math.round(last)));
        }
      })
      .catch(function () {});

    // Precomputed from the tract-level ACS and CHFA files by
    // scripts/build-home-snapshot.mjs. The homepage needs three numbers from
    // those multi-megabyte sources, so the refresh workflows derive them once
    // instead of making every visitor download and scan both source files.
    DS.getJSON(DS.baseData('home-snapshot.json'))
      .then(function (data) {
        var values = data && data.values || {};
        // Number(null) is 0 and finite, so a missing value would render as
        // "0.0%" or "0" (#1480). An absent field stays NaN and leaves "—".
        function measured(v) { return v == null || v === '' ? NaN : Number(v); }
        var burdenPct = measured(values.renter_cost_burden_pct);
        var propertyCount = Number(values.lihtc_property_count);
        var avgPerYr = Number(values.average_lihtc_units_per_year);
        if (Number.isFinite(burdenPct) && burdenPct > 0) setText('snapCostBurden', burdenPct.toFixed(1) + '%');
        if (Number.isFinite(propertyCount) && propertyCount > 0) setText('snapLihtcCount', fmtInt(propertyCount));
        var renterGrowth = Number(values.annual_le60_renter_household_growth);
        var newConst = Number(values.average_lihtc_new_construction_units_per_year);
        var preservation = measured(values.average_lihtc_preservation_units_per_year);
        var coverage = Number(values.lihtc_new_construction_coverage_of_le60_renter_growth);
        if (Number.isFinite(avgPerYr) && avgPerYr > 0) setText('snapAvgUnitsPerYr', fmtInt(avgPerYr));

        // #1822: pace of NEW rental supply against projected ≤60%-AMI RENTER
        // household growth, as a coverage ratio. Every number comes from the
        // snapshot (basis in deficit_growth_basis). No fallback: without the
        // basis the card stays "—" rather than showing a number nothing
        // supports — until 2026-09-22 this was a literal 6,500.
        if (Number.isFinite(renterGrowth) && renterGrowth > 0 && Number.isFinite(newConst) && newConst > 0 && Number.isFinite(coverage) && coverage > 0) {
          setText('snapDeficitGrowth', Math.round(coverage * 100) + '% covered');
          setText('snapNewConstPerYr', fmtInt(newConst));
          setText('snapRenterGrowthPerYr', fmtInt(renterGrowth));
          if (Number.isFinite(preservation) && preservation >= 0) setText('snapPreservationPerYr', fmtInt(preservation));
        }
      })
      .catch(function () {});
  }

  function init() {
    initResumeStrip();
    loadSnapshot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
