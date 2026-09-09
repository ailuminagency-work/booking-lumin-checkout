/** Build configuration, not proof of runtime connectivity or provider activation. */
export function previewMode(value = "mock") {
  if (value === "supabase") return {
    mode: "supabase-draft-requests", persistence: "supabase", providerConnections: "not-connected",
    label: "Supabase preview · Draft requests only",
    description: "Browse the live catalog and submit unconfirmed draft requests. Business views require sign-in. Payments and external providers are not connected.",
  };
  if (value !== "mock") throw new Error("Unsupported VITE_RUNTIME_MODE; use mock or supabase");
  return {
    mode: "demo-in-memory", persistence: "none", providerConnections: "simulated",
    label: "Demo preview · In-memory data",
    description: "Each app uses its own sample data. Changes reset on reload and do not sync between apps or with Supabase. Payments and provider connections are simulated.",
  };
}

/** Validate public build inputs before touching the existing publish directory. */
export function validatePreviewEnvironment(environment) {
  const configuredMode = environment.VITE_RUNTIME_MODE;
  if (configuredMode === undefined && environment.NETLIFY === "true") {
    throw new Error("Netlify builds require explicit VITE_RUNTIME_MODE=mock or supabase");
  }
  const runtimeMode = configuredMode === undefined ? "mock" : configuredMode;
  const mode = previewMode(runtimeMode); // Empty/unknown explicit values never fall back.
  if (runtimeMode === "supabase") {
    const invalid = (name) => { throw new Error(`Supabase preview requires valid public build configuration: ${name}`); };
    let url;
    try { url = new URL(environment.VITE_SUPABASE_URL); }
    catch { invalid("VITE_SUPABASE_URL"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      invalid("VITE_SUPABASE_URL");
    }
    const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
    let publicKey = typeof key === "string" && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
    if (!publicKey && typeof key === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      try { publicKey = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role === "anon"; }
      catch { publicKey = false; }
    }
    if (!publicKey) invalid("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (typeof environment.VITE_TENANT_ID !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(environment.VITE_TENANT_ID)) {
      invalid("VITE_TENANT_ID");
    }
  }
  // Shape validation only: no network, key verification or runtime certification.
  return { ...mode, runtimeMode };
}
