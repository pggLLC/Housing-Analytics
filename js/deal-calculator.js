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
  function render(mount) {
    mount.innerHTML = `
<section class="chart-card" style="margin-top:2rem;" aria-labelledby="dealCalcTitle">
  <h2 id="dealCalcTitle" style="font-size:1rem;font-weight:700;margin-bottom:0.25rem;">
    Preliminary LIHTC Feasibility Calculator
  </h2>
  <p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);">
    Preliminary estimates only. Not a substitute for a full pro forma.
  </p>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--sp3);">

    <!-- Inputs column -->
    <div>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Project Inputs</legend>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Development Cost ($)</span>
          <input id="dc-tdc" type="number" min="0" step="100000" value="20000000"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Total Units</span>
          <input id="dc-units" type="number" min="1" step="1" value="60"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <div style="margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);display:block;margin-bottom:0.4rem;">AMI Mix &amp; Units per Tier</span>
          <div id="dc-ami-rows" style="display:grid;grid-template-columns:auto 1fr;gap:0.4rem 0.75rem;align-items:center;">
            ${[30, 40, 50, 60].map(pct => `
              <label style="display:flex;align-items:center;gap:0.4rem;min-height:44px;min-width:44px;font-size:var(--small);white-space:nowrap;">
                <input id="dc-chk-${pct}" type="checkbox" checked style="width:16px;height:16px;">
                ${pct}% AMI
              </label>
              <input id="dc-units-${pct}" type="number" min="0" step="1" value="15"
                aria-label="Units at ${pct}% AMI"
                style="padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            `).join('')}
          </div>
        </div>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Eligible Basis %: <strong id="dc-basis-pct-label">80</strong>%
          </span>
          <input id="dc-basis-pct" type="range" min="50" max="100" step="1" value="80"
            style="display:block;width:100%;margin-top:0.25rem;">
        </label>

        <div style="font-size:var(--small);color:var(--muted);">
          Credit Rate: <strong>9% (new construction)</strong>
        </div>

        <!-- QCT / DDA Basis Boost
             QCT = Qualified Census Tract: census tract with high poverty / low income.
             DDA = Difficult Development Area: area with high construction / land costs.
             Both designations allow up to 130% eligible basis under IRC §42(d)(5)(B). -->
        <div id="dc-qct-dda-section" style="margin-top:var(--sp2);margin-bottom:var(--sp2);padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <div id="dc-qct-dda-indicator" style="display:none;margin-bottom:0.4rem;font-size:var(--small);color:var(--accent);font-weight:700;">
            ✓ Site is in a QCT/DDA — eligible basis boost may apply
          </div>
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;min-width:44px;font-size:var(--small);cursor:pointer;">
            <input id="dc-qct-dda-chk" type="checkbox"
              style="width:16px;height:16px;flex-shrink:0;"
              aria-label="QCT/DDA site &#x2013; may qualify for basis boost">
            QCT/DDA site (may increase eligible basis)
          </label>
          <p style="margin:0.25rem 0 0;font-size:var(--tiny);color:var(--muted);">
            QCT and DDA sites may qualify for up to 130% eligible basis under
            <abbr title="Internal Revenue Code §42(d)(5)(B) — basis boost for qualified census tracts and difficult development areas">IRC §42(d)(5)(B)</abbr>.
            The slider above controls basis %; the designation does not auto-apply.
          </p>
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

    <!-- Outputs column -->
    <div>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Estimated Results</legend>
        <dl id="dc-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Eligible Basis</dt>
          <dd id="dc-r-basis" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Tax Credits</dt>
          <dd id="dc-r-credits" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">10-Year Credit Equity</dt>
          <dd id="dc-r-equity" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Estimated Gap (TDC − Equity)</dt>
          <dd id="dc-r-gap" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Est. Annual Gross Rents</dt>
          <dd id="dc-r-rents" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-gap-note" style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);display:none;"></p>
      </fieldset>
    </div>
  </div>
</section>`;

    // Attach event listeners
    const ids = ['dc-tdc', 'dc-units', 'dc-basis-pct',
      'dc-chk-30', 'dc-chk-40', 'dc-chk-50', 'dc-chk-60',
      'dc-units-30', 'dc-units-40', 'dc-units-50', 'dc-units-60'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
    });

    // Wire up QCT/DDA checkbox — shows a note but does not auto-adjust the slider.
    // The user retains full manual control of the basis % to avoid unintended changes.
    var qctDdaChk = document.getElementById('dc-qct-dda-chk');
    var qctDdaInd = document.getElementById('dc-qct-dda-indicator');
    if (qctDdaChk && qctDdaInd) {
      qctDdaChk.addEventListener('change', function () {
        // Show or hide the indicator note based on checkbox state.
        qctDdaInd.style.display = this.checked ? 'block' : 'none';
      });
    }

    // Sync slider label
    var basisSlider = document.getElementById('dc-basis-pct');
    var basisLabel = document.getElementById('dc-basis-pct-label');
    if (basisSlider && basisLabel) {
      basisSlider.addEventListener('input', function () {
        basisLabel.textContent = basisSlider.value;
      });
    }

    recalculate();
  }

  // -------------------------------------------------------------------
  // Core calculation
  // -------------------------------------------------------------------
  function recalculate() {
    var tdc = parseFloat(document.getElementById('dc-tdc').value) || 0;
    var basisPct = parseFloat(document.getElementById('dc-basis-pct').value) / 100;

    var eligibleBasis = tdc * basisPct;
    var annualCredits = eligibleBasis * CREDIT_RATE;
    var equity = annualCredits * CREDIT_YEARS * EQUITY_PRICE;
    var gap = tdc - equity;

    var annualRents = 0;
    [30, 40, 50, 60].forEach(function (pct) {
      var chk = document.getElementById('dc-chk-' + pct);
      var uInput = document.getElementById('dc-units-' + pct);
      if (chk && chk.checked && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        annualRents += u * _amiLimits[pct] * 12;
      }
    });

    function fmt(n) {
      return '$' + Math.round(n).toLocaleString('en-US');
    }

    document.getElementById('dc-r-basis').textContent = fmt(eligibleBasis);
    document.getElementById('dc-r-credits').textContent = fmt(annualCredits);
    document.getElementById('dc-r-equity').textContent = fmt(equity);
    document.getElementById('dc-r-gap').textContent = fmt(gap);
    document.getElementById('dc-r-rents').textContent = fmt(annualRents);

    var note = document.getElementById('dc-gap-note');
    if (gap > 0) {
      note.textContent = 'Gap of ' + fmt(gap) + ' would require additional debt, grants, or deferred developer fee.';
      note.style.display = 'block';
    } else {
      note.textContent = 'Equity exceeds TDC — verify basis and credit rate inputs.';
      note.style.display = 'block';
    }
  }

  // -------------------------------------------------------------------
  // Designation context — called by market-analysis pipeline when a site
  // has been checked against QCT/DDA overlay polygons.
  // -------------------------------------------------------------------

  /**
   * Update the QCT/DDA designation indicator in the deal calculator UI.
   * Called by the market-analysis controller after checkDesignation() resolves.
   *
   * When basis_boost_eligible is true the indicator banner is shown and the
   * checkbox is pre-checked so the user is aware of the designation.  The
   * basis % slider is NOT changed — the user retains full manual control.
   *
   * @param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
   */
  function setDesignationContext(basisBoostEligible) {
    var chk = document.getElementById('dc-qct-dda-chk');
    var ind = document.getElementById('dc-qct-dda-indicator');
    if (!chk || !ind) return; // calculator may not be mounted yet

    chk.checked = !!basisBoostEligible;
    ind.style.display = basisBoostEligible ? 'block' : 'none';
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------
  function init() {
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

  window.__DealCalc = { init: init, recalculate: recalculate, setDesignationContext: setDesignationContext };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
