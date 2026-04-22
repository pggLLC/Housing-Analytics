# `js/mobile-menu.js`

mobile-menu.js — COHO Analytics

Handles the mobile navigation drawer injected by navigation.js.
- Slide-in drawer with backdrop.
- Focus trap, aria attributes, scroll lock.
- Close on backdrop click, close button, link click, Escape.
- Returns focus to toggle button on close.

Falls back to the legacy overlay menu if the drawer elements
are not present (e.g., older page templates).

This script is self-contained and has no external dependencies.
It fires after navigation.js has injected the header.

## Symbols

### `getTransitionDuration(el)`

Return the CSS transition duration in ms (defaults to 200).
