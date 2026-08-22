const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const normalizedRoot = path.resolve(root).toLowerCase();
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  });
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};
const cache = new Map();
const worldChatChannels = new Set(["global", "stocks", "macro", "off-topic"]);
const worldChatSessions = new Map();
const worldChatMessages = [{
  id: "welcome",
  channel: "global",
  user: "MarketLens",
  text: "Welcome to World Chat. Share market ideas, ask questions, and keep the conversation useful.",
  createdAt: Date.now(),
  system: true
}];

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function firebasePublicConfig() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || ""
  };
  return { configured: Boolean(config.apiKey && config.authDomain && config.projectId && config.appId), config };
}

function validSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.^-]{1,12}$/.test(symbol) ? symbol : null;
}

function usablePayload(value) {
  return value && !value.unavailable;
}

function symbolSeed(symbol) {
  return String(symbol || "AAPL").split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 11), 0);
}

function demoBasePrice(symbol) {
  const known = { AAPL: 212.41, MSFT: 501.48, NVDA: 164.92, TSLA: 315.35, AMZN: 224.83, META: 728.56, GOOGL: 196.52, SPY: 628.86, QQQ: 556.42, "^GSPC": 6299.19 };
  return known[symbol] || 35 + (symbolSeed(symbol) % 460);
}

function demoCandles(symbol, range = "6M") {
  const window = candleWindow(range);
  const base = demoBasePrice(symbol);
  const count = ({ "1D": 78, "5D": 130, "1M": 160, "6M": 500, YTD: 520, "1Y": 640, "5Y": 1480, "10Y": 2760 })[range] || 500;
  const step = ["1D", "5D"].includes(range) ? Number(window.resolution) * 60 : 86400;
  const seed = symbolSeed(symbol);
  let close = base * (0.78 + (seed % 29) / 100);
  const t = [], o = [], h = [], l = [], c = [], v = [];
  const now = Math.floor(Date.now() / 1000);
  for (let index = count - 1; index >= 0; index--) {
    const timestamp = now - index * step;
    const date = new Date(timestamp * 1000);
    if (step >= 86400 && (date.getUTCDay() === 0 || date.getUTCDay() === 6)) continue;
    const wave = Math.sin((count - index + seed) / 17) * 0.012 + Math.cos((count - index + seed) / 41) * 0.007;
    const drift = 0.00055 + ((seed % 13) - 6) / 100000;
    const open = close;
    close = Math.max(2, close * (1 + drift + wave));
    const spread = Math.max(base * 0.003, Math.abs(close - open) * 1.4);
    t.push(timestamp);
    o.push(Number(open.toFixed(2)));
    c.push(Number(close.toFixed(2)));
    h.push(Number((Math.max(open, close) + spread).toFixed(2)));
    l.push(Number((Math.min(open, close) - spread).toFixed(2)));
    v.push(Math.round((2_000_000 + (seed % 80) * 100_000) * (1 + Math.abs(wave) * 12)));
  }
  return { s: "ok", symbol, range, displayFrom: window.displayFrom, resolution: window.resolution, provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), t, o, h, l, c, v };
}

function demoQuote(symbol, candles = demoCandles(symbol, "6M")) {
  const closes = Array.isArray(candles?.c) ? candles.c.map(Number).filter(Number.isFinite) : [];
  const current = closes.at(-1) || demoBasePrice(symbol);
  const previous = closes.at(-2) || current * 0.995;
  return { c: current, d: current - previous, dp: (current / previous - 1) * 100, h: current * 1.012, l: current * 0.988, o: previous, pc: previous, provider: "Demo fallback (offline)" };
}

