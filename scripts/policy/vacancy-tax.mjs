// Vacancy tax estimates: what a voter-approved vacancy excise tax could raise in a
// Colorado municipality, from ACS 2020-2024 table B25004 (vacancy status).
//
// One place for the arithmetic, so the brief's tables and picture
// (build_vacancy_tax_brief.mjs) and the guard (test/vacancy-tax-brief.test.mjs)
// cannot disagree. The cases and the rate live in data/policy/vacancy-tax.json
// (meta.estimate); they are COHO assumptions and the brief says so.
//
// Who pays: the OWNER of a home that is not lived in. Renters pay nothing directly.

/** Home rule, or a consolidated city and county (Denver, Broomfield), which is home rule too. */
export const canLevy = (type) => /^Home rule|^Consolidated/.test(type || '');

/**
 * One place's estimate. geo is a data/hna/vacancy-status.json geography; units
 * is its B25001 housing-unit count. Returns null when the record is missing.
 */
export function estimatePlace(geo, units, est) {
  if (!geo || !geo.values || !units) return null;
  const seasonal = geo.values.seasonal_recreational_occasional;
  const other = geo.values.other_vacant;
  if (!Number.isFinite(seasonal) || !Number.isFinite(other)) return null;
  const at = (c) => (seasonal * c.seasonal_share + other * c.other_share) * c.collected * est.rate_usd;
  const base = seasonal + other;
  return {
    seasonal,
    seasonal_moe: geo.moe ? geo.moe.seasonal_recreational_occasional : null,
    other,
    other_moe: geo.moe ? geo.moe.other_vacant : null,
    base,
    units,
    base_share: base / units,
    second_home_share: base ? seasonal / base : 0,
    low: at(est.cases.low),
    middle: at(est.cases.middle),
    high: at(est.cases.high),
  };
}

/** Every municipality in the type list that has an ACS record, with its estimate. */
export function estimateAll(tax, vacancy, housing) {
  const est = tax.meta.estimate;
  return tax.municipal_types.places.map((p) => {
    const e = estimatePlace(vacancy.geographies[p.geoid], (housing.geographies[p.geoid] || {}).housing_units, est);
    return e && { ...p, can_levy: canLevy(p.type), ...e };
  }).filter(Boolean);
}

/**
 * The brief's two tables. Places that can levy: middle case at or above the dollar floor, or base
 * share at or above the share floor. Statutory places: base share at or above the share floor.
 * Both need at least min_base homes in the base, so a place of a few dozen homes is not ranked.
 */
export function briefRows(tax, vacancy, housing) {
  const est = tax.meta.estimate;
  const all = estimateAll(tax, vacancy, housing);
  const byMiddle = (a, b) => b.middle - a.middle || a.name.localeCompare(b.name);
  const levy = all.filter((r) => r.can_levy && r.base >= est.min_base && (r.middle >= est.table_floor_usd || r.base_share >= est.share_floor)).sort(byMiddle);
  const statutory = all.filter((r) => !r.can_levy && r.base >= est.min_base && r.base_share >= est.share_floor).sort(byMiddle);
  return { levy, statutory };
}

export const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3).toLocaleString('en-US')}K`);
export const pct = (v) => `${Math.round(v * 100)}%`;
export const count = (n, moe) => `${n.toLocaleString('en-US')}${moe == null ? '' : ` (±${moe.toLocaleString('en-US')})`}`;
