# Scenario Management

This document explains how to create, save, load, compare, and export projection scenarios in the COHO Analytics Scenario Builder.

---

## What Is a Scenario?

A **scenario** is a named set of three percentages of the State Demography Office's (SDO) forecast for the place loaded. 100% on all three is SDO's forecast, the one the HNA page's 20-year figure uses.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `births_pct` | Births, as a percentage of SDO's forecast births | 100 |
| `deaths_pct` | Deaths, as a percentage of SDO's forecast deaths | 100 |
| `migration_pct` | Net migration (people moving in minus people moving out), as a percentage of SDO's forecast, at every age | 100 |

See [Projection Methodology](PROJECTION-METHODOLOGY.md#scenario-builder) for how the model applies them.

---

## Built-In Scenarios

Three scenarios are pre-configured and cannot be deleted:

| Scenario | Births | Deaths | Migration |
|----------|--------|--------|-----------|
| **SDO forecast** | 100% | 100% | 100% |
| **Half the migration** | 100% | 100% | 50% |
| **1.5× the migration** | 100% | 100% | 150% |

Until 2026-10-20 the presets were one fixed set of inputs for every place (500, 250 or 1,000 people moving in a year, with fertility and mortality multipliers), which for a small town was far above its recent migration. Percentages of each place's own forecast replace them.

---

## Creating a Custom Scenario

1. Open the **[Scenario Builder](../hna-scenario-builder.html)** and load a county, town or CDP
2. Use the **sliders** to set:
   - People moving in, net (0% – 200% of SDO's forecast; the page shows SDO's number of people a year beside it)
   - Births (50% – 150%)
   - Deaths (80% – 120%)
3. Enter a **name** in the "Scenario name" field
4. Click **Save**

### Storage

Custom scenarios are saved to **browser localStorage** under the key `coho_hna_scenarios`. They persist across sessions on the same browser but are **not synced** across devices or browsers.

### Storage Schema

```json
{
  "id": "custom-slower-migration-abc123",
  "name": "Slower migration",
  "year": 2026,
  "assumptions": {
    "births": "100% of SDO's forecast",
    "deaths": "100% of SDO's forecast",
    "migration": "60% of SDO's forecast net migration"
  },
  "parameters": {
    "births_pct": 100,
    "deaths_pct": 100,
    "migration_pct": 60
  },
  "createdAt": "2026-10-20T18:30:00Z",
  "baselineSource": "SDO Vintage 2024 Prepared March 2025",
  "geography": { "geoid": "08077", "name": "Mesa County" }
}
```

Scenarios saved before 2026-10-20 carry `fertility_multiplier`, `mortality_multiplier` and `net_migration_annual` instead. They still load: the multipliers become percentages and the people a year become a percentage of SDO's average net migration for the place loaded (`CohortComponentModel.paramsFromSaved`). Every setting is held to the sliders' ranges (`CohortComponentModel.RANGES`), so a count more than twice SDO's loads as 200% and the page says so; a record with no count keeps SDO's migration.

---

## Loading a Saved Scenario

1. In the **Saved Scenarios** panel, click **Load** next to the desired scenario
2. The sliders will update to match the saved parameters
3. The chart and results table will re-run the projection automatically

---

## Comparing Scenarios

The chart on the Scenario Builder page always displays **all four curves** simultaneously:
- SDO forecast
- Half the migration
- 1.5× the migration
- Your scenario (your current slider settings)

A saved scenario also appears in the HNA page's scenario list, drawn as that page's population line plus the change the scenario makes to SDO's forecast. The change is taken over the same counties the builder uses (`CohortComponentModel.countiesFor`), so a town in several counties moves by the same amount on both pages (`test/hna-saved-scenario-matches-builder.test.js`). Statewide, which the builder does not model, the page draws no saved-scenario line and says so.

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
