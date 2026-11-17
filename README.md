# CRAZII XAU/USD Web App starter

## Files
- `index.html` — mobile-first CRAZII dashboard.
- `crazii-secure-worker.js` — Cloudflare Worker API proxy.

## Important
This is a starter/prototype, not a deployed live service. No API key is included.
The page expects `/api/candles` and `/api/price` on the same origin.

## Deploy overview
1. Create a Cloudflare Pages project and deploy `index.html` as the site.
2. Deploy `crazii-secure-worker.js` as a Worker and route it to the same hostname under `/api/*`.
3. Create a Cloudflare Access application protecting the API route (and configure the user login flow).
4. Configure Worker variables:
   - `APP_ORIGIN` = exact origin of the Pages site, e.g. `https://crazii.example.com`
5. Configure Worker Secrets:
   - `TWELVE_DATA_API_KEY` = your Twelve Data key
   - `ACCESS_TEAM_DOMAIN` = `https://<team-name>.cloudflareaccess.com`
   - `ACCESS_AUD` = Access application AUD tag
6. Test `/api/health`, `/api/price`, and `/api/candles?interval=15min&outputsize=200` after Access login.

## Security notes
- Never place the Twelve Data key in `index.html`, localStorage, or client JavaScript.
- Restrict access with Cloudflare Access. Do not expose the Worker publicly without authentication and rate limiting.
- Add rate limiting and caching at the edge before wider use.
- Use only the data entitlements allowed by your Twelve Data plan and applicable market-data terms.

## Current UI behavior
- Displays candles from the secure proxy.
- Uses yellow bullish candles and red bearish candles.
- Volume bars follow candle direction if provider volume is present.
- Computes basic EMA20, EMA50 and RSI14 as a preview.
- KSI, DML, KCX, KCB are intentionally placeholders until their exact formulas are verified.
- Trade Entry/SL/TP are intentionally not generated until signal rules are validated.
- The current page refreshes on demand; WebSocket streaming is a later integration step.
