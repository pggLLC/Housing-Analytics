#!/usr/bin/env python3
"""
generate_policy_briefs.py — Generate AI-assisted policy briefs from alerts and housing data.

Reads data/alerts/alerts_archive.json plus key housing datasets, then produces
structured policy brief summaries written to data/policy_briefs.json.

This script generates rule-based briefs when no LLM API is configured, and
can optionally call the OpenAI chat API (GPT-4) for richer summaries when the
OPENAI_API_KEY environment variable is set.

Usage:
    python3 scripts/generate_policy_briefs.py

Environment variables:
    OPENAI_API_KEY  — optional; enables LLM-assisted summary generation
    BRIEFS_MAX      — maximum number of briefs to generate (default: 20)

Output:
    data/policy_briefs.json
"""

from __future__ import annotations

import json
import os
import sys
import textwrap
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ALERTS_FILE = REPO_ROOT / 'data' / 'alerts' / 'alerts_archive.json'
OUT_FILE = REPO_ROOT / 'data' / 'policy_briefs.json'
BRIEFS_MAX = int(os.environ.get('BRIEFS_MAX', '20'))

# Policy topic labels
TOPIC_LABELS: dict[str, str] = {
    'affordable_housing': 'Affordable Housing',
    'rent': 'Rent & Tenants',
    'homelessness': 'Homelessness',
    'zoning': 'Zoning & Land Use',
    'market': 'Housing Market',
    'policy': 'Housing Policy',
    'construction': 'Construction & Permitting',
    'general': 'General',
}

