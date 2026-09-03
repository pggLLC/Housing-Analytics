#!/usr/bin/env python3
import importlib.util
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "fetch_epa_environmental", ROOT / "scripts" / "market" / "fetch_epa_environmental.py"
)
epa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(epa)


class Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class EpaEnvironmentalFetcherTests(unittest.TestCase):
    def test_4xx_is_not_retried(self):
        calls = []

        def opener(request, timeout):
            calls.append((request.full_url, timeout))
            raise urllib.error.HTTPError(request.full_url, 404, "missing", {}, None)

        with self.assertRaisesRegex(RuntimeError, "HTTP 404"):
            epa.fetch_json("http://127.0.0.1/missing", opener=opener, sleep_fn=lambda _: None)
        self.assertEqual(len(calls), 1)

    def test_5xx_is_retried_then_fails(self):
        calls = []

        def opener(request, timeout):
            calls.append((request.full_url, timeout))
            raise urllib.error.HTTPError(request.full_url, 503, "down", {}, None)

        with self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
            epa.fetch_json("http://127.0.0.1/down", opener=opener, sleep_fn=lambda _: None)
        self.assertEqual(len(calls), 3)

    def test_empty_response_is_failure(self):
        with self.assertRaisesRegex(RuntimeError, "empty or invalid"):
            epa.fetch_json(
                "http://127.0.0.1/empty",
                opener=lambda _request, timeout: Response([]),
                sleep_fn=lambda _: None,
                retries=1,
            )

    def test_failed_build_leaves_previous_file_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "last-good.json"
            original = b'{"last_good":true}\n'
            output.write_bytes(original)

            def failure(_url):
                raise RuntimeError("upstream unavailable")

            with self.assertRaisesRegex(RuntimeError, "upstream unavailable"):
                epa.run(output_path=output, fetcher=failure)
            self.assertEqual(output.read_bytes(), original)

    def test_cli_returns_nonzero_when_fetch_fails(self):
        original_run = epa.run
        try:
            epa.run = lambda: (_ for _ in ()).throw(RuntimeError("upstream unavailable"))
            self.assertEqual(epa.main(), 1)
        finally:
            epa.run = original_run

    def test_missing_coordinates_are_omitted_and_counted(self):
        rows = [
            {
                "epa_id": "COD1", "site_id": "1", "name": "Located",
                "fips_code": "08031", "county_name": "DENVER",
                "npl_status_code": "F", "npl_status_name": "Final",
                "primary_latitude_decimal_val": "39.7",
                "primary_longitude_decimal_val": "-104.9",
            },
            {
                "epa_id": "COD2", "site_id": "2", "name": "Unlocated",
                "fips_code": "08031", "county_name": "DENVER",
                "npl_status_code": "F", "npl_status_name": "Final",
                "primary_latitude_decimal_val": None,
                "primary_longitude_decimal_val": None,
            },
        ]
        records, omitted = epa.normalize_superfund(rows)
        self.assertEqual([record["id"] for record in records], ["COD1"])
        self.assertEqual(omitted, 1)

    def test_missing_coordinates_are_reported_in_dataset_meta(self):
        superfund_rows = [
            {
                "epa_id": "COD1", "site_id": "1", "name": "Located",
                "fk_ref_state_code": "CO", "fips_code": "08031",
                "county_name": "DENVER", "npl_status_code": "F",
                "npl_status_name": "Final", "primary_latitude_decimal_val": "39.7",
                "primary_longitude_decimal_val": "-104.9",
            },
            {
                "epa_id": "COD2", "site_id": "2", "name": "Unlocated",
                "fk_ref_state_code": "CO", "fips_code": "08031",
                "county_name": "DENVER", "npl_status_code": "F",
                "npl_status_name": "Final", "primary_latitude_decimal_val": None,
                "primary_longitude_decimal_val": None,
            },
        ]
        brownfield_rows = [{
            "pgm_sys_id": "ACRES-1", "registry_id": "1", "primary_name": "Located",
            "state_code": "CO", "fips_code": "08031", "county_name": "DENVER",
            "latitude": "39.7", "longitude": "-104.9",
        }]

        def fetcher(url):
            return superfund_rows if url == epa.SEMS_QUERY_URL else brownfield_rows

        dataset = epa.build_dataset(fetcher=fetcher, retrieved_at="2026-09-03T00:00:00Z")
        self.assertEqual(dataset["meta"]["superfund_source_records"], 2)
        self.assertEqual(dataset["meta"]["superfund_records"], 1)
        self.assertEqual(dataset["meta"]["superfund_omitted_missing_coordinates"], 1)


if __name__ == "__main__":
    unittest.main()
