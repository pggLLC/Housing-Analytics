/**
 * js/analytics/comparison-panel.js
 * Multi-geography comparison panel.
 *
 * Responsibilities:
 *  - ComparisonPanel class for side-by-side geography comparison
 *  - Multi-select geography UI (2–4 geographies)
 *  - Side-by-side metric cards with color coding
 *  - Comparison table view
 *  - Downloadable comparison results (CSV/JSON)
 *
 * Exposed on window.ComparisonPanel.
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────── */

  var MIN_GEOS = 2;
  var MAX_GEOS = 4;

  var METRIC_DEFS = [
    { key: 'population',       label: 'Population',          format: 'integer', higherIsBetter: true },
    { key: 'median_income',    label: 'Median Income',       format: 'currency', higherIsBetter: true },
    { key: 'rent_burden_pct',  label: 'Rent Burden %',       format: 'percent',  higherIsBetter: false },
    { key: 'vacancy_rate',     label: 'Vacancy Rate %',      format: 'percent',  higherIsBetter: null },
    { key: 'total_units',      label: 'Housing Units',       format: 'integer',  higherIsBetter: true },
    { key: 'renter_pct',       label: 'Renter %',            format: 'percent',  higherIsBetter: null },
    { key: 'owner_pct',        label: 'Owner %',             format: 'percent',  higherIsBetter: null },
    { key: 'median_rent',      label: 'Median Rent',         format: 'currency', higherIsBetter: false },
    { key: 'employment',       label: 'Employment',          format: 'integer',  higherIsBetter: true },
  ];

  var PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2'];

  /* ── Formatting helpers ─────────────────────────────────────────── */

  function fmt(value, format) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    var n = parseFloat(value);
    switch (format) {
      case 'integer':  return Math.round(n).toLocaleString();
      case 'currency': return '$' + Math.round(n).toLocaleString();
      case 'percent':  return n.toFixed(1) + '%';
      default:         return String(value);
    }
  }

  /* ── ComparisonPanel class ──────────────────────────────────────── */

  /**
   * @class ComparisonPanel
   * @param {HTMLElement|string} container
   * @param {object} [options]
   * @param {string[]} [options.metrics] - Metric keys to compare (defaults to all).
   * @param {function} [options.onSelectionChange] - Callback when selection changes.
   */
  function ComparisonPanel(container, options) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this._options = options || {};
    this._selectedGeoids = [];
    this._geoData = {};       // keyed by geoid
    this._geoLabels = {};     // keyed by geoid
    this._metrics = (options && options.metrics) ? options.metrics : METRIC_DEFS.map(function (m) { return m.key; });
    if (this._container) {
      this._render();
    }
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Load geography data for comparison.
   * @param {string} geoid
   * @param {string} label
   * @param {object} data - Record with metric values keyed by metric key.
   */
  ComparisonPanel.prototype.loadGeography = function (geoid, label, data) {
    this._geoData[geoid]   = data   || {};
    this._geoLabels[geoid] = label  || geoid;
  };

  /**
   * Select a geography by geoid (adds it; max 4).
   * @param {string} geoid
   * @returns {boolean} true if added, false if already selected or at max.
   */
  ComparisonPanel.prototype.selectGeography = function (geoid) {
    if (this._selectedGeoids.indexOf(geoid) !== -1) return false;
    if (this._selectedGeoids.length >= MAX_GEOS) return false;
    this._selectedGeoids.push(geoid);
    this._refresh();
    this._notifySelectionChange();
    return true;
  };

  /**
   * Deselect a geography.
   * @param {string} geoid
   */
  ComparisonPanel.prototype.deselectGeography = function (geoid) {
    this._selectedGeoids = this._selectedGeoids.filter(function (g) { return g !== geoid; });
    this._refresh();
    this._notifySelectionChange();
  };

  /**
   * Return the currently selected geoids.
   */
  ComparisonPanel.prototype.getSelectedGeoids = function () {
    return this._selectedGeoids.slice();
  };

  /**
   * Build the comparison table data (array of rows, one per metric).
   * @returns {object[]} rows with { metric, label, values[] }
   */
  ComparisonPanel.prototype.buildComparisonTable = function () {
    var self = this;
    var geos = this._selectedGeoids;
    return METRIC_DEFS.filter(function (m) {
      return self._metrics.indexOf(m.key) !== -1;
    }).map(function (m) {
      var values = geos.map(function (g) {
        return (self._geoData[g] && self._geoData[g][m.key] !== undefined)
          ? self._geoData[g][m.key]
          : null;
      });
      return { metric: m.key, label: m.label, format: m.format,
               higherIsBetter: m.higherIsBetter, values: values };
    });
  };

  /**
   * Export comparison results as CSV string.
   * @returns {string}
   */
  ComparisonPanel.prototype.toCSV = function () {
    var self = this;
    var geos = this._selectedGeoids;
    var rows = this.buildComparisonTable();
    var header = ['Metric'].concat(geos.map(function (g) {
      return self._geoLabels[g] || g;
    }));
    var lines = [header.join(',')];
    rows.forEach(function (row) {
      var cells = [row.label].concat(row.values.map(function (v) {
        return v === null ? '' : String(v);
      }));
      lines.push(cells.join(','));
    });
    return lines.join('\n');
  };

  /**
   * Export comparison results as a JSON object.
   * @returns {object}
   */
  ComparisonPanel.prototype.toJSON = function () {
    var self = this;
    return {
      geographies: this._selectedGeoids.map(function (g) {
        return { geoid: g, label: self._geoLabels[g] || g, data: self._geoData[g] || {} };
      }),
      metrics: this.buildComparisonTable(),
      generated: new Date().toISOString(),
    };
  };

  /**
   * Trigger a file download of the comparison CSV.
   */
  ComparisonPanel.prototype.downloadCSV = function () {
    var csv  = this.toCSV();
    var blob = new Blob([csv], { type: 'text/csv' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'comparison-' + Date.now() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ── Internal ───────────────────────────────────────────────────── */

  ComparisonPanel.prototype._notifySelectionChange = function () {
    if (typeof this._options.onSelectionChange === 'function') {
      this._options.onSelectionChange(this._selectedGeoids.slice());
    }
  };

  ComparisonPanel.prototype._refresh = function () {
    if (this._container) this._render();
  };

  ComparisonPanel.prototype._render = function () {
    if (!this._container) return;
    var self = this;
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }

    var wrap = document.createElement('div');
    wrap.className = 'cp-wrapper';

    // Header
    var hdr = document.createElement('div');
    hdr.className = 'cp-header';
    var title = document.createElement('h3');
    title.className = 'cp-title';
    title.textContent = 'Geography Comparison';
    hdr.appendChild(title);

    var hint = document.createElement('p');
    hint.className = 'cp-hint';
    hint.textContent = 'Select ' + MIN_GEOS + '–' + MAX_GEOS + ' geographies to compare.';
    hdr.appendChild(hint);
    wrap.appendChild(hdr);

    // Metric cards (one per selected geography)
    if (this._selectedGeoids.length >= MIN_GEOS) {
      var cards = document.createElement('div');
      cards.className = 'cp-cards';
      this._selectedGeoids.forEach(function (geoid, idx) {
        var card = self._renderCard(geoid, idx);
        cards.appendChild(card);
      });
      wrap.appendChild(cards);

      // Comparison table
      var tbl = self._renderTable();
      wrap.appendChild(tbl);

      // Export buttons
      var exportBar = document.createElement('div');
      exportBar.className = 'cp-export-bar';
      var csvBtn = document.createElement('button');
      csvBtn.className = 'cp-export-btn';
      csvBtn.type = 'button';
      csvBtn.textContent = 'Download CSV';
      csvBtn.addEventListener('click', function () { self.downloadCSV(); });
      exportBar.appendChild(csvBtn);
      wrap.appendChild(exportBar);
    } else if (this._selectedGeoids.length > 0) {
      var msg = document.createElement('p');
      msg.className = 'cp-msg';
      msg.textContent = 'Select at least ' + (MIN_GEOS - this._selectedGeoids.length) + ' more geograph' +
        (MIN_GEOS - this._selectedGeoids.length === 1 ? 'y' : 'ies') + ' to enable comparison.';
      wrap.appendChild(msg);
    } else {
      var msg2 = document.createElement('p');
      msg2.className = 'cp-msg';
      msg2.textContent = 'No geographies selected.';
      wrap.appendChild(msg2);
    }

    this._container.appendChild(wrap);
  };

  ComparisonPanel.prototype._renderCard = function (geoid, idx) {
    var self = this;
    var data = this._geoData[geoid] || {};
    var color = PALETTE[idx % PALETTE.length];

    var card = document.createElement('div');
    card.className = 'cp-card';
    card.style.borderTopColor = color;

    var header = document.createElement('div');
    header.className = 'cp-card-header';
    header.style.color = color;

    var name = document.createElement('span');
    name.className = 'cp-card-name';
    name.textContent = this._geoLabels[geoid] || geoid;
    header.appendChild(name);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'cp-card-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', 'Remove ' + (this._geoLabels[geoid] || geoid));
    removeBtn.addEventListener('click', function () { self.deselectGeography(geoid); });
    header.appendChild(removeBtn);
    card.appendChild(header);

    // Key metrics preview
    var keyMetrics = ['population', 'median_income', 'rent_burden_pct'];
    keyMetrics.forEach(function (key) {
      var def = METRIC_DEFS.find(function (m) { return m.key === key; });
      if (!def) return;
      var row = document.createElement('div');
      row.className = 'cp-card-metric';
      var lbl = document.createElement('span');
      lbl.className = 'cp-card-metric-lbl';
      lbl.textContent = def.label;
      var val = document.createElement('span');
      val.className = 'cp-card-metric-val';
      val.textContent = fmt(data[key], def.format);
      row.appendChild(lbl);
      row.appendChild(val);
      card.appendChild(row);
    });

    return card;
  };

  ComparisonPanel.prototype._renderTable = function () {
    var self = this;
    var geos = this._selectedGeoids;
    var rows = this.buildComparisonTable();

    var tableWrap = document.createElement('div');
    tableWrap.className = 'cp-table-wrap';

    var tbl = document.createElement('table');
    tbl.className = 'cp-table';

    // Head
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var thMetric = document.createElement('th');
    thMetric.textContent = 'Metric';
    headRow.appendChild(thMetric);
    geos.forEach(function (g, idx) {
      var th = document.createElement('th');
      th.textContent = self._geoLabels[g] || g;
      th.style.color = PALETTE[idx % PALETTE.length];
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    tbl.appendChild(thead);

    // Body
    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var tdLabel = document.createElement('td');
      tdLabel.className = 'cp-table-label';
      tdLabel.textContent = row.label;
      tr.appendChild(tdLabel);

      // Find best/worst for color coding
      var numericVals = row.values.map(function (v) { return parseFloat(v); }).filter(function (v) { return !isNaN(v); });
      var best  = row.higherIsBetter === true  ? Math.max.apply(null, numericVals) : (row.higherIsBetter === false ? Math.min.apply(null, numericVals) : null);
      var worst = row.higherIsBetter === true  ? Math.min.apply(null, numericVals) : (row.higherIsBetter === false ? Math.max.apply(null, numericVals) : null);

      row.values.forEach(function (v) {
        var td = document.createElement('td');
        td.className = 'cp-table-val';
        td.textContent = fmt(v, row.format);
        var n = parseFloat(v);
        if (!isNaN(n) && numericVals.length > 1) {
          if (n === best)  td.classList.add('cp-table-val--best');
          if (n === worst) td.classList.add('cp-table-val--worst');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    tableWrap.appendChild(tbl);
    return tableWrap;
  };

  /* ── Expose on window ───────────────────────────────────────────── */

  window.ComparisonPanel = ComparisonPanel;
  window.ComparisonPanel._METRIC_DEFS = METRIC_DEFS;
  window.ComparisonPanel._PALETTE     = PALETTE;

}());
