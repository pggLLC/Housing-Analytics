"""Guard: the funding watch reports new rounds on agency pages, never treats a
blocked page as "no change", and covers every program in both funding catalogs.

Why it exists: the daily audit (scripts/lib/funding-program-audit.js) reads only
the site's own catalogs, so it can say a round's dates have passed but never
that a new one opened. On 2026-10-15 the project asked for DOLA's Energy/Mineral
Impact Assistance Fund (EIAF) rounds, and then every funding agency and source,
to be watched for new information.

The fake sites live on *.localhost so the source-URL sweep, which probes every
URL a PR adds, never fetches a fixture address.

Run: python3 -m pytest tests/test_funding_watch.py -q
"""

import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "scripts" / "audit" / "funding_watch.py"
WORKFLOW = ROOT / ".github" / "workflows" / "chfa-qap-watch.yml"

sys.path.insert(0, str(SRC.parent))
spec = importlib.util.spec_from_file_location("funding_watch", SRC)
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)

EIAF = "https://dlg.localhost/eiaf"
GRANT = "https://doh.localhost/program"
GG = "https://grants.localhost/search2"
FR = "https://fr.localhost/documents.json"

GUIDE = {"programs": [{"id": "doh-grant", "name": "DOH Grant", "official_url": GRANT, "status": "rounds",
                       "administrator": "DOH", "last_checked": "2026-10-10"}]}
SOFT = {"programs": {"HOME": {"name": "Agency home", "contactUrl": "https://doh.localhost/", "status": "verify"}}}
SOURCES = {
    "agency_pages": [{"id": "dlg-eiaf", "agency": "DOLA DLG", "url": EIAF}],
    "federal": {
        "grants_gov": {"endpoint": GG, "keywords": ["affordable housing", "water"], "rows": 5},
        "federal_register": {"endpoint": FR, "agencies": ["hud"], "term": "x",
                             "title_pattern": "notice of funding"},
    },
}

QUIET = ("<title>EIAF</title>\n<p>Future cycles will be announced.</p>"
         "<p><a href='/a/2025-awards.pdf'>2025 awards</a></p>")
OPEN = ("<title>EIAF</title>\n<p>Cycle 27-01 applications are due December 1, 2026.</p>"
        "<p><a href='/a/2025-awards.pdf'>2025 awards</a></p><p><a href='/a/27-01-guidelines.pdf'>Cycle 27-01 guidelines</a></p>")
GRANT_PAGE = "<title>Grant</title>\n<p>Round 2 opens March 2027.</p>"


class HTTPError(Exception):
    pass


def site(eiaf=QUIET, grant=GRANT_PAGE, gg_hits=None, fr_results=None, blocked=()):
    gg_hits = gg_hits if gg_hits is not None else [{"id": "1", "number": "HUD-1", "title": "Housing grant",
                                                    "agency": "HUD", "oppStatus": "posted"}]
    fr_results = fr_results if fr_results is not None else [
        {"document_number": "2026-1", "title": "Notice of Funding Opportunity: rural water", "agencies": [{"name": "USDA"}],
         "publication_date": "2026-10-01", "html_url": "https://fr.localhost/d/2026-1"},
        {"document_number": "2026-2", "title": "Information collection", "agencies": [], "html_url": "x"},
    ]

    def fetch(url, data=None, headers=None):
        if any(url.startswith(b) for b in blocked):
            raise HTTPError("HTTP Error 403: Forbidden")
        if url == EIAF:
            return 200, {}, eiaf.encode()
        if url == GRANT:
            return 200, {}, grant.encode()
        if url == GG:
            assert data is not None, "Grants.gov search2 answers GET with 403; it must be a POST"
            req = json.loads(data)
            start, rows = req.get("startRecordNum", 0), req["rows"]
            return 200, {}, json.dumps({"data": {"hitCount": len(gg_hits), "startRecord": start,
                                                 "oppHits": gg_hits[start:start + rows]}}).encode()
        if url.startswith(FR):
            return 200, {}, json.dumps({"results": fr_results}).encode()
        raise HTTPError(f"unexpected url {url}")
    return fetch


