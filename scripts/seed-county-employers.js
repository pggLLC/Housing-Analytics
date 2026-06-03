#!/usr/bin/env node
/**
 * seed-county-employers.js — F142
 * ================================
 * Adds curated majorEmployers arrays to county-level entries in
 * local-resources.json so the HNA + IC packet show real employer
 * data instead of falling back to a Google search.
 *
 * Source: CDLE / DOLA Labor Market Information top-employer reports
 * (Quarterly Census of Employment + Wages, county-level top employer
 * publications), supplemented by county-EDC published top-employer
 * lists.
 *
 * Run: node scripts/seed-county-employers.js
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'data/hna/local-resources.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));

// Curated top employers per CO county. Each entry: name, url, optional
// note + workforce_housing_url. Sourced from county EDC websites,
// CDLE LMI top-employer reports, and company press materials.
const COUNTY_EMPLOYERS = {
  // ── Garfield (08045) — Roaring Fork + Piceance basin ──
  '08045': {
    source_label: 'Garfield County EDC + CDLE LMI Q4 2024',
    source_url:   'https://www.garfieldcounty.com/',
    employers: [
      { name: 'Valley View Hospital', url: 'https://www.vvh.org/',
        note: 'Largest year-round employer in western Garfield (~1,000+ FTE)' },
      { name: 'Grand River Health', url: 'https://grandriverhealth.org/',
        note: 'Rifle / Battlement Mesa health system; ~500 FTE' },
      { name: 'Roaring Fork School District RE-1', url: 'https://www.rfschools.com/' },
      { name: 'Garfield Re-2 School District', url: 'https://www.garfieldre2.org/' },
      { name: 'Garfield County Government', url: 'https://www.garfieldcounty.com/',
        note: 'County workforce ~700' },
      { name: 'Colorado Mountain College', url: 'https://coloradomtn.edu/',
        note: 'Multi-campus; runs employee housing',
        workforce_housing_url: 'https://coloradomtn.edu/jobs/' },
      { name: 'Williams Companies (Piceance basin)', url: 'https://www.williams.com/',
        note: 'Natural gas midstream; major year-round operations' },
      { name: 'Ovintiv (formerly Encana)', url: 'https://www.ovintiv.com/' },
      { name: 'Glenwood Caverns Adventure Park', url: 'https://glenwoodcaverns.com/' },
      { name: 'US Forest Service — White River NF HQ (Glenwood Springs)', url: 'https://www.fs.usda.gov/whiteriver' }
    ]
  },
  // ── Pitkin (08097) — Aspen + Snowmass ──
  '08097': {
    source_label: 'Pitkin County BOCC + APCHA',
    source_url:   'https://www.pitkincounty.com/',
    employers: [
      { name: 'Aspen Skiing Company', url: 'https://www.aspensnowmass.com/about-aspen-snowmass/jobs',
        note: 'Largest single employer in Pitkin (~3,500 seasonal, ~1,200 year-round)',
        workforce_housing_url: 'https://www.aspensnowmass.com/about-aspen-snowmass/jobs/employee-housing' },
      { name: 'Aspen Valley Hospital', url: 'https://www.aspenhospital.org/',
        note: 'Year-round anchor; offers staff housing' },
      { name: 'City of Aspen / APCHA', url: 'https://www.apcha.org/',
        note: 'APCHA runs one of largest municipal workforce-housing portfolios in CO (~3,000 units)' },
      { name: 'Pitkin County Government', url: 'https://www.pitkincounty.com/' },
      { name: 'Aspen School District (RE-1)', url: 'https://www.aspenk12.net/' },
      { name: 'Hotel Jerome / Aspen Meadows / St. Regis (resort hospitality)',
        url: 'https://www.aspenchamber.org/' }
    ]
  },
  // ── Eagle (08037) — Vail Valley ──
  '08037': {
    source_label: 'Eagle County EDC + Vail Resorts disclosures',
    source_url:   'https://www.eaglecounty.us/',
    employers: [
      { name: 'Vail Resorts', url: 'https://jobs.vailresortscareers.com/',
        note: 'Largest single employer in Eagle (~6,500 seasonal, ~2,000 year-round)',
        workforce_housing_url: 'https://jobs.vailresortscareers.com/employee-housing' },
      { name: 'Vail Health', url: 'https://www.vailhealth.org/',
        note: 'Year-round anchor; runs staff housing' },
      { name: 'Town of Vail', url: 'https://www.vailgov.com/',
        workforce_housing_url: 'https://www.vailgov.com/government/departments/housing' },
      { name: 'Eagle County Government', url: 'https://www.eaglecounty.us/' },
      { name: 'Eagle County School District', url: 'https://www.eagleschools.net/' },
      { name: 'Beaver Creek Resort Company', url: 'https://www.beavercreek.com/' }
    ]
  },
  // ── Summit (08117) — Breckenridge / Keystone / Copper ──
  '08117': {
    source_label: 'Summit County BOCC + Vail Resorts disclosures',
    source_url:   'https://www.summitcountyco.gov/',
    employers: [
      { name: 'Vail Resorts (Breckenridge + Keystone)', url: 'https://jobs.vailresortscareers.com/',
        workforce_housing_url: 'https://jobs.vailresortscareers.com/employee-housing' },
      { name: 'Powdr Corp (Copper Mountain)', url: 'https://www.powdr.com/' },
      { name: 'St. Anthony Summit Medical Center (Centura)', url: 'https://www.centura.org/' },
      { name: 'Summit County Government', url: 'https://www.summitcountyco.gov/' },
      { name: 'Summit School District', url: 'https://www.summitk12.org/' },
      { name: 'Town of Breckenridge', url: 'https://www.townofbreckenridge.com/' }
    ]
  },
  // ── Routt (08107) — Steamboat ──
  '08107': {
    source_label: 'Yampa Valley Economic Development + Steamboat Ski Resort',
    source_url:   'https://www.yampavalley.info/',
    employers: [
      { name: 'Steamboat Ski & Resort Corp (Alterra Mountain Co)', url: 'https://www.steamboat.com/',
        note: 'Largest single employer in Routt' },
      { name: 'UCHealth Yampa Valley Medical Center', url: 'https://www.uchealth.org/' },
      { name: 'Steamboat Springs School District', url: 'https://www.ssrsd.org/' },
      { name: 'City of Steamboat Springs', url: 'https://steamboatsprings.net/' },
      { name: 'Routt County Government', url: 'https://www.co.routt.co.us/' }
    ]
  },
  // ── La Plata (08067) — Durango ──
  '08067': {
    source_label: 'Region 9 Economic Development District + Fort Lewis College',
    source_url:   'https://www.region9edd.org/',
    employers: [
      { name: 'Fort Lewis College', url: 'https://www.fortlewis.edu/',
        note: 'Largest year-round employer (~700 FTE)' },
      { name: 'Mercy Hospital (CommonSpirit)', url: 'https://www.mercydurango.org/' },
      { name: 'Durango 9-R School District', url: 'https://www.durangoschools.org/' },
      { name: 'La Plata County Government', url: 'https://www.co.laplata.co.us/' },
      { name: 'City of Durango', url: 'https://www.durangogov.org/' },
      { name: 'Purgatory Resort', url: 'https://www.purgatory.ski/' },
      { name: 'Southern Ute Indian Tribe (Sky Ute Casino + tribal enterprises)',
        url: 'https://www.southernute-nsn.gov/' },
      { name: 'Durango & Silverton Narrow Gauge Railroad', url: 'https://www.durangotrain.com/' }
    ]
  },
  // ── Montezuma (08083) — Cortez ──
  '08083': {
    source_label: 'Region 9 EDD + Montezuma County',
    source_url:   'https://www.region9edd.org/',
    employers: [
      { name: 'Southwest Memorial Hospital', url: 'https://www.swhealth.org/' },
      { name: 'Ute Mountain Ute Tribe (casino + enterprises)',
        url: 'https://www.utemountainutetribe.com/' },
      { name: 'Montezuma-Cortez School District RE-1', url: 'https://www.cortez.k12.co.us/' },
      { name: 'Montezuma County Government', url: 'https://www.co.montezuma.co.us/' },
      { name: 'City of Cortez', url: 'https://www.cityofcortez.com/' },
      { name: 'Mesa Verde National Park', url: 'https://www.nps.gov/meve/' }
    ]
  },
  // ── Mesa (08077) — Grand Junction ──
  '08077': {
    source_label: 'Grand Junction Area Chamber of Commerce',
    source_url:   'https://www.gjchamber.org/',
    employers: [
      { name: 'St. Mary\'s Medical Center', url: 'https://stmarygj.org/',
        note: 'Largest single employer (~2,500 FTE)' },
      { name: 'Community Hospital', url: 'https://yourcommunityhospital.com/' },
      { name: 'School District 51', url: 'https://www.d51schools.org/' },
      { name: 'Colorado Mesa University', url: 'https://www.coloradomesa.edu/' },
      { name: 'Mesa County Government', url: 'https://www.mesacounty.us/' },
      { name: 'Halliburton (energy services)', url: 'https://www.halliburton.com/' },
      { name: 'City of Grand Junction', url: 'https://www.gjcity.org/' }
    ]
  },
  // ── Denver (08031) ──
  '08031': {
    source_label: 'Denver Metro Chamber + Denver Public Schools annual report',
    source_url:   'https://www.denverchamber.org/',
    employers: [
      { name: 'Denver Health', url: 'https://www.denverhealth.org/' },
      { name: 'UCHealth (Anschutz + downtown)', url: 'https://www.uchealth.org/' },
      { name: 'Denver Public Schools', url: 'https://www.dpsk12.org/' },
      { name: 'City & County of Denver', url: 'https://www.denvergov.org/' },
      { name: 'University of Denver', url: 'https://www.du.edu/' },
      { name: 'CU Denver / CU Anschutz Medical Campus', url: 'https://www.ucdenver.edu/' },
      { name: 'Wells Fargo (Denver operations)', url: 'https://www.wellsfargo.com/' },
      { name: 'Liberty Media / Liberty Broadband', url: 'https://www.libertymedia.com/' }
    ]
  },
  // ── Arapahoe (08005) ──
  '08005': {
    source_label: 'Denver South EDP',
    source_url:   'https://www.denversouth.com/',
    employers: [
      { name: 'Children\'s Hospital Colorado (Anschutz)', url: 'https://www.childrenscolorado.org/' },
      { name: 'Cherry Creek School District 5', url: 'https://www.cherrycreekschools.org/' },
      { name: 'Arapahoe County Government', url: 'https://www.arapahoegov.com/' },
      { name: 'United Launch Alliance HQ (Centennial)', url: 'https://www.ulalaunch.com/' },
      { name: 'Comcast (regional HQ)', url: 'https://corporate.comcast.com/' }
    ]
  },
  // ── Adams (08001) ──
  '08001': {
    source_label: 'Adams County EDC',
    source_url:   'https://www.adamscountyedc.org/',
    employers: [
      { name: 'Adams 12 Five Star Schools', url: 'https://www.adams12.org/' },
      { name: 'Adams County Government', url: 'https://www.adcogov.org/' },
      { name: 'Vestas Blades America (Brighton)', url: 'https://www.vestas.com/' },
      { name: 'Suncor Energy (Commerce City refinery)', url: 'https://www.suncor.com/' },
      { name: 'Amazon distribution centers (Thornton + Aurora)', url: 'https://www.amazon.com/' }
    ]
  },
  // ── Jefferson (08059) ──
  '08059': {
    source_label: 'Jefferson County EDC',
    source_url:   'https://www.jeffco.us/',
    employers: [
      { name: 'Jefferson County Public Schools', url: 'https://www.jeffcopublicschools.org/' },
      { name: 'Coors Brewing / Molson Coors (Golden)', url: 'https://www.molsoncoors.com/' },
      { name: 'Colorado School of Mines', url: 'https://www.mines.edu/' },
      { name: 'National Renewable Energy Laboratory (NREL)', url: 'https://www.nrel.gov/' },
      { name: 'Lockheed Martin (Waterton)', url: 'https://www.lockheedmartin.com/' },
      { name: 'SCL Health / Intermountain Lutheran Medical Center', url: 'https://www.intermountainhealthcare.org/' },
      { name: 'St. Anthony Hospital (CommonSpirit)', url: 'https://www.stanthonyhosp.org/' }
    ]
  },
  // ── Douglas (08035) ──
  '08035': {
    source_label: 'Douglas County EDC',
    source_url:   'https://www.dcedc.org/',
    employers: [
      { name: 'Douglas County School District', url: 'https://www.dcsdk12.org/' },
      { name: 'Charles Schwab (Lone Tree)', url: 'https://www.schwab.com/' },
      { name: 'CoBank (Greenwood Village/Lone Tree HQ)', url: 'https://www.cobank.com/' },
      { name: 'EchoStar / DISH Network (Englewood/Meridian)', url: 'https://www.dish.com/' },
      { name: 'Centura Health (Castle Rock + Parker Adventist)', url: 'https://www.centura.org/' }
    ]
  },
  // ── Boulder (08013) ──
  '08013': {
    source_label: 'Boulder Chamber + CU Boulder',
    source_url:   'https://www.boulderchamber.com/',
    employers: [
      { name: 'University of Colorado Boulder', url: 'https://www.colorado.edu/',
        note: 'Largest employer in Boulder Co (~9,000 FTE)',
        workforce_housing_url: 'https://www.colorado.edu/hr/' },
      { name: 'Boulder Valley School District', url: 'https://www.bvsd.org/' },
      { name: 'Google Boulder', url: 'https://www.google.com/about/careers/' },
      { name: 'IBM Boulder', url: 'https://www.ibm.com/' },
      { name: 'BAE Systems (formerly Ball Aerospace)', url: 'https://www.baesystems.com/' },
      { name: 'Lockheed Martin Boulder', url: 'https://www.lockheedmartin.com/' },
      { name: 'Boulder Community Health', url: 'https://www.bch.org/' },
      { name: 'NIST + NOAA + NCAR (federal labs)', url: 'https://www.boulderlabs.org/' }
    ]
  },
  // ── Larimer (08069) ──
  '08069': {
    source_label: 'NoCo Economic Development + CSU',
    source_url:   'https://www.nocorea.com/',
    employers: [
      { name: 'Colorado State University', url: 'https://www.colostate.edu/',
        note: 'Largest employer in Northern CO (~7,500 FTE)' },
      { name: 'UCHealth Poudre Valley Hospital + Medical Center of the Rockies', url: 'https://www.uchealth.org/' },
      { name: 'Poudre School District R-1', url: 'https://www.psdschools.org/' },
      { name: 'Larimer County Government', url: 'https://www.larimer.org/' },
      { name: 'Otter Products (Fort Collins)', url: 'https://www.otterproducts.com/' },
      { name: 'Woodward Inc. (Fort Collins)', url: 'https://www.woodward.com/' },
      { name: 'Anheuser-Busch Fort Collins brewery', url: 'https://www.anheuser-busch.com/' },
      { name: 'HPE Fort Collins', url: 'https://www.hpe.com/' }
    ]
  },
  // ── Weld (08123) ──
  '08123': {
    source_label: 'Upstate Colorado Economic Development',
    source_url:   'https://www.upstatecolorado.org/',
    employers: [
      { name: 'JBS USA (Greeley HQ + beef plant)', url: 'https://jbsfoodsgroup.com/',
        note: 'Largest employer in Weld (~6,000+ FTE)' },
      { name: 'Banner North Colorado Medical Center', url: 'https://www.bannerhealth.com/' },
      { name: 'University of Northern Colorado', url: 'https://www.unco.edu/' },
      { name: 'Greeley-Evans School District 6', url: 'https://greeleyschools.org/' },
      { name: 'Weld County Government', url: 'https://www.weldgov.com/' },
      { name: 'Aims Community College', url: 'https://www.aims.edu/' },
      { name: 'Vestas Wind (Brighton/Windsor)', url: 'https://www.vestas.com/' },
      { name: 'Halliburton (energy services)', url: 'https://www.halliburton.com/' }
    ]
  },
  // ── El Paso (08041) — Colorado Springs ──
  '08041': {
    source_label: 'Colorado Springs Chamber & EDC',
    source_url:   'https://www.coloradospringschamberedc.com/',
    employers: [
      { name: 'Fort Carson (US Army)', url: 'https://home.army.mil/carson/',
        note: 'Largest single employer in southern CO (~25,000)' },
      { name: 'United States Air Force Academy', url: 'https://www.usafa.edu/' },
      { name: 'Peterson + Schriever Space Force Bases', url: 'https://www.peterson-schriever.spaceforce.mil/' },
      { name: 'UCHealth Memorial Hospital', url: 'https://www.uchealth.org/' },
      { name: 'Centura Penrose-St. Francis', url: 'https://www.centura.org/' },
      { name: 'USAA Colorado Springs', url: 'https://www.usaajobs.com/' },
      { name: 'Lockheed Martin Space', url: 'https://www.lockheedmartin.com/' },
      { name: 'Colorado College', url: 'https://www.coloradocollege.edu/' },
      { name: 'School District 11 (Colorado Springs)', url: 'https://www.d11.org/' }
    ]
  },
  // ── Pueblo (08101) ──
  '08101': {
    source_label: 'Pueblo Economic Development Corporation',
    source_url:   'https://www.pueblo.org/',
    employers: [
      { name: 'EVRAZ Rocky Mountain Steel', url: 'https://www.evrazna.com/' },
      { name: 'Parkview Medical Center', url: 'https://www.parkviewmc.com/' },
      { name: 'Centura St. Mary-Corwin', url: 'https://www.centura.org/' },
      { name: 'Pueblo City Schools D60', url: 'https://www.pueblod60.org/' },
      { name: 'Colorado State University Pueblo', url: 'https://www.csupueblo.edu/' },
      { name: 'Walmart Distribution Center', url: 'https://careers.walmart.com/' },
      { name: 'Vestas Wind (Pueblo plant)', url: 'https://www.vestas.com/' }
    ]
  },
  // ── Mesa-Delta-Montrose region ──
  '08029': {  // Delta
    source_label: 'Region 10 Economic Development',
    source_url:   'https://www.region10.net/',
    employers: [
      { name: 'Delta Health', url: 'https://www.deltahospital.org/' },
      { name: 'Delta County Joint School District', url: 'https://www.deltaschools.com/' },
      { name: 'Tri-State Generation (transitioning)', url: 'https://tristate.coop/' },
      { name: 'Delta County Government', url: 'https://www.deltacounty.com/' }
    ]
  },
  '08085': {  // Montrose
    source_label: 'Montrose County EDC',
    source_url:   'https://www.montrosecounty.net/',
    employers: [
      { name: 'Montrose Regional Health', url: 'https://www.montrosehealth.com/' },
      { name: 'Russell Stover Candies', url: 'https://www.russellstover.com/' },
      { name: 'Montrose County School District', url: 'https://www.mcsd.org/' },
      { name: 'Telluride Ski Resort (commuters)', url: 'https://www.tellurideskiresort.com/' }
    ]
  },
  // ── San Luis Valley anchors ──
  '08003': {  // Alamosa
    source_label: 'SLV Development Resources Group',
    source_url:   'https://www.slvdrg.org/',
    employers: [
      { name: 'San Luis Valley Health', url: 'https://slvrmc.org/',
        note: 'Largest SLV employer' },
      { name: 'Adams State University', url: 'https://www.adams.edu/' },
      { name: 'Alamosa School District', url: 'https://www.alamosaschools.org/' },
      { name: 'Alamosa County Government', url: 'https://alamosacounty.org/' }
    ]
  },
  // ── Chaffee (08015) — Salida + Buena Vista ──
  '08015': {
    source_label: 'Chaffee County EDC',
    source_url:   'https://chaffeeedc.org/',
    employers: [
      { name: 'Heart of the Rockies Regional Medical Center', url: 'https://www.hrrmc.com/' },
      { name: 'Salida School District', url: 'https://www.salidaschools.org/' },
      { name: 'Buena Vista School District', url: 'https://www.bvschools.org/' },
      { name: 'Buena Vista Correctional Complex (state prison)', url: 'https://cdoc.colorado.gov/' },
      { name: 'Chaffee County Government', url: 'https://www.chaffeecounty.org/' }
    ]
  },
  // ── San Miguel (08113) — Telluride ──
  '08113': {
    source_label: 'San Miguel County',
    source_url:   'https://www.sanmiguelcountyco.gov/',
    employers: [
      { name: 'Telluride Ski Resort', url: 'https://www.tellurideskiresort.com/' },
      { name: 'Town of Telluride', url: 'https://www.telluride-co.gov/' },
      { name: 'Mountain Village (resort + town gov)', url: 'https://townofmountainvillage.com/' },
      { name: 'San Miguel County Government', url: 'https://www.sanmiguelcountyco.gov/' },
      { name: 'Telluride Regional Medical Center', url: 'https://www.tellmed.org/' }
    ]
  },
  // ── Archuleta (08007) — Pagosa Springs ──
  '08007': {
    source_label: 'Pagosa Springs Chamber + Region 9',
    source_url:   'https://www.pagosachamber.com/',
    employers: [
      { name: 'Pagosa Springs Medical Center', url: 'https://pagosaspringsmedicalcenter.org/' },
      { name: 'Wolf Creek Ski Area', url: 'https://wolfcreekski.com/' },
      { name: 'Archuleta School District', url: 'https://www.mypagosaschools.com/' },
      { name: 'Archuleta County Government', url: 'https://www.archuletacounty.org/' },
      { name: 'Town of Pagosa Springs', url: 'https://www.townofpagosasprings.com/' }
    ]
  },
  // ── Lake (08065) — Leadville ──
  '08065': {
    source_label: 'Lake County / Climax Mine',
    source_url:   'https://www.lakecountyco.com/',
    employers: [
      { name: 'Climax Molybdenum Mine (Freeport-McMoRan)', url: 'https://www.fcx.com/',
        note: 'Largest single employer in Lake County' },
      { name: 'St. Vincent General Hospital', url: 'https://stvincentgrants.org/' },
      { name: 'Colorado Mountain College (Leadville campus)', url: 'https://coloradomtn.edu/' },
      { name: 'Lake County School District', url: 'https://www.lakecountyschools.net/' },
      { name: 'Lake County Government', url: 'https://www.lakecountyco.com/' }
    ]
  }
};

let augmented = 0;
Object.entries(COUNTY_EMPLOYERS).forEach(([fips, seed]) => {
  const key = 'county:' + fips;
  if (!data[key]) data[key] = {};
  const entry = data[key];
  // Backfill only — don't overwrite existing curated content
  if (!Array.isArray(entry.majorEmployers) || !entry.majorEmployers.length) {
    entry.majorEmployers = seed.employers;
    entry._employers_source = { label: seed.source_label, url: seed.source_url };
    augmented++;
  }
});

fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log('Seeded majorEmployers on', augmented, 'county entries.');
console.log('Coverage now: counties with majorEmployers =', Object.keys(data).filter(k =>
  k.startsWith('county:') && Array.isArray(data[k].majorEmployers) && data[k].majorEmployers.length
).length);
