/**
 * js/components/tax-credit-equity-markets.js
 * Shared render helpers for the Tax Credit Equity Markets insight pages.
 */
(function (global) {
  'use strict';

  var DATA_URLS = {
    legislation: 'data/policy/tax-credit-legislation.json',
    transferPricing: 'data/market/tax-credit-transfer-pricing.json',
    lihtcBenchmark: 'data/market/novogradac-equity-pricing.json',
    lihtcHistory: 'data/market/lihtc-equity-pricing-history.json'
  };

  var CREDIT_EXPLAINER_ROWS = [
    {
      id: 'lihtc-9',
      credit: 'LIHTC 9%',
      statute: 'IRC §42',
      stream: '10-year credit stream; 15-year compliance and recapture period.',
      transfer: 'Not transferable. Investor must enter a partnership/syndication structure.',
      taxTreatment: 'Bundled with depreciation losses and long compliance risk.',
      direction: 'Longer stream and syndication cost push price below $1.00; CRA demand can pull hot markets higher.'
    },
    {
      id: 'lihtc-4',
      credit: 'LIHTC 4%',
      statute: 'IRC §42',
      stream: '10-year credit stream; 15-year compliance and recapture period.',
      transfer: 'Not transferable. Investor must own an equity interest.',
      taxTreatment: 'Bond-deal supply and depreciation shape the investor return.',
      direction: 'Bond volume and the new 25% test expand supply, which can pressure cents-per-dollar down.'
    },
    {
      id: 'htc',
      credit: 'Federal HTC',
      statute: 'IRC §47',
      stream: '20% rehabilitation credit claimed ratably over 5 years.',
      transfer: 'Not transferable. Syndicated through ownership structures.',
      taxTreatment: 'Pricing depends on rehab risk, basis certification, and recapture exposure.',
      direction: 'Shorter stream helps pricing, but smaller/niche deal flow keeps the buyer pool narrower.'
    },
    {
      id: 'nmtc',
      credit: 'NMTC',
      statute: 'IRC §45D',
      stream: '39% over 7 years: 5% for the first 3 years, then 6% for the next 4 years.',
      transfer: 'Not transferable. Uses CDE allocation and partnership/leverage structures.',
      taxTreatment: 'Pricing is structure-heavy and tied to allocation rounds and leverage.',
      direction: 'Permanent extension removes extender risk, but allocation scarcity and structure still drive pricing.'
    },
    {
      id: 'itc',
      credit: 'ITC / 48E',
      statute: 'IRC §§48, 48E, 6418',
      stream: 'One-time credit in the placed-in-service year; 5-year recapture exposure.',
      transfer: 'Transferable for cash under §6418.',
      taxTreatment: '§6418 transfer proceeds are excluded from seller income; buyer discount is not taxed as income.',
      direction: 'Shorter stream and transferability support prices close to $1.00, discounted for recapture and diligence risk.'
    },
    {
      id: 'ptc',
      credit: 'PTC / 45Y',
      statute: 'IRC §§45, 45Y, 6418',
      stream: 'Per-kWh production credit over 10 years; payment depends on actual generation.',
      transfer: 'Transferable for cash under §6418.',
      taxTreatment: 'Buyer needs tax appetite; §6418 cash sale is structurally simpler than syndication.',
      direction: 'No ITC-style recapture risk can make PTC transfers price richer than ITC transfers.'
    }
  ];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dollars(value) {
    return typeof value === 'number' && isFinite(value) ? '$' + value.toFixed(2) : 'Value not yet verified';
  }

  function statusLabel(status) {
    return {
      enacted: 'Enacted',
      proposed: 'Proposed',
      'rule-pending': 'Rule-pending',
      'phased-out': 'Phased-out',
      expired: 'Expired',
      verified: 'Verified',
      VERIFY: 'Not yet verified'
    }[status] || 'Watchlist';
  }

  // Use the site-theme pill classes — their token pairs are asserted >= 4.5:1
  // in BOTH light and dark mode by test/wcag-pill-contrast.test.js (F181).
  function statusClass(status) {
    if (status === 'enacted' || status === 'verified') return 'pill good';
    if (status === 'proposed' || status === 'rule-pending' || status === 'VERIFY') return 'pill warn';
    return 'pill bad';
  }

  function fetchJson(url) {
    var resolved = global.resolveAssetUrl ? global.resolveAssetUrl(url) : url;
    return fetch(resolved, { cache: 'no-cache' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function renderLegislationWatch(target, doc, opts) {
    if (!target) return;
    var options = opts || {};
    var entries = (doc && Array.isArray(doc.entries) ? doc.entries : [])
      .filter(function (entry) {
        var scoped = (options.scope ? [options.scope] : []).concat(options.includeScopes || []);
        return !scoped.length || scoped.indexOf(entry.scope) !== -1;
      });
    if (!entries.length) {
      target.innerHTML = '<p style="color:var(--muted);">No policy entries loaded.</p>';
      return;
    }
    var summary = global.ReviewStatus ? global.ReviewStatus.summaryHtml(entries, null, 'policy entries') : '';
    target.innerHTML = summary + entries.map(function (entry) {
      var meta = [
        entry.effective_date ? 'Effective ' + entry.effective_date : null,
        entry.sunset_date ? 'Sunset ' + entry.sunset_date : null,
        entry.last_verified ? 'Verified ' + entry.last_verified : null
      ].filter(Boolean).join(' · ');
      return '<article class="chart-card" data-policy-id="' + esc(entry.id) + '" style="padding:var(--sp3);">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--sp2);">' +
          '<div>' +
            '<h3 style="margin:0 0 var(--sp1);font-size:1rem;">' + esc(entry.title) + '</h3>' +
            '<p style="margin:0;color:var(--muted);font-size:var(--small);line-height:1.55;">' + esc(entry.pricing_impact) + '</p>' +
          '</div>' +
          '<span class="' + statusClass(entry.status) + '" style="font-size:var(--tiny);white-space:nowrap;">' + esc(statusLabel(entry.status)) + '</span>' +
        '</div>' +
        '<div style="font-size:var(--tiny);color:var(--muted);margin-top:var(--sp2);display:flex;flex-wrap:wrap;gap:.5rem;">' +
          '<span>' + esc(meta || 'Date pending') + '</span>' +
          global.ProvenanceLabel.html(entry) +
        '</div>' +
        (global.ReviewStatus ? global.ReviewStatus.html(entry) : '') +
      '</article>';
    }).join('');
  }

  function renderTransferPricing(target, doc) {
    if (!target) return;
    var markets = doc && Array.isArray(doc.markets) ? doc.markets : [];
    target.innerHTML = '<table><thead><tr><th>Market</th><th>Scope</th><th>Price</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
      markets.map(function (entry) {
        var price = entry.price_low == null || entry.price_high == null
          ? 'Value not yet verified'
          : entry.price_low === entry.price_high
            ? '$' + String(Math.round(entry.price_low * 1000) / 1000) + ' average'
            : dollars(entry.price_low) + '-' + dollars(entry.price_high);
        return '<tr data-transfer-id="' + esc(entry.id) + '">' +
          '<td><strong>' + esc(entry.label) + '</strong><br><span style="color:var(--muted);font-size:var(--tiny);">' + esc(entry.source_note) + '</span></td>' +
          '<td>' + esc(entry.credit_type || entry.scope) + '</td>' +
          '<td>' + esc(price) + '</td>' +
          '<td><span class="' + statusClass(entry.status) + '" style="font-size:var(--tiny);">' + esc(statusLabel(entry.status)) + '</span></td>' +
          '<td><a href="' + esc(entry.source_url) + '" target="_blank" rel="noopener">Source</a></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderNovogradacTable(target, doc) {
    if (!target) return;
    var pricing = doc && doc.pricing ? doc.pricing : {};
    var rows = [];
    if (pricing.national_avg) rows.push(['National average (quarter)', pricing.national_avg]);
    Object.keys(pricing.by_region || {}).forEach(function (key) {
      var region = pricing.by_region[key];
      rows.push([(region.label || key) + ' region' + (region.states ? ' (' + region.states.join(', ') + ')' : ''), region]);
    });
    if (pricing.by_state && pricing.by_state.CO) rows.push([pricing.by_state.CO.label || 'Colorado', pricing.by_state.CO]);
    // Novogradac splits 9% and 4% nationally but publishes regional and state
    // figures as one median across both, so a blank split is "not published",
    // never a zero.
    function cell(value) {
      return typeof value === 'number' && isFinite(value) && value > 0 ? '$' + value.toFixed(2) : '<span style="color:var(--muted);">Not published</span>';
    }
    target.innerHTML = '<table><thead><tr><th>Market</th><th>9%</th><th>4%</th><th>All credits (median)</th><th>Notes</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td><strong>' + esc(row[0]) + '</strong></td><td>' + cell(row[1].credit_9pct) + '</td><td>' + cell(row[1].credit_4pct) +
          '</td><td>' + cell(row[1].median_all_credits) + '</td><td>' + esc(row[1].notes || '') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // State allocation plans: a quoted figure where one is published, the
  // plan's own words where it is not. "Not stated" is a finding, not a gap.
  function renderQapTable(target, summaryEl, doc) {
    if (!target) return;
    var qap = doc && doc.state_qap_pricing;
    var entries = qap && Array.isArray(qap.entries) ? qap.entries : [];
    if (!entries.length) {
      target.innerHTML = '<p style="color:var(--muted);">State QAP pricing unavailable.</p>';
      return;
    }
    if (summaryEl) summaryEl.textContent = (qap.summary || '') + (qap.checked ? ' Checked ' + qap.checked + '.' : '');
    function priced(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    function figure(entry) {
      if (priced(entry.price_low) && priced(entry.price_high)) return dollars(entry.price_low) + '–' + dollars(entry.price_high);
      if (priced(entry.price_assumed)) return dollars(entry.price_assumed);
      if (priced(entry.price_low)) return dollars(entry.price_low) + ' or more';
      return 'Not stated';
    }
    target.innerHTML = '<table><thead><tr><th>State</th><th>Figure</th><th>What the plan says</th><th>Source</th></tr></thead><tbody>' +
      entries.map(function (entry) {
        return '<tr data-qap-state="' + esc(entry.state) + '"><td><strong>' + esc(entry.name) + '</strong></td>' +
          '<td>' + esc(figure(entry)) + '</td>' +
          '<td>' + (entry.quote ? '“' + esc(entry.quote) + '”' : '') + (entry.note ? '<br><span style="color:var(--muted);font-size:var(--tiny);">' + esc(entry.note) + '</span>' : '') + '</td>' +
          '<td><a href="' + esc(entry.source_url) + '" target="_blank" rel="noopener">' + esc(entry.document) + '</a><br><span style="color:var(--muted);font-size:var(--tiny);">' + esc(entry.section || '') + '</span></td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // Quarterly 9%/4% history as an SVG line chart with labelled axes. The
  // chart is drawn at the container's pixel width so tick labels stay a
  // readable size on phones and wide screens alike, and redrawn on resize.
  // Axis groups carry data-axis="x"/"y" so scripts/audit/chart-axes-audit.mjs
  // can confirm the axes rendered.
  function finitePrice(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  function renderHistory(target, doc) {
    if (!target) return;
    var rows = doc && Array.isArray(doc.quarterly) ? doc.quarterly.filter(function (row) {
      return row && /^\d{4}-Q[1-4]$/.test(String(row.quarter)) && (finitePrice(row.nine) || finitePrice(row.four));
    }) : [];
    if (!rows.length) {
      target.innerHTML = '<p style="color:var(--muted);">Pricing history unavailable.</p>';
      return;
    }
    var first = rows[0];
    var last = rows[rows.length - 1];
    var values = [];
    rows.forEach(function (row) {
      if (finitePrice(row.nine)) values.push(row.nine);
      if (finitePrice(row.four)) values.push(row.four);
    });

    var W = Math.max(320, Math.min(1100, Math.round(target.clientWidth || 720)));
    var H = W < 520 ? 260 : 300;
    var padL = 74, padR = 16, padT = 34, padB = 46;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var lo = Math.min.apply(null, values);
    var hi = Math.max.apply(null, values);
    var step = (hi - lo) > 0.12 ? 0.05 : 0.02;
    var yMin = Math.floor((lo - 0.005) / step) * step;
    var yMax = Math.ceil((hi + 0.005) / step) * step;
    if (yMax - yMin < step * 2) yMax = yMin + step * 2;

    function x(i) { return padL + (rows.length > 1 ? (i / (rows.length - 1)) * plotW : plotW / 2); }
    function y(v) { return padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }
    function f(n) { return n.toFixed(1); }

    var yAxis = '';
    var nTicks = Math.round((yMax - yMin) / step);
    for (var t = 0; t <= nTicks; t++) {
      var tv = yMin + t * step;
      yAxis += '<line x1="' + padL + '" y1="' + f(y(tv)) + '" x2="' + (W - padR) + '" y2="' + f(y(tv)) + '" stroke="var(--border)" stroke-width="1"/>' +
        '<text data-tick x="' + (padL - 8) + '" y="' + f(y(tv) + 4) + '" font-size="12" text-anchor="end" fill="var(--muted)">$' + tv.toFixed(2) + '</text>';
    }
    yAxis += '<text data-axis-title x="14" y="' + f(padT + plotH / 2) + '" font-size="12" text-anchor="middle" fill="var(--muted)" transform="rotate(-90 14 ' + f(padT + plotH / 2) + ')">Equity per $1 of credit</text>';

    // One tick per year, at its Q1 (a partial first year gets no tick, so
    // its label cannot crowd the next one); every other year on narrow charts.
    var xAxis = '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="var(--muted)" stroke-width="1"/>';
    var seenYears = [];
    rows.forEach(function (row, i) {
      var yr = row.quarter.slice(0, 4);
      if (row.quarter.slice(5) !== 'Q1' || seenYears.indexOf(yr) !== -1) return;
      seenYears.push(yr);
      if (W < 520 && seenYears.length % 2 === 0) return;
      xAxis += '<line x1="' + f(x(i)) + '" y1="' + (padT + plotH) + '" x2="' + f(x(i)) + '" y2="' + (padT + plotH + 5) + '" stroke="var(--muted)" stroke-width="1"/>' +
        '<text data-tick x="' + f(x(i)) + '" y="' + (padT + plotH + 19) + '" font-size="12" text-anchor="middle" fill="var(--muted)">' + esc(yr) + '</text>';
    });
    xAxis += '<text data-axis-title x="' + f(padL + plotW / 2) + '" y="' + (H - 6) + '" font-size="12" text-anchor="middle" fill="var(--muted)">' +
      'Quarter, ' + esc(first.quarter) + ' to ' + esc(last.quarter) + (W < 520 ? '' : ' (national average of syndicator LOI pricing)') + '</text>';

    // A missing quarter breaks the line rather than being drawn as $0.
    function path(key) {
      var d = '';
      var pen = false;
      rows.forEach(function (row, i) {
        if (!finitePrice(row[key])) { pen = false; return; }
        d += (pen ? 'L' : 'M') + f(x(i)) + ' ' + f(y(row[key]));
        pen = true;
      });
      return d;
    }

    function latest(key) {
      for (var i = rows.length - 1; i >= 0; i--) if (finitePrice(rows[i][key])) return rows[i][key];
      return null;
    }

    var legend =
      '<g data-legend font-size="12">' +
        '<line x1="' + padL + '" y1="14" x2="' + (padL + 26) + '" y2="14" stroke="var(--accent)" stroke-width="3"/>' +
        '<text x="' + (padL + 32) + '" y="18" fill="var(--text)">9% credits (latest ' + dollars(latest('nine')) + ')</text>' +
        '<line x1="' + (padL + 220) + '" y1="14" x2="' + (padL + 246) + '" y2="14" stroke="var(--warn)" stroke-width="3" stroke-dasharray="6 4"/>' +
        '<text x="' + (padL + 252) + '" y="18" fill="var(--text)">4% credits (latest ' + dollars(latest('four')) + ')</text>' +
      '</g>';
    if (W < 520) {
      legend =
        '<g data-legend font-size="12">' +
          '<line x1="' + padL + '" y1="10" x2="' + (padL + 22) + '" y2="10" stroke="var(--accent)" stroke-width="3"/>' +
          '<text x="' + (padL + 28) + '" y="14" fill="var(--text)">9% ' + dollars(latest('nine')) + '</text>' +
          '<line x1="' + (padL + 110) + '" y1="10" x2="' + (padL + 132) + '" y2="10" stroke="var(--warn)" stroke-width="3" stroke-dasharray="6 4"/>' +
          '<text x="' + (padL + 138) + '" y="14" fill="var(--text)">4% ' + dollars(latest('four')) + '</text>' +
        '</g>';
    }

    target.innerHTML =
      '<svg data-chart="lihtc-equity-history" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
        'aria-label="LIHTC equity pricing per dollar of credit, 9% and 4%, ' + esc(first.quarter) + ' to ' + esc(last.quarter) +
        '; latest 9% ' + dollars(latest('nine')) + ', 4% ' + dollars(latest('four')) + '" style="display:block;max-width:100%;height:auto;">' +
        legend +
        '<g data-axis="y">' + yAxis + '</g>' +
        '<g data-axis="x">' + xAxis + '</g>' +
        '<path d="' + path('nine') + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="' + path('four') + '" fill="none" stroke="var(--warn)" stroke-width="2.5" stroke-dasharray="6 4" stroke-linejoin="round"/>' +
      '</svg>';

    if (!target.__tceHistoryResize && typeof window !== 'undefined' && window.addEventListener) {
      var timer = null;
      var lastWidth = W;
      target.__tceHistoryResize = function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          var w = Math.max(320, Math.min(1100, Math.round(target.clientWidth || 720)));
          if (w !== lastWidth) { lastWidth = w; renderHistory(target, doc); }
        }, 150);
      };
      window.addEventListener('resize', target.__tceHistoryResize);
    }
  }

  function renderExplainerMatrix(target) {
    if (!target) return;
    target.innerHTML = '<table data-credit-explainer-matrix="true"><thead><tr><th>Credit</th><th>Term / timing</th><th>Transferability</th><th>Tax treatment</th><th>Pricing direction</th></tr></thead><tbody>' +
      CREDIT_EXPLAINER_ROWS.map(function (row) {
        return '<tr data-credit-row="' + esc(row.id) + '">' +
          '<td><strong>' + esc(row.credit) + '</strong><br><span style="color:var(--muted);font-size:var(--tiny);">' + esc(row.statute) + '</span></td>' +
          '<td>' + esc(row.stream) + '</td>' +
          '<td>' + esc(row.transfer) + '</td>' +
          '<td>' + esc(row.taxTreatment) + '</td>' +
          '<td>' + esc(row.direction) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  function init() {
    var articleRoot = document.querySelector('[data-tax-credit-equity-markets]');
    var watchRoots = document.querySelectorAll('[data-tax-credit-watch]');
    if (!articleRoot && !watchRoots.length) return;

    if (document.getElementById('tceExplainerMatrix')) renderExplainerMatrix(document.getElementById('tceExplainerMatrix'));

    if (articleRoot) {
      Promise.all([
        fetchJson(DATA_URLS.transferPricing),
        fetchJson(DATA_URLS.lihtcBenchmark),
        fetchJson(DATA_URLS.lihtcHistory)
      ]).then(function (payloads) {
        renderTransferPricing(document.getElementById('tceTransferPricing'), payloads[0]);
        renderNovogradacTable(document.getElementById('tceNovogradacTable'), payloads[1]);
        renderQapTable(document.getElementById('tceQapTable'), document.getElementById('tceQapSummary'), payloads[1]);
        renderHistory(document.getElementById('tceHistoryChart'), payloads[2]);
      }).catch(function (err) {
        var target = document.getElementById('tceDataError');
        if (target) target.textContent = 'Tax-credit pricing data could not be loaded: ' + err.message;
      });
    }

    if (watchRoots.length) {
      fetchJson(DATA_URLS.legislation).then(function (doc) {
        watchRoots.forEach(function (root) {
          var include = root.getAttribute('data-tax-credit-watch') || '';
          renderLegislationWatch(root, doc, {
            includeScopes: include ? include.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : []
          });
        });
      }).catch(function (err) {
        watchRoots.forEach(function (root) {
          root.innerHTML = '<p style="color:var(--bad);">Policy watchlist could not be loaded: ' + esc(err.message) + '</p>';
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.TaxCreditEquityMarkets = {
    DATA_URLS: DATA_URLS,
    CREDIT_EXPLAINER_ROWS: CREDIT_EXPLAINER_ROWS,
    renderExplainerMatrix: renderExplainerMatrix,
    renderLegislationWatch: renderLegislationWatch,
    renderTransferPricing: renderTransferPricing,
    renderNovogradacTable: renderNovogradacTable,
    renderHistory: renderHistory
  };
})(typeof window !== 'undefined' ? window : this);
