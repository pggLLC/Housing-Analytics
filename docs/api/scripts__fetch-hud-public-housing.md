# `scripts/fetch-hud-public-housing.js`

fetch-hud-public-housing.js

Fetches HUD's Public Housing Developments layer for Colorado and writes
  data/affordable-housing/preservation/hud-public-housing.json

Public housing is owned by local housing authorities with HUD operating
and capital funds. It is not in CHFA's tax credit or preservation lists
unless a building was also refinanced there, and it is not in HUD's
multifamily (Section 8 contract) layer, so without this file the
affordable-housing inventory left most of it out.

One record per development. A scattered-site development (several
buildings) is placed at one point by HUD.
Housing-authority staff names and contacts are not on this layer and are
not copied. Tenant characteristics on the layer are not copied either.

Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Developments/FeatureServer/0
Run:    node scripts/fetch-hud-public-housing.js

_No documented symbols — module has a file-header comment only._
