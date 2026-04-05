#!/usr/bin/env python3
"""
scripts/market/fetch_data.py

Data fetching utility with exponential retry logic backed by the
``tenacity`` library.  Designed as a drop-in HTTP helper for market data
build pipelines that need robust resilience against transient API failures
(HTTP 403, 429, 500, 503, etc.).

Usage (as library):
    from scripts.market.fetch_data import fetch_with_retry
    raw = fetch_with_retry("https://example.com/data.json")

Usage (standalone):
    python scripts/market/fetch_data.py <url> [<output-file>]

Environment variables:
    PMA_FETCH_RETRIES    — total attempts (default 6)
    PMA_FETCH_TIMEOUT    — socket timeout in seconds (default 120)
    PMA_FETCH_BACKOFF    — base backoff in seconds (default 5)
    PMA_FETCH_MAX_WAIT   — max wait between retries in seconds (default 60)
"""

import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    from tenacity import (
        retry,
        retry_if_exception,
        stop_after_attempt,
        wait_exponential,
        before_sleep_log,
        RetryError,
    )
    import logging as _logging
    _HAS_TENACITY = True
except ImportError:  # pragma: no cover
    _HAS_TENACITY = False

# ── Configuration ──────────────────────────────────────────────────────────────

_RETRIES    = int(os.environ.get("PMA_FETCH_RETRIES", 6))
_TIMEOUT    = int(os.environ.get("PMA_FETCH_TIMEOUT", 120))
_BACKOFF    = float(os.environ.get("PMA_FETCH_BACKOFF", 5.0))
_MAX_WAIT   = float(os.environ.get("PMA_FETCH_MAX_WAIT", 60.0))

# HTTP status codes that represent transient server-side issues worth retrying.
# 400: TIGERweb/ArcGIS spurious Bad Request under load.
# 403: HUD OpenData temporary access denial during high-traffic windows.
# 429: Rate limit — back off and retry.
# 5xx: Generic server errors.
_RETRYABLE_CODES = {400, 403, 429, 500, 502, 503, 504}

_logger = _logging.getLogger(__name__)
_logging.basicConfig(
    stream=sys.stdout,
    level=_logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)


# ── Core fetch function ────────────────────────────────────────────────────────

class _RetryableHTTPError(Exception):
    """Raised for HTTP status codes that should trigger a retry."""
    def __init__(self, code: int, url: str):
        self.code = code
        self.url = url
        super().__init__(f"HTTP {code} for {url[:100]}")


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, (_RetryableHTTPError, urllib.error.URLError))


def _make_request(url: str, timeout: int) -> bytes:
    """Execute a single HTTP GET and return the response body.

    Raises
    ------
    _RetryableHTTPError
        For status codes in ``_RETRYABLE_CODES``.
    RuntimeError
        For non-retryable HTTP errors (e.g., 401, 404).
    urllib.error.URLError
        For network-level errors (triggers retry).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "pma-build/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            _logger.info("[fetch] HTTP %s for %s", resp.status, url[:100])
            return resp.read()
    except urllib.error.HTTPError as e:
        code = e.code
        if code in _RETRYABLE_CODES:
            _logger.warning("[fetch] Retryable HTTP %s for %s", code, url[:100])
            raise _RetryableHTTPError(code, url) from e
        # Non-retryable
        if code == 404:
            detail = "URL not found — endpoint may have moved or been removed"
        elif code == 401:
            detail = "authentication required — check credentials"
        else:
            detail = e.reason or str(e)
        _logger.error("[fetch] Non-retryable HTTP %s for %s — %s", code, url[:100], detail)
        raise RuntimeError(f"HTTP {code} (non-retryable): {detail} | URL: {url}") from e


def fetch_with_retry(
    url: str,
    retries: int = _RETRIES,
    timeout: int = _TIMEOUT,
    backoff_base: float = _BACKOFF,
    max_wait: float = _MAX_WAIT,
) -> bytes:
    """Fetch *url* with exponential backoff + jitter retry logic.

    Uses ``tenacity`` when available; falls back to a manual retry loop
    so the function works even without the optional dependency installed.

    Parameters
    ----------
    url:          Target URL to fetch.
    retries:      Total number of attempts (first try + retries).
    timeout:      Per-request socket timeout in seconds.
    backoff_base: Base wait between retries (seconds).  Doubles each attempt.
    max_wait:     Maximum wait between retries (seconds).

    Returns
    -------
    bytes
        Raw response body.

    Raises
    ------
    RuntimeError
        When all retry attempts are exhausted or a non-retryable error occurs.
    """
    _logger.info("[fetch] Starting fetch: %s", url[:120])

    if _HAS_TENACITY:
        return _fetch_with_tenacity(url, retries, timeout, backoff_base, max_wait)
    return _fetch_manual(url, retries, timeout, backoff_base, max_wait)


def _fetch_with_tenacity(url, retries, timeout, backoff_base, max_wait):
    """Tenacity-backed implementation."""
    import random

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(retries),
        wait=wait_exponential(multiplier=backoff_base, min=backoff_base, max=max_wait),
        before_sleep=before_sleep_log(_logger, _logging.WARNING),
        reraise=True,
    )
    def _attempt():
        return _make_request(url, timeout)

    try:
        return _attempt()
    except RetryError as e:
        raise RuntimeError(
            f"Failed after {retries} attempts: {e.last_attempt.exception()} | URL: {url}"
        ) from e


def _fetch_manual(url, retries, timeout, backoff_base, max_wait):
    """Pure-stdlib fallback (no tenacity required)."""
    import time
    import random

    last_err = None
    for attempt in range(retries):
        try:
            return _make_request(url, timeout)
        except _RetryableHTTPError as e:
            last_err = e
            if attempt < retries - 1:
                wait = min(backoff_base * (2 ** attempt), max_wait)
                wait += random.uniform(0, wait * 0.2)
                _logger.warning(
                    "[retry %d/%d] HTTP %s — waiting %.1fs before next attempt",
                    attempt + 1, retries - 1, e.code, wait,
                )
                time.sleep(wait)
        except urllib.error.URLError as e:
            last_err = e
            if attempt < retries - 1:
                wait = min(backoff_base * (2 ** attempt), max_wait)
                _logger.warning(
                    "[retry %d/%d] URLError: %s — waiting %.1fs", attempt + 1, retries - 1,
                    e.reason, wait,
                )
                import time as _t; _t.sleep(wait)

    raise RuntimeError(
        f"Failed after {retries} attempts: {last_err} | URL: {url}"
    ) from last_err


# ── CLI entrypoint ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <url> [<output-file>]", file=sys.stderr)
        sys.exit(1)

    target_url = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        data = fetch_with_retry(target_url)
    except RuntimeError as exc:
        _logger.error("Fetch failed: %s", exc)
        sys.exit(1)

    if output_file:
        import pathlib
        pathlib.Path(output_file).parent.mkdir(parents=True, exist_ok=True)
        pathlib.Path(output_file).write_bytes(data)
        _logger.info("Wrote %d bytes to %s", len(data), output_file)
    else:
        sys.stdout.buffer.write(data)
