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
# HTML-stripping helper
# ---------------------------------------------------------------------------
_HTML_TAG = re.compile(r'<[^>]+>')
_WHITESPACE = re.compile(r'\s+')

def _strip_html(text: str, max_len: int = 300) -> str:
    """Strip HTML tags from text, unescape entities, and truncate gracefully."""
    if not text:
        return ""
    text = html.unescape(text)
    text = _HTML_TAG.sub(' ', text)
    text = _WHITESPACE.sub(' ', text).strip()
    if len(text) > max_len:
        text = text[:max_len].rsplit(' ', 1)[0] + '\u2026'
    return text

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

def _article_combined(article: dict) -> str:
    """Return a lower-cased text blob for signal matching (title + source + summary)."""
    return (
        (article.get("title") or "") + " " +
        (article.get("source") or "") + " " +
        (article.get("summary") or "")
    ).lower()


def article_matched_signals(article: dict) -> list[str]:
    """Return the list of signal bucket names this article matches."""
    combined = _article_combined(article)
    matched = []
    for bucket, keywords in SIGNAL_KEYWORDS.items():
        for kw in keywords:
            if kw in combined:
                matched.append(bucket)
                break
    return matched


def extract_signals(articles: list[dict]) -> dict:
    """Count signal bucket hits and extract top terms from all articles."""
    signals = {k: {"count": 0, "top_terms": []} for k in SIGNAL_KEYWORDS}
    term_hits: dict[str, dict[str, int]] = {k: {} for k in SIGNAL_KEYWORDS}

    for article in articles:
        combined = _article_combined(article)

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
        pub_el = item.find("pubDate")
        if pub_el is None:
            pub_el = item.find("published")
        source_el = item.find("source")
        desc_el = item.find("description")
        if desc_el is None:
            desc_el = item.find("summary")
        if desc_el is None:
            desc_el = item.find("{http://www.w3.org/2005/Atom}summary")
        if desc_el is None:
            desc_el = item.find("{http://www.w3.org/2005/Atom}content")

        # Atom link is an attribute
        if link_el is None:
            link_el = item.find("{http://www.w3.org/2005/Atom}link")

        raw_link = ""
        if link_el is not None:
            raw_link = (link_el.text or link_el.get("href") or "").strip()

        raw_title = html.unescape((title_el.text or "") if title_el is not None else "")
        link = canonicalize_url(raw_link)
        pub = (pub_el.text or "").strip() if pub_el is not None else ""
        raw_desc = (desc_el.text or "") if desc_el is not None else ""
        summary = _strip_html(raw_desc)

        # Source domain as fallback for source name
        source_name = ""
        if source_el is not None:
            source_name = (source_el.text or "").strip()
        if not source_name and link:
            m = re.match(r"^https?://([^/]+)", link)
            if m:
                source_name = re.sub(r"^www\.", "", m.group(1))

        # Discard summary when it merely repeats the article title (e.g. Google News RSS
        # where the <description> is just "Title Source Name" with no real content).
        if summary and raw_title:
            title_norm = re.sub(r'\s+', ' ', raw_title).strip().lower()
            summary_norm = re.sub(r'\s+', ' ', summary).strip().lower()
            # Drop if the summary starts with the normalised title (allowing for source appended)
            prefix_len = min(40, len(title_norm))
            if summary_norm.startswith(title_norm[:prefix_len]):
                summary = ""

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
            "summary": summary,
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
            # GDELT DOC API does not return article body text; summary is left blank
            # and will be populated by the RSS description when available.
            "summary": "",
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

# Static context sentence per section — explains the affordable-housing angle.
_SECTION_CONTEXT = {
    "Colorado": (
        "These stories track LIHTC award cycles, municipal affordability "
        "ordinances, and local housing developments that directly shape supply and "
        "cost-burden for Colorado renters and buyers."
    ),
    "Western Slope": (
        "Coverage highlights workforce-housing shortages, resort-market "
        "price pressures, and rural development challenges that make affordability "
        "especially acute in mountain communities."
    ),
    "National": (
        "Coverage monitors federal housing-finance policy, LIHTC program "
        "updates, construction-cost trends, and macroeconomic signals — interest rates, "
        "insurance premiums, and supply-chain pressures — that ripple through every "
        "local affordable housing market."
    ),
}

