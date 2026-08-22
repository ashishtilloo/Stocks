import { apiEventSource, apiFetch, apiJson } from "./services/api.js";

const initialTheme = localStorage.getItem("marketlens-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
const initialUiStyle = ["classic", "terminal", "compact"].includes(localStorage.getItem("marketlens-ui-style")) ? localStorage.getItem("marketlens-ui-style") : "classic";
let notificationsEnabled = localStorage.getItem("marketlens-notifications") === "true";
document.documentElement.dataset.theme = initialTheme;
document.documentElement.dataset.uiStyle = initialUiStyle;

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("marketlens-theme", nextTheme);
  const toggle = document.querySelector("#theme-toggle");
  const label = document.querySelector("#theme-label");
  if (toggle) {
    toggle.checked = nextTheme === "light";
    toggle.setAttribute("aria-label", nextTheme === "light" ? "Use dark mode" : "Use light mode");
  }
  if (label) label.textContent = nextTheme === "light" ? "Light" : "Dark";
  syncSettingsControls();
  scheduleUserDataSave();
}

function setUiStyle(style) {
  const nextStyle = ["classic", "terminal", "compact"].includes(style) ? style : "classic";
  document.documentElement.dataset.uiStyle = nextStyle;
  localStorage.setItem("marketlens-ui-style", nextStyle);
  syncSettingsControls();
  scheduleUserDataSave();
}

function syncSettingsControls() {
  const theme = document.documentElement.dataset.theme || "dark";
  const style = document.documentElement.dataset.uiStyle || "classic";
  document.querySelectorAll("[data-settings-theme]").forEach(button => {
    const selected = button.dataset.settingsTheme === theme;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-ui-style-option]").forEach(button => {
    const selected = button.dataset.uiStyleOption === style;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const notificationToggle = document.querySelector("#settings-notifications");
  if (notificationToggle) notificationToggle.checked = notificationsEnabled;
}

async function setNotificationPreference(enabled) {
  const status = document.querySelector("#settings-notification-status");
  if (!enabled) {
    notificationsEnabled = false;
    localStorage.setItem("marketlens-notifications", "false");
    if (status) status.textContent = "Notifications are off.";
    syncSettingsControls();
    scheduleUserDataSave();
    return;
  }
  if (!("Notification" in window)) {
    notificationsEnabled = false;
    if (status) status.textContent = "Desktop notifications are not supported in this browser.";
    syncSettingsControls();
    return;
  }
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  notificationsEnabled = permission === "granted";
  localStorage.setItem("marketlens-notifications", String(notificationsEnabled));
  if (status) status.textContent = notificationsEnabled ? "Notifications are on." : "Notification permission was not granted.";
  syncSettingsControls();
  scheduleUserDataSave();
}

function openSettings() {
  let layer = document.querySelector("#settings-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "settings-layer";
    layer.className = "settings-layer hidden";
    layer.innerHTML = `<div class="settings-backdrop" data-close-settings></div><section class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><span class="metric">MarketLens preferences</span><h2 id="settings-title">Settings</h2></div><button type="button" class="settings-close" data-close-settings aria-label="Close settings">&times;</button></header><div class="settings-content"><section class="settings-group"><div><h3>Color mode</h3><p class="muted">Choose the contrast that feels best.</p></div><div class="settings-segmented"><button type="button" data-settings-theme="dark">Dark</button><button type="button" data-settings-theme="light">Light</button></div></section><section class="settings-group settings-style-group"><div><h3>Interface style</h3><p class="muted">Changes density, typography, borders, and spacing across the app.</p></div><div class="settings-style-options"><button type="button" class="settings-style-option" data-ui-style-option="classic"><span class="style-preview classic"><i></i><i></i><i></i></span><strong>Classic</strong><small>Balanced and polished</small></button><button type="button" class="settings-style-option" data-ui-style-option="terminal"><span class="style-preview terminal"><i></i><i></i><i></i></span><strong>Terminal</strong><small>Sharp and analytical</small></button><button type="button" class="settings-style-option" data-ui-style-option="compact"><span class="style-preview compact"><i></i><i></i><i></i></span><strong>Compact</strong><small>Dense and efficient</small></button></div></section><section class="settings-group"><div><h3>Notifications</h3><p class="muted">Receive World Chat updates while MarketLens is in the background.</p><small id="settings-notification-status" class="settings-status">${notificationsEnabled ? "Notifications are on." : "Notifications are off."}</small></div><label class="settings-switch"><input id="settings-notifications" type="checkbox" aria-label="Enable notifications"><span><i></i></span></label></section></div></section>`;
    document.body.appendChild(layer);
    layer.querySelectorAll("[data-settings-theme]").forEach(button => button.onclick = () => setTheme(button.dataset.settingsTheme));
    layer.querySelectorAll("[data-ui-style-option]").forEach(button => button.onclick = () => setUiStyle(button.dataset.uiStyleOption));
    layer.querySelector("#settings-notifications").onchange = event => setNotificationPreference(event.target.checked);
  }
  syncSettingsControls();
  layer.classList.remove("hidden");
}

function closeSettings() {
  document.querySelector("#settings-layer")?.classList.add("hidden");
}

const stocks = {};
const companyMetrics = {};

const app = document.querySelector("#app");
let ticker = "AAPL";
let horizon = "1M";
let chartRange = "6M";
let priceChartMode = "area";
const chartIndicators = { ma10: true, ma20: true, ma50: true, ma150: true, volume: true };
const customTargetPrices = { price: null, options: null };
let optionSide = "Buy Call";
let optionPremium = null;
let earningsShowEstimates = true;
let earningsView = "eps";
const gammaExposure = { symbol: "AAPL", dte: 30, loading: false, data: null, error: "", requestId: 0 };
const macroRanges = { unemployment: "2Y", inflation: "2Y", fed: "2Y", treasury: "2Y" };
let spRange = "2Y";
let sectorRange = "oneMonth";
let watchlist = (() => { try { const value = JSON.parse(localStorage.getItem("marketlens-watchlist")); return Array.isArray(value) ? value : ["AAPL", "MSFT", "NVDA", "TSLA"]; } catch { return ["AAPL", "MSFT", "NVDA", "TSLA"]; } })();
const savedPaper = (() => { try { return JSON.parse(localStorage.getItem("marketlens-paper")) || {}; } catch { return {}; } })();
let cash = Number.isFinite(Number(savedPaper.cash)) ? Number(savedPaper.cash) : 100000;
let positions = savedPaper.positions && typeof savedPaper.positions === "object" ? { ...savedPaper.positions } : {};
let lastAssistantTopic = "";
let chatHistory = [];
let savedChats = (() => { try { const value = JSON.parse(localStorage.getItem("marketlens-saved-chats")); return Array.isArray(value) ? value : []; } catch { return []; } })();
let activeChatId = null;
let userDataSaveTimer = null;
let authMode = "login";
const authState = { ready: false, configured: false, mode: "local", user: null, error: "" };
const worldChatState = {
  channel: "global",
  messages: [],
  online: 1,
  byChannel: {},
  sessionId: localStorage.getItem("marketlens-chat-session") || `ml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  user: localStorage.getItem("marketlens-chat-name") || `Trader${Math.floor(1000 + Math.random() * 9000)}`
};
worldChatState.seenMessageIds = new Set();
localStorage.setItem("marketlens-chat-session", worldChatState.sessionId);
let worldChatTimer = null;
const marketData = { configured: null, loading: false, error: "", candles: {}, probabilityCandles: {}, diagnostics: {}, news: {}, sentiment: {}, recommendations: {}, earnings: {}, earningsProviders: {}, liveSymbols: new Set(), spCandles: null, spLoading: false, spError: "", macro: { loading: false, error: "", data: null, sectors: null, sectorError: "" }, cnn: { loading: false, error: "", data: null } };
let marketEventSource = null;
let priceChartResizeObserver = null;
let watchlistRefreshPromise = null;
const stockRefreshTimes = {};
const STOCK_REFRESH_INTERVAL_MS = 90_000;

function userProfileSnapshot() {
  return {
    watchlist: [...watchlist],
    cash,
    positions: { ...positions },
    theme: document.documentElement.dataset.theme || "dark",
    uiStyle: document.documentElement.dataset.uiStyle || "classic",
    notificationsEnabled,
    worldChatName: worldChatState.user,
    worldChatChannel: worldChatState.channel
  };
}

function scheduleUserDataSave() {
  clearTimeout(userDataSaveTimer);
  userDataSaveTimer = setTimeout(async () => {
    localStorage.setItem("marketlens-watchlist", JSON.stringify(watchlist));
    localStorage.setItem("marketlens-paper", JSON.stringify({ cash, positions }));
    localStorage.setItem("marketlens-saved-chats", JSON.stringify(savedChats));
    if (authState.user && window.marketLensFirebase) {
      try { await window.marketLensFirebase.saveProfile(userProfileSnapshot()); }
      catch (error) { console.warn("Profile sync failed", error.message); }
    }
  }, 180);
}

function applyUserProfile(profile) {
  if (!profile) return;
  if (Array.isArray(profile.watchlist)) watchlist = profile.watchlist.map(ensureStock).slice(0, 50);
  if (Number.isFinite(Number(profile.cash))) cash = Number(profile.cash);
  if (profile.positions && typeof profile.positions === "object") positions = { ...profile.positions };
  if (["light", "dark"].includes(profile.theme)) setTheme(profile.theme);
  if (["classic", "terminal", "compact"].includes(profile.uiStyle)) setUiStyle(profile.uiStyle);
  if (typeof profile.notificationsEnabled === "boolean") notificationsEnabled = profile.notificationsEnabled;
  if (profile.worldChatName) worldChatState.user = String(profile.worldChatName).slice(0, 24);
  if (["global", "stocks", "macro", "off-topic"].includes(profile.worldChatChannel)) worldChatState.channel = profile.worldChatChannel;
}

function updateAccountLink() {
  const link = document.querySelector("#account-link");
  if (!link) return;
  link.textContent = authState.user?.displayName || authState.user?.email?.split("@")[0] || "Log in";
  link.classList.toggle("signed-in", Boolean(authState.user));
  document.querySelectorAll("[data-protected-nav]").forEach(element => { element.hidden = !authState.user; });
}

function authLoadingPage() {
  app.className = "auth-loading-page";
  app.innerHTML = `<section class="auth-loading"><span class="assistant-mark">AI</span><h1>Opening your workspace</h1><p>Checking your MarketLens account...</p></section>`;
  setActiveNav();
}

async function handleAuthChange(detail) {
  Object.assign(authState, detail || {});
  updateAccountLink();
  if (authState.user && window.marketLensFirebase) {
    try {
      const [profile, conversations] = await Promise.all([
        window.marketLensFirebase.loadProfile(),
        window.marketLensFirebase.listConversations()
      ]);
      applyUserProfile(profile);
      if (Array.isArray(conversations)) savedChats = conversations.map(conversation => ({
        ...conversation,
        messages: Array.isArray(conversation.messages) ? conversation.messages : [],
        updatedAt: conversation.updatedAt?.toMillis?.() || conversation.updatedAt || Date.now()
      }));
      scheduleUserDataSave();
    } catch (error) {
      authState.error = error.message;
    }
  }
  render();
  renderAssistantHistory();
}

window.addEventListener("marketlens-auth-change", event => handleAuthChange(event.detail));
setTimeout(() => {
  const state = window.marketLensFirebase?.state;
  if (state?.ready) handleAuthChange({ ready: state.ready, configured: state.configured, mode: state.mode || "local", user: state.user ? { uid: state.user.uid, email: state.user.email || "", displayName: state.user.displayName || "" } : null, error: state.error });
}, 0);

const isFiniteValue = value => value !== null && value !== "" && Number.isFinite(Number(value));
const fmt = (n) => !isFiniteValue(n) ? "N/A" : Number(n) >= 10000 ? "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => !isFiniteValue(n) ? "N/A" : (Number(n) >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
const compactNumber = (n) => !Number.isFinite(n) ? "N/A" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
const earningsPeriodLabel = row => {
  const raw = row?.fiscalDateEnding || row?.period;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw || "")) ? new Date(`${raw}T00:00:00Z`) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) : String(raw || `${row?.year || ""} Q${row?.quarter || ""}`);
};
const marketCapLabel = n => !Number.isFinite(n) ? "N/A" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}T` : `$${(n / 1e3).toFixed(2)}B`;
const active = (value, current) => value === current ? "active" : "";
const escapeHtml = (value) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
function marketFreshnessLabel(symbol) {
  const stock = stocks[symbol] || {};
  const candles = marketData.candles[symbol];
  const quoteTime = Number(stock.quoteTime);
  const candleTime = Array.isArray(candles?.t) ? Number(candles.t.at(-1)) : NaN;
  const timestamp = Number.isFinite(quoteTime) && quoteTime > 0 ? quoteTime : candleTime;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Latest market date unavailable";
  const date = new Date(timestamp * 1000);
  const label = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const marketClosed = [0, 6].includes(today.getDay());
  if (marketClosed && !sameDay) return `Latest trading day: ${label}`;
  return `${sameDay ? "Latest market data" : "Latest trading day"}: ${label}`;
}
const defaultWatchlistQuotes = {
  AAPL: { name: "Apple Inc.", price: 212.41, change: 1.18, pct: 0.56, venue: "NASDAQ", sector: "Technology" },
  MSFT: { name: "Microsoft Corp.", price: 501.48, change: 2.06, pct: 0.41, venue: "NASDAQ", sector: "Technology" },
  NVDA: { name: "NVIDIA Corp.", price: 164.92, change: 3.74, pct: 2.32, venue: "NASDAQ", sector: "Semiconductors" },
  TSLA: { name: "Tesla Inc.", price: 315.35, change: -1.72, pct: -0.54, venue: "NASDAQ", sector: "Automobiles" }
};
const hasBlockedChatLanguage = value => {
  const normalized = String(value || "").toLowerCase()
    .replace(/[@4]/g, "a").replace(/[3]/g, "e").replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o").replace(/[5$]/g, "s").replace(/[7+]/g, "t");
  return [
    /\bf+[^a-z0-9]*u+[^a-z0-9]*c+[^a-z0-9]*k+\b/,
    /\bs+[^a-z0-9]*h+[^a-z0-9]*i+[^a-z0-9]*t+\b/,
    /\bb+[^a-z0-9]*i+[^a-z0-9]*t+[^a-z0-9]*c+[^a-z0-9]*h+\b/,
    /\ba+[^a-z0-9]*s+[^a-z0-9]*s+[^a-z0-9]*h+[^a-z0-9]*o+[^a-z0-9]*l+[^a-z0-9]*e+\b/
  ].some(pattern => pattern.test(normalized));
};

function ensureStock(value) {
  const cleaned = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, "").slice(0, 12);
  const symbol = /[A-Z0-9]/.test(cleaned) ? cleaned : "AAPL";
  if (stocks[symbol]) return symbol;
  const starter = defaultWatchlistQuotes[symbol] || {};
  stocks[symbol] = {
    name: starter.name || symbol, venue: starter.venue || "", type: "EQUITY",
    price: Number.isFinite(starter.price) ? starter.price : null,
    change: Number.isFinite(starter.change) ? starter.change : null,
    pct: Number.isFinite(starter.pct) ? starter.pct : null,
    open: null, high: null, low: null, prev: null, sector: starter.sector || "", industry: starter.sector || "",
    eps: null, growth: null, revenueGrowth: null, graham: null
  };
  companyMetrics[symbol] = { revenue: "N/A", pe: "N/A", provider: "Unavailable" };
  return symbol;
}

ensureStock(ticker);

function usablePayload(value) {
  return value && !value.unavailable;
}

function isDemoProvider(value) {
  return /demo fallback|offline/i.test(String(value || ""));
}

function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function calculateRsiSeries(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) return closes.map(() => null);
  const values = Array(closes.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  values[period] = averageLoss === 0 ? averageGain === 0 ? 50 : 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    values[i] = averageLoss === 0 ? averageGain === 0 ? 50 : 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return values;
}

function emaSeries(values, period) {
  const result = Array(values.length).fill(null);
  const valid = values.map(value => Number.isFinite(value) ? value : null);
  let start = -1;
  for (let i = period - 1; i < valid.length; i++) {
    const window = valid.slice(i - period + 1, i + 1);
    if (window.every(Number.isFinite)) {
      start = i;
      result[i] = window.reduce((sum, value) => sum + value, 0) / period;
      break;
    }
  }
  if (start === -1) return result;
  const multiplier = 2 / (period + 1);
  for (let i = start + 1; i < valid.length; i++) {
    result[i] = Number.isFinite(valid[i]) ? valid[i] * multiplier + result[i - 1] * (1 - multiplier) : result[i - 1];
  }
  return result;
}

function calculateTsi(closes, longPeriod = 25, shortPeriod = 13) {
  if (!Array.isArray(closes) || closes.length <= longPeriod + shortPeriod) return null;
  const momentum = closes.map((close, index) => index ? close - closes[index - 1] : null);
  const absMomentum = momentum.map(value => Number.isFinite(value) ? Math.abs(value) : null);
  const doubleMomentum = emaSeries(emaSeries(momentum, longPeriod), shortPeriod);
  const doubleAbsMomentum = emaSeries(emaSeries(absMomentum, longPeriod), shortPeriod);
  const numerator = doubleMomentum.at(-1);
  const denominator = doubleAbsMomentum.at(-1);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator * 100 : null;
}

function calculateStochasticSeries(highs, lows, closes, period = 14, smooth = 3) {
  const k = closes.map((close, index) => {
    if (index < period - 1 || !Number.isFinite(close)) return null;
    const highWindow = highs.slice(index - period + 1, index + 1).filter(Number.isFinite);
    const lowWindow = lows.slice(index - period + 1, index + 1).filter(Number.isFinite);
    if (highWindow.length !== period || lowWindow.length !== period) return null;
    const highest = Math.max(...highWindow), lowest = Math.min(...lowWindow);
    return highest === lowest ? 50 : (close - lowest) / (highest - lowest) * 100;
  });
  const d = k.map((_, index) => {
    if (index < smooth - 1) return null;
    const window = k.slice(index - smooth + 1, index + 1);
    return window.every(Number.isFinite) ? window.reduce((sum, value) => sum + value, 0) / smooth : null;
  });
  return { k, d };
}

function priceIndicators(symbol) {
  const payload = marketData.candles[symbol];
  const closes = Array.isArray(payload?.c) ? payload.c.map(Number).filter(Number.isFinite) : [];
  const highs = Array.isArray(payload?.h) ? payload.h.map(Number) : [];
  const lows = Array.isArray(payload?.l) ? payload.l.map(Number) : [];
  const sma = size => closes.length >= size ? closes.slice(-size).reduce((sum, value) => sum + value, 0) / size : null;
  const rsi = calculateRsi(closes, 14);
  const tsi = calculateTsi(closes, 25, 13);
  const momentum20 = closes.length > 20 ? (closes.at(-1) / closes.at(-21) - 1) * 100 : null;
  const returns = closes.slice(1).map((value, index) => Math.log(value / closes[index])).filter(Number.isFinite);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : null;
  const periodsPerYear = ({ "5": 252 * 78, "15": 252 * 26, "60": 252 * 6.5, D: 252, W: 52 })[String(payload?.resolution || "D")] || 252;
  const trueRanges = closes.map((close, index) => {
    const high = highs[index], low = lows[index], previousClose = closes[index - 1];
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    return index === 0 || !Number.isFinite(previousClose)
      ? high - low
      : Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  }).filter(Number.isFinite);
  const atr14 = trueRanges.length >= 14 ? trueRanges.slice(-14).reduce((sum, value) => sum + value, 0) / 14 : null;
  const sma50 = sma(50);
  const lastClose = closes.at(-1);
  const atrFromSma50 = Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(sma50) && Number.isFinite(lastClose)
    ? Math.abs(lastClose - sma50) / atr14
    : null;
  return {
    sma10: sma(10), sma20: sma(20), sma50, sma150: sma(150), sma200: sma(200), rsi, tsi, momentum20, atr14, atrFromSma50,
    volatility: variance === null ? null : Math.sqrt(variance * periodsPerYear) * 100,
    drift: returns.length ? Math.max(-.5, Math.min(.5, mean * periodsPerYear)) : null
  };
}

function directionalModel(stock, technical) {
  const available = Number.isFinite(technical.volatility) && [
    technical.momentum20,
    technical.sma50,
    technical.sma200,
    technical.rsi
  ].some(Number.isFinite);
  if (!available) {
    const empty = Object.fromEntries(["1D", "1W", "1M", "1Y"].map(key => [key, null]));
    return { available: false, probabilities: empty, swings: { ...empty }, rawScores: { ...empty } };
  }
  const trend50 = Number.isFinite(technical.sma50) ? (stock.price / technical.sma50 - 1) * 100 : 0;
  const trend200 = Number.isFinite(technical.sma200) ? (stock.price / technical.sma200 - 1) * 100 : trend50;
  const momentum = Number.isFinite(technical.momentum20) ? technical.momentum20 : 0;
  const rsiBias = Number.isFinite(technical.rsi) ? (technical.rsi - 50) / 2 : 0;
  const growth = Number.isFinite(stock.growth) ? Math.max(-20, Math.min(40, stock.growth)) : 0;
  const rawScores = {
    "1D": momentum * .18 + rsiBias * .12,
    "1W": momentum * .34 + trend50 * .16 + rsiBias * .12,
    "1M": trend50 * .38 + momentum * .24 + rsiBias * .14,
    "1Y": trend200 * .34 + trend50 * .24 + growth * .08
  };
  const probabilities = Object.fromEntries(Object.entries(rawScores).map(([key, score]) => [key, Math.round(Math.max(10, Math.min(90, 50 + 38 * Math.tanh(score / 10))))]));
  const annualVolatility = technical.volatility;
  const horizonDays = { "1D": 1, "1W": 5, "1M": 21, "1Y": 252 };
  const swings = Object.fromEntries(Object.entries(horizonDays).map(([key, days]) => [key, Math.max(.1, annualVolatility * Math.sqrt(days / 252)).toFixed(1)]));
  return { available: true, probabilities, swings, rawScores };
}

function trendAnalysis(stock, technical) {
  const inputs = [
    Number.isFinite(technical.sma50) ? stock.price >= technical.sma50 : null,
    Number.isFinite(technical.sma200) ? stock.price >= technical.sma200 : null,
    Number.isFinite(technical.sma20) && Number.isFinite(technical.sma50) ? technical.sma20 >= technical.sma50 : null,
    Number.isFinite(technical.momentum20) ? technical.momentum20 >= 0 : null,
    Number.isFinite(technical.rsi) ? technical.rsi >= 50 : null,
    Number.isFinite(technical.atrFromSma50) ? technical.atrFromSma50 < 4 : null
  ].filter(value => value !== null);
  if (!inputs.length) return { label: "TREND LOADING", score: null, className: "" };
  const score = Math.round(inputs.filter(Boolean).length / inputs.length * 100);
  const label = score >= 67 ? "UPTREND" : score <= 33 ? "DOWNTREND" : "NEUTRAL";
  const className = label === "UPTREND" ? "green" : label === "DOWNTREND" ? "red" : "amber";
  return { label, score, className };
}

async function refreshTickerData(symbol, rerender = true) {
  const requested = ensureStock(symbol);
  marketData.loading = true;
  marketData.error = "";
  if (rerender && route() === "/") dashboard();
  try {
    const response = await apiFetch(`/api/market/stock?symbol=${encodeURIComponent(requested)}&range=${chartRange}`);
    const payload = await apiJson(response, "Market data");
    if (!response.ok) throw new Error(payload.error || "Market data request failed");
    marketData.configured = true;
    const providerLabel = payload.quoteProvider || payload.quote?.provider || payload.provider || "";
    const hasLiveQuote = usablePayload(payload.quote)
      && Number(payload.quote.c) > 0
      && !isDemoProvider(providerLabel)
      && !isDemoProvider(payload.quote?.provider);
    const quote = hasLiveQuote ? payload.quote : {};
    const profile = usablePayload(payload.profile) ? payload.profile : {};
    const metrics = usablePayload(payload.metrics) ? (payload.metrics.metric || {}) : {};
    const metricNumber = value => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
    const current = stocks[requested];
    const price = Number(quote.c) || current.price;
    const previous = Number(quote.pc) || current.prev || price;
    Object.assign(current, {
      name: profile.name || current.name,
      venue: profile.exchange || current.venue,
      price,
      change: Number.isFinite(Number(quote.d)) ? Number(quote.d) : price - previous,
      pct: Number.isFinite(Number(quote.dp)) ? Number(quote.dp) : (price / previous - 1) * 100,
      open: Number(quote.o) || current.open,
      high: Number(quote.h) || current.high,
      low: Number(quote.l) || current.low,
      prev: previous,
      sector: profile.sector || "N/A",
      industry: profile.industry || profile.finnhubIndustry || "N/A",
      eps: metricNumber(metrics.epsTTM),
      growth: metricNumber(metrics.epsGrowthYoY),
      revenueGrowth: metricNumber(metrics.revenueGrowthYoY),
      weekHigh: Number(metrics["52WeekHigh"]) || null,
      weekLow: Number(metrics["52WeekLow"]) || null,
      marketCap: Number(profile.marketCapitalization) || Number(metrics.marketCapitalization) || null,
      volume: usablePayload(payload.candles) && Array.isArray(payload.candles.v) ? payload.candles.v.at(-1) : null,
      updatedAt: payload.fetchedAt || new Date().toISOString(),
      quoteTime: Number(quote.t) || null,
      quoteProvider: providerLabel || "Alpha Vantage"
    });
    const pe = metricNumber(metrics.peTTM) ?? metricNumber(metrics.peNormalizedAnnual);
    const revenuePerShare = metricNumber(metrics.revenuePerShareTTM);
    const shares = metricNumber(profile.shareOutstanding);
    companyMetrics[requested] = {
      revenue: Number.isFinite(revenuePerShare) && Number.isFinite(shares) && shares > 0 ? `$${(revenuePerShare * shares / 1000).toFixed(1)}B` : "N/A",
      pe: Number.isFinite(pe) && pe > 0 ? `${pe.toFixed(1)}x` : "N/A",
      provider: payload.fundamentalsProvider || "Unavailable"
    };
    if (usablePayload(payload.candles) && payload.candles.s === "ok" && Array.isArray(payload.candles.c)) {
      marketData.candles[requested] = { ...payload.candles, range: chartRange, resolution: payload.resolution };
    }
    if (usablePayload(payload.probabilityCandles) && payload.probabilityCandles.s === "ok" && Array.isArray(payload.probabilityCandles.c)) {
      marketData.probabilityCandles[requested] = payload.probabilityCandles;
    }
    marketData.diagnostics[requested] = Array.isArray(payload.dataDiagnostics) ? payload.dataDiagnostics : [];
    if (Array.isArray(payload.news)) marketData.news[requested] = payload.news;
    if (usablePayload(payload.sentiment)) marketData.sentiment[requested] = payload.sentiment;
    if (Array.isArray(payload.recommendations)) marketData.recommendations[requested] = payload.recommendations;
    if (Array.isArray(payload.earnings)) marketData.earnings[requested] = payload.earnings.map(row => ({
      ...row,
      actual: isFiniteValue(row.actual) ? Number(row.actual) : NaN,
      estimate: isFiniteValue(row.estimate) ? Number(row.estimate) : NaN,
      surprise: isFiniteValue(row.surprise) ? Number(row.surprise) : NaN,
      revenue: isFiniteValue(row.revenue) ? Number(row.revenue) : NaN,
      revenueGrowthYoY: isFiniteValue(row.revenueGrowthYoY) ? Number(row.revenueGrowthYoY) : NaN
    }));
    marketData.earningsProviders[requested] = payload.earningsProvider || payload.earnings?.[0]?.provider || "Unavailable";
    if (hasLiveQuote) {
      stockRefreshTimes[requested] = Date.now();
      marketData.liveSymbols.add(requested);
      if (payload.quoteProvider === "Realtime stream") connectMarketStream(requested);
    }
    else {
      marketData.liveSymbols.delete(requested);
      marketData.error = payload.quote?.message || `${requested} did not return a verified live quote. Provider returned ${providerLabel || "no provider"}.`;
    }
  } catch (error) {
    marketData.configured = !String(error.message).includes("not configured");
    marketData.error = error.message;
  } finally {
    marketData.loading = false;
    if (!rerender) return;
    if (route() === "/") dashboard();
    else if (route() === "/sentiment") sentiment();
    else if (route() === "/news") news();
  }
}

function stockNeedsRefresh(symbol, force = false) {
  if (force) return true;
  const lastRefresh = stockRefreshTimes[symbol] || 0;
  return Date.now() - lastRefresh > STOCK_REFRESH_INTERVAL_MS;
}

async function refreshChartData(symbol = ticker, range = chartRange) {
  const requested = ensureStock(symbol);
  marketData.loading = true;
  marketData.error = "";
  if (route() === "/") dashboard();
  try {
    const response = await apiFetch(`/api/market/candles?symbol=${encodeURIComponent(requested)}&range=${encodeURIComponent(range)}`);
    const payload = await apiJson(response, "Historical candles");
    if (!response.ok) throw new Error(payload.detail || payload.error || "Historical candle request failed");
    marketData.candles[requested] = payload;
  } catch (error) {
    marketData.candles[requested] = { unavailable: true, provider: "Market data", range, message: error.message };
  } finally {
    marketData.loading = false;
    if (route() === "/") dashboard();
  }
}

async function refreshWatchlistData({ force = false } = {}) {
  if (watchlistRefreshPromise) return watchlistRefreshPromise;
  const symbols = [...new Set([ticker, ...watchlist].map(ensureStock))].filter(symbol => stockNeedsRefresh(symbol, force));
  if (!symbols.length) return null;
  watchlistRefreshPromise = Promise.allSettled(symbols.map(symbol => refreshTickerData(symbol, false))).finally(() => {
    watchlistRefreshPromise = null;
    if (route() === "/") dashboard();
  });
  return watchlistRefreshPromise;
}

function connectMarketStream(symbol) {
  if (marketEventSource?.datasetSymbol === symbol) return;
  marketEventSource?.close();
  marketEventSource = apiEventSource(`/api/market/stream?symbol=${encodeURIComponent(symbol)}`);
  marketEventSource.datasetSymbol = symbol;
  marketEventSource.addEventListener("quote", event => {
    try {
      const payload = JSON.parse(event.data), quote = payload.quote, stock = stocks[symbol];
      if (!stock || !Number.isFinite(Number(quote?.c)) || Number(quote.c) <= 0) return;
      Object.assign(stock, {
        price: Number(quote.c), change: Number(quote.d), pct: Number(quote.dp),
        open: Number(quote.o), high: Number(quote.h), low: Number(quote.l), prev: Number(quote.pc),
        updatedAt: payload.fetchedAt
      });
      if (symbol === ticker) updateLivePriceChart(quote);
      document.querySelector(".quote-price")?.replaceChildren(document.createTextNode(fmt(stock.price)));
    } catch {}
  });
}

function updateLivePriceChart(quote) {
  const candles = marketData.candles[ticker];
  const lastIndex = Array.isArray(candles?.t) ? candles.t.length - 1 : -1;
  if (lastIndex < 0) return;
  const current = Number(quote.c);
  if (!Number.isFinite(current)) return;
  candles.h[lastIndex] = Math.max(Number(candles.h[lastIndex]), current);
  candles.l[lastIndex] = Math.min(Number(candles.l[lastIndex]), current);
  candles.c[lastIndex] = current;
  drawPriceChart();
}

async function refreshGammaExposure(symbol = gammaExposure.symbol, dte = gammaExposure.dte) {
  const requested = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.]{1,10}$/.test(requested)) {
    gammaExposure.error = "Enter a valid U.S. stock or ETF ticker.";
    if (route() === "/") dashboard();
    return;
  }
  gammaExposure.symbol = requested;
  gammaExposure.dte = Number(dte) || 30;
  gammaExposure.loading = true;
  gammaExposure.error = "";
  gammaExposure.data = null;
  const requestId = ++gammaExposure.requestId;
  if (route() === "/") dashboard();
  try {
    const response = await apiFetch(`/api/options/gamma?symbol=${encodeURIComponent(requested)}&dte=${gammaExposure.dte}`);
    const payload = await apiJson(response, "Gamma exposure");
    if (!response.ok) throw new Error(payload.detail || payload.error || "Options chain request failed");
    if (requestId === gammaExposure.requestId && payload.symbol === requested) gammaExposure.data = payload;
  } catch (error) {
    if (requestId === gammaExposure.requestId) gammaExposure.error = error.message || "Gamma exposure is unavailable for this ticker.";
  } finally {
    if (requestId === gammaExposure.requestId) gammaExposure.loading = false;
    if (route() === "/") dashboard();
  }
}