def run(fetch, previous=None, now="2026-10-15T05:34:00Z"):
    return watch.run(fetch=fetch, previous=previous, now=now, guide=GUIDE, soft=SOFT, sources=SOURCES)


def test_first_run_is_a_silent_baseline():
    r = run(site())
    assert r["changes"]["baseline"] is True
    assert r["changes"]["changed_pages"] == [] and r["changes"]["new_federal_notices"] == []
    assert sorted(r["changes"]["baseline_pages"]) == ["dlg-eiaf", "guide:doh-grant"]
    assert r["has_changes"] is False


def test_a_new_round_on_an_agency_page_is_reported_with_its_lines_and_documents():
    base = run(site())
    r = run(site(eiaf=OPEN), previous=base, now="2026-10-16T05:34:00Z")
    [ch] = r["changes"]["changed_pages"]
    assert ch["id"] == "dlg-eiaf"
    assert "Cycle 27-01 applications are due December 1, 2026." in ch["key_lines"]["added"]
    assert "Future cycles will be announced." in ch["key_lines"]["removed"]
    assert [d["title"] for d in ch["new_documents"]] == ["Cycle 27-01 guidelines"]
    assert r["has_changes"] is True
    # non-vacuity: the same page unchanged reports nothing
    again = run(site(eiaf=OPEN), previous=r, now="2026-10-17T05:34:00Z")
    assert again["changes"]["changed_pages"] == []


def test_a_change_names_the_programs_and_where_the_site_shows_them():
    base = run(site())
    r = run(site(grant="<title>Grant</title>\n<p>Round 2 closed.</p>"), previous=base, now="2026-10-16T05:34:00Z")
    [ch] = r["changes"]["changed_pages"]
    assert ch["programs"][0]["id"] == "doh-grant" and ch["programs"][0]["status"] == "rounds"
    assert any("Funding Sources" in s for s in ch["shown_on"])


def test_the_watch_never_writes_a_program_status():
    src = SRC.read_text()
    assert "co-developer-funding-guide.json" in src
    assert not re.search(r"(GUIDE_FILE|SOFT_FILE)\.write_text", src), "the watcher must only read the catalogs"


def test_a_blocked_page_keeps_its_record_and_is_never_no_change():
    base = run(site())
    day1 = run(site(blocked=(EIAF,)), previous=base, now="2026-10-16T05:34:00Z")
    eiaf = next(p for p in day1["pages"] if p["id"] == "dlg-eiaf")
    assert eiaf["ok"] is False and eiaf["key_lines"] == next(p for p in base["pages"] if p["id"] == "dlg-eiaf")["key_lines"]
    assert eiaf["unverifiable"] is False and day1["changes"]["changed_pages"] == []
    assert day1["fetch_failures"][0]["id"] == "dlg-eiaf"
    day2 = run(site(blocked=(EIAF,)), previous=day1, now="2026-10-17T05:34:00Z")
    assert day2["changes"]["newly_unverifiable"] == []
    day3 = run(site(blocked=(EIAF,)), previous=day2, now="2026-10-18T05:34:00Z")
    assert [u["id"] for u in day3["changes"]["newly_unverifiable"]] == ["dlg-eiaf"]
    assert day3["unverifiable"][0]["failing_since"] == "2026-10-16T05:34:00Z"
    day4 = run(site(blocked=(EIAF,)), previous=day3, now="2026-10-19T05:34:00Z")
    assert day4["changes"]["newly_unverifiable"] == [], "reported once, not every day"
    assert day4["unverifiable"], "still listed as unverifiable"
    back = run(site(eiaf=OPEN), previous=day4, now="2026-10-20T05:34:00Z")
    p = next(p for p in back["pages"] if p["id"] == "dlg-eiaf")
    assert p["ok"] and not p["unverifiable"] and "first_failed_at" not in p
    assert back["changes"]["changed_pages"][0]["id"] == "dlg-eiaf", "the change made while blocked still surfaces"