# Human-readable signal labels used in section summaries
_SIGNAL_SHORT = {
    "Financing / Rates": "financing & rates",
    "LIHTC / Tax Credit": "LIHTC/tax credits",
    "Supply / Pipeline": "supply pipeline",
    "Costs / Insurance": "costs & insurance",
    "Rent Pressure / Homelessness": "rent pressure",
    "Policy / Zoning": "policy & zoning",
}


def _build_section_summary(region: str, articles: list[dict]) -> str:
    """Generate a dynamic summary for a section based on its top signals."""
    if not articles:
        return _SECTION_CONTEXT.get(region, "")

    # Count signal buckets across this section's articles
    bucket_counts: dict[str, int] = {}
    for art in articles:
        for sig in article_matched_signals(art):
            bucket_counts[sig] = bucket_counts.get(sig, 0) + 1

    # Pick top 3 buckets by article count
    top_buckets = sorted(bucket_counts.items(), key=lambda x: -x[1])[:3]
    if not top_buckets:
        return _SECTION_CONTEXT.get(region, "")

    top_labels = [_SIGNAL_SHORT.get(b, b) for b, _ in top_buckets]
    if len(top_labels) == 1:
        signal_phrase = top_labels[0]
    elif len(top_labels) == 2:
        signal_phrase = f"{top_labels[0]} and {top_labels[1]}"
    else:
        signal_phrase = f"{top_labels[0]}, {top_labels[1]}, and {top_labels[2]}"

    context = _SECTION_CONTEXT.get(region, "")
    return (
        f"This week\u2019s {len(articles)} articles focus on "
        f"{signal_phrase}. {context}"
    )


