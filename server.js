const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
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

function demoEarnings(symbol) {
  const seed = symbolSeed(symbol);
  return Array.from({ length: 8 }, (_, index) => {
    const quarterIndex = 7 - index;
    const date = new Date();
    date.setMonth(date.getMonth() - quarterIndex * 3);
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    const actual = 1 + (seed % 220) / 100 + index * 0.08;
    const estimate = actual - 0.05 + ((index % 3) - 1) * 0.03;
    return { symbol, year: date.getFullYear(), quarter, period: `${date.getFullYear()} Q${quarter}`, actual, estimate, surprise: actual - estimate };
  }).reverse();
}

function demoNews(symbol) {
  const today = Math.floor(Date.now() / 1000);
  return [
    { id: `${symbol}-demo-1`, datetime: today - 3600, headline: `${symbol} market update: price action and macro conditions in focus`, source: "MarketLens demo", url: "#", summary: "Offline fallback story shown while live company headlines are unavailable." },
    { id: `${symbol}-demo-2`, datetime: today - 10800, headline: `${symbol} traders watch earnings estimates and volume trend`, source: "MarketLens demo", url: "#", summary: "Use live provider data when connected; this keeps the news panel populated offline." }
  ];
}

function demoMacroRows(startYear, endYear, base, amplitude, trend = 0) {
  const rows = [];
  const now = new Date();
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 0; month < 12; month++) {
      if (year === now.getFullYear() && month > now.getMonth()) break;
      const index = (year - startYear) * 12 + month;
      const value = Math.max(0, base + Math.sin(index / 11) * amplitude + Math.cos(index / 29) * amplitude * 0.45 + trend * index);
      rows.push({ date: `${year}-${String(month + 1).padStart(2, "0")}-01`, value: Number(value.toFixed(2)) });
    }
  }
  return rows;
}

function demoMacroIndicators() {
  const endYear = new Date().getFullYear();
  const unemploymentRows = demoMacroRows(1985, endYear, 5.1, 1.1, -0.001);
  unemploymentRows.push({ date: "2020-04-01", value: 14.7 });
  unemploymentRows.sort((a, b) => a.date.localeCompare(b.date));
  const inflationRows = demoMacroRows(1985, endYear, 3.1, 1.4, 0.0005);
  const fedRows = demoMacroRows(1985, endYear, 3.8, 2.1, -0.0015);
  const treasuryRows = demoMacroRows(1985, endYear, 4.6, 1.3, -0.001);
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
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
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

async function finnhub(endpoint, params, ttlMs) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not configured");
  const url = new URL(`https://finnhub.io/api/v1/${endpoint}`);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, String(value)));
  url.searchParams.set("token", key);
  const cacheKey = url.toString().replace(key, "[key]");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `Finnhub request failed (${response.status})`);
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

function yahooInterval(resolution) {
  return ({ "5": "5m", "15": "15m", "60": "60m", D: "1d", W: "1wk" })[resolution] || "1d";
}

