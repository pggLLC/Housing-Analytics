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
    @staticmethod
    def valid_superfund_row(**overrides):
        row = {
            "epa_id": "COD1", "site_id": "1", "name": "Located",
            "fk_ref_state_code": "CO", "fips_code": "08031",
            "county_name": "DENVER", "npl_status_code": "F",
            "npl_status_name": "Final", "primary_latitude_decimal_val": "39.7",
            "primary_longitude_decimal_val": "-104.9",
        }
        row.update(overrides)
        return row

    @staticmethod
    def valid_brownfield_row(**overrides):
        row = {
            "pgm_sys_id": "ACRES-1", "registry_id": "1", "primary_name": "Located",
            "state_code": "CO", "fips_code": "08031", "county_name": "DENVER",
            "latitude": "39.7", "longitude": "-104.9",
        }
        row.update(overrides)
        return row

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

    def test_page_limit_response_is_rejected_without_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "must-not-exist.json"

            def fetcher(url):
                if url == epa.SEMS_QUERY_URL:
                    return [self.valid_superfund_row()] * epa.PAGE_LIMIT
                return [self.valid_brownfield_row()]

            with self.assertRaisesRegex(RuntimeError, "page limit"):
                epa.run(output_path=output, fetcher=fetcher)
            self.assertFalse(output.exists())

    def test_sems_response_outside_colorado_is_rejected(self):
        def fetcher(url):
            if url == epa.SEMS_QUERY_URL:
                return [self.valid_superfund_row(fk_ref_state_code="WY")]
            return [self.valid_brownfield_row()]

        with self.assertRaisesRegex(RuntimeError, "SEMS response contains records outside Colorado"):
            epa.build_dataset(fetcher=fetcher)

    def test_acres_response_outside_colorado_is_rejected(self):
        def fetcher(url):
            if url == epa.SEMS_QUERY_URL:
                return [self.valid_superfund_row()]
            return [self.valid_brownfield_row(state_code="WY")]

        with self.assertRaisesRegex(RuntimeError, "ACRES response contains records outside Colorado"):
            epa.build_dataset(fetcher=fetcher)


    # 28 Nov 2026: EPA leaves fips_code blank on some ACRES rows (Saguache, Rio Grande) and gives
    # El Paso's 08041 to rows in other counties. The county comes from the name, checked by the point.
    def test_blank_county_code_is_filled_from_the_county_name(self):
        records, _ = epa.normalize_brownfields([self.valid_brownfield_row(
            fips_code="", county_name="SAGUACHE", latitude="38.0867", longitude="-106.1382")])
        self.assertEqual(records[0]["county_fips"], "08109")
        self.assertIn("blank", records[0]["county_fips_from"])

    def test_wrong_county_code_is_replaced_only_when_the_point_is_in_the_named_county(self):
        records, _ = epa.normalize_brownfields([
            self.valid_brownfield_row(pgm_sys_id="A", fips_code="08041", county_name="RIO GRANDE",
                                      latitude="37.5826", longitude="-106.1495"),
            self.valid_brownfield_row(pgm_sys_id="B", fips_code="08041", county_name="RIO GRANDE",
                                      latitude="38.83", longitude="-104.83"),
        ])
        by_id = {r["id"]: r for r in records}
        self.assertEqual(by_id["A"]["county_fips"], "08105")
        self.assertEqual(by_id["B"]["county_fips"], "08041")
        self.assertNotIn("county_fips_from", by_id["B"])

    def test_matching_county_code_is_left_alone(self):
        records, _ = epa.normalize_brownfields([self.valid_brownfield_row()])
        self.assertEqual(records[0]["county_fips"], "08031")
        self.assertNotIn("county_fips_from", records[0])

    def test_checked_point_carries_its_note(self):
        records, _ = epa.normalize_brownfields([self.valid_brownfield_row(
            pgm_sys_id="270267", fips_code="", county_name="RIO GRANDE",
            latitude="37.613167", longitude="-106.231061")])
        self.assertIn("airnav.com/airport/KMVI", records[0]["coordinate_note"])
        self.assertEqual(records[0]["lat"], 37.613167)

    def test_committed_file_has_no_blank_or_contradicted_county_code(self):
        data = json.loads((ROOT / "data/environmental/epa-superfund-co.json").read_text(encoding="utf-8"))
        counties = epa.load_counties()
        for record in data["brownfieldSites"]:
            self.assertTrue(record["county_fips"], record["id"])
            named = counties.get(record["county"])
            if named and record["county_fips"] != named[0]:
                self.assertFalse(any(epa._inside(record["lon"], record["lat"], ring) for ring in named[1]), record["id"])
        self.assertEqual(data["meta"]["brownfield_records"], len(data["brownfieldSites"]))

if __name__ == "__main__":
    unittest.main()
