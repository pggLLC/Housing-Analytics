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
    if (stepEl) stepEl.textContent = 'Step ' + progress.nextStepNum + ' of 5 — ' + progress.nextStepLabel;
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

    DS.getJSON(DS.baseData('market/hud_lihtc_co.geojson'))
      .then(function (data) {
        var count = data && data.features ? data.features.length : null;
        if (count) setText('snapLihtcCount', fmtInt(count));
      })
      .catch(function () {
        DS.getJSON(DS.baseData('chfa-lihtc.json'))
          .then(function (data) {
            var count = data && data.features ? data.features.length : (Array.isArray(data) ? data.length : null);
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
