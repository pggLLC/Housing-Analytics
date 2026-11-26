'use strict';
// A deal file's `url` carries the deal in the fragment ("#v=1&..."), as Copy
// link does: in the query a full deal drew HTTP 414 (Codex delta check D1,
// 2026-11-26). Links made before then carry it in the query and still open.
// These tests read and edit the settings as query parameters, so asQuery
// turns the fragment link into that older query form, which the page opens
// the same way.
function asQuery(link) {
  const u = new URL(link);
  const h = u.hash.replace(/^#/, '');
  if (h.indexOf('v=1&') !== 0) return u.toString();
  u.hash = '';
  u.search = '?' + h.slice(4);
  return u.toString();
}
module.exports = { asQuery };
