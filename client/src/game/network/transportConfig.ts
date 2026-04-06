function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function getGameBackendUrl() {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return normalizeUrl(configuredUrl);
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:8080";
    }
  }

  return null;
}

export function isDemoTransportConfigured() {
  return getGameBackendUrl() === null;
}
