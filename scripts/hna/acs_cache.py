#!/usr/bin/env python3
"""ACS SQLite cache — persistent storage for Census ACS data.

Stores ACS records in a local SQLite database with:
- TTL-based expiry (default: 30 days)
- Timestamp tracking for every record
- JSON serialisation of field values
- Simple key-value interface keyed by ``(geoid, table_ids_hash)``

Usage::

    from acs_cache import ACSCache

    cache = ACSCache()                          # default path & TTL
    cache.put('08077', ['DP04', 'DP05'], data)  # store
    record = cache.get('08077', ['DP04', 'DP05'])  # retrieve (None if missing/stale)
    cache.purge_expired()                        # remove stale rows
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

_DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(__file__), '..', '..', 'data', 'hna', 'acs_cache.db'
)
_DEFAULT_TTL_DAYS = 30
_DEFAULT_TTL_SECS = _DEFAULT_TTL_DAYS * 24 * 60 * 60

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS acs_cache (
    cache_key  TEXT    NOT NULL,
    geoid      TEXT    NOT NULL,
    tables     TEXT    NOT NULL,
    data       TEXT    NOT NULL,
    fetched_at TEXT    NOT NULL,
    expires_at REAL    NOT NULL,
    PRIMARY KEY (cache_key)
);
"""

_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_acs_cache_geoid ON acs_cache (geoid);"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _table_key(table_ids: list[str]) -> str:
    """Deterministic string for a sorted list of table IDs."""
    return ','.join(sorted(table_ids))


def _cache_key(geoid: str, table_ids: list[str]) -> str:
    raw = f"{geoid}:{_table_key(table_ids)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


# ---------------------------------------------------------------------------
# ACSCache
# ---------------------------------------------------------------------------

class ACSCache:
    """SQLite-backed cache for ACS data records.

    Parameters
    ----------
    db_path:
        Path to the SQLite database file.  Created automatically if absent.
    ttl_seconds:
        Time-to-live for cached records in seconds (default: 30 days).
    """

    def __init__(
        self,
        db_path: str = _DEFAULT_DB_PATH,
        ttl_seconds: int = _DEFAULT_TTL_SECS,
    ) -> None:
        self._db_path    = os.path.abspath(db_path)
        self._ttl        = ttl_seconds
        self._conn: sqlite3.Connection | None = None
        self._init_db()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, geoid: str, table_ids: list[str]) -> dict[str, Any] | None:
        """Return a cached record, or ``None`` if missing or expired.

        Parameters
        ----------
        geoid:
            Geography FIPS ID (e.g. ``'08077'``).
        table_ids:
            List of ACS table IDs (e.g. ``['DP04', 'DP05']``).
        """
        key = _cache_key(geoid, table_ids)
        conn = self._connection()
        row = conn.execute(
            "SELECT data, expires_at FROM acs_cache WHERE cache_key = ?", (key,)
        ).fetchone()

        if row is None:
            return None

        data_json, expires_at = row
        if time.time() > expires_at:
            conn.execute("DELETE FROM acs_cache WHERE cache_key = ?", (key,))
            conn.commit()
            return None

        try:
            return json.loads(data_json)
        except json.JSONDecodeError:
            return None

    def put(
        self,
        geoid: str,
        table_ids: list[str],
        data: dict[str, Any],
    ) -> None:
        """Store a record in the cache.

        Parameters
        ----------
        geoid:
            Geography FIPS ID.
        table_ids:
            List of ACS table IDs whose data is being stored.
        data:
            Field data dict to cache.
        """
        key        = _cache_key(geoid, table_ids)
        tables_str = _table_key(table_ids)
        now_iso    = _utc_now_iso()
        expires_at = time.time() + self._ttl
        data_json  = json.dumps(data, ensure_ascii=False)

        conn = self._connection()
        conn.execute(
            """
            INSERT INTO acs_cache (cache_key, geoid, tables, data, fetched_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                data       = excluded.data,
                fetched_at = excluded.fetched_at,
                expires_at = excluded.expires_at
            """,
            (key, geoid, tables_str, data_json, now_iso, expires_at),
        )
        conn.commit()

    def invalidate(self, geoid: str, table_ids: list[str]) -> None:
        """Remove a specific cached record."""
        key  = _cache_key(geoid, table_ids)
        conn = self._connection()
        conn.execute("DELETE FROM acs_cache WHERE cache_key = ?", (key,))
        conn.commit()

    def purge_expired(self) -> int:
        """Delete all expired records.  Returns the number of rows removed."""
        conn = self._connection()
        cur  = conn.execute(
            "DELETE FROM acs_cache WHERE expires_at < ?", (time.time(),)
        )
        conn.commit()
        return cur.rowcount

    def clear_all(self) -> int:
        """Delete all records.  Returns the number of rows removed."""
        conn = self._connection()
        cur  = conn.execute("DELETE FROM acs_cache")
        conn.commit()
        return cur.rowcount

    def list_records(self) -> list[dict[str, Any]]:
        """Return metadata for all cached records (without the data payload)."""
        conn = self._connection()
        rows = conn.execute(
            "SELECT geoid, tables, fetched_at, expires_at FROM acs_cache ORDER BY fetched_at DESC"
        ).fetchall()
        return [
            {
                'geoid':      r[0],
                'tables':     r[1],
                'fetched_at': r[2],
                'expires_at': datetime.fromtimestamp(r[3], tz=timezone.utc).isoformat(),
                'is_fresh':   r[3] >= time.time(),
            }
            for r in rows
        ]

    def close(self) -> None:
        """Close the underlying database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _connection(self) -> sqlite3.Connection:
        if self._conn is None:
            os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
            self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL;")
        return self._conn

    def _init_db(self) -> None:
        conn = self._connection()
        conn.execute(_CREATE_TABLE_SQL)
        conn.execute(_INDEX_SQL)
        conn.commit()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _main() -> None:
    import argparse
    import sys

    parser = argparse.ArgumentParser(description='Inspect or manage the ACS SQLite cache')
    sub    = parser.add_subparsers(dest='cmd')

    sub.add_parser('list',  help='List all cached records')
    sub.add_parser('purge', help='Remove expired records')
    sub.add_parser('clear', help='Remove ALL records')

    args = parser.parse_args()

    cache = ACSCache()

    if args.cmd == 'list':
        records = cache.list_records()
        if not records:
            print("Cache is empty.")
        for r in records:
            status = 'fresh' if r['is_fresh'] else 'EXPIRED'
            print(f"  [{status}]  geoid={r['geoid']}  tables={r['tables']}  fetched={r['fetched_at']}")
        cache.close()

    elif args.cmd == 'purge':
        n = cache.purge_expired()
        print(f"Purged {n} expired record(s).")
        cache.close()

    elif args.cmd == 'clear':
        n = cache.clear_all()
        print(f"Cleared {n} record(s).")
        cache.close()

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == '__main__':
    _main()
