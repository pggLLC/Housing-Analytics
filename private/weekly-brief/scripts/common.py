"""
common.py — Shared utilities for the Weekly Housing Intelligence Brief system.
Uses only Python stdlib: urllib, json, datetime, hashlib, xml.etree, pathlib, re, html.
"""
import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BRIEF_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BRIEF_ROOT / "data"
ARCHIVE_DATA_DIR = DATA_DIR / "archive"
ARCHIVE_HTML_DIR = BRIEF_ROOT / "archive"

# ---------------------------------------------------------------------------
# Region classification
# ---------------------------------------------------------------------------
WESTERN_SLOPE_KEYWORDS = [
    "western slope", "mesa county", "grand junction", "montrose", "delta",
    "garfield", "eagle county", "pitkin", "aspen", "vail", "glenwood",
    "rifle", "carbondale",
]
COLORADO_KEYWORDS = [
    "colorado", "denver", "boulder", "aurora", "fort collins",
    "colorado springs", "pueblo",
]

def classify_region(text: str) -> str:
    """Return 'Western Slope', 'Colorado', or 'National' based on keyword match."""
    lower = text.lower()
    for kw in WESTERN_SLOPE_KEYWORDS:
        if kw in lower:
            return "Western Slope"
    for kw in COLORADO_KEYWORDS:
        if kw in lower:
            return "Colorado"
    return "National"

# ---------------------------------------------------------------------------
# Signal keyword sets
# ---------------------------------------------------------------------------
SIGNAL_KEYWORDS = {
    "Financing / Rates": [
        "interest rate", "mortgage rate", "fed rate", "federal reserve", "financing",
        "bond", "yield", "treasury", "credit market", "lending", "loan",
        "4% credit", "9% credit", "bond financing", "tax-exempt bond",
    ],
    "LIHTC / Tax Credit": [
        "lihtc", "low-income housing tax credit", "tax credit", "syndication",
        "equity pricing", "investor yield", "housing credit", "qap", "qualified action plan",
        "housing finance agency", "hfa", "chfa",
    ],
    "Supply / Pipeline": [
        "building permit", "housing start", "pipeline", "under construction",
        "groundbreaking", "new units", "unit delivery", "development",
        "multifamily permit", "apartment construction", "housing production",
    ],
    "Costs / Insurance": [
        "construction cost", "material cost", "lumber", "insurance premium",
        "property insurance", "labor cost", "inflation", "tariff",
        "supply chain", "commodity", "building cost",
    ],
    "Rent Pressure / Homelessness": [
        "rent burden", "rent increase", "rent growth", "eviction", "homelessness",
        "unhoused", "voucher", "section 8", "housing instability",
        "cost-burdened", "rent affordability",
    ],
    "Policy / Zoning": [
        "zoning", "upzoning", "housing legislation", "inclusionary",
        "density bonus", "hud rule", "federal housing", "housing policy",
        "land use", "entitlement", "rezoning", "housing bill", "housing act",
    ],
}

def extract_signals(articles: list[dict]) -> dict:
    """Count signal bucket hits and extract top terms from all articles."""
    signals = {k: {"count": 0, "top_terms": []} for k in SIGNAL_KEYWORDS}
    term_hits: dict[str, dict[str, int]] = {k: {} for k in SIGNAL_KEYWORDS}

    for article in articles:
        combined = (
            (article.get("title") or "") + " " +
            (article.get("source") or "")
        ).lower()

        for bucket, keywords in SIGNAL_KEYWORDS.items():
            for kw in keywords:
                if kw in combined:
                    signals[bucket]["count"] += 1
                    term_hits[bucket][kw] = term_hits[bucket].get(kw, 0) + 1
                    break  # count each article once per bucket

    for bucket in signals:
        top = sorted(term_hits[bucket].items(), key=lambda x: -x[1])[:5]
        signals[bucket]["top_terms"] = [t for t, _ in top]

    return signals

# ---------------------------------------------------------------------------
# URL canonicalization & deduplication
# ---------------------------------------------------------------------------
_TRACKING_PARAMS = re.compile(
    r"[?&](utm_[a-z]+|ref|source|fbclid|gclid|msclkid|yclid|mc_[a-z]+|"
    r"campaign|medium|content|term|affiliate)=[^&]*",
    re.IGNORECASE,
)

