/**
 * IndiBuild Password Gate
 * ==========================================================================
 * Bridge auth for the /indibuild* pages until Cloudflare Access is set up.
 *
 * HOW IT WORKS
 *   1. Load on every IndiBuild page (via <script src="js/indibuild-gate.js">
 *      placed BEFORE all other scripts).
 *   2. If sessionStorage has 'ib-auth' set, do nothing — page renders normally.
 *   3. Otherwise hide the page body, show a centered password prompt.
 *   4. On submit, SHA-256 hash the input + compare to PASSWORD_HASH below.
 *   5. Match → set sessionStorage + reload. Mismatch → shake + reset field.
 *
 * SECURITY
 *   This is "security through obscurity" — a determined attacker with
 *   DevTools can:
 *     (a) read the hash and brute-force it, OR
 *     (b) just set sessionStorage manually to bypass.
 *   It WILL keep casual visitors out. It will NOT keep a competitor out.
 *   Replace with Cloudflare Access for real auth (docs/CLOUDFLARE-SETUP.md).
 *
 * TO CHANGE THE PASSWORD
 *   1. Pick a new password.
 *   2. Run:  node -e "console.log(require('crypto').createHash('sha256').update('YOUR-PASSWORD').digest('hex'))"
 *   3. Replace PASSWORD_HASH below with the new hash.
 *   4. Commit + push.
 *
 * DEFAULT PASSWORD: salida2026
 */
(function () {
  'use strict';

  // SHA-256 of "salida2026". Change after first use.
  const PASSWORD_HASH = '029fb5d4a8a29de1c16bcb718162284a45adf69fc12916613f28b2d037a19119';
  const STORAGE_KEY = 'ib-auth-v1';
  const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

  // ---- Check existing auth
  function isAuthed() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const v = JSON.parse(raw);
      return v && v.ts && (Date.now() - v.ts < SESSION_DURATION_MS);
    } catch (_) { return false; }
  }

  // F161 — Expose a tiny public API on the global so any page (including
  // public ones like Opportunity Finder) can detect whether the visitor
  // already has a live IndiBuild session, and conditionally surface
  // gated affordances (e.g. the "Add to Pipeline" button on OF detail).
  // The check is read-only — no auth bypass, no state mutation.
  window.IndiBuildGate = window.IndiBuildGate || {};
  window.IndiBuildGate.isAuthed = isAuthed;

  if (isAuthed()) return;

  // ---- Hide the page IMMEDIATELY (before paint)
  const styleTag = document.createElement('style');
  styleTag.textContent = 'html.ib-locked body > * { display: none !important; } html.ib-locked body { background: var(--bg, #f7fafc); }';
  document.documentElement.appendChild(styleTag);
  document.documentElement.classList.add('ib-locked');

  // ---- Build the prompt once DOM is ready
  function buildPrompt() {
    const wrap = document.createElement('div');
    wrap.id = 'ib-gate';
    wrap.setAttribute('style',
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(135deg,#0c4a6e,#155e75);z-index:99999;font-family:system-ui,-apple-system,sans-serif;');

    wrap.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:2rem 2.2rem;box-shadow:0 25px 60px rgba(0,0,0,.35);max-width:380px;width:90%;">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:1.2rem;">
          <span style="font-size:1.4rem;">🔒</span>
          <h1 style="margin:0;font-size:1.1rem;font-weight:800;color:#0c4a6e;">Developer Access</h1>
        </div>
        <p style="margin:0 0 1rem;font-size:.85rem;line-height:1.5;color:#475569;">
          Internal tool for tracking affordable + workforce housing opportunities.
          Enter the developer password to continue.
        </p>
        <form id="ib-gate-form" style="display:flex;flex-direction:column;gap:.6rem;">
          <input id="ib-gate-pw" type="password" autofocus autocomplete="current-password"
            placeholder="Password"
            style="padding:.6rem .8rem;border:1px solid #cbd5e1;border-radius:6px;font-size:.95rem;outline:none;">
          <button type="submit"
            style="padding:.6rem 1rem;background:#0c4a6e;color:#fff;border:none;border-radius:6px;font-size:.92rem;font-weight:700;cursor:pointer;">
            Unlock
          </button>
        </form>
        <p id="ib-gate-err" style="margin:.6rem 0 0;font-size:.78rem;color: var(--bad);min-height:1rem;"></p>
        <p style="margin:1.5rem 0 0;font-size:.7rem;color:#94a3b8;text-align:center;line-height:1.4;">
          Lost the password? See <code>js/indibuild-gate.js</code> in the repo.
        </p>
      </div>
    `;
    document.body.appendChild(wrap);
    // Reveal — but only the gate, body children stay hidden via class
    styleTag.textContent = 'html.ib-locked body > *:not(#ib-gate) { display: none !important; } html.ib-locked body { background: #0c4a6e; }';

    const form = document.getElementById('ib-gate-form');
    const pwInput = document.getElementById('ib-gate-pw');
    const errEl = document.getElementById('ib-gate-err');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = pwInput.value;
      if (!pw) return;
      const buf = new TextEncoder().encode(pw);
      const hashBuf = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex === PASSWORD_HASH) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now() }));
        location.reload();
      } else {
        errEl.textContent = 'Incorrect password.';
        pwInput.value = '';
        pwInput.focus();
        wrap.style.animation = 'none';
        // tiny shake
        wrap.animate([
          { transform: 'translateX(0)' },
          { transform: 'translateX(-8px)' },
          { transform: 'translateX(8px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(0)' }
        ], { duration: 280 });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPrompt);
  } else {
    buildPrompt();
  }
})();
