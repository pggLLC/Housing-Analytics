# `js/dark-mode-toggle.js`

dark-mode-toggle.js — COHO Analytics

Detects the OS colour-scheme preference, allows the user to
manually override it, and persists the choice to localStorage.

Usage: include this script in any page that needs the toggle.
No external dependencies required.

## Symbols

### `getStoredPreference()`

Returns the stored preference, or null if none has been set.
@returns {'dark'|'light'|null}

### `savePreference(scheme)`

Saves the user's explicit choice.
@param {'dark'|'light'} scheme

### `systemPrefersDark()`

Returns true when the OS prefers dark mode.
@returns {boolean}

### `applyScheme(scheme, animate)`

Apply the given scheme to <html>.
@param {'dark'|'light'} scheme
@param {boolean} [animate] - Whether to trigger the transition animation (default: false)

### `toggle()`

Toggle between dark and light modes.

### `updateToggleButton(scheme)`

Update the accessible label and icon on the toggle button.
@param {'dark'|'light'} scheme

### `injectToggleButton()`

Inject the floating toggle button into the page.

Reads the current scheme from documentElement.classList and populates
the button's aria-label + text content IMMEDIATELY on creation —
rather than relying on a prior applyScheme() call. applyScheme()
fires before DOMContentLoaded (to avoid FOUC), so its
updateToggleButton() call no-ops because the button doesn't exist
yet. The button then existed on the page with no accessible name,
which axe-core flagged as button-name (critical) on 14/14 pages.
Fixing here closes those 14 violations in one place.

### `init()`

Initialise: apply correct scheme before first paint to avoid flash.