def test_a_bot_challenge_page_counts_as_a_failure():
    base = run(site())
    r = run(site(eiaf="<title>Just a moment...</title>"), previous=base, now="2026-10-16T05:34:00Z")
    assert r["changes"]["changed_pages"] == [], "a challenge page must not read as every line removed"
    assert next(p for p in r["pages"] if p["id"] == "dlg-eiaf")["ok"] is False


def test_documents_are_removed_only_from_a_page_that_loaded():
    base = run(site(eiaf=OPEN))
    blocked = run(site(blocked=(EIAF,)), previous=base, now="2026-10-16T05:34:00Z")
    assert blocked["changes"]["changed_pages"] == []
    gone = run(site(eiaf=QUIET), previous=blocked, now="2026-10-17T05:34:00Z")
    [ch] = gone["changes"]["changed_pages"]
    assert [d["title"] for d in ch["removed_documents"]] == ["Cycle 27-01 guidelines"]


def test_federal_notices_new_once_and_filtered_to_funding_titles():
    base = run(site())
    assert {n["key"] for n in base["federal_notices"]} == {"grants.gov:1", "federalregister:2026-1"}, \
        "the information-collection notice is not a funding notice"
    gg = [{"id": "1", "title": "Housing grant"}, {"id": "2", "title": "Water and waste grant", "agency": "USDA"}]
    r = run(site(gg_hits=gg), previous=base, now="2026-10-16T05:34:00Z")
    assert [n["key"] for n in r["changes"]["new_federal_notices"]] == ["grants.gov:2"]
    # the same notice from two keywords is one notice
    assert sum(n["key"] == "grants.gov:2" for n in r["federal_notices"]) == 1
    # it drops out of the results, then returns: not new again
    gone = run(site(gg_hits=gg[:1]), previous=r, now="2026-10-17T05:34:00Z")
    back = run(site(gg_hits=gg), previous=gone, now="2026-10-18T05:34:00Z")
    assert back["changes"]["new_federal_notices"] == []


def test_a_failed_federal_source_reports_nothing_new_and_keeps_its_notices():
    base = run(site())

    def fails(url, data=None, headers=None):
        if url == GG:
            raise HTTPError("HTTP Error 503")
        return site()(url, data, headers)
    r = run(fails, previous=base, now="2026-10-16T05:34:00Z")
    assert r["federal_failures"] and r["changes"]["new_federal_notices"] == []
    # Notice keys are ids, not URLs; compared as a set (CodeQL read a substring check as URL sanitizing).
    assert {n["key"] for n in r["federal_notices"]} == {"grants.gov:1", "federalregister:2026-1"}
    after = run(site(), previous=r, now="2026-10-17T05:34:00Z")
    assert after["changes"]["new_federal_notices"] == [], "recovering must not re-announce known notices"


def test_a_quiet_day_or_a_page_that_stays_blocked_does_not_rewrite_the_file():
    base = run(site(blocked=(EIAF,)))
    later = run(site(blocked=(EIAF,)), previous=base, now="2026-10-16T05:34:00Z")
    assert watch._content(base) == watch._content(later)
    changed = run(site(grant="<title>Grant</title>\n<p>Round 3 opens May 2027.</p>", blocked=(EIAF,)),
                  previous=later, now="2026-10-17T05:34:00Z")
    assert watch._content(later) != watch._content(changed), "non-vacuity: a real change does rewrite"


