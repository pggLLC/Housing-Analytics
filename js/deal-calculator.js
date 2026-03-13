(function () {
  'use strict';

  // HUD FY2025 Colorado AMI gross rent limits — Denver-Aurora-Lakewood MSA default.
  // These are overridden dynamically when HudFmr is loaded and a county is selected.
  // Formula: (AMI × %AMI × 0.30) / 12
  var _amiLimits = { 30: 930, 40: 1240, 50: 1550, 60: 1860 };
  var _countyFips = null;   // 5-digit FIPS of the currently selected county
  const CREDIT_RATE = 0.09;   // 9% LIHTC (new construction)
  const EQUITY_PRICE = 0.90;  // per dollar of annual credit
  const CREDIT_YEARS = 10;

  /**
   * Update _amiLimits from HudFmr for the given county FIPS.
   * Falls back to the default Denver MSA values if data is unavailable.
   * @param {string} fips  5-digit county FIPS, or null/'' for default.
   */
  function updateAmiLimitsFromFmr(fips) {
    var hudFmr = window.HudFmr;
    if (!fips || !hudFmr || !hudFmr.isLoaded()) return;
    var computed = {};
    [30, 40, 50, 60].forEach(function (pct) {
      var limit = hudFmr.getGrossRentLimit(fips, pct);
      if (limit !== null && limit > 0) computed[pct] = limit;
    });
    // Only apply if all tiers are present
    if (Object.keys(computed).length === 4) {
      _amiLimits = computed;
      _countyFips = fips;
    }
  }

  /**
   * Populate the county selector dropdown from HudFmr data.
   * @param {HTMLSelectElement} sel
   */
  function populateCountySelector(sel) {
    var hudFmr = window.HudFmr;
    if (!hudFmr || !hudFmr.isLoaded()) return;
    var counties = hudFmr.getAllCounties();
    sel.innerHTML = '<option value="">Default (Denver MSA)</option>';
    counties
      .slice()
      .sort(function (a, b) { return (a.county_name || '').localeCompare(b.county_name || ''); })
      .forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.fips;
        opt.textContent = c.county_name + ' — ' + (c.fmr_area_name || '');
        sel.appendChild(opt);
      });
  }

  // -------------------------------------------------------------------
  // Render the calculator UI into #dealCalcMount
  // -------------------------------------------------------------------
   * Falls back to the default Denver MSA values if data is unavailable.
   * @param {string} fips  5-digit county FIPS, or null/'' for default.
   */
  function updateAmiLimitsFromFmr(fips) {
    var hudFmr = window.HudFmr;
    if (!fips || !hudFmr || !hudFmr.isLoaded()) return;
    var computed = {};
    [30, 40, 50, 60].forEach(function (pct) {
      var limit = hudFmr.getGrossRentLimit(fips, pct);
      if (limit !== null && limit > 0) computed[pct] = limit;
    });
    // Only apply if all tiers are present
    if (Object.keys(computed).length === 4) {
      _amiLimits = computed;
      _countyFips = fips;
    }
  }

  /**
   * Populate the county selector dropdown from HudFmr data.
   * @param {HTMLSelectElement} sel
   */
  function populateCountySelector(sel) {
    var hudFmr = window.HudFmr;
    if (!hudFmr || !hudFmr.isLoaded()) return;
    var counties = hudFmr.getAllCounties();
    sel.innerHTML = '<option value="">Default (Denver MSA)</option>';
    counties
      .slice()
      .sort(function (a, b) { return (a.county_name || '').localeCompare(b.county_name || ''); })
      .forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.fips;
        opt.textContent = c.county_name + ' — ' + (c.fmr_area_name || '');
        sel.appendChild(opt);
      });
  }

  // -------------------------------------------------------------------
  // Render the calculator UI into #dealCalcMount
  // -------------------------------------------------------------------
        <div style="font-size:var(--small);color:var(--muted);">
          Credit Rate: <strong>9% (new construction)</strong>
        </div>

        <label style="display:block;margin-bottom:var(--sp2);margin-top:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">County (sets HUD FMR gross rent limits)</span>
          <select id="dc-county-select"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="">Default (Denver MSA)</option>
          </select>
        </label>
        <div style="font-size:var(--small);color:var(--muted);">
          Credit Rate: <strong>9% (new construction)</strong>
        </div>

        <label style="display:block;margin-bottom:var(--sp2);margin-top:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">County (sets HUD FMR gross rent limits)</span>
          <select id="dc-county-select"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="">Default (Denver MSA)</option>
          </select>
        </label>
        <div id="dc-fmr-note" style="font-size:var(--tiny);color:var(--muted);margin-top:-0.25rem;margin-bottom:var(--sp2);">
          Gross rent limits: 30% AMI = $930 &bull; 40% = $1,240 &bull; 50% = $1,550 &bull; 60% = $1,860
        </div>
      </fieldset>
    </div>

      var uInput = document.getElementById('dc-units-' + pct);
      if (chk && chk.checked && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        annualRents += u * _amiLimits[pct] * 12;
      }
    });

    var mount = document.getElementById('dealCalcMount');
    if (!mount) return;
    render(mount);

    // Wire up county selector
    var countySel = document.getElementById('dc-county-select');
    if (countySel) {
      // Populate options once HudFmr is ready
      var tryPopulate = function () {
        if (window.HudFmr && window.HudFmr.isLoaded()) {
          populateCountySelector(countySel);
        } else if (window.HudFmr) {
          window.HudFmr.load().then(function () {
            populateCountySelector(countySel);
          });
        }
      };
      // Retry after a short delay to allow deferred scripts to initialise
      setTimeout(tryPopulate, 200);

      countySel.addEventListener('change', function () {
        var fips = this.value;
        if (fips) {
          updateAmiLimitsFromFmr(fips);
        } else {
          _amiLimits = { 30: 930, 40: 1240, 50: 1550, 60: 1860 };
          _countyFips = null;
        }
        // Update the FMR note
        var noteEl = document.getElementById('dc-fmr-note');
        if (noteEl) {
          noteEl.textContent = 'Gross rent limits: ' +
            [30, 40, 50, 60].map(function (p) {
              return p + '% AMI = $' + _amiLimits[p].toLocaleString();
            }).join(' \u2022 ');
        }
        recalculate();
      });
    }
  }

  window.__DealCalc = { init: init, recalculate: recalculate };
      var uInput = document.getElementById('dc-units-' + pct);
      if (chk && chk.checked && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        annualRents += u * _amiLimits[pct] * 12;
      }
    });

    var mount = document.getElementById('dealCalcMount');
    if (!mount) return;
    render(mount);

    // Wire up county selector
    var countySel = document.getElementById('dc-county-select');
    if (countySel) {
      // Populate options once HudFmr is ready
      var tryPopulate = function () {
        if (window.HudFmr && window.HudFmr.isLoaded()) {
          populateCountySelector(countySel);
        } else if (window.HudFmr) {
          window.HudFmr.load().then(function () {
            populateCountySelector(countySel);
          });
        }
      };
      // Retry after a short delay to allow deferred scripts to initialise
      setTimeout(tryPopulate, 200);

      countySel.addEventListener('change', function () {
        var fips = this.value;
        if (fips) {
          updateAmiLimitsFromFmr(fips);
        } else {
          _amiLimits = { 30: 930, 40: 1240, 50: 1550, 60: 1860 };
          _countyFips = null;
        }
        // Update the FMR note
        var noteEl = document.getElementById('dc-fmr-note');
        if (noteEl) {
          noteEl.textContent = 'Gross rent limits: ' +
            [30, 40, 50, 60].map(function (p) {
              return p + '% AMI = $' + _amiLimits[p].toLocaleString();
            }).join(' \u2022 ');
        }
        recalculate();
      });
    }
  }

  window.__DealCalc = { init: init, recalculate: recalculate };