# `js/components/data-quality-summary.js`

js/components/data-quality-summary.js
Page-level data quality disclosure panel.

Renders a collapsible summary showing:
 - Which data sources power this page
 - Whether each source is primary, cached, or fallback
 - Data freshness (age from last update)
 - Geographic extent / coverage
 - Known limitations

Usage (declarative):
  <div id="dataQualitySummary"
       data-dqs-sources='[
         {"name":"ACS 5-Year","status":"primary","vintage":"2024","coverage":"All CO tracts"},
         {"name":"HUD CHAS","status":"degraded","vintage":"2017-2021","note":"51/64 counties have clamped values"}
       ]'
       data-dqs-limitations="Circular buffer PMA, not a professional market delineation. Statewide AMI used for rent pressure.">
  </div>

Or imperative:
  DataQualitySummary.render('dataQualitySummary', {
    sources: [...],
    limitations: '...',
    lastUpdated: '2026-03-27'
  });

Exposes window.DataQualitySummary.

_No documented symbols — module has a file-header comment only._
