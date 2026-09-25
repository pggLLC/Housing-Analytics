"""Guard: the CHFA QAP watcher reports QAP changes and never mistakes a failed
fetch for a removal.

The watcher exists because a change in the 2027-2028 QAP -- the federal 9%
per-project maximum, reported as $1.85M -> $1.7M a year (the Third Draft
actually cuts it from $1.8M to $1.7M in 2027 and $1.75M in 2028) -- reached
this project by word of mouth, and because data/chfa-qap-calendar.json linked two
CHFA pages that returned 404 for three months without anything noticing.

These tests run the watcher against a fake CHFA (no network) and small PDFs
built in the test, so no fixture files are added under data/. The fake site
lives on chfa.localhost so the source-URL sweep, which probes every URL a PR
adds, never fetches a fixture address.

Run: python3 -m pytest tests/test_chfa_qap_watch.py -q
"""

import importlib.util
import io
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
    if request.node.name.startswith("test_real_"):
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


def test_an_unchanged_document_that_could_not_be_read_is_read_again(monkeypatch):
    """The first live run could not open CHFA's encrypted drafts. Once extraction
    works, the same unchanged files must be read, not skipped as unchanged."""
    real_fake = watch.pdf_text
    monkeypatch.setattr(watch, "pdf_text", lambda data: (None, None, "text extraction failed: DependencyError")
                        if b"maximum federal credit" in data else real_fake(data))
    first = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-24T22:12:57Z", pages=PAGES)
    assert {f["url"] for f in first["extraction_failures"]} == {QAP_PDF}
    # Same files, same bytes, still unreadable: reported again, not silently carried over.
    again = watch.run(fetch=fetcher(site("$1,700,000")), previous=first, now="2026-09-30T05:21:00Z", pages=PAGES)
    assert {f["url"] for f in again["extraction_failures"]} == {QAP_PDF}, "a cached failure was dropped"
    # Extraction fixed, files unchanged: the text arrives and the run says so.
    monkeypatch.setattr(watch, "pdf_text", real_fake)
    fixed = watch.run(fetch=fetcher(site("$1,700,000")), previous=again, now="2026-10-07T05:21:00Z", pages=PAGES)
    doc = {d["url"]: d for d in fixed["documents"]}[QAP_PDF]
    assert any("$1,700,000" in line for line in doc["key_lines"]), "the unchanged file was never re-read"
    assert fixed["extraction_failures"] == []
    readable = {d["url"]: d for d in fixed["changes"]["now_readable"]}
    assert QAP_PDF in readable and fixed["has_changes"], "the newly readable text is not reported"
    assert fixed["changes"]["changed_documents"] == [], "an unchanged file is not a changed document"


def test_text_is_kept_only_for_the_newest_two_cycles():
    docs = [
        {"title": "2027-28 QAP - Third Draft (PDF)", "url": "https://chfa.localhost/a/2027-2028-QAP-ThirdDraft.pdf", "text": "x"},
        {"title": "August 2026 Public Hearing Presentation (PDF of PPT)",
         "url": "https://chfa.localhost/b/2027-28-CHFA-QAP-PublicHearing-Presentation-Aug2026.pdf", "text": "x"},
        {"title": "2025-26 QAP", "url": "https://chfa.localhost/c/2025-2026-QAP.pdf", "text": "x"},
        {"title": "2023-24 QAP", "url": "https://chfa.localhost/d/2023-24-QAP.pdf", "text": "x"},
        {"title": "2016 QAP", "url": "https://chfa.localhost/e/CHFA_QAP_2016.pdf", "text": "x"},
        {"title": "Webinar Slides (PDF)", "url": "https://chfa.localhost/f/slides.pdf", "text": "x"},
    ]
    watch.prune_text(docs)
    kept = [d["title"] for d in docs if "text" in d]
    assert kept == ["2027-28 QAP - Third Draft (PDF)", "August 2026 Public Hearing Presentation (PDF of PPT)", "2025-26 QAP"], kept
    assert all(d["text_retained"] is False for d in docs if "text" not in d)


def test_retained_text_stays_within_budget_oldest_cycle_first(monkeypatch):
    monkeypatch.setattr(watch, "TEXT_BUDGET_BYTES", 250)
    docs = [
        {"title": "2027-28 QAP", "url": "https://chfa.localhost/a.pdf", "text": "n" * 100},
        {"title": "2025-26 QAP", "url": "https://chfa.localhost/b.pdf", "text": "o" * 120},
        {"title": "2025-26 QAP Amended", "url": "https://chfa.localhost/c.pdf", "text": "o" * 90},
    ]
    watch.prune_text(docs)
    assert sum(len(d.get("text", "")) for d in docs) <= 250
    assert "text" in docs[0], "the newest cycle lost its text before the older one"
    assert "text" not in docs[1] and "text" in docs[2], "the largest older-cycle document goes first"


def test_the_text_budget_sits_under_the_data_file_size_guard():
    """The committed file must pass scripts/check-data-file-sizes.mjs; the first live
    run wrote 5.3 MiB and turned main red."""
    guard = (ROOT / "scripts" / "check-data-file-sizes.mjs").read_text()
    limit_mib = int(re.search(r"const defaultLimit = (\d+) \* MIB", guard).group(1))
    assert "chfa-qap-watch" not in guard, "the watch file must fit the default ceiling, not an exception"
    assert watch.TEXT_BUDGET_BYTES <= 0.75 * limit_mib * 1024 * 1024
    committed = watch.OUT_FILE.stat().st_size
    assert committed <= 0.8 * limit_mib * 1024 * 1024, f"the committed watch file is {committed:,} bytes"


