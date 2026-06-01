# `js/indibuild-gate.js`

IndiBuild Password Gate
==========================================================================
Bridge auth for the /indibuild* pages until Cloudflare Access is set up.

HOW IT WORKS
  1. Load on every IndiBuild page (via <script src="js/indibuild-gate.js">
     placed BEFORE all other scripts).
  2. If sessionStorage has 'ib-auth' set, do nothing — page renders normally.
  3. Otherwise hide the page body, show a centered password prompt.
  4. On submit, SHA-256 hash the input + compare to PASSWORD_HASH below.
  5. Match → set sessionStorage + reload. Mismatch → shake + reset field.

SECURITY
  This is "security through obscurity" — a determined attacker with
  DevTools can:
    (a) read the hash and brute-force it, OR
    (b) just set sessionStorage manually to bypass.
  It WILL keep casual visitors out. It will NOT keep a competitor out.
  Replace with Cloudflare Access for real auth (docs/CLOUDFLARE-SETUP.md).

TO CHANGE THE PASSWORD
  1. Pick a new password.
  2. Run:  node -e "console.log(require('crypto').createHash('sha256').update('YOUR-PASSWORD').digest('hex'))"
  3. Replace PASSWORD_HASH below with the new hash.
  4. Commit + push.

DEFAULT PASSWORD: salida2026

_No documented symbols — module has a file-header comment only._
