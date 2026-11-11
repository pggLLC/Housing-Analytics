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
check(/street/.test(G.note({ source: 'osm', exact: false, label: 'Kestrel Ridge Road, Penrose, CO' })), 'street-only note says the pin is on the street');

console.log(fails.length ? 'geocode: FAIL ' + fails.length + '/' + n + '\n  ' + fails.join('\n  ') : 'geocode: PASS ' + n + ' checks');
process.exit(fails.length ? 1 : 0);
