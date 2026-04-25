(function () {
  'use strict';

  // Financial defaults from centralized config (js/config/financial-constants.js).
  // Populated when HudFmr loads and a county is selected. AMI rent limits
  // are INTENTIONALLY null until the user picks a county — CO AMI ranges
  // from ~$52k (rural) to ~$124k (Denver MSA), so a one-size-fits-all
  // default (e.g. Denver MSA at 60% = $1,860) mis-states feasibility for
  // the majority of CO counties. Rent inputs render as placeholders until
  // county resolution populates real values.
  var _cfg = window.COHO_DEFAULTS || {};
  var _amiLimits = null;
  var _countyFips = null;   // 5-digit FIPS of the currently selected county
  var _creditRate = _cfg.creditRate9Pct || 0.09;
  var EQUITY_PRICE_DEFAULT = _cfg.equityPrice9Pct || 0.90;
  var _amiGapData = null;   // cached co_ami_gap_by_county.json
  const CREDIT_YEARS = 10;

  // -------------------------------------------------------------------
  // Mortgage constant helper
  // Annual mortgage constant for a fully-amortising loan.
  // -------------------------------------------------------------------
  function mortgageConstant(annualRate, termYears) {
    var monthlyRate = annualRate / 12;
    var totalMonths = termYears * 12;
    if (monthlyRate <= 0 || totalMonths <= 0) return 0;
    var factor = Math.pow(1 + monthlyRate, totalMonths);
    return (monthlyRate * factor / (factor - 1)) * 12;
  }

  // -------------------------------------------------------------------
  // DSCR stress-scenario math (pure function, testable)
  //
  // Given the same inputs auto-NOI uses (rents, vacancy, opex, reserves,
  // property tax) plus the sized annual debt service, recompute NOI under
  // {rent -10%, vacancy +5pts, opex +10%, combined rent-5/vac+3/opex+5}
  // and divide by the CURRENT annual debt service.
  //
  // Returns null when inputs can't support a coverage calculation
  // (e.g. zero debt service, zero rents). This is the function the
  // banker/syndicator table reads.
  // -------------------------------------------------------------------
  function computeDscrStressScenarios(inputs) {
    if (!inputs) return null;
    var annualRents      = +inputs.annualRents || 0;
    var vacancyPct       = +inputs.vacancyPct  || 0;
    var annualOpex       = +inputs.annualOpex       || 0;
    var annualRepReserve = +inputs.annualRepReserve || 0;
    var netPropTax       = +inputs.netPropTax       || 0;
    var annualDebtService = +inputs.annualDebtService || 0;
    if (annualDebtService <= 0 || annualRents <= 0) return null;

    function _noiFor(rentMult, vacDelta, opexMult) {
      var effVac = Math.min(1, Math.max(0, vacancyPct + vacDelta));
      var eff    = annualRents * rentMult * (1 - effVac);
      return eff - annualOpex * opexMult - annualRepReserve - netPropTax;
    }
    var baseNoi = _noiFor(1.00, 0, 1.00);
    return {
      base:     { noi: baseNoi,                    dscr: baseNoi / annualDebtService },
      rent10:   { noi: _noiFor(0.90, 0,    1.00),  dscr: _noiFor(0.90, 0,    1.00) / annualDebtService },
      vac5:     { noi: _noiFor(1.00, 0.05, 1.00),  dscr: _noiFor(1.00, 0.05, 1.00) / annualDebtService },
      opex10:   { noi: _noiFor(1.00, 0,    1.10),  dscr: _noiFor(1.00, 0,    1.10) / annualDebtService },
      combined: { noi: _noiFor(0.95, 0.03, 1.05),  dscr: _noiFor(0.95, 0.03, 1.05) / annualDebtService }
    };
  }

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
    // No "Default (Denver MSA)" option — the Denver defaults are wrong for
    // ~56 of 64 CO counties. Force the user to pick one.
    sel.innerHTML = '<option value="">Select a county…</option>';
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
    LIHTC Feasibility Calculator
  </h2>
  <!-- Screening-level model disclosure -->
  <div role="note" style="display:flex;align-items:flex-start;gap:0.5rem;margin-bottom:var(--sp3);padding:0.5rem 0.75rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg2);font-size:var(--tiny);">
    <span style="font-size:1rem;flex-shrink:0;" aria-hidden="true">🔎</span>
    <div>
      <strong style="color:var(--text);">Model class: screening-level</strong> —
      outputs are planning estimates only. Credit pricing, interest rates, equity, and lender terms
      vary significantly by market, investor, and deal structure. This tool does not model qualified
      basis, applicable fraction, or carryover allocation. Not a substitute for lender underwriting,
      CHFA review, or legal/tax counsel.
      <a href="docs/LIHTC_FEASIBILITY_CALCULATOR.md" style="color:var(--accent);">Methodology →</a>
    </div>
  </div>
  <p style="font-size:var(--small);color:var(--muted);margin-bottom:var(--sp3);">
    Early-stage feasibility sizing tool. Not a final underwriting or award prediction model.
    Outputs depend on assumptions and local soft-funding availability.
    See <a href="docs/LIHTC_FEASIBILITY_CALCULATOR.md" style="color:var(--accent);">methodology notes</a> for scope and limitations.
  </p>

  <!-- Credit Rate Scenario Toggle -->
  <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);margin-bottom:var(--sp3);">
    <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Credit Rate Scenario</legend>
    <div style="display:flex;flex-wrap:wrap;gap:var(--sp3);align-items:center;">
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-rate-9" type="radio" name="dc-credit-rate" value="0.09" checked
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>9% — Competitive / New Construction</strong></span>
      </label>
      <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;font-size:var(--small);">
        <input id="dc-rate-4" type="radio" name="dc-credit-rate" value="0.04"
          style="width:16px;height:16px;flex-shrink:0;">
        <span><strong>4% — Bond-Financed</strong></span>
      </label>
    </div>
    <p id="dc-rate-pab-note" style="display:none;font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0;">
      4% deals require a Private Activity Bond (PAB) volume cap allocation in addition to
      the 4% credit allocation.
    </p>
  </fieldset>

  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--sp3);">

    <!-- Inputs column -->
    <div>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
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
          <input id="dc-basis-pct" type="range" min="50" max="130" step="1" value="80"
            aria-label="Eligible basis percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
        </label>

        <div style="margin-top:var(--sp2);margin-bottom:var(--sp2);padding:0.6rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;">
            <input id="dc-qct-dda" type="checkbox"
              style="width:16px;height:16px;flex-shrink:0;">
            <span style="font-size:var(--small);font-weight:600;">QCT/DDA site (may increase eligible basis)</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0 1.6rem;">
            QCT and DDA sites may qualify for up to <strong>130% eligible basis</strong>
            under IRC&nbsp;§42(d)(5)(B). Adjust the Eligible Basis&nbsp;% slider above
            to reflect the boost — this checkbox is for reference only.
          </p>
          <p id="dc-qct-dda-note" style="display:none;font-size:var(--tiny);color:var(--accent);margin:0.3rem 0 0 1.6rem;font-weight:600;">
            ✓ Site marked as QCT/DDA — consider setting Eligible Basis to 100%+ to model the boost.
          </p>
        </div>

        <!-- Unit-sync warning: shown when Total Units ≠ sum of AMI-tier units -->
        <div id="dc-units-sync-warn" hidden
          style="margin:0.5rem 0 var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);
                 background:#fef3c7;border:1px solid #fcd34d;color:#92400e;
                 font-size:var(--tiny);line-height:1.5;">
        </div>

        <label style="display:block;margin-bottom:var(--sp2);margin-top:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">County (sets HUD FMR gross rent limits)</span>
          <select id="dc-county-select"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="">Default (Denver MSA)</option>
          </select>
        </label>
        <div id="dc-fmr-note" style="font-size:var(--tiny);color:var(--warn, #e6a23c);margin-top:-0.25rem;margin-bottom:var(--sp2);">
          Select a county above to load HUD-published AMI rent limits for that county.
        </div>
      </fieldset>

      <!-- Debt / Mortgage Inputs -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Operating Income &amp; NOI</legend>

        <!-- Auto-compute NOI toggle -->
        <div style="margin-bottom:var(--sp2);padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);">
          <label style="display:flex;align-items:center;gap:0.5rem;min-height:44px;cursor:pointer;">
            <input id="dc-auto-noi" type="checkbox" style="width:16px;height:16px;flex-shrink:0;">
            <span style="font-size:var(--small);font-weight:600;">Auto-compute NOI from rent &amp; expense inputs</span>
          </label>
          <p style="font-size:var(--tiny);color:var(--muted);margin:0.3rem 0 0 1.6rem;">
            When checked, NOI = Gross Rents × (1 − Vacancy) − Operating Expenses − Replacement Reserve − Net Property Tax
          </p>
        </div>

        <!-- Manual NOI override (hidden when auto-compute is on) -->
        <div id="dc-noi-manual-wrap" style="margin-bottom:var(--sp2);">
          <label style="display:block;">
            <span style="font-size:var(--small);color:var(--muted);">Net Operating Income (NOI) ($/year)</span>
            <input id="dc-noi" type="number" min="0" step="1000" value="0"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
        </div>

        <!-- Auto-NOI inputs (hidden until auto-compute is checked) -->
        <div id="dc-noi-auto-wrap" style="display:none;">
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Vacancy Rate (%)</span>
            <input id="dc-vacancy" type="number" min="0" max="50" step="0.5" value="7"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Operating Expenses ($/unit/month)</span>
            <input id="dc-opex" type="number" min="0" step="10" value="450"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">Initial default $450 reflects Denver-MSA LIHTC operating costs. <strong>Rural CO counties often run $250–$350</strong> — verify with your property manager or peer comparables.</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Replacement Reserve ($/unit/year)</span>
            <input id="dc-rep-reserve" type="number" min="0" step="25" value="350"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">CHFA minimum: $250–$400/unit/year</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Property Tax ($/unit/year)</span>
            <input id="dc-prop-tax" type="number" min="0" step="50" value="900"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">Initial default $900 is a Front-Range ballpark. <strong>Mill levies vary 3–5× across CO</strong> — check your county assessor before committing to a pro forma.</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Tax Exemption</span>
            <select id="dc-tax-exempt"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
              <option value="0">None (0%)</option>
              <option value="50">Partial (50%) — nonprofit</option>
              <option value="100">Full (100%) — housing authority</option>
            </select>
            <span style="font-size:var(--tiny);color:var(--muted);">Housing authority ownership or nonprofit partnerships may qualify for property tax exemption</span>
          </label>
          <div id="dc-noi-computed-display" style="padding:0.5rem 0.75rem;border-radius:var(--radius);background:color-mix(in oklab, var(--card,#fff) 80%, var(--accent,#096e65) 20%);font-size:var(--small);font-weight:600;">
            Computed NOI: <span id="dc-noi-computed">—</span>
          </div>
        </div>
      </fieldset>

      <!-- Developer Fee -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Developer Fee</legend>
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Developer Fee Rate: <strong id="dc-devfee-pct-label">15</strong>% of TDC
          </span>
          <input id="dc-devfee-pct" type="range" min="0" max="25" step="0.5" value="15"
            aria-label="Developer fee rate percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
          <span style="font-size:var(--tiny);color:var(--muted);">
            Typical CHFA range: 12–18% of TDC. Only a portion is includable in eligible basis.
          </span>
        </label>
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">
            Deferred Developer Fee: <strong id="dc-deferred-pct-label">40</strong>% of dev fee
          </span>
          <input id="dc-deferred-pct" type="range" min="0" max="100" step="5" value="40"
            aria-label="Deferred developer fee percentage"
            style="display:block;width:100%;margin-top:0.25rem;">
          <span style="font-size:var(--tiny);color:var(--muted);">
            Shown as a "soft source" in S&amp;U — this is a deferred developer obligation
            paid from operating cash flow over time, <em>not</em> cash available at closing.
            CHFA and lenders will require a repayment pro forma to verify supportability.
          </span>
        </label>
        <div id="dc-devfee-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.3rem 0.75rem;font-size:var(--small);margin-top:var(--sp2);">
          <span style="color:var(--muted);">Total Developer Fee</span>
          <span id="dc-r-devfee" style="font-weight:700;text-align:right;">—</span>
          <span style="color:var(--muted);">Deferred (gap fill)</span>
          <span id="dc-r-deferred" style="font-weight:700;text-align:right;color:var(--accent);">—</span>
          <span style="color:var(--muted);">Paid at closing</span>
          <span id="dc-r-devfee-closing" style="font-weight:700;text-align:right;">—</span>
        </div>
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Sizing</legend>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Debt Coverage Ratio (DCR)</span>
          <input id="dc-dcr" type="number" min="1.05" max="2.0" step="0.05" value="1.20"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Interest Rate (%)</span>
          <input id="dc-rate" type="number" min="3" max="12" step="0.1" value="6.5"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Loan Term (years)</span>
          <input id="dc-term" type="number" min="1" max="50" step="1" value="35"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>

        <p style="font-size:var(--tiny);color:var(--muted);margin:0;">
          This is a planning-level estimate. Actual terms depend on lender underwriting.
        </p>
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-top:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Soft Funding Source</legend>
        <label style="display:block;margin-bottom:var(--sp2);">
          <span style="font-size:var(--small);color:var(--muted);">Primary soft-funding program</span>
          <select id="dc-soft-source"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);font-size:var(--small);">
            <option value="chfa_htf">CHFA HTF</option>
            <option value="chfa_cmf">CHFA Capital Magnet Fund</option>
            <option value="dola_htf">DOLA HTF</option>
            <option value="home">HOME</option>
            <option value="cdbg">CDBG</option>
            <option value="local_trust">Local housing trust fund</option>
            <option value="nhtf">NHTF</option>
            <option value="impact_fee_loan">Impact Fee Loan</option>
            <option value="historic_tc">Historic Tax Credit</option>
            <option value="nmtc">NMTC</option>
            <option value="seller_carry">Seller-carry</option>
          </select>
        </label>
        <div id="dc-impact-fee-wrap" style="display:none;">
          <fieldset style="border:none;padding:0;margin-bottom:var(--sp2);">
            <legend style="font-size:var(--small);color:var(--muted);padding:0;margin-bottom:0.3rem;">Accounting treatment</legend>
            <label style="display:block;margin-bottom:0.2rem;font-size:var(--small);">
              <input type="radio" name="dc-impact-fee-mode" value="loan" checked style="margin-right:0.35rem;">
              Loan &mdash; amortized from cash flow
            </label>
            <label style="display:block;font-size:var(--small);">
              <input type="radio" name="dc-impact-fee-mode" value="grant" style="margin-right:0.35rem;">
              Grant / waiver &mdash; reduces eligible basis (&sect;42(d)(5)(A))
            </label>
          </fieldset>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Impact Fee Amount ($)</span>
            <input id="dc-impact-fee-amount" type="number" min="0" step="10000" value="0"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
          </label>
          <div id="dc-impact-fee-loan-inputs">
            <label style="display:block;margin-bottom:var(--sp2);">
              <span style="font-size:var(--small);color:var(--muted);">Loan Rate (%)</span>
              <input id="dc-impact-fee-rate" type="number" min="0" max="20" step="0.1" value="3.5"
                style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            </label>
            <label style="display:block;">
              <span style="font-size:var(--small);color:var(--muted);">Loan Term (years)</span>
              <input id="dc-impact-fee-term" type="number" min="1" max="50" step="1" value="20"
                style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            </label>
          </div>
        </div>
      </fieldset>
    </div>

    <!-- Outputs column -->
    <div>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">LIHTC Credit Estimates <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(screening-level)</span></legend>
        <dl id="dc-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Eligible Basis</dt>
          <dd id="dc-r-basis" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Tax Credits</dt>
          <dd id="dc-r-credits" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">10-Year Credit Equity</dt>
          <dd id="dc-r-equity" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Est. Annual Gross Rents</dt>
          <dd id="dc-r-rents" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-gap-note" style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);display:none;"></p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Verify: Annual credits and equity are illustrative — confirm equity pricing with your syndicator
          (CO market typically $0.85–$0.95/credit). Gross rents use
          <a href="https://www.huduser.gov/portal/datasets/fmr.html" target="_blank" rel="noopener">HUD FMR FY 2025</a>
          published limits (lags ~18 mo); spot-check against current market rents before underwriting.
        </p>
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Supportable First Mortgage <span style="font-weight:400;font-size:var(--tiny);color:var(--muted);">(estimate · screening-level)</span></legend>
        <dl id="dc-mortgage-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Mortgage Constant (annual)</dt>
          <dd id="dc-r-mc" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Supportable First Mortgage</dt>
          <dd id="dc-r-mortgage" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">Cap Rate (NOI / TDC)</dt>
          <dd id="dc-r-cap-rate" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Break-Even Occupancy</dt>
          <dd id="dc-r-beo" style="font-weight:700;text-align:right;">—</dd>

          <dt id="dc-r-proptax-label" style="color:var(--muted);display:none;">Net Property Tax</dt>
          <dd id="dc-r-proptax" style="font-weight:700;text-align:right;display:none;">—</dd>

          <dt id="dc-r-taxsave-label" style="color:var(--accent);display:none;">Tax Savings (exemption)</dt>
          <dd id="dc-r-taxsave" style="font-weight:700;text-align:right;color:var(--accent);display:none;">—</dd>
        </dl>
        <p style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);">Cap rate and break-even occupancy require auto-compute NOI to be enabled.</p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Verify: Supportable mortgage is a planning-level estimate based on your DCR, rate, and term inputs —
          actual lender underwriting differs.
          <a href="https://www.chfainfo.com/developers/rental-housing-and-funding" target="_blank" rel="noopener">CHFA</a>
          and conventional lenders apply independent DCR, LTV, and debt-service reserve requirements.
        </p>
      </fieldset>

      <!-- Debt Service Coverage & Stress -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Debt Service Coverage &amp; Stress Tests</legend>
        <dl id="dc-dscr-summary" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">NOI (stabilized, annual)</dt>
          <dd id="dc-r-noi-stab" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Annual Debt Service</dt>
          <dd id="dc-r-ads" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">DSCR (stabilized)</dt>
          <dd id="dc-r-dscr-base" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p id="dc-dscr-target-note" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);margin-bottom:var(--sp2);">—</p>
        <table id="dc-dscr-stress-table" style="width:100%;border-collapse:collapse;font-size:var(--small);margin-top:var(--sp2);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Stress Scenario</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Stressed NOI</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">DSCR</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">vs target</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Rent &minus;10%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Soft market / concessions scenario
                </span>
              </td>
              <td id="dc-r-stress-rent10-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-rent10-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-rent10-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Vacancy +5 pts
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Slow lease-up / turnover spike scenario
                </span>
              </td>
              <td id="dc-r-stress-vac5-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-vac5-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-vac5-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                OpEx +10%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Insurance / utility / repair-cost inflation scenario
                </span>
              </td>
              <td id="dc-r-stress-opex10-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-opex10-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-opex10-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr style="border-top:1px dashed var(--border);">
              <td style="padding:0.3rem 0.25rem;">
                <strong>Combined:</strong> Rent &minus;5% + Vacancy +3 pts + OpEx +5%
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Realistic multi-variable downside — what lenders actually underwrite against
                </span>
              </td>
              <td id="dc-r-stress-combined-noi" style="text-align:right;font-weight:600;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-combined-dscr" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-r-stress-combined-margin" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
          </tbody>
        </table>
        <p id="dc-dscr-manual-note" style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);margin-bottom:0;display:none;">
          Stress scenarios require auto-compute NOI to be enabled — they need the underlying rent / vacancy / opex breakdown, not just a total NOI.
        </p>
        <p class="kpi-source kpi-verify" style="margin-top:var(--sp2);">
          ⚠ Banker / syndicator rule of thumb: conservative lenders want DSCR ≥ 1.15 under a moderate stress scenario
          and DSCR ≥ 1.10 under combined stress. A deal that falls below 1.00 under the combined case may need
          additional credit enhancement, a lower DCR sizing target, or a smaller loan.
        </p>
      </fieldset>

      <!-- Sources & Uses Panel -->
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Sources &amp; Uses Summary</legend>
        <table id="dc-su-table" style="width:100%;border-collapse:collapse;font-size:var(--small);">
          <thead>
            <tr>
              <th style="text-align:left;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Item</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">Amount</th>
              <th style="text-align:right;color:var(--muted);font-weight:600;padding:0.3rem 0.25rem;border-bottom:1px solid var(--border);">% of TDC</th>
            </tr>
          </thead>
          <tbody>
            <tr style="background:var(--bg2);">
              <td colspan="3" style="padding:0.3rem 0.25rem;font-weight:700;color:var(--muted);font-size:var(--tiny);text-transform:uppercase;letter-spacing:0.04em;">SOURCES</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">LIHTC Equity</td>
              <td id="dc-su-equity" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-equity-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">Supportable First Mortgage</td>
              <td id="dc-su-mortgage" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-mortgage-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                Deferred Developer Fee
                <span style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Soft source — developer obligation paid from future cash flow, not cash at closing
                </span>
              </td>
              <td id="dc-su-deferred" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-deferred-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">
                <span id="dc-su-impact-label">Impact Fee Loan Debt Service (annual)</span>
                <span id="dc-su-impact-note" style="display:block;font-size:var(--tiny);color:var(--muted);font-weight:400;">
                  Included when Impact Fee Loan is selected as a soft-funding source
                </span>
              </td>
              <td id="dc-su-impact-ds" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-impact-ds-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;color:var(--muted);">Gap / Subordinate Debt / Grants Needed</td>
              <td id="dc-su-gap" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td id="dc-su-gap-pct" style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">—</td>
            </tr>
            <tr style="background:var(--bg2);">
              <td colspan="3" style="padding:0.3rem 0.25rem;font-weight:700;color:var(--muted);font-size:var(--tiny);text-transform:uppercase;letter-spacing:0.04em;">USES</td>
            </tr>
            <tr>
              <td style="padding:0.3rem 0.25rem;">Total Development Cost (TDC)</td>
              <td id="dc-su-tdc" style="text-align:right;font-weight:700;padding:0.3rem 0.25rem;">—</td>
              <td style="text-align:right;color:var(--muted);padding:0.3rem 0.25rem;">100%</td>
            </tr>
          </tbody>
        </table>
      </fieldset>
    </div>
  </div>

  <!-- Collapsible Assumptions Panel -->
  <details style="margin-top:var(--sp3);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp2) var(--sp3);">
    <summary style="font-size:var(--small);font-weight:700;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:0.4rem;">
      <span>&#9660;</span> Assumptions
    </summary>
    <div style="margin-top:var(--sp2);font-size:var(--small);">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp2) var(--sp3);">
        <label style="display:block;">
          <span style="color:var(--muted);">Credit Pricing ($/credit)</span>
          <input id="dc-equity-price" type="number" min="0.50" max="1.20" step="0.01" value="0.90"
            style="display:block;width:100%;margin-top:0.25rem;padding:0.35rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
        </label>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Debt Coverage Ratio (DCR)</span>
          <span id="dc-assump-dcr" style="font-weight:700;">1.20</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Interest Rate</span>
          <span id="dc-assump-rate" style="font-weight:700;">6.5%</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
        <div>
          <span style="color:var(--muted);display:block;margin-bottom:0.25rem;">Loan Term</span>
          <span id="dc-assump-term" style="font-weight:700;">35 years</span>
          <span style="color:var(--muted);"> (edit in Debt Sizing Inputs)</span>
        </div>
      </div>
      <div id="dc-assump-qct" style="margin-top:var(--sp2);padding:0.5rem 0.75rem;border-radius:var(--radius);background:var(--bg2);font-size:var(--tiny);color:var(--muted);">
        QCT/DDA basis boost: <strong id="dc-assump-qct-status">not indicated</strong>
      </div>
      <p style="margin-top:var(--sp2);font-size:var(--tiny);color:var(--muted);">
        All values are planning-level and not a substitute for lender or investor underwriting.
        Credit pricing, DCR, interest rate, and term vary by market, lender, and project type.
      </p>
    </div>
  </details>

  <!-- Planning-Level Disclaimer -->
  <div style="margin-top:var(--sp3);padding:var(--sp2) var(--sp3);border-left:3px solid var(--border);background:var(--bg2);border-radius:0 var(--radius) var(--radius) 0;">
    <p style="font-size:var(--tiny);color:var(--muted);margin:0;">
      <em>This calculator produces planning-level estimates only. It is not a substitute for
      lender underwriting, investor pricing, or legal/tax advice. Assumptions vary significantly
      by market, lender, and project type.</em>
    </p>
  </div>