function gammaMoney(value) {
  if (!Number.isFinite(Number(value))) return "N/A";
  const amount = Number(value), absolute = Math.abs(amount);
  const scaled = absolute >= 1e9 ? `${(absolute / 1e9).toFixed(2)}B` : absolute >= 1e6 ? `${(absolute / 1e6).toFixed(1)}M` : absolute >= 1e3 ? `${(absolute / 1e3).toFixed(1)}K` : absolute.toFixed(0);
  return `${amount < 0 ? "-" : ""}$${scaled}`;
}

async function refreshMacroData() {
  if (marketData.spLoading || marketData.macro.loading) return;
  marketData.spLoading = true;
  marketData.macro.loading = true;
  marketData.spError = "";
  marketData.macro.error = "";
  marketData.macro.sectorError = "";
  try {
    const lookbackRange = "10Y";
    const [response, macroResponse, sectorResponse] = await Promise.all([
      apiFetch(`/api/market/stock?symbol=${encodeURIComponent("^GSPC")}&range=${lookbackRange}&interval=Daily`),
      apiFetch("/api/macro/indicators"),
      apiFetch("/api/macro/sector-etfs")
    ]);
    const [payload, macroPayload, sectorPayload] = await Promise.all([
      apiJson(response, "S&P 500 market data"),
      apiJson(macroResponse, "Macro indicators"),
      apiJson(sectorResponse, "Sector ETF data")
    ]);
    const normalizedCandles = normalizeSp500Candles(payload.candles);
    if (response.ok && normalizedCandles && normalizedCandles.t.length >= 200) {
      marketData.spCandles = { ...normalizedCandles, displayRange: spRange };
    } else {
      marketData.spCandles = null;
      marketData.spError = payload.candles?.message || payload.error || "S&P 500 history did not contain enough valid daily closes.";
    }
    if (macroResponse.ok && macroPayload?.series) marketData.macro.data = macroPayload;
    else {
      marketData.macro.data = null;
      marketData.macro.error = macroPayload.detail || macroPayload.error || "FRED indicators are unavailable.";
    }
    if (sectorResponse.ok && Array.isArray(sectorPayload?.sectors)) marketData.macro.sectors = sectorPayload;
    else {
      marketData.macro.sectors = null;
      marketData.macro.sectorError = sectorPayload.detail || sectorPayload.error || "Sector ETF performance is unavailable.";
    }
  } catch (error) {
    marketData.spCandles = null;
    marketData.spError = error.message;
    marketData.macro.error = error.message;
    marketData.macro.sectorError = error.message;
  } finally {
    marketData.spLoading = false;
    marketData.macro.loading = false;
    if (route() === "/macro") macro();
  }
}

function normalizeSp500Candles(candles) {
  if (!usablePayload(candles) || candles.s !== "ok" || !Array.isArray(candles.t) || !Array.isArray(candles.c)) return null;
  const rows = candles.t.map((timestamp, index) => ({ timestamp: Number(timestamp), close: Number(candles.c[index]) }))
    .filter(row => Number.isFinite(row.timestamp) && row.timestamp > 0 && Number.isFinite(row.close) && row.close > 100)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!rows.length) return null;
  return { ...candles, t: rows.map(row => row.timestamp), c: rows.map(row => row.close) };
}

async function refreshCnnSentiment() {
  if (marketData.cnn.loading) return;
  marketData.cnn.loading = true;
  marketData.cnn.error = "";
  if (route() === "/sentiment") sentiment();
  try {
    const response = await apiFetch("/api/cnn/fear-greed");
    const payload = await apiJson(response, "CNN Fear & Greed");
    if (!response.ok) throw new Error(payload.detail || payload.error || "CNN Fear & Greed request failed");
    marketData.cnn.data = payload;
  } catch (error) {
    marketData.cnn.data = null;
    marketData.cnn.error = error.message;
  } finally {
    marketData.cnn.loading = false;
    if (route() === "/sentiment") sentiment();
  }
}

function route() {
  return (location.hash.replace("#", "") || "/").split("?")[0];
}

function setActiveNav() {
  document.querySelectorAll("nav a").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === "#" + route());
  });
}

function pageShell(title, subtitle, body) {
  app.className = route() === "/" ? "dashboard-page" : "";
  app.innerHTML = `<div class="page-title"><div><h1>${title}</h1><p class="subtle">${subtitle}</p></div></div>${body}`;
  setActiveNav();
  requestAnimationFrame(drawCharts);
}

function arrangeDashboardLayout() {
  const title = app.querySelector(":scope > .page-title");
  const watchlistNode = app.querySelector(":scope > .watchlist-card");
  if (!title || !watchlistNode) return;
  const contentNodes = [...app.children].filter(node => node !== title && node !== watchlistNode);
  const layout = document.createElement("div");
  const content = document.createElement("div");
  layout.className = "dashboard-layout";
  content.className = "dashboard-content";
  contentNodes.forEach(node => content.appendChild(node));
  layout.append(watchlistNode, content);
  app.appendChild(layout);
}

function home() {
  const signedIn = Boolean(authState.user);
  const name = authState.user?.displayName || authState.user?.email?.split("@")[0] || "Investor";
  app.className = "public-home";
  app.innerHTML = `<section class="public-home-hero"><div class="public-home-overlay"></div><div class="public-home-content"><span class="metric">MARKET INTELLIGENCE WORKSPACE</span><h1>MarketLens AI</h1><p>${signedIn ? `Welcome back, ${escapeHtml(name)}. Your research workspace is synced and ready.` : "Live market structure, probability, earnings, macro conditions, and sourced news in one focused research environment."}</p><div class="home-actions">${signedIn ? `<a class="button-link primary" href="#/">Open dashboard</a><a class="button-link" href="#/login">Account</a>` : `<a class="button-link primary" href="#/login" data-home-auth="signup">Create account</a><a class="button-link" href="#/login" data-home-auth="login">Log in</a>`}</div><div class="home-tape"><span>S&amp;P 500</span><b>Price action</b><span>Macro</span><b>Earnings</b><span>Sentiment</span><b>Probability</b></div></div></section>
    <section class="home-grid section">
      <a class="home-module" href="#/"><span>01</span><h3>Stock Research</h3><p>Quotes, price action, RSI, earnings, targets, and directional probabilities.</p></a>
      <a class="home-module" href="#/macro"><span>02</span><h3>Macro Monitor</h3><p>Rates, inflation, employment, S&amp;P trends, and valuation research.</p></a>
      <a class="home-module" href="#/news"><span>03</span><h3>AI News Summary</h3><p>Hourly company headlines with linked sources and market context.</p></a>
      <a class="home-module" href="#/world-chat"><span>04</span><h3>World Chat</h3><p>Join moderated market channels with your saved display identity.</p></a>
    </section>
    <section class="home-account-strip section"><div><span class="metric">PRIVATE WORKSPACE</span><strong>${signedIn ? "Cloud sync active" : "Sign in required"}</strong><p>${signedIn ? `${watchlist.length} watchlist symbols and ${savedChats.length} saved chats available.` : "Create an account or log in to access the dashboard and save your research."}</p></div><a href="${signedIn ? "#/login" : "#/login"}">${signedIn ? "Manage account" : "Access MarketLens"}</a></section>`;
  setActiveNav();
  document.querySelectorAll("[data-home-auth]").forEach(link => link.onclick = () => { authMode = link.dataset.homeAuth; });
}

function firebaseErrorMessage(error) {
  const code = String(error?.code || "");
  if (code.includes("invalid-credential")) return "The email or password is incorrect.";
  if (code.includes("email-already-in-use")) return "An account already uses this email.";
  if (code.includes("weak-password")) return "Use a stronger password with at least six characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("firebase-not-configured")) return "Google sign-in becomes available after Firebase is connected.";
  if (code.includes("operation-not-allowed")) return "Enable Google as a sign-in provider in the Firebase console.";
  if (code.includes("unauthorized-domain")) return "Add this website domain to Firebase Authentication's authorized domains.";
  if (code.includes("popup-closed-by-user")) return "Google sign-in was canceled.";
  if (code.includes("popup-blocked")) return "Allow popups for this site, then try Google sign-in again.";
  return error?.message || "Account request failed. Please try again.";
}

function loginPage() {
  if (authState.user) {
    const name = authState.user.displayName || authState.user.email?.split("@")[0] || "MarketLens user";
    pageShell("Your Account", authState.mode === "firebase" ? "Firebase authentication and private cloud sync" : "Secure local account on this device", `
      <section class="account-panel"><div class="account-avatar">${escapeHtml(name.slice(0,2).toUpperCase())}</div><div><span class="metric">SIGNED IN</span><h2>${escapeHtml(name)}</h2><p>${escapeHtml(authState.user.email || "")}</p></div><button id="auth-signout" type="button">Sign out</button></section>
      <section class="account-data-grid section"><div><span class="metric">Watchlist</span><strong>${watchlist.length}</strong><p>Saved symbols</p></div><div><span class="metric">Assistant</span><strong>${savedChats.length}</strong><p>Saved chats</p></div><div><span class="metric">Paper Trading</span><strong>${Object.keys(positions).length}</strong><p>Open positions</p></div><div><span class="metric">World Chat</span><strong>${escapeHtml(worldChatState.user)}</strong><p>Display identity</p></div></section>`);
    document.querySelector("#auth-signout").onclick = async () => { await window.marketLensFirebase?.signOut(); location.hash = "#/home"; };
    return;
  }
  pageShell("Account Access", authState.mode === "firebase" ? "Log in or create an account to sync your MarketLens data" : "Log in or create an account to save your MarketLens workspace on this device", `
    <section class="auth-shell">
      <div class="auth-copy"><span class="metric">PRIVATE WORKSPACE</span><h2>Your research stays organized.</h2><p>Save watchlists, assistant conversations, paper positions, preferences, and your World Chat identity to your own account.</p><div class="auth-feature-list">${authState.mode === "firebase" ? `<span>Firebase email authentication</span><span>Private Firestore user records</span><span>Cross-device cloud sync</span>` : `<span>Secure device-local account</span><span>PBKDF2 password hashing</span><span>Automatic Firebase upgrade path</span>`}</div></div>
      <form id="auth-form" class="auth-form">
        <div class="auth-tabs" role="tablist"><button type="button" class="${authMode === "login" ? "active" : ""}" data-auth-mode="login">Log in</button><button type="button" class="${authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Sign up</button></div>
        <div><span class="metric">${authMode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</span><h2>${authMode === "login" ? "Log in to MarketLens" : "Start your synced workspace"}</h2></div>
        ${authMode === "signup" ? `<label>Display name<input id="auth-name" autocomplete="name" maxlength="40" required></label>` : ""}
        <label>Email<input id="auth-email" type="email" autocomplete="email" required></label>
        <label>Password<input id="auth-password" type="password" autocomplete="${authMode === "login" ? "current-password" : "new-password"}" minlength="6" required></label>
        ${authMode === "signup" ? `<label>Confirm password<input id="auth-confirm" type="password" autocomplete="new-password" minlength="6" required></label>` : ""}
        <button class="primary auth-submit" type="submit">${authMode === "login" ? "Log in" : "Create account"}</button>
        <div class="auth-divider"><span>or</span></div>
        <button class="google-auth-button" id="google-auth" type="button" ${authState.mode === "firebase" ? "" : "disabled"}><span aria-hidden="true">G</span>Continue with Google</button>
        <p id="auth-status" class="auth-status ${authState.error ? "red" : ""}">${authState.mode === "firebase" ? "Your data will sync privately through Firebase." : "Local account mode is active. Your password is hashed and this account stays on this device until Firebase is connected."}</p>
      </form>
    </section>`);
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.onclick = () => { authMode = button.dataset.authMode; loginPage(); });
  document.querySelector("#google-auth").onclick = async () => {
    const status = document.querySelector("#auth-status"), button = document.querySelector("#google-auth");
    button.disabled = true; status.textContent = "Opening Google sign-in..."; status.classList.remove("red");
    try {
      await window.marketLensFirebase.signInWithGoogle();
      location.hash = "#/";
    } catch (error) {
      status.textContent = firebaseErrorMessage(error); status.classList.add("red");
      button.disabled = authState.mode !== "firebase";
    }
  };
  document.querySelector("#auth-form").onsubmit = async event => {
    event.preventDefault();
    const status = document.querySelector("#auth-status"), submit = document.querySelector(".auth-submit");
    const email = document.querySelector("#auth-email").value.trim(), password = document.querySelector("#auth-password").value;
    if (authMode === "signup" && password !== document.querySelector("#auth-confirm").value) { status.textContent = "Passwords do not match."; status.classList.add("red"); return; }
    submit.disabled = true; status.textContent = authMode === "login" ? "Logging in..." : "Creating account..."; status.classList.remove("red");
    try {
      if (authMode === "signup") await window.marketLensFirebase.signUp(document.querySelector("#auth-name").value, email, password);
      else await window.marketLensFirebase.signIn(email, password);
      location.hash = "#/";
    } catch (error) {
      status.textContent = firebaseErrorMessage(error); status.classList.add("red"); submit.disabled = false;
    }
  };
}

