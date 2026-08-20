import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { handleApi } from "./api-handler.mjs";

const alphaVantageKey = defineSecret("ALPHA_VANTAGE_API_KEY");
const marketDataToken = defineSecret("MARKET_DATA_API_TOKEN");
const geminiKey = defineSecret("GEMINI_API_KEY");

function requestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.rawBody?.length) return req.rawBody;
  if (req.body === undefined || req.body === null) return undefined;
  return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

export const api = onRequest({
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "512MiB",
  secrets: [
    alphaVantageKey,
    marketDataToken,
    geminiKey
  ]
}, async (req, res) => {
  try {
    const origin = `${req.protocol || "https"}://${req.get("host")}`;
    const request = new Request(new URL(req.originalUrl || req.url, origin), {
      method: req.method,
      headers: requestHeaders(req),
      body: requestBody(req)
    });
    const response = await handleApi({ request, env: process.env });
    res.status(response.status);
    response.headers.forEach((value, key) => res.set(key, value));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.status(500).json({ error: "Firebase API function failed", detail: error.message });
  }
});
