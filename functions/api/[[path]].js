const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

const validSymbol = value => {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.^-]{1,12}$/.test(symbol) ? symbol : null;
};

const seed = symbol => String(symbol || "AAPL").split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 11), 0);
const basePrice = symbol => ({ AAPL: 212.41, MSFT: 501.48, NVDA: 164.92, TSLA: 315.35, AMZN: 224.83, META: 728.56, GOOGL: 196.52, SPY: 628.86, QQQ: 556.42, "^GSPC": 6299.19 })[symbol] || 35 + (seed(symbol) % 460);

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

function demoCandles(symbol, range = "6M") {
  const window = candleWindow(range);
  const base = basePrice(symbol);
  const count = ({ "1D": 78, "5D": 130, "1M": 160, "6M": 500, YTD: 520, "1Y": 640, "5Y": 1480, "10Y": 2760 })[range] || 500;
  const step = ["1D", "5D"].includes(range) ? Number(window.resolution) * 60 : 86400;
  const symbolSeed = seed(symbol);
  let close = base * (0.78 + (symbolSeed % 29) / 100);
  const t = [], o = [], h = [], l = [], c = [], v = [];
  const now = Math.floor(Date.now() / 1000);
  for (let index = count - 1; index >= 0; index--) {
    const timestamp = now - index * step;
    const date = new Date(timestamp * 1000);
    if (step >= 86400 && (date.getUTCDay() === 0 || date.getUTCDay() === 6)) continue;
    const wave = Math.sin((count - index + symbolSeed) / 17) * 0.012 + Math.cos((count - index + symbolSeed) / 41) * 0.007;
    const drift = 0.00055 + ((symbolSeed % 13) - 6) / 100000;
    const open = close;
    close = Math.max(2, close * (1 + drift + wave));
    const spread = Math.max(base * 0.003, Math.abs(close - open) * 1.4);
    t.push(timestamp);
    o.push(Number(open.toFixed(2)));
    c.push(Number(close.toFixed(2)));
    h.push(Number((Math.max(open, close) + spread).toFixed(2)));
    l.push(Number((Math.min(open, close) - spread).toFixed(2)));
    v.push(Math.round((2000000 + (symbolSeed % 80) * 100000) * (1 + Math.abs(wave) * 12)));
  }
  return { s: "ok", symbol, range, displayFrom: window.displayFrom, resolution: window.resolution, provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), t, o, h, l, c, v };
}

function demoQuote(symbol, candles = demoCandles(symbol, "6M")) {
  const closes = Array.isArray(candles.c) ? candles.c : [];
  const current = Number(closes.at(-1)) || basePrice(symbol);
  const previous = Number(closes.at(-2)) || current * 0.995;
  return { c: current, d: current - previous, dp: (current / previous - 1) * 100, h: current * 1.012, l: current * 0.988, o: previous, pc: previous, provider: "Demo fallback (offline)" };
}

const demoProfile = symbol => ({
  name: ({ AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.", "^GSPC": "S&P 500 Index" })[symbol] || `${symbol} Holdings`,
  exchange: symbol.startsWith("^") ? "INDEX" : "NASDAQ",
  finnhubIndustry: symbol.startsWith("^") ? "Market Index" : "Technology",
  marketCapitalization: 100000 + (seed(symbol) % 2500000),
  shareOutstanding: 1000 + (seed(symbol) % 12000)
});

const demoMetrics = symbol => ({ metric: {
  epsTTM: 2 + (seed(symbol) % 1800) / 100,
  epsGrowth5Y: -4 + (seed(symbol) % 2600) / 100,
  peTTM: 12 + (seed(symbol) % 3200) / 100,
  revenuePerShareTTM: 15 + (seed(symbol) % 8000) / 100,
  "52WeekHigh": basePrice(symbol) * 1.22,
  "52WeekLow": basePrice(symbol) * 0.72
} });

function demoEarnings(symbol) {
  return Array.from({ length: 8 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (7 - index) * 3);
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    const actual = 1 + (seed(symbol) % 220) / 100 + index * 0.08;
    const estimate = actual - 0.05 + ((index % 3) - 1) * 0.03;
    return { symbol, year: date.getFullYear(), quarter, period: `${date.getFullYear()} Q${quarter}`, actual, estimate, surprise: actual - estimate };
  }).reverse();
}

const demoNews = symbol => [
  { id: `${symbol}-demo-1`, datetime: Math.floor(Date.now() / 1000) - 3600, headline: `${symbol} market update: price action and macro conditions in focus`, source: "MarketLens demo", url: "#", summary: "Offline fallback story shown while live company headlines are unavailable." },
  { id: `${symbol}-demo-2`, datetime: Math.floor(Date.now() / 1000) - 10800, headline: `${symbol} traders watch earnings estimates and volume trend`, source: "MarketLens demo", url: "#", summary: "Use live provider data when connected; this keeps the news panel populated offline." }
];

function macroRows(startYear, endYear, base, amplitude, trend = 0) {
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

function seriesSummary(id, name, frequency, units, rows) {
  const latest = rows.at(-1);
  const prior = rows.at(-2);
  const yearAgo = rows[Math.max(0, rows.length - 13)] || rows[0];
  return { id, name, frequency, units, rows, latest, prior, yearAgo };
}

function demoMacro() {
  const endYear = new Date().getFullYear();
  const unemployment = macroRows(1985, endYear, 5.1, 1.1, -0.001);
  unemployment.push({ date: "2020-04-01", value: 14.7 });
  unemployment.sort((a, b) => a.date.localeCompare(b.date));
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), series: {
    unemployment: seriesSummary("UNRATE", "Unemployment Rate", "Monthly", "%", unemployment),
    inflation: seriesSummary("CPIAUCSL", "Inflation (CPI YoY)", "Monthly, year-over-year", "%", macroRows(1985, endYear, 3.1, 1.4, 0.0005)),
    fed: seriesSummary("FEDFUNDS", "Fed Funds Rate", "Monthly average", "%", macroRows(1985, endYear, 3.8, 2.1, -0.0015)),
    treasury: seriesSummary("DGS10", "10-Year Treasury Yield", "Daily", "%", macroRows(1985, endYear, 4.6, 1.3, -0.001))
  } };
}