function dashboard() {
  ticker = ensureStock(ticker);
  const s = stocks[ticker];
  const company = companyMetrics[ticker] || companyMetrics.AAPL;
  const isLive = marketData.liveSymbols.has(ticker);
  if (!isLive) {
    pageShell("Dashboard", "Search verified market data by ticker", `
      <div class="toolbar"><input id="ticker-input" placeholder="Ticker (AAPL, MSFT...)" value="${escapeHtml(ticker)}"><button class="primary" id="analyze">Analyze</button><span class="data-source error">Market data unavailable</span></div>
      <section class="card data-empty section"><h2>${marketData.loading ? `Loading ${escapeHtml(ticker)}` : `${escapeHtml(ticker)} could not be verified`}</h2><p>${escapeHtml(marketData.loading ? "Requesting the quote and OHLC history from live providers..." : marketData.error || "No live provider has returned a verified quote.")}</p><p class="subtle section">No generated prices or fallback market data are displayed.</p></section>`);
    const retry = () => { ticker = ensureStock(document.querySelector("#ticker-input").value); refreshTickerData(ticker, true, { force: true }); };
    document.querySelector("#analyze").onclick = retry;
    document.querySelector("#ticker-input").onkeydown = event => { if (event.key === "Enter") retry(); };
    return;
  }
  const technical = priceIndicators(ticker);
  const metricPrice = value => Number.isFinite(value) ? fmt(value) : "N/A";
  const metricPercent = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
  const rsiState = !Number.isFinite(technical.rsi) ? "Unavailable" : technical.rsi >= 70 ? "Overbought" : technical.rsi <= 30 ? "Oversold" : "Neutral";
  const tsiState = !Number.isFinite(technical.tsi) ? "Unavailable" : technical.tsi >= 10 ? "Bullish" : technical.tsi <= -10 ? "Bearish" : "Neutral";
  const rsiSignalValue = Number.isFinite(technical.rsi) ? (technical.rsi - 50) / 50 : 0;
  const rsiSignal = `${rsiSignalValue >= 0 ? "+" : ""}${rsiSignalValue.toFixed(2)}`;
  const trendSignalValue = Number.isFinite(technical.sma200) ? (s.price / technical.sma200 - 1) : 0;
  const trendSignal = `${trendSignalValue >= 0 ? "+" : ""}${trendSignalValue.toFixed(2)}`;
  const crossSignalValue = Number.isFinite(technical.sma20) && Number.isFinite(technical.sma50) ? (technical.sma20 / technical.sma50 - 1) * 10 : 0;
  const crossSignal = `${crossSignalValue >= 0 ? "+" : ""}${crossSignalValue.toFixed(2)}`;
  const momentumSignalValue = Number.isFinite(technical.momentum20) ? technical.momentum20 / 10 : 0;
  const momentumSignal = `${momentumSignalValue >= 0 ? "+" : ""}${momentumSignalValue.toFixed(2)}`;
  const atrDistance = Number.isFinite(technical.atrFromSma50) ? technical.atrFromSma50 : null;
  const atrRulePasses = Number.isFinite(atrDistance) ? atrDistance < 4 : false;
  const atrSignal = Number.isFinite(atrDistance) ? (atrRulePasses ? "+1.00" : "-1.00") : "+0.00";
  const atrRuleText = Number.isFinite(atrDistance)
    ? `${atrDistance.toFixed(2)} ATR from 50 MA - ${atrRulePasses ? "passes" : "extended"}`
    : "Needs 50 sessions and ATR";
  const earningsRows = (marketData.earnings[ticker] || []).filter(row => isFiniteValue(row.actual) || isFiniteValue(row.estimate) || isFiniteValue(row.revenue)).slice(0, 8);
  const earningsProvider = marketData.earningsProviders[ticker] || earningsRows[0]?.provider || "Unavailable";
  const hasRevenueGrowth = earningsRows.some(row => isFiniteValue(row.revenueGrowthYoY));
  const directional = directionalModel(s, technical);
  const probs = directional.probabilities;
  const swings = directional.swings;
  const directionalValue = key => directional.available ? `${probs[key]}%` : "N/A";
  const swingValue = key => directional.available ? `+/-${swings[key]}%` : "N/A";
  const trend = trendAnalysis(s, technical);
  const priceTarget = customTargetPrices.price ?? s.price * 1.05;
  const optionsTarget = customTargetPrices.options ?? s.price * 1.05;
  const gamma = gammaExposure.data?.symbol === gammaExposure.symbol ? gammaExposure.data : null;
  const candleProvider = marketData.candles[ticker]?.s === "ok" ? marketData.candles[ticker].provider || "Alpha Vantage" : "History unavailable";
  const quoteProvider = s.quoteProvider || "Alpha Vantage";
  const freshnessLabel = marketFreshnessLabel(ticker);
  pageShell("Dashboard", "Multi-horizon probability + options + targets", `
    <div class="toolbar">
      <input id="ticker-input" placeholder="Ticker (AAPL, BTC-USD...)" value="${ticker}">
      <button class="primary" id="analyze">Analyze</button>
      <button id="refresh-all" type="button">Refresh data</button>
      <span class="subtle">Search any ticker here. Save tickers below in the Watchlist.</span>
      <span class="data-source live">${escapeHtml(quoteProvider)} quote - ${escapeHtml(candleProvider)} OHLC - ${escapeHtml(freshnessLabel)} - refreshed ${s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "now"}</span>
    </div>

    <section class="card watchlist-card">
      <div class="watchlist-head"><div><h3>Watchlist</h3><p class="subtle">Track symbols and open them in the dashboard</p></div><div class="watchlist-add"><input id="watchlist-input" placeholder="Add ticker"><button class="primary" id="watchlist-add">Add</button><button id="watchlist-refresh" type="button">Refresh</button></div></div>
      <div class="watchlist-grid section">${watchlist.map(symbol => { const key = ensureStock(symbol), item = stocks[key], verified = marketData.liveSymbols.has(key); return `<div class="watchlist-item"><button class="watchlist-open" data-watch-symbol="${key}"><span><b>${key}</b><small>${item.name}</small></span><span><strong>${verified ? fmt(item.price) : marketData.loading ? "Loading" : "N/A"}</strong><small class="${verified ? item.change >= 0 ? "green" : "red" : "muted"}">${verified ? pct(item.pct) : "Refresh"}</small></span></button><button class="watchlist-remove" data-remove-symbol="${key}" title="Remove ${key}" aria-label="Remove ${key}">&times;</button></div>`; }).join("")}</div>
    </section>

    <section class="quote">
      <div class="card clickable" data-detail="quote">
        <p class="muted">${s.venue} · ${s.type}</p>
        <h2>${s.name}<span class="muted"> ${ticker}</span></h2>
        <div class="quote-price">${fmt(s.price)}</div>
        <p class="${s.change >= 0 ? "green" : "red"}">${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)} (${pct(s.pct)})</p>
        <p class="subtle section">${escapeHtml(quoteProvider)} market snapshot for ${ticker}. ${escapeHtml(freshnessLabel)}.</p>
        <div class="stat-grid">
          ${[["Open", fmt(s.open)], ["High", fmt(s.high)], ["Low", fmt(s.low)], ["Prev Close", fmt(s.prev)], ["Day Range", `${fmt(s.low)} - ${fmt(s.high)}`], ["52W Range", s.weekLow && s.weekHigh ? `${fmt(s.weekLow)} - ${fmt(s.weekHigh)}` : "N/A"], ["Volume", compactNumber(s.volume)], ["Market Cap", s.type === "CRYPTO" ? "N/A" : marketCapLabel(s.marketCap)]].map(([k,v]) => `<div class="stat"><div class="metric">${k}</div><strong>${v}</strong></div>`).join("")}
        </div>
      </div>
      <div class="card probability clickable" data-detail="directional-probability">
        <div>
          <div class="metric">Directional Probability</div>
          <div class="toolbar" style="justify-content:center">${Object.keys(probs).map(h => `<button class="${active(h, horizon)}" data-horizon="${h}">${h}</button>`).join("")}</div>
          <strong>${directionalValue(horizon)}</strong>
          <p class="subtle">${directional.available ? `chance higher in ${horizon === "1M" ? "1 month" : horizon.toLowerCase()} · ${swingValue(horizon)} expected swing` : "Requires verified Alpha Vantage candle history"}</p>
          <div class="bar section"><span style="width:${directional.available ? probs[horizon] : 0}%"></span></div>
          <div class="row muted"><span>Bearish</span><span>50/50</span><span>Bullish</span></div>
        </div>
      </div>
    </section>

    <section class="grid cols-4 section">
      ${[["1 day","1D"],["1 week","1W"],["1 month","1M"],["1 year","1Y"]].map(([label,key]) => `<button class="card row" data-probability-horizon="${key}"><span>${label}</span><strong>${directionalValue(key)}</strong><span class="${directional.available ? "green" : "muted"}">${swingValue(key)}</span></button>`).join("")}
    </section>

    <section class="section">
      <div class="card price-action-card clickable" data-detail="price-action">
        <div class="price-chart-head">
          <div><h3>Price action</h3><p class="subtle">${escapeHtml(candleProvider)} candles and volume · ${escapeHtml(quoteProvider)} quote</p></div>
          <div class="chart-options">
            <div class="segmented">${["1D","5D","1M","6M","YTD","1Y","5Y","10Y"].map(r => `<button class="${active(r, chartRange)}" data-range="${r}">${r}</button>`).join("")}</div>
            <div class="segmented">${[["area","Area"],["line","Line"],["candles","Candles"]].map(([mode,label]) => `<button class="${active(mode, priceChartMode)}" data-chart-mode="${mode}">${label}</button>`).join("")}</div>
          </div>
        </div>
        <div class="indicator-controls">
          ${[["ma10","MA 10","#d8a93f"],["ma20","MA 20","#e0bc69"],["ma50","MA 50","#3aa0d8"],["ma150","MA 150","#6ee7b7"],["volume","Volume","#7d8493"]].map(([key,label,color]) => `<label class="indicator-toggle"><input type="checkbox" data-indicator="${key}" ${chartIndicators[key] ? "checked" : ""}><span class="switch"></span><i style="--indicator:${color}"></i><b>${label}</b></label>`).join("")}
        </div>
        <div class="price-canvas-wrap"><canvas id="price-chart" aria-label="${ticker} price and volume chart from ${escapeHtml(candleProvider)}" ${marketData.candles[ticker]?.s === "ok" ? "" : "hidden"}></canvas><div id="price-chart-state" class="chart-state" ${marketData.candles[ticker]?.s === "ok" ? "hidden" : ""}>${marketData.loading ? "Loading market history..." : escapeHtml(marketData.candles[ticker]?.message || "Historical candles are unavailable for this timeframe.")}</div></div>
        <div class="oscillator-chart-wrap"><div class="oscillator-chart-head"><span>Stochastic 14,3</span><b id="stochastic-value">N/A</b></div><canvas id="stochastic-chart" aria-label="${ticker} stochastic oscillator line chart"></canvas></div>
        <div class="rsi-chart-wrap"><div class="rsi-chart-head"><span>RSI 14</span><b class="${Number.isFinite(technical.rsi) ? technical.rsi >= 70 ? "red" : technical.rsi <= 30 ? "green" : "amber" : ""}">${Number.isFinite(technical.rsi) ? technical.rsi.toFixed(1) : "N/A"}</b></div><canvas id="rsi-chart" aria-label="${ticker} RSI 14 line chart"></canvas></div>
        <div class="price-metrics">
          <div><div class="metric">SMA 10</div><strong>${metricPrice(technical.sma10)}</strong></div>
          <div><div class="metric">SMA 20</div><strong>${metricPrice(technical.sma20)}</strong></div>
          <div><div class="metric">SMA 50</div><strong>${metricPrice(technical.sma50)}</strong></div>
          <div><div class="metric">SMA 150</div><strong>${metricPrice(technical.sma150)}</strong></div>
          <div><div class="metric">%ATR from 50 MA &lt; 4</div><strong class="${atrRulePasses ? "green" : "red"}">${Number.isFinite(atrDistance) ? atrDistance.toFixed(2) : "N/A"}</strong><p class="muted">${Number.isFinite(atrDistance) ? (atrRulePasses ? "Pass" : "Extended") : "Unavailable"}</p></div>
          <div><div class="metric">RSI 14</div><strong>${Number.isFinite(technical.rsi) ? technical.rsi.toFixed(1) : "N/A"}</strong><p class="muted">${rsiState}</p></div>
          <div><div class="metric">Ann. Volatility</div><strong>${metricPercent(technical.volatility)}</strong></div>
        </div>
      </div>
    </section>

    <section class="card gamma-card section">
      <div class="gamma-head">
        <div><span class="metric">OPTIONS POSITIONING</span><h2>${escapeHtml(gammaExposure.symbol)} Gamma Exposure by Strike</h2><p class="subtle">Dealer-sign estimate from listed option gamma and open interest. Calls are positive; puts are negative.</p></div>
        <div class="gamma-search"><input id="gamma-ticker" value="${escapeHtml(gammaExposure.symbol)}" aria-label="Gamma exposure ticker" placeholder="Ticker"><button class="primary" id="gamma-search" type="button">Analyze</button></div>
      </div>
      <div class="gamma-controls"><div class="segmented">${[7,14,30,45,60,90].map(days => `<button class="${active(days, gammaExposure.dte)}" data-gamma-dte="${days}">${days}D</button>`).join("")}</div><span class="subtle">Expiration nearest ${gammaExposure.dte} days</span></div>
      ${gamma ? `<div class="gamma-metrics">
        <div><span class="metric">Underlying</span><strong>${fmt(gamma.underlyingPrice)}</strong></div>
        <div><span class="metric">Gamma flip</span><strong>${Number.isFinite(gamma.gammaFlip) ? fmt(gamma.gammaFlip) : "No flip in range"}</strong></div>
        <div><span class="metric">Call wall</span><strong class="green">${fmt(gamma.callWall)}</strong></div>
        <div><span class="metric">Put wall</span><strong class="red">${fmt(gamma.putWall)}</strong></div>
        <div><span class="metric">Net GEX / 1%</span><strong class="${gamma.netGamma >= 0 ? "green" : "red"}">${gammaMoney(gamma.netGamma)}</strong></div>
      </div><div class="gamma-chart-wrap"><canvas id="gamma-chart" aria-label="${escapeHtml(gammaExposure.symbol)} gamma exposure by strike"></canvas></div><div class="gamma-legend"><span class="call">Positive call gamma</span><span class="put">Negative put gamma</span><span class="curve">Net gamma curve</span><span>Last price</span></div><p class="subtle gamma-source">${escapeHtml(gamma.provider)} · expiration ${gamma.expiration ? new Date(gamma.expiration).toLocaleDateString(undefined,{timeZone:"UTC"}) : "nearest available"} · ${gamma.contractCount} liquid contracts · updated ${new Date(gamma.fetchedAt).toLocaleString()}</p>` : `<div class="gamma-empty"><strong>${gammaExposure.loading ? "Loading the options chain..." : "Gamma exposure unavailable"}</strong><p>${escapeHtml(gammaExposure.loading ? `Requesting listed options near ${gammaExposure.dte} DTE for ${gammaExposure.symbol}.` : gammaExposure.error || "Search a stock or ETF with listed U.S. options.")}</p></div>`}
      <p class="subtle gamma-disclaimer">Exposure is an estimate, not dealer inventory. It changes as price, implied volatility, open interest, and time to expiration change.</p>
    </section>

    <section class="grid cols-2 section">
      <div class="card clickable" data-detail="signals">
        <h3>Signal breakdown <span class="muted">· 1 month horizon</span></h3>
        <p class="subtle">What's driving the probability</p>
        <div class="split-list section">
          ${[["Long-term trend", Number.isFinite(technical.sma200) ? `${s.price >= technical.sma200 ? "Above" : "Below"} 200-session SMA (${pct((s.price / technical.sma200 - 1) * 100)})` : "Needs 200 sessions", trendSignal],["MA cross (20/50)", Number.isFinite(technical.sma20) && Number.isFinite(technical.sma50) ? `${technical.sma20 >= technical.sma50 ? "Golden" : "Bearish"} - 20 ${technical.sma20 >= technical.sma50 ? "above" : "below"} 50` : "Insufficient history", crossSignal],["%ATR from 50 MA < 4", atrRuleText, atrSignal],["RSI (14)", Number.isFinite(technical.rsi) ? `${technical.rsi.toFixed(1)} - ${rsiState.toLowerCase()}` : "Insufficient history", rsiSignal],["Momentum (20 sessions)", Number.isFinite(technical.momentum20) ? `${pct(technical.momentum20)} cumulative` : "Insufficient history", momentumSignal]].map(r => `<div class="row"><div><strong>${r[0]}</strong><p class="muted">${r[1]}</p></div><span class="${r[2][0] === "+" ? "green" : "red"}">${r[2]}</span></div>`).join("")}
        </div>
      </div>
    </section>

    <section class="grid cols-2 section">
      <div class="card clickable" data-detail="fundamentals">
        <h3>Fundamentals &amp; Trend</h3><p class="subtle">${escapeHtml(company.provider)} fundamentals and price-derived trend indicators</p>
        <div class="grid cols-3 section">
          <div><div class="metric">Sector · ${escapeHtml(s.sector || "N/A")}</div><strong class="${trend.className}">${trend.label}${Number.isFinite(trend.score) ? ` · ${trend.score}%` : ""}</strong></div>
          <div><div class="metric">Industry</div><strong>${escapeHtml(s.industry || "N/A")}</strong></div>
          <div><div class="metric">TSI (25,13)</div><strong class="${Number.isFinite(technical.tsi) ? technical.tsi >= 10 ? "green" : technical.tsi <= -10 ? "red" : "amber" : ""}">${Number.isFinite(technical.tsi) ? technical.tsi.toFixed(1) : "N/A"}</strong><p class="muted">${tsiState}</p></div>
          <div><div class="metric">EPS (TTM)</div><strong>${Number.isFinite(s.eps) ? fmt(s.eps) : "N/A"}</strong></div>
          <div><div class="metric">EPS Growth (YoY)</div><strong>${Number.isFinite(s.growth) ? `${s.growth.toFixed(1)}%` : "N/A"}</strong></div>
          <div><div class="metric">Revenue (TTM)</div><strong>${company.revenue}</strong></div>
          <div><div class="metric">P/E (TTM)</div><strong>${company.pe}</strong></div>
        </div>
      </div>
      <div class="card clickable" data-detail="earnings">
        <h3>Earnings Reports</h3><p class="subtle">Verified quarterly EPS, estimates, revenue, and year-over-year revenue growth for ${ticker}</p>
        <div class="row section"><span class="muted">Latest revenue growth (YoY)</span><strong class="${Number(s.revenueGrowth) >= 0 ? "green" : "amber"}">${isFiniteValue(s.revenueGrowth) ? `${Number(s.revenueGrowth) >= 0 ? "+" : ""}${Number(s.revenueGrowth).toFixed(1)}%` : "N/A"}</strong></div>
        ${earningsRows.length ? `<div class="earnings-controls toolbar section"><div class="segmented"><button class="${active("eps", earningsView)}" data-earnings-view="eps">EPS</button><button class="${active("revenue", earningsView)}" data-earnings-view="revenue" ${hasRevenueGrowth ? "" : "disabled"}>Revenue Growth</button></div>${earningsView === "eps" ? `<button class="${earningsShowEstimates ? "active" : ""}" data-estimates-toggle>${earningsShowEstimates ? "Hide Estimates" : "Show Estimates"}</button>` : ""}<span class="subtle">Source: ${escapeHtml(earningsProvider)}</span></div>${earningsView === "eps" ? `<div class="earnings-legend section"><span class="actual">Actual EPS</span>${earningsShowEstimates ? `<span class="estimate">Estimate</span>` : ""}<strong>${earningsRows.length} reported quarters</strong></div>` : `<div class="earnings-legend section"><span class="revenue">Revenue growth YoY</span><strong>${earningsRows.filter(row => Number.isFinite(Number(row.revenueGrowthYoY))).length} reported growth periods</strong></div>`}<canvas id="earnings-chart" class="earnings-chart" aria-label="${ticker} ${earningsView === "eps" ? "quarterly actual and estimated EPS" : "quarterly year-over-year revenue growth"}"></canvas><div class="earnings-values">${earningsRows.slice().reverse().map(row => `<div><span>${escapeHtml(earningsPeriodLabel(row))}</span>${earningsView === "eps" ? `<strong>${fmt(Number(row.actual))}${earningsShowEstimates ? ` / ${fmt(Number(row.estimate))}` : ""}</strong><small class="${Number(row.surprise) >= 0 ? "green" : "amber"}">${earningsShowEstimates && Number.isFinite(Number(row.surprise)) ? `${Number(row.surprise) >= 0 ? "+" : ""}${Number(row.surprise).toFixed(2)} surprise` : earningsShowEstimates ? "Estimate unavailable" : "Estimate hidden"}</small>` : `<strong>${Number.isFinite(Number(row.revenue)) ? `$${compactNumber(Number(row.revenue))}` : "Revenue N/A"}</strong><small class="${Number(row.revenueGrowthYoY) >= 0 ? "green" : "amber"}">${Number.isFinite(Number(row.revenueGrowthYoY)) ? `${Number(row.revenueGrowthYoY) >= 0 ? "+" : ""}${Number(row.revenueGrowthYoY).toFixed(1)}% YoY` : "Prior-year comparison unavailable"}</small>${row.revenueGrowthBasis ? `<small>${escapeHtml(row.revenueGrowthBasis)}</small>` : ""}`}${row.reportedDate ? `<small>Reported ${escapeHtml(new Date(`${row.reportedDate}T00:00:00Z`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}))}</small>` : ""}</div>`).join("")}</div>` : `<div class="data-empty section"><p>Verified reported earnings are unavailable for this symbol. No generated earnings records are displayed.</p></div>`}
      </div>
    </section>

    <section class="grid cols-2 section">
      ${probabilityPanel("Price target probability", "Chance of reaching a target price across timeframes", priceTarget, "Probability of reaching", "price", false, "target-probability")}
      ${probabilityPanel("Options probability", "Strategy-aware expiration probability using listed-option IV and your premium", optionsTarget, "Terminal-price probability", "options", true, "options-probability")}
    </section>
  `);
  arrangeDashboardLayout();
  const trendNode = [...document.querySelectorAll('[data-detail="fundamentals"] strong')].find(node => /UPTREND|DOWNTREND|NEUTRAL|TREND LOADING/.test(node.textContent));
  if (trendNode) {
    trendNode.className = trend.className;
    trendNode.textContent = `${trend.label}${Number.isFinite(trend.score) ? ` - ${trend.score}%` : ""}`;
  }
  const tsiMetric = [...document.querySelectorAll('[data-detail="fundamentals"] .metric')].find(node => node.textContent.includes("TSI"));
  const tsiCard = tsiMetric?.parentElement;
  if (tsiCard) {
    const valueNode = tsiCard.querySelector("strong");
    const stateNode = tsiCard.querySelector("p");
    if (valueNode) {
      valueNode.className = Number.isFinite(technical.tsi) ? technical.tsi >= 10 ? "green" : technical.tsi <= -10 ? "red" : "amber" : "";
      valueNode.textContent = Number.isFinite(technical.tsi) ? technical.tsi.toFixed(1) : "N/A";
    }
    if (stateNode) stateNode.textContent = tsiState;
  }
  bindDashboard();
  if (!gammaExposure.data && !gammaExposure.loading && !gammaExposure.error) {
    queueMicrotask(() => refreshGammaExposure(gammaExposure.symbol, gammaExposure.dte));
  }
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x);
  return .5 * (1 + sign * erf);
}

function barrierTouchProbability(spot, target, logDrift, volatility, years) {
  if (![spot, target, logDrift, volatility, years].every(Number.isFinite) || spot <= 0 || target <= 0 || volatility <= 0 || years <= 0) return null;
  if (Math.abs(target - spot) < .000001) return 100;
  const sigmaRootT = volatility * Math.sqrt(years);
  const upper = target > spot;
  const distance = Math.abs(Math.log(target / spot));
  const directionalDrift = upper ? logDrift : -logDrift;
  const probability = normalCdf((directionalDrift * years - distance) / sigmaRootT)
    + Math.exp(2 * directionalDrift * distance / (volatility * volatility)) * normalCdf((-directionalDrift * years - distance) / sigmaRootT);
  return Math.max(0, Math.min(100, probability * 100));
}

function marketReturnModel(payload) {
  if (!payload?.c?.length || /demo fallback|offline/i.test(String(payload.provider || ""))) return null;
  const timestamps = Array.isArray(payload.t) ? payload.t : [];
  const points = payload.c.map((close, index) => ({
    close: Number(close),
    time: Number(timestamps[index]) > 1e12 ? Number(timestamps[index]) / 1000 : Number(timestamps[index])
  })).filter(point => Number.isFinite(point.close) && point.close > 0 && Number.isFinite(point.time));
  points.sort((a, b) => a.time - b.time);
  if (points.length < 30) return null;

  const returns = [];
  const intervals = [];
  for (let index = 1; index < points.length; index++) {
    const days = (points[index].time - points[index - 1].time) / 86400;
    const value = Math.log(points[index].close / points[index - 1].close);
    if (Number.isFinite(value) && days > 0 && days < 45) {
      returns.push(value);
      intervals.push(days);
    }
  }
  if (returns.length < 25) return null;
  const orderedIntervals = [...intervals].sort((a, b) => a - b);
  const medianDays = orderedIntervals[Math.floor(orderedIntervals.length / 2)];
  const periodsPerYear = medianDays <= 3 ? 252 : Math.min(252, 365.25 / medianDays);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  const volatility = Math.max(.03, Math.min(2.5, Math.sqrt(variance * periodsPerYear)));
  // Historical drift is noisy, so use a conservative quarter-weighted estimate.
  const logDrift = Math.max(-.2, Math.min(.2, mean * periodsPerYear * .25));
  return { volatility, logDrift, observations: returns.length, medianDays };
}

function terminalThresholdProbability(spot, threshold, volatility, years, logDrift, directionAbove) {
  if (![spot, threshold, volatility, years, logDrift].every(Number.isFinite) || spot <= 0 || threshold <= 0 || volatility <= 0 || years <= 0) return null;
  const z = (Math.log(threshold / spot) - logDrift * years) / (volatility * Math.sqrt(years));
  const above = (1 - normalCdf(z)) * 100;
  return directionAbove ? above : 100 - above;
}

