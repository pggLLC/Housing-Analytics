// The address lookup's street check (js/address-geocode.js): which typed streets match which returned street names.
// No network: the two services are exercised in the lab data-map check with local answers.
const G = require('../js/address-geocode.js');
const fails = []; let n = 0;
const check = (ok, msg) => { n++; if (!ok) fails.push(msg); };
const same = (typed, road, want, place) => check(G.sameStreet(typed, road, place) === want, typed + ' vs ' + road + ': expected ' + want);

check(JSON.stringify(G.street('45 Kestrel ridge road, penrose, colorado 81240')) === '["45","kestrel","ridge"]', 'street words: ' + G.street('45 Kestrel ridge road, penrose'));
check(JSON.stringify(G.street('1340 18 1/2 Rd, Fruita, CO')) === '["1340","18half"]', 'half road is one token');
check(JSON.stringify(G.street('0039 County Road 17, Hesperus')) === '["0039","17"]', 'county road keeps its number');
same('45 Kestrel ridge road, penrose', 'Kestrel Ridge Road', true);
same('45 Kestral Ridge Rd, Penrose', 'Kestrel Ridge Road', true); // one letter off in a long word
same('1340 18 Rd, Fruita', '18 Road', true);
same('2310 County Road 233, Rifle', 'County Road 320', false); // numbers never fuzzy-match
same('16900 Hwy 172, Ignacio', 'HWY 172', true);
same('325 E Aspen Ave, Fruita', '325 E ASPEN AVE', true);
same('214 Grand Ave, Paonia', 'Main Street', false);
same('18 Road and K Road, Fruita', 'ROAD S & RD S', false);
same('18 Road and K Road, Fruita', '19 Road and K Road', false); // a numbered road is the street, not a house number
same('1340 18 1/2 Rd, Fruita', '18 1/2 Road', true);              // half roads keep their number
same('1340 18 1/2 Rd, Fruita', '18 Road', false);
same('0039 County Road 17, Hesperus', 'County Road 17', true);
same('200 Avenue A, Pueblo, CO', 'Avenue A', true);               // house number before a prefix-style name
same('200 Avenue A, Pueblo, CO', 'Avenue B', false);
// No commas: the town, state and ZIP after the street are allowed when they are the returned place's.
same('45 Kestrel Ridge Road Penrose CO 81240', 'Kestrel Ridge Road', true, 'Penrose Fremont County 81240');
same('123 Main Street Nucla Colorado', 'Main Street', true, 'Nucla Montrose County 81424');
same('45 Kestrel Ridge Road Canon City CO', 'Kestrel Ridge Road', false, 'Penrose Fremont County 81240');
same('45 Kestrel Penrose', 'Penrose Road', false, 'Penrose');
same('123 Main Street, Nucla, CO', 'Old Main Street', false, 'Nucla'); // every returned word must be typed too
same('123 Old Main Street, Nucla, CO', 'Old Main Street', true, 'Nucla');
// The typed town and ZIP must not contradict the returned place (both typed: one agreeing is enough).
const place = (typed, town, pc, want) => check(G.samePlace(typed, town, pc) === want, typed + ' in ' + town + ' ' + pc + ': expected ' + want);
place('123 Main Street, Nucla, CO 81424', 'Montrose Montrose County', '81401', false);
place('123 Main Street, Nucla, CO 81424', 'Nucla Montrose County', '81424', true);
place('123 Main Street, Nucla, CO', 'Montrose Montrose County', '81401', false);
place('123 Main Street, CO 81424', 'Montrose Montrose County', '81401', false);
place('123 Main Street, Clifton, CO 81520', 'Grand Junction Mesa County', '81520', true);
place('45 Kestrel Ridge Rd, Canon City', 'Cañon City Fremont County', '', true);
place('123 Main Street', 'Montrose', '81401', true);
// Accents typed by the user read the same as plain letters, in the town, the comma-free tail and the street.
place('123 Main Street, Cañon City, CO', 'Cañon City Fremont County', '81212', true);
place('123 Main Street, Cañon City, CO', 'Canon City Fremont County', '', true);
place('123 Main Street, Cañon City, CO', 'Florence Fremont County', '81226', false);
same('45 Kestrel Ridge Road Cañon City CO', 'Kestrel Ridge Road', true, 'Cañon City Fremont County 81212');
// A direction given on both sides must agree; one side only is allowed.
same('123 East Colfax Avenue, Denver', 'West Colfax Avenue', false);
same('123 E Colfax Ave, Denver', 'East Colfax Avenue', true);
same('123 Colfax Ave, Denver', 'East Colfax Avenue', true);
same('123 E Colfax Ave, Denver', 'Colfax Avenue', true);
same('500 SW 2nd St, Cortez', 'Northwest 2nd Street', false);
// A road type given on both sides must agree (Street/St agree; Street/Avenue do not).
same('123 Main Street, Montrose', 'Main Avenue', false);
same('123 Main St, Montrose', 'Main Street', true);
same('2310 CR 233, Rifle', 'County Road 233', true);
same('123 North Ave, Grand Junction', 'North Street', false);
// A letter or direction right before a road type, with only numbers before it, names the road.
check(JSON.stringify(G.street('3200 E Road, Clifton')) === '["3200","e"]', 'lettered road keeps its letter: ' + G.street('3200 E Road, Clifton'));
check(JSON.stringify(G.street('3200 E 1/2 Road, Clifton')) === '["3200","ehalf"]', 'lettered half road is one token: ' + G.street('3200 E 1/2 Road, Clifton'));
check(JSON.stringify(G.street('123 E Main St')) === '["123","main"]', 'a direction before a named street is still dropped');
same('3200 E Road, Clifton, CO 81520', 'E Road', true);
same('3200 E Road Clifton CO 81520', 'E Road', true, 'Clifton Mesa County 81520');
same('3200 E Road, Clifton', 'F Road', false);
same('3200 E 1/2 Road, Clifton', 'E Road', false);
same('123 North Ave, Grand Junction', 'North Avenue', true);
// A comma-free ZIP must be the returned one, when one came back.
same('123 Main Street CO 81424', 'Main Street', false, 'Montrose Montrose County 81401');
same('123 Main Street CO 81401', 'Main Street', true, 'Montrose Montrose County 81401');
same('123 Main Street Montrose CO 81424', 'Main Street', false, 'Montrose Montrose County 81401');
same('123 Main Street CO 81424', 'Main Street', true, 'Nucla Montrose County');
check(JSON.stringify(G.street('12 Peñasco Rd, Antonito')) === '["12","penasco"]', 'street words drop accents: ' + G.street('12 Peñasco Rd, Antonito'));
check(/street/.test(G.note({ source: 'osm', exact: false, label: 'Kestrel Ridge Road, Penrose, CO' })), 'street-only note says the pin is on the street');

