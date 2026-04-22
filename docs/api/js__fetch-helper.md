# `js/fetch-helper.js`

js/fetch-helper.js
Provides resolveAssetUrl() and safeFetchJSON() for portable, hardened asset loading.

resolveAssetUrl(relativePath) — prepend APP_BASE_PATH so paths work regardless of
  GitHub Pages repo sub-path or custom domain.

safeFetchJSON(relativePath, options) — fetch with:
  - Stable cache-busting query param (?v=<DATA_VERSION|timestamp>)
  - Optional localStorage caching (24-hour TTL, stale-while-revalidate)
  - Retry logic (up to 3 attempts with exponential backoff)
  - Timeout (10 s per attempt)
  - Console error on failure
  - Visible red error banner inserted into the page on failure
  - Error message also written into #statusPanel if present
  - All failures appended to window.dataFetchErrors for monitoring

## Symbols

### `resolveAssetUrl(relativePath)`

Resolve a relative asset path against the detected base path.
- Absolute URLs (http/https/data) are returned unchanged.
- Root-relative paths (starting with "/") are returned unchanged.
- Relative paths (optionally prefixed with "./") have BASE prepended.

### `showErrorBanner(message)`

Show a persistent red error banner at the top of the page.
Safe to call multiple times — only one banner is created.

### `updateStatusPanel(message)`

Write a short error note into #statusPanel if it exists on the page.

### `readCache(cacheKey)`

Attempt to read a cached entry from localStorage.
Returns { stale, value } if found, or null if absent.

### `writeCache(cacheKey, data)`

Write a value into localStorage under the given cache key.

### `fetchWithTimeout(url, options, timeoutMs, maxRetries)`

Fetch a URL with an AbortController timeout and exponential backoff retry.
Unlike safeFetchJSON, this returns the raw Response (not parsed JSON) and
works for any URL (not just local assets).

@param {string} url       - URL to fetch.
@param {object} [options] - Fetch options (method, headers, cache, etc.).
@param {number} [timeoutMs=15000] - Per-attempt timeout in milliseconds.
@param {number} [maxRetries=2]    - Number of retry attempts after first failure.
@returns {Promise<Response>}      - Resolves with the fetch Response on success.

### `safeFetchJSON(relativePath, options)`

Fetch JSON from a local asset path with cache-busting, timeout, and retry.

@param {string} relativePath - Relative (or absolute) path to the JSON asset.
@param {object} [options]    - Optional fetch options (method, headers, etc.).
@returns {Promise<any>}      - Resolves with parsed JSON.