function demoProfile(symbol) {
  const names = { AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.", AMZN: "Amazon.com Inc.", META: "Meta Platforms Inc.", GOOGL: "Alphabet Inc.", SPY: "SPDR S&P 500 ETF Trust", QQQ: "Invesco QQQ Trust", "^GSPC": "S&P 500 Index" };
  return { name: names[symbol] || `${symbol} Holdings`, exchange: symbol.startsWith("^") ? "INDEX" : "NASDAQ", finnhubIndustry: symbol.startsWith("^") ? "Market Index" : "Technology", marketCapitalization: 100000 + (symbolSeed(symbol) % 2500000), shareOutstanding: 1000 + (symbolSeed(symbol) % 12000) };
}

function demoMetrics(symbol) {
  const seed = symbolSeed(symbol);
  return { metric: { epsTTM: 2 + (seed % 1800) / 100, epsGrowth5Y: -4 + (seed % 2600) / 100, peTTM: 12 + (seed % 3200) / 100, revenuePerShareTTM: 15 + (seed % 8000) / 100, "52WeekHigh": demoBasePrice(symbol) * 1.22, "52WeekLow": demoBasePrice(symbol) * 0.72 } };
}

function demoNews(symbol) {
  const today = Math.floor(Date.now() / 1000);
  return [
    { id: `${symbol}-demo-1`, datetime: today - 3600, headline: `${symbol} market update: price action and macro conditions in focus`, source: "MarketLens demo", url: "#", summary: "Offline fallback story shown while live company headlines are unavailable." },
    { id: `${symbol}-demo-2`, datetime: today - 10800, headline: `${symbol} traders watch earnings estimates and volume trend`, source: "MarketLens demo", url: "#", summary: "Use live provider data when connected; this keeps the news panel populated offline." }
  ];
}

function monthIndex(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
}

function monthDate(index) {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}-01`;
}

function anchoredMacroRows(anchors, latestDate = "2026-06-01") {
  const sorted = anchors.map(([date, value]) => ({ date, value: Number(value), index: monthIndex(date) })).sort((a, b) => a.index - b.index);
  const rows = [];
  const start = sorted[0].index, end = monthIndex(latestDate);
  for (let index = start; index <= end; index++) {
    let left = sorted[0], right = sorted.at(-1);
    for (let anchorIndex = 1; anchorIndex < sorted.length; anchorIndex++) {
      if (index <= sorted[anchorIndex].index) {
        left = sorted[anchorIndex - 1];
        right = sorted[anchorIndex];
        break;
      }
    }
    const span = Math.max(1, right.index - left.index);
    const progress = Math.max(0, Math.min(1, (index - left.index) / span));
    const cycle = Math.sin(index / 5.7) * 0.035 + Math.cos(index / 13.3) * 0.025;
    const value = left.value + (right.value - left.value) * progress + cycle;
    rows.push({ date: monthDate(index), value: Number(Math.max(0, value).toFixed(2)) });
  }
  return rows;
}

function demoMacroIndicators() {
  const unemploymentRows = anchoredMacroRows([
    ["1985-01-01", 7.3], ["1989-03-01", 5.0], ["1992-06-01", 7.8], ["2000-04-01", 3.8],
    ["2003-06-01", 6.3], ["2007-05-01", 4.4], ["2009-10-01", 10.0], ["2015-12-01", 5.0],
    ["2019-12-01", 3.6], ["2020-04-01", 14.7], ["2021-12-01", 3.9], ["2023-04-01", 3.4],
    ["2024-12-01", 4.1], ["2026-05-01", 4.3]
  ], "2026-05-01");
  const inflationRows = anchoredMacroRows([
    ["1985-01-01", 3.5], ["1991-01-01", 5.6], ["1998-06-01", 1.7], ["2008-07-01", 5.6],
    ["2009-07-01", 0.0], ["2015-01-01", 0.1], ["2019-12-01", 2.3], ["2022-06-01", 9.1],
    ["2023-12-01", 3.3], ["2025-05-01", 2.31], ["2026-05-01", 4.47]
  ], "2026-05-01");
  const fedRows = anchoredMacroRows([
    ["1985-01-01", 8.4], ["1992-09-01", 3.0], ["2000-07-01", 6.5], ["2003-06-01", 1.0],
    ["2007-08-01", 5.25], ["2009-01-01", 0.16], ["2015-12-01", 0.24], ["2019-07-01", 2.4],
    ["2021-12-01", 0.08], ["2023-08-01", 5.33], ["2025-06-01", 4.33], ["2026-06-01", 3.63]
  ], "2026-06-01");
  const treasuryRows = anchoredMacroRows([
    ["1985-01-01", 11.4], ["1993-10-01", 5.3], ["2000-01-01", 6.7], ["2003-06-01", 3.3],
    ["2007-06-01", 5.1], ["2012-07-01", 1.5], ["2018-11-01", 3.2], ["2020-08-01", 0.6],
    ["2022-10-01", 4.1], ["2023-10-01", 4.9], ["2025-06-01", 4.21], ["2026-06-01", 4.45]
  ], "2026-06-01");
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), series: {
    unemployment: macroSeriesSummary("UNRATE", "Unemployment Rate", "Monthly", "%", unemploymentRows),
    inflation: macroSeriesSummary("CPIAUCSL", "Inflation (CPI YoY)", "Monthly, year-over-year", "%", inflationRows),
    fed: macroSeriesSummary("FEDFUNDS", "Fed Funds Rate", "Monthly average", "%", fedRows),
    treasury: macroSeriesSummary("DGS10", "10-Year Treasury Yield", "Daily", "%", treasuryRows)
  } };
}

function demoCnnFearGreed() {
  const score = 54;
  const history = Array.from({ length: 190 }, (_, index) => ({ x: Date.now() - (189 - index) * 86400000, y: Math.max(5, Math.min(95, 48 + Math.sin(index / 12) * 17 + Math.cos(index / 31) * 8)) }));
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), fear_and_greed: { score, rating: "Neutral", previous_close: 52, previous_1_week: 49, previous_1_month: 57, previous_1_year: 45 }, fear_and_greed_historical: { data: history }, market_momentum_sp500: { score: 58, rating: "Neutral" }, stock_price_strength: { score: 55, rating: "Neutral" }, stock_price_breadth: { score: 51, rating: "Neutral" }, put_call_options: { score: 47, rating: "Neutral" }, market_volatility_vix: { score: 62, rating: "Greed" }, junk_bond_demand: { score: 53, rating: "Neutral" }, safe_haven_demand: { score: 49, rating: "Neutral" } };
}

function demoSectorEtfPerformance() {
  const sectors = [
    ["XLK", "Technology"], ["XLC", "Communication Services"], ["XLY", "Consumer Discretionary"],
    ["XLF", "Financials"], ["XLI", "Industrials"], ["XLE", "Energy"],
    ["XLV", "Health Care"], ["XLP", "Consumer Staples"], ["XLU", "Utilities"],
    ["XLB", "Materials"], ["XLRE", "Real Estate"]
  ];
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), sectors: sectors.map(([symbol, name], index) => {
    const seed = symbolSeed(symbol);
    return { symbol, name, price: demoBasePrice(symbol), oneMonth: -4 + (seed % 900) / 100, threeMonth: -8 + ((seed + index * 41) % 1600) / 100, sixMonth: -12 + ((seed + index * 73) % 2600) / 100, ytd: -15 + ((seed + index * 109) % 3400) / 100 };
  }) };
}

function demoGamma(symbol, requestedDte = 30) {
  const spot = demoBasePrice(symbol);
  const expiration = new Date(Date.now() + requestedDte * 86400000).toISOString().slice(0, 10);
  const payload = { strike: [], side: [], openInterest: [], gamma: [], iv: [], dte: [], expiration: [], underlyingPrice: [] };
  for (let offset = -10; offset <= 10; offset++) {
    const strike = Math.max(1, spot * (1 + offset * 0.015));
    ["call", "put"].forEach(side => {
      const distance = Math.abs(strike / spot - 1);
      const iv = 0.22 + distance * 1.8;
      const gamma = blackScholesGamma(spot, strike, iv, requestedDte / 365);
      payload.strike.push(Number(strike.toFixed(2)));
      payload.side.push(side);
      payload.openInterest.push(Math.round(250 + (11 - Math.abs(offset)) * 220 + (side === "put" ? 80 : 0)));
      payload.gamma.push(gamma || 0.001);
      payload.iv.push(iv);
      payload.dte.push(requestedDte);
      payload.expiration.push(expiration);
      payload.underlyingPrice.push(spot);
    });
  }
  return summarizeGammaChain(payload, symbol, requestedDte, "Demo fallback (offline)");
}

function readJsonBody(req, limit = 50000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > limit) reject(new Error("Request body is too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON request")); }
    });
    req.on("error", reject);
  });
}

function cleanChatValue(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function hasProhibitedLanguage(value) {
  const normalized = String(value || "").toLowerCase()
    .replace(/[@4]/g, "a").replace(/[3]/g, "e").replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o").replace(/[5$]/g, "s").replace(/[7+]/g, "t");
  const patterns = [
    /\bf+[^a-z0-9]*u+[^a-z0-9]*c+[^a-z0-9]*k+\b/,
    /\bs+[^a-z0-9]*h+[^a-z0-9]*i+[^a-z0-9]*t+\b/,
    /\bb+[^a-z0-9]*i+[^a-z0-9]*t+[^a-z0-9]*c+[^a-z0-9]*h+\b/,
    /\ba+[^a-z0-9]*s+[^a-z0-9]*s+[^a-z0-9]*h+[^a-z0-9]*o+[^a-z0-9]*l+[^a-z0-9]*e+\b/,
    /\bc+[^a-z0-9]*u+[^a-z0-9]*n+[^a-z0-9]*t+\b/,
    /\bd+[^a-z0-9]*i+[^a-z0-9]*c+[^a-z0-9]*k+\b/,
    /\bp+[^a-z0-9]*u+[^a-z0-9]*s+[^a-z0-9]*s+[^a-z0-9]*y+\b/,
    /\bf+[^a-z0-9]*a+[^a-z0-9]*g+(?:[^a-z0-9]*g+[^a-z0-9]*o+[^a-z0-9]*t+)?\b/,
    /\bn+[^a-z0-9]*i+[^a-z0-9]*g+[^a-z0-9]*g+(?:[^a-z0-9]*e+[^a-z0-9]*r+|[^a-z0-9]*a+)?\b/,
    /\bw+[^a-z0-9]*h+[^a-z0-9]*o+[^a-z0-9]*r+[^a-z0-9]*e+\b/,
    /\bs+[^a-z0-9]*l+[^a-z0-9]*u+[^a-z0-9]*t+\b/,
    /\bm+[^a-z0-9]*o+[^a-z0-9]*t+[^a-z0-9]*h+[^a-z0-9]*e+[^a-z0-9]*r+[^a-z0-9]*f+[^a-z0-9]*u+[^a-z0-9]*c+[^a-z0-9]*k+[^a-z0-9]*e+[^a-z0-9]*r+\b/
  ];
  return patterns.some(pattern => pattern.test(normalized));
}

function worldChatChannel(value) {
  const channel = cleanChatValue(value, 20).toLowerCase();
  return worldChatChannels.has(channel) ? channel : "global";
}

function updateWorldChatPresence(payload) {
  const sessionId = cleanChatValue(payload?.sessionId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) throw new Error("Invalid chat session");
  const user = cleanChatValue(payload?.user, 24) || "Guest";
  if (hasProhibitedLanguage(user)) throw new Error("Display names cannot contain inappropriate language");
  worldChatSessions.set(sessionId, {
    user,
    channel: worldChatChannel(payload?.channel),
    seenAt: Date.now()
  });
  return sessionId;
}

function worldChatPresence() {
  const cutoff = Date.now() - 45000;
  for (const [id, session] of worldChatSessions) {
    if (session.seenAt < cutoff) worldChatSessions.delete(id);
  }
  const byChannel = Object.fromEntries([...worldChatChannels].map(channel => [channel, 0]));
  for (const session of worldChatSessions.values()) byChannel[session.channel] += 1;
  return { online: worldChatSessions.size, byChannel };
}

async function geminiChat(payload) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Gemini is not configured");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const message = String(payload?.message || "").trim().slice(0, 4000);
  if (!message) throw new Error("A message is required");
  const history = Array.isArray(payload?.history) ? payload.history.slice(-8) : [];
  const context = JSON.stringify(payload?.context || {}).slice(0, 12000);
  const contents = history
    .filter(item => ["user", "model"].includes(item?.role) && item?.text)
    .map(item => ({ role: item.role, parts: [{ text: String(item.text).slice(0, 4000) }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `You are Market Copilot, a concise stock research assistant. Use the supplied live app context as the source of truth for ticker-specific numbers. Explain uncertainty, distinguish facts from model estimates, and never promise returns or present educational analysis as personalized financial advice. Current app context: ${context}` }] },
      contents,
      generationConfig: { temperature: 0.35, maxOutputTokens: 700 }
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
  const answer = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n").trim();
  if (!answer) throw new Error("Gemini returned an empty response");
  return { answer, provider: "Market Copilot", model };
}

function alphaVantageKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || process.env.ALPHAVANTAGE_API_KEY;
}

function alphaVantageSymbol(symbol) {
  return ({ "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "QQQ" })[symbol] || symbol;
}

async function alphaVantage(params, ttlMs) {
  const key = alphaVantageKey();
  if (!key) throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
  const url = new URL("https://www.alphavantage.co/query");
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  url.searchParams.set("apikey", key);
  const cacheKey = url.toString().replace(key, "[key]");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  const providerMessage = data["Error Message"] || data.Note || data.Information;
  if (!response.ok || providerMessage) throw new Error(providerMessage || `Alpha Vantage request failed (${response.status})`);
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function candleWindow(range) {
  const now = Math.floor(Date.now() / 1000);
  const yearStart = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
  const warmupDays = 310;
  const settings = {
    "1D": { from: now - 5 * 86400, displayFrom: now - 1 * 86400, resolution: "5" },
    "5D": { from: now - 18 * 86400, displayFrom: now - 7 * 86400, resolution: "15" },
    "1M": { from: now - 100 * 86400, displayFrom: now - 35 * 86400, resolution: "60" },
    "6M": { from: now - (190 + warmupDays) * 86400, displayFrom: now - 190 * 86400, resolution: "D" },
    "YTD": { from: yearStart - warmupDays * 86400, displayFrom: yearStart, resolution: "D" },
    "1Y": { from: now - (380 + warmupDays) * 86400, displayFrom: now - 380 * 86400, resolution: "D" },
    "5Y": { from: now - (1840 + warmupDays) * 86400, displayFrom: now - 1840 * 86400, resolution: "D" },
    "10Y": { from: now - (3670 + warmupDays) * 86400, displayFrom: now - 3670 * 86400, resolution: "D" }
  }[range] || { from: now - 500 * 86400, displayFrom: now - 190 * 86400, resolution: "D" };
  return { ...settings, to: now };
}

function alphaTimestampFromDate(date, intraday = false) {
  return Math.floor(new Date(intraday ? `${date.replace(" ", "T")}:00Z` : `${date}T16:00:00Z`).getTime() / 1000);
}

function alphaNumber(row, key) {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : null;
}

function firstNumber(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

async function alphaVantageQuote(symbol, ttlMs = 60000) {
  const sourceSymbol = alphaVantageSymbol(symbol);
  const data = await alphaVantage({ function: "GLOBAL_QUOTE", symbol: sourceSymbol }, ttlMs);
  const quote = data["Global Quote"] || {};
  const current = alphaNumber(quote, "05. price");
  const previous = alphaNumber(quote, "08. previous close");
  if (!Number.isFinite(current) || current <= 0) throw new Error("Alpha Vantage returned no current quote");
  const rawPercent = String(quote["10. change percent"] || "").replace("%", "");
  const latestDay = quote["07. latest trading day"];
  return {
    c: current,
    d: alphaNumber(quote, "09. change"),
    dp: Number.isFinite(Number(rawPercent)) ? Number(rawPercent) : Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null,
    h: alphaNumber(quote, "03. high"),
    l: alphaNumber(quote, "04. low"),
    o: alphaNumber(quote, "02. open"),
    pc: previous,
    t: latestDay ? alphaTimestampFromDate(latestDay) : null,
    provider: "Alpha Vantage"
  };
}

async function marketDataStockQuote(symbol, ttlMs = 30000) {
  if (!process.env.MARKET_DATA_API_TOKEN) throw new Error("MARKET_DATA_API_TOKEN is not configured");
  if (symbol.startsWith("^")) throw new Error("Market Data stock quotes do not support index symbols");
  const cacheKey = `marketdata:quote:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const url = new URL(`https://api.marketdata.app/v1/stocks/quotes/${encodeURIComponent(symbol)}/`);
  url.searchParams.set("extended", "true");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${process.env.MARKET_DATA_API_TOKEN}`
    },
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 203) throw new Error(payload.errmsg || `Market Data quote failed (${response.status})`);
  if (payload.s !== "ok") throw new Error(payload.errmsg || "Market Data returned no quote");
  const current = firstNumber(payload.last) ?? firstNumber(payload.mid) ?? firstNumber(payload.bid) ?? firstNumber(payload.ask);
  const change = firstNumber(payload.change);
  const changePct = firstNumber(payload.changepct);
  const previous = Number.isFinite(current) && Number.isFinite(change) ? current - change : null;
  if (!Number.isFinite(current) || current <= 0) throw new Error("Market Data returned no current stock price");
  const data = {
    c: current,
    d: change,
    dp: Number.isFinite(changePct) ? changePct * 100 : Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null,
    h: null,
    l: null,
    o: null,
    pc: previous,
    t: firstNumber(payload.updated),
    volume: firstNumber(payload.volume),
    provider: "Market Data"
  };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function alphaSeriesKey(data) {
  return Object.keys(data || {}).find(key => /Time Series/i.test(key));
}

async function alphaVantageChart(symbol, range, ttlMs = 300000) {
  const window = candleWindow(range);
  const sourceSymbol = alphaVantageSymbol(symbol);
  const intraday = ["1D", "5D", "1M"].includes(range);
  const interval = ({ "5": "5min", "15": "15min", "60": "60min" })[window.resolution] || "60min";
  const data = await alphaVantage(intraday
    ? { function: "TIME_SERIES_INTRADAY", symbol: sourceSymbol, interval, outputsize: "full", adjusted: "false" }
    : { function: "TIME_SERIES_DAILY_ADJUSTED", symbol: sourceSymbol, outputsize: "full" }, ttlMs);
  const series = data[alphaSeriesKey(data)];
  if (!series || typeof series !== "object") throw new Error("Alpha Vantage returned no chart history");
  const rows = Object.entries(series).map(([date, row]) => ({
    time: alphaTimestampFromDate(date, intraday),
    open: alphaNumber(row, "1. open"),
    high: alphaNumber(row, "2. high"),
    low: alphaNumber(row, "3. low"),
    close: alphaNumber(row, intraday ? "4. close" : "5. adjusted close") ?? alphaNumber(row, "4. close"),
    volume: alphaNumber(row, intraday ? "5. volume" : "6. volume") ?? 0
  })).filter(row => row.time >= window.from && row.time <= window.to && [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);
  if (rows.length < 2) {
    throw new Error("Alpha Vantage returned insufficient chart history for this range");
  }
  return {
    s: "ok",
    t: rows.map(row => row.time),
    o: rows.map(row => row.open),
    h: rows.map(row => row.high),
    l: rows.map(row => row.low),
    c: rows.map(row => row.close),
    v: rows.map(row => row.volume),
    meta: { regularMarketPrice: rows.at(-1).close, chartPreviousClose: rows.at(-2).close },
    symbol,
    sourceSymbol,
    range,
    displayFrom: window.displayFrom,
    resolution: window.resolution,
    provider: sourceSymbol === symbol ? "Alpha Vantage" : `Alpha Vantage (${sourceSymbol} proxy)`,
    fetchedAt: new Date().toISOString()
  };
}

function rangeDisplayFrom(range, latestTime) {
  const latest = Number(latestTime) || Math.floor(Date.now() / 1000);
  if (range === "YTD") {
    const date = new Date(latest * 1000);
    return Math.floor(Date.UTC(date.getUTCFullYear(), 0, 1) / 1000);
  }
  const days = ({ "1D": 1, "5D": 5, "1M": 31, "6M": 183, "1Y": 365, "5Y": 365 * 5, "10Y": 365 * 10 })[range] || 183;
  return latest - days * 86400;
}

function chartQuote(chart) {
  const meta = chart?.meta || {};
  const current = Number(meta.regularMarketPrice ?? chart?.c?.at(-1));
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose ?? chart?.c?.at(-2));
  return {
    c: current,
    d: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
    dp: Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null,
    h: Number(meta.regularMarketDayHigh),
    l: Number(meta.regularMarketDayLow),
    o: Number(meta.regularMarketOpen),
    pc: previous,
    t: Number(meta.regularMarketTime),
    provider: chart?.provider || "Market data"
  };
}

function yahooChartConfig(range) {
  return ({
    "1D": { range: "1d", interval: "5m", resolution: "5" },
    "5D": { range: "5d", interval: "15m", resolution: "15" },
    "1M": { range: "1mo", interval: "60m", resolution: "60" },
    "6M": { range: "6mo", interval: "1d", resolution: "D" },
    YTD: { range: "ytd", interval: "1d", resolution: "D" },
    "1Y": { range: "1y", interval: "1d", resolution: "D" },
    "5Y": { range: "5y", interval: "1wk", resolution: "W" },
    "10Y": { range: "10y", interval: "1wk", resolution: "W" }
  })[range] || { range: "6mo", interval: "1d", resolution: "D" };
}

function yahooNumber(value) {
  const number = Number(value);
  return value === null || value === "" || !Number.isFinite(number) ? null : number;
}

async function yahooFinanceChart(symbol, range, ttlMs = 60000) {
  const config = yahooChartConfig(range);
  const cacheKey = `yahoo-chart:${symbol}:${range}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", config.range);
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.chart?.error?.description || `Yahoo Finance request failed (${response.status})`);
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = timestamps.map((time, index) => ({
    time: yahooNumber(time),
    open: yahooNumber(quote.open?.[index]),
    high: yahooNumber(quote.high?.[index]),
    low: yahooNumber(quote.low?.[index]),
    close: yahooNumber(quote.close?.[index]),
    volume: yahooNumber(quote.volume?.[index]) || 0
  })).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite));
  if (rows.length < 2) throw new Error(payload?.chart?.error?.description || "Yahoo Finance returned insufficient chart history");
  const data = {
    s: "ok",
    t: rows.map(row => row.time),
    o: rows.map(row => row.open),
    h: rows.map(row => row.high),
    l: rows.map(row => row.low),
    c: rows.map(row => row.close),
    v: rows.map(row => row.volume),
    meta: result?.meta || {},
    symbol,
    range,
    displayFrom: rangeDisplayFrom(range, rows.at(-1).time),
    resolution: config.resolution,
    provider: "Yahoo Finance",
    fetchedAt: new Date().toISOString()
  };
  setCached(cacheKey, data, ttlMs);
  return data;
}