def build_payload(week_start: date, articles: list[dict]) -> dict:
    """Assemble the JSON payload for a week from a flat article list."""
    sections: dict[str, list] = {s: [] for s in SECTIONS}
    for art in articles:
        region = art.get("region", "National")
        if region not in sections:
            region = "National"
        matched = article_matched_signals(art)
        entry = {k: art[k] for k in ("title", "link", "source", "published", "summary") if k in art}
        entry["signal_count"] = len(matched)
        entry["signals"] = matched
        sections[region].append(entry)

    signals = extract_signals(articles)
    total_signal_count = sum(v.get("count", 0) for v in signals.values())

    section_summaries = {
        region: _build_section_summary(region, sections[region])
        for region in SECTIONS
    }

    return {
        "week_start": iso(week_start),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_articles": len(articles),
        "total_signal_count": total_signal_count,
        "sections": sections,
        "section_summaries": section_summaries,
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
  <meta name="theme-color" content="#096e65" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0fd4cf" media="(prefers-color-scheme: dark)">
  <title>Weekly Brief {week_start} | COHO Analytics</title>
  <style>
    :root{{
      --bg:#eef2f7;--card:#fff;--card2:#f7fafd;--bg2:#e4ecf4;
      --text:#0d1f35;--muted:#476080;--faint:#8fa8c0;
      --accent:#096e65;--link:#005a9c;
      --border:rgba(13,31,53,.09);--shadow-card:0 2px 8px rgba(13,31,53,.06),0 0 0 1px rgba(13,31,53,.07);
    }}
    @media(prefers-color-scheme:dark){{
      :root{{
        --bg:#08121e;--card:#0d1e30;--card2:#102234;--bg2:#0c1928;
        --text:rgba(215,232,248,.93);--muted:rgba(210,225,245,.95);--faint:rgba(190,210,235,.90);
        --accent:#0fd4cf;--link:#5ecbcc;
        --border:rgba(90,150,210,.11);--shadow-card:0 2px 8px rgba(0,0,0,.35),0 0 0 1px rgba(90,150,210,.10);
      }}
    }}
    html.light-mode{{
      --bg:#eef2f7;--card:#fff;--card2:#f7fafd;--bg2:#e4ecf4;
      --text:#0d1f35;--muted:#476080;--faint:#8fa8c0;
      --accent:#096e65;--link:#005a9c;
      --border:rgba(13,31,53,.09);--shadow-card:0 2px 8px rgba(13,31,53,.06),0 0 0 1px rgba(13,31,53,.07);
    }}
    html.dark-mode{{
      --bg:#08121e;--card:#0d1e30;--card2:#102234;--bg2:#0c1928;
      --text:rgba(215,232,248,.93);--muted:rgba(210,225,245,.95);--faint:rgba(190,210,235,.90);
      --accent:#0fd4cf;--link:#5ecbcc;
      --border:rgba(90,150,210,.11);--shadow-card:0 2px 8px rgba(0,0,0,.35),0 0 0 1px rgba(90,150,210,.10);
    }}
    *,*::before,*::after{{box-sizing:border-box;}}
    body{{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:var(--text);background:var(--bg);transition:background .25s,color .25s;}}
    h1{{font-size:1.4rem;margin-bottom:.25rem;color:var(--text);}}
    .pill{{display:inline-block;padding:.2rem .7rem;border-radius:99px;font-size:.75rem;font-weight:600;margin:.15rem;}}
    .pill-accent{{background:var(--accent);color:#fff;}}
    .pill-muted{{background:var(--bg2);color:var(--muted);}}
    .total-signals-banner{{background:var(--accent);color:#fff;border-radius:10px;padding:.75rem 1.25rem;margin:.75rem 0 1.25rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;}}
    .total-signals-banner .ts-num{{font-size:2rem;font-weight:800;line-height:1;}}
    .total-signals-banner .ts-label{{font-size:.85rem;opacity:.9;}}
    h2{{font-size:1rem;margin:1.5rem 0 .5rem;color:var(--accent);}}
    ul{{list-style:none;padding:0;margin:0;}}
    li{{border-bottom:1px solid var(--border);padding:.5rem 0;font-size:.875rem;}}
    li:last-child{{border-bottom:none;}}
    li a{{color:var(--link);text-decoration:none;}}
    li a:hover{{text-decoration:underline;}}
    .meta{{font-size:.72rem;color:var(--muted);margin-top:.1rem;}}
    .art-summary{{font-size:.78rem;color:var(--muted);margin-top:.15rem;line-height:1.5;}}
    .show-more-li{{border-bottom:none!important;padding:.4rem 0;}}
    .show-more-btn{{background:none;border:1px solid var(--accent);color:var(--accent);border-radius:99px;font-size:.8rem;padding:.3rem .9rem;cursor:pointer;font-weight:600;}}
    .show-more-btn:hover{{background:var(--accent);color:#fff;}}
    .signal-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.75rem;margin-top:.5rem;}}
    .signal-card{{background:var(--card);border-radius:10px;padding:.75rem 1rem;box-shadow:var(--shadow-card);}}
    .signal-card h3{{font-size:.8rem;margin:0 0 .25rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}}
    .signal-card .count{{font-size:1.5rem;font-weight:700;color:var(--text);}}
    .signal-card .terms{{font-size:.7rem;color:var(--muted);margin-top:.25rem;}}
    .back{{font-size:.8rem;margin-bottom:1.5rem;}}
    .back a{{color:var(--link);}}
    footer{{margin-top:2rem;font-size:.75rem;color:var(--muted);border-top:1px solid var(--border);padding-top:1rem;}}
    .theme-toggle{{position:fixed;bottom:1.25rem;right:1.25rem;z-index:9999;width:44px;height:44px;border-radius:50%;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:var(--shadow-card);transition:background .2s;}}
    .theme-toggle:hover{{background:var(--bg2);}}
    .theme-toggle:focus-visible{{outline:2px solid var(--accent);outline-offset:2px;}}
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
<div class="total-signals-banner" aria-label="Total signal count">
  <span class="ts-num">{total_signal_count}</span>
  <span class="ts-label">total signals detected across all articles this week</span>
</div>
<h2>Signal Counts</h2>
<p style="font-size:.75rem;color:var(--muted);">{signals_explain}</p>
<div class="signal-grid">{signals_html}</div>
{sections_html}
<footer>COHO Analytics — Weekly Housing Intelligence Brief — {week_start}<br>
This page is not indexed by search engines and is not linked from site navigation.</footer>
<button class="theme-toggle" type="button" aria-label="Switch to dark mode" aria-pressed="false">🌙</button>
<script>
(function(){{
  var KEY='coho-analytics-scheme';
  var html=document.documentElement;
  var btn=document.querySelector('.theme-toggle');
  function apply(s,save){{
    if(s==='dark'){{html.classList.add('dark-mode');html.classList.remove('light-mode');}}
    else{{html.classList.add('light-mode');html.classList.remove('dark-mode');}}
    if(btn){{btn.textContent=s==='dark'?'☀':'🌙';btn.setAttribute('aria-label',s==='dark'?'Switch to light mode':'Switch to dark mode');btn.setAttribute('aria-pressed',String(s==='dark'));}}
    if(save){{try{{localStorage.setItem(KEY,s);}}catch(e){{}}}}
  }}
  var stored=null;try{{stored=localStorage.getItem(KEY);}}catch(e){{}}
  var initial=stored||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  apply(initial,false);
  if(btn){{btn.addEventListener('click',function(){{
    var next=html.classList.contains('dark-mode')?'light':'dark';
    apply(next,true);
  }});}}
  if(window.matchMedia){{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',function(e){{
    if(!stored)apply(e.matches?'dark':'light',false);
  }});}}
}})();
</script>
</body>
</html>
"""

def _parse_pub_date(pub: str) -> datetime:
    """Parse a publication date string to a datetime for sorting. Returns epoch on failure."""
    if not pub:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    # GDELT seendate: 20260316T100000Z
    m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$", pub.strip())
    if m:
        try:
            return datetime(
                int(m.group(1)), int(m.group(2)), int(m.group(3)),
                int(m.group(4)), int(m.group(5)), int(m.group(6)),
                tzinfo=timezone.utc,
            )
        except ValueError:
            return datetime(1970, 1, 1, tzinfo=timezone.utc)
    # RFC-2822 and ISO-8601 via email.utils / dateutil-free parsing
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(pub)
    except Exception:
        pass
    # ISO-8601 date-only fallback
    try:
        d = datetime.fromisoformat(pub.strip().replace("Z", "+00:00"))
        return d
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def _render_section(name: str, articles: list, summary: str = "") -> str:
    if not articles:
        return (
            f"<h2>{name}</h2>"
            f'<p style="font-size:.85rem;color:var(--muted);">No articles this week.</p>'
        )
    summary_html = (
        f'<p style="font-size:.8rem;color:var(--muted);margin:.25rem 0 .75rem;">'
        f'{html.escape(summary)}</p>'
    ) if summary else ""
    # Sort by hero signal (first matched signal), then source, then newest-first date
    def _hero_key(a: dict):
        signals = a.get("signals") or []
        hero = signals[0] if signals else "\uffff"
        source = a.get("source", "")
        pub_ts = _parse_pub_date(a.get("published", "")).timestamp()
        return (hero, source, -pub_ts)
    sorted_articles = sorted(articles, key=_hero_key)
    items = ""
    for art in sorted_articles:
        title = html.escape(art.get("title", ""))
        link = html.escape(art.get("link", "#"))
        source = html.escape(art.get("source", ""))
        pub_raw = art.get("published", "")
        # Format the date nicely from the raw value (cross-platform, no %-d)
        try:
            pub_dt = _parse_pub_date(pub_raw)
            pub_display = f"{pub_dt.day} {pub_dt.strftime('%b %Y')}" if pub_dt.year != 1970 else ""
        except Exception:
            pub_display = pub_raw[:16] if pub_raw else ""
        art_summary = html.escape(art.get("summary", ""))
        # meta is assembled from already-escaped `source` and plain-text `pub_display`
        meta = source + (" · " + html.escape(pub_display) if pub_display else "")
        items += (
            f'<li>'
            f'<a href="{link}" target="_blank" rel="noopener">{title}</a>'
            f'<br><span class="meta">{meta}</span>'
            + (f'<br><span class="art-summary">{art_summary}</span>' if art_summary else "")
            + '</li>'
        )
    return (
        f"<h2>{name} ({len(articles)})</h2>"
        f"{summary_html}"
        f"<ul>{items}</ul>"
    )

def generate_archive_html(payload: dict) -> str:
    """Return HTML string for an archive page."""
    week_start = payload["week_start"]
    total = payload["total_articles"]
    total_signal_count = payload.get("total_signal_count", 0)
    generated_at = payload.get("generated_at", "")
    generated_at_short = generated_at[:10] if generated_at else ""
    signals_explain = html.escape(payload.get("signals_explain", ""))
    section_summaries = payload.get("section_summaries", {})

    sections_html = "".join(
        _render_section(name, payload["sections"].get(name, []), section_summaries.get(name, ""))
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
        total_signal_count=total_signal_count,
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