def canonicalize_url(url: str) -> str:
    """Strip common tracking params from URL."""
    url = url.strip()
    url = _TRACKING_PARAMS.sub("", url)
    url = re.sub(r"[?&]$", "", url)
    return url

def article_hash(title: str, url: str, week_start: str) -> str:
    """Stable dedup hash: normalized title + normalized domain + week bucket."""
    norm_title = re.sub(r"\s+", " ", (title or "").lower().strip())
    domain = re.sub(r"^https?://([^/]+).*$", r"\1", (url or "").lower().strip())
    domain = re.sub(r"^www\.", "", domain)
    raw = f"{norm_title}|{domain}|{week_start}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()

# ---------------------------------------------------------------------------
# HTTP fetch
# ---------------------------------------------------------------------------
_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; CohoHousingBrief/1.0; "
        "+https://pggllc.github.io/Housing-Analytics/)"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

def fetch_url(url: str, timeout: int = 20) -> bytes | None:
    """Fetch a URL; return bytes or None on any error."""
    try:
        req = Request(url, headers=_DEFAULT_HEADERS)
        with urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as exc:
        print(f"  [WARN] fetch failed {url!r}: {exc}")
        return None

# ---------------------------------------------------------------------------
# RSS parsing
# ---------------------------------------------------------------------------
def parse_rss(data: bytes, region_hint: str, week_start: str, seen: set[str]) -> list[dict]:
    """Parse RSS/Atom bytes; return deduped article dicts."""
    articles: list[dict] = []
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        print(f"  [WARN] RSS parse error: {exc}")
        return articles

    ns = {"atom": "http://www.w3.org/2005/Atom"}

    # RSS 2.0
    items = root.findall(".//item")
    # Atom fallback
    if not items:
        items = root.findall(".//atom:entry", ns) or root.findall(".//entry")

    for item in items:
        title_el = item.find("title")
        link_el = item.find("link")
        pub_el = item.find("pubDate") or item.find("published")
        source_el = item.find("source")

        # Atom link is an attribute
        if link_el is None:
            link_el = item.find("{http://www.w3.org/2005/Atom}link")

        raw_link = ""
        if link_el is not None:
            raw_link = (link_el.text or link_el.get("href") or "").strip()

        raw_title = html.unescape((title_el.text or "") if title_el is not None else "")
        link = canonicalize_url(raw_link)
        pub = (pub_el.text or "").strip() if pub_el is not None else ""

        # Source domain as fallback for source name
        source_name = ""
        if source_el is not None:
            source_name = (source_el.text or "").strip()
        if not source_name and link:
            m = re.match(r"^https?://([^/]+)", link)
            if m:
                source_name = re.sub(r"^www\.", "", m.group(1))

        if not raw_title or not link:
            continue

        h = article_hash(raw_title, link, week_start)
        if h in seen:
            continue
        seen.add(h)

        combined = raw_title + " " + source_name
        region = classify_region(combined)
        if region_hint in ("Western Slope", "Colorado") and region == "National":
            region = region_hint

        articles.append({
            "title": raw_title,
            "link": link,
            "source": source_name,
            "published": pub,
            "region": region,
        })

    return articles

# ---------------------------------------------------------------------------
# GDELT DOC API parsing
# ---------------------------------------------------------------------------
_GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc"

