#!/usr/bin/env python3
"""
scripts/news/fetch_housing_events.py

Upcoming Colorado housing events for Housing News (policy-briefs.html) and the
jurisdiction briefs' news panel.

Until 2026-10-14 the news feed carried no events at all: it is built from news
searches, and a training calendar or a conference agenda rarely makes the news.
So the Housing Colorado conference and CHFA's chfareach classes never appeared.

Three sources, each read every day by weekly_housing_brief.yml:
  - CHFA's public calendar feed, the data behind chfainfo.com/events and the
    chfareach calendar (JSON: title, start, end, place, link).
  - Housing Colorado's "Upcoming Events" list on housingcolorado.org/events/.
    The site sits behind Cloudflare and answers a bare script with 403; it
    answers a request that sends ordinary browser headers.
  - data/policy/housing-events-curated.json: events no feed lists (the annual
    conference has its own page, not a row in the list; NAHRO is national).
    Each entry names the page it was checked against and the date.

Added 2026-10-26 (paul: "the calendar should track oedit, cdoh, housing
colorado, apa colorado housing committee, and any other relevant release
notes (interest rates, etc.)"):
  - DOLA's public Google calendars, read as iCalendar: the Division of Housing
    calendar (State Housing Board, notices of funding, rental assistance
    windows) and the Proposition 123 calendar (filing deadlines). These are
    the calendars embedded on cdola.colorado.gov/calendar.
  - APA Colorado's public event calendar (colorado.planning.org), housing
    items and the state planning conference only. APA Colorado lists no
    separate housing committee calendar; its housing items (DOLA's Housing
    Strategies Peer Exchange, housing planning grant sessions) are on this one.
  - The Federal Reserve's FOMC meeting calendar (rate decisions).
  - The Census Bureau's ACS release schedule.
  - FRED's release calendar for CPI, the jobs report and housing starts
    (needs FRED_API_KEY; without it the source is marked not fetched).
  - OEDIT has no event listing (its events page is empty); its program dates
    with an exact day, such as the Transit and Housing Investment Zones map,
    are checked by hand in the curated file.
Recurring calendar entries are expanded when they repeat monthly or yearly
(the State Housing Board, the peer exchange); daily and weekly office hours
are left out.

A source that cannot be read is recorded as unreachable and contributes
nothing. Its previous upcoming events are not kept: a list that silently stops
updating is the failure this file exists to avoid.

Past events are kept in their own list (`past`, newest first) because paul
asked on 2026-10-19 to keep them: a record of what CHFA and Housing Colorado
ran is useful, and it never reads as current. Each is an event a source listed
while it was still upcoming or as it ended; CHFA's feed also lists its own past
events. Kept for PAST_DAYS.

Usage:
  python3 scripts/news/fetch_housing_events.py              # fetch and write
  python3 scripts/news/fetch_housing_events.py --offline    # curated only
  python3 scripts/news/fetch_housing_events.py --today 2026-10-14
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_FILE = ROOT / 'data' / 'policy' / 'housing-events.json'
CURATED_FILE = ROOT / 'data' / 'policy' / 'housing-events-curated.json'

THIZ_FILE = ROOT / 'data' / 'policy' / 'thiz-map-status.json'

CHFA_FEED = 'https://www.chfainfo.com/api/calendar/calendar.json'
CHFA_BASE = 'https://www.chfainfo.com'
CHFA_PAGE = 'https://www.chfainfo.com/events'
HC_PAGE = 'https://housingcolorado.org/events/'

GCAL_ICS = 'https://calendar.google.com/calendar/ical/{id}%40group.calendar.google.com/public/basic.ics'
DOLA_CALENDAR_PAGE = 'https://cdola.colorado.gov/calendar'
DOH_CALENDAR = 'c_5013846889d7e565e0afd07abdf08f4c4b839bb10cb6c32d9018e66dbc91a33d'
PROP123_CALENDAR = 'c_983d640f6e3b8a1c3db7b5f8c4fbbcd50efb858e6f02fef8074131340baae3d5'
APA_CO_PAGE = 'https://colorado.planning.org/conferences-and-meetings/event-calendar'
APA_CO_CALENDAR = 'c_73fe67d9cf002f3d63592d8c9569e20032e88d7adcb08b995ad293d73ae3e1ed'
FOMC_PAGE = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
ACS_SCHEDULE_PAGE = 'https://www.census.gov/programs-surveys/acs/news/data-releases/{year}/release-schedule.html'
FRED_API = 'https://api.stlouisfed.org/fred'
FRED_CALENDAR_PAGE = 'https://fred.stlouisfed.org/'
# Series whose release dates a housing practitioner watches, with the agency
# that publishes each. The release id is looked up from the series, so a FRED
# renumbering cannot point a label at the wrong release.
FRED_SERIES = [
    ('CPIAUCSL', 'U.S. Bureau of Labor Statistics', 'Consumer Price Index (inflation)'),
    ('PAYEMS', 'U.S. Bureau of Labor Statistics', 'Jobs report (Employment Situation)'),
    ('HOUST', 'U.S. Census Bureau', 'Housing starts and permits (New Residential Construction)'),
]

HORIZON_DAYS = 120
PAST_DAYS = 365
TIMEOUT = 30
BROWSER_HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

# Display order. The page shows a filter chip for each one that has events.
CATEGORIES = {
    'conference': 'Conferences',
    'deadline': 'Deadlines & funding notices',
    'developer': 'Developer & finance',
    'release': 'Data & rate releases',
    'compliance': 'Compliance training',
    'board': 'Board meetings',
    'homebuyer': 'Homebuyer & lender',
    'networking': 'Networking',
    'other': 'Other',
}

MONTHS = {m: i for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
     'september', 'october', 'november', 'december'], start=1)}


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(text or '')).strip()


def categorize(title: str, organizer: str) -> str:
    t = title.lower()
    if re.search(r'deadline|notice of funding|notice of funds|\bnofa\b|application period|pre-application|'
                 r'filing|due date|applications? (due|open|close)', t):
        return 'deadline'
    if 'board of directors' in t or re.search(r'\bboard meeting\b|state housing board', t):
        return 'board'
    if 'conference' in t:
        return 'conference'
    if re.search(r'homebuyer|lender|loan|closers|funders|final documents|suspense conditions|'
                 r'real estate professional|mortgage', t):
        return 'homebuyer'
    if re.search(r'^(chfareach|hpi)\b|compliance|nspire|reac|hotma|fair housing|vivienda justa|'
                 r'property|resident|de-escalation', t):
        return 'compliance'
    if re.search(r'tax credit|lihtc|qap|allocation|developer|funding|financ|bond|prop(osition)? 123', t):
        return 'developer'
    return 'networking' if organizer == 'Housing Colorado' else 'other'


def _iso_day(value: str) -> str | None:
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', value or '')
    if not m or m.group(1).startswith('0001'):
        return None
    return m.group(1)


def _time(value: str, all_day: bool) -> str | None:
    if all_day:
        return None
    m = re.match(r'^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})', value or '')
    return m.group(1) if m else None


def parse_chfa(doc: dict) -> list[dict]:
    """CHFA's calendar JSON → events. Times are Mountain, as CHFA lists them."""
    if not isinstance(doc, dict) or not isinstance(doc.get('events'), list):
        raise ValueError('CHFA calendar response has no events list')
    out = []
    for e in (doc or {}).get('events') or []:
        title = clean(e.get('title') or e.get('extendedProps', {}).get('heading') or '')
        start = _iso_day(e.get('start') or '')
        if not title or not start:
            continue
        all_day = bool(e.get('allDay'))
        end = _iso_day(e.get('end') or '')
        url = (e.get('url') or '').strip()
        if url.startswith('/'):
            url = CHFA_BASE + url
        if not url.startswith('http'):
            url = CHFA_PAGE
        location = clean((e.get('extendedProps') or {}).get('copy') or '')
        out.append({
            'title': title,
            'start': start,
            'end': end if end and end != start else None,
            'time': _time(e.get('start') or '', all_day),
            'location': location or None,
            'online': bool(re.search(r'\bonline\b|\bvirtual\b', location, re.I)),
            'organizer': 'CHFA',
            'url': url,
            'source': 'chfa',
            'category': categorize(title, 'CHFA'),
        })
    return out


