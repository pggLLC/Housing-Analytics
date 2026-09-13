#!/usr/bin/env python3
"""
scripts/check-place-chas-shares.py

Every published share in data/hna/place-chas.json must be exactly what its own
published count over its own published total gives. This is a reproducibility
guard first and a correctness guard second, and the reproducibility half is
what kept breaking the repo.

recompute_summary() in scripts/hna/build_place_chas.py used to publish each
count rounded to 1dp but compute the share by dividing the RAW accumulators.
Those accumulators are sums of floats: summing 0802905's tiers gives
16.000000000000004, not 16. Five of these shares sit on an EXACT .00005
rounding tie -- 9.3/48, 104.7/240, 177.5/400, 6.9/16 and 11.4/32 all do -- and
at a tie a one-ulp wobble in the denominator flips the fourth decimal.

The consequence was not subtle. check-place-chas-fresh.py rebuilds the file and
diffs it, so it reported place-chas.json STALE on five places whose inputs had
not changed since May. main went red twice in one day and every open PR failed
on data it never touched -- the exact failure mode that guard exists to prevent.

The second half matters on its own: the file shipped 6.9, 16 and 0.4312
together, and 6.9 / 16 is 0.4313. A reader checking the arithmetic on a site
about housing data honesty found it did not add up.

Written in Python ON PURPOSE. An earlier draft of this guard was a Node test
that reimplemented the rounding as Math.round(n * 1e4) / 1e4 -- which is
half-up, while Python's round() is half-to-even on the exact double -- and it
reported three false failures on its first run. A guard for a rounding bug must
use the same rounding as the code it guards, not a lookalike.
"""
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(REPO_ROOT, 'data', 'hna', 'place-chas.json')
BUILDER = os.path.join(REPO_ROOT, 'scripts', 'hna', 'build_place_chas.py')

PAIRS = [
    ('renter_cb30_count', 'total_renter_hh', 'renter_cb30_share'),
    ('renter_cb50_count', 'total_renter_hh', 'renter_cb50_share'),
    ('owner_cb30_count',  'total_owner_hh',  'owner_cb30_share'),
    ('owner_cb50_count',  'total_owner_hh',  'owner_cb50_share'),
]

# The exact values that flipped. Each is a .00005 tie, so they are the canaries:
# if a denominator ever carries float noise again, these move first.
# Note the expectations are Python's own round() results, recorded rather than
# reasoned about. Half of them do not match naive half-up rounding: 177.5/400
# is 0.44375 in decimal but its nearest double sits just below the tie, so
# round() gives 0.4437, not 0.4438. That asymmetry is exactly why this guard
# must not model the rounding -- only observe it.
TIE_CASES = [(9.3, 48, 0.1938), (104.7, 240, 0.4363), (177.5, 400, 0.4437),
             (6.9, 16, 0.4313), (11.4, 32, 0.3563)]

# Dividing any of these raw accumulators is the bug returning.
FORBIDDEN = ['round(cr30 / tr, 4)', 'round(cr50 / tr, 4)',
             'round(co30 / to, 4)', 'round(co50 / to, 4)']


def main() -> int:
    failures = []

    with open(TARGET, encoding='utf-8') as fh:
        doc = json.load(fh)
    places = doc.get('places', doc)

    checked = 0
    bad = []
    for geoid, rec in places.items():
        summary = (rec or {}).get('summary')
        if not summary:
            continue
        for count_key, total_key, share_key in PAIRS:
            total = summary.get(total_key)
            if not total:
                continue  # a zero denominator publishes 0.0 by design
            checked += 1
            expected = round(summary[count_key] / total, 4)
            if expected != summary[share_key]:
                bad.append('%s %s: published %r, but %r/%r = %r'
                           % (geoid, share_key, summary[share_key],
                              summary[count_key], total, expected))

    if checked < 900:
        failures.append('precondition: expected to check most of 482 places, got %d' % checked)
    if bad:
        failures.append('%d published shares do not reproduce from their own counts:\n    %s'
                        % (len(bad), '\n    '.join(bad[:5])))

    # Pin the mechanism, not just today's values: the data check above passes
    # for any file that happens to have nothing sitting on a tie right now.
    with open(BUILDER, encoding='utf-8') as fh:
        src = fh.read()
    for raw in FORBIDDEN:
        if raw in src:
            failures.append(
                'recompute_summary() divides a raw accumulator again (%s). Those are '
                'sums of floats (16.000000000000004, not 16); at a .00005 tie the '
                'fourth decimal flips on a one-ulp wobble and check-place-chas-fresh.py '
                'reports the file stale on inputs that never changed.' % raw)
    if "s['renter_cb30_count'] / tr_pub" not in src:
        failures.append('the share must be derived from the published count and the rounded total')

    for count, total, expected in TIE_CASES:
        got = round(count / total, 4)
        if got != expected:
            failures.append('%r/%r must round to %r deterministically, got %r'
                            % (count, total, expected, got))

    if failures:
        print('place-chas-shares: FAIL')
        for f in failures:
            print('  x ' + f)
        return 1

    print('place-chas-shares: PASS (%d share/count pairs reproduce exactly)' % checked)
    return 0


if __name__ == '__main__':
    sys.exit(main())