function googleFinanceCandidates(symbol) {
  const map = {
    "^GSPC": [".INX:INDEXSP"],
    "^DJI": [".DJI:INDEXDJX"],
    "^IXIC": [".IXIC:INDEXNASDAQ"],
    SPY: ["SPY:NYSEARCA"],
    QQQ: ["QQQ:NASDAQ"],
    IWM: ["IWM:NYSEARCA"],
    DIA: ["DIA:NYSEARCA"]
  };
  if (map[symbol]) return map[symbol];
  const nasdaq = new Set(["AAPL", "MSFT", "NVDA", "TSLA", "MU", "AMZN", "META", "GOOGL", "GOOG", "AMD", "NFLX", "INTC", "COST", "ADBE", "AVGO", "PEP", "CSCO", "CMCSA", "TMUS"]);
  const exchanges = nasdaq.has(symbol) ? ["NASDAQ", "NYSE", "NYSEARCA"] : ["NYSE", "NASDAQ", "NYSEARCA"];
  return exchanges.map(exchange => `${symbol}:${exchange}`);
}

function parseGoogleNumber(value) {
  const cleaned = String(value || "").replace(/&amp;/g, "&").replace(/[^\d.+-]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

async function googleFinanceQuote(symbol, ttlMs = 60000) {
  const cacheKey = `google:quote:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  let lastError = null;
  for (const candidate of googleFinanceCandidates(symbol)) {
    try {
      const encodedCandidate = candidate.split(":").map(encodeURIComponent).join(":");
      const response = await fetch(`https://www.google.com/finance/quote/${encodedCandidate}`, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
        },
        signal: AbortSignal.timeout(10000)
      });
      const html = await response.text();
      if (!response.ok) throw new Error(`Google Finance request failed (${response.status})`);
      const current = parseGoogleNumber(html.match(/data-last-price="([^"]+)"/)?.[1])
        ?? parseGoogleNumber(html.match(/class="YMlKec fxKbKc">([^<]+)</)?.[1]);
      if (!Number.isFinite(current) || current <= 0) throw new Error("Google Finance returned no current price");
      const previous = parseGoogleNumber(html.match(/data-previous-close="([^"]+)"/)?.[1]);
      const timestamp = Number(html.match(/data-last-normal-market-timestamp-sec="([^"]+)"/)?.[1]);
      const data = {
        c: current,
        d: Number.isFinite(previous) ? current - previous : null,
        dp: Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null,
        h: null,
        l: null,
        o: null,
        pc: Number.isFinite(previous) ? previous : null,
        t: Number.isFinite(timestamp) ? timestamp : null,
        provider: "Google Finance"
      };
      cache.set(cacheKey, { time: Date.now(), data });
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || "Google Finance quote unavailable");
}

