# MarketLens AI

## Alpha Vantage setup

1. Copy `.env.example` to `.env`.
2. Replace the placeholder with your Alpha Vantage API key:

   ```text
   ALPHA_VANTAGE_API_KEY=your_real_key
   MARKET_DATA_API_TOKEN=your_optional_options_data_token
   ```

3. Restart the Node server:

   ```powershell
   node server.js
   ```

4. Open `http://127.0.0.1:4890/index.html#/`.

The keys are read only by `server.js`. They are never returned to the browser, stored in local storage, or committed by Git. The `.env` file is ignored. The optional Market Data token is used only by the separate gamma-exposure feature.

## Live data behavior

- Quotes, OHLC candles, volume, company overview, fundamentals, EPS history, and company news use Alpha Vantage first.
- Google Finance quote and Stooq daily OHLC are fallback sources when Alpha Vantage is unavailable.
- Index symbols such as `^GSPC` use liquid ETF proxies where Alpha Vantage does not provide direct index candles.
- Broad market sentiment uses CNN's Fear & Greed index, components, and historical series.
- The S&P moving-average panel requests market history through the same backend market-data provider chain.
- Server-side caching reduces rate-limit pressure.

Before public launch, review Alpha Vantage, Google Finance, and Stooq rate limits, terms, and redistribution requirements, then deploy the backend over HTTPS with keys stored in the host's secret manager.

## Production build

```powershell
npm install
npm run build
node server.js
```

The Node server automatically serves `dist/` when a production build exists.

## Cloudflare Pages deploy

Use Cloudflare Pages for this frontend build:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Deploy command: leave blank

Do not set the deploy command to `npx wrangler deploy` for this Pages project. Wrangler's auto-configuration can generate a Cloudflare Vite plugin config that breaks this CommonJS app during the second build step. The `public/_redirects` file is copied to `dist/_redirects` so Cloudflare can serve the single-page app correctly.

This repo's `server.js` is a local Node API server. Cloudflare Pages static hosting will serve the app UI, but backend API routes such as `/api/market/stock`, `/api/macro/indicators`, and `/api/options/gamma` need a hosted backend or Cloudflare Pages Functions/Workers before production users can receive live server-side data. Older `/api/finnhub/...` paths remain as compatibility aliases.

This repo includes a Cloudflare Pages Function at `functions/api/[[path]].js` so deployed `/api/...` requests can respond on Pages. Add production secrets in Cloudflare Pages **Settings -> Environment variables**:

- `ALPHA_VANTAGE_API_KEY`
- `MARKET_DATA_API_TOKEN` if you use the external options data provider
- `GEMINI_API_KEY` and optional `GEMINI_MODEL`
- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID`

Cloudflare Pages Functions are serverless, so in-memory features such as world chat demo messages are not durable across instances. Use Firebase, D1, Durable Objects, or another database before relying on production persistence.

## Firebase accounts and sync

1. Create a Firebase project and register a Web app.
2. Enable **Email/Password** under Firebase Authentication sign-in methods.
3. Create a Cloud Firestore database.
4. Add the six `FIREBASE_*` web configuration values from `.env.example` to `.env`.
5. Deploy `firestore.rules` with the Firebase CLI or paste the rules into the Firebase console.
6. Add the production domain to Firebase Authentication's authorized domains before launch.
7. Restart `server.js`.

The browser receives only Firebase's public Web configuration. MarketLens stores each user's profile at `users/{uid}` and assistant chats under `users/{uid}/conversations`; the included Firestore rules restrict both paths to that authenticated user. Guest data remains in local storage and is migrated into the profile after login.

When Firebase is not configured, MarketLens automatically enables local account mode so development can continue. Local passwords are PBKDF2-hashed with a unique salt and account data remains in that browser's local storage. This fallback is for local development only; configure Firebase before publishing or expecting cross-device accounts.
