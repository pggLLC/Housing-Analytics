# `scripts/lib/county-boundaries.mjs`

Colorado county boundaries + point-in-polygon, shared by the two LIHTC
augmenters of the HNA ranking index (this module never touches the index).

Both augmenters originally attributed LIHTC records to *places* only
(by PROJ_CTY name, and by place polygon), so all 64 county rows were
stamped lihtc_project_count = 0 / lihtc_in_boundary = 0 and every
county was scored "never funded" — Denver County reported 0 projects
beside Denver city's 251. Counties are measurable: this module gives
them a polygon test of their own.

_No documented symbols — module has a file-header comment only._
