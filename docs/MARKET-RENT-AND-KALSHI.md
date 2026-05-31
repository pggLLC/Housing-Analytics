# Market rent reality + Kalshi role

**Status:** decision document · 2026-05-31
**Audience:** developer + analyst deciding whether HUD FMR is the right benchmark and what free data sources would improve "real market" signal.

---

## TL;DR

| Question | Answer |
|---|---|
| Does HUD FMR reflect the actual market in each jurisdiction? | **No.** It's a 40th-percentile gross rent published at the HUD-defined "FMR area" level, lagged 2-3 years, and biased low by statute (voucher-funding constraint). Adequate as a floor; misleading as a market median. |
| Best free / open-source alternatives to validate market rent? | **HUD SAFMR + Apartment List Rent Index + Zillow ZORI + DOLA Apartment Rent Survey**, in that order. All four are free, all four are at city / ZIP / county granularity (finer than HUD's metro-FMR areas), and all four refresh more often than HUD FMR. |
| Should we use Kalshi? | **Yes — for rates / macro sentiment only**, surfaced on the Economic Dashboard. Not for jurisdiction-level rent forecasting (Kalshi doesn't trade those). |
| What's the "achievable rent" concept for 70% / 80% AMI? | The CHFA QAP requires you to underwrite at the LOWER of (LIHTC ceiling) and (achievable market rent). For workforce / 70% / 80% units where LIHTC ceiling > market rent, you have to use market. Today the Deal Calc uses LIHTC ceilings only. Adding an "achievable rent cap" toggle is the next-best deal-calc upgrade. |

---

## 1. Why FMR doesn't reflect market

HUD's Fair Market Rent (FY25 published October 2024) is computed as the **40th-percentile gross rent (rent + utilities) for standard-quality recent-mover rental units** in each HUD-defined FMR area.

**Three properties that bias FMR low vs actual market:**

| Bias source | Effect | Magnitude in CO |
|---|---|---|
| **40th-percentile by design** | FMR is intentionally a "fair" voucher rate, not a market median. It's NEAR the bottom of the market. | ~10-15% below median asking rent in tight markets |
| **2-3 year ACS lag** | FY25 FMR uses 2022 ACS 5-year rents + a CPI trend adjustment. Doesn't catch 2024 oversupply (Denver) or 2024 resort-county explosion (Steamboat, Telluride). | ±5-15% depending on market direction |
| **FMR-area geographic blunting** | Denver-Aurora-Lakewood Metro FMR averages Denver + Adams + Arapahoe + Boulder + Broomfield + Clear Creek + Douglas + Elbert + Gilpin + Park into ONE number. Boulder rents are 30%+ higher than the metro average. | ±20-30% within a single FMR area |

**Net result:** FMR is a usable floor (good for showing "the market would pay AT LEAST this much"). It is a poor ceiling estimate.

**Where this shows up in the OF / Deal Calc:**
- OF "Capture" column = FMR 2BR − LIHTC 60% AMI 2BR. Negative capture in rural CO doesn't necessarily mean the deal can't lease — it means FMR is artificially low and you need a real market study.
- Deal Calc rent revenue assumes the LIHTC ceiling is achievable. In rural counties it isn't (market often lower); in tight metros (Boulder, Aspen, Vail), the LIHTC ceiling is well BELOW achievable market and you could underwrite 70/80% AMI units at a higher rent than the LIHTC ceiling for those tiers anyway.

---

## 2. Best free / open-source market-rent sources

Ranked by analytical value for CO LIHTC underwriting:

### 2a. HUD SAFMR (Small Area FMR) — best near-term unlock

**What it is.** HUD publishes Fair Market Rents at the ZIP-code level for ~22 metros, including Denver-Aurora-Lakewood. The standard FMR averages all ZIP codes in the metro; SAFMR breaks it back out so Boulder ZIP 80302 has its own FMR distinct from Aurora 80014.

**Where to get it.**
- `https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html` (free, public, annual update aligned with FMR cycle)
- Covers Denver-Aurora-Lakewood HUD Metro FMR Area only. Other CO areas use the standard metro / county FMR.

**Effort.** Half a day. Same data shape as FMR; just add ZIP-keyed parsing to `scripts/build_hud_fmr_income_limits.py`.

**Analytical value.** **High** for Denver-metro deals. The current Denver-Aurora-Lakewood FMR ($1,802 2BR) understates Boulder ($2,150+) and overstates outer Arapahoe ($1,600-).

### 2b. Apartment List Rent Index

**What it is.** Apartment List publishes a monthly Rent Index for the top ~250 metros AND city-level data for ~150 cities. CO cities tracked: Denver, Aurora, Boulder, Colorado Springs, Fort Collins, Lakewood, Thornton, Westminster, Pueblo, Greeley.

**Where to get it.**
- `https://www.apartmentlist.com/research/category/data-rent-estimates` (free CSV download, monthly)
- Methodology published — they aggregate from their listing platform + ACS calibration.

**Effort.** 1-2 hours. CSV download + place-name → place GEOID mapping (already have place centroids).

**Analytical value.** **High** for the 10 CO cities they track. Monthly refresh catches market shifts FMR misses for 2-3 years.

**Caveat.** Their definition is "median rent for a 2BR" — close to but not identical to HUD's "40th percentile gross rent." Document the methodology gap.

### 2c. Zillow ORI (Observed Rent Index) / ZORI

**What it is.** Zillow's smoothed seasonally-adjusted index of rents from listings on their platform. ZIP, city, metro, and county levels. Monthly.

**Where to get it.**
- `https://www.zillow.com/research/data/` (free CSV download per geography level)
- Methodology paper public.

**Effort.** 2-3 hours. ZIP-level data needs ZIP → place mapping; city-level data is easier.

**Analytical value.** **High** for the 30+ CO cities they cover. Complements Apartment List for triangulation. ZORI is a smoothed index, so absolute level needs calibration against ZORI's base period.

### 2d. CO Division of Housing — Apartment Rent Survey

**What it is.** Twice-yearly (Spring + Fall) Colorado-specific multifamily rent survey by region. Published by CO DOLA's Division of Housing.

**Where to get it.**
- `https://drive.google.com/drive/folders/0AKW2vKy-vmbeUk9PVA` (CDOH public archive)
- Or contact `dola.dohinfo@state.co.us` for the latest report

**Effort.** Half a day per release (manual download → PDF parse → CSV).

**Analytical value.** **High** — this is a Colorado-specific survey, so it captures regional dynamics (mountain resort, Western Slope, Eastern Plains, Front Range) that national datasets average out. Already used by CHFA for QAP scoring.

**Caveat.** Lower granularity (region not place) than Apartment List / ZORI, but the regional view is exactly what CHFA underwriters use.

### 2e. Other (lower priority)

| Source | Why lower priority |
|---|---|
| BLS CPI for Rent | Gives % change, not levels. Useful for trend signal in Economic Dashboard but doesn't tell you "what does a 2BR cost in Boulder?" |
| FRED housing series | Same — index data, not jurisdictional levels |
| Realtor.com market reports | Sales-focused, rental data is thin |
| CoStar / RealPage / MPF Research | Paid (CoStar starts at $1,000+/month). Industry standard but not free |

---

## 3. Kalshi — where it actually adds value

**What Kalshi is.** A federally-regulated prediction market exchange. Users trade contracts that pay $1 if an event occurs by a specified date. Kalshi has markets for Fed rate moves, CPI prints, S&P sector indices, election outcomes, and (recently) some housing-market sentiment markets.

**What Kalshi is NOT.**
- Not a rent index
- Not a jurisdiction-level forecast tool
- Not a substitute for ACS / FMR / ZORI

**Where Kalshi adds genuine value:**

1. **Fed expectations.** Kalshi has continuous markets for "Fed cuts at next FOMC", "Fed funds rate ≥ X by Y date", etc. These are higher-frequency, market-priced expectations vs the lagged FRED rate data. Useful as a **leading indicator** for permanent debt rate assumptions in the Deal Calc.

2. **Macro housing sentiment.** Kalshi has markets like "Case-Shiller HPI Q4 2026 ≥ X". Captures market-priced expectations of housing prices nationally. Not jurisdiction-level but tells you whether the broad market is pricing in a continuation of 2024 oversupply softness or a rebound.

3. **CPI / inflation.** Kalshi has CPI print markets. Useful for OpEx inflation rate assumptions in the 30-yr pro forma.

**Where Kalshi doesn't help:**
- Per-jurisdiction rent forecast (no such markets exist)
- Per-jurisdiction vacancy / absorption forecast (no markets)
- LIHTC-specific policy expectations (rare to nonexistent)

**Recommendation.** Add a small Kalshi sidebar to **Economic Dashboard** showing 3 markets:
1. "Fed cuts at next FOMC" — informs interest rate assumption
2. "CPI Y/Y ≥ X%" — informs OpEx inflation
3. "Case-Shiller HPI Q4" — informs broader sentiment

No paid integration needed. Public Kalshi market data is accessible via their browser-side API (rate-limited; 50 req/min anonymous is enough for a small sidebar). The `scripts/kalshi/fetch_kalshi_prediction_markets.js` script already exists for this — wire it into a CI cron, output to `data/economic/kalshi_markets_co.json`, render in Economic Dashboard.

**Effort.** 2-3 hours: pick 3 markets, build the daily fetch + JSON output, add a small Economic Dashboard card.

---

## 4. The "achievable rent cap" concept for 70% / 80% AMI

This is the deepest open issue in the Deal Calc.

**The problem.** For 9% deals with workforce / 70-80% AMI units, the LIHTC ceiling is often ABOVE achievable market rent. Example:

- Saguache County: 80% AMI 2BR LIHTC ceiling ≈ $1,360 (60% × 4/3)
- Saguache County FMR 2BR: $812
- Saguache County achievable rent (from CHFA Apartment Rent Survey): probably ~$900-950

If you underwrite the 80% AMI units at the LIHTC ceiling ($1,360), your pro forma says "$1,360/mo × 12 × 22 = $359K/yr." Real lease-up will be at $900-950 → $250K/yr. The deal won't pencil at the assumed rent.

**The CHFA underwriting rule.** §42 says you can't CHARGE more than the LIHTC ceiling, but you can underwrite at LESS. The "achievable rent" used in the pro forma must be `min(LIHTC_ceiling, market_rent)`. CHFA requires the PMA market study to validate market_rent.

**The OF "Capture" column today.** Already surfaces this: when capture is negative (FMR < LIHTC ceiling), the column shows it as a screening warning. The post-M3 explainer surfaces the underlying reason for SLV.

**What's missing in the Deal Calc.**
- No way to enter "achievable market rent for this unit type" as an override
- No automatic capping at `min(LIHTC_ceiling, market_rent_from_FMR)` for non-LIHTC-eligible tiers (70/80%)

**Recommended next change (P9 or later):**

1. Add an optional "Achievable market rent (per unit type)" input section. Pre-fill with FMR (FMR is the best free public proxy we have).
2. Add a toggle: "Cap rents at achievable market". When on, the rent for each (tier, BR) row = `min(LIHTC_ceiling, market_rent)`.
3. Surface the binding constraint per row (LIHTC vs market) in the rent display.

Once we wire SAFMR + Apartment List + ZORI (sections 2a–2c above), the "achievable market rent" defaults become much more accurate and the toggle becomes a real underwriting tool.

---

## Recommended phased rollout

| Phase | Source | Effort | What it unlocks |
|---|---|---|---|
| 1 | **HUD SAFMR** | 0.5 day | Boulder vs Aurora vs Denver get separate FMRs → better Capture for metro deals |
| 2 | **Apartment List CSV** | 1-2h | Monthly city-level rent for 10 CO cities; complements/replaces FMR for tight markets |
| 3 | **Zillow ZORI** | 2-3h | ZIP-level rent index for 30+ CO cities; triangulation |
| 4 | **Deal Calc "achievable rent" cap** | 1 day | Adds market-rent cap option for 70/80% AMI; binding-constraint indicator |
| 5 | **DOLA Apartment Rent Survey** | 0.5 day | Twice-yearly CO-specific regional rent levels; matches CHFA QAP usage |
| 6 | **Kalshi macro sidebar** | 2-3h | Economic Dashboard surfaces Fed expectations + CPI / sentiment for rate assumptions |

Total: ~5-6 days of work spread across 6 commits, all free, all defensible.

---

## Files referenced

- `js/deal-calculator.js` — Deal Calc rent calc (P6/P7 §42 + BR mix)
- `js/lihtc-opportunity-finder.js` — OF Capture column (F10)
- `data/hud-fmr-income-limits.json` — current FMR + IL cache
- `scripts/kalshi/fetch_kalshi_prediction_markets.js` — Kalshi fetch (needs wiring + cron)
- `docs/DATA-INTEGRATIONS-AUDIT.md` — complementary audit covering paid sources (Bridge MLS, Regrid)
