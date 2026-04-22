# `js/analytics/query-builder.js`

js/analytics/query-builder.js
Visual query builder for advanced analytics.

Responsibilities:
 - QueryBuilder class for visual query construction
 - Dimension selectors (Geography, Age Group, Income, Tenure, etc.)
 - Operator selectors (equals, between, greater than, in list)
 - Filter validation and error handling
 - Filter application to data arrays

Exposed on window.QueryBuilder for use by other modules.

## Symbols

### `QueryBuilder(container, options)`

@class QueryBuilder
@param {HTMLElement|string} container - DOM element or selector to render into.
@param {object} [options]
@param {function} [options.onChange] - Callback invoked with updated filter list.

### `coerce(value, type)`

Return a copy of the current filter list.
Each filter: { id, dimension, operator, values, error }
/
  QueryBuilder.prototype.getFilters = function () {
    return this._filters.map(function (f) {
      return Object.assign({}, f);
    });
  };

  /**
Set filters programmatically (replaces all current filters).
@param {Array} filters
/
  QueryBuilder.prototype.setFilters = function (filters) {
    if (!Array.isArray(filters)) {
      throw new TypeError('setFilters: expected array');
    }
    this._filters = filters.map(function (f) {
      return Object.assign({}, f);
    });
    this._validate();
    if (this._container) {
      this._render();
    }
    this._notifyChange();
  };

  /**
Clear all filters.
/
  QueryBuilder.prototype.clearFilters = function () {
    this._filters = [];
    if (this._container) {
      this._render();
    }
    this._notifyChange();
  };

  /**
Apply current filters to a data array.
@param {Array<object>} data
@returns {Array<object>} filtered data
/
  QueryBuilder.prototype.applyFilters = function (data) {
    if (!Array.isArray(data)) return [];
    var validFilters = this._filters.filter(function (f) { return !f.error; });
    return data.filter(function (row) {
      return validFilters.every(function (f) {
        return applyFilter(row, f);
      });
    });
  };

  /**
Validate all filters and return list of error messages.
@returns {string[]}
/
  QueryBuilder.prototype.validate = function () {
    return this._validate();
  };

  /**
Return the list of available dimension keys.
/
  QueryBuilder.getDimensions = function () {
    return DIMENSIONS;
  };

  /**
Return the list of available operator keys.
/
  QueryBuilder.getOperators = function () {
    return OPERATORS;
  };

  /* ── Internal helpers ───────────────────────────────────────────── */

  QueryBuilder.prototype._validate = function () {
    var errors = [];
    var self = this;
    this._filters.forEach(function (f, idx) {
      f.error = null;
      var dim = DIMENSIONS[f.dimension];
      if (!dim) {
        f.error = 'Unknown dimension "' + f.dimension + '"';
        errors.push('Filter ' + (idx + 1) + ': ' + f.error);
        return;
      }
      var op = OPERATORS[f.operator];
      if (!op) {
        f.error = 'Unknown operator "' + f.operator + '"';
        errors.push('Filter ' + (idx + 1) + ': ' + f.error);
        return;
      }
      if (op.types.indexOf(dim.type) === -1) {
        f.error = 'Operator "' + op.label + '" is not valid for ' + dim.type + ' dimension';
        errors.push('Filter ' + (idx + 1) + ': ' + f.error);
        return;
      }
      if (op.arity === 1 && (!Array.isArray(f.values) || f.values.length < 1 || f.values[0] === '' || f.values[0] === null || f.values[0] === undefined)) {
        f.error = 'Value is required';
        errors.push('Filter ' + (idx + 1) + ': ' + f.error);
        return;
      }
      if (op.arity === 2) {
        if (!Array.isArray(f.values) || f.values.length < 2) {
          f.error = '"between" requires two values';
          errors.push('Filter ' + (idx + 1) + ': ' + f.error);
          return;
        }
        var lo = parseFloat(f.values[0]);
        var hi = parseFloat(f.values[1]);
        if (isNaN(lo) || isNaN(hi)) {
          f.error = '"between" values must be numeric';
          errors.push('Filter ' + (idx + 1) + ': ' + f.error);
          return;
        }
        if (lo > hi) {
          f.error = '"between" lower bound must not exceed upper bound';
          errors.push('Filter ' + (idx + 1) + ': ' + f.error);
          return;
        }
      }
      if (op.arity === -1 && (!Array.isArray(f.values) || f.values.length === 0)) {
        f.error = '"in list" requires at least one value';
        errors.push('Filter ' + (idx + 1) + ': ' + f.error);
      }
    });
    return errors;
  };

  QueryBuilder.prototype._addFilter = function () {
    this._filters.push({
      id:        this._nextId++,
      dimension: 'income',
      operator:  'gte',
      values:    [''],
      error:     null,
    });
    this._render();
    this._notifyChange();
  };

  QueryBuilder.prototype._removeFilter = function (id) {
    this._filters = this._filters.filter(function (f) { return f.id !== id; });
    this._render();
    this._notifyChange();
  };

  QueryBuilder.prototype._updateFilter = function (id, key, value) {
    var f = this._filters.find(function (x) { return x.id === id; });
    if (!f) return;
    f[key] = value;
    if (key === 'dimension' || key === 'operator') {
      f.values = [''];
    }
    this._validate();
    this._render();
    this._notifyChange();
  };

  QueryBuilder.prototype._notifyChange = function () {
    if (typeof this._options.onChange === 'function') {
      this._options.onChange(this.getFilters());
    }
  };

  QueryBuilder.prototype._render = function () {
    if (!this._container) return;
    var self = this;

    // Clear container
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'qb-wrapper';

    // Render each filter row
    this._filters.forEach(function (f) {
      var row = self._renderFilterRow(f);
      wrapper.appendChild(row);
    });

    // Add filter button
    var addBtn = document.createElement('button');
    addBtn.className = 'qb-add-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+ Add Filter';
    addBtn.addEventListener('click', function () { self._addFilter(); });
    wrapper.appendChild(addBtn);

    this._container.appendChild(wrapper);
  };

  QueryBuilder.prototype._renderFilterRow = function (f) {
    var self = this;
    var row = document.createElement('div');
    row.className = 'qb-filter-row' + (f.error ? ' qb-filter-row--error' : '');
    row.dataset.filterId = f.id;

    // Dimension select
    var dimSel = document.createElement('select');
    dimSel.className = 'qb-dim-select';
    dimSel.setAttribute('aria-label', 'Dimension');
    Object.keys(DIMENSIONS).forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = DIMENSIONS[key].label;
      if (key === f.dimension) opt.selected = true;
      dimSel.appendChild(opt);
    });
    dimSel.addEventListener('change', function () {
      self._updateFilter(f.id, 'dimension', dimSel.value);
    });
    row.appendChild(dimSel);

    // Operator select
    var opSel = document.createElement('select');
    opSel.className = 'qb-op-select';
    opSel.setAttribute('aria-label', 'Operator');
    var dim = DIMENSIONS[f.dimension];
    Object.keys(OPERATORS).forEach(function (key) {
      var op = OPERATORS[key];
      if (!dim || op.types.indexOf(dim.type) === -1) return;
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = op.label;
      if (key === f.operator) opt.selected = true;
      opSel.appendChild(opt);
    });
    opSel.addEventListener('change', function () {
      self._updateFilter(f.id, 'operator', opSel.value);
    });
    row.appendChild(opSel);

    // Value input(s)
    var valWrap = document.createElement('span');
    valWrap.className = 'qb-val-wrap';
    var op = OPERATORS[f.operator];
    if (op && op.arity === 2) {
      [0, 1].forEach(function (idx) {
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.className = 'qb-val-input';
        inp.setAttribute('aria-label', idx === 0 ? 'From' : 'To');
        inp.value = (f.values && f.values[idx] !== undefined) ? f.values[idx] : '';
        inp.addEventListener('input', function () {
          var newVals = (f.values || ['', '']).slice();
          newVals[idx] = inp.value;
          self._updateFilter(f.id, 'values', newVals);
        });
        valWrap.appendChild(inp);
        if (idx === 0) {
          var sep = document.createElement('span');
          sep.className = 'qb-between-sep';
          sep.textContent = '–';
          valWrap.appendChild(sep);
        }
      });
    } else if (op && op.arity === -1) {
      var textarea = document.createElement('textarea');
      textarea.className = 'qb-val-textarea';
      textarea.setAttribute('aria-label', 'Values (comma-separated)');
      textarea.value = Array.isArray(f.values) ? f.values.join(', ') : '';
      textarea.rows = 2;
      textarea.addEventListener('input', function () {
        var vals = textarea.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
        self._updateFilter(f.id, 'values', vals);
      });
      valWrap.appendChild(textarea);
    } else {
      var inp = document.createElement('input');
      inp.type = (dim && dim.type === 'number') ? 'number' : 'text';
      inp.className = 'qb-val-input';
      inp.setAttribute('aria-label', 'Value');
      inp.value = (f.values && f.values[0] !== undefined) ? f.values[0] : '';
      inp.addEventListener('input', function () {
        self._updateFilter(f.id, 'values', [inp.value]);
      });
      valWrap.appendChild(inp);
    }
    row.appendChild(valWrap);

    // Error message
    if (f.error) {
      var errSpan = document.createElement('span');
      errSpan.className = 'qb-error-msg';
      errSpan.setAttribute('role', 'alert');
      errSpan.textContent = f.error;
      row.appendChild(errSpan);
    }

    // Remove button
    var rmBtn = document.createElement('button');
    rmBtn.className = 'qb-remove-btn';
    rmBtn.type = 'button';
    rmBtn.textContent = '✕';
    rmBtn.setAttribute('aria-label', 'Remove filter');
    rmBtn.addEventListener('click', function () { self._removeFilter(f.id); });
    row.appendChild(rmBtn);

    return row;
  };

  /* ── Pure filter application ──────────────────────────────────────