# Datasets that may be referenced in briefs
RELATED_DATA_MAP: dict[str, str] = {
    'affordable_housing': 'data/market/hud_lihtc_co.geojson',
    'rent': 'data/market/acs_tract_metrics_co.json',
    'market': 'data/market/acs_tract_metrics_co.json',
    'zoning': 'data/policy/prop123_jurisdictions.json',
    'policy': 'data/policy/prop123_jurisdictions.json',
    'construction': 'data/market/hud_lihtc_co.geojson',
    'homelessness': 'data/market/acs_tract_metrics_co.json',
    'general': 'data/market/acs_tract_metrics_co.json',
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_json_safe(path: Path) -> dict | list | None:
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def group_alerts_by_topic(alerts: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for alert in alerts:
        topic = alert.get('topic', 'general')
        groups.setdefault(topic, []).append(alert)
    return groups


def build_rule_based_brief(topic: str, alerts: list[dict]) -> dict:
    """Generate a structured brief without LLM based on alert aggregation."""
    label = TOPIC_LABELS.get(topic, topic.replace('_', ' ').title())
    recent = sorted(alerts, key=lambda a: a.get('date') or '', reverse=True)[:5]

    titles = [a.get('title', '') for a in recent if a.get('title')]
    regions = list({a.get('region', 'Colorado') for a in recent if a.get('region')})
    sources = list({a.get('source', '') for a in recent if a.get('source')})[:5]

    summary_parts = [
        f"Recent news coverage on {label.lower()} in Colorado covers {len(alerts)} item(s).",
    ]
    if titles:
        summary_parts.append(f"Notable headlines include: {'; '.join(titles[:3])}.")
    if regions:
        summary_parts.append(f"Coverage spans: {', '.join(regions[:4])}.")

    # Build articles list with title, source, link, date for each alert
    articles = []
    for a in sorted(alerts, key=lambda x: x.get('date') or '', reverse=True):
        art = {'title': a.get('title', ''), 'source': a.get('source', '')}
        if a.get('url') or a.get('link'):
            art['link'] = a.get('url') or a['link']
        if a.get('date'):
            art['date'] = a['date'][:10]
        if art['title']:
            articles.append(art)

    return {
        'title': f'{label} Policy Brief — {datetime.now(timezone.utc).strftime("%B %Y")}',
        'policy_topic': label,
        'summary': ' '.join(summary_parts),
        'related_data': RELATED_DATA_MAP.get(topic, ''),
        'sources': sources,
        'articles': articles,
        'alert_count': len(alerts),
        'regions': regions,
        'generated': utc_now(),
    }


def generate_llm_brief(topic: str, alerts: list[dict], api_key: str) -> dict | None:
    """Attempt to generate a richer brief using the OpenAI API."""
    label = TOPIC_LABELS.get(topic, topic.replace('_', ' ').title())
    recent = sorted(alerts, key=lambda a: a.get('date') or '', reverse=True)[:10]
    headlines = '\n'.join(
        f"- {a.get('date','')[:10]} | {a.get('source','')}: {a.get('title','')}"
        for a in recent if a.get('title')
    )

    prompt = textwrap.dedent(f"""
        You are a housing policy analyst. Based on the following recent news headlines about
        {label} in Colorado, write a concise policy brief with these fields:
        - title (one sentence)
        - summary (2-3 sentences)
        - implications (2-3 sentences, actionable)

        Recent headlines:
        {headlines}

        Respond in JSON with keys: title, summary, implications
    """).strip()

    payload = json.dumps({
        'model': 'gpt-4o-mini',
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 400,
        'temperature': 0.3,
    }).encode()

    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        content = result['choices'][0]['message']['content']
        # Parse JSON from LLM response — strip markdown code fences if present.
        # GPT models often wrap output in ```json ... ``` blocks.
        stripped = content.strip()
        lines = stripped.splitlines()
        if lines and lines[0].rstrip() in ('```', '```json'):
            # Remove opening fence line; remove trailing closing fence line if present
            inner = lines[1:]
            if inner and inner[-1].strip() == '```':
                inner = inner[:-1]
            stripped = '\n'.join(inner).strip()
        llm_data = json.loads(stripped)
        sources = list({a.get('source', '') for a in recent if a.get('source')})[:5]
        regions = list({a.get('region', 'Colorado') for a in recent if a.get('region')})
        articles = []
        for a in sorted(alerts, key=lambda x: x.get('date') or '', reverse=True):
            art = {'title': a.get('title', ''), 'source': a.get('source', '')}
            if a.get('url') or a.get('link'):
                art['link'] = a.get('url') or a['link']
            if a.get('date'):
                art['date'] = a['date'][:10]
            if art['title']:
                articles.append(art)
        return {
            'title': llm_data.get('title', ''),
            'policy_topic': label,
            'summary': llm_data.get('summary', ''),
            'implications': llm_data.get('implications', ''),
            'related_data': RELATED_DATA_MAP.get(topic, ''),
            'sources': sources,
            'articles': articles,
            'alert_count': len(alerts),
            'regions': regions,
            'generated': utc_now(),
        }
    except Exception as exc:
        print(f'  ⚠ LLM brief generation failed for {topic}: {exc}', file=sys.stderr)
        return None


def main() -> int:
    api_key = os.environ.get('OPENAI_API_KEY', '').strip()

    # Load alerts
    alerts_data = load_json_safe(ALERTS_FILE)
    alerts: list[dict] = []
    if alerts_data and isinstance(alerts_data, dict):
        alerts = alerts_data.get('alerts', [])
    elif isinstance(alerts_data, list):
        alerts = alerts_data

    if not alerts:
        print('ℹ No alerts found. Run fetch_google_alerts.py first.', file=sys.stderr)

    print(f'Generating policy briefs from {len(alerts)} alert(s)…')
    groups = group_alerts_by_topic(alerts)

    # Sort topics by alert count (most active topics first)
    sorted_topics = sorted(groups.items(), key=lambda kv: len(kv[1]), reverse=True)

    briefs = []
    llm_used = False
    for topic, topic_alerts in sorted_topics[:BRIEFS_MAX]:
        print(f'  Topic: {topic} ({len(topic_alerts)} alerts)')
        brief = None
        if api_key:
            brief = generate_llm_brief(topic, topic_alerts, api_key)
            if brief is not None:
                llm_used = True
        if brief is None:
            brief = build_rule_based_brief(topic, topic_alerts)
        briefs.append(brief)

    if api_key:
        print(f'  OPENAI_API_KEY present; LLM mode: {"active" if llm_used else "fell back to rule-based"}')
    else:
        print('  OPENAI_API_KEY not set — using rule-based mode')

    output = {
        'meta': {
            'generated': utc_now(),
            'brief_count': len(briefs),
            'source_alerts': len(alerts),
            'methodology': (
                'Policy briefs generated using GPT-4o-mini (LLM-assisted mode).'
                if llm_used else
                'Policy briefs generated using rule-based headline aggregation. '
                'Set OPENAI_API_KEY to enable LLM-assisted summaries.'
            ),
        },
        'briefs': briefs,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'✓ Wrote {len(briefs)} brief(s) to {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