// The whole lookup with Census unreachable (no page here) and mocked OpenStreetMap answers: an answer
// in Cañon City is found by the accented and plain spellings but not by a Florence query; a West
// Colfax answer not by East Colfax; a Montrose 81401 answer not by a comma-free 81424; a Main Avenue
// answer not by Main Street; and an E Road answer by an E Road query.
const osmAnswer = [{ lat: '38.44', lon: '-105.24', display_name: 'Main Street, Cañon City, CO', address: { road: 'Main Street', city: 'Cañon City', county: 'Fremont County', state: 'Colorado', postcode: '81212' } }];
const answers = {
  canon: osmAnswer,
  colfax: [{ lat: '39.74', lon: '-105.0', display_name: 'West Colfax Avenue, Denver, CO', address: { road: 'West Colfax Avenue', city: 'Denver', county: 'Denver County', state: 'Colorado', postcode: '80204' } }],
  montrose: [{ lat: '38.48', lon: '-107.88', display_name: 'Main Street, Montrose, CO', address: { road: 'Main Street', city: 'Montrose', county: 'Montrose County', state: 'Colorado', postcode: '81401' } }],
  avenue: [{ lat: '38.48', lon: '-107.88', display_name: '123, Main Avenue, Montrose, CO', address: { house_number: '123', road: 'Main Avenue', city: 'Montrose', county: 'Montrose County', state: 'Colorado', postcode: '81401' } }],
  eroad: [{ lat: '39.08', lon: '-108.45', display_name: '3200, E Road, Clifton, CO', address: { house_number: '3200', road: 'E Road', village: 'Clifton', county: 'Mesa County', state: 'Colorado', postcode: '81520' } }],
};
const ask = (key, q) => { globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(answers[key]) }); return G.find(q).catch(() => null); };
const queries = [['canon', '123 Main Street, Cañon City, CO'], ['canon', '123 Main Street, Canon City, CO'], ['canon', '123 Main Street, Florence, CO'],
  ['colfax', '123 East Colfax Avenue, Denver, CO'], ['colfax', '123 West Colfax Avenue, Denver, CO'], ['montrose', '123 Main Street CO 81424'], ['montrose', '123 Main Street CO 81401'],
  ['avenue', '123 Main Street, Montrose, CO 81401'], ['eroad', '3200 E Road, Clifton, CO 81520']];
queries.reduce((prev, [key, q]) => prev.then((out) => ask(key, q).then((hit) => out.concat([hit]))), Promise.resolve([]))
  .then(([accented, plain, other, east, west, zipOff, zipOn, avenue, eroad]) => {
    check(accented && accented.source === 'osm', 'find: accented Cañon City query should resolve');
    check(plain && plain.source === 'osm', 'find: plain Canon City query should resolve');
    check(other === null, 'find: Florence query should not take a Cañon City answer');
    check(east === null, 'find: East Colfax query should not take a West Colfax answer');
    check(west && west.source === 'osm', 'find: West Colfax query should resolve');
    check(zipOff === null, 'find: comma-free 81424 query should not take a Montrose 81401 answer');
    check(zipOn && zipOn.source === 'osm', 'find: comma-free 81401 query should resolve');
    check(avenue === null, 'find: Main Street query should not take a Main Avenue answer');
    check(eroad && eroad.exact === true, 'find: 3200 E Road query should take the E Road answer, to the house');
    console.log(fails.length ? 'geocode: FAIL ' + fails.length + '/' + n + '\n  ' + fails.join('\n  ') : 'geocode: PASS ' + n + ' checks');
    process.exit(fails.length ? 1 : 0);
  });
