'use strict';
/**
 * Which designation year a fetched HUD QCT or DDA layer actually holds.
 *
 * HUD names its ArcGIS layers by year (Difficult_Development_Areas_2026), but
 * on 2026-10-23 it loaded the 2027 designations into the layers named 2026:
 * the Colorado nonmetro DDA counties in Difficult_Development_Areas_2026 have
 * since matched HUD's 2027 list (DDA2027NM.PDF: Archuleta and Chaffee in, San
 * Miguel out), not its 2026 list. A layer name is therefore not evidence of the
 * year. Designations change once a year, so the content is:
 *
 *   - the same as the cached file  -> the cached year, whatever the layer says;
 *   - different, from a layer named later than the cache -> the layer's year;
 *   - different, from a layer named the same year as the cache (or earlier)
 *     -> the year after the cached one: HUD has loaded next year's list early;
 *   - no readable cached file or year -> nothing is written.
 *
 * Next year's list applies only to allocations, bond issuance and placement in
 * service after December 31 (91 FR 63573, 2026-10-06, section VII.A), so it is
 * not written before January; the January run of cache-hud-gis-data.yml then
 * writes it with its real year.
 *
 * resolveDesignationYear({ layerYear, thisYear, cachedYear, cachedKeys, fetchedKeys })
 *   -> { year, write, reason }
 */

function sameSet(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const k of sa) if (!sb.has(k)) return false;
  return true;
}

function resolveDesignationYear({ layerYear, thisYear, cachedYear, cachedKeys, fetchedKeys }) {
  if (!Number.isInteger(cachedYear) || !cachedKeys || !cachedKeys.length) {
    // Without a baseline the layer name is the only evidence, and it is the
    // evidence that failed in October 2026. Refuse rather than guess; restore
    // the cached file from git history to resume.
    return {
      year: layerYear, write: false,
      reason: 'no readable cached file with a designation year to compare against; the layer name alone is not evidence of the year, so nothing is written',
    };
  }
  if (sameSet(cachedKeys, fetchedKeys)) {
    return { year: cachedYear, write: true, reason: `content unchanged; still the ${cachedYear} designations` };
  }
  const year = layerYear > cachedYear ? layerYear : cachedYear + 1;
  if (year > thisYear) {
    return {
      year, write: false,
      reason: `layer ${layerYear} now holds different designations than the cached ${cachedYear} file; ` +
        `they are the ${year} designations, which take effect after December 31, so the cached file is kept`,
    };
  }
  return { year, write: true, reason: `content changed; the ${year} designations` };
}

/** Year recorded on a cached file; older files name it only in `source`. */
function cachedDesignationYear(doc) {
  if (!doc) return null;
  if (Number.isInteger(doc.designationYear)) return doc.designationYear;
  const m = /_(\d{4}) FeatureServer/.exec(doc.source || '');
  return m ? Number(m[1]) : null;
}

/** Stable identity of a QCT (tract GEOID) or DDA (county code or ZIP) feature. */
function featureKey(feature) {
  const p = (feature && feature.properties) || {};
  if (p.DDA_CODE || p.DDA_TYPE) return p.DDA_TYPE === 'SA' ? 'SA:' + p.ZCTA5 : 'NM:' + p.DDA_CODE;
  return 'T:' + String(p.GEOID || '');
}

module.exports = { resolveDesignationYear, cachedDesignationYear, featureKey };