function yyyymmdd(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function stooqSymbol(symbol) {
  const map = { "^GSPC": "^spx", "^DJI": "^dji", "^IXIC": "^ndq", SPY: "spy.us", QQQ: "qqq.us" };
  if (map[symbol]) return map[symbol];
  if (symbol.startsWith("^")) return symbol.toLowerCase();
  return symbol.includes(".") ? symbol.toLowerCase() : `${symbol.toLowerCase()}.us`;
}

function parseCsvLine(line) {
  const fields = [];
  let field = "", quoted = false;
  for (const char of String(line || "")) {
    if (char === "\"") quoted = !quoted;
    else if (char === "," && !quoted) { fields.push(field); field = ""; }
    else field += char;
  }
  fields.push(field);
  return fields.map(value => value.trim().replace(/^"|"$/g, ""));
}

async function stooqChart(symbol, range, ttlMs = 300000) {
  const window = candleWindow(range);
  const stooqTicker = stooqSymbol(symbol);
  const cacheKey = `stooq:chart:${stooqTicker}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const url = new URL("https://stooq.com/q/d/l/");
  url.searchParams.set("s", stooqTicker);
  url.searchParams.set("d1", yyyymmdd(window.from));
  url.searchParams.set("d2", yyyymmdd(window.to));
  url.searchParams.set("i", "d");
  if (process.env.STOOQ_API_KEY) url.searchParams.set("apikey", process.env.STOOQ_API_KEY);
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Stooq request failed (${response.status})`);
  if (/apikey|captcha|exceeded|no data/i.test(text)) throw new Error("Stooq did not return usable chart data");
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3) throw new Error("Stooq returned insufficient chart history");
  const rows = lines.slice(1).map(line => {
    const [date, open, high, low, close, volume] = parseCsvLine(line);
    return {
      time: Math.floor(new Date(`${date}T16:00:00Z`).getTime() / 1000),
      open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) || 0
    };
  }).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite));
  if (rows.length < 2) throw new Error("Stooq returned insufficient valid OHLC rows");
  const latestTime = rows.at(-1).time;
  const data = {
    s: "ok",
    t: rows.map(row => row.time),
    o: rows.map(row => row.open),
    h: rows.map(row => row.high),
    l: rows.map(row => row.low),
    c: rows.map(row => row.close),
    v: rows.map(row => row.volume),
    meta: { regularMarketPrice: rows.at(-1).close, chartPreviousClose: rows.at(-2).close },
    symbol,
    range,
    displayFrom: rangeDisplayFrom(range, latestTime),
    resolution: "D",
    provider: "Stooq",
    fetchedAt: new Date().toISOString()
  };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

async function marketChart(symbol, range, ttlMs = 60000) {
  const diagnostics = [];
  let marketDataQuote = null;
  try {
    marketDataQuote = await marketDataStockQuote(symbol, ttlMs);
    diagnostics.push({ provider: "Market Data", ok: true, authApplied: Boolean(process.env.MARKET_DATA_API_TOKEN), message: "Latest stock quote returned" });
  } catch (error) {
    diagnostics.push({ provider: "Market Data", ok: false, authApplied: Boolean(process.env.MARKET_DATA_API_TOKEN), message: error.message });
  }

  try {
    const candles = await alphaVantageChart(symbol, range, ttlMs);
    const rawQuote = marketDataQuote || await alphaVantageQuote(symbol, 60000);
    if (!Number.isFinite(Number(rawQuote?.c)) || Number(rawQuote.c) <= 0) throw new Error("Alpha Vantage returned candles but no current quote");
    const quote = { ...rawQuote, provider: rawQuote.provider || "Alpha Vantage" };
    diagnostics.push({ provider: "Alpha Vantage", ok: true, authApplied: Boolean(alphaVantageKey()), message: marketDataQuote ? "OHLC and volume returned; Market Data supplied quote" : "Quote, OHLC, and volume returned" });
    return { candles, quote, diagnostics, provider: marketDataQuote ? "Market Data + Alpha Vantage" : "Alpha Vantage" };
  } catch (error) {
    diagnostics.push({ provider: "Alpha Vantage", ok: false, authApplied: Boolean(alphaVantageKey()), message: error.message });
  }

  try {
    const candles = await yahooFinanceChart(symbol, range, ttlMs);
    const yahooQuote = chartQuote(candles);
    const quote = marketDataQuote || yahooQuote;
    if (!Number.isFinite(Number(quote?.c)) || Number(quote.c) <= 0) throw new Error("Yahoo Finance returned candles but no current quote");
    diagnostics.push({ provider: "Yahoo Finance", ok: true, authApplied: false, message: marketDataQuote ? "OHLC and volume returned; Market Data supplied quote" : "Current quote, OHLC, and volume returned" });
    return { candles, quote, diagnostics, provider: marketDataQuote ? "Market Data + Yahoo Finance" : "Yahoo Finance" };
  } catch (error) {
    diagnostics.push({ provider: "Yahoo Finance", ok: false, authApplied: false, message: error.message });
  }

  let googleQuote = null;
  try {
    googleQuote = await googleFinanceQuote(symbol, ttlMs);
    diagnostics.push({ provider: "Google Finance", ok: true, authApplied: false, message: "Current quote returned" });
  } catch (error) {
    diagnostics.push({ provider: "Google Finance", ok: false, authApplied: false, message: error.message });
  }

  try {
    const candles = await stooqChart(symbol, range, ttlMs);
    diagnostics.push({ provider: "Stooq", ok: true, authApplied: Boolean(process.env.STOOQ_API_KEY), message: "Daily OHLC and volume returned" });
    const quote = marketDataQuote || googleQuote || chartQuote(candles);
    if (!Number.isFinite(Number(quote?.c))) throw new Error("Stooq returned history but no current quote");
    return { candles, quote, diagnostics, provider: quote.provider === "Market Data" ? "Market Data + Stooq" : quote.provider === "Google Finance" ? "Google Finance + Stooq" : "Stooq" };
  } catch (error) {
    diagnostics.push({ provider: "Stooq", ok: false, authApplied: Boolean(process.env.STOOQ_API_KEY), message: error.message });
  }

  const detail = diagnostics.map(item => `${item.provider}: ${item.message}`).join("; ");
  const unavailable = new Error(`Market data unavailable from Market Data, Alpha Vantage, Yahoo Finance, Google Finance, and Stooq. ${detail}`);
  unavailable.diagnostics = diagnostics;
  unavailable.partialQuote = marketDataQuote || googleQuote;
  throw unavailable;
}

async function safeRequest(endpoint, params, ttlMs) {
  try { return await alphaVantage({ function: endpoint, ...params }, ttlMs); }
  catch (error) { return { unavailable: true, message: error.message }; }
}

async function alphaVantageOverview(symbol, ttlMs = 86400000) {
  const sourceSymbol = alphaVantageSymbol(symbol);
  const overview = await alphaVantage({ function: "OVERVIEW", symbol: sourceSymbol }, ttlMs);
  if (!overview || !overview.Symbol) throw new Error("Alpha Vantage returned no company overview");
  const shares = Number(overview.SharesOutstanding);
  const marketCapDollars = Number(overview.MarketCapitalization);
  const revenue = Number(overview.RevenueTTM);
  const profile = {
    name: overview.Name || `${symbol} Holdings`,
    exchange: overview.Exchange || (symbol.startsWith("^") ? "INDEX" : "NASDAQ"),
    sector: overview.Sector || (symbol.startsWith("^") ? "Market Index" : null),
    industry: overview.Industry || null,
    finnhubIndustry: overview.Industry || overview.Sector || (symbol.startsWith("^") ? "Market Index" : null),
    marketCapitalization: Number.isFinite(marketCapDollars) ? marketCapDollars / 1_000_000 : null,
    shareOutstanding: Number.isFinite(shares) ? shares / 1_000_000 : null
  };
  const metrics = { metric: {
    epsTTM: Number(overview.EPS),
    epsGrowthYoY: Number(overview.QuarterlyEarningsGrowthYOY) * 100,
    revenueGrowthYoY: Number(overview.QuarterlyRevenueGrowthYOY) * 100,
    peTTM: Number(overview.PERatio),
    revenuePerShareTTM: Number.isFinite(revenue) && Number.isFinite(shares) && shares > 0 ? revenue / shares : Number(overview.RevenuePerShareTTM),
    "52WeekHigh": Number(overview["52WeekHigh"]),
    "52WeekLow": Number(overview["52WeekLow"])
  } };
  return { profile, metrics };
}

