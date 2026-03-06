/**
 * js/analytics/metric-calculator.js
 * Custom metric formula calculator.
 *
 * Responsibilities:
 *  - MetricCalculator class for defining and evaluating custom metric formulas
 *  - Visual formula builder (operand + operator selectors, not free-text)
 *  - Real-time calculation when geography data changes
 *  - Save/load custom metrics (localStorage-backed)
 *
 * Exposed on window.MetricCalculator.
 */
(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────── */

  var STORAGE_KEY = 'hna_custom_metrics_v1';

  var OPERANDS = {
    population:      { label: 'Population',        field: 'population' },
    median_income:   { label: 'Median Income',      field: 'median_income' },
    median_rent:     { label: 'Median Rent',         field: 'median_rent' },
    total_units:     { label: 'Housing Units',       field: 'total_units' },
    renter_pct:      { label: 'Renter %',            field: 'renter_pct' },
    owner_pct:       { label: 'Owner %',             field: 'owner_pct' },
    rent_burden_pct: { label: 'Rent Burden %',       field: 'rent_burden_pct' },
    vacancy_rate:    { label: 'Vacancy Rate %',      field: 'vacancy_rate' },
    employment:      { label: 'Employment',          field: 'employment' },
  };

  var BINARY_OPS = {
    add:      { label: '+',   apply: function (a, b) { return a + b; } },
    subtract: { label: '−',   apply: function (a, b) { return a - b; } },
    multiply: { label: '×',   apply: function (a, b) { return a * b; } },
    divide:   { label: '÷',   apply: function (a, b) { return b === 0 ? null : a / b; } },
    ratio:    { label: 'ratio (a/b × 100)', apply: function (a, b) { return b === 0 ? null : (a / b) * 100; } },
  };

  /* ── MetricCalculator class ─────────────────────────────────────── */

  /**
   * @class MetricCalculator
   * @param {HTMLElement|string} container
   * @param {object} [options]
   * @param {function} [options.onResult] - Called with (name, value, data) after each calculation.
   */
  function MetricCalculator(container, options) {
    this._container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    this._options  = options || {};
    this._savedMetrics = _loadSaved();
    this._currentFormula = {
      name:   '',
      leftOperand:  'median_rent',
      operator:     'divide',
      rightOperand: 'median_income',
    };
    this._lastData   = null;
    this._lastResult = null;
    if (this._container) {
      this._render();
    }
  }

  /* ── Public API ─────────────────────────────────────────────────── */

  /**
   * Evaluate the current formula against a data row.
   * @param {object} data - Object with field values keyed by field name.
   * @returns {number|null} result or null on error.
   */
  MetricCalculator.prototype.calculate = function (data) {
    this._lastData = data || {};
    var f  = this._currentFormula;
    var a  = _fieldValue(data, f.leftOperand);
    var b  = _fieldValue(data, f.rightOperand);
    var op = BINARY_OPS[f.operator];

    if (a === null || b === null || !op) {
      this._lastResult = null;
    } else {
      this._lastResult = op.apply(a, b);
    }

    if (this._container) {
      this._updateResultDisplay();
    }
    if (typeof this._options.onResult === 'function') {
      this._options.onResult(f.name || 'Custom Metric', this._lastResult, data);
    }
    return this._lastResult;
  };

  /**
   * Evaluate a saved metric formula by name.
   * @param {string} name
   * @param {object} data
   * @returns {number|null}
   */
  MetricCalculator.prototype.calculateSaved = function (name, data) {
    var formula = this._savedMetrics.find(function (m) { return m.name === name; });
    if (!formula) return null;
    var a  = _fieldValue(data, formula.leftOperand);
    var b  = _fieldValue(data, formula.rightOperand);
    var op = BINARY_OPS[formula.operator];
    if (a === null || b === null || !op) return null;
    return op.apply(a, b);
  };

  /**
   * Save the current formula under the given name.
   * @param {string} name
   */
  MetricCalculator.prototype.saveFormula = function (name) {
    if (!name || !name.trim()) return;
    var formula = Object.assign({}, this._currentFormula, { name: name.trim() });
    var idx = this._savedMetrics.findIndex(function (m) { return m.name === formula.name; });
    if (idx !== -1) {
      this._savedMetrics[idx] = formula;
    } else {
      this._savedMetrics.push(formula);
    }
    _persistSaved(this._savedMetrics);
    if (this._container) {
      this._render();
    }
  };

  /**
   * Delete a saved metric by name.
   * @param {string} name
   */
  MetricCalculator.prototype.deleteFormula = function (name) {
    this._savedMetrics = this._savedMetrics.filter(function (m) { return m.name !== name; });
    _persistSaved(this._savedMetrics);
    if (this._container) {
      this._render();
    }
  };

  /**
   * Return the list of saved metrics.
   * @returns {object[]}
   */
  MetricCalculator.prototype.getSavedMetrics = function () {
    return this._savedMetrics.map(function (m) { return Object.assign({}, m); });
  };

  /**
   * Load a saved formula into the builder.
   * @param {string} name
   */
  MetricCalculator.prototype.loadFormula = function (name) {
    var formula = this._savedMetrics.find(function (m) { return m.name === name; });
    if (!formula) return;
    this._currentFormula = Object.assign({}, formula);
    if (this._container) {
      this._render();
    }
    if (this._lastData) {
      this.calculate(this._lastData);
    }
  };

  /**
   * Return the current formula definition.
   */
  MetricCalculator.prototype.getCurrentFormula = function () {
    return Object.assign({}, this._currentFormula);
  };

  /* ── Internal ───────────────────────────────────────────────────── */

  MetricCalculator.prototype._render = function () {
    if (!this._container) return;
    var self = this;
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }

    var wrap = document.createElement('div');
    wrap.className = 'mc-wrapper';

    // Title
    var title = document.createElement('h3');
    title.className = 'mc-title';
    title.textContent = 'Custom Metric Calculator';
    wrap.appendChild(title);

    // Formula builder row
    var builder = document.createElement('div');
    builder.className = 'mc-builder';

    // Metric name input
    var nameWrap = document.createElement('div');
    nameWrap.className = 'mc-name-wrap';
    var nameLbl = document.createElement('label');
    nameLbl.className = 'mc-label';
    nameLbl.textContent = 'Metric name';
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'mc-name-input';
    nameInput.placeholder = 'e.g. Affordability Ratio';
    nameInput.value = this._currentFormula.name || '';
    nameInput.addEventListener('input', function () {
      self._currentFormula.name = nameInput.value;
    });
    nameWrap.appendChild(nameLbl);
    nameWrap.appendChild(nameInput);
    builder.appendChild(nameWrap);

    // Formula row: [left operand] [operator] [right operand]
    var formulaRow = document.createElement('div');
    formulaRow.className = 'mc-formula-row';

    formulaRow.appendChild(self._makeOperandSelect('leftOperand', self._currentFormula.leftOperand));
    formulaRow.appendChild(self._makeOpSelect('operator', self._currentFormula.operator));
    formulaRow.appendChild(self._makeOperandSelect('rightOperand', self._currentFormula.rightOperand));

    builder.appendChild(formulaRow);

    // Result display
    var resultWrap = document.createElement('div');
    resultWrap.className = 'mc-result-wrap';
    var resultLbl = document.createElement('span');
    resultLbl.className = 'mc-result-lbl';
    resultLbl.textContent = 'Result:';
    var resultVal = document.createElement('span');
    resultVal.className = 'mc-result-val';
    resultVal.id = 'mc-result-val-' + Date.now();
    resultVal.textContent = this._lastResult !== null && this._lastResult !== undefined
      ? this._lastResult.toFixed(4)
      : '—';
    this._resultValId = resultVal.id;
    resultWrap.appendChild(resultLbl);
    resultWrap.appendChild(resultVal);
    builder.appendChild(resultWrap);

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'mc-save-btn';
    saveBtn.textContent = 'Save Metric';
    saveBtn.addEventListener('click', function () {
      var n = nameInput.value.trim();
      if (!n) { alert('Enter a name for this metric first.'); return; }
      self.saveFormula(n);
    });
    builder.appendChild(saveBtn);

    wrap.appendChild(builder);

    // Saved metrics list
    if (this._savedMetrics.length > 0) {
      var savedSec = document.createElement('div');
      savedSec.className = 'mc-saved-section';
      var savedTitle = document.createElement('h4');
      savedTitle.className = 'mc-saved-title';
      savedTitle.textContent = 'Saved Metrics';
      savedSec.appendChild(savedTitle);

      var savedList = document.createElement('ul');
      savedList.className = 'mc-saved-list';
      this._savedMetrics.forEach(function (m) {
        var li = document.createElement('li');
        li.className = 'mc-saved-item';

        var lbl = document.createElement('span');
        lbl.className = 'mc-saved-name';
        lbl.textContent = m.name + ' (' +
          (OPERANDS[m.leftOperand]  ? OPERANDS[m.leftOperand].label  : m.leftOperand)  + ' ' +
          (BINARY_OPS[m.operator]   ? BINARY_OPS[m.operator].label   : m.operator)     + ' ' +
          (OPERANDS[m.rightOperand] ? OPERANDS[m.rightOperand].label : m.rightOperand) + ')';
        li.appendChild(lbl);

        var loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'mc-load-btn';
        loadBtn.textContent = 'Load';
        loadBtn.addEventListener('click', function () { self.loadFormula(m.name); });
        li.appendChild(loadBtn);

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'mc-del-btn';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', function () { self.deleteFormula(m.name); });
        li.appendChild(delBtn);

        savedList.appendChild(li);
      });
      savedSec.appendChild(savedList);
      wrap.appendChild(savedSec);
    }

    this._container.appendChild(wrap);
  };

  MetricCalculator.prototype._makeOperandSelect = function (key, selected) {
    var self = this;
    var sel = document.createElement('select');
    sel.className = 'mc-operand-select';
    sel.setAttribute('aria-label', key === 'leftOperand' ? 'Left operand' : 'Right operand');
    Object.keys(OPERANDS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = OPERANDS[k].label;
      if (k === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      self._currentFormula[key] = sel.value;
      if (self._lastData) self.calculate(self._lastData);
    });
    return sel;
  };

  MetricCalculator.prototype._makeOpSelect = function (key, selected) {
    var self = this;
    var sel = document.createElement('select');
    sel.className = 'mc-op-select';
    sel.setAttribute('aria-label', 'Operation');
    Object.keys(BINARY_OPS).forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = k;
      opt.textContent = BINARY_OPS[k].label;
      if (k === selected) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      self._currentFormula[key] = sel.value;
      if (self._lastData) self.calculate(self._lastData);
    });
    return sel;
  };

  MetricCalculator.prototype._updateResultDisplay = function () {
    if (!this._resultValId) return;
    var el = document.getElementById(this._resultValId);
    if (!el) return;
    el.textContent = (this._lastResult !== null && this._lastResult !== undefined)
      ? this._lastResult.toFixed(4)
      : '—';
  };

  /* ── Storage helpers ────────────────────────────────────────────── */

  function _loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function _persistSaved(metrics) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
    } catch (e) {
      // Ignore storage errors
    }
  }

  function _fieldValue(data, operandKey) {
    if (!data || !operandKey) return null;
    var def = OPERANDS[operandKey];
    if (!def) return null;
    var v = parseFloat(data[def.field]);
    return isNaN(v) ? null : v;
  }

  /* ── Expose on window ───────────────────────────────────────────── */

  window.MetricCalculator = MetricCalculator;
  window.MetricCalculator._OPERANDS    = OPERANDS;
  window.MetricCalculator._BINARY_OPS  = BINARY_OPS;
  window.MetricCalculator._fieldValue  = _fieldValue;

}());
