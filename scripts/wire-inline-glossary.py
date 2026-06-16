#!/usr/bin/env python3
"""
scripts/wire-inline-glossary.py
=============================================================================
Add inline-glossary auto-decoration to every top-level HTML page in the repo.

Specifically, for each *.html file at the repo root that lacks the wiring:
  1. Inject `<script defer src="js/components/inline-glossary.js"></script>`
     just before the closing </head> tag.
  2. Add `class="js-glossary-auto"` to the <main> tag if present; otherwise
     to the <body> tag, so the auto-decorator wraps the first occurrence of
     each known acronym on that page.

Idempotent: skips files that already have both bits wired.

Opt-out: pages with `<body data-inline-glossary="off">` are honored by the
component itself.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT_TAG = '<script defer src="js/components/inline-glossary.js"></script>'

# Pages we intentionally skip — they don't render body prose that benefits
# from inline glossary wrapping.
SKIP_PAGES = {
    "indibuild-brief.html",  # dev-gated page
    "data-explorer.html",    # data viewer; no body prose
    "data-map-browser.html", # ditto
    "data-status.html",      # data freshness dashboard
    "dashboard-data-quality.html",
    "dashboard-data-sources-ui.html",
    "data-review-hub.html",
    "console-error-audit",
}


def wire(html_path: Path) -> tuple[bool, list[str]]:
    """Returns (changed, list-of-actions)."""
    src = html_path.read_text(encoding="utf-8")
    actions: list[str] = []
    changed = False

    # Step 1: add the script tag if missing.
    if "inline-glossary.js" not in src:
        head_close = re.search(r"</head>", src, re.IGNORECASE)
        if not head_close:
            return False, ["no </head> — skipped"]
        insert_at = head_close.start()
        src = src[:insert_at] + "  " + SCRIPT_TAG + "\n" + src[insert_at:]
        actions.append("added <script>")
        changed = True

    # Step 2: add `class="js-glossary-auto"` to <main> if present,
    # else to <body>. Skip if already present.
    if "js-glossary-auto" not in src:
        # Prefer <main> over <body> — narrower scope, avoids navigation chrome.
        main_tag = re.search(r"<main\b([^>]*)>", src, re.IGNORECASE)
        if main_tag:
            attrs = main_tag.group(1)
            if "class=" in attrs:
                new_attrs = re.sub(
                    r'class=("|\')([^"\']*)("|\')',
                    lambda m: f'class={m.group(1)}{m.group(2)} js-glossary-auto{m.group(3)}',
                    attrs, count=1,
                )
            else:
                new_attrs = attrs + ' class="js-glossary-auto"'
            new_main_open = f"<main{new_attrs}>"
            src = src[:main_tag.start()] + new_main_open + src[main_tag.end():]
            actions.append("added class to <main>")
            changed = True
        else:
            body_tag = re.search(r"<body\b([^>]*)>", src, re.IGNORECASE)
            if body_tag:
                attrs = body_tag.group(1)
                if "class=" in attrs:
                    new_attrs = re.sub(
                        r'class=("|\')([^"\']*)("|\')',
                        lambda m: f'class={m.group(1)}{m.group(2)} js-glossary-auto{m.group(3)}',
                        attrs, count=1,
                    )
                else:
                    new_attrs = attrs + ' class="js-glossary-auto"'
                new_body_open = f"<body{new_attrs}>"
                src = src[:body_tag.start()] + new_body_open + src[body_tag.end():]
                actions.append("added class to <body>")
                changed = True
            else:
                actions.append("no <main>/<body> — class not added")

    if changed:
        html_path.write_text(src, encoding="utf-8")
    return changed, actions


def main() -> None:
    pages = sorted(ROOT.glob("*.html"))
    changed_count = 0
    skipped_count = 0
    for p in pages:
        if p.name in SKIP_PAGES:
            print(f"  skip      {p.name}")
            skipped_count += 1
            continue
        changed, actions = wire(p)
        marker = "CHANGED " if changed else "ok      "
        print(f"  {marker}  {p.name:40s}  {', '.join(actions) or 'already wired'}")
        if changed:
            changed_count += 1
    print(f"\nDone. {changed_count} files changed, {skipped_count} skipped.")


if __name__ == "__main__":
    main()
