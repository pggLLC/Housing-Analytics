(function () {
  'use strict';

  // HUD FY2025 Colorado AMI gross rent limits — Denver-Aurora-Lakewood MSA default.
  // These are overridden dynamically when HudFmr is loaded and a county is selected.
  // Formula: (AMI × %AMI × 0.30) / 12
  var _amiLimits = { 30: 930, 40: 1240, 50: 1550, 60: 1860 };
  var _countyFips = null;   // 5-digit FIPS of the currently selected county
  var _creditRate = 0.09;   // current credit rate — updated by scenario toggle
  const EQUITY_PRICE_DEFAULT = 0.90;  // per dollar of annual credit (default)
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
    LIHTC Feasibility Calculator
  </h2>
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
        <div id="dc-fmr-note" style="font-size:var(--tiny);color:var(--muted);margin-top:-0.25rem;margin-bottom:var(--sp2);">
          Gross rent limits: 30% AMI = $930 &bull; 40% = $1,240 &bull; 50% = $1,550 &bull; 60% = $1,860
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
            When checked, NOI = Gross Rents × (1 − Vacancy) − Operating Expenses − Replacement Reserve
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
            <span style="font-size:var(--tiny);color:var(--muted);">Typical LIHTC: $400–$600/unit/month (includes mgmt, maintenance, insurance, taxes)</span>
          </label>
          <label style="display:block;margin-bottom:var(--sp2);">
            <span style="font-size:var(--small);color:var(--muted);">Replacement Reserve ($/unit/year)</span>
            <input id="dc-rep-reserve" type="number" min="0" step="25" value="350"
              style="display:block;width:100%;margin-top:0.25rem;padding:0.4rem 0.5rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg2);color:var(--text);">
            <span style="font-size:var(--tiny);color:var(--muted);">CHFA minimum: $250–$400/unit/year</span>
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
    </div>

    <!-- Outputs column -->
    <div>
      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">LIHTC Credit Estimates</legend>
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
      </fieldset>

      <fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp3);margin-bottom:var(--sp3);">
        <legend style="font-size:var(--small);font-weight:700;padding:0 0.4rem;">Supportable First Mortgage (estimate)</legend>
        <dl id="dc-mortgage-results" style="display:grid;grid-template-columns:1fr auto;gap:0.5rem 1rem;font-size:var(--small);">
          <dt style="color:var(--muted);">Mortgage Constant (annual)</dt>
          <dd id="dc-r-mc" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Supportable First Mortgage</dt>
          <dd id="dc-r-mortgage" style="font-weight:700;text-align:right;color:var(--accent);">—</dd>

          <dt style="color:var(--muted);">Cap Rate (NOI / TDC)</dt>
          <dd id="dc-r-cap-rate" style="font-weight:700;text-align:right;">—</dd>

          <dt style="color:var(--muted);">Break-Even Occupancy</dt>
          <dd id="dc-r-beo" style="font-weight:700;text-align:right;">—</dd>
        </dl>
        <p style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp1);">Cap rate and break-even occupancy require auto-compute NOI to be enabled.</p>
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
      'dc-vacancy', 'dc-opex', 'dc-rep-reserve'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculate);
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

    // Credit rate scenario toggle
    ['dc-rate-9', 'dc-rate-4'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', function () {
          _creditRate = parseFloat(this.value);
          var pabNote = document.getElementById('dc-rate-pab-note');
          if (pabNote) pabNote.style.display = (this.value === '0.04') ? 'block' : 'none';
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

    // LIHTC credit calculations
    var eligibleBasis = tdc * basisPct;
    var annualCredits = eligibleBasis * _creditRate;
    var equity = annualCredits * CREDIT_YEARS * equityPrice;

    // Rent income — sum checked AMI-tier units
    var annualRents = 0;
    var amiUnitSum = 0;
    [30, 40, 50, 60].forEach(function (pct) {
      var chk = document.getElementById('dc-chk-' + pct);
      var uInput = document.getElementById('dc-units-' + pct);
      if (chk && uInput) {
        var u = parseInt(uInput.value, 10) || 0;
        if (chk.checked) {
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
    if (autoNoi && autoNoi.checked) {
      var vacancyPct = (safeVal('dc-vacancy') || 5) / 100;
      var opexPerUnitMonth = safeVal('dc-opex') || 450;
      var repReservePerUnit = safeVal('dc-rep-reserve') || 350;
      var effectiveGrossIncome = annualRents * (1 - vacancyPct);
      annualOpex = opexPerUnitMonth * 12 * (units || 60);
      annualRepReserve = repReservePerUnit * (units || 60);
      noi = effectiveGrossIncome - annualOpex - annualRepReserve;
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
          ? Math.min((annualOpex + annualRepReserve + annualDebtService) / annualRents, 1)
          : null)
      : null;

    // Sources & uses — deferred dev fee fills gap before subordinate debt is needed
    var gap = tdc - equity - mortgage - deferredDevFee;

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

    // Update Sources & Uses table
    var su = {
      equity:   { amt: equity,        id: 'dc-su-equity' },
      mortgage: { amt: mortgage,       id: 'dc-su-mortgage' },
      deferred: { amt: deferredDevFee, id: 'dc-su-deferred' },
      gap:      { amt: gap,            id: 'dc-su-gap' },
      tdc:      { amt: tdc,            id: 'dc-su-tdc' }
    };
    ['equity', 'mortgage', 'deferred', 'gap', 'tdc'].forEach(function (key) {
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
  window.__DealCalc = { init: init, recalculate: recalculate, setDesignationContext: setDesignationContext };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
