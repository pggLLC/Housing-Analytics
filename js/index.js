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

    DS.getJSON(DS.baseData('co_ami_gap_by_county.json'))
      .then(function (data) {
        var statewide = data && data.statewide;
        var gaps = statewide && statewide.gap_units_minus_households_le_ami_pct;
        if (!gaps) return;
        // We display magnitude of statewide deficit for readability on
        // homepage cards. County-file convention: units − households,
        // negative = deficit; clamp surpluses to 0 instead of abs().
        setText('snapGap30', fmtInt(Math.max(0, -(gaps['30'] || 0))));
        setText('snapGap60', fmtInt(Math.max(0, -(gaps['60'] || 0))));

        var vintage = data && data.meta && (data.meta.generated || data.meta.generated_at || data.meta.updated || '');
        if (vintage) {
          var date = String(vintage).slice(0, 10);
          setText('snapVintage', 'AMI gap data: ' + date);
        }
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
        var burdenPct = Number(values.renter_cost_burden_pct);
        var propertyCount = Number(values.lihtc_property_count);
        var avgPerYr = Number(values.average_lihtc_units_per_year);
        if (Number.isFinite(burdenPct)) setText('snapCostBurden', burdenPct.toFixed(1) + '%');
        if (Number.isFinite(propertyCount) && propertyCount > 0) setText('snapLihtcCount', fmtInt(propertyCount));
        var le60Growth = Number(values.annual_le60_household_growth);
        if (Number.isFinite(avgPerYr) && avgPerYr > 0) {
          setText('snapAvgUnitsPerYr', fmtInt(avgPerYr));

          // Annual deficit growth = projected new ≤60%-AMI households per
          // year − average LIHTC units awarded per year (CHFA award year —
          // the feed has no placed-in-service year). The
          // household-growth figure is derived in
          // scripts/build-home-snapshot.mjs (DOLA household growth × HUD
          // CHAS ≤60% share, all tenures; basis recorded in
          // snapshot.deficit_growth_basis). Until 2026-09-22 it was a
          // literal 6,500 here. No fallback: without the basis the card
          // stays "—" rather than showing a number nothing supports.
          if (Number.isFinite(le60Growth) && le60Growth > 0) {
            var deficitGrowth = Math.max(0, le60Growth - avgPerYr);
            setText('snapDeficitGrowth', '+' + fmtInt(deficitGrowth) + '/yr');
          }
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