def _parse_long_date(text: str) -> str | None:
    m = re.search(r'([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})', text or '')
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()


def parse_housing_colorado(page: str) -> list[dict]:
    """The "Upcoming Events" list on housingcolorado.org/events/.

    A 200 that is not that page (a bot challenge, a redesign) must not read as
    "no events": without the list's container the page is not recognized.
    """
    if 'class="remembers-events"' not in (page or ''):
        raise ValueError('Housing Colorado events list not found on the page')
    out = []
    for art in re.findall(r'<article class="remembers-event">(.*?)</article>', page or '', re.S):
        title = clean(re.sub(r'<[^>]+>', ' ', (re.search(r'<h3[^>]*>(.*?)</h3>', art, re.S) or [None, ''])[1]))
        when = re.search(r'class="remembers-event-date"[^>]*>(.*?)</p>', art, re.S)
        start = _parse_long_date(clean(re.sub(r'<[^>]+>', ' ', when.group(1)))) if when else None
        link = re.search(r'href="(https?://[^"]+)"', art)
        if not title or not start:
            continue
        out.append({
            'title': title,
            'start': start,
            'end': None,
            'time': None,
            'location': None,
            'online': False,
            'organizer': 'Housing Colorado',
            'url': html.unescape(link.group(1)) if link else HC_PAGE,
            'source': 'housing_colorado',
            'category': categorize(title, 'Housing Colorado'),
        })
    return out


