// js/address-geocode.js: one Colorado address lookup for every map with an address box.
//
// 1. The US Census Geocoder (free, no key) finds the house number on its address ranges. It sends no
//    CORS headers, so the browser asks it the JSONP way, as its documentation says
//    (https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf).
// 2. When Census has no Colorado match, which happens on streets newer than its address list
//    (new subdivisions, some county and grid roads), OpenStreetMap's Nominatim is asked once,
//    one request per Enter as its usage policy asks
//    (https://nominatim.org/release-docs/latest/api/Search/). Its answer is used only if the street name it returns is the street that was
//    typed, so "County Road 233" never lands on County Road 320. When OpenStreetMap knows the
//    street but not the house number, the answer says the pin is on the street, not at the door.
//
// CohoGeocode.find(text) resolves { lon, lat, label, source: 'census' | 'osm', exact } or null,
// and rejects only when neither service answered. CohoGeocode.street and .sameStreet are exported
// for the checks.
(function (global) {
  'use strict';

  var CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
  var OSM = 'https://nominatim.openstreetmap.org/search';
  // A search area, not a map frame: Colorado's box with a few hundred metres to spare, so an address on
  // the state line is not cut off. The map decides afterwards whether the point is in Colorado.
  var CO_BOX = '-109.1,41.05,-102,36.95';
  var TYPE = /^(road|rd|street|st|avenue|ave|av|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|way|place|pl|highway|hwy|trail|trl|parkway|pkwy|terrace|ter|loop|county|cnty|cr|co|state|sh|us|n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest|the)$/;

  function inColorado(lon, lat) { return lon <= -102 && lon >= -109.1 && lat >= 36.95 && lat <= 41.05; }
  function withState(text) { return /\b(co|colorado)\b/i.test(text) ? text : text + ', CO'; }

  // Lower case with accents dropped, so "Cañon City" and "Canon City" read the same.
  function fold(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  // Street directions, in short form: "123 West Colfax Ave" -> ['w'].
  var DIR = { n: 'n', s: 's', e: 'e', w: 'w', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw', north: 'n', south: 's', east: 'e', west: 'w',
    northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
  function dirs(text) {
    return fold(String(text || '').split(',')[0]).split(/[^a-z0-9]+/)
      .filter(function (w) { return Object.prototype.hasOwnProperty.call(DIR, w); }).map(function (w) { return DIR[w]; });
  }
  // The words of the street part (before the first comma), without road-type or direction words, and
  // with a Mesa County half road ("18 1/2") kept as one token: "45 Kestrel Ridge Road, Penrose" ->
  // ['45', 'kestrel', 'ridge']; "1340 18 1/2 Rd" -> ['1340', '18half']; "200 Avenue A" -> ['200', 'a'].
  function street(text) {
    return fold(String(text || '').split(',')[0]
      .replace(/\b(\d+)\s*(1\/2|\u00bd)/g, '$1half'))
      .replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/)
      .filter(function (w) { return w && !TYPE.test(w); });
  }
  var NUM = /^\d/;
  function close(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1 || a.length < 5 || /\d/.test(a + b)) return false;
    var i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  // The returned street is the typed one when every number in it was typed (so "19 Road" never stands
  // in for "18 Road", nor County Road 320 for 233) and every typed word is in it, allowing one wrong
  // letter in a long word, and every word of it was typed. The typed text may carry one extra
  // leading number, its house number, and, when it has no comma, a trailing town, state and ZIP:
  // once the street words run out, the rest must all be words of the returned place (town, county, ZIP) or "Colorado". A typed ZIP must be
  // the returned one, when one came back. A direction given on both sides must agree, so East Colfax
  // is never taken for West Colfax; a direction on one side only is allowed, as the two services
  // often leave it out.
  function sameStreet(typed, road, place) {
    var want = street(typed), have = street(road);
    var where = fold(place).split(/[^a-z0-9]+/).filter(Boolean).concat(['colorado']);
    var zips = where.filter(function (w) { return /^8\d{4}$/.test(w); });
    if (!have.length) return !want.length;
    var dt = dirs(typed), dh = dirs(road);
    if (dt.length && dh.length && !dt.some(function (d) { return dh.indexOf(d) > -1; })) return false;
    if (!have.filter(function (h) { return NUM.test(h); }).every(function (h) { return want.indexOf(h) > -1; })) return false;
    if (want.length > 1 && NUM.test(want[0]) && have.indexOf(want[0]) < 0) want = want.slice(1);
    var used = [], tail = false;
    for (var i = 0; i < want.length; i++) {
      var w = want[i];
      if (!tail && have.some(function (h) { return close(w, h); })) { used.push(w); continue; }
      if (used.length && (where.indexOf(w) > -1 || (/^8\d{4}$/.test(w) && !zips.length))) { tail = true; continue; }
      return false;
    }
    // And the other way: every word of the returned street was typed, so "Old Main Street" is not
    // taken for "Main Street".
    return used.length > 0 && have.every(function (h) { return used.some(function (w) { return close(w, h); }); });
  }

  // The town and ZIP typed after the street (after a comma) must not contradict the returned place.
  // When both were typed, one agreeing is enough, since ZIP areas and town limits differ.
  function samePlace(typed, place, postcode) {
    var after = fold(String(typed || '').split(',').slice(1).join(' '));
    var zip = (after.match(/\b(8\d{4})\b/) || [])[1];
    var town = after.replace(/\b(co|colorado|usa|us|8\d{4})\b/g, ' ').split(/[^a-z]+/).filter(Boolean);
    var words = fold(place).split(/[^a-z0-9]+/);
    var pc = String(postcode || '').slice(0, 5);
    var zipOk = !zip || !pc ? null : zip === pc;
    var townOk = !town.length ? null : town.every(function (w) { return words.indexOf(w) > -1; });
    if (zipOk === null) return townOk !== false;
    if (townOk === null) return zipOk;
    return zipOk || townOk;
  }

  var n = 0;
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__cohoGeocode' + (++n), s = global.document.createElement('script'), done = false;
      var timer = setTimeout(function () { finish(); reject(new Error('timeout')); }, 12000);
      function finish() { done = true; clearTimeout(timer); try { delete global[name]; } catch (e) { global[name] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      global[name] = function (d) { if (done) return; finish(); resolve(d); };
      s.onerror = function () { if (done) return; finish(); reject(new Error('blocked')); };
      s.src = url + '&callback=' + name;
      global.document.head.appendChild(s);
    });
  }

  function census(text) {
    return jsonp(CENSUS + '?address=' + encodeURIComponent(text) + '&benchmark=Public_AR_Current&format=jsonp').then(function (d) {
      var zip = (text.match(/\b(8\d{4})\b/) || [])[1];
      var town = fold(String(text).split(',')[1]).replace(/\b(co|colorado|8\d{4})\b/g, '').replace(/[^a-z\s]/g, '').trim();
      var m = ((d && d.result && d.result.addressMatches) || []).filter(function (x) {
        var a = x.addressComponents || {};
        if (String(a.state).toUpperCase() !== 'CO') return false;
        // Census sometimes answers a street it cannot find with another street in another town
        // ("18 Road and K Road, Fruita" came back as a road in Cortez). A typed ZIP or town that
        // disagrees, with a street that does not match either, means it guessed. Census spells
        // some street words its own way, so a matching town and ZIP is enough on its own.
        var otherPlace = (zip && a.zip && a.zip !== zip) || (town && a.city && fold(a.city) !== town);
        return !(otherPlace && !sameStreet(text, x.matchedAddress, [a.city, a.zip].join(' ')));
      })[0];
      if (!m) return null;
      return { lon: Number(m.coordinates.x), lat: Number(m.coordinates.y), label: m.matchedAddress, source: 'census', exact: true };
    });
  }

  function osm(text) {
    if (typeof global.fetch !== 'function') return Promise.resolve(null);
    var url = OSM + '?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&bounded=1&viewbox=' + CO_BOX + '&q=' + encodeURIComponent(text);
    return global.fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var num = (String(text).trim().match(/^(\d+[a-z]?)\b/i) || [])[1];
      var hit = (list || []).filter(function (x) {
        var a = x.address || {}, lon = Number(x.lon), lat = Number(x.lat);
        return a.state === 'Colorado' && inColorado(lon, lat) && a.road &&
          sameStreet(text, a.road, [a.city, a.town, a.village, a.hamlet, a.suburb, a.county, a.postcode].join(' ')) &&
          samePlace(text, [a.city, a.town, a.village, a.hamlet, a.suburb, a.county].join(' '), a.postcode);
      })[0];
      if (!hit) return null;
      var a = hit.address, town = a.city || a.town || a.village || a.hamlet || a.county || '';
      var exact = !!(num && a.house_number && String(a.house_number).toLowerCase() === num.toLowerCase());
      // A street-only answer says so in its own label, which the maps show beside the pin.
      var label = (exact ? a.house_number + ' ' : '') + a.road + (town ? ', ' + town : '') + ', CO' + (a.postcode ? ' ' + a.postcode : '') +
        (exact ? '' : ' (street only: house number not mapped yet)');
      return { lon: Number(hit.lon), lat: Number(hit.lat), label: label, source: 'osm', exact: exact };
    });
  }

  function find(text) {
    var q = withState(String(text || '').trim()), censusDown = false;
    return census(q).catch(function () { censusDown = true; return null; }).then(function (hit) {
      if (hit) return hit;
      return osm(q).catch(function (err) { if (censusDown) throw err; return null; });
    });
  }

  // What to say beside the pin, so a street-only answer is never read as the door.
  function note(hit) {
    if (!hit) return '';
    if (hit.source === 'census') return 'Found by the US Census Geocoder: ' + hit.label + '.';
    return hit.exact
      ? 'Found on OpenStreetMap: ' + hit.label + '. The Census address list does not have it yet.'
      : 'Close, not exact: OpenStreetMap knows ' + hit.label.replace(/ \(street only[^)]*\)$/, '') + ' but not this house number, so the pin is on the street. Tap or click the map to move it.';
  }

  var api = { find: find, note: note, street: street, sameStreet: sameStreet, samePlace: samePlace };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.CohoGeocode = api;
})(typeof window !== 'undefined' ? window : globalThis);
