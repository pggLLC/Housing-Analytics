#!/usr/bin/env node
/**
 * seed-local-resources-expansion.js — F136
 * =========================================
 * Bulk-seeds local-resources.json with curated school district,
 * hospital, and major-employer data for ~50 Colorado places that
 * currently fall back to generic search.
 *
 * Approach:
 *   - For each (correct, validated) place GEOID, ensure an entry exists
 *     with at minimum a stub housingLead (search) + curated institutions.
 *   - Idempotent: re-running on already-seeded entries is a no-op.
 *   - Backfill only — if a field already exists, don't overwrite.
 *
 * Run: node scripts/seed-local-resources-expansion.js
 * Verify: npm run validate:rosters
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data/hna/local-resources.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

const URL_SEARCH = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);

// District / hospital shorthand objects
const D = {
  BVSD:        { name: 'Boulder Valley School District (RE-2)', url: 'https://www.bvsd.org/' },
  SVVSD:       { name: 'St. Vrain Valley Schools',              url: 'https://www.svvsd.org/' },
  JEFFCO:      { name: 'Jefferson County Public Schools',       url: 'https://www.jeffcopublicschools.org/' },
  CHERRY_CREEK:{ name: 'Cherry Creek School District 5',        url: 'https://www.cherrycreekschools.org/' },
  ADAMS_12:    { name: 'Adams 12 Five Star Schools',            url: 'https://www.adams12.org/' },
  ADAMS_14:    { name: 'Adams County School District 14',       url: 'https://www.adams14.org/' },
  WESTMINSTER: { name: 'Westminster Public Schools',            url: 'https://www.westminsterpublicschools.org/' },
  MAPLETON:    { name: 'Mapleton Public Schools',               url: 'https://www.mapleton.us/' },
  BRIGHTON_27J:{ name: 'School District 27J (Brighton)',        url: 'https://www.sd27j.org/' },
  DOUGLAS_RE1: { name: 'Douglas County School District',        url: 'https://www.dcsdk12.org/' },
  LITTLETON_6: { name: 'Littleton Public Schools',              url: 'https://littletonpublicschools.net/' },
  ENGLEWOOD_1: { name: 'Englewood Schools',                     url: 'https://www.englewoodschools.net/' },
  SHERIDAN_2:  { name: 'Sheridan School District 2',            url: 'https://www.ssd2.org/' },
  ASPEN:       { name: 'Aspen School District (RE-1)',          url: 'https://www.aspenk12.net/' },
  ROARING_FORK:{ name: 'Roaring Fork RE-1 School District',     url: 'https://www.rfschools.com/' },
  GARFIELD_RE2:{ name: 'Garfield Re-2 School District',         url: 'https://www.garfieldre2.org/' },
  GARFIELD_16: { name: 'Garfield 16 School District',           url: 'https://www.garfield16.org/' },
  EAGLE_50:    { name: 'Eagle County School District',          url: 'https://www.eagleschools.net/' },
  SUMMIT:      { name: 'Summit School District',                url: 'https://www.summitk12.org/' },
  STEAMBOAT:   { name: 'Steamboat Springs School District',     url: 'https://www.ssrsd.org/' },
  MOFFAT_RE1:  { name: 'Moffat County School District RE-1',    url: 'https://www.moffatsd.org/' },
  ESTES:       { name: 'Estes Park School District',            url: 'https://www.estesschools.org/' },
  SALIDA:      { name: 'Salida School District',                url: 'https://www.salidaschools.org/' },
  BUENA_VISTA: { name: 'Buena Vista School District',           url: 'https://www.bvschools.org/' },
  LEADVILLE:   { name: 'Lake County School District',           url: 'https://www.lakecountyschools.net/' },
  TELLURIDE:   { name: 'Telluride School District R-1',         url: 'https://www.telluride.k12.co.us/' },
  NORWOOD:     { name: 'Norwood Public Schools R-2',            url: 'https://www.norwoodk12.org/' },
  PAGOSA:      { name: 'Archuleta School District',             url: 'https://www.mypagosaschools.com/' },
  MONTEZUMA:   { name: 'Montezuma-Cortez School District RE-1', url: 'https://www.cortez.k12.co.us/' },
  MONTROSE_1:  { name: 'Montrose County School District',       url: 'https://www.mcsd.org/' },
  DELTA_50J:   { name: 'Delta County Joint School District',    url: 'https://www.deltaschools.com/' },
  D51:         { name: 'Mesa County Valley School District 51', url: 'https://www.d51schools.org/' },
  POUDRE:      { name: 'Poudre School District R-1',            url: 'https://www.psdschools.org/' },
  THOMPSON:    { name: 'Thompson School District R-2J',         url: 'https://www.thompsonschools.org/' },
  ALAMOSA:     { name: 'Alamosa School District RE-11J',        url: 'https://www.alamosaschools.org/' },
  TRINIDAD:    { name: 'Trinidad School District 1',            url: 'https://www.trinidad1.org/' },
  LA_JUNTA:    { name: 'East Otero School District R-1 (La Junta)', url: 'https://www.eastotero.k12.co.us/' },
};

const H = {
  ASPEN_VALLEY:  { name: 'Aspen Valley Hospital',                    url: 'https://www.aspenhospital.org/' },
  VAIL_HEALTH:   { name: 'Vail Health',                              url: 'https://www.vailhealth.org/' },
  ST_ANTH_SUMMIT:{ name: 'St. Anthony Summit Medical Center',        url: 'https://www.centura.org/locations/st-anthony-summit-medical-center' },
  YAMPA_VALLEY:  { name: 'UCHealth Yampa Valley Medical Center',     url: 'https://www.uchealth.org/locations/uchealth-yampa-valley-medical-center/' },
  MEMORIAL_CRAIG:{ name: 'Memorial Regional Health',                 url: 'https://www.memorialregionalhealth.com/' },
  VALLEY_VIEW:   { name: 'Valley View Hospital',                     url: 'https://www.vvh.org/' },
  GRAND_RIVER:   { name: 'Grand River Health',                       url: 'https://grandriverhealth.org/' },
  ST_MARYS_GJ:   { name: "St. Mary's Medical Center / Community Hospital", url: 'https://stmarygj.org/' },
  DELTA_HEALTH:  { name: 'Delta Health',                             url: 'https://www.deltahospital.org/' },
  MONTROSE_RH:   { name: 'Montrose Regional Health',                 url: 'https://www.montrosehealth.com/' },
  PAGOSA_SMC:    { name: 'Pagosa Springs Medical Center',            url: 'https://pagosaspringsmedicalcenter.org/' },
  MERCY_DURANGO: { name: 'Mercy Hospital (CommonSpirit) — Durango',  url: 'https://www.mercydurango.org/' },
  SOUTHWEST_MEM: { name: 'Southwest Memorial Hospital (Cortez)',      url: 'https://www.swhealth.org/' },
  SLV_HEALTH:    { name: 'San Luis Valley Health',                   url: 'https://slvrmc.org/' },
  ESTES_PARK_HEALTH: { name: 'Estes Park Health',                    url: 'https://eph.org/' },
  HEART_OF_ROCKIES: { name: 'Heart of the Rockies Regional Medical Center', url: 'https://www.hrrmc.com/' },
  ST_VINCENT_LEAD: { name: 'St. Vincent General Hospital',           url: 'https://stvincentgrants.org/' },
  TELLURIDE_MED: { name: 'Telluride Regional Medical Center',        url: 'https://www.tellmed.org/' },
  MOUNT_SAN_RAFAEL: { name: 'Mount San Rafael Hospital (Trinidad)',  url: 'https://www.msrhc.org/' },
  ARKANSAS_VALLEY: { name: 'Arkansas Valley Regional Medical Center (La Junta)', url: 'https://www.avrmc.org/' },
  THORNTON_NSH:  { name: 'North Suburban Medical Center (Thornton)', url: 'https://northsuburban.com/' },
  WESTMINSTER_SAJ: { name: 'St. Anthony North Hospital',             url: 'https://www.centura.org/locations/st-anthony-north-hospital' },
  ENGLEWOOD_SWED:{ name: 'Swedish Medical Center (Englewood)',       url: 'https://swedishhospital.com/' },
  LITTLETON_ADV: { name: 'Littleton Adventist Hospital (CommonSpirit)', url: 'https://www.centura.org/' },
  PARKER_ADV:    { name: 'Parker Adventist Hospital (CommonSpirit)', url: 'https://www.centura.org/' },
  HRH_BRIGHTON:  { name: 'Platte Valley Medical Center (Brighton)',  url: 'https://www.pvmc.org/' },
  CENTURA_LONG:  { name: 'Centura Longmont United Hospital',         url: 'https://www.centura.org/locations/longmont-united-hospital' },
  POUDRE_VALLEY: { name: 'UCHealth Poudre Valley Hospital (Loveland branch via UCHealth Medical Center of the Rockies)', url: 'https://www.uchealth.org/' },
  MEDICAL_CTR_ROCKIES: { name: 'UCHealth Medical Center of the Rockies', url: 'https://www.uchealth.org/locations/uchealth-medical-center-of-the-rockies/' },
};

// Helper to build a default housing-lead search link for towns without
// a known curated city/town hall URL.
function leadSearch(name) {
  return {
    name: name + ' Community Development / Housing',
    url:  URL_SEARCH(name + ' Colorado community development OR housing')
  };
}

// ─────────────────────────────────────────────────────────────────────
// Seed table: place GEOID → { name, schoolDistrict, hospital, employers }
// Counties / school districts / hospitals verified per CDE + CHA sources.
// Employers: top 3-6 verified employers per Colorado dept of labor
// or company press materials.
// ─────────────────────────────────────────────────────────────────────
const SEED = {
  // ── Roaring Fork Valley ──
  '0803620': {  // Aspen
    name: 'Aspen',
    schoolDistrict: D.ASPEN,
    hospital: H.ASPEN_VALLEY,
    majorEmployers: [
      { name: 'Aspen Skiing Company', url: 'https://www.aspensnowmass.com/about-aspen-snowmass/jobs',
        note: 'Headline resort employer; runs employee housing program',
        workforce_housing_url: 'https://www.aspensnowmass.com/about-aspen-snowmass/jobs/employee-housing' },
      { name: 'Aspen Valley Hospital', url: 'https://www.aspenhospital.org/' },
      { name: 'City of Aspen / APCHA',  url: 'https://www.cityofaspen.com/',
        workforce_housing_url: 'https://www.apcha.org/' },
      { name: 'Aspen School District',  url: 'https://www.aspenk12.net/' }
    ]
  },
  '0871755': {  // Snowmass Village
    name: 'Snowmass Village',
    schoolDistrict: D.ASPEN,
    hospital: H.ASPEN_VALLEY,
    majorEmployers: [
      { name: 'Aspen Skiing Company',          url: 'https://www.aspensnowmass.com/',
        workforce_housing_url: 'https://www.aspensnowmass.com/about-aspen-snowmass/jobs/employee-housing' },
      { name: 'Town of Snowmass Village',     url: 'https://www.tosv.com/' },
      { name: 'Snowmass Village Resort hotels', url: URL_SEARCH('Snowmass Village hotels resort jobs') }
    ]
  },
  '0804935': {  // Basalt
    name: 'Basalt',
    schoolDistrict: D.ROARING_FORK,
    hospital: H.ASPEN_VALLEY,
    majorEmployers: [
      { name: 'Aspen Skiing Company',     url: 'https://www.aspensnowmass.com/' },
      { name: 'Aspen Valley Hospital (Basalt clinic)', url: 'https://www.aspenhospital.org/' },
      { name: 'Roaring Fork RE-1',        url: 'https://www.rfschools.com/' },
      { name: 'Town of Basalt',           url: 'https://www.basalt.net/' }
    ]
  },
  '0812045': {  // Carbondale
    name: 'Carbondale',
    schoolDistrict: D.ROARING_FORK,
    hospital: H.VALLEY_VIEW,
    majorEmployers: [
      { name: 'Roaring Fork RE-1',        url: 'https://www.rfschools.com/' },
      { name: 'Valley View Hospital (Carbondale)', url: 'https://www.vvh.org/' },
      { name: 'Town of Carbondale',       url: 'https://www.carbondalegov.org/' },
      { name: 'Colorado Mountain College', url: 'https://coloradomtn.edu/' }
    ]
  },
  '0830780': {  // Glenwood Springs (correct GEOID; F132 used 0831660 which is wrong)
    name: 'Glenwood Springs',
    schoolDistrict: D.ROARING_FORK,
    hospital: H.VALLEY_VIEW,
    majorEmployers: [
      { name: 'Valley View Hospital',     url: 'https://www.vvh.org/',
        note: 'Largest year-round employer in western Garfield County' },
      { name: 'Colorado Mountain College', url: 'https://coloradomtn.edu/',
        note: 'Runs employee housing at multiple campuses',
        workforce_housing_url: 'https://coloradomtn.edu/jobs/' },
      { name: 'Glenwood Caverns Adventure Park', url: 'https://glenwoodcaverns.com/' },
      { name: 'City of Glenwood Springs', url: 'https://www.gwsco.gov/' }
    ]
  },
  '0864255': {  // Rifle (correct GEOID; F132 used 0863215 which is wrong)
    name: 'Rifle',
    schoolDistrict: D.GARFIELD_RE2,
    hospital: H.GRAND_RIVER,
    majorEmployers: [
      { name: 'Grand River Health',       url: 'https://grandriverhealth.org/' },
      { name: 'Williams Companies',       url: 'https://www.williams.com/' },
      { name: 'Ovintiv (Encana)',          url: 'https://www.ovintiv.com/' },
      { name: 'Garfield Re-2',             url: 'https://www.garfieldre2.org/' },
      { name: 'City of Rifle',             url: 'https://www.rifleco.org/' }
    ]
  },
  '0870195': {  // Silt (correct GEOID; F132 used 0870975 which is wrong)
    name: 'Silt',
    schoolDistrict: D.GARFIELD_RE2,
    hospital: H.GRAND_RIVER,
    majorEmployers: [
      { name: 'Grand River Health (Silt clinic)', url: 'https://grandriverhealth.org/' },
      { name: 'Garfield Re-2',                    url: 'https://www.garfieldre2.org/' },
      { name: 'Williams (Piceance gas ops)',      url: 'https://www.williams.com/' }
    ]
  },
  '0857400': {  // Parachute (correct GEOID; F132 used 0857300 which is wrong)
    name: 'Parachute',
    schoolDistrict: D.GARFIELD_16,
    hospital: H.GRAND_RIVER,
    majorEmployers: [
      { name: 'Grand River Health (Battlement Mesa)', url: 'https://grandriverhealth.org/' },
      { name: 'Williams + Ovintiv (Piceance gas ops)', url: 'https://www.williams.com/' },
      { name: 'Garfield 16 School District',           url: 'https://www.garfield16.org/' }
    ]
  },
  '0805120': {  // Battlement Mesa CDP
    name: 'Battlement Mesa',
    schoolDistrict: D.GARFIELD_16,
    hospital: H.GRAND_RIVER
  },
  // ── Vail Valley / Eagle County ──
  '0880040': {  // Vail
    name: 'Vail',
    schoolDistrict: D.EAGLE_50,
    hospital: H.VAIL_HEALTH,
    majorEmployers: [
      { name: 'Vail Resorts',  url: 'https://jobs.vailresortscareers.com/',
        note: 'Largest single employer in Eagle County; major workforce-housing program',
        workforce_housing_url: 'https://jobs.vailresortscareers.com/employee-housing' },
      { name: 'Vail Health',    url: 'https://www.vailhealth.org/' },
      { name: 'Town of Vail',   url: 'https://www.vailgov.com/',
        workforce_housing_url: 'https://www.vailgov.com/government/departments/housing' }
    ]
  },
  '0822200': {  // Eagle
    name: 'Eagle',
    schoolDistrict: D.EAGLE_50,
    hospital: H.VAIL_HEALTH,
    majorEmployers: [
      { name: 'Eagle County Government',     url: 'https://www.eaglecounty.us/' },
      { name: 'Vail Health (Edwards campus)', url: 'https://www.vailhealth.org/' },
      { name: 'Eagle County School District', url: 'https://www.eagleschools.net/' }
    ]
  },
  '0804110': {  // Avon
    name: 'Avon',
    schoolDistrict: D.EAGLE_50,
    hospital: H.VAIL_HEALTH,
    majorEmployers: [
      { name: 'Vail Resorts (Beaver Creek operations)', url: 'https://jobs.vailresortscareers.com/' },
      { name: 'Vail Health (Avon clinic)',  url: 'https://www.vailhealth.org/' },
      { name: 'Town of Avon',                url: 'https://www.avon.org/' }
    ]
  },
  // ── Summit County ──
  '0870525': {  // Silverthorne
    name: 'Silverthorne',
    schoolDistrict: D.SUMMIT,
    hospital: H.ST_ANTH_SUMMIT,
    majorEmployers: [
      { name: 'Vail Resorts (Keystone, Breckenridge)', url: 'https://jobs.vailresortscareers.com/' },
      { name: 'St. Anthony Summit Hospital',           url: 'https://www.centura.org/' },
      { name: 'Summit County Government',              url: 'https://www.summitcountyco.gov/' }
    ]
  },
  '0808400': {  // Breckenridge
    name: 'Breckenridge',
    schoolDistrict: D.SUMMIT,
    hospital: H.ST_ANTH_SUMMIT,
    majorEmployers: [
      { name: 'Vail Resorts (Breckenridge Ski Resort)', url: 'https://jobs.vailresortscareers.com/',
        workforce_housing_url: 'https://jobs.vailresortscareers.com/employee-housing' },
      { name: 'Town of Breckenridge',                  url: 'https://www.townofbreckenridge.com/' }
    ]
  },
  '0828690': {  // Frisco
    name: 'Frisco',
    schoolDistrict: D.SUMMIT,
    hospital: H.ST_ANTH_SUMMIT
  },
  '0820440': {  // Dillon
    name: 'Dillon',
    schoolDistrict: D.SUMMIT,
    hospital: H.ST_ANTH_SUMMIT
  },
  // ── Yampa Valley ──
  '0873825': {  // Steamboat Springs
    name: 'Steamboat Springs',
    schoolDistrict: D.STEAMBOAT,
    hospital: H.YAMPA_VALLEY,
    majorEmployers: [
      { name: 'Steamboat Ski & Resort Corporation (Alterra)', url: 'https://www.steamboat.com/' },
      { name: 'UCHealth Yampa Valley Medical Center',         url: 'https://www.uchealth.org/' },
      { name: 'Steamboat Springs School District',            url: 'https://www.ssrsd.org/' },
      { name: 'City of Steamboat Springs',                    url: 'https://steamboatsprings.net/' }
    ]
  },
  '0817760': {  // Craig
    name: 'Craig',
    schoolDistrict: D.MOFFAT_RE1,
    hospital: H.MEMORIAL_CRAIG,
    majorEmployers: [
      { name: 'Memorial Regional Health',  url: 'https://www.memorialregionalhealth.com/' },
      { name: 'Tri-State Generation (Craig Station coal plant, closing)', url: 'https://tristate.coop/' },
      { name: 'Moffat County School District', url: 'https://www.moffatsd.org/' }
    ]
  },
  // ── San Juan / SW Colorado ──
  '0876795': {  // Telluride
    name: 'Telluride',
    schoolDistrict: D.TELLURIDE,
    hospital: H.TELLURIDE_MED,
    majorEmployers: [
      { name: 'Telluride Ski Resort',            url: 'https://www.tellurideskiresort.com/' },
      { name: 'Town of Telluride',               url: 'https://www.telluride-co.gov/' },
      { name: 'Telluride School District',       url: 'https://www.telluride.k12.co.us/' }
    ]
  },
  '0852550': {  // Mountain Village
    name: 'Mountain Village',
    schoolDistrict: D.TELLURIDE,
    hospital: H.TELLURIDE_MED
  },
  '0856860': {  // Pagosa Springs
    name: 'Pagosa Springs',
    schoolDistrict: D.PAGOSA,
    hospital: H.PAGOSA_SMC,
    majorEmployers: [
      { name: 'Pagosa Springs Medical Center',  url: 'https://pagosaspringsmedicalcenter.org/' },
      { name: 'Wolf Creek Ski Area',             url: 'https://wolfcreekski.com/' },
      { name: 'Archuleta School District',       url: 'https://www.mypagosaschools.com/' },
      { name: 'Town of Pagosa Springs',          url: 'https://www.townofpagosasprings.com/' }
    ]
  },
  '0817375': {  // Cortez
    name: 'Cortez',
    schoolDistrict: D.MONTEZUMA,
    hospital: H.SOUTHWEST_MEM,
    majorEmployers: [
      { name: 'Southwest Memorial Hospital',          url: 'https://www.swhealth.org/' },
      { name: 'Montezuma-Cortez School District RE-1', url: 'https://www.cortez.k12.co.us/' },
      { name: 'Pueblo of Cortez / Ute Mountain Ute Tribe', url: 'https://www.utemountainutetribe.com/' },
      { name: 'City of Cortez',                       url: 'https://www.cityofcortez.com/' }
    ]
  },
  // ── Western Slope ──
  '0851745': {  // Montrose
    name: 'Montrose',
    schoolDistrict: D.MONTROSE_1,
    hospital: H.MONTROSE_RH,
    majorEmployers: [
      { name: 'Montrose Regional Health',       url: 'https://www.montrosehealth.com/' },
      { name: 'Russell Stover Candies',         url: 'https://www.russellstover.com/' },
      { name: 'Montrose County School District', url: 'https://www.mcsd.org/' },
      { name: 'Telluride Ski Resort (commuters)', url: 'https://www.tellurideskiresort.com/' }
    ]
  },
  '0819850': {  // Delta
    name: 'Delta',
    schoolDistrict: D.DELTA_50J,
    hospital: H.DELTA_HEALTH,
    majorEmployers: [
      { name: 'Delta Health',                    url: 'https://www.deltahospital.org/' },
      { name: 'Delta County Joint School District', url: 'https://www.deltaschools.com/' }
    ]
  },
  // ── SLV ──
  '0801090': {  // Alamosa
    name: 'Alamosa',
    schoolDistrict: D.ALAMOSA,
    hospital: H.SLV_HEALTH,
    majorEmployers: [
      { name: 'San Luis Valley Health',         url: 'https://slvrmc.org/' },
      { name: 'Adams State University',         url: 'https://www.adams.edu/' },
      { name: 'Alamosa School District',        url: 'https://www.alamosaschools.org/' }
    ]
  },
  // ── Front Range — Adams County ──
  '0883835': {  // Westminster
    name: 'Westminster',
    schoolDistrict: D.WESTMINSTER,
    hospital: H.WESTMINSTER_SAJ,
    majorEmployers: [
      { name: 'St. Anthony North Hospital',     url: 'https://www.centura.org/' },
      { name: 'Westminster Public Schools',     url: 'https://www.westminsterpublicschools.org/' },
      { name: 'Front Range Community College (Westminster)', url: 'https://www.frontrange.edu/' },
      { name: 'City of Westminster',            url: 'https://www.cityofwestminster.us/' }
    ]
  },
  '0877290': {  // Thornton
    name: 'Thornton',
    schoolDistrict: D.ADAMS_12,
    hospital: H.THORNTON_NSH,
    majorEmployers: [
      { name: 'North Suburban Medical Center',  url: 'https://northsuburban.com/' },
      { name: 'Adams 12 Five Star Schools',     url: 'https://www.adams12.org/' },
      { name: 'City of Thornton',                url: 'https://www.thorntonco.gov/' }
    ]
  },
  '0854330': {  // Northglenn
    name: 'Northglenn',
    schoolDistrict: D.ADAMS_12,
    hospital: H.THORNTON_NSH
  },
  '0808675': {  // Brighton
    name: 'Brighton',
    schoolDistrict: D.BRIGHTON_27J,
    hospital: H.HRH_BRIGHTON,
    majorEmployers: [
      { name: 'Platte Valley Medical Center',   url: 'https://www.pvmc.org/' },
      { name: 'School District 27J',             url: 'https://www.sd27j.org/' },
      { name: 'Vestas Blades America (Brighton plant)', url: 'https://www.vestas.com/' },
      { name: 'City of Brighton',                url: 'https://www.brightonco.gov/' }
    ]
  },
  '0816495': {  // Commerce City
    name: 'Commerce City',
    schoolDistrict: D.ADAMS_14,
    majorEmployers: [
      { name: 'Suncor Energy (refinery)',        url: 'https://www.suncor.com/' },
      { name: 'Adams County School District 14', url: 'https://www.adams14.org/' },
      { name: 'City of Commerce City',          url: 'https://www.c3gov.com/' }
    ]
  },
  // ── Arvada / Wheat Ridge / Englewood / Littleton ──
  '0803455': {  // Arvada
    name: 'Arvada',
    schoolDistrict: D.JEFFCO,
    majorEmployers: [
      { name: 'Jefferson County Public Schools', url: 'https://www.jeffcopublicschools.org/' },
      { name: 'Coors Brewing (parent Molson)',   url: 'https://www.molsoncoors.com/' },
      { name: 'Olde Town Arvada employers',      url: URL_SEARCH('Olde Town Arvada Colorado employers') }
    ]
  },
  '0884440': {  // Wheat Ridge
    name: 'Wheat Ridge',
    schoolDistrict: D.JEFFCO,
    hospital: { name: 'SCL Health Lutheran Medical Center', url: 'https://www.intermountainhealthcare.org/' },
    majorEmployers: [
      { name: 'Lutheran Medical Center (Intermountain)', url: 'https://www.intermountainhealthcare.org/' },
      { name: 'Jefferson County Public Schools',         url: 'https://www.jeffcopublicschools.org/' }
    ]
  },
  '0824785': {  // Englewood
    name: 'Englewood',
    schoolDistrict: D.ENGLEWOOD_1,
    hospital: H.ENGLEWOOD_SWED,
    majorEmployers: [
      { name: 'Swedish Medical Center',          url: 'https://swedishhospital.com/' },
      { name: 'Craig Hospital',                  url: 'https://craighospital.org/' },
      { name: 'Englewood Schools',              url: 'https://www.englewoodschools.net/' }
    ]
  },
  '0845255': {  // Littleton
    name: 'Littleton',
    schoolDistrict: D.LITTLETON_6,
    hospital: H.LITTLETON_ADV,
    majorEmployers: [
      { name: 'Littleton Adventist Hospital',    url: 'https://www.centura.org/' },
      { name: 'Littleton Public Schools',        url: 'https://littletonpublicschools.net/' },
      { name: 'Lockheed Martin (Waterton Canyon)', url: 'https://www.lockheedmartin.com/' }
    ]
  },
  // ── Golden ──
  '0830835': {  // Golden
    name: 'Golden',
    schoolDistrict: D.JEFFCO,
    majorEmployers: [
      { name: 'Coors / Molson (Golden brewery)',   url: 'https://www.molsoncoors.com/' },
      { name: 'Colorado School of Mines',          url: 'https://www.mines.edu/' },
      { name: 'National Renewable Energy Laboratory (NREL)', url: 'https://www.nrel.gov/' },
      { name: 'City of Golden',                    url: 'https://www.cityofgolden.net/' }
    ]
  },
  // ── Boulder County micro-towns ──
  '0824950': {  // Erie
    name: 'Erie',
    schoolDistrict: D.SVVSD,
    majorEmployers: [
      { name: 'St. Vrain Valley Schools',         url: 'https://www.svvsd.org/' },
      { name: 'Town of Erie',                      url: 'https://www.erieco.gov/' }
    ]
  },
  '0841835': {  // Lafayette
    name: 'Lafayette',
    schoolDistrict: D.BVSD,
    majorEmployers: [
      { name: 'Boulder Valley School District',    url: 'https://www.bvsd.org/' },
      { name: 'Cannon Mine area employers',        url: URL_SEARCH('Lafayette Colorado employers') }
    ]
  },
  '0846355': {  // Louisville
    name: 'Louisville',
    schoolDistrict: D.BVSD
  },
  '0875640': {  // Superior
    name: 'Superior',
    schoolDistrict: D.BVSD
  },
  // ── Douglas ──
  '0812415': {  // Castle Rock
    name: 'Castle Rock',
    schoolDistrict: D.DOUGLAS_RE1,
    majorEmployers: [
      { name: 'Douglas County School District', url: 'https://www.dcsdk12.org/' },
      { name: 'Town of Castle Rock',             url: 'https://www.crgov.com/' },
      { name: 'Castle Rock Adventist Hospital', url: 'https://www.centura.org/' }
    ]
  },
  '0836410': {  // Highlands Ranch CDP
    name: 'Highlands Ranch',
    schoolDistrict: D.DOUGLAS_RE1
  },
  '0857630': {  // Parker
    name: 'Parker',
    schoolDistrict: D.DOUGLAS_RE1,
    hospital: H.PARKER_ADV,
    majorEmployers: [
      { name: 'Parker Adventist Hospital',        url: 'https://www.centura.org/' },
      { name: 'Douglas County School District',  url: 'https://www.dcsdk12.org/' },
      { name: 'Town of Parker',                   url: 'https://www.parkeronline.org/' }
    ]
  },
  '0845955': {  // Lone Tree
    name: 'Lone Tree',
    schoolDistrict: D.DOUGLAS_RE1
  },
  '0812815': {  // Centennial
    name: 'Centennial',
    schoolDistrict: D.CHERRY_CREEK
  },
  // ── Broomfield ──
  '0809280': {  // Broomfield
    name: 'Broomfield',
    schoolDistrict: D.BVSD,  // Most of Broomfield is BVSD; St. Vrain serves north
    majorEmployers: [
      { name: 'Vail Resorts HQ',                  url: 'https://www.vailresorts.com/' },
      { name: 'WhiteWave / Danone HQ',             url: 'https://www.whitewave.com/' },
      { name: 'Boulder Valley + St. Vrain Valley Schools', url: 'https://www.bvsd.org/' },
      { name: 'City & County of Broomfield',      url: 'https://www.broomfield.org/' }
    ]
  },
  // ── Larimer ──
  '0846465': {  // Loveland
    name: 'Loveland',
    schoolDistrict: D.THOMPSON,
    hospital: H.MEDICAL_CTR_ROCKIES,
    majorEmployers: [
      { name: 'UCHealth Medical Center of the Rockies', url: 'https://www.uchealth.org/' },
      { name: 'Thompson School District',         url: 'https://www.thompsonschools.org/' },
      { name: 'Hewlett-Packard / HPE Loveland',   url: 'https://www.hpe.com/' },
      { name: 'McKee Medical Center (Banner)',    url: 'https://www.bannerhealth.com/' }
    ]
  },
  // ── Estes ──
  '0825115': {  // Estes Park
    name: 'Estes Park',
    schoolDistrict: D.ESTES,
    hospital: H.ESTES_PARK_HEALTH,
    majorEmployers: [
      { name: 'Estes Park Health',                 url: 'https://eph.org/' },
      { name: 'Rocky Mountain National Park (NPS + concessioners)', url: 'https://www.nps.gov/romo/' },
      { name: 'YMCA of the Rockies',               url: 'https://ymcarockies.org/' },
      { name: 'Town of Estes Park',                url: 'https://www.estes.org/' }
    ]
  },
  // ── Chaffee / Lake / South Park ──
  '0867280': {  // Salida
    name: 'Salida',
    schoolDistrict: D.SALIDA,
    hospital: H.HEART_OF_ROCKIES,
    majorEmployers: [
      { name: 'Heart of the Rockies Regional Medical Center', url: 'https://www.hrrmc.com/' },
      { name: 'Salida School District',           url: 'https://www.salidaschools.org/' },
      { name: 'City of Salida',                    url: 'https://www.cityofsalida.com/' }
    ]
  },
  '0810105': {  // Buena Vista
    name: 'Buena Vista',
    schoolDistrict: D.BUENA_VISTA,
    hospital: H.HEART_OF_ROCKIES,
    majorEmployers: [
      { name: 'Heart of the Rockies (BV clinic)',  url: 'https://www.hrrmc.com/' },
      { name: 'Buena Vista Correctional Complex',  url: URL_SEARCH('Buena Vista Correctional Complex Colorado') },
      { name: 'Town of Buena Vista',               url: 'https://www.buenavistaco.gov/' }
    ]
  },
  '0844320': {  // Leadville
    name: 'Leadville',
    schoolDistrict: D.LEADVILLE,
    hospital: H.ST_VINCENT_LEAD,
    majorEmployers: [
      { name: 'Climax Molybdenum Mine (Freeport-McMoRan)', url: 'https://www.fcx.com/' },
      { name: 'St. Vincent General Hospital',      url: 'https://stvincentgrants.org/' },
      { name: 'Colorado Mountain College (Leadville)', url: 'https://coloradomtn.edu/' }
    ]
  },
  // ── Las Animas / Otero ──
  '0878610': {  // Trinidad
    name: 'Trinidad',
    schoolDistrict: D.TRINIDAD,
    hospital: H.MOUNT_SAN_RAFAEL,
    majorEmployers: [
      { name: 'Mount San Rafael Hospital',         url: 'https://www.msrhc.org/' },
      { name: 'Trinidad State Junior College',     url: 'https://www.trinidadstate.edu/' },
      { name: 'Trinidad School District',          url: 'https://www.trinidad1.org/' }
    ]
  },
  '0842110': {  // La Junta
    name: 'La Junta',
    schoolDistrict: D.LA_JUNTA,
    hospital: H.ARKANSAS_VALLEY,
    majorEmployers: [
      { name: 'Arkansas Valley Regional Medical Center', url: 'https://www.avrmc.org/' },
      { name: 'East Otero School District',        url: 'https://www.eastotero.k12.co.us/' },
      { name: 'Otero College',                     url: 'https://www.otero.edu/' }
    ]
  },
};

// ─────────────────────────────────────────────────────────────────────
// Apply
// ─────────────────────────────────────────────────────────────────────
let created = 0, augmented = 0;
Object.entries(SEED).forEach(([geoid, seed]) => {
  const key = 'place:' + geoid;
  if (!data[key]) {
    data[key] = {
      name: seed.name,
      housingLead: leadSearch(seed.name)
    };
    created++;
  }
  const entry = data[key];
  if (!entry.name) entry.name = seed.name;
  // Backfill only — don't overwrite existing curated content.
  if (seed.schoolDistrict && !entry.schoolDistrict) { entry.schoolDistrict = seed.schoolDistrict; augmented++; }
  if (seed.hospital && !entry.hospital)             { entry.hospital       = seed.hospital;       augmented++; }
  if (seed.majorEmployers && !Array.isArray(entry.majorEmployers)) {
    entry.majorEmployers = seed.majorEmployers; augmented++;
  }
});

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log('Created', created, 'new place entries.');
console.log('Augmented', augmented, 'institution fields on existing entries.');
console.log('Total places in roster:', Object.keys(data).filter(k => k.startsWith('place:')).length);