# ── iCalendar (DOLA's and APA Colorado's public Google calendars) ──────────

WEEKDAYS = {'MO': 0, 'TU': 1, 'WE': 2, 'TH': 3, 'FR': 4, 'SA': 5, 'SU': 6}
DENVER_UTC_OFFSET = {False: 7, True: 6}  # hours behind UTC: standard, daylight


def _ics_unescape(v: str) -> str:
    return clean(v.replace('\\n', ' ').replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\'))


def _ics_events(text: str) -> list[dict]:
    """VEVENT blocks → {NAME: (params, value)}. Folded lines are unfolded first."""
    if 'BEGIN:VCALENDAR' not in (text or ''):
        raise ValueError('not an iCalendar file')
    text = re.sub(r'\r?\n[ \t]', '', text)
    out = []
    for block in re.findall(r'BEGIN:VEVENT\r?\n(.*?)\r?\nEND:VEVENT', text, re.S):
        props: dict = {}
        for line in block.splitlines():
            name, _, value = line.partition(':')
            key, _, params = name.partition(';')
            if key == 'EXDATE':
                props.setdefault('EXDATE', []).extend(value.split(','))
            else:
                props.setdefault(key, (params, value))
        out.append(props)
    return out


def _is_dst(d: date) -> bool:
    """US daylight time: second Sunday of March to first Sunday of November."""
    def nth_sunday(month, n):
        first = date(d.year, month, 1)
        return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))
    return nth_sunday(3, 2) <= d < nth_sunday(11, 1)


def _ics_when(params: str, value: str) -> tuple[str | None, str | None]:
    """DTSTART/DTEND → (Mountain-time ISO day, HH:MM or None for all-day)."""
    m = re.match(r'^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?$', value or '')
    if not m:
        return None, None
    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if m.group(4) is None:
        return d.isoformat(), None
    hh, mm = int(m.group(4)), int(m.group(5))
    if m.group(6) == 'Z':  # UTC → Mountain
        dt = datetime(d.year, d.month, d.day, hh, mm) - timedelta(hours=DENVER_UTC_OFFSET[_is_dst(d)])
        d, hh, mm = dt.date(), dt.hour, dt.minute
    return d.isoformat(), f'{hh:02d}:{mm:02d}'


def _nth_weekday(year: int, month: int, n: int, weekday: int) -> date | None:
    if n > 0:
        first = date(year, month, 1)
        d = first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
        return d if d.month == month else None
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    last = nxt - timedelta(days=1)
    d = last - timedelta(days=(last.weekday() - weekday) % 7 + 7 * (-n - 1))
    return d if d.month == month else None


