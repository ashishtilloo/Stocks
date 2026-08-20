const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

export function apiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options);
}

export function apiEventSource(path) {
  return new EventSource(apiUrl(path));
}

export async function apiJson(response, label = "API request") {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.toLowerCase().includes("application/json")) return response.json();
  const text = await response.text().catch(() => "");
  const htmlReturned = /^\s*<!doctype|^\s*<html/i.test(text);
  if (htmlReturned) throw new Error(`${label} returned the website HTML instead of JSON. Check that the backend API is running and VITE_API_BASE_URL points to it.`);
  throw new Error(`${label} returned ${contentType || "a non-JSON response"} instead of JSON.`);
}
