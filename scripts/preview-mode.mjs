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