async function alphaVantageEarnings(symbol, ttlMs = 3600000) {
  const sourceSymbol = alphaVantageSymbol(symbol);
  const [data, income] = await Promise.all([
    alphaVantage({ function: "EARNINGS", symbol: sourceSymbol }, ttlMs),
    alphaVantage({ function: "INCOME_STATEMENT", symbol: sourceSymbol }, ttlMs)
  ]);
  const rows = Array.isArray(data.quarterlyEarnings) ? data.quarterlyEarnings : [];
  if (!rows.length) throw new Error("Alpha Vantage returned no earnings records");
  const revenues = (Array.isArray(income.quarterlyReports) ? income.quarterlyReports : []).map(row => ({ time: Date.parse(`${row.fiscalDateEnding}T00:00:00Z`), revenue: Number(row.totalRevenue) })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.revenue) && row.revenue >= 0);
  if (!revenues.length) throw new Error("Alpha Vantage returned no quarterly revenue records");
  return rows.slice(0, 12).map(row => {
    const date = new Date(`${row.fiscalDateEnding}T00:00:00Z`);
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    const actual = Number(row.reportedEPS);
    const estimate = Number(row.estimatedEPS);
    const time = date.getTime();
    const revenueRow = revenues.reduce((best, item) => Math.abs(item.time - time) < Math.abs((best?.time ?? Infinity) - time) ? item : best, null);
    const priorRevenue = revenues.filter(item => { const days = (time - item.time) / 86400000; return days >= 300 && days <= 430; }).reduce((best, item) => Math.abs((time - item.time) / 86400000 - 365.25) < Math.abs((time - (best?.time ?? -Infinity)) / 86400000 - 365.25) ? item : best, null);
    const revenue = revenueRow && Math.abs(revenueRow.time - time) <= 75 * 86400000 ? revenueRow.revenue : null;
    return {
      symbol,
      year: date.getUTCFullYear(),
      quarter,
      period: row.fiscalDateEnding,
      fiscalDateEnding: row.fiscalDateEnding,
      reportedDate: row.reportedDate || null,
      actual,
      estimate,
      surprise: Number.isFinite(actual) && Number.isFinite(estimate) ? actual - estimate : Number(row.surprise),
      revenue,
      revenueGrowthYoY: Number.isFinite(revenue) && Number.isFinite(priorRevenue?.revenue) && priorRevenue.revenue !== 0 ? (revenue / priorRevenue.revenue - 1) * 100 : null,
      provider: "Alpha Vantage"
    };
  });
}

function alphaNewsTimestamp(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})/);
  if (!match) return Math.floor(Date.now() / 1000);
  const [, year, month, day, hour, minute, second] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000);
}

async function alphaVantageNews(symbol, ttlMs = 300000) {
  const data = await alphaVantage({ function: "NEWS_SENTIMENT", tickers: alphaVantageSymbol(symbol), limit: 20 }, ttlMs);
  const rows = Array.isArray(data.feed) ? data.feed : [];
  if (!rows.length) throw new Error("Alpha Vantage returned no news records");
  return rows.slice(0, 20).map((story, index) => ({
    id: story.url || `${symbol}-alpha-${index}`,
    datetime: alphaNewsTimestamp(story.time_published),
    headline: story.title || "Untitled",
    source: story.source || "Alpha Vantage",
    url: story.url || "#",
    summary: story.summary || ""
  }));
}

async function cnnFearGreed(ttlMs = 300000) {
  const cacheKey = "cnn:fear-and-greed";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const response = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
    headers: {
      Accept: "application/json",
      Referer: "https://www.cnn.com/markets/fear-and-greed",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`CNN request failed (${response.status})`);
  const data = await response.json();
  if (!Number.isFinite(Number(data?.fear_and_greed?.score))) throw new Error("CNN returned an invalid Fear & Greed response");
  const normalized = { ...data, provider: "CNN", fetchedAt: new Date().toISOString() };
  cache.set(cacheKey, { time: Date.now(), data: normalized });
  return normalized;
}

function parseFredCsv(csv) {
  return String(csv || "").trim().split(/\r?\n/).slice(1).map(line => {
    const [date, rawValue] = line.split(",");
    const cleaned = String(rawValue ?? "").trim();
    return { date, value: cleaned && cleaned !== "." ? Number(cleaned) : NaN };
  }).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));
}

