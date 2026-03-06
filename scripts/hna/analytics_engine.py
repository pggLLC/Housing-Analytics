#!/usr/bin/env python3
"""Analytics engine for Housing Needs Assessment advanced analytics.

Provides fast filtering, geographic comparison, and custom metric evaluation
for HNA datasets.

Key public functions
--------------------
- execute_query(filters, metrics, geoids)   — filter/slice data
- compare_geographies(geoids, metrics)      — side-by-side summary
- evaluate_custom_metric(formula, data)     — evaluate user-defined formula

All functions accept plain Python dicts and lists so they can be used
independently of any web framework.
"""

from __future__ import annotations

import math
import re
from typing import Any


# ---------------------------------------------------------------------------
# Supported filter operators
# ---------------------------------------------------------------------------

_OPERATORS = frozenset(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in_list'])

_BINARY_OPS: dict[str, Any] = {
    'add':      lambda a, b: a + b,
    'subtract': lambda a, b: a - b,
    'multiply': lambda a, b: a * b,
    'divide':   lambda a, b: (a / b) if b != 0 else None,
    'ratio':    lambda a, b: ((a / b) * 100) if b != 0 else None,
}


# ---------------------------------------------------------------------------
# Data index for fast filtering
# ---------------------------------------------------------------------------

class _DataIndex:
    """Build an in-memory index keyed by geoid for O(1) lookup."""

    def __init__(self, records: list[dict]) -> None:
        self._by_geoid: dict[str, dict] = {}
        for r in records:
            geoid = str(r.get('geoid', ''))
            if geoid:
                self._by_geoid[geoid] = r

    def get(self, geoid: str) -> dict | None:
        return self._by_geoid.get(str(geoid))

    def all(self) -> list[dict]:
        return list(self._by_geoid.values())

    def geoids(self) -> list[str]:
        return list(self._by_geoid.keys())


# ---------------------------------------------------------------------------
# Filter application
# ---------------------------------------------------------------------------

def _coerce(value: Any, expected_type: str) -> Any:
    """Coerce *value* to *expected_type* ('number' or 'string')."""
    if value is None:
        return None
    if expected_type == 'number':
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return str(value)


def _apply_filter(record: dict, f: dict) -> bool:
    """Return True if *record* passes filter *f*.

    Filter structure:
        { "field": str, "operator": str, "values": list, "type": "number"|"string" }
    """
    field    = f.get('field')
    operator = f.get('operator')
    values   = f.get('values', [])
    ftype    = f.get('type', 'string')

    if not field or operator not in _OPERATORS:
        return True  # skip unknown/malformed filters

    raw = record.get(field)
    if raw is None:
        return False

    val = _coerce(raw, ftype)
    if val is None:
        return False

    if operator == 'eq':
        return val == _coerce(values[0] if values else None, ftype)
    if operator == 'neq':
        return val != _coerce(values[0] if values else None, ftype)
    if operator == 'gt':
        cmp = _coerce(values[0] if values else None, ftype)
        return cmp is not None and val > cmp
    if operator == 'gte':
        cmp = _coerce(values[0] if values else None, ftype)
        return cmp is not None and val >= cmp
    if operator == 'lt':
        cmp = _coerce(values[0] if values else None, ftype)
        return cmp is not None and val < cmp
    if operator == 'lte':
        cmp = _coerce(values[0] if values else None, ftype)
        return cmp is not None and val <= cmp
    if operator == 'between':
        if len(values) < 2:
            return True
        lo = _coerce(values[0], ftype)
        hi = _coerce(values[1], ftype)
        return lo is not None and hi is not None and lo <= val <= hi
    if operator == 'in_list':
        coerced_list = [_coerce(v, ftype) for v in values]
        return val in coerced_list
    return True


# ---------------------------------------------------------------------------
# execute_query
# ---------------------------------------------------------------------------

def execute_query(
    filters:  list[dict],
    metrics:  list[str],
    geoids:   list[str] | None = None,
    records:  list[dict] | None = None,
) -> list[dict]:
    """Filter *records* and return only the requested *metrics*.

    Parameters
    ----------
    filters :
        List of filter dicts ``{ field, operator, values, type }``.
    metrics :
        Field names to include in output.  If empty, all fields are returned.
    geoids :
        Optional list of geoids to restrict results to.
    records :
        The dataset to query.  If None, returns an empty list.

    Returns
    -------
    list[dict]
        Filtered records containing only the requested metric fields plus
        ``geoid`` and ``name`` (if present).
    """
    if records is None:
        records = []
    if not isinstance(filters, list):
        raise TypeError("filters must be a list")
    if not isinstance(metrics, list):
        raise TypeError("metrics must be a list")

    result = []
    geoid_set = set(str(g) for g in geoids) if geoids else None

    for rec in records:
        geoid = str(rec.get('geoid', ''))
        if geoid_set is not None and geoid not in geoid_set:
            continue
        if all(_apply_filter(rec, f) for f in filters):
            if metrics:
                keep_fields = set(metrics) | {'geoid', 'name'}
                row = {k: v for k, v in rec.items() if k in keep_fields}
            else:
                row = dict(rec)
            result.append(row)

    return result


# ---------------------------------------------------------------------------
# compare_geographies
# ---------------------------------------------------------------------------

def _safe_float(v: Any) -> float | None:
    """Convert to float or return None."""
    if v is None:
        return None
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _normalize(values: list[float | None]) -> list[float | None]:
    """Min-max normalize a list; returns None for missing values."""
    nums = [v for v in values if v is not None]
    if not nums:
        return [None] * len(values)
    mn, mx = min(nums), max(nums)
    rng = mx - mn
    if rng == 0:
        return [1.0 if v is not None else None for v in values]
    return [(((v - mn) / rng) if v is not None else None) for v in values]


def compare_geographies(
    geoids:  list[str],
    metrics: list[str],
    records: list[dict] | None = None,
) -> dict:
    """Build a side-by-side comparison structure for *geoids*.

    Returns
    -------
    dict with keys:
        ``geographies`` — list of ``{ geoid, name, data }``
        ``metrics``     — list of ``{ metric, values, normalized }``
        ``ranked``      — dict mapping metric -> list of (geoid, value) sorted desc
    """
    if not isinstance(geoids, list) or len(geoids) < 2:
        raise ValueError("compare_geographies requires at least 2 geoids")
    if not isinstance(metrics, list):
        raise TypeError("metrics must be a list")

    records = records or []
    index = _DataIndex(records)

    geo_data: list[dict] = []
    for g in geoids:
        rec = index.get(g) or {}
        geo_data.append({
            'geoid': g,
            'name':  rec.get('name', g),
            'data':  {m: rec.get(m) for m in metrics},
        })

    metric_rows: list[dict] = []
    ranked: dict[str, list] = {}

    for m in metrics:
        raw_vals  = [gd['data'].get(m) for gd in geo_data]
        num_vals  = [_safe_float(v) for v in raw_vals]
        norm_vals = _normalize(num_vals)

        pairs = [(geoids[i], num_vals[i]) for i in range(len(geoids)) if num_vals[i] is not None]
        pairs.sort(key=lambda p: p[1], reverse=True)
        ranked[m] = pairs

        metric_rows.append({
            'metric':     m,
            'values':     raw_vals,
            'normalized': norm_vals,
        })

    return {
        'geographies': geo_data,
        'metrics':     metric_rows,
        'ranked':      ranked,
    }


# ---------------------------------------------------------------------------
# evaluate_custom_metric
# ---------------------------------------------------------------------------

def evaluate_custom_metric(formula: dict, data: dict) -> float | None:
    """Evaluate a user-defined binary formula against *data*.

    Formula structure::

        {
            "left_operand":  <field_name>,
            "operator":      "add" | "subtract" | "multiply" | "divide" | "ratio",
            "right_operand": <field_name>,
        }

    Parameters
    ----------
    formula :
        Dict describing the formula.
    data :
        Dict of field -> value for a single geography record.

    Returns
    -------
    float | None
        Computed result, or None if any operand is missing/invalid.
    """
    if not isinstance(formula, dict):
        raise TypeError("formula must be a dict")
    if not isinstance(data, dict):
        raise TypeError("data must be a dict")

    left_key  = formula.get('left_operand')
    right_key = formula.get('right_operand')
    op_key    = formula.get('operator', 'divide')

    if op_key not in _BINARY_OPS:
        raise ValueError(f"Unknown operator '{op_key}'. Valid: {sorted(_BINARY_OPS)}")

    a = _safe_float(data.get(left_key))
    b = _safe_float(data.get(right_key))

    if a is None or b is None:
        return None

    result = _BINARY_OPS[op_key](a, b)
    if result is None:
        return None
    return round(float(result), 6) if math.isfinite(float(result)) else None


# ---------------------------------------------------------------------------
# aggregate_metrics  (normalization / aggregation helper)
# ---------------------------------------------------------------------------

def aggregate_metrics(records: list[dict], metrics: list[str]) -> dict:
    """Compute summary statistics (mean, median, min, max) for each metric.

    Returns
    -------
    dict mapping metric -> { mean, median, min, max, count }
    """
    summary: dict[str, dict] = {}
    for m in metrics:
        vals = sorted([_safe_float(r.get(m)) for r in records if _safe_float(r.get(m)) is not None])
        if not vals:
            summary[m] = {'mean': None, 'median': None, 'min': None, 'max': None, 'count': 0}
            continue
        n     = len(vals)
        mean  = round(sum(vals) / n, 4)
        mid   = n // 2
        median = (vals[mid] + vals[mid - 1]) / 2 if n % 2 == 0 else vals[mid]
        summary[m] = {
            'mean':   mean,
            'median': round(median, 4),
            'min':    vals[0],
            'max':    vals[-1],
            'count':  n,
        }
    return summary
