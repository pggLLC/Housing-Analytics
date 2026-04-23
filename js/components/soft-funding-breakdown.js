/**
 * js/components/soft-funding-breakdown.js
 * Renders eligible soft-funding programs below the Sources & Uses gap line
 * on the Deal Calculator page.
 *
 * Shows:
 *   - All eligible programs for the selected county + execution type (9%/4%)
 *   - Per-program: available $, max per project, deadline, competitiveness
 *   - PAB volume cap warning for 4% deals
 *   - Total theoretical soft-funding capacity vs the gap
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

    var pab = SFT.getPabStatus();
    if (!pab) return;

    var pctUsed = pab.pctCommitted;
    var isUrgent = pctUsed >= 60;

    // Find or create mount
    var mount = existing;
    if (!mount) {
      var pabNote = document.getElementById('dc-rate-pab-note');
      if (!pabNote) return;
      mount = document.createElement('div');
      mount.id = _pabMountId;
      pabNote.parentNode.insertBefore(mount, pabNote.nextSibling);
    }

    var barColor = isUrgent ? 'var(--warn, #d97706)' : 'var(--accent, #096e65)';
    var bgColor = isUrgent ? 'var(--warn-dim, #fef3c7)' : 'var(--info-dim, #dbeafe)';
    var borderColor = isUrgent ? 'var(--warn, #d97706)' : 'var(--info, #2563eb)';

    mount.style.cssText = 'margin-top:8px;padding:8px 12px;border-left:3px solid ' + borderColor +
      ';border-radius:0 4px 4px 0;background:' + bgColor + ';font-size:.78rem;';
    mount.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
        '<strong style="color:' + barColor + ';">PAB Volume Cap: ' + pctUsed + '% Committed</strong>' +
        '<span style="color:var(--muted);font-size:.72rem;">' + _fmtDollars(pab.remaining) + ' of ' + _fmtDollars(pab.totalCap) + ' remaining</span>' +
      '</div>' +
      '<div style="height:6px;background:var(--border);border-radius:3px;margin:6px 0 4px;overflow:hidden;">' +
        '<div style="height:100%;width:' + Math.min(pctUsed, 100) + '%;background:' + barColor + ';border-radius:3px;transition:width .4s;"></div>' +
      '</div>' +
      (pab.warning ? '<div style="font-size:.72rem;color:' + barColor + ';margin-top:2px;">' + pab.warning + '</div>' : '') +
      (isUrgent ? '<div style="font-size:.72rem;color:var(--muted);margin-top:2px;">4% deals require PAB allocation before LIHTC determination. Apply early — when cap is exhausted, 4% deals cannot proceed until next calendar year.</div>' : '');
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
    var sum = SFT.sumEligible(countyFips, executionType);
    var updated = SFT.getLastUpdated();

    if (!programs || programs.length === 0) {
      mount.innerHTML = '<p style="font-size:.78rem;color:var(--muted);margin:0;">No active soft-funding programs found for this county and credit type.</p>';
      return;
    }

    // Gap coverage assessment
    var gapCoverage = '';
    if (typeof gapAmount === 'number' && gapAmount > 0 && sum.total > 0) {
      var coverPct = Math.min(100, Math.round(sum.total / gapAmount * 100));
      var coverColor = coverPct >= 100 ? 'var(--good, #047857)' : coverPct >= 50 ? 'var(--warn, #d97706)' : 'var(--bad, #dc2626)';
      gapCoverage =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 10px;border-radius:4px;background:var(--bg2);">' +
          '<span style="font-size:.78rem;color:var(--muted);">Theoretical coverage of gap:</span>' +
          '<strong style="color:' + coverColor + ';font-size:.85rem;">' + coverPct + '%</strong>' +
          '<span style="font-size:.72rem;color:var(--muted);">(' + _fmtDollars(sum.total) + ' available across ' + sum.programCount + ' programs vs ' + _fmtDollars(gapAmount) + ' gap)</span>' +
        '</div>' +
        (coverPct < 100 ? '<div style="font-size:.72rem;color:var(--muted);margin-bottom:6px;">Note: Not all programs can be stacked. Actual coverage depends on application success, timing, and program rules. Max per-project limits apply.</div>' : '');
    }

    // Build program rows
    var rows = '';
    for (var i = 0; i < programs.length; i++) {
      var p = programs[i];
      var hasAvail = p.available !== null && p.available > 0;
      var rowOpacity = hasAvail ? '1' : '0.55';
      var maxNote = p.maxPerProject ? ' (max ' + _fmtDollars(p.maxPerProject) + '/project)' : '';
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
        '<tr style="opacity:' + rowOpacity + ';border-bottom:1px solid var(--border);">' +
          '<td style="padding:5px 4px;font-size:.78rem;line-height:1.4;">' +
            '<strong>' + p.name + '</strong>' + amiNote + maxNote +
            (p.adminEntity ? '<br><span style="font-size:.68rem;color:var(--muted);">Admin: ' + p.adminEntity + '</span>' : '') +
            (p.warning ? '<br><span style="font-size:.68rem;color:var(--warn,#d97706);">' + p.warning + '</span>' : '') +
            restrictionsHtml +
          '</td>' +
          '<td style="text-align:right;padding:5px 4px;font-size:.78rem;font-weight:700;white-space:nowrap;">' +
            (hasAvail ? _fmtDollars(p.available) : '<span style="color:var(--muted);">—</span>') +
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
          '<span style="font-size:.68rem;font-weight:400;color:var(--muted);margin-left:auto;">Updated ' + (updated || '—') + '</span>' +
        '</summary>' +
        gapCoverage +
        '<table style="width:100%;border-collapse:collapse;font-size:.78rem;">' +
          '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Program</th>' +
            '<th style="text-align:right;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Available</th>' +
            '<th style="text-align:center;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Competition</th>' +
            '<th style="text-align:right;padding:4px;color:var(--muted);font-weight:600;font-size:.72rem;">Deadline</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
        '<p style="font-size:.68rem;color:var(--muted);margin:6px 0 0;">' +
          'Estimates only — verify availability with CHFA, DOH, or county housing offices before advising clients. ' +
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