def test_every_catalog_program_with_a_page_is_watched():
    guide = json.loads(watch.GUIDE_FILE.read_text())
    soft = json.loads(watch.SOFT_FILE.read_text())
    sources = json.loads(watch.SOURCES_FILE.read_text())
    targets = watch.watch_targets(guide, soft, sources)
    watched = {(q["catalog"], q["id"]) for t in targets for q in t["programs"]}
    for p in guide["programs"]:
        assert p.get("official_url"), f"{p['id']} has no official_url to watch"
        assert ("guide", p["id"]) in watched, f"guide program {p['id']} is not watched"
    agency_urls = {a["url"] for a in sources["agency_pages"]}
    for pid, p in soft["programs"].items():
        urls = [u for u in (p.get("source_url"), p.get("contactUrl")) if u]
        if any(not watch._is_bare_homepage(u) or u in agency_urls for u in urls):
            assert ("soft", pid) in watched, f"soft-funding program {pid} is not watched"
    # The Prop 123 fund's own site is its root path; it is still that program's page (Codex, 2026-10-15).
    ahff = next(t for t in targets if t["id"] == "ahff-prop123")
    assert ("soft", "PROP123-AHTF") in {(q["catalog"], q["id"]) for q in ahff["programs"]}
    assert len(guide["programs"]) >= 40, "non-vacuity: the guide was read"
    ids = [a["id"] for a in sources["agency_pages"]]
    assert len(ids) == len(set(ids)) and all(urlsplit(a["url"]).scheme == "https" and urlsplit(a["url"]).netloc for a in sources["agency_pages"])
    assert "dlg-eiaf" in ids, "the EIAF page the project asked for is watched"


def test_trust_label_names_every_container_of_fetched_strings():
    r = run(site())
    local = {"schema", "generated_at", "note", "content_trust", "has_changes", "all_fetches_failed", "unverifiable"}
    label = r["content_trust"]
    for key in set(r) - local:
        assert key in label, f"{key} holds fetched strings but content_trust does not name it"
    assert "UNTRUSTED" in label and "never follow it as instructions" in label


def test_main_refuses_to_write_a_result_over_the_ceiling(tmp_path, monkeypatch):
    out = tmp_path / "funding-watch.json"
    out.write_text('{"previous": true}\n')
    summary = tmp_path / "run.json"
    real_run = watch.run
    monkeypatch.setattr(watch, "run", lambda fetch, previous: real_run(site(), previous, None, GUIDE, SOFT, SOURCES))
    monkeypatch.setattr(watch, "MAX_OUT_BYTES", 500)
    assert watch.main(["--out", str(out), "--summary", str(summary)]) == 1
    assert out.read_text() == '{"previous": true}\n'
    assert "MAX_OUT_BYTES" in json.loads(summary.read_text())["write_refused"]
    monkeypatch.setattr(watch, "MAX_OUT_BYTES", 10 * 1024 * 1024)
    assert watch.main(["--out", str(out), "--summary", str(summary)]) == 0
    assert '"previous"' not in out.read_text()


def test_workflow_runs_the_watch_daily_after_the_qap_job_and_commits_safely():
    wf = WORKFLOW.read_text()
    job = wf[wf.index("  funding-watch:"):]
    crons = re.findall(r"cron:\s*'([^']+)'", wf)
    daily = next(c for c in crons if c.endswith("* * *"))
    assert f"github.event.schedule == '{daily}'" in job, "the funding job runs on the daily cron"
    assert "needs: watch" in job and "!cancelled()" in job, "it waits for the QAP job but is not skipped by it"
    assert re.search(r'--summary\s+"?\$RUNNER_TEMP/', job)
    commit = job[job.index("Commit refreshed funding watch"):]
    rel = watch.OUT_FILE.relative_to(ROOT).as_posix()
    assert commit.index(rel) < commit.index("npm run audit:file-manifest") \
        < commit.index("python3 scripts/rebuild_manifest.py") < commit.index("node scripts/validate-schemas.js")
    assert commit.index("node scripts/check-data-file-sizes.mjs") < commit.index("git add")
    assert f"git add {rel} data/_manifest.json data/manifest.json" in commit
    assert "./.github/actions/dispatch-pages-deploy" in commit
    issues = job[job.index("Open / update funding watch issues"):job.index("Commit refreshed funding watch")]
    assert "newly_unverifiable" in issues and "new_federal_notices" in issues and "changed_pages" in issues
    assert "labels: [LABEL]" in issues and "funding-watch" in issues



