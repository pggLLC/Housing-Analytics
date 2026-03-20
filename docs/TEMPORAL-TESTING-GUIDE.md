# Temporal Testing Guide

This guide documents best practices for writing temporal tests in the Housing
Analytics test suite, particularly for FRED (Federal Reserve Economic Data)
series validation. Following these patterns prevents brittle, date-hardcoded
tests that break predictably as time advances.

---

## Background

The `tests/test_stage2_temporal.py` suite validates FRED time-series data,
CAR market reports, DOLA projections, and LIHTC temporal coverage. A recurring
class of failures was caused by tests checking for **specific dates** in the
data (e.g. `assert '2025-10-01' in dates`). These tests fail as soon as FRED
publishes new data or when the pipeline has a brief lag.

---

## Anti-Patterns to Avoid

### ❌ Hard-coded date assertion

```python
def test_cpiaucsl_has_oct_2025(self, fred_series):
    """CPIAUCSL must include October 2025 observation (interpolated)."""
    obs = fred_series['CPIAUCSL']['observations']
    dates = {o['date'] for o in obs}
    assert '2025-10-01' in dates, 'CPIAUCSL missing 2025-10-01'
```

**Why it fails:** The test passes only when that exact date is present. It
breaks if FRED never publishes that month, if there is a pipeline lag, or once
a subsequent fetch overwrites the interpolated value.

---

## Recommended Patterns

### ✅ Recency check (≤ N days old)

Test that the **most recent** observation is within an acceptable age window:

```python
from datetime import datetime, timedelta

MAX_AGE_DAYS = 60

def test_monthly_series_have_recent_data(self, fred_series):
    """Each core monthly FRED series must have an observation within the last 60 days."""
    cutoff = datetime.utcnow() - timedelta(days=MAX_AGE_DAYS)
    for series_id in ['CPIAUCSL', 'CUUR0000SAH1', 'UNRATE', 'CIVPART']:
        obs = fred_series.get(series_id, {}).get('observations', [])
        assert obs, f'{series_id}: has no observations'
        latest_date_str = max(o['date'] for o in obs)
        latest = datetime.fromisoformat(latest_date_str)
        assert latest >= cutoff, (
            f'{series_id}: latest observation is {latest_date_str}, '
            f'more than {MAX_AGE_DAYS} days old'
        )
```

### ✅ Internal gap detection (no gap > 35 days)

Check that consecutive data points do not have an unexpected gap between them.
This catches missing months without depending on specific dates:

```python
from datetime import date

def test_monthly_series_no_internal_gaps(self, fred_series):
    """Core monthly FRED series must have no internal gaps > 35 days."""
    for series_id in ['CPIAUCSL', 'UNRATE', 'PAYEMS', 'CIVPART']:
        obs = fred_series.get(series_id, {}).get('observations', [])
        assert obs, f'{series_id}: has no observations'
        dates = sorted(date.fromisoformat(o['date']) for o in obs)
        for i in range(1, len(dates)):
            gap = (dates[i] - dates[i - 1]).days
            assert gap <= 35, (
                f'{series_id}: internal gap of {gap} days between '
                f'{dates[i-1]} and {dates[i]}'
            )
```

### ✅ Conditional skip for unavailable series

When a data series may be legitimately absent from the FRED API (discontinued,
rate-limited, etc.), skip the test rather than failing hard:

```python
def test_commodity_series_have_min_24_obs_if_present(self, fred_series):
    """Commodity PPI series must have ≥ 24 observations when data is available."""
    for series_id in COMMODITY_SERIES:
        obs = fred_series.get(series_id, {}).get('observations', [])
        if not obs:
            continue  # series unavailable from FRED; handled by monitoring
        assert len(obs) >= 24, (
            f'{series_id}: expected ≥24 observations, got {len(obs)}'
        )
```

---

## Data Currency UI Requirements

Each FRED data card displayed on a dashboard must expose data freshness to
users. Two mechanisms are required:

1. **`data-currency` HTML attribute** on the card container, set to the ISO
   date of the most recent observation (e.g. `data-currency="2026-02-01"`).
2. **`.meta-currency` element** inside the card containing human-readable text
   such as `"As of Feb 1, 2026"`.

### Example card structure

```html
<!-- BEFORE (no currency display) -->
<div class="card metric">
  <h3>CPI: All Items</h3>
  <canvas id="ch-CPIAUCSL" role="img" aria-label="CPI chart"></canvas>
</div>

<!-- AFTER (with currency display) -->
<div class="card metric" data-currency="2026-02-01">
  <h3>CPI: All Items</h3>
  <span class="meta-currency">As of Feb 1, 2026</span>
  <canvas id="ch-CPIAUCSL" role="img" aria-label="CPI chart"></canvas>
</div>
```

### JavaScript helper

`js/temporal-dashboard.js` exposes a helper to apply currency labels
programmatically after data loads:

```javascript
// After fetching series data:
const latestDate = series[series.length - 1].date; // e.g. "2026-02-01"
TemporalDashboard.applyCurrencyLabel(cardElement, latestDate);
```

---

## Testing UI Currency

Add assertions in `TestFredDataCurrencyUI` (in `test_stage2_temporal.py`) to
verify that dashboard HTML files contain the required hooks:

```python
def test_economic_dashboard_has_meta_currency_class(self):
    with open('economic-dashboard.html') as f:
        html = f.read()
    assert 'meta-currency' in html

def test_economic_dashboard_has_data_currency_attr(self):
    with open('economic-dashboard.html') as f:
        html = f.read()
    assert 'data-currency' in html
```

---

## Interpolating Missing Months

When FRED has a gap (e.g. a month is skipped due to a publication delay), use
the script `scripts/fix_fred_oct_gap.py` as a template for linear interpolation:

```python
# Linear midpoint between adjacent months
oct_val = (sept_val + nov_val) / 2.0
oct_obs = {'date': '2025-10-01', 'value': str(round(oct_val, 3))}
```

Run this script **after** the regular FRED data fetch, not before. The workflow
`fetch-fred-data.yml` should call it as a post-processing step whenever a gap
is detected.

---

## Governance Rules Reference

| Rule | Description |
|------|-------------|
| Rule 6 | FRED series must have a non-empty `name` field and at least one observation |
| Rule 7 | Monthly FRED series must have no gaps > 35 days |
| Rule 18 | `fred-data.json` must preserve the top-level `updated` key |

See `custom_instruction` / `CHANGELOG.md` for full rule descriptions.
