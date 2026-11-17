/**
 * Public, provider-neutral frontend runtime configuration.
 *
 * This module only reads Vite-exposed values. It must never accept a secret,
 * service-role key, or provider credential. Demo is the safe default; a
 * staging or production build must opt into a connected runtime explicitly.
 */
export type RuntimeEnvironment = "demo" | "staging" | "production";
export type RuntimeMode = "demo" | "supabase" | "mock";

export interface PublicRuntimeConfig {
  environment: RuntimeEnvironment;
  mode: RuntimeMode;
  apiOrigin: string | undefined;
  flowApiOrigin: string | undefined;
  supabaseUrl: string;
  supabasePublishableKey: string;
  tenantId: string;
}

const ENVIRONMENTS = new Set<RuntimeEnvironment>(["demo", "staging", "production"]);
const MODES = new Set<RuntimeMode>(["demo", "supabase", "mock"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function origin(value: unknown, name: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute origin`);
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an HTTPS origin`);
  }
  return parsed.origin;
}

export function readPublicRuntimeConfig(env: Record<string, unknown>): PublicRuntimeConfig {
  const rawEnvironment = text(env.VITE_RUNTIME_ENV) || "demo";
  if (!ENVIRONMENTS.has(rawEnvironment as RuntimeEnvironment)) throw new Error("VITE_RUNTIME_ENV is invalid");
  const environment = rawEnvironment as RuntimeEnvironment;
  const rawMode = text(env.VITE_RUNTIME_MODE) || "demo";
  if (!MODES.has(rawMode as RuntimeMode)) throw new Error("VITE_RUNTIME_MODE is invalid");
  const mode = rawMode as RuntimeMode;
  if (environment !== "demo" && mode === "demo") throw new Error("Connected mode is required outside demo");
  if (environment === "production" && mode === "mock") throw new Error("Mock mode is not allowed in production");

  const apiOrigin = origin(env.VITE_API_ORIGIN, "VITE_API_ORIGIN");
  const flowApiOrigin = origin(env.VITE_FLOW_API_URL, "VITE_FLOW_API_URL") ?? apiOrigin;
  return {
    environment,
    mode,
    apiOrigin,
    flowApiOrigin,
    supabaseUrl: text(env.VITE_SUPABASE_URL),
    supabasePublishableKey: text(env.VITE_SUPABASE_PUBLISHABLE_KEY),
    tenantId: text(env.VITE_TENANT_ID),
  };
}