async function fredSeries(id, ttlMs = 21600000) {
  const cacheKey = `fred:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", id);
  const response = await fetch(url, {
    headers: { Accept: "text/csv", "User-Agent": "MarketLens/1.0" },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`FRED ${id} request failed (${response.status})`);
  const rows = parseFredCsv(await response.text());
  if (!rows.length) throw new Error(`FRED ${id} returned no observations`);
  cache.set(cacheKey, { time: Date.now(), data: rows });
  return rows;
}

function macroSeriesSummary(id, name, frequency, units, rows) {
  const latest = rows.at(-1);
  const prior = rows.at(-2);
  const yearAgoDate = new Date(`${latest.date}T00:00:00Z`);
  yearAgoDate.setUTCFullYear(yearAgoDate.getUTCFullYear() - 1);
  const yearAgo = rows.reduce((best, row) => Math.abs(new Date(`${row.date}T00:00:00Z`) - yearAgoDate) < Math.abs(new Date(`${best.date}T00:00:00Z`) - yearAgoDate) ? row : best, rows[0]);
  return { id, name, frequency, units, rows, latest, prior, yearAgo };
}

async function macroIndicators() {
  const [unemploymentRows, cpiRows, fedRows, treasuryRows] = await Promise.all([
    fredSeries("UNRATE"), fredSeries("CPIAUCSL"), fredSeries("FEDFUNDS"), fredSeries("DGS10")
  ]);
  const cpiByDate = new Map(cpiRows.map(row => [row.date, row.value]));
  const inflationRows = cpiRows.map(row => {
    const previousDate = new Date(`${row.date}T00:00:00Z`);
    previousDate.setUTCFullYear(previousDate.getUTCFullYear() - 1);
    const previousValue = cpiByDate.get(previousDate.toISOString().slice(0, 10));
    return { date: row.date, value: Number.isFinite(previousValue) && previousValue > 0 ? (row.value / previousValue - 1) * 100 : NaN };
  }).filter(row => Number.isFinite(row.value));
  return {
    provider: "Federal Reserve Bank of St. Louis (FRED)",
    fetchedAt: new Date().toISOString(),
    series: {
      unemployment: macroSeriesSummary("UNRATE", "Unemployment Rate", "Monthly", "%", unemploymentRows),
      inflation: macroSeriesSummary("CPIAUCSL", "Inflation (CPI YoY)", "Monthly, year-over-year", "%", inflationRows),
      fed: macroSeriesSummary("FEDFUNDS", "Fed Funds Rate", "Monthly average", "%", fedRows),
      treasury: macroSeriesSummary("DGS10", "10-Year Treasury Yield", "Daily", "%", treasuryRows)
    }
  };
}

async function sectorEtfPerformance() {
  const sectors = [
    ["XLK", "Technology"], ["XLC", "Communication Services"], ["XLY", "Consumer Discretionary"],
    ["XLF", "Financials"], ["XLI", "Industrials"], ["XLE", "Energy"],
    ["XLV", "Health Care"], ["XLP", "Consumer Staples"], ["XLU", "Utilities"],
    ["XLB", "Materials"], ["XLRE", "Real Estate"]
  ];
  const rows = await Promise.all(sectors.map(async ([symbol, name]) => {
    const chart = (await marketChart(symbol, "1Y", 300000)).candles;
    const points = chart.t.map((time, index) => ({ time: Number(time), close: Number(chart.c[index]) }))
      .filter(point => Number.isFinite(point.time) && Number.isFinite(point.close) && point.close > 0);
    const latest = points.at(-1);
    if (!latest) throw new Error(`${symbol} returned no valid closes`);
    const changeFrom = targetTime => {
      const base = points.reduce((best, point) => Math.abs(point.time - targetTime) < Math.abs(best.time - targetTime) ? point : best, points[0]);
      return (latest.close / base.close - 1) * 100;
    };
    const yearStart = Math.floor(new Date(new Date(latest.time * 1000).getUTCFullYear(), 0, 1).getTime() / 1000);
    return {
      symbol, name, price: latest.close,
      oneMonth: changeFrom(latest.time - 30 * 86400),
      threeMonth: changeFrom(latest.time - 91 * 86400),
      sixMonth: changeFrom(latest.time - 182 * 86400),
      ytd: changeFrom(yearStart)
    };
  }));
  return { provider: "Alpha Vantage / Google Finance / Stooq", fetchedAt: new Date().toISOString(), sectors: rows };
}

async function handleMarketStock(req, res, requestUrl) {
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  if (!symbol) return json(res, 400, { error: "Invalid ticker symbol" });
  const allowedRanges = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]);
  const range = allowedRanges.has(requestUrl.searchParams.get("range")) ? requestUrl.searchParams.get("range") : "6M";
  const today = new Date();
  const newsTo = today.toISOString().slice(0, 10);
  today.setDate(today.getDate() - 30);
  const newsFrom = today.toISOString().slice(0, 10);

  let [overview, earnings, news] = await Promise.all([
    alphaVantageOverview(symbol, 86400000).catch(error => ({ unavailable: true, message: error.message })),
    alphaVantageEarnings(symbol, 3600000).catch(error => ({ unavailable: true, message: error.message })),
    alphaVantageNews(symbol, 300000).catch(error => ({ unavailable: true, message: error.message }))
  ]);
  let candles, probabilityCandles, effectiveQuote;
  let fundamentalsProvider = usablePayload(overview?.profile) ? "Alpha Vantage" : "Unavailable";
  const dataDiagnostics = [];
  try {
    const market = await marketChart(symbol, range, 60000);
    candles = market.candles;
    effectiveQuote = market.quote;
    dataDiagnostics.push(...market.diagnostics);
    try {
      probabilityCandles = (await marketChart(symbol, "5Y", 300000)).candles;
    } catch (error) {
      dataDiagnostics.push({ provider: market.provider, ok: false, authApplied: Boolean(alphaVantageKey() || process.env.STOOQ_API_KEY), message: `5Y probability history unavailable: ${error.message}` });
      probabilityCandles = candles;
    }
  } catch (error) {
    dataDiagnostics.push(...(error.diagnostics || []));
    if (error.partialQuote && Number.isFinite(Number(error.partialQuote.c)) && Number(error.partialQuote.c) > 0) {
      effectiveQuote = error.partialQuote;
      candles = { unavailable: true, s: "no_data", symbol, range, provider: "Live quote only", message: "Historical candles are unavailable, but the live quote provider returned a current price." };
      probabilityCandles = candles;
      dataDiagnostics.push({ provider: effectiveQuote.provider || "Live quote", ok: true, authApplied: false, message: "Live quote preserved while chart history was unavailable" });
    } else {
      candles = { unavailable: true, s: "no_data", symbol, range, provider: "Unavailable", message: "No verified historical candles were returned by the configured providers." };
      probabilityCandles = candles;
      effectiveQuote = { unavailable: true, c: null, d: null, dp: null, h: null, l: null, o: null, pc: null, t: null, provider: "Unavailable", message: "No verified live quote was returned by the configured providers." };
      dataDiagnostics.push({ provider: "Market data", ok: false, authApplied: false, message: "No generated quote or chart data was substituted for the unavailable provider response" });
    }
  }

  if (!usablePayload(overview?.profile) || !usablePayload(overview?.metrics)) {
    dataDiagnostics.push({ provider: "Alpha Vantage fundamentals", ok: false, authApplied: Boolean(alphaVantageKey()), message: overview?.message || "Company overview unavailable" });
    try {
      overview = await yahooFundamentals(symbol, 3600000);
      fundamentalsProvider = "Yahoo Finance";
      dataDiagnostics.push({ provider: "Yahoo Finance fundamentals", ok: true, authApplied: false, message: "Verified company profile and valuation fields returned" });
    } catch (error) {
      dataDiagnostics.push({ provider: "Yahoo Finance fundamentals", ok: false, authApplied: false, message: error.message });
    }
  }

  let earningsProvider = Array.isArray(earnings) && earnings.length ? "Alpha Vantage" : "Unavailable";
  if (!Array.isArray(earnings) || !earnings.length) {
    dataDiagnostics.push({ provider: "Alpha Vantage earnings", ok: false, authApplied: Boolean(alphaVantageKey()), message: earnings?.message || "Reported earnings or quarterly revenue unavailable" });
    try {
      earnings = await yahooEarnings(symbol, 3600000);
      earningsProvider = "Yahoo Finance";
      dataDiagnostics.push({ provider: "Yahoo Finance earnings", ok: true, authApplied: false, message: "Reported EPS, estimates, and quarterly revenue returned" });
    } catch (error) {
      earnings = [];
      dataDiagnostics.push({ provider: "Yahoo Finance earnings", ok: false, authApplied: false, message: error.message });
    }
  }

  const chartMeta = candles?.meta || {};
  const basicProfile = {
    name: chartMeta.longName || chartMeta.shortName || symbol,
    exchange: chartMeta.fullExchangeName || chartMeta.exchangeName || chartMeta.exchange || null,
    sector: null,
    industry: null,
    finnhubIndustry: null,
    marketCapitalization: null,
    shareOutstanding: null
  };

  json(res, 200, {
    configured: true,
    provider: candles?.provider || "Market data",
    fetchedAt: new Date().toISOString(),
    symbol,
    range,
    resolution: candles.resolution,
    quoteProvider: effectiveQuote?.provider || "Market data",
    candleProvider: candles?.provider || null,
    fundamentalsProvider,
    earningsProvider,
    dataDiagnostics,
    quote: effectiveQuote,
    profile: usablePayload(overview?.profile) ? overview.profile : basicProfile,
    metrics: usablePayload(overview?.metrics) ? overview.metrics : { metric: {} },
    candles,
    probabilityCandles,
    earnings: Array.isArray(earnings) ? earnings : [],
    news: Array.isArray(news) ? news.slice(0, 20) : demoNews(symbol),
    sentiment: { provider: "Demo fallback (offline)", bullishPercent: 52, bearishPercent: 28 },
    recommendations: [{ symbol, buy: 8, hold: 11, sell: 2, strongBuy: 4, strongSell: 1, period: new Date().toISOString().slice(0, 7) }]
  });
}

async function handleMarketCandles(req, res, requestUrl) {
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  const allowedRanges = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]);
  const range = allowedRanges.has(requestUrl.searchParams.get("range")) ? requestUrl.searchParams.get("range") : "6M";
  if (!symbol) return json(res, 400, { error: "Invalid ticker symbol" });
  try {
    return json(res, 200, (await marketChart(symbol, range, 60000)).candles);
  } catch (error) {
    return json(res, 200, {
      ...demoCandles(symbol, range),
      detail: `Live historical candle requests failed: ${error.message}`,
      dataDiagnostics: [
        ...(error.diagnostics || []),
        { provider: "Demo fallback", ok: true, authApplied: false, message: "Offline fallback returned because live providers were unreachable from this environment" }
      ]
    });
  }
}

function streamMarketQuotes(req, res, requestUrl) {
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  if (!symbol || !alphaVantageKey()) return json(res, 400, { error: "A valid symbol and ALPHA_VANTAGE_API_KEY are required" });
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  let closed = false;
  const send = async () => {
    if (closed) return;
    try {
      const quote = await alphaVantageQuote(symbol, 60000);
      res.write(`event: quote\ndata: ${JSON.stringify({ symbol, quote, fetchedAt: new Date().toISOString() })}\n\n`);
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    }
  };
  send();
  const timer = setInterval(send, 5000);
  req.on("close", () => { closed = true; clearInterval(timer); });
}

function normalDensity(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function blackScholesGamma(spot, strike, volatility, years, rate = 0.043) {
  if (![spot, strike, volatility, years].every(value => Number.isFinite(value) && value > 0)) return null;
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + volatility * volatility / 2) * years) / (volatility * rootTime);
  return normalDensity(d1) / (spot * volatility * rootTime);
}

function summarizeGammaChain(payload, symbol, requestedDte, provider = "Market Data") {
  const fields = ["strike", "side", "openInterest", "gamma", "iv", "dte", "expiration", "underlyingPrice"];
  const length = Array.isArray(payload.strike) ? payload.strike.length : 0;
  if (!length || !fields.every(field => Array.isArray(payload[field]) && payload[field].length === length)) {
    throw new Error("The options provider returned an incomplete chain");
  }
  const contracts = Array.from({ length }, (_, index) => ({
    strike: Number(payload.strike[index]),
    side: String(payload.side[index] || "").toLowerCase(),
    openInterest: Number(payload.openInterest[index]),
    gamma: Number(payload.gamma[index]),
    iv: Number(payload.iv[index]),
    dte: Number(payload.dte[index]),
    expiration: Number(payload.expiration[index]),
    underlyingPrice: Number(payload.underlyingPrice[index])
  })).filter(row => Number.isFinite(row.strike) && row.strike > 0 && Number.isFinite(row.openInterest) && row.openInterest > 0 && Number.isFinite(row.gamma) && row.gamma >= 0 && (row.side === "call" || row.side === "put"));
  if (!contracts.length) throw new Error("No liquid option contracts with gamma were returned for this symbol");
  const spot = contracts.find(row => Number.isFinite(row.underlyingPrice) && row.underlyingPrice > 0)?.underlyingPrice;
  if (!spot) throw new Error("The options chain did not include a valid underlying price");
  const byStrike = new Map();
  contracts.forEach(row => {
    const exposure = row.gamma * row.openInterest * 100 * spot * spot * 0.01 * (row.side === "call" ? 1 : -1);
    const item = byStrike.get(row.strike) || { strike: row.strike, callGamma: 0, putGamma: 0, netGamma: 0, callOpenInterest: 0, putOpenInterest: 0 };
    if (row.side === "call") { item.callGamma += exposure; item.callOpenInterest += row.openInterest; }
    else { item.putGamma += exposure; item.putOpenInterest += row.openInterest; }
    item.netGamma += exposure;
    byStrike.set(row.strike, item);
  });
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const callWall = strikes.reduce((best, row) => row.callGamma > best.callGamma ? row : best, strikes[0]);
  const putWall = strikes.reduce((best, row) => Math.abs(row.putGamma) > Math.abs(best.putGamma) ? row : best, strikes[0]);
  const scenarioContracts = contracts.filter(row => Number.isFinite(row.iv) && row.iv > 0 && row.iv < 5 && Number.isFinite(row.dte) && row.dte > 0);
  const nearMoneyContracts = scenarioContracts.filter(row => Math.abs(row.strike / spot - 1) <= 0.05);
  const ivContracts = nearMoneyContracts.length ? nearMoneyContracts : scenarioContracts;
  const ivWeight = ivContracts.reduce((sum, row) => sum + row.openInterest, 0);
  const atmImpliedVolatility = ivWeight > 0
    ? ivContracts.reduce((sum, row) => sum + row.iv * row.openInterest, 0) / ivWeight
    : null;
  const curve = scenarioContracts.length ? Array.from({ length: 61 }, (_, index) => {
    const scenarioSpot = spot * (0.88 + index * 0.24 / 60);
    const netGamma = scenarioContracts.reduce((total, row) => {
      const gamma = blackScholesGamma(scenarioSpot, row.strike, row.iv, Math.max(row.dte, 1) / 365);
      return total + (gamma || 0) * row.openInterest * 100 * scenarioSpot * scenarioSpot * 0.01 * (row.side === "call" ? 1 : -1);
    }, 0);
    return { spot: scenarioSpot, netGamma };
  }) : [];
  const crossings = [];
  for (let index = 1; index < curve.length; index++) {
    const previous = curve[index - 1], current = curve[index];
    if (previous.netGamma === 0 || previous.netGamma * current.netGamma < 0) {
      const weight = Math.abs(previous.netGamma) / (Math.abs(previous.netGamma) + Math.abs(current.netGamma) || 1);
      crossings.push(previous.spot + (current.spot - previous.spot) * weight);
    }
  }
  const gammaFlip = crossings.length ? crossings.reduce((closest, value) => Math.abs(value - spot) < Math.abs(closest - spot) ? value : closest) : null;
  const expirationTimestamp = contracts.find(row => Number.isFinite(row.expiration))?.expiration;
  return {
    s: "ok", symbol, provider, methodology: "Dealer-sign gamma x open interest x 100 x spot squared x 1% move",
    requestedDte, expiration: expirationTimestamp ? new Date(expirationTimestamp * 1000).toISOString() : null,
    underlyingPrice: spot, gammaFlip, callWall: callWall?.strike || null, putWall: putWall?.strike || null,
    atmImpliedVolatility,
    callGamma: strikes.reduce((sum, row) => sum + row.callGamma, 0),
    putGamma: strikes.reduce((sum, row) => sum + row.putGamma, 0),
    netGamma: strikes.reduce((sum, row) => sum + row.netGamma, 0),
    contractCount: contracts.length, strikes, curve,
    fetchedAt: new Date().toISOString()
  };
}

async function marketDataGamma(symbol, requestedDte) {
  if (!process.env.MARKET_DATA_API_TOKEN && symbol !== "AAPL") throw new Error("MARKET_DATA_API_TOKEN is required for options chains outside AAPL demo access");
  const cacheKey = `gamma:${symbol}:${requestedDte}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < 300000) return cached.data;
  const url = new URL(`https://api.marketdata.app/v1/options/chain/${encodeURIComponent(symbol)}/`);
  url.searchParams.set("dte", String(requestedDte));
  url.searchParams.set("strikeLimit", "50");
  url.searchParams.set("minOpenInterest", "1");
  const headers = { Accept: "application/json", "User-Agent": "MarketLens/1.0" };
  if (process.env.MARKET_DATA_API_TOKEN) headers.Authorization = `Bearer ${process.env.MARKET_DATA_API_TOKEN}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.s !== "ok") throw new Error(payload.errmsg || `Options request failed (${response.status})`);
  const data = summarizeGammaChain(payload, symbol, requestedDte);
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

async function yahooSession(force = false) {
  const cacheKey = "yahoo:session";
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.time < 1800000) return cached.data;
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" };
  const cookieResponse = await fetch("https://fc.yahoo.com", { headers, redirect: "manual", signal: AbortSignal.timeout(10000) });
  const setCookies = typeof cookieResponse.headers.getSetCookie === "function" ? cookieResponse.headers.getSetCookie() : [cookieResponse.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map(value => value.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Yahoo Finance did not issue a session cookie");
  const crumbResponse = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumbResponse.ok || !crumb || /unauthorized|error/i.test(crumb)) throw new Error("Yahoo Finance did not issue a valid crumb");
  const data = { cookie, crumb };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

const yahooRawNumber = value => {
  const raw = value?.raw ?? value;
  if (raw === null || raw === undefined || raw === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
};

async function yahooFundamentals(symbol, ttlMs = 3600000, retry = true) {
  const cacheKey = `yahoo:fundamentals:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const session = await yahooSession();
  const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  url.searchParams.set("modules", "assetProfile,price,summaryDetail,defaultKeyStatistics,financialData");
  url.searchParams.set("crumb", session.crumb);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Cookie: session.cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" },
    signal: AbortSignal.timeout(12000)
  });
  const payload = await response.json().catch(() => ({}));
  const errorMessage = payload?.quoteSummary?.error?.description || payload?.finance?.error?.description || "";
  if (retry && (response.status === 401 || /crumb|unauthorized/i.test(errorMessage))) {
    await yahooSession(true);
    return yahooFundamentals(symbol, ttlMs, false);
  }
  if (!response.ok) throw new Error(errorMessage || `Yahoo fundamentals request failed (${response.status})`);
  const result = payload?.quoteSummary?.result?.[0];
  if (!result) throw new Error("Yahoo Finance returned no company fundamentals");
  const asset = result.assetProfile || {};
  const price = result.price || {};
  const summary = result.summaryDetail || {};
  const statistics = result.defaultKeyStatistics || {};
  const financial = result.financialData || {};
  const shares = yahooRawNumber(statistics.sharesOutstanding);
  const revenue = yahooRawNumber(financial.totalRevenue);
  const data = {
    profile: {
      name: price.longName || price.shortName || symbol,
      exchange: price.exchangeName || price.fullExchangeName || price.exchange || null,
      sector: asset.sector || null,
      industry: asset.industry || null,
      finnhubIndustry: asset.industry || asset.sector || null,
      marketCapitalization: Number.isFinite(yahooRawNumber(price.marketCap)) ? yahooRawNumber(price.marketCap) / 1_000_000 : null,
      shareOutstanding: Number.isFinite(shares) ? shares / 1_000_000 : null
    },
    metrics: { metric: {
      epsTTM: yahooRawNumber(statistics.trailingEps),
      epsGrowthYoY: Number.isFinite(yahooRawNumber(financial.earningsGrowth)) ? yahooRawNumber(financial.earningsGrowth) * 100 : null,
      revenueGrowthYoY: Number.isFinite(yahooRawNumber(financial.revenueGrowth)) ? yahooRawNumber(financial.revenueGrowth) * 100 : null,
      peTTM: yahooRawNumber(summary.trailingPE),
      revenuePerShareTTM: Number.isFinite(revenue) && Number.isFinite(shares) && shares > 0 ? revenue / shares : yahooRawNumber(financial.revenuePerShare),
      "52WeekHigh": yahooRawNumber(summary.fiftyTwoWeekHigh),
      "52WeekLow": yahooRawNumber(summary.fiftyTwoWeekLow)
    } }
  };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

