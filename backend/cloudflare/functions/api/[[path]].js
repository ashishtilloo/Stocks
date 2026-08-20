const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
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

function alphaVantageKey(env) {
  return env.ALPHA_VANTAGE_API_KEY || env.ALPHAVANTAGE_API_KEY;
}

function alphaVantageSymbol(symbol) {
  return ({ "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "QQQ" })[symbol] || symbol;
}

async function alphaVantage(env, params) {
  const apiKey = alphaVantageKey(env);
  if (!apiKey) throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
  const url = new URL("https://www.alphavantage.co/query");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  const providerMessage = data["Error Message"] || data.Note || data.Information;
  if (!response.ok || providerMessage) throw new Error(providerMessage || `Alpha Vantage request failed (${response.status})`);
  return data;
}

function alphaTimestampFromDate(date, intraday = false) {
  return Math.floor(new Date(intraday ? `${date.replace(" ", "T")}:00Z` : `${date}T16:00:00Z`).getTime() / 1000);
}

function alphaNumber(row, key) {
  const value = Number(row?.[key]);
  return Number.isFinite(value) ? value : null;
}

async function alphaVantageQuote(env, symbol) {
  const sourceSymbol = alphaVantageSymbol(symbol);
  const data = await alphaVantage(env, { function: "GLOBAL_QUOTE", symbol: sourceSymbol });
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

function alphaSeriesKey(data) {
  return Object.keys(data || {}).find(key => /Time Series/i.test(key));
}

async function alphaVantageChart(env, symbol, range) {
  const window = candleWindow(range);
  const sourceSymbol = alphaVantageSymbol(symbol);
  const intraday = ["1D", "5D", "1M"].includes(range);
  const interval = ({ "5": "5min", "15": "15min", "60": "60min" })[window.resolution] || "60min";
  const data = await alphaVantage(env, intraday
    ? { function: "TIME_SERIES_INTRADAY", symbol: sourceSymbol, interval, outputsize: "full", adjusted: "false" }
    : { function: "TIME_SERIES_DAILY_ADJUSTED", symbol: sourceSymbol, outputsize: "full" });
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
  const nasdaq = new Set(["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "GOOG", "AMD", "NFLX", "INTC", "COST", "ADBE", "AVGO", "PEP", "CSCO", "CMCSA", "TMUS"]);
  const exchanges = nasdaq.has(symbol) ? ["NASDAQ", "NYSE", "NYSEARCA"] : ["NYSE", "NASDAQ", "NYSEARCA"];
  return exchanges.map(exchange => `${symbol}:${exchange}`);
}

function parseGoogleNumber(value) {
  const cleaned = String(value || "").replace(/&amp;/g, "&").replace(/[^\d.+-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

async function googleFinanceQuote(symbol) {
  let lastError = null;
  for (const candidate of googleFinanceCandidates(symbol)) {
    try {
      const encodedCandidate = candidate.split(":").map(encodeURIComponent).join(":");
      const response = await fetch(`https://www.google.com/finance/quote/${encodedCandidate}`, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
        }
      });
      const html = await response.text();
      if (!response.ok) throw new Error(`Google Finance request failed (${response.status})`);
      const current = parseGoogleNumber(html.match(/data-last-price="([^"]+)"/)?.[1])
        ?? parseGoogleNumber(html.match(/class="YMlKec fxKbKc">([^<]+)</)?.[1]);
      if (!Number.isFinite(current)) throw new Error("Google Finance returned no current price");
      const previous = parseGoogleNumber(html.match(/data-previous-close="([^"]+)"/)?.[1]);
      const timestamp = Number(html.match(/data-last-normal-market-timestamp-sec="([^"]+)"/)?.[1]);
      return {
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
  let field = "";
  let quoted = false;
  for (const char of String(line || "")) {
    if (char === "\"") quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map(value => value.trim().replace(/^"|"$/g, ""));
}

async function stooqChart(symbol, range, apiKey = "") {
  const window = candleWindow(range);
  const url = new URL("https://stooq.com/q/d/l/");
  url.searchParams.set("s", stooqSymbol(symbol));
  url.searchParams.set("d1", yyyymmdd(window.from));
  url.searchParams.set("d2", yyyymmdd(window.to));
  url.searchParams.set("i", "d");
  if (apiKey) url.searchParams.set("apikey", apiKey);
  const response = await fetch(url, {
    headers: {
      accept: "text/csv",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"
    }
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
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume) || 0
    };
  }).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite));
  if (rows.length < 2) throw new Error("Stooq returned insufficient valid OHLC rows");
  const latestTime = rows.at(-1).time;
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
    range,
    displayFrom: rangeDisplayFrom(range, latestTime),
    resolution: "D",
    provider: "Stooq",
    fetchedAt: new Date().toISOString()
  };
}

async function marketChart(env, symbol, range) {
  const diagnostics = [];
  try {
    const [candles, rawQuote] = await Promise.all([
      alphaVantageChart(env, symbol, range),
      alphaVantageQuote(env, symbol)
    ]);
    if (!Number.isFinite(Number(rawQuote?.c)) || Number(rawQuote.c) <= 0) throw new Error("Alpha Vantage returned candles but no current quote");
    const quote = { ...rawQuote, provider: "Alpha Vantage" };
    diagnostics.push({ provider: "Alpha Vantage", ok: true, authApplied: Boolean(alphaVantageKey(env)), message: "Quote, OHLC, and volume returned" });
    return { candles, quote, diagnostics, provider: "Alpha Vantage" };
  } catch (error) {
    diagnostics.push({ provider: "Alpha Vantage", ok: false, authApplied: Boolean(alphaVantageKey(env)), message: error.message });
  }

  let googleQuote = null;
  try {
    googleQuote = await googleFinanceQuote(symbol);
    diagnostics.push({ provider: "Google Finance", ok: true, authApplied: false, message: "Current quote returned" });
  } catch (error) {
    diagnostics.push({ provider: "Google Finance", ok: false, authApplied: false, message: error.message });
  }

  try {
    const candles = await stooqChart(symbol, range, env.STOOQ_API_KEY || "");
    diagnostics.push({ provider: "Stooq", ok: true, authApplied: Boolean(env.STOOQ_API_KEY), message: "Daily OHLC and volume returned" });
    const quote = googleQuote || chartQuote(candles);
    if (!Number.isFinite(Number(quote?.c))) throw new Error("Stooq returned history but no current quote");
    return { candles, quote, diagnostics, provider: quote.provider === "Google Finance" ? "Google Finance + Stooq" : "Stooq" };
  } catch (error) {
    diagnostics.push({ provider: "Stooq", ok: false, authApplied: Boolean(env.STOOQ_API_KEY), message: error.message });
  }

  const detail = diagnostics.map(item => `${item.provider}: ${item.message}`).join("; ");
  const unavailable = new Error(`Market data unavailable from Alpha Vantage, Google Finance, and Stooq. ${detail}`);
  unavailable.diagnostics = diagnostics;
  throw unavailable;
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

async function alphaVantageOverview(env, symbol) {
  const sourceSymbol = alphaVantageSymbol(symbol);
  const overview = await alphaVantage(env, { function: "OVERVIEW", symbol: sourceSymbol });
  if (!overview || !overview.Symbol) throw new Error("Alpha Vantage returned no company overview");
  const shares = Number(overview.SharesOutstanding);
  const marketCapDollars = Number(overview.MarketCapitalization);
  const revenue = Number(overview.RevenueTTM);
  return {
    profile: {
      name: overview.Name || `${symbol} Holdings`,
      exchange: overview.Exchange || (symbol.startsWith("^") ? "INDEX" : "NASDAQ"),
      finnhubIndustry: overview.Sector || overview.Industry || (symbol.startsWith("^") ? "Market Index" : "N/A"),
      marketCapitalization: Number.isFinite(marketCapDollars) ? marketCapDollars / 1_000_000 : null,
      shareOutstanding: Number.isFinite(shares) ? shares / 1_000_000 : null
    },
    metrics: { metric: {
      epsTTM: Number(overview.EPS),
      epsGrowth5Y: Number(overview.QuarterlyEarningsGrowthYOY) * 100,
      peTTM: Number(overview.PERatio),
      revenuePerShareTTM: Number.isFinite(revenue) && Number.isFinite(shares) && shares > 0 ? revenue / shares : Number(overview.RevenuePerShareTTM),
      "52WeekHigh": Number(overview["52WeekHigh"]),
      "52WeekLow": Number(overview["52WeekLow"])
    } }
  };
}

async function alphaVantageEarnings(env, symbol) {
  const data = await alphaVantage(env, { function: "EARNINGS", symbol: alphaVantageSymbol(symbol) });
  const rows = Array.isArray(data.quarterlyEarnings) ? data.quarterlyEarnings : [];
  if (!rows.length) throw new Error("Alpha Vantage returned no earnings records");
  return rows.slice(0, 12).map(row => {
    const date = new Date(`${row.fiscalDateEnding}T00:00:00Z`);
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    const actual = Number(row.reportedEPS);
    const estimate = Number(row.estimatedEPS);
    return {
      symbol,
      year: date.getUTCFullYear(),
      quarter,
      period: `${date.getUTCFullYear()} Q${quarter}`,
      actual,
      estimate,
      surprise: Number.isFinite(actual) && Number.isFinite(estimate) ? actual - estimate : Number(row.surprise)
    };
  });
}

function alphaNewsTimestamp(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})/);
  if (!match) return Math.floor(Date.now() / 1000);
  const [, year, month, day, hour, minute, second] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000);
}

async function alphaVantageNews(env, symbol) {
  const data = await alphaVantage(env, { function: "NEWS_SENTIMENT", tickers: alphaVantageSymbol(symbol), limit: 20 });
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
  for (let index = sorted[0].index; index <= monthIndex(latestDate); index++) {
    let left = sorted[0], right = sorted.at(-1);
    for (let anchorIndex = 1; anchorIndex < sorted.length; anchorIndex++) {
      if (index <= sorted[anchorIndex].index) {
        left = sorted[anchorIndex - 1];
        right = sorted[anchorIndex];
        break;
      }
    }
    const progress = Math.max(0, Math.min(1, (index - left.index) / Math.max(1, right.index - left.index)));
    const cycle = Math.sin(index / 5.7) * 0.035 + Math.cos(index / 13.3) * 0.025;
    rows.push({ date: monthDate(index), value: Number(Math.max(0, left.value + (right.value - left.value) * progress + cycle).toFixed(2)) });
  }
  return rows;
}

function seriesSummary(id, name, frequency, units, rows) {
  const latest = rows.at(-1);
  const prior = rows.at(-2);
  const yearAgoDate = new Date(`${latest.date}T00:00:00Z`);
  yearAgoDate.setUTCFullYear(yearAgoDate.getUTCFullYear() - 1);
  const yearAgo = rows.reduce((best, row) => Math.abs(new Date(`${row.date}T00:00:00Z`) - yearAgoDate) < Math.abs(new Date(`${best.date}T00:00:00Z`) - yearAgoDate) ? row : best, rows[0]);
  return { id, name, frequency, units, rows, latest, prior, yearAgo };
}

function demoMacro() {
  const unemployment = anchoredMacroRows([["1985-01-01",7.3],["1989-03-01",5.0],["1992-06-01",7.8],["2000-04-01",3.8],["2003-06-01",6.3],["2007-05-01",4.4],["2009-10-01",10.0],["2015-12-01",5.0],["2019-12-01",3.6],["2020-04-01",14.7],["2021-12-01",3.9],["2023-04-01",3.4],["2024-12-01",4.1],["2026-05-01",4.3]], "2026-05-01");
  const inflation = anchoredMacroRows([["1985-01-01",3.5],["1991-01-01",5.6],["1998-06-01",1.7],["2008-07-01",5.6],["2009-07-01",0.0],["2015-01-01",0.1],["2019-12-01",2.3],["2022-06-01",9.1],["2023-12-01",3.3],["2025-05-01",2.31],["2026-05-01",4.47]], "2026-05-01");
  const fed = anchoredMacroRows([["1985-01-01",8.4],["1992-09-01",3.0],["2000-07-01",6.5],["2003-06-01",1.0],["2007-08-01",5.25],["2009-01-01",0.16],["2015-12-01",0.24],["2019-07-01",2.4],["2021-12-01",0.08],["2023-08-01",5.33],["2025-06-01",4.33],["2026-06-01",3.63]], "2026-06-01");
  const treasury = anchoredMacroRows([["1985-01-01",11.4],["1993-10-01",5.3],["2000-01-01",6.7],["2003-06-01",3.3],["2007-06-01",5.1],["2012-07-01",1.5],["2018-11-01",3.2],["2020-08-01",0.6],["2022-10-01",4.1],["2023-10-01",4.9],["2025-06-01",4.21],["2026-06-01",4.45]], "2026-06-01");
  return { provider: "Demo fallback (offline)", fetchedAt: new Date().toISOString(), series: {
    unemployment: seriesSummary("UNRATE", "Unemployment Rate", "Monthly", "%", unemployment),
    inflation: seriesSummary("CPIAUCSL", "Inflation (CPI YoY)", "Monthly, year-over-year", "%", inflation),
    fed: seriesSummary("FEDFUNDS", "Fed Funds Rate", "Monthly average", "%", fed),
    treasury: seriesSummary("DGS10", "10-Year Treasury Yield", "Daily", "%", treasury)
  } };
}

function parseFredCsv(csv) {
  return String(csv || "").trim().split(/\r?\n/).slice(1).map(line => {
    const [date, rawValue] = line.split(",");
    const cleaned = String(rawValue ?? "").trim();
    return { date, value: cleaned && cleaned !== "." ? Number(cleaned) : NaN };
  }).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.value));
}

