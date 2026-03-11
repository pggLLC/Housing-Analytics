(function () {
  'use strict';

  // 2025 HUD Colorado AMI gross rent limits (Denver-Aurora-Lakewood MSA,
  // 4-person household, monthly). Based on 4-person AMI = $124,100.
  // Formula: (AMI × %AMI × 0.30) / 12. May vary by county — verify locally.
  const AMI_LIMITS = { 30: 930, 40: 1240, 50: 1550, 60: 1860 };
  const CREDIT_RATE = 0.09;   // 9% LIHTC (new construction)
  const EQUITY_PRICE = 0.90;  // per dollar of annual credit
  const CREDIT_YEARS = 10;

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
        annualRents += u * AMI_LIMITS[pct] * 12;
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
  // Public API
  // -------------------------------------------------------------------
  function init() {
    var mount = document.getElementById('dealCalcMount');
    if (!mount) return;
    render(mount);
  }

  window.__DealCalc = { init: init, recalculate: recalculate };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
