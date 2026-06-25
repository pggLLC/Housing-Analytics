#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/navigation.js', 'utf8');

assert(
  source.includes("location.pathname.includes('/places/')"),
  'navigation assets and links must resolve from place-profile subdirectories'
);
assert(
  source.includes("if (location.pathname.includes('/places/')) return '../';"),
  'place profiles must back out one directory before loading shared navigation assets'
);

console.log('Navigation nested-page paths: PASS');