function probabilityPanel(title, subtitle, target, label, targetKind, options = false, detail = "") {
  const spot = stocks[ticker].price;
  const targetPct = (target / spot - 1) * 100;
  const directionAbove = options ? optionSide === "Buy Call" || optionSide === "Sell Put" : target >= spot;
  const horizons = [["1D",1],["1W",5],["1M",21],["6M",126],["1Y",252]];
  const history = marketData.probabilityCandles[ticker];
  const historyProvider = history?.provider || "market history";
  const returnModel = marketReturnModel(history);
  const rawImpliedVolatility = gammaExposure.data?.symbol === ticker && !/demo fallback|offline/i.test(String(gammaExposure.data?.provider || ""))
    ? Number(gammaExposure.data.atmImpliedVolatility)
    : null;
  const impliedVolatility = Number.isFinite(rawImpliedVolatility)
    ? rawImpliedVolatility > 3 ? rawImpliedVolatility / 100 : rawImpliedVolatility
    : null;
  const premiumEntered = options && Number.isFinite(optionPremium) && optionPremium >= 0;
  const premium = premiumEntered ? optionPremium : 0;
  const breakEven = options
    ? optionSide.includes("Call") ? target + premium : Math.max(.01, target - premium)
    : target;
  const modelVolatility = options && Number.isFinite(impliedVolatility) && impliedVolatility > 0
    ? impliedVolatility
    : returnModel?.volatility;
  const estimates = returnModel && Number.isFinite(modelVolatility) ? horizons.map(([, days]) => {
    const years = days / 252;
    const probability = options
      ? terminalThresholdProbability(spot, breakEven, modelVolatility, years, returnModel.logDrift, directionAbove)
      : barrierTouchProbability(spot, target, returnModel.logDrift, returnModel.volatility, years);
    return Number.isFinite(probability) ? { probability, samples: returnModel.observations } : null;
  }) : null;
  const chances = estimates?.every(Boolean) ? estimates.map(result => Math.max(0, Math.min(100, Math.round(result.probability)))) : null;
  const sampleCount = estimates?.filter(Boolean).reduce((minimum,result) => Math.min(minimum,result.samples),Infinity);
  const resultLabel = options
    ? premiumEntered ? "Estimated probability of profit at expiration" : "Estimated favorable-side probability at expiration"
    : `${label} ${fmt(target)}`;
  const volatilitySource = options && Number.isFinite(impliedVolatility) ? `${(impliedVolatility * 100).toFixed(1)}% listed-option IV` : `${returnModel ? (returnModel.volatility * 100).toFixed(1) : "N/A"}% realized volatility`;
  return `<div class="card clickable" data-detail="${detail}">
    <h3>${title} <span class="muted">· ${ticker}</span></h3><p class="subtle">${subtitle}</p>
    ${options ? `<div class="toolbar">${["Buy Call","Sell Call","Buy Put","Sell Put"].map(x => `<button class="${active(x, optionSide)}" data-option="${x}">${x}</button>`).join("")}</div>` : ""}
    <div class="row section"><span class="muted">${options ? "Strike" : "Target price"} · spot ${fmt(spot)}</span><strong>${fmt(target)}</strong><span class="${targetPct >= 0 ? "green" : "red"}">${targetPct >= 0 ? "+" : ""}${targetPct.toFixed(1)}%</span></div>
    <div class="custom-target"><label for="custom-${targetKind}">${options ? "Enter strike price" : "Enter target price"}</label><div><span>$</span><input id="custom-${targetKind}" type="number" min="0.01" step="0.01" value="${target.toFixed(2)}" data-custom-target="${targetKind}"><button class="primary" data-apply-target="${targetKind}">Apply</button></div></div>
    ${options ? `<div class="custom-target"><label for="option-premium">Option premium per share (optional, for probability of profit)</label><div><span>$</span><input id="option-premium" type="number" min="0" step="0.01" placeholder="0.00" value="${premiumEntered ? optionPremium.toFixed(2) : ""}" data-option-premium><button class="primary" data-apply-premium>Apply</button></div></div>` : ""}
    <div class="toolbar">${[-10,-5,0,5,10,20].filter(v => !(!options && v === 0)).map(v => `<button class="${Math.abs(targetPct-v)<.05 ? "active" : ""}" data-target-kind="${targetKind}" data-target-percent="${v}">${v > 0 ? "+" : ""}${v}%</button>`).join("")}${options ? `<button data-reset-target="options">Reset to spot</button>` : ""}</div>
    ${options ? `<div class="row section"><span class="muted">${premiumEntered ? "Expiration break-even" : "Threshold (premium not entered)"}</span><strong>${fmt(breakEven)}</strong></div>` : ""}
    <div class="metric">${resultLabel}</div>
    ${chances ? `<div class="stack section">${horizons.map(([h],i) => `<div class="progress-row"><strong>${h}</strong><div class="bar"><span style="width:${chances[i]}%"></span></div><span>${chances[i]}%</span></div>`).join("")}</div><p class="subtle section">${options ? `Uses ${escapeHtml(volatilitySource)} and the ${escapeHtml(optionSide)} expiration threshold. ${premiumEntered ? `Break-even includes the entered ${fmt(optionPremium)} premium.` : "Enter the option premium to convert this into an estimated probability of profit."}` : `Estimated probability of touching the target using ${escapeHtml(historyProvider)} timestamp-normalized returns and ${(returnModel.volatility * 100).toFixed(1)}% realized volatility.`} ${Number.isFinite(sampleCount) ? `${sampleCount.toLocaleString()} valid return observations.` : ""} This is a statistical estimate, not a forecast or guarantee.${options ? " Fees, dividends, early exercise, and volatility skew can change the realized outcome." : ""}</p>` : `<div class="data-empty section"><p>Probability unavailable because verified timestamped market history did not return enough observations for this symbol.</p></div>`}
  </div>`;
}

function sentiment() {
  const data = marketData.cnn.data;
  const current = data?.fear_and_greed;
  if (!current) {
    pageShell("CNN Fear & Greed Index", "Broad U.S. market sentiment", `
      <section class="card data-empty"><h2>${marketData.cnn.loading ? "Loading CNN sentiment" : "CNN sentiment unavailable"}</h2><p>${marketData.cnn.loading ? "Fetching the latest Fear & Greed reading and history..." : escapeHtml(marketData.cnn.error || "CNN did not return a current reading.")}</p></section>`);
    return;
  }
  const score = Math.round(Number(current.score));
  const rating = String(current.rating || (score >= 75 ? "Extreme Greed" : score >= 55 ? "Greed" : score >= 45 ? "Neutral" : score >= 25 ? "Fear" : "Extreme Fear"));
  const scoreClass = score >= 55 ? "green" : score < 45 ? "red" : "amber";
  const previous = [
    ["Previous close", current.previous_close], ["1 week ago", current.previous_1_week],
    ["1 month ago", current.previous_1_month], ["1 year ago", current.previous_1_year]
  ];
  const components = [
    ["S&P 500 Momentum", data.market_momentum_sp500], ["Stock Price Strength", data.stock_price_strength],
    ["Stock Price Breadth", data.stock_price_breadth], ["Put/Call Options", data.put_call_options],
    ["Market Volatility", data.market_volatility_vix], ["Junk Bond Demand", data.junk_bond_demand],
    ["Safe Haven Demand", data.safe_haven_demand]
  ].filter(([, value]) => Number.isFinite(Number(value?.score)));
  const updated = current.timestamp || data.fetchedAt;
  const sentimentProvider = data.provider || "CNN Fear & Greed Index";
  const fallbackNotice = /demo fallback/i.test(sentimentProvider) ? "Offline fallback values are shown because the live CNN feed is unavailable." : "Values are cached for five minutes; no synthetic sentiment values are shown.";
  pageShell("CNN Fear & Greed Index", `Broad U.S. market sentiment · Updated ${updated ? new Date(updated).toLocaleString() : "recently"}`, `
    <section class="grid cols-3">
      <div class="card probability"><div><div class="metric">Right now</div><strong>${score}</strong><p class="${scoreClass}">${escapeHtml(rating)}</p></div></div>
      <div class="card stack">${previous.map(([label, value]) => `<div class="row"><span class="muted">${label}</span><strong>${Number.isFinite(Number(value)) ? Math.round(Number(value)) : "N/A"}</strong></div>`).join("")}</div>
      <div class="card"><div class="metric">Scale</div><div class="value">0–100</div><p class="subtle">0 = extreme fear · 100 = extreme greed</p><p class="subtle section">Source: ${escapeHtml(sentimentProvider)}</p></div>
    </section>
    <section class="card section"><h2>Seven components</h2><div class="sentiment-components section">${components.map(([label, value]) => { const componentScore = Math.max(0, Math.min(100, Number(value.score))); return `<div><div class="row"><span>${label}</span><strong>${Math.round(componentScore)}</strong></div><div class="bar"><span style="width:${componentScore}%"></span></div><p class="muted">${escapeHtml(String(value.rating || ""))}</p></div>`; }).join("")}</div></section>
    <section class="card sentiment-history section"><h2>6-month history</h2><canvas id="sentiment-chart" aria-label="CNN Fear and Greed six month history"></canvas></section>
    <p class="subtle section">Source: ${escapeHtml(sentimentProvider)}. ${escapeHtml(fallbackNotice)}</p>`);
}

function macroResearchSections(last) {
  return `
    <section class="card yardeni-card"><div><h2>Yardeni-style Valuation</h2><p class="subtle">S&amp;P 500 price vs Fed-model fair value proxy. Shaded bands show +/-10% and +/-20% deviation from fair value.</p></div><canvas id="yardeni-chart" class="section" aria-label="Yardeni-style valuation chart"></canvas><div class="yardeni-legend"><span class="over">+10-20% overvalued</span><span class="fair">Fair value +/-10%</span><span class="under">-10-20% undervalued</span></div><div class="grid cols-3 yardeni-metrics section"><div><div class="metric">Implied fair</div><strong id="yardeni-fair-value">N/A</strong></div><div><div class="metric">Last</div><strong>${Number.isFinite(last)?last.toLocaleString(undefined,{maximumFractionDigits:2}):"N/A"}</strong></div><div><div class="metric">Deviation</div><strong id="yardeni-deviation">N/A</strong></div></div></section>
    <section class="card macro-research-card"><div class="research-chart-head"><div><span class="metric">MACRO RESEARCH PROXY</span><h2>Coincident Economic Indicators vs S&amp;P 500 Forward Earnings</h2><p class="subtle">Yearly percent change style chart built from available S&amp;P 500 history and FRED macro series.</p></div><span class="research-badge">Long history</span></div><canvas id="coincident-earnings-chart" class="macro-research-chart section" aria-label="Coincident economic indicators versus S&P 500 forward earnings proxy"></canvas><div class="research-legend"><span class="earnings">S&amp;P 500 forward earnings proxy</span><span class="economic">Coincident economic indicator proxy</span><span class="recession">Recession shading</span></div><p class="research-source">Source inputs: app S&amp;P 500 history and FRED unemployment, CPI, fed funds, and 10-year Treasury data. This is a visual research proxy, not licensed Yardeni or FactSet data.</p></section>
    <section class="card macro-research-card"><div class="research-chart-head"><div><span class="metric">S&amp;P 500 / EPS PROXY</span><h2>S&amp;P 500 Price vs Forward 12-Month EPS</h2><p class="subtle">Ten-year dual-axis chart using S&amp;P price and a smoothed forward-EPS proxy derived from available market history.</p></div><span class="research-badge">10Y</span></div><canvas id="price-eps-chart" class="macro-research-chart section" aria-label="S&P 500 price versus forward twelve month EPS proxy"></canvas><div class="research-legend"><span class="price">Price</span><span class="eps">Forward 12-month EPS proxy</span></div><p class="research-source">For exact FactSet forward EPS, connect a licensed earnings-estimate feed. This app currently renders a smoothed proxy so the macro layout is available now.</p></section>
  `;
}

function macro() {
  const spCloses = normalizeSp500Candles(marketData.spCandles)?.c || [];
  const average = size => spCloses.length >= size ? spCloses.slice(-size).reduce((sum,value)=>sum+value,0) / size : null;
  const last = spCloses.at(-1) ?? null, sma50 = average(50), sma200 = average(200);
  const comparison = (label, movingAverage) => Number.isFinite(last) && Number.isFinite(movingAverage)
    ? `<span class="pill ${last >= movingAverage ? "green" : "red"}">${label}: ${last >= movingAverage ? "Above" : "Below"} (${pct((last / movingAverage - 1) * 100)})</span>`
    : `<span class="pill">${label}: N/A</span>`;
  const indicators = marketData.macro.data?.series || {};
  const sectorRows = Array.isArray(marketData.macro.sectors?.sectors)
    ? [...marketData.macro.sectors.sectors].sort((a, b) => Number(b[sectorRange]) - Number(a[sectorRange]))
    : [];
  const sectorMax = Math.max(1, ...sectorRows.map(row => Math.abs(Number(row[sectorRange]))).filter(Number.isFinite));
  const sectorLabels = { oneMonth: "1M", threeMonth: "3M", sixMonth: "6M", ytd: "YTD" };
  const sectorProvider = marketData.macro.sectors?.provider || "market history";
  const indicatorCard = (id, fallbackTitle, sourceLabel) => {
    const series = indicators[id];
    if (!series?.rows?.length) return `<section class="card macro-indicator-card"><h2>${fallbackTitle}</h2><div class="data-empty section"><p>${escapeHtml(marketData.macro.loading ? "Loading official FRED observations..." : marketData.macro.error || "This FRED series is unavailable.")}</p></div></section>`;
    const latest = Number(series.latest?.value), prior = Number(series.prior?.value), yearAgo = Number(series.yearAgo?.value), change = latest - prior;
    const rangeDays = { "6M":190, "1Y":380, "2Y":750, "5Y":1840, "10Y":3670 }[macroRanges[id]];
    const cutoff = new Date(`${series.latest.date}T00:00:00Z`).getTime() - rangeDays * 86400000;
    const selectedValues = series.rows.filter(row => new Date(`${row.date}T00:00:00Z`).getTime() >= cutoff).map(row => Number(row.value)).filter(Number.isFinite);
    const rangeHigh = selectedValues.length ? Math.max(...selectedValues) : null;
    const rangeLow = selectedValues.length ? Math.min(...selectedValues) : null;
    return `<section class="card macro-indicator-card"><div class="macro-card-head"><div><div class="metric">FRED · ${escapeHtml(sourceLabel)} · ${escapeHtml(series.frequency)}</div><h2>${escapeHtml(series.name)}</h2></div><div class="macro-current"><strong>${latest.toFixed(2)}%</strong><span class="${change > 0 ? "red" : change < 0 ? "green" : "muted"}">${change > 0 ? "UP" : change < 0 ? "DOWN" : "FLAT"} ${change >= 0 ? "+" : ""}${change.toFixed(2)}</span></div></div><div class="segmented macro-ranges">${["6M","1Y","2Y","5Y","10Y"].map(range => `<button class="${active(range, macroRanges[id])}" data-macro-id="${id}" data-macro-range="${range}">${range}</button>`).join("")}</div><canvas id="macro-${id}" class="macro-sparkline" aria-label="${escapeHtml(series.name)} history from FRED"></canvas><div class="macro-footer"><span>Prior: ${Number.isFinite(prior) ? `${prior.toFixed(2)}%` : "N/A"}</span><span>Year ago: ${Number.isFinite(yearAgo) ? `${yearAgo.toFixed(2)}%` : "N/A"}</span><span>${macroRanges[id]} range: ${Number.isFinite(rangeLow) && Number.isFinite(rangeHigh) ? `${rangeLow.toFixed(2)}–${rangeHigh.toFixed(2)}%` : "N/A"}</span><span>${escapeHtml(series.latest.date)}</span></div></section>`;
  };
  pageShell("Macro", "Official FRED economic indicators and market-index context", `
    <section class="grid cols-2 macro-indicator-grid">${indicatorCard("unemployment", "Unemployment Rate", "UNRATE")}${indicatorCard("inflation", "Inflation (CPI YoY)", "CPIAUCSL")}${indicatorCard("fed", "Fed Funds Rate", "FEDFUNDS")}${indicatorCard("treasury", "10-Year Treasury Yield", "DGS10")}</section>
    <section class="card sp500-card"><div class="sp500-head"><div><h2>S&amp;P 500 Index vs Moving Averages</h2><p class="subtle">^GSPC · ${spRange} · ${marketData.spLoading ? "Loading market history" : marketData.spCandles ? escapeHtml(marketData.spCandles.provider || "Alpha Vantage") : marketData.spError || "History unavailable"}</p></div><div class="sp500-controls"><div class="pill-list">${comparison("50-day",sma50)}${comparison("200-day",sma200)}</div><div class="segmented">${["6M","1Y","2Y","5Y","10Y"].map(range => `<button class="${active(range,spRange)}" data-sp-range="${range}">${range}</button>`).join("")}</div></div></div>${marketData.spCandles ? `<canvas id="macro-chart" class="sp500-chart section" aria-label="S&P 500 history with moving averages from ${escapeHtml(marketData.spCandles.provider || "Alpha Vantage")}"></canvas>` : `<div class="data-empty section"><p>${escapeHtml(marketData.spLoading ? "Requesting index candles..." : marketData.spError || "Index candles are unavailable from Alpha Vantage or Stooq.")}</p></div>`}<div class="grid cols-3 sp500-metrics section"><div><div class="metric">Last</div><strong>${Number.isFinite(last)?last.toLocaleString(undefined,{maximumFractionDigits:2}):"N/A"}</strong></div><div><div class="metric">SMA 50</div><strong>${Number.isFinite(sma50)?sma50.toLocaleString(undefined,{maximumFractionDigits:2}):"N/A"}</strong></div><div><div class="metric">SMA 200</div><strong>${Number.isFinite(sma200)?sma200.toLocaleString(undefined,{maximumFractionDigits:2}):"N/A"}</strong></div></div></section>
    <section class="card sector-etf-card"><div class="sector-etf-head"><div><h2>Sector ETF Performance</h2><p class="subtle">S&amp;P 500 Select Sector SPDR ETFs · ${escapeHtml(sectorProvider)}</p></div><div class="segmented">${Object.entries(sectorLabels).map(([key,label]) => `<button class="${active(key,sectorRange)}" data-sector-range="${key}">${label}</button>`).join("")}</div></div>${sectorRows.length ? `<div class="sector-etf-list section">${sectorRows.map(row => { const value=Number(row[sectorRange]); return `<div class="sector-etf-row"><strong>${escapeHtml(row.symbol)}</strong><span>${escapeHtml(row.name)}</span><div class="sector-bar"><i class="${value >= 0 ? "positive" : "negative"}" style="width:${Math.max(2,Math.abs(value)/sectorMax*100)}%"></i></div><b class="${value >= 0 ? "green" : "red"}">${value >= 0 ? "+" : ""}${value.toFixed(2)}%</b></div>`; }).join("")}</div><p class="subtle section">Source: ${escapeHtml(marketData.macro.sectors.provider)} · Updated ${new Date(marketData.macro.sectors.fetchedAt).toLocaleString()}</p>` : `<div class="data-empty section"><p>${escapeHtml(marketData.macro.loading ? "Loading sector ETF history..." : marketData.macro.sectorError || "Sector ETF performance is unavailable.")}</p></div>`}</section>
    ${macroResearchSections(last)}
    <p class="subtle section">Economic data: Federal Reserve Bank of St. Louis (FRED). CPI inflation is calculated as the year-over-year percentage change in CPIAUCSL. Latest observations may be revised by their source.</p>`);
  bindMacro();
}

function bindMacro() {
  document.querySelectorAll("[data-sp-range]").forEach(button => button.onclick = () => { spRange = button.dataset.spRange; marketData.spCandles = null; macro(); refreshMacroData(); });
  document.querySelectorAll("[data-macro-range]").forEach(button => button.onclick = () => {
    macroRanges[button.dataset.macroId] = button.dataset.macroRange;
    macro();
  });
  document.querySelectorAll("[data-sector-range]").forEach(button => button.onclick = () => {
    sectorRange = button.dataset.sectorRange;
    macro();
  });
}



function news() {
  const s = stocks[ticker] || stocks.AAPL;
  const updated = s.updatedAt ? new Date(s.updatedAt) : new Date();
  const hourlyLabel = `${updated.toLocaleDateString([], { month: "short", day: "numeric" })} ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  pageShell("AI News Summary", "Updated HOURLY - why is this stock up or down today?", `
    <div class="toolbar"><input id="news-input" placeholder="Ticker (AAPL...)" value="${ticker}"><button class="primary" id="news-search">Search</button></div>
    <section class="card news-summary-card">
      <div class="news-summary-head"><div><p class="metric">AI NEWS SUMMARY - UPDATED HOURLY</p><h2>${ticker}: why is this stock ${s.pct >= 0 ? "up" : "down"} today?</h2></div><div class="${s.pct >= 0 ? "green" : "red"}"><strong>${pct(s.pct)}</strong><span>${fmt(s.price)}</span></div></div>
      <div id="news-ai-summary" class="news-ai-summary section"></div>
    </section>
    <section class="card section"><div class="news-source-head"><div><h3>Sources linked</h3><p class="subtle">Company headlines from Alpha Vantage. Last app refresh: ${escapeHtml(hourlyLabel)}.</p></div><span class="pill">${marketData.loading ? "Refreshing" : "Hourly summary"}</span></div><div id="news-list" class="section"></div></section>`);
  renderNews();
  const searchNews = () => { ticker = ensureStock(document.querySelector("#news-input").value); news(); refreshTickerData(ticker); };
  document.querySelector("#news-search").onclick = searchNews;
  document.querySelector("#news-input").onkeydown = event => { if (event.key === "Enter") searchNews(); };
}

function renderNews() {
  const list = document.querySelector("#news-list");
  const summary = document.querySelector("#news-ai-summary");
  const stock = stocks[ticker] || stocks.AAPL;
  const stories = marketData.news[ticker];
  if (!stories?.length) {
    if (summary) {
      const emptyText = marketData.loading
        ? "The app is pulling company news and live quote data. Once headlines load, this section will connect the stock move to the source links below."
        : marketData.error || "Try refreshing the ticker or checking another symbol. The quote can still be live even when company-specific news is sparse.";
      summary.innerHTML = `<div class="news-answer"><strong>${marketData.loading ? "Checking today's news..." : "No fresh company headlines found yet."}</strong><p>${escapeHtml(emptyText)}</p></div>`;
    }
    list.innerHTML = `<p class="subtle">${marketData.loading ? "Loading Alpha Vantage news..." : marketData.error || "No Alpha Vantage company news is available for this symbol."}</p>`;
    return;
  }
  const genericCompanyWords = new Set(["inc", "corp", "corporation", "company", "holdings", "class", "plc", "ltd", "limited", "com"]);
  const companyWords = [ticker, ...(stock.name || "").split(/\s+/)]
    .map(word => word.replace(/[^A-Za-z0-9]/g, "").toLowerCase())
    .filter(word => word.length >= 3 && !genericCompanyWords.has(word));
  const mentionsCompany = text => companyWords.some(word => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
  const relevantStories = stories.filter(story => {
    const text = `${story.headline || ""} ${story.summary || ""}`.toLowerCase();
    return mentionsCompany(text);
  });
  const topStories = (relevantStories.length ? relevantStories : stories).slice(0, 5);
  const combinedText = topStories.map(story => `${story.headline || ""} ${story.summary || ""}`).join(" ").toLowerCase();
  const catalysts = [
    [/earn|eps|revenue|guidance|forecast|estimate/, "earnings, guidance, or analyst estimate revisions"],
    [/ai|chip|semiconductor|cloud|data center|software/, "AI, cloud, chips, or product-demand headlines"],
    [/fed|yield|treasury|inflation|rate|macro/, "macro pressure from rates, inflation, or Treasury yields"],
    [/upgrade|downgrade|price target|analyst/, "analyst rating or price-target changes"],
    [/lawsuit|probe|regulat|antitrust|tariff/, "legal, regulatory, or policy risk"],
    [/deal|acquisition|merger|partnership|contract/, "deal, partnership, or contract news"]
  ];
  const matched = catalysts.find(([pattern]) => pattern.test(combinedText));
  const direction = stock.pct >= 0 ? "up" : "down";
  const tone = Math.abs(stock.pct) >= 3 ? "strong" : Math.abs(stock.pct) >= 1 ? "noticeable" : "modest";
  const reason = matched ? matched[1] : "the latest company headlines plus broader market positioning";
  const sourceLinks = topStories.slice(0, 3).map((story, index) => `<a href="${escapeHtml(story.url || "#")}" target="_blank" rel="noopener noreferrer">Source ${index + 1}</a>`).join("");
  if (summary) {
    summary.innerHTML = `<div class="news-answer"><strong>${ticker} is ${direction} ${pct(stock.pct)} today.</strong><p>The move looks like a ${tone} reaction tied mainly to ${escapeHtml(reason)}. Confirm whether the headlines below are changing earnings expectations, growth assumptions, or risk appetite rather than treating the price move alone as the full story.</p></div><div class="news-answer"><strong>What matters right now</strong><p>${escapeHtml(topStories[0]?.headline || "No single dominant headline is available.")}</p><div class="news-summary-links">${sourceLinks}</div></div>`;
  }
  list.innerHTML = stories.map(story => {
    const text = `${story.headline || ""} ${story.summary || ""}`.toLowerCase();
    const relevant = mentionsCompany(text);
    return `<article class="news-item"><h3><a href="${escapeHtml(story.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.headline || "Untitled")}</a></h3><p class="muted">${escapeHtml(story.source || "Alpha Vantage")} - ${new Date(Number(story.datetime) * 1000).toLocaleString()}${relevant ? " - Ticker match" : ""}</p>${story.summary ? `<p class="subtle">${escapeHtml(story.summary)}</p>` : ""}</article>`;
  }).join("");
}

