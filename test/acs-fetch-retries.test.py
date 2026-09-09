#!/usr/bin/env python3
"""A transient Census timeout must not fail the whole HNA build.

Issue #1566. build-hna-data ran with HNA_ACS_HTTP_TIMEOUT_SECONDS=8 -- a
deliberately tight ceiling for parallel fetching -- while http_get_json passed
retries=1, which disables http_get_text's exponential backoff entirely. The log
signature was "attempt 1/1" followed by "The read operation timed out" and
"HTTP 0". A short timeout is only safe when paired with retry; otherwise a
merely slow upstream is indistinguishable from a dead one.

The guard also pins the property that makes retrying safe: statuses that will
never succeed on a repeat (400 for the fallback path, 404, and the ACS1 204
no-content case) must still return on the first attempt, so the build does not
slow down on the expected path.
"""
import importlib.util
import io
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('bhd', ROOT / 'scripts' / 'hna' / 'build_hna_data.py')
bhd = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(bhd)
except SystemExit:
    pass

# Loopback URLs only. scripts/audit/source-url-sweep.mjs probes URLs found in
# changed files -- test fixtures included -- and a non-loopback host here fails
# ci-checks with "fetch failed (confirmed on retry)". This has bitten #1202,
# #1207 and #1209. Nothing here is ever actually requested; urlopen is mocked.
passed = failed = 0
def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1; print('  ✅ PASS: ' + msg)
    else:
        failed += 1; print('  ❌ FAIL: ' + msg)

_real = urllib.request.urlopen

def count_attempts(raiser, retries):
    calls = {'n': 0}
    def fake(req, timeout=None):
        calls['n'] += 1
        raiser(req)
    urllib.request.urlopen = fake
    try:
        bhd.http_get_text('http://127.0.0.1/acs-retry-fixture', timeout=1, retries=retries)
    finally:
        urllib.request.urlopen = _real
    return calls['n']

def http(status):
    return lambda req: (_ for _ in ()).throw(
        urllib.error.HTTPError(req.full_url, status, 'x', {}, io.BytesIO(b'body')))

def timeout(req):
    raise TimeoutError('The read operation timed out')

print('[test] ACS fetch retries (issue #1566)')

# 1. The knob exists, is env-tunable, and defaults above 1.
check(hasattr(bhd, 'acs_http_retries'), 'acs_http_retries() is defined')
check(bhd.acs_http_retries() > 1,
      'default retry count is > 1 (got %s) -- retries=1 disables backoff' % bhd.acs_http_retries())
# Bounded on both sides. Retrying at all is the fix; retrying too much burns the
# job's 120-minute budget on a degraded upstream instead of failing fast and
# resuming from the phase checkpoint. See the constant's comment for the
# worst-case arithmetic behind the ceiling of 3.
check(2 <= bhd.DEFAULT_ACS_HTTP_RETRIES <= 3,
      'DEFAULT_ACS_HTTP_RETRIES is 2 or 3 (got %s) -- enough to survive a stall, '
      'not enough to exhaust the 120-min job budget' % bhd.DEFAULT_ACS_HTTP_RETRIES)

# 2. The JSON path -- the one that failed -- must not hardcode retries=1.
src = (ROOT / 'scripts' / 'hna' / 'build_hna_data.py').read_text()
check('retries=acs_http_retries()' in src,
      'http_get_json requests its retry count from acs_http_retries()')

# 3. The actual failure mode from the CI log now retries.
n = count_attempts(timeout, bhd.acs_http_retries())
check(n == bhd.acs_http_retries(),
      'a read timeout is retried %s times (got %s attempts)' % (bhd.acs_http_retries(), n))

# 4. Retryable server-side statuses retry.
for st in (408, 429, 500, 502, 503, 504):
    check(count_attempts(http(st), 3) == 3, 'HTTP %s is retried' % st)

# 5. Statuses that cannot succeed on a repeat must NOT retry -- this is what
#    keeps the build fast on the expected-no-content path.
for st in (400, 404):
    check(count_attempts(http(st), 3) == 1,
          'HTTP %s returns on the first attempt (no build slowdown)' % st)

print('\nResults: %d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