def _expand(start: date, rrule: str, until_day: date) -> list[date] | None:
    """Occurrences of a monthly or yearly RRULE up to until_day.

    Returns None for rules this reader leaves out (daily and weekly office
    hours, anything it does not understand), so they are skipped rather than
    shown on a guessed date.
    """
    rule = dict(part.split('=', 1) for part in rrule.split(';') if '=' in part)
    freq = rule.get('FREQ')
    if freq not in ('MONTHLY', 'YEARLY'):
        return None
    if set(rule) - {'FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'}:
        return None  # BYMONTH, BYMONTHDAY, BYSETPOS and the rest constrain dates this reader does not compute
    interval = int(rule.get('INTERVAL', '1'))
    count = int(rule['COUNT']) if 'COUNT' in rule else None
    if 'UNTIL' in rule:
        u = rule['UNTIL'][:8]
        until_day = min(until_day, date(int(u[:4]), int(u[4:6]), int(u[6:8])))
    byday = rule.get('BYDAY')
    nth = None
    if byday:
        m = re.match(r'^([+-]?\d)([A-Z]{2})$', byday)
        if not m or m.group(2) not in WEEKDAYS:
            return None
        nth = (int(m.group(1)), WEEKDAYS[m.group(2)])
    out, i = [], 0
    step = interval if freq == 'MONTHLY' else 12 * interval
    while True:
        months = start.month - 1 + i * step
        y, mo = start.year + months // 12, months % 12 + 1
        i += 1
        if date(y, mo, 1) > until_day:
            break
        if nth:
            d = _nth_weekday(y, mo, *nth)
        else:
            try:
                d = date(y, mo, start.day)
            except ValueError:
                d = None
        if d is None or d < start:
            continue
        if d > until_day:
            break
        out.append(d)
        if count is not None and len(out) >= count:
            break
        if i > 600:
            break
    return out


# A room link (join a call now) is not a page about the event; the calendar page is.
PRIVATE_MEETING_LINK = re.compile(r'//(meet|tel)\.|meet\.google\.com|teams\.microsoft\.com|zoom\.us/j/|'
                                  r'calendar\.google\.com|support\.google\.com|google\.com/maps|webex\.com/(meet|join)', re.I)


def parse_ics(text: str, organizer: str, source: str, page: str, today: date,
              keep=None) -> list[dict]:
    """A public calendar's events → our event rows.

    keep(title, description) decides which entries belong on a housing
    calendar (None keeps all). Recurring entries are expanded only when they
    repeat monthly or yearly.
    """
    horizon = today + timedelta(days=HORIZON_DAYS)
    blocks = _ics_events(text)
    # A cancelled or moved occurrence is its own VEVENT with the series' UID and a RECURRENCE-ID
    # naming the original date (RFC 5545 §3.8.4.4). Those dates come off the series; the exception,
    # unless cancelled, is listed on its own.
    replaced: dict = {}
    for p in blocks:
        if 'RECURRENCE-ID' in p:
            replaced.setdefault((p.get('UID') or ('', ''))[1], set()).add(p['RECURRENCE-ID'][1][:8])
    out = []
    for p in blocks:
        if (p.get('STATUS') or ('', ''))[1].upper() == 'CANCELLED':
            continue
        title = _ics_unescape((p.get('SUMMARY') or ('', ''))[1])
        desc = _ics_unescape((p.get('DESCRIPTION') or ('', ''))[1])
        if not title or (keep and not keep(title, desc)):
            continue
        start, time_ = _ics_when(*(p.get('DTSTART') or ('', '')))
        if not start:
            continue
        end, _ = _ics_when(*(p.get('DTEND') or ('', '')))
        if end and time_ is None:  # an all-day DTEND is exclusive
            end = (date.fromisoformat(end) - timedelta(days=1)).isoformat()
        length = (date.fromisoformat(end) - date.fromisoformat(start)).days if end else 0
        starts = [date.fromisoformat(start)]
        if 'RRULE' in p:
            exdates = {x[:8] for x in p.get('EXDATE', [])} | replaced.get((p.get('UID') or ('', ''))[1], set())
            starts = _expand(starts[0], p['RRULE'][1], horizon)
            if starts is None:
                continue
            starts = [d for d in starts if d.strftime('%Y%m%d') not in exdates]
        location = _ics_unescape((p.get('LOCATION') or ('', ''))[1])
        link = next((u for u in re.findall(r'https?://[^\s<>"]+', f"{(p.get('URL') or ('', ''))[1]} {desc}")
                     if not PRIVATE_MEETING_LINK.search(u)), None)
        for d in starts:
            e_end = (d + timedelta(days=length)).isoformat() if length > 0 else None
            out.append({
                'title': title,
                'start': d.isoformat(),
                'end': e_end,
                'time': time_,
                'location': None if not location or location.startswith('http') else location,
                'online': bool(re.search(r'\bonline\b|\bvirtual\b|webinar|zoom|teams', f'{title} {location}', re.I)),
                'organizer': organizer,
                'url': link.rstrip('.,)') if link else page,
                'source': source,
                'category': categorize(title, organizer),
            })
    return out