function demoSectors() {
  const sectors = [["XLK", "Technology"], ["XLC", "Communication Services"], ["XLY", "Consumer Discretionary"], ["XLF", "Financials"], ["XLI", "Industrials"], ["XLE", "Energy"], ["XLV", "Health Care"], ["XLP", "Consumer Staples"], ["XLU", "Utilities"], ["XLB", "Materials"], ["XLRE", "Real Estate"]];
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), sectors: sectors.map(([symbol, name], index) => {
    const valueSeed = seed(symbol);
    return { symbol, name, price: basePrice(symbol), oneMonth: -4 + (valueSeed % 900) / 100, threeMonth: -8 + ((valueSeed + index * 41) % 1600) / 100, sixMonth: -12 + ((valueSeed + index * 73) % 2600) / 100, ytd: -15 + ((valueSeed + index * 109) % 3400) / 100 };
  }) };
}

function demoFearGreed() {
  const history = Array.from({ length: 190 }, (_, index) => ({ x: Date.now() - (189 - index) * 86400000, y: Math.max(5, Math.min(95, 48 + Math.sin(index / 12) * 17 + Math.cos(index / 31) * 8)) }));
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), fear_and_greed: { score: 54, rating: "Neutral", previous_close: 52, previous_1_week: 49, previous_1_month: 57, previous_1_year: 45 }, fear_and_greed_historical: { data: history }, market_momentum_sp500: { score: 58, rating: "Neutral" }, stock_price_strength: { score: 55, rating: "Neutral" }, stock_price_breadth: { score: 51, rating: "Neutral" }, put_call_options: { score: 47, rating: "Neutral" }, market_volatility_vix: { score: 62, rating: "Greed" }, junk_bond_demand: { score: 53, rating: "Neutral" }, safe_haven_demand: { score: 49, rating: "Neutral" } };
}

function normalPdf(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function gamma(spot, strike, iv, years) {
  if (![spot, strike, iv, years].every(Number.isFinite) || spot <= 0 || strike <= 0 || iv <= 0 || years <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (0.043 + iv * iv / 2) * years) / (iv * Math.sqrt(years));
  return normalPdf(d1) / (spot * iv * Math.sqrt(years));
}

function demoGamma(symbol, dte = 30) {
  const spot = basePrice(symbol);
  const strikes = [];
  let netGamma = 0;
  for (let offset = -10; offset <= 10; offset++) {
    const strike = Number(Math.max(1, spot * (1 + offset * 0.015)).toFixed(2));
    const distance = Math.abs(strike / spot - 1);
    const iv = 0.22 + distance * 1.8;
    const g = gamma(spot, strike, iv, dte / 365);
    const callGamma = g * (250 + (11 - Math.abs(offset)) * 220) * 100 * spot * spot * 0.01;
    const putGamma = -g * (330 + (11 - Math.abs(offset)) * 220) * 100 * spot * spot * 0.01;
    const row = { strike, callGamma, putGamma, netGamma: callGamma + putGamma };
    netGamma += row.netGamma;
    strikes.push(row);
  }
  const callWall = strikes.reduce((best, row) => row.callGamma > best.callGamma ? row : best, strikes[0]);
  const putWall = strikes.reduce((best, row) => row.putGamma < best.putGamma ? row : best, strikes[0]);
  return { s: "ok", symbol, provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), underlyingPrice: spot, gammaFlip: spot, callWall: callWall.strike, putWall: putWall.strike, netGamma, atmImpliedVolatility: 0.24, contractCount: strikes.length * 2, strikes, curve: strikes.map(row => ({ spot: row.strike, netGamma: row.netGamma })) };
}

