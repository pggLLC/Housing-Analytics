#!/usr/bin/env python3
"""
scripts/audit/chfa_qap_watch.py

Watches CHFA's Housing Tax Credit QAP pages for new or changed documents and
keeps the text of the QAP documents in the repo.

Why this exists
---------------
The QAP decides how Colorado's 9% and 4% credits are awarded, and CHFA changes
it every cycle. Two things went wrong without a watcher:

  - A per-project change in the final 2027-2028 QAP (the federal 9% maximum,
    reported as $1.85M -> $1.7M a year) reached this project by word of mouth,
    not from any data the site holds.
  - data/chfa-qap-calendar.json linked two CHFA pages that returned 404 from
    at least 2026-06-13 (data/reports/repo-link-audit.json), and nothing
    noticed for three months.

It also solves an access problem. Claude Code sessions run behind an egress
policy that may not allow chfainfo.com, so a session could not read the QAP
it was asked about. GitHub Actions can. Storing the extracted text here means
any session can read the current QAP from its own checkout.

What it records (data/audit/chfa-qap-watch.json)
------------------------------------------------
  - Each watched page: whether it was fetched, a hash of its text, and the
    lines on it that carry dates or dollar amounts.
  - Each document linked from those pages (PDFs and /getattachment/ files):
    URL, link text, SHA-256, size, first-seen and last-changed times.
  - For QAP documents (plan, summary of changes, redline, amendments): the
    "key lines" -- lines with a dollar amount or a limit word (maximum, cap,
    limit, per project, set-aside, basis boost) -- and, for the newest
    KEEP_TEXT_CYCLES QAP cycles only, the full extracted text.
  - What changed since the previous run: new, changed and removed documents,
    with the key lines added and removed, and pages whose key lines changed.

Rules that keep it honest
-------------------------
  - A document is only reported removed when every page it was listed on was
    fetched successfully this run and none of them still links it. A failed
    fetch keeps the previous entry; it never reads as a removal.
  - A fetch failure is recorded in fetch_failures, and the workflow reports it.
    If nothing could be fetched, the file is not rewritten.
  - The file is only rewritten when something other than timestamps changed,
    so a quiet week does not add a commit.
  - The file stays under the repo's 5 MiB data-file ceiling
    (scripts/check-data-file-sizes.mjs). CHFA lists every QAP back to 2016, and
    storing all of their text made the first run 5.3 MiB and broke ci-checks on
    every PR. So full text is kept for the current and previous QAP cycles only
    (the draft under review and the plan in force), within MAX_TEXT_BYTES_TOTAL;
    an older document keeps its hash and key lines and says why its text was
    left out (text_omitted). If the result would still exceed MAX_OUT_BYTES,
    nothing is written and the run exits 1, so the workflow fails visibly
    instead of committing a file that breaks main.
  - A document whose extraction failed is retried on the next run even when its
    bytes are unchanged; otherwise a fix to the environment (CHFA's recent QAPs
    are AES-encrypted and need the `cryptography` package) would never reach the
    documents that failed before it.

Exit codes
----------
  0  watch completed (with or without changes or fetch failures)
  1  internal error, or the result would exceed MAX_OUT_BYTES (nothing written)

Usage
-----
  python3 scripts/audit/chfa_qap_watch.py            # check and write
  python3 scripts/audit/chfa_qap_watch.py --dry-run  # check, print, do not write
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[2]
OUT_FILE = ROOT / 'data' / 'audit' / 'chfa-qap-watch.json'
SCHEMA = 'chfa-qap-watch/1'

# Pages CHFA uses for the QAP cycle. Keep ids stable: documents record which
# page listed them.
PAGES = [
    ('qap', 'https://www.chfainfo.com/rental-housing/housing-credit/qualified-allocation-plan'),
    ('dates', 'https://www.chfainfo.com/rental-housing/housing-credit/dates-and-deadlines-7a0d2c0727864a506470f2f4352cf192'),
    ('hearing', 'https://www.chfainfo.com/rental-housing/housing-credit/qap-hearing'),
]

USER_AGENT = 'HousingAnalytics/1.0 (+https://cohoanalytics.com) chfa_qap_watch.py'
TIMEOUT = 60
MAX_DOC_BYTES = 40_000_000
MAX_DOC_TEXT_CHARS = 1_500_000
MAX_PAGE_TEXT_CHARS = 200_000
MAX_KEY_LINES = 600
MAX_DIFF_LINES = 80
# Size bounds. check-data-file-sizes.mjs fails ci-checks on any tracked data
# file over 5 MiB; MAX_OUT_BYTES leaves headroom below it.
KEEP_TEXT_CYCLES = 2
MAX_TEXT_BYTES_TOTAL = 3 * 1024 * 1024
MAX_OUT_BYTES = int(4.5 * 1024 * 1024)

# A QAP cycle is named by its first year: "2027-28", "2027-2028", "2025_26".
CYCLE_RANGE_RE = re.compile(r'(?<!\d)(20\d\d)\s*[-\u2013_]\s*(?:20)?(\d\d)(?!\d)')
YEAR_RE = re.compile(r'(?<!\d)(20\d\d)(?!\d)')
DOC_LINK_RE = re.compile(r'\.pdf(?:$|[?#])|/getattachment/', re.I)
# Documents whose text is kept. Everything else is hashed only.
QAP_DOC_RE = re.compile(r'qap|qualified[\s_-]*allocation|allocation[\s_-]*plan|summary[\s_-]*of[\s_-]*changes|redline|amend', re.I)
KEY_LINE_RE = re.compile(
    r'\$\s?\d|\b(maximum|max\.|cap(ped|s)?|limit(s|ed)?|per[\s-](project|development|unit|building)|'
    r'set[\s-]?aside|basis boost|ceiling|threshold)\b',
    re.I,
)
DATE_LINE_RE = re.compile(
    r'\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|'
    r'oct(ober)?|nov(ember)?|dec(ember)?)\.?\s+\d{1,2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b|\$\s?\d',
    re.I,
)

Fetcher = Callable[[str], tuple]  # url -> (http_status, headers: dict, body: bytes)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_fetch(url: str) -> tuple:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        body = resp.read(MAX_DOC_BYTES + 1)
        if len(body) > MAX_DOC_BYTES:
            raise ValueError(f'larger than {MAX_DOC_BYTES} bytes')
        return resp.status, {k.lower(): v for k, v in resp.headers.items()}, body


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()


def page_text(markup: str) -> str:
    """Visible text of an HTML page, one block per line."""
    markup = re.sub(r'(?is)<(script|style|noscript|svg)\b.*?</\1>', ' ', markup)
    markup = re.sub(r'(?i)<br\s*/?>|</(p|div|li|tr|h[1-6]|td|th|section|article)>', '\n', markup)
    text = html_lib.unescape(re.sub(r'<[^>]+>', ' ', markup))
    lines = [re.sub(r'[ \t\r\f\v\xa0]+', ' ', ln).strip() for ln in text.split('\n')]
    return '\n'.join(ln for ln in lines if ln)


def document_links(markup: str, base_url: str) -> list[dict]:
    """Links on a page that point at documents, in page order, deduplicated."""
    out, seen = [], set()
    for m in re.finditer(r'(?is)<a\b[^>]*?href\s*=\s*(["\'])(.*?)\1[^>]*>(.*?)</a>', markup):
        href = html_lib.unescape(m.group(2).strip())
        if not href or href.startswith(('mailto:', 'tel:', 'javascript:', '#')):
            continue
        url = urllib.parse.urljoin(base_url, href)
        if not DOC_LINK_RE.search(url):
            continue
        url = url.split('#', 1)[0]
        if url in seen:
            continue
        seen.add(url)
        title = re.sub(r'\s+', ' ', html_lib.unescape(re.sub(r'<[^>]+>', ' ', m.group(3)))).strip()
        out.append({'url': url, 'title': title or Path(urllib.parse.urlparse(url).path).name})
    return out


def pdf_text(data: bytes) -> tuple:
    """(text, page_count, error). Text is None when it cannot be extracted."""
    try:
        from pypdf import PdfReader  # imported lazily: only needed for documents
    except ImportError:
        return None, None, 'pypdf is not installed'
    except Exception as exc:
        # A broken environment (e.g. a cryptography backend that panics on import,
        # which raises a BaseException) is deliberately not caught: the run fails
        # loudly rather than recording every QAP document as unreadable.
        return None, None, f'pypdf could not be loaded: {exc.__class__.__name__}: {exc}'
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = [(page.extract_text() or '') for page in reader.pages]
        return '\n'.join(parts), len(reader.pages), None
    except Exception as exc:  # malformed or encrypted PDF
        return None, None, f'text extraction failed: {exc.__class__.__name__}: {exc}'


def key_lines(text: str, pattern: re.Pattern = KEY_LINE_RE) -> list[str]:
    out, seen = [], set()
    for ln in text.split('\n'):
        ln = re.sub(r'\s+', ' ', ln).strip()
        if len(ln) < 4 or not pattern.search(ln):
            continue
        ln = ln[:300]
        if ln in seen:
            continue
        seen.add(ln)
        out.append(ln)
        if len(out) >= MAX_KEY_LINES:
            break
    return out


def line_diff(old: list, new: list) -> dict:
    old_set, new_set = set(old or []), set(new or [])
    return {
        'added': [ln for ln in (new or []) if ln not in old_set][:MAX_DIFF_LINES],
        'removed': [ln for ln in (old or []) if ln not in new_set][:MAX_DIFF_LINES],
    }


def is_qap_document(doc: dict) -> bool:
    return bool(QAP_DOC_RE.search(doc.get('title', '')) or QAP_DOC_RE.search(doc['url']))


def qap_cycle(doc: dict) -> int | None:
    """First year of the QAP cycle a document belongs to, or None.

    A range ("2027-28") in the title or URL wins over a bare year, because a
    hearing deck titled "July 2026 Public Hearing" belongs to the 2027-28 plan
    and says so only in its file name."""
    s = f"{doc.get('title', '')} {urllib.parse.unquote(doc.get('url', ''))}"
    m = CYCLE_RANGE_RE.search(s)
    if m:
        return int(m.group(1))
    years = [int(y) for y in YEAR_RE.findall(s)]
    return max(years) if years else None


def text_serialized_bytes(text: str) -> int:
    return len(json.dumps(text, ensure_ascii=False).encode('utf-8'))


def apply_text_retention(documents: list) -> None:
    """Keep full text only for the newest KEEP_TEXT_CYCLES cycles, newest first,
    within MAX_TEXT_BYTES_TOTAL. Everything else keeps its hash and key lines and
    records why its text is absent. Mutates documents in place."""
    cycles = sorted({c for c in (qap_cycle(d) for d in documents) if c is not None}, reverse=True)
    kept_cycles = set(cycles[:KEEP_TEXT_CYCLES])
    order = sorted(range(len(documents)), key=lambda i: -(qap_cycle(documents[i]) or 0))
    used = 0
    for i in order:
        doc = documents[i]
        doc.pop('text_omitted', None)
        if 'text' not in doc:
            continue
        if qap_cycle(doc) not in kept_cycles:
            doc.pop('text')
            doc['text_omitted'] = (f'older QAP cycle: full text is kept only for the {KEEP_TEXT_CYCLES} newest '
                                   f'cycles ({", ".join(str(c) for c in sorted(kept_cycles, reverse=True))}); '
                                   'hash and key lines are kept')
            continue
        size = text_serialized_bytes(doc['text'])
        if used + size > MAX_TEXT_BYTES_TOTAL:
            doc.pop('text')
            doc['text_omitted'] = (f'text budget: {MAX_TEXT_BYTES_TOTAL} bytes of document text already used by '
                                   'newer documents; hash and key lines are kept')
            continue
        used += size


def _content(result: dict) -> dict:
    """The parts of a result that matter for deciding whether to rewrite it."""
    strip = {'generated_at', 'checked_at', 'last_checked_at'}

    def clean(x):
        if isinstance(x, dict):
            return {k: clean(v) for k, v in x.items() if k not in strip}
        if isinstance(x, list):
            return [clean(v) for v in x]
        return x
    # changes / has_changes describe the comparison with the previous run, not the
    # state being recorded, so they never count as a reason to rewrite.
    return clean({k: v for k, v in result.items() if k not in ('changes', 'has_changes')})


def run(fetch: Fetcher = http_fetch, previous: dict | None = None, now: str | None = None,
        pages: list | None = None) -> dict:
    now = now or utc_now()
    pages = pages or PAGES
    previous = previous or {}
    prev_pages = {p['id']: p for p in previous.get('source_pages', [])}
    prev_docs = {d['url']: d for d in previous.get('documents', [])}
    baseline = not prev_docs

    failures, page_out, docs_seen = [], [], {}
    for page_id, url in pages:
        prev = prev_pages.get(page_id, {})
        entry = {'id': page_id, 'url': url, 'checked_at': now}
        try:
            status, headers, body = fetch(url)
            markup = body.decode('utf-8', errors='replace')
        except Exception as exc:
            failures.append({'url': url, 'error': f'{exc.__class__.__name__}: {exc}'})
            entry.update({k: prev.get(k) for k in ('text_sha256', 'key_lines', 'text', 'last_changed_at')})
            entry.update({'ok': False, 'error': failures[-1]['error']})
            page_out.append(entry)
            continue
        text = page_text(markup)
        kl = key_lines(text, DATE_LINE_RE)
        entry.update({
            'ok': True, 'http_status': status, 'text_sha256': sha256(text),
            'key_lines': kl, 'text': text[:MAX_PAGE_TEXT_CHARS],
            'last_changed_at': prev.get('last_changed_at') if prev.get('key_lines') == kl else now,
        })
        page_out.append(entry)
        for link in document_links(markup, url):
            docs_seen.setdefault(link['url'], {'title': link['title'], 'found_on': []})['found_on'].append(page_id)

    ok_pages = {p['id'] for p in page_out if p['ok']}
    documents, new_docs, changed_docs, extraction_failures = [], [], [], []
    for url, seen in docs_seen.items():
        prev = prev_docs.get(url, {})
        # A page that failed this run cannot say whether it still lists the document,
        # so its earlier membership is kept; otherwise a later removal on the pages
        # that did load would be reported while the failed page still lists it.
        found_on = seen['found_on'] + [p for p in prev.get('found_on') or []
                                       if p not in ok_pages and p not in seen['found_on']]
        doc = {'url': url, 'title': seen['title'], 'found_on': found_on,
               'first_seen_at': prev.get('first_seen_at', now), 'last_checked_at': now}
        try:
            status, headers, body = fetch(url)
        except Exception as exc:
            failures.append({'url': url, 'error': f'{exc.__class__.__name__}: {exc}'})
            kept = {k: v for k, v in prev.items() if k not in doc}
            doc.update(kept)
            doc.update({'fetch_ok': False, 'error': failures[-1]['error']})
            documents.append(doc)
            continue
        digest = sha256(body)
        doc.update({'fetch_ok': True, 'sha256': digest, 'bytes': len(body),
                    'content_type': headers.get('content-type'),
                    'last_modified': headers.get('last-modified')})
        unchanged = prev.get('sha256') == digest
        keep_text = is_qap_document(doc)
        # Same bytes, but the last extraction failed: try again (see "Rules").
        retry = unchanged and keep_text and bool(prev.get('text_error'))
        if unchanged and not retry:
            for k in ('pages', 'text', 'text_chars', 'text_truncated', 'key_lines', 'text_error', 'last_changed_at'):
                if k in prev:
                    doc[k] = prev[k]
        else:
            doc['last_changed_at'] = prev.get('last_changed_at', now) if retry else now
            if keep_text:
                text, npages, err = pdf_text(body)
                doc['pages'] = npages
                if text is None or not text.strip():
                    # Unreadable, encrypted or image-only: there is no text to compare,
                    # which is not the same as every line having been deleted.
                    doc['text_error'] = err or 'no extractable text (scanned or image-only PDF)'
                    extraction_failures.append({'url': url, 'title': doc['title'], 'error': doc['text_error']})
                else:
                    doc['text_chars'] = len(text)
                    doc['text_truncated'] = len(text) > MAX_DOC_TEXT_CHARS
                    doc['text'] = text[:MAX_DOC_TEXT_CHARS]
                    doc['key_lines'] = key_lines(text)
        documents.append(doc)
        if not prev:
            new_docs.append({'url': url, 'title': doc['title'], 'key_lines': doc.get('key_lines', [])[:MAX_DIFF_LINES],
                             'extraction_error': doc.get('text_error')})
        elif not unchanged:
            compare = 'key_lines' in doc and 'key_lines' in prev
            changed_docs.append({'url': url, 'title': doc['title'],
                                 'key_lines': line_diff(prev['key_lines'], doc['key_lines']) if compare else None,
                                 'extraction_error': doc.get('text_error')})

    removed = []
    for url, prev in prev_docs.items():
        if url in docs_seen:
            continue
        listed_on = prev.get('found_on') or []
        if listed_on and all(p in ok_pages for p in listed_on):
            removed.append({'url': url, 'title': prev.get('title')})
        else:  # its page could not be checked: keep it, unchanged
            documents.append(prev)

    apply_text_retention(documents)

    changed_pages = [
        {'id': p['id'], 'url': p['url'], 'key_lines': line_diff(prev_pages[p['id']].get('key_lines'), p['key_lines'])}
        for p in page_out
        if p['ok'] and p['id'] in prev_pages and prev_pages[p['id']].get('key_lines') not in (None, p['key_lines'])
    ]

    changes = {
        'baseline': baseline and bool(documents),
        'new_documents': [] if baseline else new_docs,
        'changed_documents': changed_docs,
        'removed_documents': removed,
        'changed_pages': changed_pages,
    }
    return {
        'schema': SCHEMA,
        'generated_at': now,
        'note': ('Written by scripts/audit/chfa_qap_watch.py (weekly, .github/workflows/chfa-qap-watch.yml). '
                 'Document text is extracted from CHFA PDFs by machine; quote CHFA\'s PDF, not this file. '
                 'CHFA\'s drafts are redlines: struck and inserted characters run together in this text '
                 '(e.g. "December 12, 20264" is December 1, 2026 replacing December 2, 2024). '
                 f'Full text is kept for the {KEEP_TEXT_CYCLES} newest QAP cycles only; see text_omitted.'),
        'source_pages': page_out,
        'documents': documents,
        'changes': changes,
        'has_changes': bool(changes['baseline'] or changes['new_documents'] or changed_docs or removed or changed_pages),
        'fetch_failures': failures,
        'extraction_failures': extraction_failures,
        'all_fetches_failed': not ok_pages,
    }


def main(argv: list | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--dry-run', action='store_true', help='check and print, do not write')
    ap.add_argument('--out', default=str(OUT_FILE))
    ap.add_argument('--summary', help='also write a per-run summary here (outside data/, e.g. $RUNNER_TEMP)')
    args = ap.parse_args(argv)
    out = Path(args.out)

    previous = json.loads(out.read_text(encoding='utf-8')) if out.exists() else {}
    result = run(fetch=http_fetch, previous=previous)

    c = result['changes']
    print(f"[chfa-qap-watch] pages ok: {sum(p['ok'] for p in result['source_pages'])}/{len(result['source_pages'])}"
          f" · documents: {len(result['documents'])}"
          f" · baseline: {c['baseline']} · new: {len(c['new_documents'])}"
          f" · changed: {len(c['changed_documents'])} · removed: {len(c['removed_documents'])}"
          f" · pages with changed dates/amounts: {len(c['changed_pages'])}"
          f" · fetch failures: {len(result['fetch_failures'])}"
          f" · extraction failures: {len(result['extraction_failures'])}")
    for f in result['fetch_failures']:
        print(f"  ✗ {f['url']}: {f['error']}")

    if args.dry_run:
        return 0
    if result['all_fetches_failed']:
        print('[chfa-qap-watch] nothing could be fetched; leaving the previous file in place')
        return _write_run_summary(args.summary, result)
    if previous and _content(previous) == _content(result):
        print('[chfa-qap-watch] no change since the last recorded run; file left as is')
        return _write_run_summary(args.summary, result)
    payload = json.dumps(result, indent=1, ensure_ascii=False) + '\n'
    size = len(payload.encode('utf-8'))
    if size > MAX_OUT_BYTES:
        print(f'[chfa-qap-watch] result is {size} bytes, over MAX_OUT_BYTES ({MAX_OUT_BYTES}); '
              'not writing it. Tighten KEEP_TEXT_CYCLES / MAX_TEXT_BYTES_TOTAL.', file=sys.stderr)
        _write_run_summary(args.summary, result)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(payload, encoding='utf-8')
    print(f'[chfa-qap-watch] wrote {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}')
    return _write_run_summary(args.summary, result)


def _write_run_summary(path: str | None, result: dict) -> int:
    """Per-run status for the workflow's issue step. It must live outside data/:
    rebuild_manifest.py walks the filesystem and would list an uncommitted file."""
    if not path:
        return 0
    path = Path(path)
    summary = {k: result[k] for k in ('generated_at', 'changes', 'has_changes', 'fetch_failures',
                                      'extraction_failures', 'all_fetches_failed')}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:  # internal error: fail loudly
        print(f'[chfa-qap-watch] internal error: {exc.__class__.__name__}: {exc}', file=sys.stderr)
        sys.exit(1)