HOUSING_WORDS = re.compile(r'housing|affordab|homeless|rental|renter|tenant|landlord|zoning|land use|'
                           r'proposition 123|prop 123|accessory dwelling|\badu\b|density', re.I)


def apa_colorado_keep(title: str, desc: str) -> bool:
    """APA Colorado's calendar lists all planning events; keep housing items and the state conference."""
    return bool(HOUSING_WORDS.search(title) or re.search(r'colorado planning conference', title, re.I))


# ── Federal Reserve FOMC meetings ──────────────────────────────────────────

def parse_fomc(page: str) -> list[dict]:
    """The FOMC's scheduled meetings from federalreserve.gov/monetarypolicy/fomccalendars.htm.

    Each year's panel lists month and day range ("27-28", "Oct/Nov" "31-1");
    "*" marks a meeting with a Summary of Economic Projections. The rate
    decision is announced on the last day.
    """
    if 'FOMC Meetings' not in (page or '') or 'fomc-meeting__date' not in page:
        raise ValueError('FOMC calendar not found on the page')
    out = []
    for year, panel in re.findall(r'(\d{4}) FOMC Meetings</a>(.*?)(?=\d{4} FOMC Meetings</a>|$)', page, re.S):
        for mon, days in re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?'
                                    r'fomc-meeting__date[^>]*>([^<]+)<', panel, re.S):
            months = [m.strip().lower()[:3] for m in mon.split('/')]
            nums = re.findall(r'\d+', days)
            if not nums:
                continue
            abbrev = {k[:3]: v for k, v in MONTHS.items()}
            if any(m not in abbrev for m in months):
                continue
            y = int(year)
            first = date(y, abbrev[months[0]], int(nums[0]))
            last = date(y, abbrev[months[-1]], int(nums[-1]))
            sep = '*' in days
            out.append({
                'title': 'Federal Reserve rate decision (FOMC meeting'
                         + (', with economic projections)' if sep else ')'),
                'start': first.isoformat(),
                'end': last.isoformat() if last != first else None,
                'time': None,
                'location': None,
                'online': False,
                'organizer': 'Federal Reserve',
                'url': FOMC_PAGE,
                'source': 'fomc',
                'category': 'release',
            })
    if not out:
        raise ValueError('no FOMC meetings parsed')
    return out


# ── Census ACS release schedule ────────────────────────────────────────────

def parse_acs_schedule(page: str, data_year: int, url: str) -> list[dict]:
    """Planned release dates on the ACS "<year> Data Release Schedule" page.

    The table puts a date (or TBD) above each release ("1-Year Data Release:",
    "5-Year Data Release:"). Only rows with a real date are kept.
    """
    if 'Data Release Schedule' not in (page or ''):
        raise ValueError('ACS release schedule not found on the page')
    text = re.sub(r'(?s)<(script|style|nav|header|footer)[^>]*>.*?</\1>', ' ', page)
    text = clean(re.sub(r'<[^>]+>', ' | ', text))
    out = []
    for m in re.finditer(r'([A-Z][a-z]+ \d{1,2}, \d{4})\s*\|[\s|\d]*?((?:1|5)-Year[^|:]*?Release):', text):
        day = _parse_long_date(m.group(1))
        if not day:
            continue
        what = m.group(2).replace(' Data Release', ' estimates').strip()
        out.append({
            'title': f'Census ACS {data_year} {what} released',
            'start': day,
            'end': None,
            'time': None,
            'location': None,
            'online': True,
            'organizer': 'U.S. Census Bureau',
            'url': url,
            'source': 'acs',
            'category': 'release',
        })
    return out


# ── FRED release calendar (CPI, jobs, housing starts) ──────────────────────

