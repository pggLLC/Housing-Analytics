# CAR Data Process Guide

This guide explains how to obtain Colorado Association of REALTORS (CAR) market data and add it to the Housing Analytics site each month.

---

## Where to Find CAR Data

1. Navigate to **https://coloradorealtors.com/market-trends/**
2. Download the current month's **Market Trends Report** (PDF or online dashboard).
3. Find the statewide summary table, which typically includes:
   - **Median Sale Price** — statewide residential
   - **Active Listings** — total active inventory
   - **Median Days on Market** — how long homes sit before sale
   - **Median Price per Sq Ft** — $/sqft for closed sales

---

## Required Fields

When triggering the workflow, you will need these four statewide values:

| Field | Description | Example |
|-------|-------------|---------|
| `medianPrice` | Statewide median sale price (dollars) | `550000` |
| `inventory` | Total active listings | `18500` |
| `daysOnMarket` | Median days on market | `42` |
| `pricePerSqFt` | Median price per square foot | `265` |

---

## How to Trigger the GitHub Workflow

1. Go to the **Housing-Analytics** GitHub repository.
2. Click **Actions** in the top navigation bar.
3. Find **Update CAR Market Data** in the left sidebar.
4. Click **Run workflow** (right side).
5. Fill in the form:
   - **month**: Enter the report month in `YYYY-MM` format (e.g., `2026-02`). Leave blank to use the current month.
   - **medianPrice**: Enter the statewide median sale price (digits only, no commas or `$`).
   - **inventory**: Enter the active listings count.
   - **daysOnMarket**: Enter the median days on market.
   - **pricePerSqFt**: Enter the median price per square foot.
6. Click **Run workflow** (green button).
7. Wait ~30 seconds for the workflow to complete.
8. Verify the new file appears in `data/car-market-report-YYYY-MM.json`.

---

## Validation Checklist

Before triggering the workflow, verify:

- [ ] You are using the **current month's** published report (not a preliminary estimate).
- [ ] The `medianPrice` value is the **statewide** (all Colorado) figure, not metro-specific.
- [ ] All numeric inputs contain **digits only** — no commas, dollar signs, or percent symbols.
- [ ] The `month` field uses `YYYY-MM` format (e.g., `2026-02`, not `Feb 2026`).
- [ ] You have write access to the repository Actions (collaborator or organization member).

---

## Output File Format

The workflow creates `data/car-market-report-YYYY-MM.json` with the following structure:

```json
{
  "month": "2026-02",
  "generated_at": "2026-02-23T03:00:00Z",
  "source": "Colorado Association of REALTORS (CAR)",
  "source_url": "https://coloradorealtors.com/market-trends/",
  "version": "1.0",
  "statewide": {
    "median_sale_price": 550000,
    "active_listings": 18500,
    "median_days_on_market": 42,
    "median_price_per_sqft": 265
  },
  "metro_areas": {
    "denver": { "name": "Denver Metro", "median_sale_price": null, ... },
    "colorado_springs": { ... },
    ...
  },
  "notes": "..."
}
```

Metro-level fields are `null` when entered via the workflow. To add metro data, either edit the JSON file directly or extend the workflow inputs.

---

## Adding Metro-Level Data Manually

After the workflow runs, you may manually edit the generated JSON to add metro-level data:

1. Open `data/car-market-report-YYYY-MM.json` in the GitHub web editor.
2. Fill in `null` values in `metro_areas` with figures from the CAR report.
3. Commit the change with message: `chore: add metro CAR data YYYY-MM`.

---

## Historical Data Location

All past CAR reports are stored in `data/` as `car-market-report-YYYY-MM.json`.  
The frontend (`js/housing-data-integration.js`) automatically loads the most recent file (searches the last 6 months).

---

## Monthly Schedule

| When | Action |
|------|--------|
| ~5th of each month | CAR publishes the prior month's report |
| Within 3 business days | Team member triggers the workflow with new data |
| Immediately after workflow | New JSON available on site |

---

## Template

Use `scripts/car-data-template.json` as a reference for all available fields when manually constructing a report file.
