/**
 * js/components/soft-funding-breakdown.js
 * Renders eligible soft-funding programs below the Sources & Uses gap line
 * on the Deal Calculator page.
 *
 * Shows:
 *   - All eligible programs for the selected county + execution type (9%/4%)
 *   - Per-program: max per project (published rule), deadline, competitiveness,
 *     eligibility restrictions, admin entity
 *   - PAB volume cap qualitative warning for 4% deals
 *
 * ⚠ Dollar-figure policy (2026-04):
 *   This renderer intentionally does NOT display the `available`, `awarded`,
 *   or `capacity` fields from `data/policy/soft-funding-status.json`. Those
 *   figures are quarterly admin-maintained estimates that drift between
 *   refresh cycles; showing stale balances was confusing users. Tracker API
 *   methods (`sumEligible`, `getPabStatus`) still expose them for non-UI
 *   use, but the surface shown to users is verification-pointed, not
 *   dollar-valued. Verify current balances with the admin entity before
 *   citing to a client.
 *
 * Depends on: js/soft-funding-tracker.js (must load first)
 * Mount: renders into #dcSoftFundingBreakdown (created dynamically)
 */
(function (global) {
  'use strict';

  var _mountId = 'dcSoftFundingBreakdown';
  var _pabMountId = 'dcPabWarning';
  var _loaded = false;
  var _data = null;

  /* ── Formatting helpers ─────────────────────────────────────────── */

  function _escape(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _fmtDollars(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3).toLocaleString() + 'K';
    return '$' + n.toLocaleString();
  }

  function _competBadge(comp) {
    var colors = {
      high:     { bg: 'var(--warn-dim, #fef3c7)', text: 'var(--warn, #d97706)', label: 'High competition' },
      moderate: { bg: 'var(--info-dim, #dbeafe)',  text: 'var(--info, #2563eb)', label: 'Moderate' },
      low:      { bg: 'var(--good-dim, #d1fae5)',  text: 'var(--good, #047857)', label: 'Lower competition' }
    };
    var c = colors[comp] || colors.moderate;
    return '<span style="display:inline-block;padding:1px 6px;border-radius:3px;' +
      'font-size:.68rem;font-weight:600;background:' + c.bg + ';color:' + c.text + ';">' +
      c.label + '</span>';
  }

  function _deadlineBadge(days) {
    if (days === null || days === undefined) return '';
    if (days <= 0) return '<span style="color:var(--bad,#dc2626);font-size:.72rem;font-weight:600;">⚠ Past deadline</span>';
    if (days < 45) return '<span style="color:var(--warn,#d97706);font-size:.72rem;font-weight:600;">' + days + 'd remaining</span>';
    if (days < 90) return '<span style="color:var(--muted);font-size:.72rem;">' + days + 'd remaining</span>';
    return '';
  }

  /* ── Load soft funding data ─────────────────────────────────────── */

  function _ensureLoaded() {
    if (_loaded) return Promise.resolve();
    var SFT = global.SoftFundingTracker;
    if (SFT && SFT.isLoaded()) {
      _loaded = true;
      return Promise.resolve();
    }

    var base = global.APP_BASE_PATH || '';
    var url = base + 'data/policy/soft-funding-status.json';

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        _data = data;
        if (SFT && typeof SFT.load === 'function') {
          return SFT.load(data);
        }
      })
      .then(function () { _loaded = true; })
      .catch(function (err) {
        console.warn('[soft-funding-breakdown] Failed to load:', err.message);
        if (global.CohoToast) global.CohoToast.show('Soft funding data unavailable.', 'warn');
      });
  }

  /* ── Render PAB volume cap warning ──────────────────────────────── */

  function _renderPabWarning(is4Pct) {
    var existing = document.getElementById(_pabMountId);
    if (!is4Pct) {
      if (existing) existing.hidden = true;
      return;
    }

    var SFT = global.SoftFundingTracker;
    if (!SFT) return;

    // Qualitative PAB warning only — historical dollar/percentage figures
    // for the state PAB ceiling and committed-to-date were
    // admin-maintained estimates that drifted; users are now directed
    // to CHFA's live tracker rather than shown a synthesized progress bar.
    // Find or create mount
    var mount = existing;
    if (!mount) {
      var pabNote = document.getElementById('dc-rate-pab-note');
      if (!pabNote) return;
      mount = document.createElement('div');
      mount.id = _pabMountId;
      pabNote.parentNode.insertBefore(mount, pabNote.nextSibling);
    }

    mount.style.cssText = 'margin-top:8px;padding:8px 12px;border-left:3px solid var(--info, #2563eb)' +
      ';border-radius:0 4px 4px 0;background:var(--info-dim, #dbeafe);font-size:.78rem;';
    mount.innerHTML =
      '<strong style="color:var(--info, #2563eb);">PAB Volume Cap — verify current availability</strong>' +
      '<p style="font-size:.72rem;color:var(--muted);margin:4px 0 0;line-height:1.5;">' +
        '4% deals require Private Activity Bond (PAB) allocation before LIHTC determination. ' +
        'Colorado\u2019s state PAB ceiling is set annually and commitments accrue through the year — ' +
        'apply early, and when the cap is exhausted 4% deals cannot proceed until the next calendar year. ' +
        'Check current cap status at ' +
        '<a href="https://cdola.colorado.gov/privateactivitybonds" target="_blank" rel="noopener">CDOLA\u2019s PAB program page</a> ' +
        'or confirm directly with CHFA before finalizing a 4% structure.' +
      '</p>';
    mount.hidden = false;
  }

  /* ── Render soft-funding program table ──────────────────────────── */

  function render(countyFips, executionType, gapAmount) {
    _ensureLoaded().then(function () {
      _renderInner(countyFips, executionType, gapAmount);
    });
  }

  function _renderInner(countyFips, executionType, gapAmount) {
    var SFT = global.SoftFundingTracker;
    if (!SFT || !SFT.isLoaded()) return;

    var is4Pct = executionType === '4%';
    _renderPabWarning(is4Pct);
    _renderOzCallout();

    // Find or create the breakdown mount below the Sources & Uses table
    var mount = document.getElementById(_mountId);
    if (!mount) {
      var suTable = document.getElementById('dc-su-table');
      if (!suTable || !suTable.parentElement) return;
      mount = document.createElement('div');
      mount.id = _mountId;
      mount.style.cssText = 'margin-top:12px;';
      suTable.parentElement.appendChild(mount);
    }

    if (!countyFips) {
      mount.innerHTML = '<p style="font-size:.78rem;color:var(--muted);margin:0;">Select a county to see eligible soft-funding programs.</p>';
      return;
    }

    var programs = SFT.getEligiblePrograms(countyFips, executionType);
    var updated = SFT.getLastUpdated();

    if (!programs || programs.length === 0) {
      mount.innerHTML = '<p style="font-size:.78rem;color:var(--muted);margin:0;">No active soft-funding programs found for this county and credit type.</p>';
      return;
    }

    // Dollar-figure policy (2026-04): dollar balances from the underlying
    // JSON (available/awarded/capacity) are intentionally NOT rendered —
    // quarterly admin-maintained estimates drift too quickly to show
    // live. Users see the qualitative program list and are pointed at
    // the admin entity for a current balance. `gapAmount` is accepted
    // for interface compatibility but no longer drives a dollar-coverage
    // readout.
    void gapAmount;

    // Build program rows
    var rows = '';
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      var maxNote = p.maxPerProject ? ' (published max ' + _fmtDollars(p.maxPerProject) + '/project)' : '';
      var amiNote = p.amiTargeting ? '<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:.66rem;font-weight:600;background:var(--accent-dim,#d1fae5);color:var(--accent,#096e65);margin-left:4px;">' + p.amiTargeting + '</span>' : '';

      // Restrictions — rendered as collapsible <details> inside the program
      // cell so the table stays scannable but the user can expand any row
      // to see eligibility + stacking rules before committing to an app.
      var restrictionsHtml = '';
      if (Array.isArray(p.restrictions) && p.restrictions.length) {
        restrictionsHtml =
          '<details style="margin-top:3px;">' +
            '<summary style="cursor:pointer;font-size:.68rem;color:var(--link,#054a42);font-weight:600;list-style:none;">' +
              '▸ Restrictions &amp; eligibility (' + p.restrictions.length + ')' +
            '</summary>' +
            '<ul style="margin:4px 0 0 16px;padding:0;font-size:.72rem;color:var(--muted);line-height:1.5;">' +
              p.restrictions.map(function (r) {
                return '<li style="margin-bottom:2px;">' + _escape(r) + '</li>';
              }).join('') +
            '</ul>' +
          '</details>';
      }

      rows +=
        '<tr style="border-bottom:1px solid var(--border);">' +
          '<td style="padding:5px 4px;font-size:.78rem;line-height:1.4;">' +
            '<strong>' + p.name + '</strong>' + amiNote + maxNote +
            (p.adminEntity ? '<br><span style="font-size:.68rem;color:var(--muted);">Admin: ' + p.adminEntity + '</span>' : '') +
            (p.warning ? '<br><span style="font-size:.68rem;color:var(--warn,#d97706);">' + p.warning + '</span>' : '') +
            restrictionsHtml +
          '</td>' +
          '<td style="text-align:center;padding:5px 4px;">' + _competBadge(p.competitiveness) + '</td>' +
          '<td style="text-align:right;padding:5px 4px;font-size:.75rem;white-space:nowrap;">' +
            (p.deadline ? p.deadline : '—') +
            '<br>' + _deadlineBadge(p.daysRemaining) +
          '</td>' +
        '</tr>';
    }

    mount.innerHTML =
      '<details open style="margin-top:4px;">' +
        '<summary style="font-size:.82rem;font-weight:700;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:4px;padding:4px 0;">' +
          '<span>&#9660;</span> Eligible Soft-Funding Sources (' + programs.length + ' programs)' +
          '<span style="font-size:.68rem;font-weight:400;color:var(--muted);margin-left:auto;">Last catalog update ' + (updated || '—') + '</span>' +
        '</summary>' +
        // Policy banner explaining the missing dollar column.
        '<div role="note" style="margin:4px 0 8px;padding:6px 10px;border-left:3px solid var(--info,#2563eb);border-radius:0 4px 4px 0;background:var(--info-dim,#dbeafe);font-size:.72rem;line-height:1.45;color:var(--text);">' +
          '<strong style="color:var(--info,#2563eb);">Balances not shown.</strong> ' +
          'Dollar-level availability for these programs drifts quarterly and is best confirmed directly with the admin entity. ' +
          'This catalog shows eligibility, deadline, and competition level only — call CHFA, DOLA, or the listed admin before modelling a specific source.' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">' +
          '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Program</th>' +
            '<th style="text-align:center;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Competition</th>' +
            '<th style="text-align:right;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Deadline</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        '<p style="font-size:.68rem;color:var(--muted);margin:6px 0 0;">' +
          'Catalog only — verify availability with CHFA, DOH, or county housing offices before advising clients. ' +
          'Programs may have additional eligibility criteria not shown here.' +
        '</p>' +
      '</details>';
  }

  /* ── OZ equity callout ────────────────────────────────────────── */

  function _renderOzCallout() {
    var mountId = 'dcOzCallout';
    var existing = document.getElementById(mountId);

    // Check if site is in an OZ via SiteState PMA results
    var SS = global.SiteState;
    var pma = SS && typeof SS.getPmaResults === 'function' ? SS.getPmaResults() : null;
    var opps = pma && pma.opportunities;
    var isOz = opps && (opps.qualifiedOpportunityZone || (opps.opportunityZoneShare && opps.opportunityZoneShare > 0));

    if (!isOz) {
      if (existing) existing.hidden = true;
      return;
    }

    // Find or create mount after the soft-funding breakdown
    var mount = existing;
    if (!mount) {
      var sfMount = document.getElementById(_mountId);
      if (!sfMount || !sfMount.parentElement) return;
      mount = document.createElement('div');
      mount.id = mountId;
      sfMount.parentElement.insertBefore(mount, sfMount.nextSibling);
    }

    mount.style.cssText = 'margin-top:10px;padding:10px 14px;border-left:3px solid var(--accent,#096e65);border-radius:0 4px 4px 0;background:color-mix(in oklab, var(--card,#fff) 90%, var(--accent,#096e65) 10%);';
    mount.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
        '<span style="display:inline-block;padding:2px 7px;border-radius:3px;font-size:.72rem;font-weight:700;background:var(--accent,#096e65);color:#fff;">OZ</span>' +
        '<strong style="font-size:.82rem;color:var(--text);">Opportunity Zone Equity Potential</strong>' +
      '</div>' +
      '<p style="font-size:.78rem;color:var(--muted);margin:0 0 4px;line-height:1.5;">' +
        'This site is in a designated Qualified Opportunity Zone (QOZ). Investors with unrealized capital gains ' +
        'may defer taxes by investing in QOZ projects under IRC §1400Z-2. OZ equity can layer with LIHTC but ' +
        'requires complex dual-structure legal arrangements.' +
      '</p>' +
      '<p style="font-size:.72rem;color:var(--muted);margin:0;line-height:1.4;">' +
        '<strong>Note:</strong> OZ designation expires 12/31/2028. Remaining deferral benefit diminishes each year. ' +
        'Consult specialized OZ legal counsel before structuring. OZ equity is market-dependent and not a guaranteed source.' +
      '</p>';
    mount.hidden = false;
  }

  /* ── Init: load data and listen for deal calc changes ───────────── */

  function init() {
    _ensureLoaded().then(function () {
      // Initial render if county is already selected
      _tryRender();
    });

    // Re-render when county or credit type changes
    document.addEventListener('soft-funding:refresh', function (e) {
      var d = (e && e.detail) || {};
      render(d.countyFips, d.executionType, d.gapAmount);
    });
  }

  function _tryRender() {
    // Read current state from deal calculator inputs
    var countySel = document.getElementById('dc-county-select');
    var fips = countySel ? countySel.value : null;
    if (!fips) return;

    var is4Pct = false;
    var rate4 = document.getElementById('dc-rate-4');
    if (rate4 && rate4.checked) is4Pct = true;
    var execType = is4Pct ? '4%' : '9%';

    // Read gap from the S&U table
    var gapEl = document.getElementById('dc-su-gap');
    var gapAmt = 0;
    if (gapEl) {
      var gapText = gapEl.textContent.replace(/[$,\s]/g, '');
      gapAmt = parseFloat(gapText) || 0;
    }

    render(fips, execType, gapAmt);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 600); });
  } else {
    setTimeout(init, 600);
  }

  global.SoftFundingBreakdown = {
    render: render,
    refresh: _tryRender
  };

})(typeof window !== 'undefined' ? window : this);