</section>`;

    // Attach event listeners
    const ids = ['dc-tdc', 'dc-units', 'dc-basis-pct',
      'dc-chk-30', 'dc-chk-40', 'dc-chk-50', 'dc-chk-60',
      'dc-units-30', 'dc-units-40', 'dc-units-50', 'dc-units-60',
      'dc-noi', 'dc-dcr', 'dc-rate', 'dc-term', 'dc-equity-price',
      'dc-vacancy', 'dc-opex', 'dc-rep-reserve', 'dc-prop-tax', 'dc-tax-exempt',
      'dc-impact-fee-amount', 'dc-impact-fee-rate', 'dc-impact-fee-term'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
    });
    // Select elements also need 'change' listener for reliable cross-browser support
    var taxExemptSel = document.getElementById('dc-tax-exempt');
    if (taxExemptSel) taxExemptSel.addEventListener('change', recalculate);
    var softSourceSel = document.getElementById('dc-soft-source');
    var impactFeeWrap = document.getElementById('dc-impact-fee-wrap');
    var impactLoanInputs = document.getElementById('dc-impact-fee-loan-inputs');
    var syncSoftFundingUi = function () {
      var showImpact = softSourceSel && softSourceSel.value === 'impact_fee_loan';
      if (impactFeeWrap) impactFeeWrap.style.display = showImpact ? 'block' : 'none';
      // Hide the rate/term inputs when grant mode is active — they're only
      // meaningful for the amortizing-loan path.
      if (impactLoanInputs) {
        var modeInput = document.querySelector('input[name="dc-impact-fee-mode"]:checked');
        var mode = (modeInput && modeInput.value) || 'loan';
        impactLoanInputs.style.display = (showImpact && mode === 'loan') ? 'block' : 'none';
      }
    };
    if (softSourceSel) {
      softSourceSel.addEventListener('change', function () {
        syncSoftFundingUi();
        recalculate();
      });
      syncSoftFundingUi();
    }
    // Mode-radio listeners: toggle loan-only inputs + recompute basis/gap
    document.querySelectorAll('input[name="dc-impact-fee-mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        syncSoftFundingUi();
        recalculate();
      });
    });

    // Auto-NOI toggle
    var autoNoiChk = document.getElementById('dc-auto-noi');
    var noiManualWrap = document.getElementById('dc-noi-manual-wrap');
    var noiAutoWrap = document.getElementById('dc-noi-auto-wrap');
    if (autoNoiChk) {
      autoNoiChk.addEventListener('change', function () {
        var on = autoNoiChk.checked;
        if (noiManualWrap) noiManualWrap.style.display = on ? 'none' : 'block';
        if (noiAutoWrap) noiAutoWrap.style.display = on ? 'block' : 'none';
        recalculate();
      });
    }

    // Developer fee slider label sync
    var devfeePctSlider = document.getElementById('dc-devfee-pct');
    var devfeePctLabel  = document.getElementById('dc-devfee-pct-label');
    if (devfeePctSlider && devfeePctLabel) {
      devfeePctSlider.addEventListener('input', function () {
        devfeePctLabel.textContent = parseFloat(devfeePctSlider.value).toFixed(1);
        recalculate();
      });
    }
    // Deferred % slider label sync
    var deferredPctSlider = document.getElementById('dc-deferred-pct');
    var deferredPctLabel  = document.getElementById('dc-deferred-pct-label');
    if (deferredPctSlider && deferredPctLabel) {
      deferredPctSlider.addEventListener('input', function () {
        deferredPctLabel.textContent = parseInt(deferredPctSlider.value, 10);
        recalculate();
      });
    }

    // Credit rate scenario toggle — also switches equity price default
    ['dc-rate-9', 'dc-rate-4'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          _creditRate = parseFloat(this.value);
          var is4Pct = (this.value === '0.04');
          var pabNote = document.getElementById('dc-rate-pab-note');
          if (pabNote) pabNote.style.display = is4Pct ? 'block' : 'none';

          // Update equity price default to match credit rate scenario
          var newDefault = is4Pct
            ? (_cfg.equityPrice4Pct || 0.85)
            : (_cfg.equityPrice9Pct || 0.90);
          EQUITY_PRICE_DEFAULT = newDefault;
          var eqInput = document.getElementById('dc-equity-price');
          if (eqInput) eqInput.value = newDefault.toFixed(2);

          recalculate();
        });
      }
    });

    // Toggle the QCT/DDA note when the checkbox changes
    var qctDdaChk = document.getElementById('dc-qct-dda');
    var qctDdaNote = document.getElementById('dc-qct-dda-note');
    if (qctDdaChk && qctDdaNote) {
      qctDdaChk.addEventListener('change', function () {
        qctDdaNote.style.display = qctDdaChk.checked ? 'block' : 'none';
        var qctStatus = document.getElementById('dc-assump-qct-status');
        if (qctStatus) qctStatus.textContent = qctDdaChk.checked ? 'indicated ✓' : 'not indicated';
        recalculate();
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

    // Sync assumptions display when debt inputs change
    ['dc-dcr', 'dc-rate', 'dc-term'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var dcrEl = document.getElementById('dc-dcr');
        var rateEl = document.getElementById('dc-rate');
        var termEl = document.getElementById('dc-term');
        var assumDcr = document.getElementById('dc-assump-dcr');
        var assumRate = document.getElementById('dc-assump-rate');
        var assumTerm = document.getElementById('dc-assump-term');
        if (assumDcr && dcrEl) assumDcr.textContent = parseFloat(dcrEl.value).toFixed(2);
        if (assumRate && rateEl) assumRate.textContent = parseFloat(rateEl.value).toFixed(1) + '%';
        if (assumTerm && termEl) assumTerm.textContent = parseInt(termEl.value, 10) + ' years';
      });
    });

    recalculate();
  }

  // -------------------------------------------------------------------
  // Core calculation
  // -------------------------------------------------------------------
  function recalculate() {
    function fmt(n) {
      if (!isFinite(n)) return '—';
      return '$' + Math.round(n).toLocaleString('en-US');
    }
    function fmtPct(n) {
      if (!isFinite(n) || n === 0) return '—';
      return (n * 100).toFixed(1) + '%';
    }
    function safeVal(id) {
      var el = document.getElementById(id);
      if (!el) return NaN;
      return parseFloat(el.value);
    }

    var tdc = safeVal('dc-tdc') || 0;
    var units = safeVal('dc-units') || 0;
    var basisPct = (safeVal('dc-basis-pct') || 80) / 100;
    var equityPrice = safeVal('dc-equity-price');
    if (!isFinite(equityPrice) || equityPrice <= 0) equityPrice = EQUITY_PRICE_DEFAULT;

    // Impact-fee parameters — read BEFORE basis calc because grant-mode
    // reduces eligible basis under §42(d)(5)(A).
    var softSource = (document.getElementById('dc-soft-source') || {}).value || '';
    var impactAmt = 0;
    var impactMode = 'loan';
    var impactGrant = 0;           // dollars subtracted from basis + applied as a source
    var impactDebtService = 0;     // dollars amortized as annual expense
    if (softSource === 'impact_fee_loan') {
      impactAmt = Math.max(0, safeVal('dc-impact-fee-amount') || 0);
      var modeInput = document.querySelector('input[name="dc-impact-fee-mode"]:checked');
      impactMode = (modeInput && modeInput.value) || 'loan';
      if (impactMode === 'grant') {
        impactGrant = impactAmt;
      } else {
        var impactRatePct = Math.max(0, safeVal('dc-impact-fee-rate') || 0);
        var impactTerm = Math.max(1, safeVal('dc-impact-fee-term') || 20);
        if (impactAmt > 0) {
          var impactMc = mortgageConstant(impactRatePct / 100, impactTerm);
          // Zero-interest public loans amortize as straight-line principal.
          impactDebtService = impactRatePct > 0 ? (impactAmt * impactMc) : (impactAmt / impactTerm);
        }
      }
    }

    // LIHTC credit calculations — grants reduce eligible basis per §42(d)(5)(A).
    var eligibleBasis = Math.max(0, (tdc * basisPct) - impactGrant);
    var annualCredits = eligibleBasis * _creditRate;
    var equity = annualCredits * CREDIT_YEARS * equityPrice;

    // Rent income — sum checked AMI-tier units
    var annualRents = 0;
    var amiUnitSum = 0;
    // _amiLimits is null until the user selects a county. Skip the rent roll
    // entirely rather than fabricating Denver MSA rents — NaN propagation
    // through the pro-forma would mislead more than a visible zero.
    [30, 40, 50, 60].forEach(function (pct) {
      var chk = document.getElementById('dc-chk-' + pct);
      var uInput = document.getElementById('dc-units-' + pct);
      if (chk && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        if (chk.checked && _amiLimits && _amiLimits[pct]) {
          annualRents += u * _amiLimits[pct] * 12;
        }
        amiUnitSum += u; // count all tier units regardless of checkbox
      }
    });

    // Warn when Total Units ≠ sum of AMI-tier units (auto-NOI uses Total Units
    // for operating expenses; rent uses AMI-tier units — divergence = wrong NOI).
    var syncWarn = document.getElementById('dc-units-sync-warn');
    if (syncWarn && units > 0 && amiUnitSum > 0 && units !== amiUnitSum) {
      syncWarn.textContent =
        '⚠ Total Units (' + units + ') ≠ sum of AMI-tier units (' + amiUnitSum +
        '). Auto-NOI operating expenses use Total Units; rents use AMI-tier units. ' +
        'Align both inputs for an accurate NOI.';
      syncWarn.hidden = false;
    } else if (syncWarn) {
      syncWarn.hidden = true;
    }

    // Developer fee
    var devfeePctEl = document.getElementById('dc-devfee-pct');
    var devfeePct = devfeePctEl ? (parseFloat(devfeePctEl.value) || 15) / 100 : 0.15;
    var devFeeTotal = tdc * devfeePct;
    var deferredPctEl = document.getElementById('dc-deferred-pct');
    var deferredPct = deferredPctEl ? (parseFloat(deferredPctEl.value) || 40) / 100 : 0.40;
    var deferredDevFee = devFeeTotal * deferredPct;
    var devFeeAtClosing = devFeeTotal - deferredDevFee;

    // Developer fee display
    var devfeeEl = document.getElementById('dc-r-devfee');
    var deferredEl = document.getElementById('dc-r-deferred');
    var devfeeClosingEl = document.getElementById('dc-r-devfee-closing');
    if (devfeeEl) devfeeEl.textContent = tdc > 0 ? fmt(devFeeTotal) : '—';
    if (deferredEl) deferredEl.textContent = tdc > 0 ? fmt(deferredDevFee) : '—';
    if (devfeeClosingEl) devfeeClosingEl.textContent = tdc > 0 ? fmt(devFeeAtClosing) : '—';

    // Auto-NOI or manual NOI
    var autoNoi = document.getElementById('dc-auto-noi');
    var noi;
    var annualOpex = null;
    var annualRepReserve = null;
    var netPropTax = null;
    var taxSavings = 0;
    if (autoNoi && autoNoi.checked) {
      var vacancyPct = (safeVal('dc-vacancy') || 5) / 100;
      // Do NOT silently substitute Denver-MSA defaults (450/350/900) when
      // any of these fields are blank — they vary materially across CO
      // counties (rural opex often $250-350/mo vs. $450 Denver). A blank
      // field should visibly zero the line, not fabricate a plausible
      // Front-Range number. UI fields keep their initial defaults via the
      // input `value` attribute so users see suggestions, but clearing a
      // field now surfaces as "0" rather than silent substitution.
      var opexPerUnitMonth = safeVal('dc-opex');
      var repReservePerUnit = safeVal('dc-rep-reserve');
      var propTaxPerUnit = safeVal('dc-prop-tax');
      if (!isFinite(opexPerUnitMonth) || opexPerUnitMonth < 0) opexPerUnitMonth = 0;
      if (!isFinite(repReservePerUnit) || repReservePerUnit < 0) repReservePerUnit = 0;
      if (!isFinite(propTaxPerUnit) || propTaxPerUnit < 0) propTaxPerUnit = 0;
      var effectiveGrossIncome = annualRents * (1 - vacancyPct);
      annualOpex = opexPerUnitMonth * 12 * (units || 60);
      annualRepReserve = repReservePerUnit * (units || 60);
      var taxExemptPct = (safeVal('dc-tax-exempt') || 0) / 100;
      var annualPropTax = propTaxPerUnit * (units || 60);
      taxSavings = annualPropTax * taxExemptPct;
      netPropTax = annualPropTax - taxSavings;
      noi = effectiveGrossIncome - annualOpex - annualRepReserve - netPropTax;
      var noiComputedEl = document.getElementById('dc-noi-computed');
      if (noiComputedEl) noiComputedEl.textContent = isFinite(noi) ? fmt(noi) : '—';
    } else {
      noi = safeVal('dc-noi') || 0;
    }

    // Supportable first mortgage
    var dcr = safeVal('dc-dcr');
    if (!isFinite(dcr) || dcr < 1.05) dcr = 1.20;
    if (dcr > 2.0) dcr = 2.0;
    var interestRate = safeVal('dc-rate');
    if (!isFinite(interestRate) || interestRate < 3.0) interestRate = 6.5;
    if (interestRate > 12.0) interestRate = 12.0;
    var term = safeVal('dc-term');
    if (!isFinite(term) || term <= 0) term = 35;

    var mc = mortgageConstant(interestRate / 100, term);
    var mortgage = (mc > 0 && noi > 0) ? (noi / dcr) / mc : 0;

    // Cap rate and break-even occupancy
    var capRate = (noi > 0 && tdc > 0) ? (noi / tdc) : null;
    var annualDebtService = mc > 0 ? mortgage * mc : 0;
    var breakEvenOcc = annualRents > 0
      ? (annualOpex != null && annualRepReserve != null
          ? Math.min((annualOpex + annualRepReserve + (netPropTax || 0) + annualDebtService) / annualRents, 1)
          : null)
      : null;

    // ── DSCR + stress scenarios ──────────────────────────────────────
    //
    // By construction, baseDSCR === target DCR (mortgage was sized at
    // noi/dcr). The real value is in the stress table: recompute NOI
    // under {rent -10%, vacancy +5pts, opex +10%, combined -5/+3/+5}
    // and divide by the CURRENT debt service (loan is already sized
    // at stabilization). A banker/syndicator reads this to answer:
    // "does the deal still cover debt if the market goes sideways?"
    //
    // Only computable when auto-NOI is on — manual NOI mode doesn't
    // give us rent/vac/opex components to perturb.
    var dscrAutoMode = !!(autoNoi && autoNoi.checked);
    var baseDSCR = annualDebtService > 0 ? noi / annualDebtService : null;
    var stress = null;
    if (dscrAutoMode) {
      stress = computeDscrStressScenarios({
        annualRents:      annualRents,
        vacancyPct:       (safeVal('dc-vacancy') || 5) / 100,
        annualOpex:       annualOpex       || 0,
        annualRepReserve: annualRepReserve || 0,
        netPropTax:       netPropTax       || 0,
        annualDebtService: annualDebtService
      });
    }

    // Sources & uses — deferred dev fee + impact-fee grant (if any) fill gap
    // before subordinate debt is needed. Loan-mode impact fee is NOT a gap
    // source here — it shows up separately as annual debt service.
    var gap = tdc - equity - mortgage - deferredDevFee - impactGrant;

    // Update LIHTC results
    document.getElementById('dc-r-basis').textContent = tdc > 0 ? fmt(eligibleBasis) : '—';
    document.getElementById('dc-r-credits').textContent = tdc > 0 ? fmt(annualCredits) : '—';
    document.getElementById('dc-r-equity').textContent = tdc > 0 ? fmt(equity) : '—';
    document.getElementById('dc-r-rents').textContent = fmt(annualRents);

    // Update mortgage results
    document.getElementById('dc-r-mc').textContent = mc > 0 ? (mc * 100).toFixed(4) + '%' : '—';
    document.getElementById('dc-r-mortgage').textContent = noi > 0 ? fmt(mortgage) : '—';

    // Update cap rate and break-even occupancy
    var capRateEl = document.getElementById('dc-r-cap-rate');
    if (capRateEl) capRateEl.textContent = capRate != null ? (capRate * 100).toFixed(2) + '%' : '—';
    var beoEl = document.getElementById('dc-r-beo');
    if (beoEl) beoEl.textContent = breakEvenOcc != null ? (breakEvenOcc * 100).toFixed(1) + '%' : '—';

    // ── Render DSCR + stress table ─────────────────────────────────
    // Color thresholds — banker/syndicator convention:
    //   ≥ 1.20  strong   (green)
    //   1.10-1.19 adequate (neutral / text color)
    //   1.00-1.09 marginal (amber)
    //   < 1.00   fails     (red)
    function _dscrColor(v) {
      if (v == null || !isFinite(v)) return 'var(--muted)';
      if (v >= 1.20) return 'var(--good, #047857)';
      if (v >= 1.10) return 'var(--text)';
      if (v >= 1.00) return 'var(--warn, #d97706)';
      return 'var(--bad, #dc2626)';
    }
    function _setDscr(id, v) {
      var el = document.getElementById(id);
      if (!el) return;
      if (v == null || !isFinite(v)) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
      el.textContent = v.toFixed(2) + 'x';
      el.style.color = _dscrColor(v);
    }
    function _setMargin(id, v, target) {
      var el = document.getElementById(id);
      if (!el) return;
      if (v == null || !isFinite(v) || target == null) { el.textContent = '—'; return; }
      var delta = v - target;
      var sign = delta >= 0 ? '+' : '';
      el.textContent = sign + delta.toFixed(2);
      el.style.color = delta >= 0 ? 'var(--good, #047857)' : 'var(--warn, #d97706)';
    }

    var noiStabEl = document.getElementById('dc-r-noi-stab');
    if (noiStabEl) noiStabEl.textContent = (dscrAutoMode && isFinite(noi)) ? fmt(noi)
                                         : (!dscrAutoMode && noi > 0)      ? fmt(noi) + ' (manual)'
                                         : '—';

    var adsEl = document.getElementById('dc-r-ads');
    if (adsEl) adsEl.textContent = annualDebtService > 0 ? fmt(annualDebtService) : '—';

    _setDscr('dc-r-dscr-base', baseDSCR);

    var targetNote = document.getElementById('dc-dscr-target-note');
    if (targetNote) {
      if (baseDSCR != null && isFinite(baseDSCR)) {
        targetNote.textContent = 'Sized to target DCR ' + dcr.toFixed(2) + 'x · the stress table below shows how DSCR moves if rents, vacancy, or operating costs shift.';
      } else {
        targetNote.textContent = 'Enter NOI (or enable auto-compute) and mortgage terms to see DSCR.';
      }
    }

    var manualNote = document.getElementById('dc-dscr-manual-note');
    var stressTableEl = document.getElementById('dc-dscr-stress-table');
    if (manualNote && stressTableEl) {
      if (stress) {
        manualNote.style.display = 'none';
        stressTableEl.style.display = '';
      } else {
        manualNote.style.display = '';
        stressTableEl.style.display = 'none';
      }
    }

    if (stress) {
      ['rent10', 'vac5', 'opex10', 'combined'].forEach(function (k) {
        var row = stress[k];
        var noiEl = document.getElementById('dc-r-stress-' + k + '-noi');
        if (noiEl) noiEl.textContent = isFinite(row.noi) ? fmt(row.noi) : '—';
        _setDscr('dc-r-stress-' + k + '-dscr', row.dscr);
        _setMargin('dc-r-stress-' + k + '-margin', row.dscr, dcr);
      });
    }

    // Update property tax display (only visible in auto-NOI mode)
    var showPropTax = (netPropTax != null);
    var showTaxSavings = (showPropTax && taxSavings > 0);
    ['dc-r-proptax-label', 'dc-r-proptax'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = showPropTax ? '' : 'none';
    });
    ['dc-r-taxsave-label', 'dc-r-taxsave'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.style.display = showTaxSavings ? '' : 'none';
    });
    var propTaxEl = document.getElementById('dc-r-proptax');
    if (propTaxEl && showPropTax) propTaxEl.textContent = fmt(netPropTax);
    var taxSaveEl = document.getElementById('dc-r-taxsave');
    if (taxSaveEl && showTaxSavings) taxSaveEl.textContent = fmt(taxSavings);

    // Update gap note (legacy)
    var note = document.getElementById('dc-gap-note');
    if (note) {
      if (tdc > 0 && equity > 0) {
        var simpleGap = tdc - equity;
        if (simpleGap > 0) {
          note.textContent = 'Equity covers ' + fmtPct(equity / tdc) + ' of TDC.';
        } else {
          note.textContent = 'Equity exceeds TDC — verify basis and credit rate inputs.';
        }
        note.style.display = 'block';
      } else {
        note.style.display = 'none';
      }
    }

    // Swap the impact-fee S&U row label + amount based on the selected mode.
    // Grant mode shows the grant amount (a source contribution); loan mode
    // shows the annual debt service (an expense from cash flow).
    var impactLabelEl = document.getElementById('dc-su-impact-label');
    var impactNoteEl  = document.getElementById('dc-su-impact-note');
    var impactRowAmt  = impactMode === 'grant' ? impactGrant : impactDebtService;
    if (impactLabelEl) {
      impactLabelEl.textContent = impactMode === 'grant'
        ? 'Impact Fee Grant / Waiver (source — offsets basis)'
        : 'Impact Fee Loan Debt Service (annual)';
    }
    if (impactNoteEl) {
      impactNoteEl.textContent = impactMode === 'grant'
        ? 'Grant reduces eligible basis under §42(d)(5)(A); also a gap-filling source at closing.'
        : 'Included when Impact Fee Loan is selected as a soft-funding source';
    }

    // Update Sources & Uses table
    var su = {
      equity:   { amt: equity,        id: 'dc-su-equity' },
      mortgage: { amt: mortgage,       id: 'dc-su-mortgage' },
      deferred: { amt: deferredDevFee, id: 'dc-su-deferred' },
      impactds: { amt: impactRowAmt,   id: 'dc-su-impact-ds' },
      gap:      { amt: gap,            id: 'dc-su-gap' },
      tdc:      { amt: tdc,            id: 'dc-su-tdc' }
    };
    ['equity', 'mortgage', 'deferred', 'impactds', 'gap', 'tdc'].forEach(function (key) {
      var row = su[key];
      var amtEl = document.getElementById(row.id);
      var pctEl = document.getElementById(row.id + '-pct');
      if (amtEl) amtEl.textContent = tdc > 0 ? fmt(row.amt) : '—';
      if (pctEl) pctEl.textContent = tdc > 0 ? fmtPct(row.amt / tdc) : '—';
    });

    // Color the gap cell: red if positive (funding needed), green if zero
    var gapAmtEl = document.getElementById('dc-su-gap');
    if (gapAmtEl && tdc > 0) {
      gapAmtEl.style.color = gap > 0 ? 'var(--chart-7)' : 'var(--accent)';
    }

    // Dispatch soft-funding refresh so the breakdown panel updates
    try {
      var is4Pct = _creditRate < 0.05;
      document.dispatchEvent(new CustomEvent('soft-funding:refresh', {
        detail: {
          countyFips: _countyFips,
          executionType: is4Pct ? '4%' : '9%',
          gapAmount: Math.max(0, gap)
        }
      }));
    } catch (_) {}

    // ── Tornado sensitivity chart ───────────────────────────────────
    // Renders 4 sensitivity bars showing how key variables affect the deal.
    if (window.TornadoSensitivity && tdc > 0 && document.getElementById('tornadoChartMount')) {
      try {
        var eqP = equityPrice || 0.90;
        var ir  = interestRate || 6.5;
        var vu  = safeVal('dc-vacancy') || 7;
        var ou  = safeVal('dc-opex') || 450;
        var u   = units || 60;
        var acr = annualCredits || 0;

        // Equity pricing: ±$0.03
        var eqLo  = acr * CREDIT_YEARS * Math.max(0.70, eqP - 0.03);
        var eqHi  = acr * CREDIT_YEARS * Math.min(1.05, eqP + 0.03);

        // Interest rate: ±1% (lower rate = higher mortgage, higher rate = lower)
        var mcLo  = mortgageConstant(Math.min(0.12, (ir + 1)) / 100, term || 35);
        var mcHi  = mortgageConstant(Math.max(0.03, (ir - 1)) / 100, term || 35);
        var mortLo = (mcLo > 0 && noi > 0) ? (noi / dcr) / mcLo : 0;
        var mortHi = (mcHi > 0 && noi > 0) ? (noi / dcr) / mcHi : 0;

        // Compute EGI from available scope variables
        var _egi = (annualRents || 0) * (1 - (vu / 100));
        var _repRes = (safeVal('dc-rep-reserve') || 350) * u;

        // OpEx: ±$50/unit/month
        var noiLo = _egi - ((ou + 50) * 12 * u) - _repRes - (netPropTax || 0);
        var noiHi = _egi - (Math.max(200, ou - 50) * 12 * u) - _repRes - (netPropTax || 0);

        // Vacancy: ±2%
        var vacLoEgi = (annualRents || 0) * (1 - Math.min(0.15, (vu + 2) / 100));
        var vacHiEgi = (annualRents || 0) * (1 - Math.max(0.01, (vu - 2) / 100));

        window.TornadoSensitivity.render({
          factors: [
            { label: 'Equity Price', low: eqLo, high: eqHi, base: equity,
              lowLabel: fmt(eqLo), highLabel: fmt(eqHi),
              note: '$' + Math.max(0.70, eqP - 0.03).toFixed(2) + ' to $' + Math.min(1.05, eqP + 0.03).toFixed(2) + '/credit',
              color: 'var(--accent)' },
            { label: 'First Mortgage', low: mortLo, high: mortHi, base: mortgage,
              lowLabel: fmt(mortLo), highLabel: fmt(mortHi),
              note: 'Rate ' + Math.max(3, ir - 1).toFixed(1) + '% to ' + Math.min(12, ir + 1).toFixed(1) + '%',
              color: '#2563eb' },
            { label: 'NOI (OpEx)', low: noiLo, high: noiHi, base: noi,
              lowLabel: fmt(noiLo), highLabel: fmt(noiHi),
              note: 'OpEx $' + Math.max(200, ou - 50) + ' to $' + (ou + 50) + '/unit/mo',
              color: 'var(--warn)' },
            { label: 'NOI (Vacancy)', low: vacLoEgi, high: vacHiEgi, base: noi,
              lowLabel: fmt(vacLoEgi), highLabel: fmt(vacHiEgi),
              note: 'Vacancy ' + Math.max(1, vu - 2) + '% to ' + Math.min(15, vu + 2) + '%',
              color: '#059669' }
          ]
        }, 'tornadoChartMount');
      } catch (e) {
        console.warn('[deal-calculator] Tornado sensitivity error:', e.message);
      }
    }

    try { document.dispatchEvent(new CustomEvent('deal-calc:updated')); } catch(_) {}
  }

  // -------------------------------------------------------------------
  // AMI gap display + deal predictor integration
  // -------------------------------------------------------------------

  /**
   * Find the county record in the AMI gap data by FIPS.
   */
  function _findAmiGapCounty(fips) {
    if (!_amiGapData || !_amiGapData.counties || !fips) return null;
    var target = String(fips).padStart(5, '0');
    for (var i = 0; i < _amiGapData.counties.length; i++) {
      if (String(_amiGapData.counties[i].fips).padStart(5, '0') === target) {
        return _amiGapData.counties[i];
      }
    }
    return null;
  }

  /**
   * Render AMI gap info panel when a county is selected.
   */
  function _renderAmiGapInfo(fips) {
    var container = document.getElementById('dc-ami-gap-info');
    if (!container) {
      // Create the container after the FMR note
      var fmrNote = document.getElementById('dc-fmr-note');
      if (!fmrNote) return;
      container = document.createElement('div');
      container.id = 'dc-ami-gap-info';
      container.style.cssText = 'font-size:var(--tiny);color:var(--muted);margin-bottom:var(--sp2);' +
        'padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);';
      fmrNote.parentNode.insertBefore(container, fmrNote.nextSibling);
    }
    var county = _findAmiGapCounty(fips);
    if (!county) {
      container.hidden = true;
      return;
    }
    var gaps = county.gap_units_minus_households_le_ami_pct || {};
    var gap30 = Math.abs(gaps['30'] || 0);
    var gap50 = Math.abs(gaps['50'] || 0);
    var gap60 = Math.abs(gaps['60'] || 0);
    container.innerHTML =
      '<strong style="color:var(--accent);">Affordability Gap — ' + (county.county_name || '') + '</strong><br>' +
      '30% AMI: ' + gap30.toLocaleString() + ' units needed' +
      ' &bull; 50% AMI: ' + gap50.toLocaleString() + ' units needed' +
      ' &bull; 60% AMI: ' + gap60.toLocaleString() + ' units needed';
    container.hidden = false;
  }

  /**
   * Call the deal predictor (enhanced or base) when county changes,
   * passing AMI gap data from the calculator inputs.
   */
  function _runDealPredictor(fips) {
    var predictor = window.LIHTCDealPredictor;
    if (!predictor) return;

    var units = parseInt((document.getElementById('dc-units') || {}).value, 10) || 60;
    var dealInputs = {
      geoid: fips || undefined,
      countyFips: fips || null,    // drives hard-cost geographic multiplier in predictor
      proposedUnits: units,
      isQct: !!(document.getElementById('dc-qct-dda') || {}).checked
    };

    // AMI gap data
    var county = _findAmiGapCounty(fips);
    if (county) {
      var gaps = county.gap_units_minus_households_le_ami_pct || {};
      dealInputs.ami30UnitsNeeded = Math.abs(gaps['30'] || 0);
      dealInputs.ami50UnitsNeeded = Math.abs(gaps['50'] || 0);
      dealInputs.ami60UnitsNeeded = Math.abs(gaps['60'] || 0);
    }

    // Use enhanced predictor when available
    var result;
    if (window.LIHTCDealPredictorEnhanced) {
      result = window.LIHTCDealPredictorEnhanced.predictEnhanced(dealInputs);
    } else {
      result = { base: predictor.predictConcept(dealInputs) };
    }

    // Render a compact concept recommendation below the calculator
    var recCard = document.getElementById('dc-concept-rec');
    if (!recCard) {
      var mount = document.getElementById('dealCalcMount');
      if (!mount) return;
      recCard = document.createElement('div');
      recCard.id = 'dc-concept-rec';
      recCard.style.cssText = 'margin-top:var(--sp3);padding:var(--sp2) var(--sp3);' +
        'border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);';
      mount.appendChild(recCard);
    }
    var rec = result.base;
    recCard.innerHTML =
      '<h3 style="margin:0 0 0.5rem;font-size:0.95rem;">' +
      (rec.confidenceBadge || '') + ' Concept Recommendation: <strong>' +
      rec.recommendedExecution + ' ' + (rec.conceptType || '').charAt(0).toUpperCase() +
      (rec.conceptType || '').slice(1) + ' Housing</strong>' +
      ' <span style="font-size:0.75em;color:var(--muted);">' + rec.confidence + ' confidence</span></h3>' +
      '<ul style="margin:0;padding-left:1.25rem;font-size:var(--small);">' +
      (rec.keyRationale || []).map(function (r) { return '<li>' + r + '</li>'; }).join('') +
      '</ul>';
    recCard.hidden = false;
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
      // Fix #8: retry until HudFmr deferred script initialises (up to ~7.5 s).
      // After populating, pre-select the county from WorkflowState / SiteState.
      var _populateRetries = 0;
      var _afterPopulate = function () {
        // Pre-select jurisdiction county so user doesn't re-enter it
        var fips = null;
        try {
          var _proj = window.WorkflowState && window.WorkflowState.getActiveProject();
          var _jx   = _proj && (_proj.jurisdiction || (_proj.steps && _proj.steps.jurisdiction));
          if (_jx && _jx.countyFips) fips = _jx.countyFips;
        } catch (_) {}
        if (!fips) {
          try {
            var _sc = window.SiteState && window.SiteState.getCounty();
            if (_sc && _sc.fips) fips = _sc.fips;
          } catch (_) {}
        }
        if (fips) {
          for (var _i = 0; _i < countySel.options.length; _i++) {
            if (countySel.options[_i].value === fips) {
              countySel.value = fips;
              countySel.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }
      };
      var _populated = false;
      var _doPopulate = function () {
        if (_populated) return;          // already done
        if (window.HudFmr) {
          if (window.HudFmr.isLoaded()) {
            _populated = true;
            populateCountySelector(countySel);
            _afterPopulate();
          } else {
            window.HudFmr.load().then(function () {
              if (_populated) return;
              _populated = true;
              populateCountySelector(countySel);
              _afterPopulate();
            });
          }
        } else if (++_populateRetries < 15) {
          // HudFmr script hasn't initialised yet — retry
          setTimeout(_doPopulate, 500);
        }
      };
      // Listen for the custom event (faster path) AND keep polling as fallback
      document.addEventListener('HudFmr:loaded', _doPopulate);
      setTimeout(_doPopulate, 200);

      countySel.addEventListener('change', function () {
        var fips = this.value;
        if (fips) {
          updateAmiLimitsFromFmr(fips);
        } else {
          // No county selected — clear rent limits rather than defaulting to
          // Denver MSA, which systematically over-estimates rent capacity
          // for the ~56 non-metro CO counties.
          _amiLimits = null;
          _countyFips = null;
        }
        // Update the FMR note
        var noteEl = document.getElementById('dc-fmr-note');
        if (noteEl) {
          if (_amiLimits) {
            noteEl.textContent = 'Gross rent limits: ' +
              [30, 40, 50, 60].map(function (p) {
                return p + '% AMI = $' + _amiLimits[p].toLocaleString();
              }).join(' \u2022 ');
            noteEl.style.color = '';
          } else {
            noteEl.textContent = 'Select a county above to load HUD-published AMI rent limits for that county.';
            noteEl.style.color = 'var(--warn, #e6a23c)';
          }
        }
        _renderAmiGapInfo(fips);
        _runDealPredictor(fips);
        recalculate();
      });

    // Load AMI gap data
    var _gapResolver = (typeof window.resolveAssetUrl === 'function') ? window.resolveAssetUrl : function (p) { return p; };
    fetch(_gapResolver('data/co_ami_gap_by_county.json')).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      _amiGapData = data;
    }).catch(function () {
      console.warn('[deal-calculator] AMI gap data unavailable');
      if (window.CohoToast) window.CohoToast.show('AMI gap data unavailable — some affordability context may be missing.', 'warn');
    });
    }
  }

  // -------------------------------------------------------------------
  // Designation context — called by the market-analysis pipeline after
  // a site has been checked against QCT/DDA overlay polygons.
  // -------------------------------------------------------------------

  /**
   * Update the QCT/DDA indicator in the deal calculator UI.
   * Called by the market-analysis controller once checkDesignation() resolves.
   *
   * When basis_boost_eligible is true the checkbox is pre-checked and the
   * note is shown so the user is aware of the designation.  The basis %
   * slider is intentionally NOT auto-adjusted — the user retains full
   * manual control per the principle that the designation does not
   * automatically apply the 130% boost (IRC §42(d)(5)(B) requires election).
   *
   * @param {boolean} basisBoostEligible - True when site is in a QCT or DDA.
   */
  function setDesignationContext(basisBoostEligible) {
    var chk  = document.getElementById('dc-qct-dda');
    var note = document.getElementById('dc-qct-dda-note');
    if (!chk || !note) return; // calculator not yet mounted — intentional no-op
    chk.checked        = !!basisBoostEligible;
    note.style.display = basisBoostEligible ? 'block' : 'none';
  }

  // SCOPE BOUNDARY — do not expand this file into a deal predictor or scoring engine.
  // This calculator is intentionally limited to early-stage feasibility sizing:
  // eligible basis, annual credits, rough equity, and gap-to-subsidy estimates.
  //
  // A full 4%/9% deal-predictor (CHFA QAP scoring, soft-debt layering, investor
  // pricing) is out of scope here and requires an explicit product decision before
  // implementation. Adding automated award-probability scoring or parcel-level
  // conclusions would cross the platform's "screening, not certainty" boundary.
  window.__DealCalc = {
    init: init,
    recalculate: recalculate,
    setDesignationContext: setDesignationContext,
    /* Exposed for testing — pure function, no DOM access */
    computeDscrStressScenarios: computeDscrStressScenarios
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