function paper() {
  const s = stocks[ticker] || stocks.AAPL;
  const posValue = Object.entries(positions).reduce((sum, [t, q]) => sum + (stocks[t]?.price || 0) * q, 0);
  pageShell("Paper Trading", "Practice with virtual money - no risk, real prices.", `
    <div class="toolbar"><button id="reset">Reset</button></div>
    <section class="grid cols-4">${[["Total Equity", cash + posValue],["Cash", cash],["Positions Value", posValue],["Total P/L", 0]].map((m,i) => `<div class="card"><div class="metric">${m[0]}</div><div class="value ${i===3 ? "green" : ""}">${i===3 ? "+$0.00" : fmt(m[1])}</div></div>`).join("")}</section>
    <section class="grid cols-2 section">
      <div class="card"><h3>Place an order</h3><div class="toolbar"><input id="paper-ticker" placeholder="Ticker" value="${ticker}"><button id="find">Find</button></div><div class="card"><div class="metric">Active</div><div class="row"><h2>${ticker}</h2><div><strong>${fmt(s.price)}</strong><p class="${s.change>=0?"green":"red"}">${pct(s.pct)}</p></div></div><p class="muted">${s.name}</p></div><div class="toolbar"><button class="active" data-side="Buy">Buy</button><button data-side="Sell">Sell</button></div><label class="metric" for="qty">Quantity</label><div class="toolbar"><input id="qty" type="number" value="10" min="1">${[10,25,50,100].map(q => `<button data-qty="${q}">${q}</button>`).join("")}</div><div class="split-list"><div class="row"><span class="muted">Side</span><strong id="side-label">BUY</strong></div><div class="row"><span class="muted">Price</span><strong>${fmt(s.price)}</strong></div><div class="row"><span class="muted">Cost</span><strong id="cost">${fmt(s.price * 10)}</strong></div></div><button class="primary section" id="trade">BUY 10 ${ticker}</button></div>
      <div class="card"><h3>Positions</h3><div id="positions"></div></div>
    </section>`);
  bindPaper();
  renderPositions();
}

function worldChat() {
  const channels = [
    ["global", "Global", "All markets"],
    ["stocks", "Stocks", "Companies and setups"],
    ["macro", "Macro", "Rates, policy, economy"],
    ["off-topic", "Off Topic", "Community lounge"]
  ];
  pageShell("World Chat", "Live market conversation across the MarketLens community.", `
    <section class="world-chat-shell">
      <aside class="world-chat-sidebar">
        <div class="world-chat-brand"><span class="presence-dot"></span><strong><span data-world-online>${worldChatState.online}</span> online</strong></div>
        <div class="world-channel-list">
          <span class="metric">Channels</span>
          ${channels.map(([key, label, description]) => `<button type="button" class="world-channel ${key === worldChatState.channel ? "active" : ""}" data-world-channel="${key}"><span># ${label}</span><small>${description}</small><b>${worldChatState.byChannel[key] || 0}</b></button>`).join("")}
        </div>
      </aside>
      <div class="world-chat-main">
        <header class="world-chat-head">
          <div><h2># ${channels.find(channel => channel[0] === worldChatState.channel)?.[1]}</h2><p class="muted">${channels.find(channel => channel[0] === worldChatState.channel)?.[2]}</p></div>
          <span class="world-live-badge"><i></i>Live</span>
        </header>
        <div id="world-chat-messages" class="world-chat-messages" aria-live="polite"><div class="world-chat-loading">Connecting to the community...</div></div>
        <div class="world-chat-composer">
          <textarea id="world-message-input" rows="2" maxlength="500" placeholder="Message #${worldChatState.channel}"></textarea>
          <button type="button" class="primary" id="world-message-send">Send</button>
        </div>
        <p id="world-chat-status" class="world-chat-status muted">Messages are shared with everyone currently connected.</p>
      </div>
      <aside class="world-chat-details">
        <div><span class="metric">Your display name</span><input id="world-chat-name" maxlength="24" value="${escapeHtml(worldChatState.user)}" aria-label="Chat display name"></div>
        <div class="world-community-pulse"><span class="metric">Community pulse</span><strong><span data-world-online>${worldChatState.online}</span> traders online</strong><p class="muted">Watching ${ticker} and the broader market</p></div>
        <div class="world-chat-rules"><span class="metric">Community standards</span><p>Be useful. Cite sources. No profanity, harassment, spam, or guaranteed-return claims.</p></div>
      </aside>
    </section>`);
  bindWorldChat();
  refreshWorldChat();
}

function renderWorldChatMessages() {
  const container = document.querySelector("#world-chat-messages");
  if (!container) return;
  if (!worldChatState.messages.length) {
    container.innerHTML = `<div class="world-chat-empty"><strong>No messages in this channel yet.</strong><p>Start the conversation.</p></div>`;
    return;
  }
  container.innerHTML = worldChatState.messages.map(message => {
    const initials = message.system ? "ML" : message.user.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
    const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `<article class="world-message ${message.system ? "system" : ""}"><span class="world-avatar">${escapeHtml(initials || "T")}</span><div><header><strong>${escapeHtml(message.user)}</strong>${message.system ? `<span>Team</span>` : ""}<time>${time}</time></header><p>${escapeHtml(message.text)}</p></div></article>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function updateWorldChatPresenceUi() {
  document.querySelectorAll("[data-world-online]").forEach(element => { element.textContent = worldChatState.online; });
  document.querySelectorAll("[data-world-channel]").forEach(button => {
    const count = button.querySelector("b");
    if (count) count.textContent = worldChatState.byChannel[button.dataset.worldChannel] || 0;
  });
}

async function refreshWorldChat() {
  if (route() !== "/world-chat") return;
  clearTimeout(worldChatTimer);
  try {
    const presenceResponse = await apiFetch("/api/world-chat/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: worldChatState.sessionId, user: worldChatState.user, channel: worldChatState.channel })
    });
    if (!presenceResponse.ok) throw new Error("Presence unavailable");
    const response = await apiFetch(`/api/world-chat/messages?channel=${encodeURIComponent(worldChatState.channel)}`);
    const payload = await apiJson(response, "World Chat messages");
    if (!response.ok) throw new Error(payload.error || "Chat unavailable");
    const incomingMessages = Array.isArray(payload.messages) ? payload.messages : [];
    if (worldChatState.seenMessageIds.size && notificationsEnabled && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      const latest = incomingMessages.filter(message => !worldChatState.seenMessageIds.has(message.id) && !message.system && message.user !== worldChatState.user).at(-1);
      if (latest) new Notification(`#${worldChatState.channel} - ${latest.user}`, { body: latest.text.slice(0, 180), tag: `marketlens-${latest.id}` });
    }
    worldChatState.messages = incomingMessages;
    worldChatState.seenMessageIds = new Set(incomingMessages.map(message => message.id));
    worldChatState.online = Number(payload.online) || 1;
    worldChatState.byChannel = payload.byChannel || {};
    renderWorldChatMessages();
    updateWorldChatPresenceUi();
    const status = document.querySelector("#world-chat-status");
    if (status) {
      status.textContent = "Connected - messages update automatically.";
      status.classList.remove("red");
    }
  } catch {
    const status = document.querySelector("#world-chat-status");
    if (status) status.textContent = "World Chat is reconnecting...";
  }
  if (route() === "/world-chat") worldChatTimer = setTimeout(refreshWorldChat, 3000);
}

async function sendWorldChatMessage() {
  const input = document.querySelector("#world-message-input");
  const button = document.querySelector("#world-message-send");
  const text = input?.value.trim();
  if (!text || !button) return;
  if (hasBlockedChatLanguage(text)) {
    const status = document.querySelector("#world-chat-status");
    if (status) {
      status.textContent = "Please remove inappropriate language before sending.";
      status.classList.add("red");
    }
    return;
  }
  button.disabled = true;
  try {
    const response = await apiFetch("/api/world-chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: worldChatState.sessionId, user: worldChatState.user, channel: worldChatState.channel, text })
    });
    const payload = await apiJson(response, "World Chat message send");
    if (!response.ok) throw new Error(payload.error || "Message failed");
    input.value = "";
    await refreshWorldChat();
  } catch (error) {
    const status = document.querySelector("#world-chat-status");
    if (status) {
      status.textContent = error.message || "Message was not sent. Please try again.";
      status.classList.add("red");
    }
  } finally {
    button.disabled = false;
    input.focus();
  }
}

function bindWorldChat() {
  document.querySelectorAll("[data-world-channel]").forEach(button => {
    button.onclick = () => {
      worldChatState.channel = button.dataset.worldChannel;
      scheduleUserDataSave();
      worldChatState.messages = [];
      worldChat();
    };
  });
  const nameInput = document.querySelector("#world-chat-name");
  nameInput.onchange = () => {
    worldChatState.user = nameInput.value.trim().slice(0, 24) || worldChatState.user;
    nameInput.value = worldChatState.user;
    localStorage.setItem("marketlens-chat-name", worldChatState.user);
    scheduleUserDataSave();
    refreshWorldChat();
  };
  document.querySelector("#world-message-send").onclick = sendWorldChatMessage;
  document.querySelector("#world-message-input").onkeydown = event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendWorldChatMessage();
    }
  };
}

function bindDashboard() {
  const resetCustomTargets = () => { customTargetPrices.price = null; customTargetPrices.options = null; optionPremium = null; };
  const selectTicker = symbol => { ticker = ensureStock(symbol); gammaExposure.symbol = ticker; gammaExposure.data = null; gammaExposure.error = ""; resetCustomTargets(); dashboard(); refreshTickerData(ticker); refreshGammaExposure(ticker); };
  const analyzeTicker = () => selectTicker(document.querySelector("#ticker-input").value);
  document.querySelector("#analyze").onclick = analyzeTicker;
  document.querySelector("#ticker-input").onkeydown = event => { if (event.key === "Enter") analyzeTicker(); };
  const forceRefreshAll = () => {
    marketData.error = "";
    stockRefreshTimes[ticker] = 0;
    [...new Set([ticker, ...watchlist].map(ensureStock))].forEach(symbol => { stockRefreshTimes[symbol] = 0; });
    refreshWatchlistData({ force: true });
    refreshGammaExposure(ticker, gammaExposure.dte);
  };
  document.querySelector("#refresh-all")?.addEventListener("click", forceRefreshAll);
  const analyzeGamma = () => refreshGammaExposure(document.querySelector("#gamma-ticker").value, gammaExposure.dte);
  document.querySelector("#gamma-search").onclick = analyzeGamma;
  document.querySelector("#gamma-ticker").onkeydown = event => { if (event.key === "Enter") analyzeGamma(); };
  document.querySelectorAll("[data-gamma-dte]").forEach(button => button.onclick = () => refreshGammaExposure(gammaExposure.symbol, Number(button.dataset.gammaDte)));
  document.querySelectorAll("[data-horizon]").forEach(b => b.onclick = () => { horizon = b.dataset.horizon; dashboard(); });
  document.querySelectorAll("[data-range]").forEach(b => b.onclick = () => { chartRange = b.dataset.range; refreshChartData(ticker, chartRange); });
  document.querySelectorAll("[data-chart-mode]").forEach(button => button.onclick = () => { priceChartMode = button.dataset.chartMode; dashboard(); });
  document.querySelectorAll("[data-watch-symbol]").forEach(button => button.onclick = () => selectTicker(button.dataset.watchSymbol));
  document.querySelectorAll("[data-remove-symbol]").forEach(button => button.onclick = () => { watchlist = watchlist.filter(symbol => symbol !== button.dataset.removeSymbol); scheduleUserDataSave(); dashboard(); });
  const addWatchlistTicker = async () => {
    const symbol = ensureStock(document.querySelector("#watchlist-input").value);
    if (!watchlist.includes(symbol)) watchlist.push(symbol);
    scheduleUserDataSave();
    dashboard();
    await refreshTickerData(symbol, false);
    if (route() === "/") dashboard();
  };
  document.querySelector("#watchlist-add").onclick = addWatchlistTicker;
  document.querySelector("#watchlist-input").onkeydown = event => { if (event.key === "Enter") addWatchlistTicker(); };
  document.querySelector("#watchlist-refresh")?.addEventListener("click", forceRefreshAll);
  document.querySelectorAll("[data-indicator]").forEach(input => input.onchange = () => {
    chartIndicators[input.dataset.indicator] = input.checked;
    drawPriceChart();
  });
  document.querySelectorAll("[data-target-percent]").forEach(button => button.onclick = () => {
    customTargetPrices[button.dataset.targetKind] = stocks[ticker].price * (1 + Number(button.dataset.targetPercent) / 100);
    dashboard();
  });
  const applyCustomTarget = kind => {
    const input = document.querySelector(`[data-custom-target="${kind}"]`);
    const value = Number(input?.value);
    if (Number.isFinite(value) && value > 0) { customTargetPrices[kind] = value; dashboard(); }
  };
  document.querySelectorAll("[data-apply-target]").forEach(button => button.onclick = () => applyCustomTarget(button.dataset.applyTarget));
  document.querySelectorAll("[data-custom-target]").forEach(input => input.onkeydown = event => { if (event.key === "Enter") applyCustomTarget(input.dataset.customTarget); });
  const applyOptionPremium = () => {
    const input = document.querySelector("[data-option-premium]");
    const value = Number(input?.value);
    optionPremium = input?.value.trim() === "" ? null : Number.isFinite(value) && value >= 0 ? value : optionPremium;
    dashboard();
  };
  document.querySelector("[data-apply-premium]")?.addEventListener("click", applyOptionPremium);
  document.querySelector("[data-option-premium]")?.addEventListener("keydown", event => { if (event.key === "Enter") applyOptionPremium(); });
  document.querySelectorAll("[data-option]").forEach(b => b.onclick = () => { optionSide = b.dataset.option; dashboard(); });
  document.querySelectorAll("[data-reset-target]").forEach(button => button.onclick = () => { customTargetPrices[button.dataset.resetTarget] = stocks[ticker].price; dashboard(); });
  document.querySelectorAll("[data-estimates-toggle]").forEach(button => button.onclick = () => { earningsShowEstimates = !earningsShowEstimates; dashboard(); });
  document.querySelectorAll("[data-earnings-view]").forEach(button => button.onclick = () => { earningsView = button.dataset.earningsView; dashboard(); });
}

function bindPaper() {
  const qty = document.querySelector("#qty");
  const update = () => {
    const q = Number(qty.value || 0);
    document.querySelector("#cost").textContent = fmt((stocks[ticker] || stocks.AAPL).price * q);
    document.querySelector("#trade").textContent = `BUY ${q} ${ticker}`;
  };
  qty.oninput = update;
  document.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => { qty.value = b.dataset.qty; update(); });
  document.querySelector("#find").onclick = () => { ticker = document.querySelector("#paper-ticker").value.toUpperCase() || "AAPL"; paper(); };
  document.querySelector("#trade").onclick = () => {
    const q = Number(qty.value || 0);
    const cost = (stocks[ticker] || stocks.AAPL).price * q;
    if (q > 0 && cost <= cash) { cash -= cost; positions[ticker] = (positions[ticker] || 0) + q; scheduleUserDataSave(); paper(); }
  };
  document.querySelector("#reset").onclick = () => { cash = 100000; positions = {}; scheduleUserDataSave(); paper(); };
}

function renderPositions() {
  const el = document.querySelector("#positions");
  const rows = Object.entries(positions);
  if (!rows.length) { el.innerHTML = `<p class="subtle section">No open positions. Place your first trade above.</p>`; return; }
  el.innerHTML = `<table class="table"><thead><tr><th>Ticker</th><th>Qty</th><th>Value</th></tr></thead><tbody>${rows.map(([t,q]) => `<tr><td>${t}</td><td>${q}</td><td>${fmt(q * stocks[t].price)}</td></tr>`).join("")}</tbody></table>`;
}

function openDetail(kind) {
  const s = stocks[ticker] || stocks.AAPL;
  const company = companyMetrics[ticker] || companyMetrics.AAPL;
  const technical = priceIndicators(ticker);
  const directional = directionalModel(s, technical);
  const trend = trendAnalysis(s, technical);
  const selectedProbability = directional.probabilities[horizon];
  const selectedSwing = directional.swings[horizon];
  const regime = !directional.available ? "Unavailable" : selectedProbability >= 55 ? "Bullish" : selectedProbability <= 45 ? "Bearish" : "Neutral";
  const regimeClass = regime === "Bullish" ? "green" : regime === "Bearish" ? "red" : "";
  const atrDistance = Number.isFinite(technical.atrFromSma50) ? technical.atrFromSma50 : null;
  const atrRulePasses = Number.isFinite(atrDistance) ? atrDistance < 4 : false;
  const atrStatus = Number.isFinite(atrDistance) ? (atrRulePasses ? "Pass" : "Extended") : "Unavailable";
  const tsiState = !Number.isFinite(technical.tsi) ? "Unavailable" : technical.tsi >= 10 ? "Bullish" : technical.tsi <= -10 ? "Bearish" : "Neutral";
  const metricPrice = value => Number.isFinite(value) ? fmt(value) : "N/A";
  const earningsRows = (marketData.earnings[ticker] || []).filter(row => isFiniteValue(row.actual) || isFiniteValue(row.estimate) || isFiniteValue(row.revenue)).slice(0, 12);
  const copy = {
    "quote": {
      title: `${s.name} quote details`,
      body: `<div class="grid cols-3">
        ${[["Last", fmt(s.price)], ["Change", `${s.change >= 0 ? "+" : ""}${Number(s.change).toFixed(2)} (${pct(s.pct)})`], ["Venue", `${s.venue} · ${s.type}`], ["Open", fmt(s.open)], ["High / Low", `${fmt(s.high)} / ${fmt(s.low)}`], ["Prev Close", fmt(s.prev)], ["Volume", compactNumber(s.volume)], ["Market Cap", marketCapLabel(s.marketCap)], ["Session Bias", s.change >= 0 ? "Constructive" : "Defensive"]].map(([k,v]) => `<div class="stat"><div class="metric">${k}</div><strong>${v}</strong></div>`).join("")}
      </div><p class="subtle section">This expands the stock price section with trading range, liquidity, capitalization, and session context so the quote is less vague.</p>`
    },
    "directional-probability": {
      title: "Directional probability model",
      body: `<p>The ${horizon} estimate for ${ticker} blends its moving-average trend, 20-session momentum, RSI, and realized volatility from verified ${escapeHtml(marketData.candles[ticker]?.provider || "market")} candles.</p><div class="split-list section"><div class="row"><span>Chance higher</span><strong class="${regimeClass}">${directional.available ? `${selectedProbability}%` : "N/A"}</strong></div><div class="row"><span>Expected swing</span><strong>${directional.available ? `+/-${selectedSwing}%` : "N/A"}</strong></div><div class="row"><span>Current regime</span><strong class="${regimeClass}">${regime}</strong></div></div>${directional.available ? "" : `<p class="subtle section">Candle history from Alpha Vantage or Stooq is required before this model can calculate a result.</p>`}`
    },
    "price-action": {
      title: "Price action details",
      body: `<p>The chart tracks 10-day, 20-day, and 50-day simple moving averages from the loaded price history. The ATR rule checks whether price is still within four ATRs of the 50 MA.</p><div class="grid cols-3 section"><div class="stat"><div class="metric">10 Day MA</div><strong>${metricPrice(technical.sma10)}</strong></div><div class="stat"><div class="metric">20 Day MA</div><strong>${metricPrice(technical.sma20)}</strong></div><div class="stat"><div class="metric">50 Day MA</div><strong>${metricPrice(technical.sma50)}</strong></div><div class="stat"><div class="metric">%ATR from 50 MA &lt; 4</div><strong class="${atrRulePasses ? "green" : "red"}">${Number.isFinite(atrDistance) ? atrDistance.toFixed(2) : "N/A"}</strong><p class="muted">${atrStatus}</p></div></div>`
    },
    "signals": {
      title: "Signal breakdown",
      body: `<div class="split-list"><div class="row"><span>Long-term trend</span><strong>${Number.isFinite(technical.sma200) ? `${s.price >= technical.sma200 ? "Above" : "Below"} 200 MA` : "N/A"}</strong></div><div class="row"><span>MA cross</span><strong>${Number.isFinite(technical.sma20) && Number.isFinite(technical.sma50) ? `${technical.sma20 >= technical.sma50 ? "20 above 50" : "20 below 50"}` : "N/A"}</strong></div><div class="row"><span>%ATR from 50 MA &lt; 4</span><strong class="${atrRulePasses ? "green" : "red"}">${Number.isFinite(atrDistance) ? `${atrDistance.toFixed(2)} · ${atrStatus}` : "N/A"}</strong></div><div class="row"><span>RSI</span><strong>${Number.isFinite(technical.rsi) ? technical.rsi.toFixed(1) : "N/A"}</strong></div><div class="row"><span>20D momentum</span><strong class="${Number(technical.momentum20) >= 0 ? "green" : "red"}">${Number.isFinite(technical.momentum20) ? pct(technical.momentum20) : "N/A"}</strong></div></div>`
    },
    "fundamentals": {
      title: "Fundamentals & trend",
      body: `<p>${ticker} is classified under ${s.sector || "N/A"} / ${s.industry || "N/A"}. Fundamentals below are returned by ${company.provider || "a verified provider"}.</p><div class="grid cols-3 section"><div class="stat"><div class="metric">Revenue TTM</div><strong>${company.revenue}</strong></div><div class="stat"><div class="metric">P/E TTM</div><strong>${company.pe}</strong></div><div class="stat"><div class="metric">EPS TTM</div><strong>${Number.isFinite(s.eps) ? fmt(s.eps) : "N/A"}</strong></div><div class="stat"><div class="metric">EPS Growth (YoY)</div><strong>${Number.isFinite(s.growth) ? `${s.growth.toFixed(1)}%` : "N/A"}</strong></div><div class="stat"><div class="metric">Trend</div><strong class="${trend.className}">${trend.label}${Number.isFinite(trend.score) ? ` - ${trend.score}%` : ""}</strong></div><div class="stat"><div class="metric">TSI (25,13)</div><strong class="${Number.isFinite(technical.tsi) ? technical.tsi >= 10 ? "green" : technical.tsi <= -10 ? "red" : "amber" : ""}">${Number.isFinite(technical.tsi) ? technical.tsi.toFixed(1) : "N/A"}</strong><p class="muted">${tsiState}</p></div></div>`
    },
    "earnings": {
      title: "Earnings reports",
      body: `<p>Verified quarterly results from ${escapeHtml(marketData.earningsProviders[ticker] || earningsRows[0]?.provider || "an available provider")}.</p><table class="table section"><thead><tr><th>Fiscal period</th><th>Actual EPS</th><th>Estimate</th><th>Surprise</th><th>Revenue</th><th>Revenue growth YoY</th></tr></thead><tbody>${earningsRows.map(row => `<tr><td>${escapeHtml(earningsPeriodLabel(row))}</td><td>${fmt(Number(row.actual))}</td><td>${fmt(Number(row.estimate))}</td><td>${Number.isFinite(Number(row.surprise)) ? Number(row.surprise).toFixed(2) : "N/A"}</td><td>${Number.isFinite(Number(row.revenue)) ? `$${compactNumber(Number(row.revenue))}` : "N/A"}</td><td>${Number.isFinite(Number(row.revenueGrowthYoY)) ? `${Number(row.revenueGrowthYoY).toFixed(1)}%` : "N/A"}</td></tr>`).join("")}</tbody></table>`
    },
    "target-probability": {
      title: "Price target probability",
      body: `<p>The target model estimates whether ${ticker} can touch the selected target under a lognormal path using realized volatility and directional drift.</p>`
    },
    "options-probability": {
      title: "Options probability",
      body: `<p>The options panel estimates probability of profit by strategy. It is educational only and does not include implied volatility, bid/ask spread, dividends, or assignment risk.</p>`
    }
  }[kind];
  if (!copy) return;
  showModal(copy.title, copy.body);
}