function summarizeGammaPayload(payload, symbol, requestedDte, provider = "Market Data") {
  const spot = Number(payload.underlyingPrice?.[0] || payload.underlying?.price || payload.quote?.regularMarketPrice || payload.lastPrice);
  const rows = [];
  const strikes = Array.isArray(payload.strike) ? payload.strike : [];
  for (let index = 0; index < strikes.length; index++) {
    const strike = Number(payload.strike[index]);
    const side = String(payload.side?.[index] || payload.optionType?.[index] || "").toLowerCase();
    const openInterest = Number(payload.openInterest?.[index] || payload.oi?.[index] || 0);
    const gammaValue = Number(payload.gamma?.[index]);
    const iv = Number(payload.iv?.[index] || payload.impliedVolatility?.[index]);
    const dte = Number(payload.dte?.[index] || requestedDte);
    const usableGamma = Number.isFinite(gammaValue) ? gammaValue : gamma(spot, strike, iv, Math.max(dte, 1) / 365);
    if (!Number.isFinite(spot) || !Number.isFinite(strike) || !Number.isFinite(openInterest) || !Number.isFinite(usableGamma)) continue;
    const signed = usableGamma * openInterest * 100 * spot * spot * 0.01 * (side.includes("put") ? -1 : 1);
    rows.push({ strike, side: side.includes("put") ? "put" : "call", openInterest, gamma: usableGamma, iv, dte, signedGamma: signed });
  }
  if (!rows.length) throw new Error("Options chain returned no usable gamma rows");
  const byStrike = new Map();
  rows.forEach(row => {
    const key = row.strike.toFixed(2);
    const entry = byStrike.get(key) || { strike: row.strike, callGamma: 0, putGamma: 0, netGamma: 0 };
    if (row.side === "put") entry.putGamma += row.signedGamma;
    else entry.callGamma += row.signedGamma;
    entry.netGamma += row.signedGamma;
    byStrike.set(key, entry);
  });
  const grouped = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const callWall = grouped.reduce((best, row) => row.callGamma > best.callGamma ? row : best, grouped[0]);
  const putWall = grouped.reduce((best, row) => row.putGamma < best.putGamma ? row : best, grouped[0]);
  let gammaFlip = null;
  for (let index = 1; index < grouped.length; index++) {
    const previous = grouped[index - 1], current = grouped[index];
    if (previous.netGamma === 0 || previous.netGamma * current.netGamma < 0) {
      gammaFlip = current.strike;
      break;
    }
  }
  const ivRows = rows.filter(row => Number.isFinite(row.iv) && row.openInterest > 0);
  const ivWeight = ivRows.reduce((sum, row) => sum + row.openInterest, 0);
  return {
    s: "ok", symbol, provider, methodology: "Dealer-sign gamma x open interest x 100 x spot squared x 1% move",
    requestedDte, underlyingPrice: spot, gammaFlip, callWall: callWall?.strike || null, putWall: putWall?.strike || null,
    atmImpliedVolatility: ivWeight ? ivRows.reduce((sum, row) => sum + row.iv * row.openInterest, 0) / ivWeight : null,
    callGamma: grouped.reduce((sum, row) => sum + row.callGamma, 0),
    putGamma: grouped.reduce((sum, row) => sum + row.putGamma, 0),
    netGamma: grouped.reduce((sum, row) => sum + row.netGamma, 0),
    contractCount: rows.length, strikes: grouped, curve: grouped.map(row => ({ spot: row.strike, netGamma: row.netGamma })),
    fetchedAt: new Date().toISOString()
  };
}

