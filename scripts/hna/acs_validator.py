#!/usr/bin/env python3
"""ACS data validator.

Validates ACS field values against the field mapping schema defined in
``acs_field_mapping.json``.  Checks:

- Type enforcement  (integer, float, percentage)
- Range validation  (for fields with a 'range' spec)
- Required fields   (fields marked 'required': true)

All warnings are emitted via the standard ``logging`` module so callers can
configure verbosity.  ``validate_record()`` never raises — it always returns a
``ValidationResult`` with any errors accumulated.

Usage::

    from acs_validator import ACSValidator

    v = ACSValidator()
    result = v.validate_record({'DP04_0001E': 5000, 'DP04_0046PE': 30.0}, tables=['DP04'])
    if not result.ok:
        for err in result.errors:
            print(err)
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

_FIELD_MAP_PATH = os.path.join(os.path.dirname(__file__), 'acs_field_mapping.json')

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class ValidationResult:
    """Result of validating a single ACS data record."""
    ok:       bool        = True
    errors:   list[str]   = field(default_factory=list)
    warnings: list[str]   = field(default_factory=list)

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
        self.ok = False
        logger.error('[acs_validator] %s', msg)

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)
        logger.warning('[acs_validator] %s', msg)


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

class ACSValidator:
    """Validate ACS data records against the centralized field mapping schema."""

    def __init__(self) -> None:
        self._schema = self._load_schema()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def validate_record(
        self,
        record: dict[str, Any],
        tables: list[str] | None = None,
        geoid: str = '',
    ) -> ValidationResult:
        """Validate *record* against the schema for the specified *tables*.

        Parameters
        ----------
        record:
            Flat dict of ``{census_field_id: value}``.
        tables:
            Table IDs to validate against (e.g. ``['DP04', 'DP05']``).
            When ``None``, all tables in the schema are checked.
        geoid:
            Optional geography ID string used in error messages.

        Returns
        -------
        ValidationResult
        """
        result = ValidationResult()
        tables_to_check = tables or [k for k in self._schema if not k.startswith('_')]
        ctx = f" [geoid={geoid}]" if geoid else ""

        for table_id in tables_to_check:
            table_schema = self._schema.get(table_id)
            if not table_schema:
                result.add_warning(f"Unknown table '{table_id}' — no schema available{ctx}")
                continue

            for field_id, meta in table_schema.items():
                if field_id.startswith('_'):
                    continue
                value = record.get(field_id)
                self._check_field(field_id, value, meta, result, ctx)

        return result

    def validate_batch(
        self,
        records: dict[str, dict[str, Any]],
        tables: list[str] | None = None,
    ) -> dict[str, ValidationResult]:
        """Validate a batch of records keyed by geoid.

        Returns a dict of ``{geoid: ValidationResult}``.
        """
        return {
            geoid: self.validate_record(record, tables=tables, geoid=geoid)
            for geoid, record in records.items()
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_field(
        self,
        field_id: str,
        value: Any,
        meta: dict[str, Any],
        result: ValidationResult,
        ctx: str,
    ) -> None:
        required  = meta.get('required', False)
        type_hint = meta.get('type', 'string')
        rng       = meta.get('range')
        name      = meta.get('name', field_id)

        # 1. Required check
        if value is None:
            if required:
                result.add_error(
                    f"Required field '{field_id}' ({name}) is missing or null{ctx}"
                )
            else:
                result.add_warning(
                    f"Optional field '{field_id}' ({name}) is null{ctx}"
                )
            return

        # 2. Type check
        if not self._check_type(value, type_hint):
            result.add_error(
                f"Field '{field_id}' ({name}) expected type={type_hint}, "
                f"got {type(value).__name__}={value!r}{ctx}"
            )
            return

        # 3. Range check
        if rng is not None:
            lo, hi = rng
            try:
                numeric = float(value)
                if not (lo <= numeric <= hi):
                    result.add_error(
                        f"Field '{field_id}' ({name}) value {value} out of range "
                        f"[{lo}, {hi}]{ctx}"
                    )
            except (TypeError, ValueError):
                pass  # type check already flagged non-numeric values above

    @staticmethod
    def _check_type(value: Any, type_hint: str) -> bool:
        if type_hint == 'integer':
            return isinstance(value, int) and not isinstance(value, bool)
        if type_hint in ('float', 'percentage'):
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        return True  # string and unknown types are always accepted

    @staticmethod
    def _load_schema() -> dict[str, Any]:
        with open(_FIELD_MAP_PATH, 'r', encoding='utf-8') as fh:
            return json.load(fh)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse
    import sys

    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format='%(levelname)s %(message)s')

    parser = argparse.ArgumentParser(description='Validate ACS data records from a JSON file')
    parser.add_argument('input', help='Path to JSON file: {geoid: {field_id: value}}')
    parser.add_argument('--tables', default=None,
                        help='Comma-separated table IDs to validate (default: all)')
    args = parser.parse_args()

    with open(args.input, 'r', encoding='utf-8') as fh:
        data = json.load(fh)

    tables = args.tables.split(',') if args.tables else None
    validator = ACSValidator()
    batch_results = validator.validate_batch(data, tables=tables)

    total_errors   = sum(len(r.errors)   for r in batch_results.values())
    total_warnings = sum(len(r.warnings) for r in batch_results.values())

    print(f"\n{'='*60}")
    print(f"Validation complete: {len(batch_results)} records")
    print(f"  Errors:   {total_errors}")
    print(f"  Warnings: {total_warnings}")

    if total_errors:
        sys.exit(1)


if __name__ == '__main__':
    _main()
