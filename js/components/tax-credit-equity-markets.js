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
    return typeof value === 'number' && isFinite(value) ? '$' + value.toFixed(2) : 'VERIFY';
  }

  function statusLabel(status) {
    return {
      enacted: 'Enacted',
      proposed: 'Proposed',
      'rule-pending': 'Rule-pending',
      'phased-out': 'Phased-out',
      expired: 'Expired',
      verified: 'Verified',
      VERIFY: 'VERIFY'
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
    target.innerHTML = entries.map(function (entry) {
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
          '<a href="' + esc(entry.source_url) + '" target="_blank" rel="noopener">Official source</a>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderTransferPricing(target, doc) {
    if (!target) return;
    var markets = doc && Array.isArray(doc.markets) ? doc.markets : [];
    target.innerHTML = '<table><thead><tr><th>Market</th><th>Scope</th><th>Price</th><th>Status</th><th>Source</th></tr></thead><tbody>' +
      markets.map(function (entry) {
        var price = entry.price_low == null || entry.price_high == null
          ? 'VERIFY'
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
    if (pricing.national_avg) rows.push(['National average', pricing.national_avg]);
    Object.keys(pricing.by_region || {}).forEach(function (key) {
      rows.push([key.replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }), pricing.by_region[key]]);
    });
    Object.keys(pricing.colorado_specific || {}).forEach(function (key) {
      rows.push([key.replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }), pricing.colorado_specific[key]]);
    });
    target.innerHTML = '<table><thead><tr><th>Market</th><th>9%</th><th>4%</th><th>Notes</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td><strong>' + esc(row[0]) + '</strong></td><td>' + dollars(row[1].credit_9pct) + '</td><td>' + dollars(row[1].credit_4pct) + '</td><td>' + esc(row[1].notes || '') + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function renderHistory(target, doc) {
    if (!target) return;
    var rows = doc && Array.isArray(doc.quarterly) ? doc.quarterly : [];
    if (!rows.length) {
      target.innerHTML = '<p style="color:var(--muted);">Pricing history unavailable.</p>';
      return;
    }
    var last = rows[rows.length - 1];
    var first = rows[0];
    var min = Math.min.apply(null, rows.map(function (row) { return Math.min(row.nine, row.four); })) - 0.02;
    var max = Math.max.apply(null, rows.map(function (row) { return Math.max(row.nine, row.four); })) + 0.02;
    var range = max - min || 0.1;
    function point(row, i, key) {
      var x = 4 + (i / Math.max(1, rows.length - 1)) * 92;
      var y = 92 - ((row[key] - min) / range) * 78;
      return x.toFixed(2) + ',' + y.toFixed(2);
    }
    var line9 = rows.map(function (row, i) { return point(row, i, 'nine'); }).join(' ');
    var line4 = rows.map(function (row, i) { return point(row, i, 'four'); }).join(' ');
    target.innerHTML =
      '<svg viewBox="0 0 100 100" role="img" aria-label="LIHTC equity pricing history from ' + esc(first.quarter) + ' to ' + esc(last.quarter) + '" style="width:100%;height:auto;max-height:280px;">' +
        '<polyline points="' + line9 + '" fill="none" stroke="var(--accent)" stroke-width="2.2"/>' +
        '<polyline points="' + line4 + '" fill="none" stroke="var(--warn)" stroke-width="2.2" stroke-dasharray="3 2"/>' +
        '<text x="4" y="98" font-size="4" fill="var(--muted)">' + esc(first.quarter) + '</text>' +
        '<text x="96" y="98" font-size="4" text-anchor="end" fill="var(--muted)">' + esc(last.quarter) + '</text>' +
        '<text x="96" y="10" font-size="4" text-anchor="end" fill="var(--accent)">9% ' + dollars(last.nine) + '</text>' +
        '<text x="96" y="17" font-size="4" text-anchor="end" fill="var(--warn)">4% ' + dollars(last.four) + '</text>' +
      '</svg>';
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
