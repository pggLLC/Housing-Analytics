"""Guard: the CHFA QAP watcher reports QAP changes and never mistakes a failed
fetch for a removal.

The watcher exists because a change in the final 2027-2028 QAP -- the federal
9% per-project maximum, reported as $1.85M -> $1.7M a year -- reached this
project by word of mouth, and because data/chfa-qap-calendar.json linked two
CHFA pages that returned 404 for three months without anything noticing.

These tests run the watcher against a fake CHFA (no network) and small PDFs
built in the test, so no fixture files are added under data/. The fake site
lives on chfa.localhost so the source-URL sweep, which probes every URL a PR
adds, never fetches a fixture address.

Run: python3 -m pytest tests/test_chfa_qap_watch.py -q
"""

import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "audit" / "chfa_qap_watch.py"
WORKFLOW = ROOT / ".github" / "workflows" / "chfa-qap-watch.yml"

spec = importlib.util.spec_from_file_location("chfa_qap_watch", SRC)
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)

QAP_URL = "https://chfa.localhost/rental-housing/housing-credit/qualified-allocation-plan"
HEARING_URL = "https://chfa.localhost/rental-housing/housing-credit/qap-hearing"
PAGES = [("qap", QAP_URL), ("hearing", HEARING_URL)]
QAP_PDF = "https://chfa.localhost/getattachment/aaaa/2027-2028-QAP.pdf"
SUMMARY_PDF = "https://chfa.localhost/getattachment/bbbb/2027-2028-QAP-Summary-of-Changes.pdf"
FORM_PDF = "https://chfa.localhost/getattachment/cccc/Application-Checklist.pdf"


def make_pdf(lines):
    """A minimal one-page PDF whose text layer is `lines`."""
    def esc(s):
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content = "BT /F1 11 Tf 72 720 Td 14 TL " + " ".join(f"({esc(l)}) Tj T*" for l in lines) + " ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
         + "/Resources << /Font << /F1 5 0 R >> >> >>"),
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{obj}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def qap_page(links):
    items = "".join(f'<li><a href="{u}">{t}</a></li>' for u, t in links)
    return (f"<html><head><script>var x='$9,999,999 maximum';</script></head><body>"
            f"<h1>Qualified Allocation Plan</h1><p>Final 2027-2028 QAP adopted September 10, 2026.</p>"
            f"<ul>{items}<li><a href='/contact'>Contact</a></li></ul></body></html>").encode()


def site(cap, extra_links=(), hearing_text="Hearings: July 14, July 16 and August 26, 2026."):
    """A fake CHFA: url -> (status, headers, body) or an Exception to raise."""
    links = [(QAP_PDF, "2027-2028 QAP (final)"), (SUMMARY_PDF, "Summary of Changes"),
             (FORM_PDF, "Application checklist"), *extra_links]
    return {
        QAP_URL: (200, {"content-type": "text/html"}, qap_page(links)),
        HEARING_URL: (200, {"content-type": "text/html"}, f"<p>{hearing_text}</p>".encode()),
        QAP_PDF: (200, {"content-type": "application/pdf"}, make_pdf([
            "Section 4. Credit Limits",
            f"The maximum federal credit per development is {cap} annually.",
            "Developments must meet the minimum set-aside requirements.",
            "Scoring criteria are described in Section 5.",
        ])),
        SUMMARY_PDF: (200, {"content-type": "application/pdf"},
                      make_pdf(["Summary of Changes", f"Per-development maximum changed to {cap}."])),
        FORM_PDF: (200, {"content-type": "application/pdf"}, make_pdf(["Checklist item 1 costs $100."])),
    }


def fetcher(pages):
    def fetch(url):
        hit = pages.get(url)
        if hit is None:
            raise OSError(f"no route to {url}")
        if isinstance(hit, Exception):
            raise hit
        return hit
    return fetch


@pytest.fixture(autouse=True)
def fake_pdf_text(monkeypatch, request):
    """Most tests do not need a real PDF parser: read the text back out of make_pdf's
    content stream. test_real_pdf_text_extraction uses pypdf itself."""
    if request.node.name == "test_real_pdf_text_extraction":
        return

    def fake(data):
        found = re.findall(rb"\(((?:[^()\\]|\\.)*)\) Tj", data)
        if not found:
            return None, None, "no text"
        return "\n".join(f.decode("latin-1").replace("\\(", "(").replace("\\)", ")") for f in found), 1, None
    monkeypatch.setattr(watch, "pdf_text", fake)