def fetch_gdelt_articles(
    query: str,
    start_dt: datetime,
    end_dt: datetime,
    maxrecords: int = 75,
) -> list[dict]:
    """Query GDELT 2.1 DOC API for a time window; return article list."""
    fmt = "%Y%m%d%H%M%S"
    params = (
        f"query={_url_encode(query)}"
        f"&mode=artlist"
        f"&maxrecords={maxrecords}"
        f"&startdatetime={start_dt.strftime(fmt)}"
        f"&enddatetime={end_dt.strftime(fmt)}"
        f"&format=json"
    )
    url = f"{_GDELT_API}?{params}"
    data = fetch_url(url)
    if not data:
        return []
    try:
        obj = json.loads(data.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        print(f"  [WARN] GDELT JSON decode error: {exc}")
        return []
    articles = []
    for art in obj.get("articles") or []:
        articles.append({
            "title": html.unescape(art.get("title") or ""),
            "link": canonicalize_url(art.get("url") or ""),
            "source": art.get("domain") or "",
            "published": art.get("seendate") or "",
        })
    return articles

def _url_encode(s: str) -> str:
    from urllib.parse import quote
    return quote(s, safe="")

# ---------------------------------------------------------------------------
# Week utilities
# ---------------------------------------------------------------------------
def week_start_for(dt: date) -> date:
    """Return the Monday on or before dt."""
    return dt - timedelta(days=dt.weekday())

def current_week_start() -> date:
    return week_start_for(date.today())

def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")

# ---------------------------------------------------------------------------
# Build payload
# ---------------------------------------------------------------------------
SECTIONS = ["Colorado", "Western Slope", "National"]

def build_payload(week_start: date, articles: list[dict]) -> dict:
    """Assemble the JSON payload for a week from a flat article list."""
    sections: dict[str, list] = {s: [] for s in SECTIONS}
    for art in articles:
        region = art.get("region", "National")
        if region not in sections:
            region = "National"
        entry = {k: art[k] for k in ("title", "link", "source", "published") if k in art}
        sections[region].append(entry)

    signals = extract_signals(articles)
    return {
        "week_start": iso(week_start),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_articles": len(articles),
        "sections": sections,
        "signals": signals,
        "signals_explain": (
            "Signal counts are keyword-based and measured across all fetched "
            "articles for this week."
        ),
    }

# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------
def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  Wrote {path}")

def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default

def update_archive_index(payload: dict) -> None:
    """Add or update the week entry in data/archive-index.json."""
    idx_path = DATA_DIR / "archive-index.json"
    idx = load_json(idx_path, {"entries": []})
    entries = idx.get("entries", [])

    week = payload["week_start"]
    entry = {
        "week_start": week,
        "total_articles": payload["total_articles"],
        "json_path": f"archive/{week}.json",
        "html_path": f"../archive/{week}.html",
    }
    # Replace existing entry for the same week
    entries = [e for e in entries if e.get("week_start") != week]
    entries.append(entry)
    # Sort descending
    entries.sort(key=lambda e: e["week_start"], reverse=True)
    idx["entries"] = entries
    idx["updated"] = datetime.now(timezone.utc).isoformat()
    write_json(idx_path, idx)

def update_signals_history(payload: dict, max_weeks: int = 156) -> None:
    """Append signals snapshot to data/signals-history.json, keep last max_weeks."""
    hist_path = DATA_DIR / "signals-history.json"
    hist = load_json(hist_path, {"history": []})
    history = hist.get("history", [])

    week = payload["week_start"]
    snap = {
        "week_start": week,
        "total_articles": payload["total_articles"],
        "signals": payload["signals"],
    }
    # Replace existing
    history = [h for h in history if h.get("week_start") != week]
    history.append(snap)
    # Sort descending, trim
    history.sort(key=lambda h: h["week_start"], reverse=True)
    hist["history"] = history[:max_weeks]
    hist["updated"] = datetime.now(timezone.utc).isoformat()
    write_json(hist_path, hist)

# ---------------------------------------------------------------------------
# Archive HTML generation
# ---------------------------------------------------------------------------
HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Weekly Brief {week_start} | COHO Analytics</title>
  <style>
    body{{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#0d1f35;background:#eef2f7;}}
    h1{{font-size:1.4rem;margin-bottom:.25rem;}}
    .pill{{display:inline-block;padding:.2rem .7rem;border-radius:99px;font-size:.75rem;font-weight:600;margin:.15rem;}}
    .pill-accent{{background:#096e65;color:#fff;}}
    .pill-muted{{background:#e4ecf4;color:#476080;}}
    h2{{font-size:1rem;margin:1.5rem 0 .5rem;color:#096e65;}}
    ul{{list-style:none;padding:0;margin:0;}}
    li{{border-bottom:1px solid rgba(13,31,53,.08);padding:.5rem 0;font-size:.875rem;}}
    li a{{color:#005a9c;text-decoration:none;}}
    li a:hover{{text-decoration:underline;}}
    .meta{{font-size:.75rem;color:#476080;}}
    .signal-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem;margin-top:.5rem;}}
    .signal-card{{background:#fff;border-radius:10px;padding:.75rem 1rem;box-shadow:0 1px 3px rgba(13,31,53,.07);}}
    .signal-card h3{{font-size:.8rem;margin:0 0 .25rem;color:#476080;text-transform:uppercase;letter-spacing:.04em;}}
    .signal-card .count{{font-size:1.5rem;font-weight:700;color:#0d1f35;}}
    .signal-card .terms{{font-size:.7rem;color:#476080;margin-top:.25rem;}}
    .back{{font-size:.8rem;margin-bottom:1.5rem;}}
    .back a{{color:#005a9c;}}
    footer{{margin-top:2rem;font-size:.75rem;color:#476080;border-top:1px solid rgba(13,31,53,.1);padding-top:1rem;}}
  </style>
</head>
<body>
<div class="back"><a href="../">← Back to latest brief</a></div>
<h1>Weekly Housing Intelligence Brief</h1>
<div>
  <span class="pill pill-accent">Week of {week_start}</span>
  <span class="pill pill-muted">{total_articles} articles</span>
  <span class="pill pill-muted">Generated {generated_at_short}</span>
</div>
{sections_html}
<h2>Signal Counts</h2>
<p style="font-size:.75rem;color:#476080;">{signals_explain}</p>
<div class="signal-grid">{signals_html}</div>
<footer>COHO Analytics — Weekly Housing Intelligence Brief — {week_start}<br>
This page is not indexed by search engines and is not linked from site navigation.</footer>
</body>
</html>
"""

def _render_section(name: str, articles: list) -> str:
    if not articles:
        return (
            f"<h2>{name}</h2>"
            f'<p style="font-size:.85rem;color:#476080;">No articles this week.</p>'
        )
    items = ""
    for art in articles:
        title = html.escape(art.get("title", ""))
        link = html.escape(art.get("link", "#"))
        source = html.escape(art.get("source", ""))
        pub = html.escape(art.get("published", ""))
        meta = " · ".join(filter(None, [source, pub[:16] if pub else ""]))
        items += (
            f"<li><a href=\"{link}\" target=\"_blank\" rel=\"noopener\">{title}</a>"
            f"<br><span class=\"meta\">{meta}</span></li>"
        )
    return f"<h2>{name} ({len(articles)})</h2><ul>{items}</ul>"

def generate_archive_html(payload: dict) -> str:
    """Return HTML string for an archive page."""
    week_start = payload["week_start"]
    total = payload["total_articles"]
    generated_at = payload.get("generated_at", "")
    generated_at_short = generated_at[:10] if generated_at else ""
    signals_explain = html.escape(payload.get("signals_explain", ""))

    sections_html = "".join(
        _render_section(name, payload["sections"].get(name, []))
        for name in SECTIONS
    )

    signals_html = ""
    for bucket, data in payload.get("signals", {}).items():
        count = data.get("count", 0)
        terms = ", ".join(data.get("top_terms", [])) or "—"
        signals_html += (
            f'<div class="signal-card">'
            f'<h3>{html.escape(bucket)}</h3>'
            f'<div class="count">{count}</div>'
            f'<div class="terms">{html.escape(terms)}</div>'
            f"</div>"
        )

    return HTML_TEMPLATE.format(
        week_start=week_start,
        total_articles=total,
        generated_at_short=generated_at_short,
        sections_html=sections_html,
        signals_html=signals_html,
        signals_explain=signals_explain,
    )

def write_archive_html(payload: dict) -> None:
    week_start = payload["week_start"]
    html_path = ARCHIVE_HTML_DIR / f"{week_start}.html"
    html_path.parent.mkdir(parents=True, exist_ok=True)
    html_path.write_text(generate_archive_html(payload), encoding="utf-8")
    print(f"  Wrote {html_path}")