async function marketDataGamma(env, symbol, requestedDte) {
  if (!env.MARKET_DATA_API_TOKEN) throw new Error("MARKET_DATA_API_TOKEN is not configured");
  const url = new URL(`https://api.marketdata.app/v1/options/chain/${encodeURIComponent(symbol)}/`);
  url.searchParams.set("dte", String(requestedDte));
  url.searchParams.set("strikeLimit", "50");
  url.searchParams.set("minOpenInterest", "1");
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${env.MARKET_DATA_API_TOKEN}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.s !== "ok") throw new Error(payload.errmsg || `Options request failed (${response.status})`);
  return summarizeGammaPayload(payload, symbol, requestedDte);
}

async function finnhub(env, endpoint, params) {
  if (!env.FINNHUB_API_KEY) throw new Error("FINNHUB_API_KEY is not configured");
  const url = new URL(`https://finnhub.io/api/v1/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("token", env.FINNHUB_API_KEY);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `Finnhub request failed (${response.status})`);
  return data;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function aiChat(env, request) {
  const payload = await readJson(request);
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const message = String(payload?.message || "").trim().slice(0, 4000);
  if (!message) return json({ error: "A message is required" }, 400);
  if (!key) {
    return json({
      answer: "I can help with the stock context already loaded in the app, but the production AI key is not configured yet. Add GEMINI_API_KEY in Cloudflare Pages environment variables to enable live AI responses.",
      provider: "Market Copilot",
      configured: false
    });
  }
  const contextText = JSON.stringify(payload?.context || {}).slice(0, 12000);
  const history = Array.isArray(payload?.history) ? payload.history.slice(-8) : [];
  const contents = history
    .filter(item => ["user", "model"].includes(item?.role) && item?.text)
    .map(item => ({ role: item.role, parts: [{ text: String(item.text).slice(0, 4000) }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `You are Market Copilot, a concise stock research assistant. Use the supplied live app context as the source of truth. Explain uncertainty and do not present analysis as personalized financial advice. Current app context: ${contextText}` }] },
      contents,
      generationConfig: { temperature: 0.35, maxOutputTokens: 700 }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: "AI response is unavailable", detail: data?.error?.message || `Gemini request failed (${response.status})` }, 502);
  const answer = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n").trim();
  return json({ answer: answer || "I could not generate a response for that request.", provider: "Market Copilot", model, configured: true });
}

async function stockPayload(env, url) {
  const symbol = validSymbol(url.searchParams.get("symbol"));
  if (!symbol) return json({ error: "Invalid ticker symbol" }, 400);
  const range = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]).has(url.searchParams.get("range")) ? url.searchParams.get("range") : "6M";
  const window = candleWindow(range);
  let candles = demoCandles(symbol, range);
  let quote = demoQuote(symbol, candles);
  let profile = demoProfile(symbol);
  let metrics = demoMetrics(symbol);
  let earnings = demoEarnings(symbol);
  let news = demoNews(symbol);
  const diagnostics = [{ provider: "Demo fallback", ok: true, authApplied: false, message: "Pages Function fallback is available" }];
  try {
    const liveQuote = await finnhub(env, "quote", { symbol });
    if (Number(liveQuote.c) > 0) quote = { ...liveQuote, provider: "Finnhub" };
    diagnostics.unshift({ provider: "Finnhub quote", ok: Number(liveQuote.c) > 0, authApplied: true, message: "Quote returned" });
  } catch (error) {
    diagnostics.unshift({ provider: "Finnhub quote", ok: false, authApplied: Boolean(env.FINNHUB_API_KEY), message: error.message });
  }
  try {
    const liveCandles = await finnhub(env, "stock/candle", { symbol, resolution: window.resolution, from: window.from, to: window.to });
    if (liveCandles?.s === "ok" && Array.isArray(liveCandles.c) && liveCandles.c.length > 2) candles = { ...liveCandles, symbol, range, displayFrom: window.displayFrom, resolution: window.resolution, provider: "Finnhub", fetchedAt: new Date().toISOString() };
  } catch {}
  try { profile = await finnhub(env, "stock/profile2", { symbol }); } catch {}
  try { metrics = await finnhub(env, "stock/metric", { symbol, metric: "all" }); } catch {}
  try {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    today.setDate(today.getDate() - 30);
    const liveNews = await finnhub(env, "company-news", { symbol, from: today.toISOString().slice(0, 10), to });
    if (Array.isArray(liveNews) && liveNews.length) news = liveNews.slice(0, 20);
  } catch {}
  try {
    const liveEarnings = await finnhub(env, "stock/earnings", { symbol, limit: 12 });
    if (Array.isArray(liveEarnings) && liveEarnings.length) earnings = liveEarnings;
  } catch {}
  return json({ configured: true, provider: quote.provider === "Finnhub" || candles.provider === "Finnhub" ? "Finnhub + fallback" : "Demo fallback (offline)", fetchedAt: new Date().toISOString(), symbol, range, resolution: window.resolution, quoteProvider: quote.provider, candleProvider: candles.provider, dataDiagnostics: diagnostics, quote, profile, metrics, candles, probabilityCandles: demoCandles(symbol, "5Y"), earnings, news, sentiment: { provider: "Demo fallback (offline)", bullishPercent: 52, bearishPercent: 28 }, recommendations: [{ symbol, buy: 8, hold: 11, sell: 2, strongBuy: 4, strongSell: 1, period: new Date().toISOString().slice(0, 7) }] });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  if (pathname === "/api/finnhub/stock") return stockPayload(context.env, url);
  if (pathname === "/api/finnhub/status") return json({ configured: Boolean(context.env.FINNHUB_API_KEY), provider: "Finnhub" });
  if (pathname === "/api/market-data/status") return json({ configured: Boolean(context.env.MARKET_DATA_API_TOKEN), provider: "Market Data" });
  if (pathname === "/api/finnhub/candles") {
    const symbol = validSymbol(url.searchParams.get("symbol"));
    if (!symbol) return json({ error: "Invalid ticker symbol" }, 400);
    const range = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]).has(url.searchParams.get("range")) ? url.searchParams.get("range") : "6M";
    const window = candleWindow(range);
    try {
      const liveCandles = await finnhub(context.env, "stock/candle", { symbol, resolution: window.resolution, from: window.from, to: window.to });
      if (liveCandles?.s === "ok" && Array.isArray(liveCandles.c) && liveCandles.c.length > 2) {
        return json({ ...liveCandles, symbol, range, displayFrom: window.displayFrom, resolution: window.resolution, provider: "Finnhub", fetchedAt: new Date().toISOString() });
      }
    } catch {}
    return json(demoCandles(symbol, range));
  }
  if (pathname === "/api/finnhub/stream") {
    const symbol = validSymbol(url.searchParams.get("symbol"));
    const candles = symbol ? demoCandles(symbol, "1D") : null;
    const quote = symbol ? demoQuote(symbol, candles) : null;
    return new Response(`event: quote\ndata: ${JSON.stringify({ symbol, ...quote })}\n\n`, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" }
    });
  }
  if (pathname === "/api/macro/indicators") return json(demoMacro());
  if (pathname === "/api/macro/sector-etfs") return json(demoSectors());
  if (pathname === "/api/cnn/fear-greed") return json(demoFearGreed());
  if (pathname === "/api/options/gamma") {
    const symbol = validSymbol(url.searchParams.get("symbol"));
    if (!symbol || symbol.startsWith("^") || symbol.includes("-")) return json({ error: "Enter a valid stock or ETF ticker with listed options" }, 400);
    const requestedDte = Math.max(1, Math.min(365, Number(url.searchParams.get("dte")) || 30));
    try {
      return json(await marketDataGamma(context.env, symbol, requestedDte));
    } catch (error) {
      return json({ ...demoGamma(symbol, requestedDte), detail: `Live gamma exposure unavailable: ${error.message}` });
    }
  }
  if (pathname === "/api/firebase/config") return json({ configured: Boolean(context.env.FIREBASE_API_KEY && context.env.FIREBASE_AUTH_DOMAIN && context.env.FIREBASE_PROJECT_ID && context.env.FIREBASE_APP_ID), config: { apiKey: context.env.FIREBASE_API_KEY || "", authDomain: context.env.FIREBASE_AUTH_DOMAIN || "", projectId: context.env.FIREBASE_PROJECT_ID || "", storageBucket: context.env.FIREBASE_STORAGE_BUCKET || "", messagingSenderId: context.env.FIREBASE_MESSAGING_SENDER_ID || "", appId: context.env.FIREBASE_APP_ID || "" } });
  if (pathname === "/api/ai/status") return json({ configured: Boolean(context.env.GEMINI_API_KEY || context.env.GOOGLE_API_KEY), provider: "Market Copilot" });
  if (pathname === "/api/ai/chat" && context.request.method === "POST") return aiChat(context.env, context.request);
  if (pathname === "/api/world-chat/presence") return json({ online: 1, byChannel: { global: 1, stocks: 0, macro: 0, "off-topic": 0 } });
  if (pathname === "/api/world-chat/messages") return json({ channel: "global", online: 1, byChannel: { global: 1, stocks: 0, macro: 0, "off-topic": 0 }, messages: [{ id: "welcome", channel: "global", user: "MarketLens", text: "Welcome to World Chat. Cloudflare demo mode is active.", createdAt: Date.now(), system: true }] });
  return json({ error: "Not found" }, 404);
}