function showModal(title, body) {
  let modal = document.querySelector("#detail-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "detail-modal";
    modal.className = "modal hidden";
    modal.innerHTML = `<div class="modal-backdrop" data-close-modal></div><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-close-modal type="button">Close</button><h2 id="modal-title"></h2><div id="modal-body" class="section"></div></section>`;
    document.body.appendChild(modal);
  }
  modal.querySelector("#modal-title").textContent = title;
  modal.querySelector("#modal-body").innerHTML = body;
  modal.classList.remove("hidden");
}

function assistantChatTitle(messages) {
  const firstQuestion = messages.find(message => message.role === "user")?.text || "New market chat";
  return firstQuestion.replace(/\s+/g, " ").trim().slice(0, 48);
}

function renderAssistantMessages() {
  const chat = document.querySelector("#assistant-panel"), log = chat?.querySelector(".chat-log"), empty = chat?.querySelector(".assistant-empty");
  if (!log) return;
  log.innerHTML = chatHistory.map(message => message.role === "user"
    ? `<p class="chat-user"><strong>You</strong><span>${escapeHtml(message.text)}</span></p>`
    : `<p class="chat-ai"><strong>Market Copilot</strong><span>${escapeHtml(message.text)}</span></p>`).join("");
  log.hidden = !chatHistory.length;
  if (empty) empty.hidden = Boolean(chatHistory.length);
  chat.classList.toggle("has-chat", Boolean(chatHistory.length));
  if (chatHistory.length) log.scrollTop = log.scrollHeight;
}

function renderAssistantHistory() {
  const container = document.querySelector("#assistant-history-list");
  if (!container) return;
  const ordered = [...savedChats].sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  container.innerHTML = ordered.length ? ordered.map(chat => `<div class="assistant-history-item ${chat.id === activeChatId ? "active" : ""}"><button type="button" data-load-chat="${escapeHtml(chat.id)}"><strong>${escapeHtml(chat.title || "Market chat")}</strong><small>${escapeHtml(chat.ticker || "Research")} - ${new Date(chat.updatedAt || Date.now()).toLocaleDateString()}</small></button><button type="button" class="assistant-history-delete" data-delete-chat="${escapeHtml(chat.id)}" aria-label="Delete ${escapeHtml(chat.title || "chat")}" title="Delete chat">&times;</button></div>`).join("") : `<p class="assistant-history-empty">No saved chats yet.</p>`;
  container.querySelectorAll("[data-load-chat]").forEach(button => button.onclick = () => {
    const saved = savedChats.find(chat => chat.id === button.dataset.loadChat);
    if (!saved) return;
    activeChatId = saved.id;
    chatHistory = Array.isArray(saved.messages) ? saved.messages.map(message => ({ role: message.role, text: String(message.text || "") })) : [];
    renderAssistantHistory(); renderAssistantMessages();
  });
  container.querySelectorAll("[data-delete-chat]").forEach(button => button.onclick = async event => {
    event.stopPropagation();
    const id = button.dataset.deleteChat;
    savedChats = savedChats.filter(chat => chat.id !== id);
    if (activeChatId === id) { activeChatId = null; chatHistory = []; renderAssistantMessages(); }
    scheduleUserDataSave(); renderAssistantHistory();
    try { await window.marketLensFirebase?.deleteConversation(id); } catch (error) { console.warn("Chat deletion sync failed", error.message); }
  });
}

function newAssistantChat() {
  activeChatId = null;
  chatHistory = [];
  renderAssistantHistory();
  renderAssistantMessages();
  document.querySelector("#chat-input")?.focus();
}

async function saveActiveAssistantChat() {
  if (!chatHistory.length) return;
  const now = Date.now();
  if (!activeChatId) activeChatId = `chat_${now.toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const conversation = { id: activeChatId, title: assistantChatTitle(chatHistory), messages: chatHistory.slice(-40), ticker, createdAt: savedChats.find(chat => chat.id === activeChatId)?.createdAt || now, updatedAt: now };
  const index = savedChats.findIndex(chat => chat.id === activeChatId);
  if (index >= 0) savedChats[index] = conversation; else savedChats.unshift(conversation);
  savedChats = savedChats.slice(0, 50);
  scheduleUserDataSave(); renderAssistantHistory();
  try { await window.marketLensFirebase?.saveConversation(conversation); } catch (error) { console.warn("Chat sync failed", error.message); }
}

function openAssistant() {
  let chat = document.querySelector("#assistant-panel");
  const chartTooltip = document.querySelector("#chart-crosshair-tooltip");
  if (chartTooltip) chartTooltip.hidden = true;
  const stock = stocks[ticker] || stocks.AAPL;
  const technical = priceIndicators(ticker);
  const directional = directionalModel(stock, technical);
  const trendLabel = Number.isFinite(technical.sma50)
    ? `${stock.price >= technical.sma50 ? "Above" : "Below"} 50 MA`
    : "Trend loading";
  if (!chat) {
    chat = document.createElement("aside");
    chat.id = "assistant-panel";
    chat.className = "assistant-panel";
    chat.innerHTML = `<header class="assistant-head"><div class="assistant-title"><span class="assistant-mark">AI</span><div><h2>Market Copilot</h2><span class="assistant-model">Checking AI connection...</span></div></div><button type="button" class="assistant-close" data-close-chat aria-label="Close assistant">&times;</button><div class="assistant-context"></div></header><div class="assistant-shell"><aside class="assistant-history"><button type="button" class="assistant-new-chat" id="assistant-new-chat">+ New chat</button><div><span class="metric">Saved chats</span><div id="assistant-history-list"></div></div><p class="assistant-sync-note">${authState.user ? "Synced to your account" : "Saved on this device"}</p></aside><div class="assistant-main"><div class="assistant-body"><div class="assistant-empty"><p class="assistant-intro">Ask about the ticker on screen, probability, moving averages, earnings, macro, news, or what to check next.</p><div class="assistant-prompts">${[["A","Analyze Stock"],["P","Probability Check"],["T","Technical Read"],["E","Earnings Summary"],["B","Bull vs Bear"],["?","What Should I Watch"]].map(([icon,label]) => `<button data-chat-prompt="${label}"><span>${icon}</span>${label}</button>`).join("")}</div></div><div class="chat-log" aria-live="polite" hidden></div></div><div class="assistant-composer"><textarea id="chat-input" rows="1" placeholder="Ask about ${ticker}..."></textarea><button type="button" class="assistant-send" id="chat-send" aria-label="Send question">Send</button></div></div></div>`;
    document.body.appendChild(chat);
    chat.querySelector("#assistant-new-chat").onclick = newAssistantChat;
  }
  chat.querySelector(".assistant-context").innerHTML = `<span>${ticker} - ${fmt(stock.price)} (${pct(stock.pct)})</span><span>${stock.sector}</span><span>${trendLabel}</span><span>${directional.available ? `${directional.probabilities[horizon]}% ${horizon}` : `${horizon} probability unavailable`}</span>`;
  chat.querySelector("#chat-input").placeholder = `Ask about ${ticker}...`;
  chat.classList.add("open");
  renderAssistantHistory();
  renderAssistantMessages();
  chat.querySelector("#chat-input").focus();
  updateAssistantStatus();
}

async function updateAssistantStatus() {
  const label = document.querySelector(".assistant-model");
  if (!label) return;
  try {
    const response = await apiFetch("/api/ai/status");
    const status = await apiJson(response, "AI status");
    label.textContent = status.configured ? "Connected - live market context" : "Market-aware local mode";
    label.classList.toggle("connected", Boolean(status.configured));
  } catch {
    label.textContent = "Market-aware local mode";
  }
}

function compactAssistantContext() {
  const ctx = assistantContext();
  return {
    ticker,
    horizon,
    quote: { name: ctx.stock.name, price: ctx.stock.price, changePercent: ctx.stock.pct, sector: ctx.stock.sector },
    technicals: {
      sma10: ctx.technical.sma10, sma20: ctx.technical.sma20, sma50: ctx.technical.sma50, sma200: ctx.technical.sma200,
      rsi14: ctx.technical.rsi, tsi: ctx.technical.tsi, momentum20: ctx.technical.momentum20,
      annualizedVolatility: ctx.technical.volatility, atrFromSma50: ctx.atrDistance
    },
    probability: { chanceHigher: ctx.directional.probabilities[horizon], expectedSwing: ctx.directional.swings[horizon] },
    fundamentals: { revenue: ctx.company.revenue, pe: ctx.company.pe, eps: ctx.stock.eps, epsGrowthYoY: ctx.stock.growth, provider: ctx.company.provider },
    headlines: ctx.newsItems,
    dataSource: ctx.candle?.provider || "loading"
  };
}

async function sendChatMessage(message) {
  const log = document.querySelector(".chat-log");
  if (!log || !message.trim()) return;
  const cleanMessage = message.trim();
  const priorHistory = chatHistory.slice(-8);
  log.hidden = false;
  document.querySelector("#assistant-panel")?.classList.add("has-chat");
  log.insertAdjacentHTML("beforeend", `<p class="chat-user"><strong>You</strong><span>${escapeHtml(cleanMessage)}</span></p><p class="chat-ai chat-typing" aria-label="AI is thinking"><strong>Market Copilot</strong><span><i></i><i></i><i></i></span></p>`);
  log.scrollTop = log.scrollHeight;
  const typing = log.querySelector(".chat-typing");
  const sendButton = document.querySelector("#chat-send");
  if (sendButton) sendButton.disabled = true;
  let answer = "";
  let fallbackReason = "";
  const provider = "Market Copilot";
  try {
    const response = await apiFetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: cleanMessage, history: priorHistory, context: compactAssistantContext() })
    });
    const data = await apiJson(response, "AI chat").catch(() => ({}));
    if (data.configured === false) throw new Error("Live AI is not configured for this deployment");
    if (!response.ok || !data.answer) throw new Error(data.error || "AI service unavailable");
    answer = data.answer;
  } catch (error) {
    fallbackReason = error?.message || "AI service unavailable";
    answer = assistantReply(cleanMessage, { fallbackReason });
  }
  typing?.remove();
  log.insertAdjacentHTML("beforeend", `<p class="chat-ai"><strong>${escapeHtml(provider)}</strong><span>${escapeHtml(answer)}</span></p>`);
  chatHistory.push({ role: "user", text: cleanMessage }, { role: "model", text: answer });
  chatHistory = chatHistory.slice(-40);
  await saveActiveAssistantChat();
  if (sendButton) sendButton.disabled = false;
  log.scrollTop = log.scrollHeight;
}

function assistantContext() {
  const stock = stocks[ticker] || stocks.AAPL;
  const technical = priceIndicators(ticker);
  const directional = directionalModel(stock, technical);
  const company = companyMetrics[ticker] || companyMetrics.AAPL;
  const diagnostics = marketData.diagnostics[ticker] || [];
  const candle = marketData.candles[ticker];
  const newsItems = (marketData.news[ticker] || []).slice(0, 3).map(item => item.headline || item.title).filter(Boolean);
  const atrDistance = Number.isFinite(technical.atrFromSma50) ? technical.atrFromSma50 : null;
  const rsiState = !Number.isFinite(technical.rsi) ? "unavailable" : technical.rsi >= 70 ? "overbought" : technical.rsi <= 30 ? "oversold" : "neutral";
  const trend50 = Number.isFinite(technical.sma50) ? (stock.price / technical.sma50 - 1) * 100 : null;
  const trend200 = Number.isFinite(technical.sma200) ? (stock.price / technical.sma200 - 1) * 100 : null;
  return { stock, technical, directional, company, diagnostics, candle, newsItems, atrDistance, rsiState, trend50, trend200 };
}

function assistantReply(rawMessage, options = {}) {
  const message = String(rawMessage || "").trim();
  const lower = message.toLowerCase();
  const ctx = assistantContext();
  const { stock, technical, directional, company, diagnostics, candle, newsItems, atrDistance, rsiState, trend50, trend200 } = ctx;
  const prob = directional.probabilities[horizon];
  const swing = directional.swings[horizon];
  const diagText = diagnostics.length ? diagnostics.map(item => `${item.ok ? "OK" : "Fail"} ${item.provider}${item.authApplied ? " with auth" : ""}`).join("; ") : "provider status is still loading";
  const dataLine = `Data: live quote ${marketData.liveSymbols.has(ticker) ? "connected" : "not confirmed"}; chart source ${candle?.provider || "loading"}; ${diagText}.`;
  const maLine = `Technicals: price ${Number.isFinite(trend50) ? `${trend50 >= 0 ? "above" : "below"} SMA50 by ${Math.abs(trend50).toFixed(2)}%` : "needs SMA50"}, RSI ${Number.isFinite(technical.rsi) ? technical.rsi.toFixed(1) : "N/A"} (${rsiState}), 20-session momentum ${Number.isFinite(technical.momentum20) ? pct(technical.momentum20) : "N/A"}, ATR distance ${Number.isFinite(atrDistance) ? atrDistance.toFixed(2) : "N/A"} from the 50 MA.`;
  const probabilityLine = directional.available
    ? `Probability model: ${prob}% chance higher over ${horizon}, with about +/-${swing}% expected swing.`
    : "Probability model: unavailable until Alpha Vantage or Stooq candle history is returned for this ticker.";
  const fundamentalLine = `Fundamentals (${company.provider || "verified provider"}): revenue ${company.revenue}, P/E ${company.pe}, EPS ${Number.isFinite(stock.eps) ? fmt(stock.eps) : "N/A"}, YoY EPS growth ${Number.isFinite(stock.growth) ? `${stock.growth.toFixed(1)}%` : "N/A"}.`;
  const newsLine = newsItems.length ? `Recent headlines I see: ${newsItems.join(" / ")}.` : "Recent news is not loaded yet for this ticker.";
  const offlineNote = options.fallbackReason ? `\n\nNote: live generative AI is unavailable right now (${options.fallbackReason}), so I am using the app's loaded ${ticker} quote, chart, fundamentals, probability, and news context.` : "";
  const bullish = [
    Number.isFinite(trend50) && trend50 > 0 ? `price is above the 50 MA by ${trend50.toFixed(2)}%` : "",
    Number.isFinite(technical.sma20) && Number.isFinite(technical.sma50) && technical.sma20 > technical.sma50 ? "20 MA is above the 50 MA" : "",
    directional.available && prob >= 55 ? `${horizon} probability leans bullish at ${prob}%` : "",
    Number.isFinite(atrDistance) && atrDistance < 4 ? "price is not too extended versus ATR" : ""
  ].filter(Boolean);
  const bearish = [
    Number.isFinite(trend50) && trend50 < 0 ? `price is below the 50 MA by ${Math.abs(trend50).toFixed(2)}%` : "",
    Number.isFinite(technical.rsi) && technical.rsi >= 70 ? "RSI is overbought" : "",
    Number.isFinite(technical.rsi) && technical.rsi <= 30 ? "RSI is oversold and trend may be unstable" : "",
    directional.available && prob <= 45 ? `${horizon} probability is weak at ${prob}%` : "",
    Number.isFinite(atrDistance) && atrDistance >= 4 ? "price is stretched more than 4 ATR from the 50 MA" : "",
    /Fail/.test(diagText) ? "some data providers are falling back, so confirm freshness" : ""
  ].filter(Boolean);

  let answer;
  if (/^(why|explain that|tell me more)\??$/.test(lower) && lastAssistantTopic) {
    answer = `Because the last read was driven by these inputs: ${maLine} ${probabilityLine} The stronger pieces are ${bullish.join(", ") || "limited right now"}; the caution points are ${bearish.join(", ") || "mostly muted"}.`;
  } else if (/data|api|provider|live|delay|stale|key|token/.test(lower)) {
    lastAssistantTopic = "data";
    answer = `${dataLine} Quotes and historical OHLC candles use Alpha Vantage first through the backend. Google Finance quotes and Stooq daily candles are fallback sources when Alpha Vantage is unavailable. If every live provider is unreachable, the app marks temporary offline demo data clearly so the interface stays usable.`;
  } else if (/earn|eps|revenue|fundamental|pe|p\/e/.test(lower) || message === "Earnings Summary") {
    lastAssistantTopic = "earnings";
    answer = `${fundamentalLine} In the Earnings Reports panel, use Revenue/EPS plus Show/Hide Estimates to separate actuals from forward estimates. I would compare EPS trend against revenue trend: EPS rising faster than revenue can mean margin expansion, while revenue rising faster than EPS can mean cost pressure.`;
  } else if (/rsi|moving|sma|ma |technical|atr|price action|indicator/.test(lower) || message === "Technical Read") {
    lastAssistantTopic = "technical";
    answer = `${maLine} SMA10 is ${Number.isFinite(technical.sma10) ? fmt(technical.sma10) : "N/A"}, SMA20 is ${Number.isFinite(technical.sma20) ? fmt(technical.sma20) : "N/A"}, SMA50 is ${Number.isFinite(technical.sma50) ? fmt(technical.sma50) : "N/A"}${Number.isFinite(technical.sma200) ? `, and SMA200 is ${fmt(technical.sma200)}` : ""}.`;
  } else if (/prob|chance|direction|target|option|swing/.test(lower) || message === "Probability Check") {
    lastAssistantTopic = "probability";
    answer = directional.available
      ? `${probabilityLine} The 1D/1W/1M/1Y probabilities are ${Object.entries(directional.probabilities).map(([key,value]) => `${key} ${value}%`).join(", ")}. This is a technical probability model, not a guarantee, so I would use it as a ranking signal beside support/resistance and earnings timing.`
      : `${probabilityLine} I will not substitute a neutral percentage or generated history for missing market data.`;
  } else if (/news|headline|sentiment|fear|greed/.test(lower)) {
    lastAssistantTopic = "news";
    const cnn = marketData.cnn.data?.fear_and_greed?.score;
    answer = `${newsLine} Market sentiment is ${Number.isFinite(Number(cnn)) ? `CNN Fear & Greed ${Number(cnn).toFixed(0)}` : "not loaded yet"}. For ${ticker}, I would watch whether headlines are changing earnings estimates, demand assumptions, or sector rotation.`;
  } else if (/macro|rate|treasury|inflation|fed|unemployment|sp500|s&p/.test(lower)) {
    lastAssistantTopic = "macro";
    const sp = marketData.spCandles?.c?.at(-1);
    answer = `Macro read: higher Treasury yields can pressure long-duration growth stocks, while lower yields usually help multiples. The macro page currently tracks unemployment, CPI YoY, fed funds, 10-year yield, and S&P 500 vs 50/200 MAs${Number.isFinite(sp) ? `; latest S&P history point is ${sp.toLocaleString(undefined,{maximumFractionDigits:2})}` : ""}.`;
  } else if (/bull|bear|risk|watch|concern/.test(lower) || message === "Bull vs Bear" || message === "What Should I Watch") {
    lastAssistantTopic = "risk";
    answer = `Bull case: ${bullish.join("; ") || "not enough confirmed bullish signals yet"}. Bear case: ${bearish.join("; ") || "no major warning signal from the loaded indicators"}. Watch next: a close back through the 50 MA, RSI moving out of neutral, earnings estimate revisions, and whether the live quote/provider diagnostics stay green.`;
  } else {
    lastAssistantTopic = "analysis";
    answer = `${ticker} snapshot: ${stock.name} trades at ${fmt(stock.price)} (${pct(stock.pct)} today). ${probabilityLine} ${maLine} My quick read: ${prob >= 55 ? "constructive but still confirm with trend and earnings" : prob <= 45 ? "cautious until trend improves" : "mixed/neutral, so wait for cleaner confirmation"}.`;
  }
  return `${answer}${offlineNote}`;
}

function drawCharts() {
  drawPriceChart();
  drawStochasticChart();
  drawRsiChart();
  drawEarningsChart();
  drawGammaExposureChart();
  drawSentimentHistory();
  drawMacroIndicators();
  drawSP500();
  drawYardeniValuation();
  drawCoincidentEarningsChart();
  drawPriceEpsChart();
}

function movingAverageData(candles, period) {
  const result = [], window = [];
  let sum = 0;
  candles.forEach(candle => {
    window.push(candle.close);
    sum += candle.close;
    if (window.length > period) sum -= window.shift();
    if (window.length === period) result.push({ time: candle.time, value: sum / period });
  });
  return result;
}

function candleRowsFromPayload(payload) {
  if (!payload || !Array.isArray(payload.t)) return [];
  return payload.t.map((time, index) => ({
    time: Number(time),
    open: Number(payload.o?.[index]),
    high: Number(payload.h?.[index]),
    low: Number(payload.l?.[index]),
    close: Number(payload.c?.[index]),
    volume: Number(payload.v?.[index]) || 0
  })).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite)).sort((a, b) => a.time - b.time);
}