def read_fred(fetch, today: date, api_key: str) -> list[dict]:
    out = []
    for series, agency, label in FRED_SERIES:
        rel = json.loads(fetch(f'{FRED_API}/series/release?series_id={series}&api_key={api_key}&file_type=json'))
        releases = rel.get('releases') or []
        if not releases:
            raise ValueError(f'FRED lists no release for {series}')
        rid = releases[0]['id']
        dates = json.loads(fetch(
            f'{FRED_API}/release/dates?release_id={rid}&api_key={api_key}&file_type=json'
            f'&include_release_dates_with_no_data=true&sort_order=asc'
            f'&realtime_start={today.isoformat()}&realtime_end=9999-12-31'))
        for row in dates.get('release_dates') or []:
            d = _iso_day(row.get('date') or '')
            if not d or d < today.isoformat():
                continue
            out.append({
                'title': f'{label} released',
                'start': d,
                'end': None,
                'time': None,
                'location': None,
                'online': True,
                'organizer': agency,
                'url': releases[0].get('link') or f'https://fred.stlouisfed.org/release?rid={rid}',
                'source': 'fred',
                'category': 'release',
            })
    return out


def load_curated(path: Path = CURATED_FILE) -> list[dict]:
    doc = json.loads(path.read_text(encoding='utf-8'))
    out = []
    for e in doc.get('events') or []:
        checked = e.get('checked') or {}
        if not (checked.get('date') and checked.get('source_url') and checked.get('quote')):
            raise ValueError(f'curated event {e.get("title")!r} has no source, check date and quote')
        if e.get('category') not in CATEGORIES:
            raise ValueError(f'curated event {e.get("title")!r} has unknown category {e.get("category")!r}')
        out.append({
            'title': e['title'],
            'start': e['start'],
            'end': e.get('end'),
            'time': e.get('time'),
            'location': e.get('location'),
            'online': bool(e.get('online')),
            'organizer': e['organizer'],
            'url': e['url'],
            'source': 'curated',
            'category': e['category'],
            'checked': checked['date'],
        })
    return out


def upcoming(events: list[dict], today: date, horizon_days: int = HORIZON_DAYS) -> list[dict]:
    """Events not yet over and starting within the horizon, soonest first, once each."""
    first, last = today.isoformat(), (today + timedelta(days=horizon_days)).isoformat()
    seen, out = set(), []
    for e in sorted(events, key=lambda x: (x['start'], x.get('time') or '', x['title'])):
        if (e.get('end') or e['start']) < first or e['start'] > last:
            continue
        key = _key(e)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _key(e: dict) -> tuple:
    return (e['organizer'], re.sub(r'\W+', ' ', e['title'].lower()).strip(), e['start'])


def past(events: list[dict], previous: dict | None, today: date, past_days: int = PAST_DAYS) -> list[dict]:
    """Events that have ended within past_days, newest first, once each.

    `events` are what the sources list today; `previous` is yesterday's file,
    whose upcoming events that have since ended, and whose past list, carry
    forward. Today's listing wins over a carried-forward copy of one event.
    """
    first, today_iso = (today - timedelta(days=past_days)).isoformat(), today.isoformat()
    prev = previous if isinstance(previous, dict) else {}
    carried = [e for e in (prev.get('events') or []) + (prev.get('past') or [])
               if isinstance(e, dict) and e.get('title') and e.get('start') and e.get('organizer')]
    seen, out = set(), []
    for e in list(events) + carried:
        ended = e.get('end') or e['start']
        if ended >= today_iso or ended < first:
            continue
        k = _key(e)
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return sorted(out, key=lambda x: (x.get('end') or x['start'], x['start'], x.get('time') or '', x['title']),
                  reverse=True)