def test_real_pdf_text_extraction():
    pytest.importorskip("pypdf")
    text, pages, err = watch.pdf_text(make_pdf(["The maximum federal credit per development is $1,700,000 annually."]))
    assert err is None and pages == 1
    assert "$1,700,000" in text


def test_real_encrypted_pdf_text_extraction():
    """CHFA's full QAP drafts are AES-256 encrypted with an owner password only.
    The first live run read none of them; this is that case, with a real PDF."""
    pypdf = pytest.importorskip("pypdf")
    pytest.importorskip("cryptography")
    reader = pypdf.PdfReader(io.BytesIO(make_pdf(["Maximum Credit Award: no more than $1,700,000 in 2027."])))
    writer = pypdf.PdfWriter(clone_from=reader)
    writer.encrypt(user_password="", owner_password="chfa-owner", algorithm="AES-256")
    buf = io.BytesIO()
    writer.write(buf)
    assert pypdf.PdfReader(io.BytesIO(buf.getvalue())).is_encrypted, "the fixture is not encrypted"
    text, pages, err = watch.pdf_text(buf.getvalue())
    assert err is None, err
    assert "$1,700,000" in text


def test_workflow_and_ci_install_the_same_pdf_stack():
    """The watcher needs cryptography to open encrypted drafts, and CI needs the
    same pin or the encrypted-PDF test above silently skips."""
    pins = lambda text: dict(re.findall(r"\b(pypdf|cryptography)==([\d.]+)", text))
    wf = pins(WORKFLOW.read_text())
    ci = pins((ROOT / ".github" / "workflows" / "ci-checks.yml").read_text())
    assert set(wf) == {"pypdf", "cryptography"}, f"the watcher installs {wf}"
    assert wf == ci, f"watcher pins {wf} but ci-checks pins {ci}"


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
    crons = re.findall(r"cron:\s*'([^']+)'", wf)
    assert len(crons) == 1
    minute = crons[0].split()[0]
    assert minute not in ("0", "00"), "keep crons off :00 (AGENTS.md)"
    others = [p for p in (ROOT / ".github" / "workflows").glob("*.yml") if p.name != WORKFLOW.name]
    used = {m.split()[0] for p in others for m in re.findall(r"cron:\s*'([^']+)'", p.read_text())}
    assert minute not in used, f"minute {minute} is already used by another workflow"


def test_main_refuses_to_write_a_result_over_the_ceiling(tmp_path, monkeypatch):
    """TEXT_BUDGET_BYTES bounds retained text, not the rest of the file, and cron
    commits skip CI: an oversized result must not replace the file."""
    import json
    out = tmp_path / "chfa-qap-watch.json"
    out.write_text('{"previous": true}\n')
    summary = tmp_path / "run.json"
    monkeypatch.setattr(watch, "PAGES", PAGES)
    monkeypatch.setattr(watch, "http_fetch", fetcher(site("$1,700,000")))
    monkeypatch.setattr(watch, "MAX_OUT_BYTES", 1000)
    assert watch.main(["--out", str(out), "--summary", str(summary)]) == 1
    assert out.read_text() == '{"previous": true}\n', "an oversized result replaced the previous file"
    refused = json.loads(summary.read_text())["write_refused"]
    assert refused and "MAX_OUT_BYTES" in refused, "the tracking issue needs to know why nothing was written"
    # non-vacuity: with room, the same run writes and reports no refusal
    monkeypatch.setattr(watch, "MAX_OUT_BYTES", 10 * 1024 * 1024)
    assert watch.main(["--out", str(out), "--summary", str(summary)]) == 0
    assert '"previous"' not in out.read_text()
    assert json.loads(summary.read_text())["write_refused"] is None


def test_the_output_ceiling_sits_under_the_data_file_size_guard():
    guard = (ROOT / "scripts" / "check-data-file-sizes.mjs").read_text()
    limit = int(re.search(r"const defaultLimit = (\d+) \* MIB", guard).group(1)) * 1024 * 1024
    rel = watch.OUT_FILE.relative_to(ROOT).as_posix()
    assert rel not in guard, "the watch file must not need an exception to the size guard"
    assert watch.TEXT_BUDGET_BYTES < watch.MAX_OUT_BYTES < limit


def test_workflow_reports_a_refused_write_and_guards_its_own_commit():
    wf = WORKFLOW.read_text()
    issue_step = wf[wf.index("name: Open / update tracking issue"):wf.index("name: Commit refreshed watch result")]
    # the watcher exits 1 on a refusal; the issue step must still run to say so
    assert re.search(r"if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}", issue_step)
    assert "run.write_refused" in issue_step
    assert "hashFiles" not in issue_step, "hashFiles cannot see runner.temp; the summary is checked in the script"
    commit_step = wf[wf.index("Commit refreshed watch result"):]
    # the same guard ci-checks runs, before anything is added, since cron commits skip CI
    assert commit_step.index("node scripts/check-data-file-sizes.mjs") < commit_step.index("git add")
    ci = (ROOT / ".github" / "workflows" / "ci-checks.yml").read_text()
    assert "node scripts/check-data-file-sizes.mjs" in ci, "the commit step must run the guard ci-checks runs"


def test_note_warns_that_redline_text_runs_together():
    r = watch.run(fetch=fetcher(site("$1,700,000")), previous={}, now="2026-09-30T05:21:00Z", pages=PAGES)
    assert "redline" in r["note"] and "from the PDF" in r["note"]
