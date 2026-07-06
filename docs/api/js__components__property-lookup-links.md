# `js/components/property-lookup-links.js`

js/components/property-lookup-links.js — F124
==============================================
Reusable helper that builds "look up this property" link bars for any
affordable-housing property record. Used by the HNA LIHTC info panel,
the affordable-housing map layer popup, and any future surface that
shows a property name + address.

Three goals:
  1. Let the user verify a property exists in the source-of-record
     (CHFA, HUD MF, USDA RD, NHPD).
  2. Let the user see the building on the ground (Google Maps + street).
  3. Let the user catch up on recent activity (news search, DOLA awards).

Usage:
  PropertyLookup.htmlFor(p)           → ready-to-paste link bar (HTML)
  PropertyLookup.htmlFor(p, { compact: true })  → smaller variant
  PropertyLookup.creditTypeTip(credit) → { label, desc } for tooltip

The `p` argument can be either a CHFA ArcGIS feature.properties object
(PROJECT, PROJ_ADD, PROJ_CTY, PROJ_ST, TypeOfCredits) OR a unified
record from properties.json (property_name, address, city, type_of_
credits, program_type[]). Both shapes are auto-detected.

_No documented symbols — module has a file-header comment only._