def test_document_links_finds_documents_and_nothing_else():
    links = watch.document_links(qap_page([(QAP_PDF, "QAP"), ("/files/local.pdf#page=2", "Local"),
                                           (QAP_PDF, "QAP again")]).decode(), QAP_URL)
    urls = [l["url"] for l in links]
    # non-vacuity: the scan found the documents it should
    assert urls == [QAP_PDF, "https://chfa.localhost/files/local.pdf"]
    assert all(not u.endswith("/contact") for u in urls)


def test_baseline_records_qap_text_and_key_lines():
    r = watch.run(fetch=fetcher(site("$1,850,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    assert r["changes"]["baseline"] is True and r["has_changes"] is True
    docs = {d["url"]: d for d in r["documents"]}
    assert set(docs) == {QAP_PDF, SUMMARY_PDF, FORM_PDF}
    qap = docs[QAP_PDF]
    assert "maximum federal credit per development is $1,850,000" in qap["text"]
    assert any("$1,850,000" in ln for ln in qap["key_lines"])
    # the scoring line has no amount or limit word, so it is not a key line
    assert not any("Scoring criteria" in ln for ln in qap["key_lines"])
    # non-QAP documents are fingerprinted, not stored as text
    assert "text" not in docs[FORM_PDF] and docs[FORM_PDF]["sha256"]
    # script tags never count as page text
    qap_page_entry = next(p for p in r["source_pages"] if p["id"] == "qap")
    assert "$9,999,999" not in qap_page_entry["text"]


def test_cap_change_is_reported_with_before_and_after_lines():
    first = watch.run(fetch=fetcher(site("$1,850,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    second = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    ch = second["changes"]
    assert second["has_changes"] and not ch["baseline"]
    changed = {c["url"]: c for c in ch["changed_documents"]}
    assert set(changed) == {QAP_PDF, SUMMARY_PDF}
    diff = changed[QAP_PDF]["key_lines"]
    assert any("$1,700,000" in ln for ln in diff["added"])
    assert any("$1,850,000" in ln for ln in diff["removed"])
    qap = next(d for d in second["documents"] if d["url"] == QAP_PDF)
    assert qap["first_seen_at"] == "2026-09-30T05:21:00Z" and qap["last_changed_at"] == "2026-10-07T05:21:00Z"


def test_quiet_week_changes_nothing_but_timestamps():
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    again = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert not again["has_changes"]
    assert watch._content(first) == watch._content(again), "an unchanged week must not rewrite the file"


def test_failed_page_fetch_is_not_a_removal():
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    down = site("$1,700,000")
    down[QAP_URL] = OSError("403 Forbidden")
    r = watch.run(fetch=fetcher(down), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert r["changes"]["removed_documents"] == []
    assert {d["url"] for d in r["documents"]} == {QAP_PDF, SUMMARY_PDF, FORM_PDF}
    assert any(f["url"] == QAP_URL for f in r["fetch_failures"])
    assert not r["all_fetches_failed"]  # the hearing page still loaded


def test_everything_down_is_flagged_and_keeps_previous_documents():
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    r = watch.run(fetch=fetcher({}), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert r["all_fetches_failed"] is True
    assert r["changes"]["removed_documents"] == []
    assert {d["url"] for d in r["documents"]} == {QAP_PDF, SUMMARY_PDF, FORM_PDF}


def test_removed_only_when_its_page_loaded_without_it():
    extra = "https://chfa.localhost/getattachment/dddd/2027-2028-QAP-Redline.pdf"
    pages = site("$1,700,000", extra_links=[(extra, "Redline")])
    pages[extra] = (200, {}, make_pdf(["Redline: maximum $1,700,000"]))
    first = watch.run(fetch=fetcher(pages), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    r = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert [d["url"] for d in r["changes"]["removed_documents"]] == [extra]


def test_new_hearing_date_is_a_page_change():
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    r = watch.run(fetch=fetcher(site("$1,700,000", hearing_text="Hearing: November 3, 2026.")),
                  previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert [p["id"] for p in r["changes"]["changed_pages"]] == ["hearing"]
    assert r["has_changes"]


def test_main_does_not_rewrite_on_a_quiet_week(tmp_path, monkeypatch):
    out = tmp_path / "chfa-qap-watch.json"
    monkeypatch.setattr(watch, "PAGES", PAGES)
    monkeypatch.setattr(watch, "http_fetch", fetcher(site("$1,700,000")))
    assert watch.main(["--out", str(out), "--summary", str(tmp_path / "run.json")]) == 0
    written = out.read_text()
    assert watch.main(["--out", str(out), "--summary", str(tmp_path / "run.json")]) == 0
    assert out.read_text() == written, "second, unchanged run rewrote the file (timestamps only)"
    assert (tmp_path / "run.json").exists()


def test_membership_on_a_failed_page_survives_until_that_page_is_checked():
    """A document listed on two pages, one of which fails, must not be reported
    removed later just because the page that did load stopped listing it."""
    both = site("$1,700,000")
    both[HEARING_URL] = (200, {}, qap_page([(QAP_PDF, "2027-2028 QAP (final)")]))
    first = watch.run(fetch=fetcher(both), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    assert next(d for d in first["documents"] if d["url"] == QAP_PDF)["found_on"] == ["qap", "hearing"]

    hearing_down = dict(both)
    hearing_down[HEARING_URL] = OSError("503")
    second = watch.run(fetch=fetcher(hearing_down), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert next(d for d in second["documents"] if d["url"] == QAP_PDF)["found_on"] == ["qap", "hearing"]

    gone_from_qap = site("$1,700,000", extra_links=())
    gone_from_qap[QAP_URL] = (200, {}, qap_page([(SUMMARY_PDF, "Summary of Changes"), (FORM_PDF, "Checklist")]))
    gone_from_qap[HEARING_URL] = OSError("503")
    third = watch.run(fetch=fetcher(gone_from_qap), previous=second, now="2026-10-14T05:21:00Z", pages=PAGES)
    assert third["changes"]["removed_documents"] == [], "hearing page was never checked without the QAP link"
    assert QAP_PDF in {d["url"] for d in third["documents"]}


def test_unreadable_new_version_is_an_extraction_failure_not_deleted_lines(monkeypatch):
    first = watch.run(fetch=fetcher(site("$1,850,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    real_fake = watch.pdf_text
    monkeypatch.setattr(watch, "pdf_text", lambda data: (None, None, "text extraction failed: encrypted")
                        if b"1,700,000" in data else real_fake(data))
    r = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    changed = {c["url"]: c for c in r["changes"]["changed_documents"]}
    assert changed[QAP_PDF]["key_lines"] is None, "no text is not the same as every line deleted"
    assert "encrypted" in changed[QAP_PDF]["extraction_error"]
    assert {f["url"] for f in r["extraction_failures"]} >= {QAP_PDF}
    # an image-only PDF (empty text layer) counts as a failure too
    monkeypatch.setattr(watch, "pdf_text", lambda data: ("   \n  ", 1, None))
    r2 = watch.run(fetch=fetcher(site("$1,600,000")), previous=first, now="2026-10-14T05:21:00Z", pages=PAGES)
    assert any(f["url"] == QAP_PDF and "image-only" in f["error"] for f in r2["extraction_failures"])


def test_real_pdf_text_extraction():
    pytest.importorskip("pypdf")
    text, pages, err = watch.pdf_text(make_pdf(["The maximum federal credit per development is $1,700,000 annually."]))
    assert err is None and pages == 1
    assert "$1,700,000" in text


def test_workflow_agrees_with_the_script():
    """The workflow commits the file the script writes, keeps the run summary out of
    data/ (rebuild_manifest.py walks the filesystem), and fires on a minute no other
    workflow uses."""
    wf = WORKFLOW.read_text()
    rel = watch.OUT_FILE.relative_to(ROOT).as_posix()
    # AGENTS.md rule 3: both manifests, _manifest first, then schema validation,
    # and all of it only when the watch file changed (a quiet week commits nothing).
    commit_step = wf[wf.index("Commit refreshed watch result"):]
    gate = commit_step.index(f"git diff --quiet -- {rel}")
    first_manifest = commit_step.index("npm run audit:file-manifest")
    assert gate < first_manifest < commit_step.index("python3 scripts/rebuild_manifest.py") \
        < commit_step.index("node scripts/validate-schemas.js")
    assert f"git add {rel} data/_manifest.json data/manifest.json" in commit_step
    assert re.search(r'--summary\s+"?\$RUNNER_TEMP/', wf), "run summary must be written outside data/"
    assert "pypdf" in wf, "the workflow must install the PDF parser the script imports"
    # CHFA's current QAP PDFs are AES-encrypted; without cryptography every one of
    # them was recorded as an extraction failure on the first run.
    assert re.search(r"pip install[^\n]*\bcryptography\b", wf), "the workflow must install cryptography for AES PDFs"
    crons = re.findall(r"cron:\s*'([^']+)'", wf)
    assert len(crons) == 1
    minute = crons[0].split()[0]
    assert minute not in ("0", "00"), "keep crons off :00 (AGENTS.md)"
    others = [p for p in (ROOT / ".github" / "workflows").glob("*.yml") if p.name != WORKFLOW.name]
    used = {m.split()[0] for p in others for m in re.findall(r"cron:\s*'([^']+)'", p.read_text())}
    assert minute not in used, f"minute {minute} is already used by another workflow"


# -- size bound ---------------------------------------------------------------
# The first scheduled run stored the text of every QAP back to 2016 and wrote a
# 5.3 MiB file, over check-data-file-sizes.mjs's 5 MiB ceiling, which failed
# ci-checks on every open PR.

OLD_CYCLE_PDFS = [
    ("https://chfa.localhost/getattachment/e1/2025-2026-QAP-Amended.pdf", "2025-26 QAP - Amended"),
    ("https://chfa.localhost/getattachment/e2/2023-24-QAP.pdf", "2023-24 QAP"),
    ("https://chfa.localhost/getattachment/e3/CHFA_QAP_2016.pdf", "2016 QAP"),
    # the title names the month of the hearing; only the file name names the cycle
    ("https://chfa.localhost/getattachment/e4/2027-28-CHFA-QAP-PublicHearing-Presentation.pdf",
     "July 2026 Public Hearing Presentation (PDF of PPT)"),
]


def many_cycles_site():
    pages = site("$1,700,000", extra_links=OLD_CYCLE_PDFS)
    for url, title in OLD_CYCLE_PDFS:
        pages[url] = (200, {}, make_pdf([f"{title}: maximum credit $1,000,000 per development."]))
    return pages


def test_qap_cycle_reads_the_range_before_a_bare_year():
    cases = {
        ("2027-28 QAP - Third Draft (PDF)", "https://x.localhost/a/2027-2028-QAP-ThirdDraft.pdf"): 2027,
        ("July 2026 Public Hearing Presentation (PDF of PPT)",
         "https://x.localhost/a/2027-28-CHFA-QAP-PublicHearing-Presentation.pdf"): 2027,
        ("2025-26 QAP Fee Schedule", "https://x.localhost/a/2025-26-QAP-Fee-Schedule.pdf"): 2025,
        ("2021-22 QAP Fee Schedule", "https://x.localhost/a/QAP_FeeSchedule.pdf"): 2021,
        ("2016 QAP", "https://x.localhost/a/CHFA_QAP_2016.pdf"): 2016,
        ("Webinar Slides (PDF)", "https://x.localhost/a/Submit-a-competitive-application-presentation.pdf"): None,
    }
    for (title, url), want in cases.items():
        assert watch.qap_cycle({"title": title, "url": url}) == want, title


def test_only_the_newest_cycles_keep_full_text():
    r = watch.run(fetch=fetcher(many_cycles_site()), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    docs = {d["url"]: d for d in r["documents"]}
    with_text = {u for u, d in docs.items() if "text" in d}
    # non-vacuity: both kept cycles (2027 and 2025) still carry text
    assert with_text == {QAP_PDF, SUMMARY_PDF, OLD_CYCLE_PDFS[0][0], OLD_CYCLE_PDFS[3][0]}
    for url in (OLD_CYCLE_PDFS[1][0], OLD_CYCLE_PDFS[2][0]):
        d = docs[url]
        assert "older QAP cycle" in d["text_omitted"]
        assert d["sha256"] and any("$1,000,000" in ln for ln in d["key_lines"]), "hash and key lines stay"
        assert d["text_chars"] > 0


def test_old_cycle_text_carried_from_a_previous_run_is_dropped():
    """The committed file already holds old-cycle text; an unchanged document copies
    its previous fields forward, and the retention rule must still apply to it."""
    first = watch.run(fetch=fetcher(many_cycles_site()), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    old = next(d for d in first["documents"] if d["url"] == OLD_CYCLE_PDFS[2][0])
    old["text"] = "2016 text that an earlier version of the watcher stored"
    old.pop("text_omitted")
    again = watch.run(fetch=fetcher(many_cycles_site()), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    assert "text" not in next(d for d in again["documents"] if d["url"] == OLD_CYCLE_PDFS[2][0])


def test_text_budget_drops_older_documents_first(monkeypatch):
    r0 = watch.run(fetch=fetcher(many_cycles_site()), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    newest = sum(watch.text_serialized_bytes(d["text"]) for d in r0["documents"]
                 if "text" in d and watch.qap_cycle(d) == 2027)
    monkeypatch.setattr(watch, "MAX_TEXT_BYTES_TOTAL", newest)  # room for the 2027 cycle only
    r = watch.run(fetch=fetcher(many_cycles_site()), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    docs = {d["url"]: d for d in r["documents"]}
    assert "text" in docs[QAP_PDF] and "text" in docs[OLD_CYCLE_PDFS[3][0]]
    assert "text budget" in docs[OLD_CYCLE_PDFS[0][0]]["text_omitted"]


def test_failed_extraction_is_retried_when_the_bytes_are_unchanged(monkeypatch):
    real_fake = watch.pdf_text
    monkeypatch.setattr(watch, "pdf_text", lambda data: (None, None, "DependencyError: cryptography>=3.1 is required"))
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    assert {f["url"] for f in first["extraction_failures"]} == {QAP_PDF, SUMMARY_PDF}

    monkeypatch.setattr(watch, "pdf_text", real_fake)  # the environment was fixed
    r = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-10-07T05:21:00Z", pages=PAGES)
    qap = next(d for d in r["documents"] if d["url"] == QAP_PDF)
    assert "$1,700,000" in qap["text"] and "text_error" not in qap
    assert r["extraction_failures"] == []
    # same bytes: not reported as a changed document, and its change time stands
    assert r["changes"]["changed_documents"] == []
    assert qap["last_changed_at"] == "2026-09-30T05:21:00Z"


def test_main_refuses_to_write_a_file_over_the_ceiling(tmp_path, monkeypatch):
    out = tmp_path / "chfa-qap-watch.json"
    out.write_text('{"previous": true}\n')
    monkeypatch.setattr(watch, "PAGES", PAGES)
    monkeypatch.setattr(watch, "http_fetch", fetcher(site("$1,700,000")))
    monkeypatch.setattr(watch, "MAX_OUT_BYTES", 1000)
    assert watch.main(["--out", str(out), "--summary", str(tmp_path / "run.json")]) == 1
    assert out.read_text() == '{"previous": true}\n', "an oversized result must not replace the file"
    assert (tmp_path / "run.json").exists(), "the workflow's issue step still gets a run summary"


def test_size_bounds_agree_with_the_repo_ceiling():
    """MAX_OUT_BYTES must sit below the ceiling ci-checks enforces on this file, and
    the committed file must be under it."""
    guard = (ROOT / "scripts" / "check-data-file-sizes.mjs").read_text()
    m = re.search(r"defaultLimit\s*=\s*(\d+)\s*\*\s*MIB", guard)
    assert m, "could not read the default ceiling from check-data-file-sizes.mjs"
    rel = watch.OUT_FILE.relative_to(ROOT).as_posix()
    limit = int(m.group(1)) * 1024 * 1024
    em = re.search(re.escape(f"'{rel}'") + r",\s*(\d+)\s*\*\s*MIB", guard)
    if em:
        limit = int(em.group(1)) * 1024 * 1024
    assert watch.MAX_TEXT_BYTES_TOTAL < watch.MAX_OUT_BYTES < limit
    assert watch.OUT_FILE.stat().st_size <= watch.MAX_OUT_BYTES, \
        f"{rel} is over MAX_OUT_BYTES; regenerate it with the current watcher"
