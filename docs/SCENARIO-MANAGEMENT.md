# Scenario Management

This document explains how to create, save, load, compare, and export projection scenarios in the COHO Analytics Scenario Builder.

---

## What Is a Scenario?

A **scenario** is a named set of demographic assumptions that drives the cohort-component projection model:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `fertility_multiplier` | Multiplies baseline age-specific fertility rates | 1.0 |
| `mortality_multiplier` | Multiplies baseline life-table survival rates | 1.0 |
| `net_migration_annual` | Net persons migrating into the area per year | 500 |

---

## Built-In Scenarios

Three scenarios are pre-configured and cannot be deleted:

| Scenario | Fertility | Mortality | Migration |
|----------|-----------|-----------|-----------|
| **Baseline** (Moderate Growth) | 1.00× | 1.00× | 500/yr |
| **Low Growth** | 0.90× | 1.02× | 250/yr |
| **High Growth** | 1.05× | 0.98× | 1,000/yr |

**Data attribution:**
- Baseline parameters from DOLA Components of Change (2018–2023 county averages)
- Low Growth adjustment informed by FRED CPI shelter index (`CUUR0000SAH1`)
- High Growth adjustment informed by FRED unemployment rate (`UNRATE`)

---

## Creating a Custom Scenario

1. Open the **[Scenario Builder](../hna-scenario-builder.html)**
2. Use the **sliders** to set:
   - Fertility Rate Multiplier (0.5× – 1.5×)
   - Net Annual Migration (−500 to +2,000 persons/year)
   - Mortality Rate Multiplier (0.8× – 1.2×)
3. Enter a **name** in the "Scenario name" field
4. Click **Save as Custom Scenario**

### Storage

Custom scenarios are saved to **browser localStorage** under the key `coho_hna_scenarios`. They persist across sessions on the same browser but are **not synced** across devices or browsers.

### Storage Schema

```json
{
  "id": "custom-high-fertility-2026-abc123",
  "name": "High Fertility 2026",
  "year": 2026,
  "assumptions": {
    "fertility": "120% of baseline",
    "migration": "500 persons/year net",
    "mortality": "100% of baseline"
  },
  "parameters": {
    "fertility_multiplier": 1.2,
    "mortality_multiplier": 1.0,
    "net_migration_annual": 500
  },
  "createdAt": "2026-03-23T04:30:00Z",
  "baselineSource": "DOLA 2024"
}
```

---

## Loading a Saved Scenario

1. In the **Saved Scenarios** panel, click **Load** next to the desired scenario
2. The sliders will update to match the saved parameters
3. The chart and results table will re-run the projection automatically

---

## Comparing Scenarios

The chart on the Scenario Builder page always displays **all four curves** simultaneously:
- Baseline
- Low Growth
- High Growth
- Custom (your current slider settings)

To compare multiple custom scenarios:
1. Load the first scenario → note the results
2. Load the second scenario → the chart updates in place
3. Export both scenarios (CSV or JSON) and compare side-by-side in a spreadsheet

---

## Exporting Scenarios

### Export Saved Scenarios (JSON)

Click **Export Scenarios** to download all saved scenarios as a single JSON file.
This file can be shared with colleagues or imported into another browser session.

### Export Projection Results (CSV)

The results table can be copied manually, or use the **Download** button at the bottom of the results panel to export a CSV with all scenario columns.

---

## Importing Scenarios

To restore scenarios exported from another session:

1. Export from the source browser using **Export Scenarios**
2. In the destination browser, open the Scenario Builder
3. Click **Import Scenarios** (if available) and select the JSON file

> **Note:** Import is only available in browsers that support the File System Access API. As a fallback, paste the JSON content into the browser console:
> ```javascript
> window.ScenarioStorage.importAll(JSON.parse('{ "scenarios": [...] }'));
> ```

---

## Deleting Scenarios

Click **Delete** next to any saved scenario in the **Saved Scenarios** panel.
Deletion is permanent and cannot be undone.

To clear **all** saved scenarios:
```javascript
// Browser console
window.ScenarioStorage.clear();
```

---

## Maximum Stored Scenarios

Up to **20** custom scenarios can be saved. When the limit is reached, saving a new scenario will remove the oldest one automatically.

---

## See Also

- [Projection Methodology](PROJECTION-METHODOLOGY.md) — cohort-component model documentation
- [Data Sources](DATA-SOURCES.md) — DOLA, FRED, and ACS attribution
- [Workflow Setup](WORKFLOW-SETUP.md) — how to regenerate scenario data server-side
