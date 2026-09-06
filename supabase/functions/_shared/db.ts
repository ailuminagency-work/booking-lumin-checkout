// _shared/db.ts — service-role Supabase client for trusted server runtime.
//
// SERVICE_ROLE bypasses RLS by design; it is used ONLY inside these edge
// functions (the trusted runtime, SI-2). The key comes from Deno.env and is
// NEVER exposed to the client. Availability re-verification, repricing, and the
// booking state machine (via the DB triggers in migration 0005) are the real
// guarantees; this client is the arm that executes them server-side.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function serviceRoleClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (function secrets)");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(code: string, message: string, status: number): Response {
  // ErrorContract shape { error: { code, message } }. Messages are display-safe
  // and NEVER contain secrets or another tenant's data (SI-11).
  return jsonResponse({ error: { code, message } }, status);
}
