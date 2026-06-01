(function () {
  'use strict';

  function fmtCurrency(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return '$' + Number(n).toLocaleString();
  }

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
        // We display magnitude of statewide deficit for readability on homepage cards.
        setText('snapGap30', fmtInt(Math.abs(gaps['30'] || 0)));
        setText('snapGap60', fmtInt(Math.abs(gaps['60'] || 0)));

        var vintage = data && data.meta && (data.meta.generated || data.meta.generated_at || data.meta.updated || '');
        if (vintage) {
          var date = String(vintage).slice(0, 10);
          setText('snapVintage', 'AMI gap data: ' + date);
        }
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

    // Statewide renter cost burden — weighted average of tract-level
    // cost_burden_rate (0–1 fraction) by renter household count.
    // Source: data/market/acs_tract_metrics_co.json (ACS B25070 derived).
    DS.getJSON(DS.baseData('market/acs_tract_metrics_co.json'))
      .then(function (data) {
        var tracts = data && data.tracts;
        if (!Array.isArray(tracts)) return;
        var sum = 0, weight = 0;
        for (var i = 0; i < tracts.length; i++) {
          var t = tracts[i];
          var rh  = Number(t.renter_hh) || 0;
          var cbr = Number(t.cost_burden_rate) || 0;
          if (rh > 0 && cbr > 0) {
            sum    += cbr * rh;
            weight += rh;
          }
        }
        if (weight > 0) {
          // cost_burden_rate is stored 0–1; render as percentage.
          var pct = (sum / weight) * 100;
          setText('snapCostBurden', pct.toFixed(1) + '%');
        }
      })
      .catch(function () {});

    // Prefer the fresh CHFA cache (926 projects through 2025, refreshed daily
    // by CI). Fall back to the legacy HUD geojson snapshot (716 projects,
    // YR_PIS through ~2020) only if the CHFA file is unavailable. Inverted
    // priority in F7 (2026-05-26) — previously HUD was Tier 1, which meant
    // the landing-page snapshot consistently undercounted CO LIHTC stock.
    DS.getJSON(DS.baseData('chfa-lihtc.json'))
      .then(function (data) {
        var feats = (data && data.features) ? data.features : (Array.isArray(data) ? data : []);
        if (feats.length) setText('snapLihtcCount', fmtInt(feats.length));

        // F108 — Average LIHTC units / year over the last 10 placed-in-service
        // years. Uses LI_UNITS when available, falls back to N_UNITS.
        var thisYear = new Date().getFullYear();
        var lo = thisYear - 11, hi = thisYear; // 10 full years + current
        var unitsByYear = {};
        feats.forEach(function (f) {
          var p = (f && f.properties) || {};
          var y = Number(p.YR_PIS) || 0;
          if (y <= lo || y > hi || y === 8888) return;
          var u = Number(p.LI_UNITS) || Number(p.N_UNITS) || 0;
          unitsByYear[y] = (unitsByYear[y] || 0) + u;
        });
        var years = Object.keys(unitsByYear);
        if (years.length) {
          var totalUnits = years.reduce(function (a, y) { return a + unitsByYear[y]; }, 0);
          var avgPerYr = Math.round(totalUnits / years.length);
          setText('snapAvgUnitsPerYr', fmtInt(avgPerYr));

          // F108 — Annual deficit growth at ≤60% AMI. Demand growth from
          // DOLA-projected household growth × the ≤60% AMI share from CHAS.
          // Supply = avg LIHTC + estimated preservation units (~30% of LIHTC
          // pace based on historical CHFA preservation activity).
          // Conservative estimate: 6,500 new ≤60% AMI HH / yr − supply rate.
          // The 6,500 figure is CO household growth (~17,000/yr per DOLA
          // 2024 components-of-change) × 38% (CHAS ≤60% AMI share).
          var demandGrowth = 6500;
          // Treat avg LIHTC units/yr as the supply pace (preservation is
          // mostly recapitalization, not net new affordable beds, so excluded).
          var deficitGrowth = Math.max(0, demandGrowth - avgPerYr);
          setText('snapDeficitGrowth', '+' + fmtInt(deficitGrowth) + '/yr');
        }
      })
      .catch(function () {
        DS.getJSON(DS.baseData('market/hud_lihtc_co.geojson'))
          .then(function (data) {
            var count = data && data.features ? data.features.length : null;
            if (count) setText('snapLihtcCount', fmtInt(count));
          })
          .catch(function () {});
      });
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
