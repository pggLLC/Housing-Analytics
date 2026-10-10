# `scripts/audit/equity-pricing-watch.mjs`

## Symbols

### `dueReminder(bench, todayDenver, markers = new Set()`

Pure: the reminder issue due today for the benchmark's next vintage, or null.

### `findMonitorUrl(html)`

Pure: the newest monitor PDF linked from the Tax Credit Advisor home page.

### `driftFinding(bench, monitor, url, markers = new Set()`

Pure: a drift issue when the monitor sits outside the benchmark's national range, or null.

### `candidateMonitorUrls(todayIso)`

Pure: likely monitor URLs around a date, newest first. Each edition is named
for a month and uploaded in the month before (the October 2026 monitor sits
under uploads/2026/09/). Used when the home page cannot be read: Tax Credit
Advisor answers GitHub-hosted runners with HTTP 403.

### `unreachableIssue(todayIso, tried, markers = new Set()`

Pure: the issue that says the cross-check could not run this month, or null if already open.
