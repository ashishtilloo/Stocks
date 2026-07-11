# MarketLens AI

## Finnhub setup

1. Copy `.env.example` to `.env`.
2. Replace the placeholder with your Finnhub API key:

   ```text
   FINNHUB_API_KEY=your_real_key
   MARKET_DATA_API_TOKEN=your_optional_options_data_token
   ```

3. Restart the Node server:

   ```powershell
   node server.js
   ```

4. Open `http://127.0.0.1:4890/index.html#/`.

The keys are read only by `server.js`. They are never returned to the browser, stored in local storage, or committed by Git. The `.env` file is ignored. The optional Market Data token is used only by the separate gamma-exposure feature.

## Live data behavior

- Quotes refresh through Finnhub's quote endpoint and backend SSE stream.
- Company identity and market capitalization use the company profile endpoint.
- P/E, EPS, growth, and 52-week values use basic financial metrics.
- Price Action requests Finnhub OHLC candles and volume first, then uses Yahoo Finance chart history when Finnhub is unavailable. It never generates substitute prices.
- News uses Finnhub company news. Broad market sentiment uses CNN's Fear & Greed index, components, and historical series.
- The S&P moving-average panel requests index history from Finnhub.
- Server-side caching reduces rate-limit pressure.

Before public launch, review Finnhub's and Yahoo Finance's rate limits, terms, and redistribution requirements, then deploy the backend over HTTPS with keys stored in the host's secret manager.

## Production build

```powershell
npm install
npm run build
node server.js
```

The Node server automatically serves `dist/` when a production build exists.

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