def test_issue_step_never_reports_nothing_new_when_a_search_failed(tmp_path):
    """Run the workflow's issue script with a failed federal search and nothing else:
    it must warn and say the run was incomplete, not that there were no new notices."""
    import shutil
    import subprocess
    import textwrap
    node = shutil.which("node")
    assert node, "node is needed to run the workflow's issue script"
    wf = WORKFLOW.read_text()
    step = wf[wf.index("- name: Open / update funding watch issues"):]
    step = step[:step.index("\n      - name:")]
    script = textwrap.dedent(step[step.index("script: |\n") + len("script: |\n"):])
    assert "core.info" in script, "the issue script was found"
    (tmp_path / "issue.js").write_text(
        "module.exports = async ({core, github, context, require}) => {\n" + script + "\n};")
    summary = {"changes": {"changed_pages": [], "new_federal_notices": [], "newly_unverifiable": []},
               "federal_failures": [{"source": "grants.gov", "query": "affordable housing", "error": "HTTP 500"}],
               "fetch_failures": []}
    (tmp_path / "run.json").write_text(json.dumps(summary))
    driver = ("const f = require('./issue.js');"
              "const core = {info: m => console.log('INFO ' + m), warning: m => console.log('WARN ' + m)};"
              "f({core, github: {}, context: {repo: {owner: 'o', repo: 'r'}}, require})"
              ".catch(e => { console.error(e); process.exit(1); });")
    out = subprocess.run([node, "-e", driver], cwd=tmp_path, capture_output=True, text=True,
                         env={**os.environ, "RUN_SUMMARY": str(tmp_path / "run.json")}, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "WARN Federal search incomplete: grants.gov" in out.stdout
    assert "Incomplete run" in out.stdout
    assert "no new federal notices" not in out.stdout


def test_the_output_ceiling_sits_under_the_data_file_size_guard():
    guard = (ROOT / "scripts" / "check-data-file-sizes.mjs").read_text()
    limit = int(re.search(r"const defaultLimit = (\d+) \* MIB", guard).group(1)) * 1024 * 1024
    assert watch.MAX_OUT_BYTES < limit


def test_news_finds_infrastructure_funding_stories():
    """The news side of the same ask: the daily news run searches for funding rounds
    and infrastructure, and the topic tagger can put a story there."""
    spec2 = importlib.util.spec_from_file_location("fetch_google_alerts", ROOT / "scripts" / "fetch_google_alerts.py")
    alerts = importlib.util.module_from_spec(spec2)
    spec2.loader.exec_module(alerts)
    assert alerts.detect_topic("Town wins water and sewer grant for affordable housing site") == "infrastructure"
    assert alerts.detect_topic("DOLA announces Energy/Mineral Impact (EIAF) awards") == "infrastructure"
    assert alerts.detect_topic("Council approves affordable housing plan") == "affordable_housing", \
        "non-vacuity: an ordinary housing story keeps its topic"
    feeds = (ROOT / ".github" / "workflows" / "weekly_housing_brief.yml").read_text()
    assert "EIAF" in feeds and "tap+fees" in feeds and "infrastructure+grant" in feeds
    labels = (ROOT / "scripts" / "generate_policy_briefs.py").read_text()
    assert "'infrastructure': 'Infrastructure & Funding'" in labels


def test_a_new_word_or_excel_application_counts_as_a_document_change():
    """Rounds often post their application as .docx or .xlsx, not PDF (Codex review)."""
    base = run(site())
    page = QUIET + "<p><a href='/a/27-01-application.docx'>Application</a></p><p><a href='/a/budget.xlsx'>Budget form</a></p>"
    r = run(site(eiaf=page), previous=base, now="2026-10-16T05:34:00Z")
    [ch] = r["changes"]["changed_pages"]
    assert [d["title"] for d in ch["new_documents"]] == ["Application", "Budget form"]
    assert ch["key_lines"]["added"] == [], "the change is the documents alone, no round line"
    assert watch._content(base) != watch._content(r), "so the file is rewritten and the issue opens"


def test_a_federal_feed_that_keeps_failing_is_reported_once_as_unverifiable():
    def fails(url, data=None, headers=None):
        if url == GG:
            raise HTTPError("HTTP Error 403: Forbidden")
        return site()(url, data, headers)
    base = run(site())
    days = [base]
    for d in ("16", "17", "18", "19"):
        days.append(run(fails, previous=days[-1], now=f"2026-10-{d}T05:34:00Z"))
    newly = [[u["id"] for u in r["changes"]["newly_unverifiable"]] for r in days[1:]]
    assert newly == [[], [], ["federal:grants.gov"], []], newly
    assert days[-1]["federal_sources"]["grants.gov"]["first_failed_at"] == "2026-10-16T05:34:00Z"
    assert days[-1]["federal_sources"]["federalregister.gov"]["ok"] is True
    back = run(site(), previous=days[-1], now="2026-10-20T05:34:00Z")
    assert back["federal_sources"]["grants.gov"] == {"ok": True, "endpoint": GG, "unverifiable": False}
    assert watch._content(days[2]) == watch._content(days[1]), "a feed that stays down adds no daily commit"


def test_grants_gov_is_paged_past_the_first_page_up_to_the_cap():
    """A keyword with more hits than one page of results: later pages are read too (Codex,
    2026-10-15), up to max_records, and a page failing part-way marks the keyword failed."""
    hits = [{"id": str(i), "title": f"Grant {i}", "agencyName": "HUD"} for i in range(60)]
    cfg = {"endpoint": GG, "keywords": ["housing"], "rows": 25, "max_records": 100}
    notices, failures = watch.grants_gov(cfg, site(gg_hits=hits))
    assert not failures and len(notices) == 60, "all three pages were read"
    assert notices[-1]["agency"] == "HUD", "agencyName is read when agency is absent"
    capped, _ = watch.grants_gov({**cfg, "max_records": 50}, site(gg_hits=hits))
    assert len(capped) == 50
    calls = []

    def fails_on_page_2(url, data=None, headers=None):
        if url == GG and json.loads(data).get("startRecordNum", 0) >= 25:
            raise HTTPError("HTTP Error 503")
        calls.append(url)
        return site(gg_hits=hits)(url, data, headers)
    part, failed = watch.grants_gov(cfg, fails_on_page_2)
    assert part == [] and failed and failed[0]["query"] == "housing"


def test_a_grants_gov_error_envelope_is_a_failure_not_zero_results():
    """search2 answers some errors with HTTP 200 and an error envelope (Codex, 2026-10-15)."""
    def envelope(url, data=None, headers=None):
        if url == GG:
            return 200, {}, json.dumps({"errorcode": 4, "msg": "Invalid request"}).encode()
        return site()(url, data, headers)
    notices, failures = watch.grants_gov(SOURCES["federal"]["grants_gov"], envelope)
    assert notices == [] and len(failures) == 2 and "errorcode=4" in failures[0]["error"]
    r = run(envelope)
    assert r["federal_sources"]["grants.gov"]["ok"] is False

    def error_with_empty_data(url, data=None, headers=None):
        if url == GG:
            return 200, {}, json.dumps({"errorcode": 4, "errorMsgs": ["bad keyword"],
                                        "data": {"hitCount": 0, "oppHits": []}}).encode()
        return site()(url, data, headers)
    _n, failed = watch.grants_gov(SOURCES["federal"]["grants_gov"], error_with_empty_data)
    assert len(failed) == 2, "an error code beside an empty data block is still an error"


def test_federal_results_are_kept_when_every_page_fails():
    """All pages blocked but a federal search answered: the run is not 'nothing fetched',
    so its notices are written and not re-announced tomorrow (Codex, 2026-10-15)."""
    base = run(site())
    gg = [{"id": "1", "title": "Housing grant"}, {"id": "9", "title": "New grant"}]
    pages_down = site(gg_hits=gg, blocked=(EIAF, GRANT))
    r = run(pages_down, previous=base, now="2026-10-16T05:34:00Z")
    assert not any(p["ok"] for p in r["pages"]), "every page failed"
    assert r["all_fetches_failed"] is False
    assert [n["key"] for n in r["changes"]["new_federal_notices"]] == ["grants.gov:9"]
    nothing = run(site(blocked=(EIAF, GRANT, GG, FR)), previous=base, now="2026-10-16T05:34:00Z")
    assert nothing["all_fetches_failed"] is True
