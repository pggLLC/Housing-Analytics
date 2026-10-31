#!/usr/bin/env python3
"""
scripts/news/outlets.py

Who published a Housing News headline, and how far to trust it.

Every publisher is looked up in data/alerts/outlet-register.json, by the web
address the feed gives (`source_domain`) or, for older items that only carry a
display name, by that name. The register's tiers come down to three outcomes:

  checked     newsroom, trade press, research centre or government source:
              shown with no tag.
  weak        shown with a "Weak sourcing" tag and the reason (an AI-written
              outlet, politicians' posts, a press-release wire, a partisan
              outlet...).
  blocked     a documented imposter local-news site: left out.

Anything not in the register is `unverified`: shown with an "Unverified
outlet" tag (paul, 2026-10-31: "Show unverified tab, and create weekly
review"). Ticks in the "Outlets to review" issue (outlet_review.py) are kept in
data/alerts/outlet-decisions.json and override the register.

Why the web address: a display name is whatever a site calls itself. Metric
Media runs "Denver City Wire" and "Boulder Leader", names chosen to read as
local papers (NPR, 2026-10-30, on the same tactic from the other side). A name
that matches a register entry whose web addresses are known, while the feed
reports a different address, is treated as unverified, not as the outlet it
claims to be.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTER_FILE = ROOT / 'data' / 'alerts' / 'outlet-register.json'
DECISIONS_FILE = ROOT / 'data' / 'alerts' / 'outlet-decisions.json'

CHECKED_TIERS = {'newsroom', 'trade', 'research', 'primary'}
STATUSES = ('checked', 'weak', 'blocked', 'unverified')
UNVERIFIED = {'status': 'unverified', 'label': 'Unverified outlet', 'tier': ''}


def norm_name(name: str) -> str:
    """'Rocky Mountain Voice -' and 'rocky mountain voice' are one outlet."""
    t = re.sub(r'[​-‍﻿]', '', name or '')
    t = t.strip().strip('|-–— ').strip().lower()
    return re.sub(r'\s+', ' ', t)


def norm_domain(domain: str) -> str:
    d = (domain or '').strip().lower()
    d = re.sub(r'^https?://', '', d).split('/')[0].split(':')[0]
    return d.removeprefix('www.')


def _status(tier: str) -> str:
    if tier in CHECKED_TIERS:
        return 'checked'
    return tier if tier in ('weak', 'blocked') else 'unverified'


class Register:
    def __init__(self, outlets: list[dict], decisions: list[dict] | None = None):
        self.by_name: dict[str, dict] = {}
        self.by_domain: dict[str, dict] = {}
        for o in outlets:
            self._add(o)
        # A tick in the review issue outranks the seeded register.
        for d in decisions or []:
            tier = {'checked': 'newsroom'}.get(d.get('decision'), d.get('decision'))
            if tier not in CHECKED_TIERS | {'weak', 'blocked'}:
                continue
            o = {'name': d.get('name', ''), 'tier': tier, 'domains': d.get('domains') or [],
                 'label': d.get('label') or ('Marked weak in review' if tier == 'weak' else ''),
                 'note': f"Outlet review issue, {d.get('decided', '')}".strip(', ')}
            self._add(o, override=True)

    def _add(self, o: dict, override: bool = False) -> None:
        entry = {'name': o.get('name', ''), 'tier': o.get('tier', ''), 'label': o.get('label', ''),
                 'note': o.get('note', ''), 'evidence': o.get('evidence', ''),
                 'domains': [norm_domain(x) for x in o.get('domains') or [] if norm_domain(x)]}
        for n in [o.get('name', '')] + list(o.get('aliases') or []):
            k = norm_name(n)
            if k and (override or k not in self.by_name):
                self.by_name[k] = entry
        for dm in entry['domains']:
            if override or dm not in self.by_domain:
                self.by_domain[dm] = entry

    def lookup(self, source: str, domain: str = '') -> dict:
        """{'status', 'label', 'tier'} for one publisher."""
        dm = norm_domain(domain)
        entry = None
        if dm:
            entry = self.by_domain.get(dm)
            # A subdomain of a listed address ("news.example.com").
            if not entry:
                entry = next((e for d, e in self.by_domain.items() if dm.endswith('.' + d)), None)
        if not entry:
            named = self.by_name.get(norm_name(source))
            # The name is known but the feed gives another address: someone
            # else using the name. Unverified, never the outlet it claims.
            if named and dm and named['domains'] and dm not in named['domains']:
                named = None
            entry = named
        if not entry and (source or '').rstrip().endswith('(.gov)'):
            # Google News marks government sites "(.gov)".
            return {'status': 'checked', 'label': '', 'tier': 'primary'}
        if not entry and dm.endswith('.gov'):
            return {'status': 'checked', 'label': '', 'tier': 'primary'}
        if not entry:
            return dict(UNVERIFIED)
        status = _status(entry['tier'])
        label = ''
        if status == 'weak':
            label = entry['label'] or 'Weak sourcing'
        elif status == 'blocked':
            label = entry['label'] or 'Blocked outlet'
        return {'status': status, 'label': label, 'tier': entry['tier']}


def load_register(register_file: Path = REGISTER_FILE, decisions_file: Path = DECISIONS_FILE) -> Register:
    def read(p: Path):
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None
    reg = read(register_file) or {}
    dec = read(decisions_file) or {}
    return Register(reg.get('outlets') or [], dec.get('decisions') or [])