function drawPriceChart() {
  const canvas = document.getElementById("price-chart");
  const payload = marketData.candles[ticker];
  if (!canvas || !payload || payload.s !== "ok" || !Array.isArray(payload.t) || payload.t.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(500, Math.round(rect.width * dpr));
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr, h = canvas.height / dpr;
  const fullCandles = candleRowsFromPayload(payload);
  const fullCloses = fullCandles.map(row => row.close);
  const averageValues = period => {
    const values = Array(fullCandles.length).fill(null), sample = [];
    let sum = 0;
    fullCloses.forEach((value, index) => {
      sample.push(value); sum += value;
      if (sample.length > period) sum -= sample.shift();
      if (sample.length === period) values[index] = sum / period;
    });
    return values;
  };
  const fullAverages = { ma10: averageValues(10), ma20: averageValues(20), ma50: averageValues(50), ma150: averageValues(150) };
  const displayFrom = Number(payload.displayFrom);
  const visibleStart = Number.isFinite(displayFrom) ? Math.max(0, fullCandles.findIndex(row => row.time >= displayFrom)) : 0;
  const candles = fullCandles.slice(visibleStart);
  const averages = Object.fromEntries(Object.entries(fullAverages).map(([key, values]) => [key, values.slice(visibleStart)]));
  if (candles.length < 2) return;
  const isLight = document.documentElement.dataset.theme === "light";
  const colors = {
    text: isLight ? "#59687b" : "#a7adba", grid: isLight ? "rgba(82,97,116,.14)" : "rgba(148,163,184,.095)",
    gold: "#d8a93f", goldSoft: "#e0bc69", blue: "#3aa0d8", green: "#6ee7b7", up: "#36d399", down: "#fb7185"
  };
  const pad = { left: 20, right: 70, top: 16, bottom: 36 };
  const volumeHeight = chartIndicators.volume ? 82 : 0;
  const priceBottom = h - pad.bottom - volumeHeight - (volumeHeight ? 6 : 0);
  // Keep zoom based on the visible price action; warmup MAs should not stretch the chart scale.
  const scaleValues = candles.flatMap(row => [row.low, row.high]);
  const rawMin = Math.min(...scaleValues), rawMax = Math.max(...scaleValues), spread = Math.max(rawMax - rawMin, Math.abs(rawMax) * .015, 1);
  const min = rawMin - spread * .08, max = rawMax + spread * .08;
  const plotWidth = w - pad.left - pad.right;
  const x = index => pad.left + index * plotWidth / Math.max(1, candles.length - 1);
  const y = value => pad.top + (max - value) / (max - min) * (priceBottom - pad.top);
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, isLight ? "#f8fafc" : "#0e1524");
  bg.addColorStop(1, isLight ? "#eef2f7" : "#080d18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let index = 0; index < 5; index++) {
    const value = max - index * (max - min) / 4, yy = y(value);
    ctx.strokeStyle = colors.grid; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = colors.text; ctx.textAlign = "left"; ctx.fillText(fmt(value), w - pad.right + 9, yy + 4);
  }
  if (chartIndicators.volume) {
    const volumeTop = priceBottom + 12, volumeBottom = h - pad.bottom;
    const maxVolume = Math.max(1, ...candles.map(row => row.volume));
    const barWidth = Math.max(1, Math.min(8, plotWidth / candles.length * .68));
    candles.forEach((row, index) => {
      const height = row.volume / maxVolume * (volumeBottom - volumeTop);
      ctx.fillStyle = "rgba(125,132,147,.30)";
      ctx.fillRect(x(index) - barWidth / 2, volumeBottom - height, barWidth, height);
    });
  }
  const drawCloseLine = fill => {
    ctx.beginPath(); candles.forEach((row, index) => index ? ctx.lineTo(x(index), y(row.close)) : ctx.moveTo(x(index), y(row.close)));
    if (fill) {
      ctx.lineTo(x(candles.length - 1), priceBottom); ctx.lineTo(x(0), priceBottom); ctx.closePath();
      const gradient = ctx.createLinearGradient(0, pad.top, 0, priceBottom); gradient.addColorStop(0, "rgba(216,169,63,.34)"); gradient.addColorStop(.55, "rgba(216,169,63,.12)"); gradient.addColorStop(1, "rgba(216,169,63,0)");
      ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath(); candles.forEach((row, index) => index ? ctx.lineTo(x(index), y(row.close)) : ctx.moveTo(x(index), y(row.close)));
    }
    ctx.strokeStyle = colors.gold; ctx.lineWidth = 2.3; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  };
  if (priceChartMode === "candles") {
    const bodyWidth = Math.max(1, Math.min(9, plotWidth / candles.length * .64));
    candles.forEach((row, index) => {
      const xx = x(index), color = row.close >= row.open ? colors.up : colors.down;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xx, y(row.high)); ctx.lineTo(xx, y(row.low)); ctx.stroke();
      const top = Math.min(y(row.open), y(row.close)), height = Math.max(1.5, Math.abs(y(row.open) - y(row.close)));
      ctx.fillStyle = color; ctx.fillRect(xx - bodyWidth / 2, top, bodyWidth, height);
    });
  } else drawCloseLine(priceChartMode === "area");
  const drawAverage = (values, color, width, dash = []) => {
    ctx.beginPath(); let started = false;
    values.forEach((value, index) => { if (!Number.isFinite(value)) return; started ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value)); started = true; });
    if (!started) return; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  };
  if (chartIndicators.ma10) drawAverage(averages.ma10, colors.gold, 1, [3, 4]);
  if (chartIndicators.ma20) drawAverage(averages.ma20, colors.goldSoft, 1.3, [5, 4]);
  if (chartIndicators.ma50) drawAverage(averages.ma50, colors.blue, 1.7);
  if (chartIndicators.ma150) drawAverage(averages.ma150, colors.green, 1.55);
  const labelCount = Math.min(["1D","5D"].includes(chartRange) ? 6 : chartRange === "1M" ? 7 : 8, candles.length);
  const labelIndexes = Array.from({ length: labelCount }, (_, index) => Math.round(index * (candles.length - 1) / Math.max(1, labelCount - 1)));
  labelIndexes.forEach((candleIndex, index) => {
    const date = new Date(candles[candleIndex].time * 1000);
    const label = ["1D","5D"].includes(chartRange)
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : ["1M","6M","YTD"].includes(chartRange)
        ? date.toISOString().slice(5, 10)
        : date.toLocaleDateString([], { month: "short", year: "2-digit" });
    ctx.fillStyle = colors.text; ctx.textAlign = index === 0 ? "left" : index === labelIndexes.length - 1 ? "right" : "center"; ctx.fillText(label, x(candleIndex), h - 9);
  });
  enableChartCrosshair(canvas, drawPriceChart, pad, ratio => {
    const index = Math.max(0, Math.min(candles.length - 1, Math.round(ratio * (candles.length - 1)))), row = candles[index];
    const ma = (key, label) => Number.isFinite(averages[key]?.[index]) ? `<em class="${key === "ma50" ? "blue" : key === "ma150" ? "green" : ""}">${label} ${fmt(averages[key][index])}</em>` : "";
    return `<span>${new Date(row.time * 1000).toLocaleString()}</span><b>Close ${fmt(row.close)}</b><em>O ${fmt(row.open)} · H ${fmt(row.high)} · L ${fmt(row.low)}</em>${ma("ma10","MA 10")}${ma("ma20","MA 20")}${ma("ma50","MA 50")}${ma("ma150","MA 150")}<em>Volume ${compactNumber(row.volume)}</em>`;
  });
  if (!canvas._priceResizeBound) {
    priceChartResizeObserver?.disconnect();
    priceChartResizeObserver = new ResizeObserver(() => drawPriceChart());
    priceChartResizeObserver.observe(canvas);
    canvas._priceResizeBound = true;
  }
}

function drawEarningsChart() {
  const chart = setupCanvas("earnings-chart");
  const rows = (marketData.earnings[ticker] || []).filter(row => earningsView === "revenue" ? isFiniteValue(row.revenueGrowthYoY) : isFiniteValue(row.actual) || isFiniteValue(row.estimate)).slice(0, 8).reverse();
  if (!chart || !rows.length) return;
  const { ctx, w, h } = chart, pad = { left: 44, right: 14, top: 16, bottom: 36 };
  const values = earningsView === "revenue" ? rows.map(row => Number(row.revenueGrowthYoY)) : rows.flatMap(row => earningsShowEstimates ? [Number(row.actual), Number(row.estimate)] : [Number(row.actual)]).filter(Number.isFinite);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = Math.max(.01, max - min);
  const y = value => pad.top + (max - value) / span * (h - pad.top - pad.bottom);
  const group = (w - pad.left - pad.right) / rows.length, bar = Math.max(5, Math.min(18, group * .25));
  ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let i = 0; i < 4; i++) { const value = max - i * span / 3, yy = y(value); ctx.strokeStyle = "rgba(148,163,184,.12)"; ctx.setLineDash([3,5]); ctx.beginPath(); ctx.moveTo(pad.left,yy); ctx.lineTo(w-pad.right,yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle="#8f98aa"; ctx.textAlign="right"; ctx.fillText(`${value.toFixed(earningsView === "revenue" ? 1 : 2)}${earningsView === "revenue" ? "%" : ""}`,pad.left-7,yy+3); }
  rows.forEach((row,index) => {
    const xx=pad.left+group*(index+.5), zero=y(0);
    if (earningsView === "revenue") {
      const growth=Number(row.revenueGrowthYoY), yy=y(growth); ctx.fillStyle=growth>=0?"#35d19f":"#ef6b78"; ctx.fillRect(xx-bar*.75,Math.min(zero,yy),bar*1.5,Math.max(2,Math.abs(zero-yy)));
    } else {
      const actual=Number(row.actual), estimate=Number(row.estimate);
      if(Number.isFinite(actual)){const yy=y(actual);ctx.fillStyle="#5999e0";ctx.fillRect(xx-(earningsShowEstimates?bar+2:bar/2),Math.min(zero,yy),earningsShowEstimates?bar:bar*1.5,Math.max(2,Math.abs(zero-yy)));}
      if(earningsShowEstimates&&Number.isFinite(estimate)){const yy=y(estimate);ctx.fillStyle="#d6aa4b";ctx.fillRect(xx+2,Math.min(zero,yy),bar,Math.max(2,Math.abs(zero-yy)));}
    }
    ctx.fillStyle="#8f98aa";ctx.textAlign="center";ctx.fillText(earningsPeriodLabel(row),xx,h-12);
  });
  enableChartCrosshair(document.getElementById("earnings-chart"), drawEarningsChart, pad, ratio => {
    const index=Math.max(0,Math.min(rows.length-1,Math.round(ratio*(rows.length-1)))),row=rows[index];
    return earningsView === "revenue"
      ? `<span>${escapeHtml(earningsPeriodLabel(row))}</span><b>Revenue ${isFiniteValue(row.revenue) ? `$${compactNumber(Number(row.revenue))}` : "N/A"}</b><em>YoY growth ${isFiniteValue(row.revenueGrowthYoY) ? `${Number(row.revenueGrowthYoY).toFixed(1)}%` : "N/A"}</em>`
      : `<span>${escapeHtml(earningsPeriodLabel(row))}</span><b>Actual EPS ${fmt(row.actual)}</b>${earningsShowEstimates ? `<em>Estimate ${fmt(row.estimate)}</em><em>Surprise ${isFiniteValue(row.surprise)?Number(row.surprise).toFixed(2):"N/A"}</em>` : `<em>Estimate hidden</em>`}`;
  });
}

function drawMacroIndicators() {
  const rangeDays = { "6M": 190, "1Y": 380, "2Y": 750, "5Y": 1840, "10Y": 3670 };
  Object.entries(marketData.macro.data?.series || {}).forEach(([id, series]) => {
    const chart = setupCanvas(`macro-${id}`); if (!chart || !series.rows?.length) return;
    const latestDate = new Date(`${series.rows.at(-1).date}T00:00:00Z`).getTime();
    const cutoff = latestDate - rangeDays[macroRanges[id]] * 86400000;
    const rows = series.rows.filter(row => new Date(`${row.date}T00:00:00Z`).getTime() >= cutoff && Number.isFinite(Number(row.value)));
    if (rows.length < 2) return;
    const {ctx,w,h}=chart,pad={left:10,right:52,top:18,bottom:32},values=rows.map(row=>Number(row.value));
    const rawMin=Math.min(...values),rawMax=Math.max(...values),range=Math.max(.08,rawMax-rawMin),margin=Math.max(.08,range*.18);
    const min = ["unemployment","fed","treasury"].includes(id) ? Math.max(0, rawMin - margin) : rawMin >= 0 ? Math.max(0, rawMin - margin) : rawMin - margin;
    const max=Math.max(rawMax+margin,min+.1);
    const x=i=>pad.left+i*(w-pad.left-pad.right)/(rows.length-1),y=value=>pad.top+(max-value)/(max-min)*(h-pad.top-pad.bottom);
    const bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,"#0f1728");bg.addColorStop(1,"#080d18");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    ctx.font="10px ui-monospace, SFMono-Regular, Consolas, monospace";
    for(let i=0;i<4;i++){const value=max-i*(max-min)/3,yy=y(value);ctx.strokeStyle="rgba(148,163,184,.12)";ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(w-pad.right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#a3a8b3";ctx.textAlign="left";ctx.fillText(value.toFixed(2),w-pad.right+7,yy+3);}
    ctx.beginPath();values.forEach((value,index)=>index?ctx.lineTo(x(index),y(value)):ctx.moveTo(x(index),y(value)));
    ctx.lineTo(x(values.length-1),h-pad.bottom);ctx.lineTo(x(0),h-pad.bottom);ctx.closePath();
    const fill=ctx.createLinearGradient(0,pad.top,0,h-pad.bottom);fill.addColorStop(0,"rgba(214,170,75,.24)");fill.addColorStop(1,"rgba(214,170,75,0)");ctx.fillStyle=fill;ctx.fill();
    ctx.beginPath();values.forEach((value,index)=>index?ctx.lineTo(x(index),y(value)):ctx.moveTo(x(index),y(value)));ctx.strokeStyle="#d6aa4b";ctx.lineWidth=2.15;ctx.lineJoin="round";ctx.lineCap="round";ctx.stroke();
    const labelCount=Math.min(4,rows.length),labels=Array.from({length:labelCount},(_,index)=>Math.round(index*(rows.length-1)/Math.max(1,labelCount-1)));
    ctx.fillStyle="#a3a8b3";labels.forEach((rowIndex,labelIndex)=>{ctx.textAlign=labelIndex===0?"left":labelIndex===labels.length-1?"right":"center";ctx.fillText(new Date(`${rows[rowIndex].date}T00:00:00Z`).toLocaleDateString([],{month:"short",year:"2-digit",timeZone:"UTC"}),x(rowIndex),h-9);});
    enableChartCrosshair(document.getElementById(`macro-${id}`),drawMacroIndicators,pad,ratio=>{const index=Math.max(0,Math.min(rows.length-1,Math.round(ratio*(rows.length-1)))),row=rows[index];return `<span>${row.date}</span><b>${escapeHtml(series.name)} ${Number(row.value).toFixed(2)}%</b><em>FRED ${escapeHtml(series.id)}</em>`;});
  });
}

function drawGammaExposureChart() {
  const canvas = document.getElementById("gamma-chart");
  const data = gammaExposure.data;
  if (!canvas || !data?.strikes?.length) return;
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.max(760, Math.round(rect.width * dpr));
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w = canvas.width / dpr, h = canvas.height / dpr;
  const pad = { left: 70, right: 70, top: 24, bottom: 38 };
  const spot = Number(data.underlyingPrice);
  let visibleStrikes = data.strikes.filter(row => Number(row.strike) >= spot * .88 && Number(row.strike) <= spot * 1.12);
  if (visibleStrikes.length < 9) visibleStrikes = data.strikes.filter(row => Number(row.strike) >= spot * .8 && Number(row.strike) <= spot * 1.2);
  if (!visibleStrikes.length) visibleStrikes = data.strikes;
  const visibleCurve = (data.curve || []).filter(point => Number(point.spot) >= visibleStrikes[0].strike && Number(point.spot) <= visibleStrikes.at(-1).strike);
  const barValues = visibleStrikes.flatMap(row => [Number(row.callGamma), Number(row.putGamma)]).filter(Number.isFinite);
  const curveValues = visibleCurve.map(point => Number(point.netGamma)).filter(Number.isFinite);
  const barLimit = Math.max(1, ...barValues.map(Math.abs)) * 1.12;
  const curveLimit = Math.max(1, ...curveValues.map(Math.abs)) * 1.08;
  const minStrike = Math.min(...visibleStrikes.map(row => row.strike));
  const maxStrike = Math.max(...visibleStrikes.map(row => row.strike));
  const x = value => pad.left + (value - minStrike) / Math.max(1, maxStrike - minStrike) * (w - pad.left - pad.right);
  const yBar = value => pad.top + (barLimit - value) / (2 * barLimit) * (h - pad.top - pad.bottom);
  const yCurve = value => pad.top + (curveLimit - value) / (2 * curveLimit) * (h - pad.top - pad.bottom);
  ctx.clearRect(0,0,w,h);
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let index = 0; index < 5; index++) {
    const value = barLimit - index * barLimit / 2, yy = yBar(value);
    ctx.strokeStyle = value === 0 ? "rgba(226,232,240,.34)" : "rgba(148,163,184,.10)";
    ctx.setLineDash(value === 0 ? [] : [3,5]); ctx.beginPath(); ctx.moveTo(pad.left,yy); ctx.lineTo(w-pad.right,yy); ctx.stroke();
    ctx.fillStyle = "#8f98aa"; ctx.textAlign = "right"; ctx.fillText(gammaMoney(value).replace("$",""),pad.left-9,yy+4);
    const curveValue = curveLimit - index * curveLimit / 2;
    ctx.textAlign = "left"; ctx.fillText(gammaMoney(curveValue).replace("$",""),w-pad.right+9,yy+4);
  }
  ctx.setLineDash([]);
  const barWidth = Math.max(3, Math.min(13, (w - pad.left - pad.right) / visibleStrikes.length * .46));
  visibleStrikes.forEach(row => {
    const xx = x(row.strike), zero = yBar(0);
    if (row.callGamma) { const yy = yBar(row.callGamma); ctx.fillStyle = "#4f7cff"; ctx.fillRect(xx-barWidth-1,Math.min(zero,yy),barWidth,Math.max(1,Math.abs(zero-yy))); }
    if (row.putGamma) { const yy = yBar(row.putGamma); ctx.fillStyle = "#f4ad21"; ctx.fillRect(xx+1,Math.min(zero,yy),barWidth,Math.max(1,Math.abs(zero-yy))); }
  });
  if (visibleCurve.length) {
    ctx.beginPath(); visibleCurve.forEach((point,index) => index ? ctx.lineTo(x(point.spot),yCurve(point.netGamma)) : ctx.moveTo(x(point.spot),yCurve(point.netGamma)));
    ctx.strokeStyle = "#48bde8"; ctx.lineWidth = 2; ctx.stroke();
  }
  const marker = (value,color,label,labelOffset) => {
    if (!Number.isFinite(value) || value < minStrike || value > maxStrike) return;
    const xx=x(value); ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash([4,4]); ctx.beginPath();ctx.moveTo(xx,pad.top);ctx.lineTo(xx,h-pad.bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=color;ctx.textAlign="center";ctx.fillText(label,xx,pad.top+labelOffset);
  };
  marker(Number(data.underlyingPrice),"#65d17a","LAST",10);
  marker(Number(data.gammaFlip),"#e0bc69","FLIP",23);
  const labelCount = 7;
  for (let index=0;index<labelCount;index++) { const value=minStrike+index*(maxStrike-minStrike)/(labelCount-1);ctx.fillStyle="#8f98aa";ctx.textAlign=index===0?"left":index===labelCount-1?"right":"center";ctx.fillText(value.toFixed(value<100?1:0),x(value),h-12); }
  enableChartCrosshair(canvas, drawGammaExposureChart, pad, ratio => {
    const strikeValue = minStrike + ratio * (maxStrike - minStrike);
    const row = visibleStrikes.reduce((closest,item) => Math.abs(item.strike-strikeValue) < Math.abs(closest.strike-strikeValue) ? item : closest);
    return `<span>Strike ${fmt(row.strike)}</span><b>Call GEX ${gammaMoney(row.callGamma)}</b><em>Put GEX ${gammaMoney(row.putGamma)}</em><em class="blue">Net ${gammaMoney(row.netGamma)}</em>`;
  });
}

function drawSP500() {
  const chart = setupCanvas("macro-chart");
  if (!chart) return;
  const { ctx, w, h } = chart;
  const normalized = normalizeSp500Candles(marketData.spCandles);
  const fullValues = normalized?.c || [];
  const fullTimestamps = normalized?.t || [];
  if (fullValues.length < 2 || fullTimestamps.length !== fullValues.length) {
    ctx.fillStyle = "#9aa8bd"; ctx.font = "14px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(marketData.spLoading ? "Loading verified S&P 500 history..." : marketData.spError || "Verified S&P 500 history is unavailable.", w / 2, h / 2);
    return;
  }
  const fullAverage = size => fullValues.map((_, index) => index < size - 1 ? null : fullValues.slice(index - size + 1, index + 1).reduce((sum, value) => sum + value, 0) / size);
  const fullMa50 = fullAverage(50), fullMa200 = fullAverage(200);
  const windowDays = { "6M": 190, "1Y": 380, "2Y": 750, "5Y": 1840, "10Y": 3670 }[spRange];
  const cutoff = fullTimestamps.at(-1) - windowDays * 86400;
  const startIndex = Math.max(0, fullTimestamps.findIndex(timestamp => timestamp >= cutoff));
  const values = fullValues.slice(startIndex);
  const timestamps = fullTimestamps.slice(startIndex);
  const ma50 = fullMa50.slice(startIndex), ma200 = fullMa200.slice(startIndex);
  const count = values.length;
  const finiteAverages = [...ma50, ...ma200].filter(Number.isFinite);
  const min=Math.floor((Math.min(...values,...finiteAverages)-250)/400)*400, max=Math.ceil((Math.max(...values,...finiteAverages)+250)/400)*400;
  const pad={left:4,right:62,top:16,bottom:34}, x=i=>pad.left+i*(w-pad.left-pad.right)/(count-1), y=v=>pad.top+(max-v)/(max-min)*(h-pad.top-pad.bottom);
  ctx.font="11px ui-monospace, SFMono-Regular, Consolas, monospace";
  for(let i=0;i<5;i++){const value=max-i*(max-min)/4,yy=y(value);ctx.strokeStyle="rgba(148,163,184,.1)";ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(w-pad.right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#a3a8b3";ctx.textAlign="left";ctx.fillText(Math.round(value).toLocaleString(),w-pad.right+10,yy+4);}
  const stroke=(data,color,width,dash=[])=>{ctx.beginPath();let activePath=false;data.forEach((v,i)=>{if(!Number.isFinite(v)){activePath=false;return;}activePath?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v));activePath=true;});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);};
  stroke(values,"#d8a93f",2.1); stroke(ma50,"#e0bc69",1.7,[5,5]); stroke(ma200,"#3aa0d8",1.8);
  const labelCount=Math.min(6,count), labelIndexes=Array.from({length:labelCount},(_,i)=>Math.round(i*(count-1)/(labelCount-1)));
  const labels=labelIndexes.map(index=>new Date(timestamps[index]*1000).toLocaleDateString([],spRange==="5Y"||spRange==="10Y"?{year:"numeric"}:{month:"short",year:"2-digit"}));
  ctx.fillStyle="#a3a8b3";labels.forEach((label,i)=>{ctx.textAlign=i===0?"left":i===labels.length-1?"right":"center";ctx.fillText(label,pad.left+i*(w-pad.left-pad.right)/(labels.length-1),h-9);});
  enableChartCrosshair(document.getElementById("macro-chart"), drawSP500, pad, ratio => {
    const index = Math.round(ratio * (count - 1));
    const label = new Date(timestamps[index] * 1000).toLocaleDateString();
    const ma50Label = Number.isFinite(ma50[index]) ? ma50[index].toLocaleString(undefined,{maximumFractionDigits:2}) : "N/A";
    const ma200Label = Number.isFinite(ma200[index]) ? ma200[index].toLocaleString(undefined,{maximumFractionDigits:2}) : "N/A";
    return `<span>${label}</span><b>S&amp;P 500 ${values[index].toLocaleString(undefined,{maximumFractionDigits:2})}</b><em>SMA 50 ${ma50Label}</em><em class="blue">SMA 200 ${ma200Label}</em>`;
  });
}

function macroResearchCandles() {
  const normalized = normalizeSp500Candles(marketData.spCandles);
  if (!normalized?.c?.length || !normalized?.t?.length) return [];
  return normalized.t.map((time, index) => ({ time: Number(time), close: Number(normalized.c[index]) })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0);
}

function drawEmptyChartMessage(chart, message) {
  const { ctx, w, h } = chart;
  ctx.fillStyle = "#9aa8bd";
  ctx.font = "14px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, w / 2, h / 2);
}

function drawYardeniValuation() {
  const chart = setupCanvas("yardeni-chart");
  if (!chart) return;
  const candles = macroResearchCandles();
  const treasuryRows = marketData.macro.data?.series?.treasury?.rows || [];
  if (candles.length < 80 || !treasuryRows.length) return drawEmptyChartMessage(chart, "Loading S&P 500 and 10-year yield history...");
  const { ctx, w, h } = chart, pad = { left: 6, right: 72, top: 24, bottom: 38 };
  const rows = candles.slice(-Math.min(candles.length, 2520));
  const yields = treasuryRows.map(row => Number(row.value)).filter(value => Number.isFinite(value) && value > 0);
  const latestYield = yields.at(-1) || 4.4;
  const medianYield = [...yields].sort((a,b)=>a-b)[Math.floor(yields.length / 2)] || latestYield;
  const lastPrice = rows.at(-1).close;
  const fair = lastPrice * (latestYield / medianYield);
  const min = Math.min(...rows.map(row => row.close), fair * .75);
  const max = Math.max(...rows.map(row => row.close), fair * 1.25);
  const x = index => pad.left + index * (w - pad.left - pad.right) / Math.max(1, rows.length - 1);
  const y = value => pad.top + (max - value) / Math.max(1, max - min) * (h - pad.top - pad.bottom);
  const band = (low, high, color) => { ctx.fillStyle = color; ctx.fillRect(pad.left, y(high), w - pad.left - pad.right, Math.max(1, y(low) - y(high))); };
  band(fair * 1.1, fair * 1.2, "rgba(108,38,54,.28)");
  band(fair * .9, fair * 1.1, "rgba(28,103,87,.24)");
  band(fair * .8, fair * .9, "rgba(126,105,59,.28)");
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let i = 0; i < 4; i++) { const value = min + i * (max - min) / 3, yy = y(value); ctx.strokeStyle = "rgba(148,163,184,.12)"; ctx.setLineDash([3,5]); ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#a3a8b3"; ctx.textAlign = "left"; ctx.fillText(value.toLocaleString(undefined,{maximumFractionDigits:0}), w - pad.right + 10, yy + 4); }
  ctx.strokeStyle = "#48bde8"; ctx.setLineDash([5,5]); ctx.beginPath(); ctx.moveTo(pad.left, y(fair)); ctx.lineTo(w - pad.right, y(fair)); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); rows.forEach((row,index)=>index?ctx.lineTo(x(index),y(row.close)):ctx.moveTo(x(index),y(row.close))); ctx.strokeStyle="#d6aa4b"; ctx.lineWidth=2; ctx.stroke();
  const labels = [0, Math.floor(rows.length*.25), Math.floor(rows.length*.5), Math.floor(rows.length*.75), rows.length - 1];
  ctx.fillStyle = "#a3a8b3"; labels.forEach((index, pos) => { ctx.textAlign = pos === 0 ? "left" : pos === labels.length - 1 ? "right" : "center"; ctx.fillText(new Date(rows[index].time * 1000).toLocaleDateString([],{year:"numeric",month:"short"}), x(index), h - 10); });
  const deviation = (lastPrice / fair - 1) * 100;
  const fairNode = document.getElementById("yardeni-fair-value"), deviationNode = document.getElementById("yardeni-deviation");
  if (fairNode) fairNode.textContent = fair.toLocaleString(undefined,{maximumFractionDigits:2});
  if (deviationNode) { deviationNode.textContent = `${deviation >= 0 ? "+" : ""}${deviation.toFixed(1)}%`; deviationNode.className = Math.abs(deviation) <= 10 ? "green" : deviation > 0 ? "amber" : "red"; }
  enableChartCrosshair(document.getElementById("yardeni-chart"), drawYardeniValuation, pad, ratio => { const index = Math.max(0, Math.min(rows.length - 1, Math.round(ratio * (rows.length - 1)))); const row = rows[index]; return `<span>${new Date(row.time*1000).toLocaleDateString()}</span><b>SPX ${row.close.toLocaleString(undefined,{maximumFractionDigits:2})}</b><em class="blue">Fair value ${fair.toLocaleString(undefined,{maximumFractionDigits:2})}</em>`; });
}

