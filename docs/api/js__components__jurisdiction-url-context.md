# `js/components/jurisdiction-url-context.js`

Shared jurisdiction resolver for cross-page workflow links.

Reads ?fips= / ?geoid= URL params first, then falls back to WorkflowState
and SiteState. Seven-digit place/CDP GEOIDs are mapped to their containing
county via data/hna/geo-config.json so county-only tools can auto-select.

_No documented symbols — module has a file-header comment only._