async function fredSeries(id) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", id);
  const response = await fetch(url, { headers: { accept: "text/csv", "user-agent": "MarketLens/1.0" } });
  if (!response.ok) throw new Error(`FRED ${id} request failed (${response.status})`);
  const rows = parseFredCsv(await response.text());
  if (!rows.length) throw new Error(`FRED ${id} returned no observations`);
  return rows;
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
      unemployment: seriesSummary("UNRATE", "Unemployment Rate", "Monthly", "%", unemploymentRows),
      inflation: seriesSummary("CPIAUCSL", "Inflation (CPI YoY)", "Monthly, year-over-year", "%", inflationRows),
      fed: seriesSummary("FEDFUNDS", "Fed Funds Rate", "Monthly average", "%", fedRows),
      treasury: seriesSummary("DGS10", "10-Year Treasury Yield", "Daily", "%", treasuryRows)
    }
  };
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
    return json({ error: "Live AI is not configured", configured: false }, 503);
  }
  const contextText = JSON.stringify(payload?.context || {}).slice(0, 12000);
  const history = Array.isArray(payload?.history) ? payload.history.slice(-8) : [];
  const contents = history
    .filter(item => ["user", "model"].includes(item?.role) && item?.text)
    .map(item => ({ role: item.role, parts: [{ text: String(item.text).slice(0, 4000) }] }));
  contents.push({ role: "user", parts: [{ text: message }] });
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
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
  let candles;
  let quote;
  let profile = demoProfile(symbol);
  let metrics = demoMetrics(symbol);
  let earnings = demoEarnings(symbol);
  let news = demoNews(symbol);
  const diagnostics = [];
  try {
    const market = await marketChart(env, symbol, range);
    candles = market.candles;
    quote = market.quote;
    diagnostics.push(...market.diagnostics);
  } catch (error) {
    diagnostics.push(...(error.diagnostics || []));
    candles = demoCandles(symbol, range);
    quote = demoQuote(symbol, candles);
    diagnostics.push({ provider: "Demo fallback", ok: true, authApplied: false, message: "Offline fallback returned because Alpha Vantage, Google Finance, and Stooq were unreachable from this environment" });
  }
  try {
    const overview = await alphaVantageOverview(env, symbol);
    profile = overview.profile;
    metrics = overview.metrics;
  } catch {}
  try { earnings = await alphaVantageEarnings(env, symbol); } catch {}
  try { news = await alphaVantageNews(env, symbol); } catch {}
  let probabilityCandles = candles;
  try { probabilityCandles = (await marketChart(env, symbol, "5Y")).candles; } catch {}
  return json({ configured: true, provider: candles.provider || "Market data", fetchedAt: new Date().toISOString(), symbol, range, resolution: candles.resolution, quoteProvider: quote.provider, candleProvider: candles.provider, dataDiagnostics: diagnostics, quote, profile, metrics, candles, probabilityCandles, earnings, news, sentiment: { provider: "Demo fallback (offline)", bullishPercent: 52, bearishPercent: 28 }, recommendations: [{ symbol, buy: 8, hold: 11, sell: 2, strongBuy: 4, strongSell: 1, period: new Date().toISOString().slice(0, 7) }] });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  if (context.request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (pathname === "/api/market/stock" || pathname === "/api/market/quote" || pathname === "/api/finnhub/stock") return stockPayload(context.env, url);
  if (pathname === "/api/market/status" || pathname === "/api/finnhub/status") return json({ configured: Boolean(alphaVantageKey(context.env)), provider: "Alpha Vantage" });
  if (pathname === "/api/market-data/status") return json({ configured: Boolean(context.env.MARKET_DATA_API_TOKEN), provider: "Market Data" });
  if (pathname === "/api/market/candles" || pathname === "/api/market/history" || pathname === "/api/finnhub/candles") {
    const symbol = validSymbol(url.searchParams.get("symbol"));
    if (!symbol) return json({ error: "Invalid ticker symbol" }, 400);
    const range = new Set(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y"]).has(url.searchParams.get("range")) ? url.searchParams.get("range") : "6M";
    try {
      return json((await marketChart(context.env, symbol, range)).candles);
    } catch (error) {
      return json({
        ...demoCandles(symbol, range),
        detail: `Live historical candle requests failed: ${error.message}`,
        dataDiagnostics: [
          ...(error.diagnostics || []),
          { provider: "Demo fallback", ok: true, authApplied: false, message: "Offline fallback returned because live providers were unreachable from this environment" }
        ]
      });
    }
  }
  if (pathname === "/api/market/stream" || pathname === "/api/finnhub/stream") {
    const symbol = validSymbol(url.searchParams.get("symbol"));
    let quote = null;
    try { if (symbol) quote = (await marketChart(context.env, symbol, "1D")).quote; } catch {}
    return new Response(`event: quote\ndata: ${JSON.stringify({ symbol, ...quote })}\n\n`, {
      headers: { ...corsHeaders, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" }
    });
  }
  if (pathname === "/api/macro/indicators") {
    try {
      return json(await macroIndicators());
    } catch (error) {
      return json({ ...demoMacro(), detail: `FRED macro data unavailable: ${error.message}` });
    }
  }
  if (pathname === "/api/macro/sector-etfs") return json(demoSectors());
  if (pathname === "/api/cnn/fear-greed" || pathname === "/api/market/sentiment") return json(demoFearGreed());
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
