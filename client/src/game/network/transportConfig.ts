function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export interface SupabaseTransportConfig {
  url: string;
  anonKey: string;
}

export type GameTransportMode = "supabase" | "websocket" | "demo";

export function getSupabaseTransportConfig(): SupabaseTransportConfig | null {
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
  const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (
    typeof configuredUrl === "string"
    && configuredUrl.trim()
    && typeof configuredAnonKey === "string"
    && configuredAnonKey.trim()
  ) {
    return {
      url: normalizeUrl(configuredUrl),
      anonKey: configuredAnonKey.trim()
    };
  }

  return null;
}

export function getGameBackendUrl() {
  const configuredUrl = import.meta.env.VITE_BACKEND_URL;
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return normalizeUrl(configuredUrl);
  }

  return null;
}

export function getConfiguredGameTransport(): GameTransportMode {
  if (getSupabaseTransportConfig()) {
    return "supabase";
  }

  if (getGameBackendUrl()) {
    return "websocket";
  }

  return "demo";
}

export function isDemoTransportConfigured() {
  return getConfiguredGameTransport() === "demo";
}