async function yahooChart(symbol, range, ttlMs = 300000) {
  const window = candleWindow(range);
  const interval = yahooInterval(window.resolution);
  const cacheKey = `yahoo:chart:${symbol}:${range}:${interval}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < ttlMs) return cached.data;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(window.from));
  url.searchParams.set("period2", String(window.to));
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    },
    signal: AbortSignal.timeout(10000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.chart?.error?.description || `Yahoo Finance request failed (${response.status})`);
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result || !Array.isArray(result.timestamp) || !quote) throw new Error(payload?.chart?.error?.description || "Yahoo Finance returned no chart history");
  const rows = result.timestamp.map((time, index) => ({
    time: Number(time),
    open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    close: Number(quote.close?.[index]),
    volume: Number(quote.volume?.[index])
  })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));
  if (rows.length < 2) throw new Error("Yahoo Finance returned insufficient chart history");
  const data = {
    s: "ok",
    t: rows.map(row => row.time),
    o: rows.map(row => row.open),
    h: rows.map(row => row.high),
    l: rows.map(row => row.low),
    c: rows.map(row => row.close),
    v: rows.map(row => Number.isFinite(row.volume) ? row.volume : 0),
    meta: result.meta || {},
    symbol,
    range,
    displayFrom: window.displayFrom,
    resolution: window.resolution,
    provider: "Yahoo Finance fallback",
    fetchedAt: new Date().toISOString()
  };
  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function yahooQuote(chart) {
  const meta = chart?.meta || {};
  const current = Number(meta.regularMarketPrice ?? chart?.c?.at(-1));
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose);
  return {
    c: current,
    d: Number.isFinite(current) && Number.isFinite(previous) ? current - previous : null,
    dp: Number.isFinite(current) && Number.isFinite(previous) && previous !== 0 ? (current / previous - 1) * 100 : null,
    h: Number(meta.regularMarketDayHigh),
    l: Number(meta.regularMarketDayLow),
    o: Number(meta.regularMarketOpen),
    pc: previous,
    t: Number(meta.regularMarketTime),
    provider: "Yahoo Finance fallback"
  };
}

async function safeRequest(endpoint, params, ttlMs) {
  try { return await finnhub(endpoint, params, ttlMs); }
  catch (error) { return { unavailable: true, message: error.message }; }
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
    const chart = await yahooChart(symbol, "1Y", 300000);
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
  return { provider: "Yahoo Finance", fetchedAt: new Date().toISOString(), sectors: rows };
}

async function handleFinnhubStock(req, res, requestUrl) {
  if (!process.env.FINNHUB_API_KEY) return json(res, 503, { configured: false, error: "FINNHUB_API_KEY is not configured" });
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  if (!symbol) return json(res, 400, { error: "Invalid ticker symbol" });
  const allowedRanges = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]);
  const range = allowedRanges.has(requestUrl.searchParams.get("range")) ? requestUrl.searchParams.get("range") : "6M";
  const window = candleWindow(range);
  const resolution = window.resolution;
  const today = new Date();
  const newsTo = today.toISOString().slice(0, 10);
  today.setDate(today.getDate() - 30);
  const newsFrom = today.toISOString().slice(0, 10);

  const [quote, profile, metrics, finnhubCandles, earnings, news, sentiment, recommendations, probabilityCandles] = await Promise.all([
    safeRequest("quote", { symbol }, 30000),
    safeRequest("stock/profile2", { symbol }, 86400000),
    safeRequest("stock/metric", { symbol, metric: "all" }, 3600000),
    safeRequest("stock/candle", { symbol, resolution, from: window.from, to: window.to }, 300000),
    safeRequest("stock/earnings", { symbol, limit: 12 }, 3600000),
    safeRequest("company-news", { symbol, from: newsFrom, to: newsTo }, 300000),
    safeRequest("news-sentiment", { symbol }, 300000),
    safeRequest("stock/recommendation", { symbol }, 3600000),
    yahooChart(symbol, "5Y", 300000).catch(error => ({ unavailable: true, provider: "Yahoo Finance", message: error.message }))
  ]);
  const dataDiagnostics = [];
  let effectiveQuote = quote;
  let candles;
  if (!finnhubCandles?.unavailable && finnhubCandles?.s === "ok") {
    candles = { ...finnhubCandles, displayFrom: window.displayFrom, range, resolution, provider: "Finnhub", authApplied: Boolean(process.env.FINNHUB_API_KEY), fetchedAt: new Date().toISOString() };
    dataDiagnostics.push({ provider: "Finnhub candles", ok: true, authApplied: Boolean(process.env.FINNHUB_API_KEY), message: "Historical candles returned" });
  } else {
    dataDiagnostics.push({ provider: "Finnhub candles", ok: false, authApplied: Boolean(process.env.FINNHUB_API_KEY), message: finnhubCandles?.message || finnhubCandles?.s || "No candle history returned" });
    try {
      candles = await yahooChart(symbol, range);
      dataDiagnostics.push({ provider: "Yahoo Finance fallback", ok: true, authApplied: false, message: "Historical candles returned after Finnhub was unavailable" });
    } catch (error) {
      candles = { unavailable: true, provider: "Finnhub + Yahoo Finance", message: `Historical data unavailable: ${error.message}` };
      dataDiagnostics.push({ provider: "Yahoo Finance fallback", ok: false, authApplied: false, message: error.message });
    }
  }
  if (!candles || candles.unavailable || candles.s !== "ok") {
    candles = demoCandles(symbol, range);
    dataDiagnostics.push({ provider: "Demo fallback", ok: true, authApplied: false, message: "Offline chart data returned because live providers were unavailable" });
  }
  const finnhubQuoteOk = !quote?.unavailable && Number(quote?.c) > 0;
  if (!finnhubQuoteOk) {
    try {
      const yahooForQuote = candles?.provider === "Yahoo Finance fallback" ? candles : await yahooChart(symbol, range, 30000);
      effectiveQuote = yahooQuote(yahooForQuote);
    } catch (error) {
      dataDiagnostics.push({ provider: "Yahoo Finance quote fallback", ok: false, authApplied: false, message: error.message });
    }
  }
  if (!Number(effectiveQuote?.c)) effectiveQuote = demoQuote(symbol, candles);
  const effectiveQuoteOk = Number(effectiveQuote?.c) > 0;
  dataDiagnostics.unshift({
    provider: finnhubQuoteOk ? "Finnhub quote" : "Yahoo Finance quote fallback",
    ok: effectiveQuoteOk,
    authApplied: finnhubQuoteOk && Boolean(process.env.FINNHUB_API_KEY),
    message: finnhubQuoteOk ? "Current live quote returned" : effectiveQuote?.provider === "Demo fallback (offline)" ? "Offline quote returned because live providers were unavailable" : effectiveQuoteOk ? "Quote returned after Finnhub was unavailable" : quote?.message || "Quote unavailable"
  });

  json(res, 200, {
    configured: true,
    provider: candles?.provider === "Yahoo Finance fallback" || effectiveQuote?.provider === "Yahoo Finance fallback" ? "Finnhub + Yahoo Finance fallback" : "Finnhub",
    fetchedAt: new Date().toISOString(),
    symbol,
    range,
    resolution,
    quoteProvider: effectiveQuote?.provider || "Finnhub",
    candleProvider: candles?.provider || null,
    dataDiagnostics,
    quote: effectiveQuote,
    profile: usablePayload(profile) ? profile : demoProfile(symbol),
    metrics: usablePayload(metrics) ? metrics : demoMetrics(symbol),
    candles,
    probabilityCandles: usablePayload(probabilityCandles) && probabilityCandles.s === "ok" ? probabilityCandles : demoCandles(symbol, "5Y"),
    earnings: Array.isArray(earnings) ? earnings : demoEarnings(symbol),
    news: Array.isArray(news) ? news.slice(0, 20) : demoNews(symbol),
    sentiment: usablePayload(sentiment) ? sentiment : { provider: "Demo fallback (offline)", bullishPercent: 52, bearishPercent: 28 },
    recommendations: Array.isArray(recommendations) ? recommendations : [{ symbol, buy: 8, hold: 11, sell: 2, strongBuy: 4, strongSell: 1, period: new Date().toISOString().slice(0, 7) }]
  });
}

async function handleFinnhubCandles(req, res, requestUrl) {
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  const allowedRanges = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]);
  const range = allowedRanges.has(requestUrl.searchParams.get("range")) ? requestUrl.searchParams.get("range") : "6M";
  if (!symbol) return json(res, 400, { error: "Invalid ticker symbol" });
  const window = candleWindow(range);
  try {
    if (process.env.FINNHUB_API_KEY) {
      const candles = await finnhub("stock/candle", { symbol, resolution: window.resolution, from: window.from, to: window.to }, 60000);
      if (candles?.s === "ok" && Array.isArray(candles.t) && candles.t.length >= 2) {
        return json(res, 200, { ...candles, symbol, range, displayFrom: window.displayFrom, resolution: window.resolution, provider: "Finnhub", fetchedAt: new Date().toISOString() });
      }
    }
  } catch {
    // Continue to Yahoo Finance when Finnhub is unavailable or not entitled.
  }
  try {
    return json(res, 200, await yahooChart(symbol, range, 60000));
  } catch (error) {
    return json(res, 200, { ...demoCandles(symbol, range), detail: `Live historical candle requests failed: ${error.message}` });
  }
}

function streamFinnhubQuotes(req, res, requestUrl) {
  const symbol = validSymbol(requestUrl.searchParams.get("symbol"));
  if (!symbol || !process.env.FINNHUB_API_KEY) return json(res, 400, { error: "A valid symbol and FINNHUB_API_KEY are required" });
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
      const quote = await finnhub("quote", { symbol }, 4000);
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
  const staticRoot = fs.existsSync(path.join(root, "dist", "index.html")) ? path.join(root, "dist") : root;
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

http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  if (requestUrl.pathname === "/api/cnn/fear-greed") {
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
  if (requestUrl.pathname === "/api/finnhub/status") return json(res, 200, { configured: Boolean(process.env.FINNHUB_API_KEY), provider: "Finnhub" });
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
  if (requestUrl.pathname === "/api/finnhub/stock") {
    try { return await handleFinnhubStock(req, res, requestUrl); }
    catch (error) { return json(res, 502, { error: "Market data request failed", detail: error.message }); }
  }
  if (requestUrl.pathname === "/api/finnhub/candles") return handleFinnhubCandles(req, res, requestUrl);
  if (requestUrl.pathname === "/api/finnhub/stream") return streamFinnhubQuotes(req, res, requestUrl);
  serveStatic(req, res);
}).listen(4890, "127.0.0.1", () => {
  console.log("MarketLens AI running at http://127.0.0.1:4890");
  console.log(`Finnhub API: ${process.env.FINNHUB_API_KEY ? "configured" : "not configured"}`);
  console.log(`Market Data API: ${process.env.MARKET_DATA_API_TOKEN ? "configured" : "demo access only"}`);
  console.log(`Gemini API: ${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "configured" : "not configured"}`);
});