def load_previous(path: Path = OUT_FILE) -> dict | None:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def build(today: date, offline: bool = False, fetch=http_get, previous: dict | None = None,
          fred_key: str | None = None) -> dict:
    events: list[dict] = []
    sources = []
    text = lambda raw: raw.decode('utf-8', 'replace')
    acs_year = today.year - 1
    acs_url = ACS_SCHEDULE_PAGE.format(year=acs_year)
    readers = [
        ('chfa', 'CHFA events and chfareach calendar', CHFA_PAGE,
         lambda: parse_chfa(json.loads(fetch(CHFA_FEED)))),
        ('housing_colorado', 'Housing Colorado upcoming events', HC_PAGE,
         lambda: parse_housing_colorado(text(fetch(HC_PAGE)))),
        ('doh', 'Colorado Division of Housing (DOLA) public calendar', DOLA_CALENDAR_PAGE,
         lambda: parse_ics(text(fetch(GCAL_ICS.format(id=DOH_CALENDAR))), 'Colorado Division of Housing',
                           'doh', DOLA_CALENDAR_PAGE, today)),
        ('prop123', 'Proposition 123 public calendar (DOLA)', DOLA_CALENDAR_PAGE,
         lambda: parse_ics(text(fetch(GCAL_ICS.format(id=PROP123_CALENDAR))), 'DOLA Proposition 123',
                           'prop123', DOLA_CALENDAR_PAGE, today)),
        ('apa_colorado', 'APA Colorado event calendar (housing items)', APA_CO_PAGE,
         lambda: parse_ics(text(fetch(GCAL_ICS.format(id=APA_CO_CALENDAR))), 'APA Colorado',
                           'apa_colorado', APA_CO_PAGE, today, keep=apa_colorado_keep)),
        ('fomc', 'Federal Reserve FOMC meeting calendar', FOMC_PAGE,
         lambda: parse_fomc(text(fetch(FOMC_PAGE)))),
        ('acs', f'Census Bureau ACS {acs_year} release schedule', acs_url,
         lambda: parse_acs_schedule(text(fetch(acs_url)), acs_year, acs_url)),
        ('fred', 'FRED release calendar: CPI, jobs report, housing starts', FRED_CALENDAR_PAGE,
         (lambda: read_fred(fetch, today, fred_key)) if fred_key else None),
    ]
    for sid, name, page, read in readers:
        entry = {'id': sid, 'name': name, 'url': page}
        if offline:
            entry.update(status='not_fetched', note='Offline run: this source was not read.')
        elif read is None:
            entry.update(status='not_fetched', note='No FRED_API_KEY in this run.')
        else:
            try:
                found = read()
                events.extend(found)
                entry.update(status='ok', listed=len(found))
            except Exception as exc:  # network, HTTP or parse: the source contributes nothing
                note = f'{type(exc).__name__}: {str(exc)[:160]}'
                if fred_key:
                    note = note.replace(fred_key, '***')
                entry.update(status='unreachable', note=note)
        sources.append(entry)
    curated = load_curated()
    events.extend(curated)
    sources.append({'id': 'curated', 'name': 'Events checked by hand', 'url': None,
                    'status': 'ok', 'listed': len(curated)})
    shown = upcoming(events, today)
    ended = past(events, previous, today)
    for s in sources:
        s['upcoming'] = sum(1 for e in shown if e['source'] == s['id'])
    return {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'as_of': today.isoformat(),
            'horizon_days': HORIZON_DAYS,
            'past_days': PAST_DAYS,
            'categories': CATEGORIES,
            'method': ('Read daily from CHFA\'s calendar feed, Housing Colorado\'s events page, '
                       'DOLA\'s Division of Housing and Proposition 123 public calendars, APA Colorado\'s '
                       'event calendar (housing items), the Federal Reserve\'s FOMC calendar, the Census '
                       'Bureau\'s ACS release schedule and FRED\'s release calendar, '
                       'plus events checked by hand in data/policy/housing-events-curated.json. '
                       'Ended events move to `past` and are kept for a year. A source that cannot be '
                       'read contributes nothing and is marked unreachable; its earlier upcoming '
                       'events are not kept.'),
        },
        'sources': sources,
        'events': shown,
        'past': ended,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='skip the network; curated events only')
    ap.add_argument('--today', help='YYYY-MM-DD (tests)')
    args = ap.parse_args()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    doc = build(today, offline=args.offline, previous=load_previous(),
                fred_key=os.environ.get('FRED_API_KEY') or None)
    OUT_FILE.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for s in doc['sources']:
        print(f"  {s['id']:<17} {s['status']:<12} {s.get('upcoming', 0)} upcoming"
              + (f" — {s['note']}" if s.get('note') else ''))
    print(f'✓ {len(doc["events"])} upcoming and {len(doc["past"])} past events → {OUT_FILE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
