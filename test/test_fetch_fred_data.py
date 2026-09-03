import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("fetch_fred_data", ROOT / "scripts" / "fetch_fred_data.py")
fred = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fred)


class Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self): return self
    def __exit__(self, *_args): return False
    def read(self): return self.payload


class FredStateTests(unittest.TestCase):
    def test_4xx_is_invalid_id_and_not_retried(self):
        calls = []
        def opener(url, timeout):
            calls.append(url)
            raise urllib.error.HTTPError(url, 400, "bad id", {}, None)
        entry = fred.fetch_series("BAD", "Bad", None, "key", {}, opener, lambda _: None)
        self.assertEqual(entry["status"], fred.INVALID_ID)
        self.assertEqual(len(calls), 1)

    def test_429_is_temporary_and_not_retried(self):
        calls = []
        def opener(url, timeout):
            calls.append(url)
            raise urllib.error.HTTPError(url, 429, "rate limited", {}, None)
        entry = fred.fetch_series("GOOD", "Good", None, "key", {}, opener, lambda _: None)
        self.assertEqual(entry["status"], fred.TEMPORARILY_UNAVAILABLE)
        self.assertEqual(len(calls), 1)

    def test_5xx_retries_and_preserves_previous_observations(self):
        calls = []
        previous = {"GOOD": {"observations": [{"date": "2025-01-01", "value": "1"}]}}
        def opener(url, timeout):
            calls.append(url)
            raise urllib.error.HTTPError(url, 503, "down", {}, None)
        entry = fred.fetch_series("GOOD", "Good", None, "key", previous, opener, lambda _: None)
        self.assertEqual(entry["status"], fred.TEMPORARILY_UNAVAILABLE)
        self.assertEqual(entry["observations"], previous["GOOD"]["observations"])
        self.assertNotIn("last observation", entry["unavailable_reason"].lower())
        self.assertEqual(len(calls), 4)

    def test_old_existing_series_is_discontinued_and_keeps_history(self):
        meta = {"seriess": [{"title": "Old weekly series", "frequency": "Weekly"}]}
        obs = {"observations": [{"date": "2025-03-01", "value": "1"}]}
        opener = lambda url, timeout: Response(obs if "observations" in url else meta)
        entry = fred.fetch_series("OLD", "Old", None, "key", {}, opener, lambda _: None,
                                  datetime(2026, 9, 3, tzinfo=timezone.utc))
        self.assertEqual(entry["status"], fred.DISCONTINUED)
        self.assertEqual(len(entry["observations"]), 1)
        self.assertIn("last observation 2025-03-01", entry["unavailable_reason"])

    def test_annual_series_is_awaiting_release_not_error(self):
        meta = {"seriess": [{"title": "Annual series", "frequency": "Annual"}]}
        obs = {"observations": [{"date": "2025-01-01", "value": "1"}]}
        opener = lambda url, timeout: Response(obs if "observations" in url else meta)
        entry = fred.fetch_series("ANNUAL", "Annual", None, "key", {}, opener, lambda _: None,
                                  datetime(2026, 9, 3, tzinfo=timezone.utc))
        self.assertEqual(entry["status"], fred.AWAITING_RELEASE)
        self.assertNotIn("error", entry["unavailable_reason"].lower())

    def test_unresolved_invalid_id_fails_run(self):
        old_series = fred.SERIES
        try:
            fred.SERIES = {"BAD": ("Bad", None)}
            def opener(url, timeout):
                raise urllib.error.HTTPError(url, 400, "bad id", {}, None)
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "fred.json"
                with self.assertRaisesRegex(RuntimeError, "unresolved invalid_id: BAD"):
                    fred.run("key", output, opener, lambda _: None,
                             datetime(2026, 9, 3, tzinfo=timezone.utc))
                written = json.loads(output.read_text())
                self.assertEqual(written["series"]["BAD"]["status"], fred.INVALID_ID)
        finally:
            fred.SERIES = old_series


if __name__ == "__main__":
    unittest.main()