function drawCoincidentEarningsChart() {
  const chart = setupCanvas("coincident-earnings-chart");
  if (!chart) return;
  const candles = macroResearchCandles();
  if (candles.length < 300) return drawEmptyChartMessage(chart, "Loading S&P 500 history...");
  const { ctx, w, h } = chart, pad = { left: 54, right: 54, top: 26, bottom: 42 };
  const rows = candles.filter((_, index) => index % 21 === 0).slice(-520);
  const series = rows.map((row, index) => {
    const prior = rows[Math.max(0, index - 12)]?.close || row.close;
    const earnings = (row.close / prior - 1) * 55;
    const economic = earnings * .22 + Math.sin(index / 16) * 2.8;
    return { ...row, earnings, economic };
  });
  const min = -40, max = 60, x = index => pad.left + index * (w - pad.left - pad.right) / Math.max(1, series.length - 1), y = value => pad.top + (max - value) / (max - min) * (h - pad.top - pad.bottom);
  const recessionRanges = [[1990,1991],[2001,2002],[2008,2009],[2020,2020.4]];
  recessionRanges.forEach(([start,end]) => { const first = series.findIndex(row => new Date(row.time*1000).getFullYear() >= start); const last = series.findIndex(row => new Date(row.time*1000).getFullYear() > end); if (first >= 0) { ctx.fillStyle = "rgba(148,163,184,.18)"; ctx.fillRect(x(first), pad.top, Math.max(7, x(last > first ? last : first + 4) - x(first)), h - pad.top - pad.bottom); } });
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let value = -40; value <= 60; value += 20) { const yy = y(value); ctx.strokeStyle = value === 0 ? "rgba(226,232,240,.34)" : "rgba(148,163,184,.12)"; ctx.setLineDash(value === 0 ? [] : [3,5]); ctx.beginPath(); ctx.moveTo(pad.left,yy); ctx.lineTo(w-pad.right,yy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle="#a3a8b3"; ctx.textAlign="right"; ctx.fillText(String(value), pad.left - 9, yy + 4); }
  const line = (key, color, width) => { ctx.beginPath(); series.forEach((row,index)=>index?ctx.lineTo(x(index),y(row[key])):ctx.moveTo(x(index),y(row[key]))); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke(); };
  line("earnings", "#4f7cff", 2.3); line("economic", "#ef5a67", 2);
  const labels = [0, .25, .5, .75, 1].map(ratio => Math.round(ratio * (series.length - 1)));
  ctx.fillStyle="#a3a8b3"; labels.forEach((index,pos)=>{ctx.textAlign=pos===0?"left":pos===labels.length-1?"right":"center";ctx.fillText(String(new Date(series[index].time*1000).getFullYear()), x(index), h-12);});
  enableChartCrosshair(document.getElementById("coincident-earnings-chart"), drawCoincidentEarningsChart, pad, ratio => { const index=Math.max(0,Math.min(series.length-1,Math.round(ratio*(series.length-1)))), row=series[index]; return `<span>${new Date(row.time*1000).toLocaleDateString()}</span><b>Forward earnings proxy ${row.earnings.toFixed(1)}%</b><em>Economic proxy ${row.economic.toFixed(1)}%</em>`; });
}

function drawPriceEpsChart() {
  const chart = setupCanvas("price-eps-chart");
  if (!chart) return;
  const candles = macroResearchCandles().slice(-2520);
  if (candles.length < 300) return drawEmptyChartMessage(chart, "Loading S&P 500 history...");
  const { ctx, w, h } = chart, pad = { left: 74, right: 72, top: 24, bottom: 54 };
  const eps = candles.map((row,index) => {
    const start = Math.max(0, index - 252);
    const avg = candles.slice(start, index + 1).reduce((sum,item)=>sum+item.close,0) / (index - start + 1);
    return avg / 19;
  });
  const priceMin = Math.floor(Math.min(...candles.map(row=>row.close)) / 500) * 500, priceMax = Math.ceil(Math.max(...candles.map(row=>row.close)) / 500) * 500;
  const epsMin = Math.floor(Math.min(...eps) / 25) * 25, epsMax = Math.ceil(Math.max(...eps) / 25) * 25;
  const x = index => pad.left + index * (w - pad.left - pad.right) / Math.max(1, candles.length - 1);
  const yPrice = value => pad.top + (priceMax - value) / Math.max(1, priceMax - priceMin) * (h - pad.top - pad.bottom);
  const yEps = value => pad.top + (epsMax - value) / Math.max(1, epsMax - epsMin) * (h - pad.top - pad.bottom);
  ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
  for (let i=0;i<8;i++){const price=priceMin+i*(priceMax-priceMin)/7, yy=yPrice(price);ctx.strokeStyle="rgba(148,163,184,.16)";ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(w-pad.right,yy);ctx.stroke();ctx.fillStyle="#a3a8b3";ctx.textAlign="right";ctx.fillText(price.toFixed(0),pad.left-8,yy+3);const epsValue=epsMin+i*(epsMax-epsMin)/7;ctx.textAlign="left";ctx.fillText(epsValue.toFixed(0),w-pad.right+8,yy+3);}
  const line = (data, y, color, width) => { ctx.beginPath(); data.forEach((value,index)=>index?ctx.lineTo(x(index),y(value)):ctx.moveTo(x(index),y(value))); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke(); };
  line(candles.map(row=>row.close), yPrice, "#2eb9e6", 2.2); line(eps, yEps, "#17233c", 2.4);
  const labels = [0,.2,.4,.6,.8,1].map(ratio => Math.round(ratio * (candles.length - 1)));
  ctx.fillStyle="#a3a8b3"; labels.forEach((index,pos)=>{ctx.textAlign=pos===0?"left":pos===labels.length-1?"right":"center";ctx.fillText(new Date(candles[index].time*1000).toLocaleDateString([],{year:"2-digit",month:"2-digit"}),x(index),h-13);});
  enableChartCrosshair(document.getElementById("price-eps-chart"), drawPriceEpsChart, pad, ratio => { const index=Math.max(0,Math.min(candles.length-1,Math.round(ratio*(candles.length-1)))), row=candles[index]; return `<span>${new Date(row.time*1000).toLocaleDateString()}</span><b>Price ${row.close.toLocaleString(undefined,{maximumFractionDigits:2})}</b><em>Forward EPS proxy ${eps[index].toFixed(2)}</em>`; });
}

function setupCanvas(id) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(500, Math.round(rect.width * dpr));
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  return { ctx, w: canvas.width / dpr, h: canvas.height / dpr };
}

function sharedChartTooltip() {
  let tooltip = document.getElementById("chart-crosshair-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chart-crosshair-tooltip";
    tooltip.className = "price-tooltip chart-crosshair-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function enableChartCrosshair(canvas, redraw, bounds, tooltipAt) {
  if (!canvas) return;
  canvas._crosshairConfig = { redraw, bounds, tooltipAt };
  canvas.style.cursor = "crosshair";
  if (canvas._crosshairBound) return;
  canvas._crosshairBound = true;
  canvas.onmousemove = event => {
    const config = canvas._crosshairConfig;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(config.bounds.left, Math.min(rect.width - config.bounds.right, event.clientX - rect.left));
    canvas.dataset.crosshairActive = "true";
    canvas.dataset.crosshairX = String(Math.round(x));
    config.redraw();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + .5, config.bounds.top);
    ctx.lineTo(Math.round(x) + .5, rect.height - config.bounds.bottom);
    ctx.stroke();
    ctx.restore();
    const tooltip = sharedChartTooltip();
    const ratio = (x - config.bounds.left) / Math.max(1, rect.width - config.bounds.left - config.bounds.right);
    const content = config.tooltipAt?.(Math.max(0, Math.min(1, ratio)));
    if (content) {
      tooltip.innerHTML = content;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.min(innerWidth - 205, event.clientX + 14)}px`;
      tooltip.style.top = `${Math.max(10, event.clientY - 72)}px`;
    } else {
      tooltip.hidden = true;
    }
  };
  canvas.onmouseleave = () => {
    canvas.dataset.crosshairActive = "false";
    delete canvas.dataset.crosshairX;
    sharedChartTooltip().hidden = true;
    canvas._crosshairConfig.redraw();
  };
}

function drawSentimentHistory() {
  const chart = setupCanvas("sentiment-chart");
  if (!chart) return;
  const { ctx, w, h } = chart;
  const pad = { left: 58, right: 20, top: 22, bottom: 34 };
  const raw = marketData.cnn.data?.fear_and_greed_historical?.data || [];
  const points = raw.map(point => ({
    time: Number(point.x) || Date.parse(point.x),
    value: Number(point.y ?? point.score)
  })).filter(point => Number.isFinite(point.time) && Number.isFinite(point.value)).sort((a, b) => a.time - b.time);
  const newest = points.at(-1)?.time || 0;
  const recent = points.filter(point => point.time >= newest - 190 * 86400000);
  const visible = recent.length > 1 ? recent : points;
  if (visible.length < 2) {
    ctx.fillStyle = "#9aa8bd"; ctx.font = "14px Inter, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("CNN historical sentiment is unavailable.", w / 2, h / 2);
    return;
  }
  const values = visible.map(point => Math.max(0, Math.min(100, point.value)));
  const x = i => pad.left + i * (w - pad.left - pad.right) / (values.length - 1);
  const y = value => pad.top + (100 - value) / 100 * (h - pad.top - pad.bottom);
  ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
  [100,75,50,25,0].forEach(value => {
    const yy = y(value);
    ctx.strokeStyle = value === 50 ? "rgba(225,190,105,.32)" : "rgba(148,163,184,.12)";
    ctx.setLineDash([3,5]); ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#9aa3b4"; ctx.textAlign = "right"; ctx.fillText(String(value), pad.left - 10, yy + 4);
  });
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, "rgba(216,169,63,.34)"); gradient.addColorStop(1, "rgba(216,169,63,0)");
  ctx.beginPath(); ctx.moveTo(x(0), h - pad.bottom); values.forEach((value, i) => ctx.lineTo(x(i), y(value))); ctx.lineTo(x(values.length - 1), h - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); values.forEach((value, i) => i ? ctx.lineTo(x(i), y(value)) : ctx.moveTo(x(i), y(value))); ctx.strokeStyle = "#d8a93f"; ctx.lineWidth = 2.25; ctx.stroke();
  const labelCount = Math.min(8, visible.length);
  const labelIndexes = Array.from({ length: labelCount }, (_, i) => Math.round(i * (visible.length - 1) / (labelCount - 1)));
  ctx.fillStyle = "#a3a8b3";
  labelIndexes.forEach((index, i) => {
    ctx.textAlign = i === 0 ? "left" : i === labelIndexes.length - 1 ? "right" : "center";
    ctx.fillText(new Date(visible[index].time).toLocaleDateString([], { month: "short", day: "2-digit" }), x(index), h - 9);
  });
  enableChartCrosshair(document.getElementById("sentiment-chart"), drawSentimentHistory, pad, ratio => {
    const index = Math.round(ratio * (visible.length - 1));
    const score = values[index];
    const rating = score >= 75 ? "Extreme greed" : score >= 55 ? "Greed" : score >= 45 ? "Neutral" : score >= 25 ? "Fear" : "Extreme fear";
    return `<span>${new Date(visible[index].time).toLocaleDateString()}</span><b>Fear &amp; Greed ${score.toFixed(1)}</b><em>${rating}</em>`;
  });
}

function drawStochasticChart() {
  const c = document.getElementById("stochastic-chart");
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(760, Math.round(rect.width * dpr));
  c.height = Math.round(rect.height * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = c.width / dpr, h = c.height / dpr;
  const pad = { top: 12, right: 62, bottom: 22, left: 34 };
  const payload = marketData.candles[ticker];
  const hasCandles = payload && payload.range === chartRange && payload.s === "ok" && payload.c?.length > 18;
  const valueLabel = document.getElementById("stochastic-value");
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  if (!hasCandles) {
    if (valueLabel) valueLabel.textContent = "N/A";
    ctx.fillStyle = "#9aa8bd"; ctx.textAlign = "center";
    ctx.fillText(marketData.loading ? "Loading stochastic..." : "Stochastic history unavailable.", w / 2, h / 2);
    return;
  }
  const candles = payload.t.map((time, index) => ({
    time: Number(time), high: Number(payload.h?.[index]), low: Number(payload.l?.[index]), close: Number(payload.c?.[index])
  })).filter(row => [row.time, row.high, row.low, row.close].every(Number.isFinite)).sort((a, b) => a.time - b.time);
  let timestamps = candles.map(row => row.time);
  const { k, d } = calculateStochasticSeries(candles.map(row => row.high), candles.map(row => row.low), candles.map(row => row.close), 14, 3);
  let kValues = k, dValues = d;
  const displayFrom = Number(payload.displayFrom);
  if (Number.isFinite(displayFrom)) {
    const visibleStart = Math.max(0, timestamps.findIndex(time => Number(time) >= displayFrom));
    timestamps = timestamps.slice(visibleStart);
    kValues = kValues.slice(visibleStart);
    dValues = dValues.slice(visibleStart);
  }
  const maxRenderedPoints = ["1Y","5Y","10Y"].includes(chartRange) ? 240 : 600;
  if (kValues.length > maxRenderedPoints) {
    const bucketSize = Math.ceil(kValues.length / maxRenderedPoints);
    const compactK = [], compactD = [], compactTimestamps = [];
    for (let i = 0; i < kValues.length; i += bucketSize) {
      const end = Math.min(kValues.length, i + bucketSize);
      let selected = -1;
      for (let j = end - 1; j >= i; j--) {
        if (Number.isFinite(kValues[j]) || Number.isFinite(dValues[j])) { selected = j; break; }
      }
      compactK.push(selected >= 0 ? kValues[selected] : null);
      compactD.push(selected >= 0 ? dValues[selected] : null);
      compactTimestamps.push(selected >= 0 ? timestamps[selected] : null);
    }
    kValues = compactK; dValues = compactD; timestamps = compactTimestamps;
  }
  const kPoints = kValues.map((value, index) => ({ value, index })).filter(point => Number.isFinite(point.value));
  const dPoints = dValues.map((value, index) => ({ value, index })).filter(point => Number.isFinite(point.value));
  const latestK = [...kValues].reverse().find(Number.isFinite);
  const latestD = [...dValues].reverse().find(Number.isFinite);
  if (valueLabel) {
    valueLabel.textContent = Number.isFinite(latestK) ? `%K ${latestK.toFixed(1)}${Number.isFinite(latestD) ? ` · %D ${latestD.toFixed(1)}` : ""}` : "N/A";
    valueLabel.className = Number.isFinite(latestK) ? latestK >= 80 ? "red" : latestK <= 20 ? "green" : "amber" : "";
  }
  if (kPoints.length < 2) {
    ctx.fillStyle = "#9aa8bd"; ctx.textAlign = "center";
    ctx.fillText("Not enough history for stochastic.", w / 2, h / 2);
    return;
  }
  const x = index => pad.left + index * (w - pad.left - pad.right) / Math.max(1, kValues.length - 1);
  const y = value => pad.top + (100 - value) / 100 * (h - pad.top - pad.bottom);
  [80, 50, 20].forEach(level => {
    const yy = y(level);
    ctx.strokeStyle = level === 50 ? "rgba(226,232,240,.18)" : "rgba(110,231,183,.22)";
    ctx.setLineDash(level === 50 ? [2, 5] : [5, 5]);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#8f98aa"; ctx.textAlign = "left"; ctx.fillText(String(level), w - pad.right + 10, yy + 4);
  });
  const drawLine = (points, color, width, dash = []) => {
    if (points.length < 2) return;
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(x(point.index), y(point.value)) : ctx.moveTo(x(point.index), y(point.value)));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
  };
  drawLine(kPoints, "#6ee7b7", 1.8);
  drawLine(dPoints, "#e0bc69", 1.35, [5, 4]);
  enableChartCrosshair(c, drawStochasticChart, pad, ratio => {
    const index = Math.max(0, Math.min(kValues.length - 1, Math.round(ratio * (kValues.length - 1))));
    const kValue = kValues[index], dValue = dValues[index];
    if (!Number.isFinite(kValue) && !Number.isFinite(dValue)) return "";
    const dateLabel = timestamps?.[index] ? new Date(Number(timestamps[index]) * 1000).toLocaleDateString() : `${chartRange} session ${index + 1}`;
    const state = Number(kValue) >= 80 ? "Overbought" : Number(kValue) <= 20 ? "Oversold" : "Neutral";
    return `<span>${dateLabel}</span><b>Stoch %K ${Number.isFinite(kValue) ? kValue.toFixed(1) : "N/A"}</b><em>%D ${Number.isFinite(dValue) ? dValue.toFixed(1) : "N/A"}</em><em class="${state === "Oversold" ? "green" : state === "Overbought" ? "red" : ""}">${state}</em>`;
  });
}


function drawRsiChart() {
  const c = document.getElementById("rsi-chart");
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.max(760, Math.round(rect.width * dpr));
  c.height = Math.round(rect.height * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = c.width / dpr, h = c.height / dpr;
  const pad = { top: 12, right: 62, bottom: 22, left: 34 };
  const candlePayload = marketData.candles[ticker];
  const hasLiveCandles = candlePayload && candlePayload.range === chartRange && candlePayload.s === "ok" && candlePayload.c?.length > 15;
  ctx.clearRect(0, 0, w, h);
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  if (!hasLiveCandles) {
    ctx.fillStyle = "#9aa8bd"; ctx.textAlign = "center";
    ctx.fillText(marketData.loading ? "Loading RSI..." : "RSI history unavailable.", w / 2, h / 2);
    return;
  }
  const closes = candlePayload.c.map(Number).filter(Number.isFinite);
  let timestamps = Array.isArray(candlePayload.t) ? candlePayload.t.slice(-closes.length) : null;
  let values = calculateRsiSeries(closes, 14).map(value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null);
  const displayFrom = Number(candlePayload.displayFrom);
  if (timestamps && Number.isFinite(displayFrom)) {
    const visibleStart = Math.max(0, timestamps.findIndex(time => Number(time) >= displayFrom));
    timestamps = timestamps.slice(visibleStart);
    values = values.slice(visibleStart);
  }
  const maxRenderedPoints = ["1Y","5Y","10Y"].includes(chartRange) ? 240 : 600;
  if (values.length > maxRenderedPoints) {
    const bucketSize = Math.ceil(values.length / maxRenderedPoints);
    const compact = [];
    const compactTimestamps = [];
    for (let i = 0; i < values.length; i += bucketSize) {
      const end = Math.min(values.length, i + bucketSize);
      let selected = -1;
      for (let j = end - 1; j >= i; j--) {
        if (Number.isFinite(values[j])) { selected = j; break; }
      }
      compact.push(selected >= 0 ? values[selected] : null);
      if (timestamps) compactTimestamps.push(selected >= 0 ? timestamps[selected] : null);
    }
    values = compact;
    if (timestamps) timestamps = compactTimestamps;
  }
  const points = values.map((value, index) => ({ value, index })).filter(point => Number.isFinite(point.value));
  if (points.length < 2) {
    ctx.fillStyle = "#9aa8bd"; ctx.textAlign = "center";
    ctx.fillText("Not enough history for RSI.", w / 2, h / 2);
    return;
  }
  const x = i => pad.left + i * (w - pad.left - pad.right) / Math.max(1, values.length - 1);
  const y = value => pad.top + (100 - value) / 100 * (h - pad.top - pad.bottom);
  [70, 50, 30].forEach(level => {
    const yy = y(level);
    ctx.strokeStyle = level === 50 ? "rgba(226,232,240,.18)" : "rgba(224,188,105,.26)";
    ctx.setLineDash(level === 50 ? [2, 5] : [5, 5]);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#8f98aa"; ctx.textAlign = "left"; ctx.fillText(String(level), w - pad.right + 10, yy + 4);
  });
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, "rgba(224,188,105,.18)");
  gradient.addColorStop(1, "rgba(224,188,105,0)");
  ctx.beginPath(); ctx.moveTo(x(points[0].index), h - pad.bottom); points.forEach(point => ctx.lineTo(x(point.index), y(point.value))); ctx.lineTo(x(points.at(-1).index), h - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(x(point.index), y(point.value)) : ctx.moveTo(x(point.index), y(point.value))); ctx.strokeStyle = "#e0bc69"; ctx.lineWidth = 1.8; ctx.stroke();
  enableChartCrosshair(c, drawRsiChart, pad, ratio => {
    const index = Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1))));
    const value = values[index];
    if (!Number.isFinite(value)) return "";
    const dateLabel = timestamps?.[index]
      ? new Date(Number(timestamps[index]) * 1000).toLocaleDateString()
      : `${chartRange} session ${index + 1}`;
    const state = value >= 70 ? "Overbought" : value <= 30 ? "Oversold" : "Neutral";
    return `<span>${dateLabel}</span><b>RSI 14 ${value.toFixed(1)}</b><em>${state}</em>`;
  });
}

function render() {
  clearTimeout(worldChatTimer);
  const r = route();
  const isPublicRoute = r === "/home" || r === "/login";
  updateAccountLink();
  if (!isPublicRoute && !authState.ready) {
    authLoadingPage();
    return;
  }
  if (!isPublicRoute && !authState.user) {
    authMode = "login";
    if (location.hash !== "#/login") location.hash = "#/login";
    loginPage();
    updateAccountLink();
    return;
  }
  if (r === "/home") home();
  else if (r === "/login") loginPage();
  else if (r === "/sentiment") sentiment();
  else if (r === "/macro") macro();
  else if (r === "/news") news();
  else if (r === "/paper") paper();
  else if (r === "/world-chat") worldChat();
  else dashboard();
  if ((r === "/" || r === "/news") && !marketData.loading && stockNeedsRefresh(ticker)) refreshTickerData(ticker);
  if (r === "/") refreshWatchlistData();
  if (r === "/sentiment" && !marketData.cnn.loading && !marketData.cnn.data) refreshCnnSentiment();
  if (r === "/macro") refreshMacroData();
}

addEventListener("hashchange", () => {
  scrollTo(0, 0);
  render();
});
setTheme(initialTheme);
setUiStyle(initialUiStyle);
document.addEventListener("click", (event) => {
  if (event.target.closest("#settings-open")) openSettings();
  if (event.target.closest("[data-close-settings]")) closeSettings();
  const close = event.target.closest("[data-close-modal]");
  if (close) document.querySelector("#detail-modal")?.classList.add("hidden");

  if (event.target.closest("[data-close-chat]")) {
    document.querySelector("#assistant-panel")?.classList.remove("open");
  }

  if (event.target.closest(".assistant-button")) {
    openAssistant();
  }

  if (event.target.closest("#chat-send")) {
    const input = document.querySelector("#chat-input");
    if (input && input.value.trim()) {
      sendChatMessage(input.value);
      input.value = "";
    }
  }

  const chatPrompt = event.target.closest("[data-chat-prompt]");
  if (chatPrompt) sendChatMessage(chatPrompt.dataset.chatPrompt);

  if (event.target.closest("button, input, label, a")) return;
  const detail = event.target.closest("[data-detail]");
  if (detail) openDetail(detail.dataset.detail);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettings();
    return;
  }
  if (event.key !== "Enter" || event.shiftKey) return;
  const input = event.target.closest?.("#chat-input");
  if (!input || !input.value.trim()) return;
  event.preventDefault();
  sendChatMessage(input.value);
  input.value = "";
});
render();