async function yahooEarnings(symbol, ttlMs = 3600000, retry = true) {
  const cacheKey = `yahoo:earnings:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const session = await yahooSession();
  const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`);
  url.searchParams.set("modules", "earningsHistory,incomeStatementHistoryQuarterly,financialData");
  url.searchParams.set("crumb", session.crumb);
  const response = await fetch(url, { headers: { Accept: "application/json", Cookie: session.cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" }, signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  const errorMessage = payload?.quoteSummary?.error?.description || payload?.finance?.error?.description || "";
  if (retry && (response.status === 401 || /crumb|unauthorized/i.test(errorMessage))) { await yahooSession(true); return yahooEarnings(symbol, ttlMs, false); }
  if (!response.ok) throw new Error(errorMessage || `Yahoo earnings request failed (${response.status})`);
  const result = payload?.quoteSummary?.result?.[0];
  const history = [...(result?.earningsHistory?.history || [])].sort((a, b) => yahooRawNumber(b.quarter) - yahooRawNumber(a.quarter));
  const statements = result?.incomeStatementHistoryQuarterly?.incomeStatementHistory || [];
  if (!Array.isArray(history) || !history.length) throw new Error("Yahoo Finance returned no earnings history");
  const revenues = statements.map(row => ({ time: yahooRawNumber(row.endDate) * 1000, revenue: yahooRawNumber(row.totalRevenue) })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.revenue) && row.revenue >= 0);
  const latestRevenueGrowth = Number.isFinite(yahooRawNumber(result?.financialData?.revenueGrowth)) ? yahooRawNumber(result.financialData.revenueGrowth) * 100 : null;
  const data = history.slice(0, 12).map((row, index) => {
    const date = new Date(yahooRawNumber(row.quarter) * 1000), time = date.getTime();
    const revenueRow = revenues.reduce((best, item) => Math.abs(item.time - time) < Math.abs((best?.time ?? Infinity) - time) ? item : best, null);
    const priorRevenue = revenues.filter(item => { const days = (time - item.time) / 86400000; return days >= 300 && days <= 430; }).reduce((best, item) => Math.abs((time - item.time) / 86400000 - 365.25) < Math.abs((time - (best?.time ?? -Infinity)) / 86400000 - 365.25) ? item : best, null);
    const revenue = revenueRow && Math.abs(revenueRow.time - time) <= 75 * 86400000 ? revenueRow.revenue : null;
    return { symbol, year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1, period: date.toISOString().slice(0, 10), fiscalDateEnding: date.toISOString().slice(0, 10), reportedDate: null, actual: yahooRawNumber(row.epsActual), estimate: yahooRawNumber(row.epsEstimate), surprise: yahooRawNumber(row.epsDifference), revenue, revenueGrowthYoY: Number.isFinite(revenue) && Number.isFinite(priorRevenue?.revenue) && priorRevenue.revenue !== 0 ? (revenue / priorRevenue.revenue - 1) * 100 : index === 0 ? latestRevenueGrowth : null, revenueGrowthBasis: Number.isFinite(priorRevenue?.revenue) ? "Quarterly YoY" : index === 0 && Number.isFinite(latestRevenueGrowth) ? "Latest provider YoY" : null, provider: "Yahoo Finance" };
  });
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

async function yahooOptions(symbol, expiration, retry = true) {
  const session = await yahooSession();
  const url = new URL(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
  if (expiration) url.searchParams.set("date", String(expiration));
  url.searchParams.set("crumb", session.crumb);
  const response = await fetch(url, { headers: { Accept: "application/json", Cookie: session.cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36" }, signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  if (retry && (response.status === 401 || /crumb/i.test(payload?.finance?.error?.description || ""))) {
    await yahooSession(true);
    return yahooOptions(symbol, expiration, false);
  }
  if (!response.ok) throw new Error(payload?.finance?.error?.description || `Yahoo options request failed (${response.status})`);
  const result = payload?.optionChain?.result?.[0];
  if (!result) throw new Error("Yahoo Finance returned no listed options chain");
  return result;
}

async function yahooGamma(symbol, requestedDte) {
  const first = await yahooOptions(symbol);
  const target = Math.floor(Date.now() / 1000) + requestedDte * 86400;
  const expirations = (first.expirationDates || []).map(Number).filter(Number.isFinite);
  if (!expirations.length) throw new Error("No listed option expirations were returned for this ticker");
  const expiration = expirations.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best, expirations[0]);
  const result = first.options?.[0]?.expirationDate === expiration ? first : await yahooOptions(symbol, expiration);
  const spot = Number(result.quote?.regularMarketPrice);
  if (!Number.isFinite(spot) || spot <= 0) throw new Error("The Yahoo options chain did not include an underlying price");
  const dte = Math.max(1, Math.round((expiration - Date.now() / 1000) / 86400));
  const rows = [...(result.options?.[0]?.calls || []).map(row => ({ ...row, side: "call" })), ...(result.options?.[0]?.puts || []).map(row => ({ ...row, side: "put" }))]
    .filter(row => Number(row.openInterest) > 0 && Number(row.impliedVolatility) > 0 && Number(row.strike) > 0);
  const payload = { strike: [], side: [], openInterest: [], gamma: [], iv: [], dte: [], expiration: [], underlyingPrice: [] };
  rows.forEach(row => {
    const iv = Number(row.impliedVolatility);
    const gamma = blackScholesGamma(spot, Number(row.strike), iv, dte / 365);
    if (!Number.isFinite(gamma)) return;
    payload.strike.push(Number(row.strike)); payload.side.push(row.side); payload.openInterest.push(Number(row.openInterest));
    payload.gamma.push(gamma); payload.iv.push(iv); payload.dte.push(dte); payload.expiration.push(expiration); payload.underlyingPrice.push(spot);
  });
  return summarizeGammaChain(payload, symbol, requestedDte, "Yahoo Finance options fallback");
}

function serveStatic(req, res) {
  const frontendRoot = path.join(root, "frontend");
  const staticRoot = fs.existsSync(path.join(frontendRoot, "dist", "index.html")) ? path.join(frontendRoot, "dist") : frontendRoot;
  const normalizedStaticRoot = path.resolve(staticRoot).toLowerCase();
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath.split("/").some(segment => segment.startsWith("."))) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const filePath = path.resolve(staticRoot, urlPath === "/" ? "index.html" : "." + urlPath);
  if (!filePath.toLowerCase().startsWith(normalizedStaticRoot)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(staticRoot, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

const port = Number(process.env.PORT) || 4890;

http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  if (requestUrl.pathname === "/api/cnn/fear-greed") {
    try { return json(res, 200, await cnnFearGreed()); }
    catch (error) { return json(res, 200, { ...demoCnnFearGreed(), detail: `CNN Fear & Greed unavailable: ${error.message}` }); }
  }
  if (requestUrl.pathname === "/api/market/sentiment") {
    try { return json(res, 200, await cnnFearGreed()); }
    catch (error) { return json(res, 200, { ...demoCnnFearGreed(), detail: `CNN Fear & Greed unavailable: ${error.message}` }); }
  }
  if (requestUrl.pathname === "/api/macro/indicators") {
    try { return json(res, 200, await macroIndicators()); }
    catch (error) { return json(res, 200, { ...demoMacroIndicators(), detail: `FRED macro data unavailable: ${error.message}` }); }
  }
  if (requestUrl.pathname === "/api/macro/sector-etfs") {
    try { return json(res, 200, await sectorEtfPerformance()); }
    catch (error) { return json(res, 200, { ...demoSectorEtfPerformance(), detail: `Sector ETF data unavailable: ${error.message}` }); }
  }
  if (requestUrl.pathname === "/api/market/status" || requestUrl.pathname === "/api/finnhub/status") return json(res, 200, { configured: Boolean(alphaVantageKey()), provider: "Alpha Vantage" });
  if (requestUrl.pathname === "/api/market-data/status") return json(res, 200, { configured: Boolean(process.env.MARKET_DATA_API_TOKEN), provider: "Market Data" });
  if (requestUrl.pathname === "/api/options/gamma") {
    const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
    const requestedDte = Math.max(1, Math.min(365, Number(requestUrl.searchParams.get("dte")) || 30));
    if (!symbol || symbol.startsWith("^") || symbol.includes("-")) return json(res, 400, { error: "Enter a valid stock or ETF ticker with listed options" });
    try { return json(res, 200, await marketDataGamma(symbol, requestedDte)); }
    catch (primaryError) {
      try { return json(res, 200, await yahooGamma(symbol, requestedDte)); }
      catch (fallbackError) { return json(res, 200, { ...demoGamma(symbol, requestedDte), detail: `Live gamma exposure unavailable: ${primaryError.message} Yahoo fallback: ${fallbackError.message}` }); }
    }
  }
  if (requestUrl.pathname === "/api/firebase/config") return json(res, 200, firebasePublicConfig());
  if (requestUrl.pathname === "/api/ai/status") {
    return json(res, 200, { configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), provider: "Market Copilot" });
  }
  if (requestUrl.pathname === "/api/ai/chat" && req.method === "POST") {
    try { return json(res, 200, await geminiChat(await readJsonBody(req))); }
    catch (error) { return json(res, /configured/.test(error.message) ? 503 : 502, { error: "AI response is unavailable", detail: error.message }); }
  }
  if (requestUrl.pathname === "/api/world-chat/presence" && req.method === "POST") {
    try {
      updateWorldChatPresence(await readJsonBody(req));
      return json(res, 200, worldChatPresence());
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (requestUrl.pathname === "/api/world-chat/messages" && req.method === "GET") {
    const channel = worldChatChannel(requestUrl.searchParams.get("channel"));
    return json(res, 200, {
      channel,
      messages: worldChatMessages.filter(message => message.channel === channel).slice(-80),
      ...worldChatPresence()
    });
  }
  if (requestUrl.pathname === "/api/world-chat/messages" && req.method === "POST") {
    try {
      const payload = await readJsonBody(req);
      updateWorldChatPresence(payload);
      const text = cleanChatValue(payload?.text, 500);
      if (!text) return json(res, 400, { error: "Message cannot be empty" });
      if (hasProhibitedLanguage(text)) return json(res, 422, { error: "Please remove inappropriate language before sending" });
      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        channel: worldChatChannel(payload?.channel),
        user: cleanChatValue(payload?.user, 24) || "Guest",
        text,
        createdAt: Date.now(),
        system: false
      };
      worldChatMessages.push(message);
      if (worldChatMessages.length > 500) worldChatMessages.splice(1, worldChatMessages.length - 500);
      return json(res, 201, { message, ...worldChatPresence() });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (requestUrl.pathname === "/api/market/stock" || requestUrl.pathname === "/api/market/quote" || requestUrl.pathname === "/api/finnhub/stock") {
    try { return await handleMarketStock(req, res, requestUrl); }
    catch (error) { return json(res, 502, { error: "Market data request failed", detail: error.message }); }
  }
  if (requestUrl.pathname === "/api/market/candles" || requestUrl.pathname === "/api/market/history" || requestUrl.pathname === "/api/finnhub/candles") return handleMarketCandles(req, res, requestUrl);
  if (requestUrl.pathname === "/api/market/stream" || requestUrl.pathname === "/api/finnhub/stream") return streamMarketQuotes(req, res, requestUrl);
  serveStatic(req, res);
}).listen(port, "127.0.0.1", () => {
  console.log(`MarketLens AI running at http://127.0.0.1:${port}`);
  console.log(`Alpha Vantage API: ${alphaVantageKey() ? "configured" : "not configured"}`);
  console.log(`Market Data API: ${process.env.MARKET_DATA_API_TOKEN ? "configured" : "demo access only"}`);
  console.log(`Gemini API: ${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "configured" : "not configured"}`);
});
