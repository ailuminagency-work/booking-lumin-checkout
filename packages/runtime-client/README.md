# Connected runtime client

Browser-only fetch adapter for an explicitly configured Supabase deployment. Accepts an HTTPS root URL, public publishable/anon key and fixed deployment tenant UUID. Rejects known secret-key/service-role configuration before requests. It never persists tokens or passwords in browser storage, never loads provider secrets, and never invokes payment functions.

The checkout reads active simple services and calls the existing create_booking_draft RPC. A response means an unconfirmed request was saved; no payment or availability guarantee follows. The component retains a random idempotency key over retries and replaces it when the logical form input changes or a new request starts.

Portal and platform sessions authenticate via password, then verify identity through /auth/v1/user. The server's RLS remains the authority: client tenant filtering is not authorization. Portal reads memberships and scoped drafts (separate unpriced DTO), and can toggle simple services through RLS. Platform access requires a platform_admins row before querying the four aggregate views. No generic table accessor is exposed.

Sessions remain in memory only. Reload requires sign-in. Sign out discards the local token; it does not revoke every other session on the account. Token refresh and account creation are intentionally absent. Use existing authorized staging accounts. Error responses are replaced with fixed non-sensitive messages; server response bodies are not displayed or logged. In-flight responses from prior sessions are rejected.

Connected components replace the demo pages rather than merging mock records into live results. Missing configuration or request failure is visible and never falls back to mocks. Drafts are limited to the latest 100; aggregate views to 1,000 rows each. No realtime subscription, provider-health certification, billing collection, confirmed booking or resource reservation is implied.

Validation: injected-fetch tests cover secret configuration rejection, tenant-poisoned catalog response, stable draft retry, server-derived identity, logout invalidation, platform role checks and error-message privacy. Connected checkout UI test proves retry identity and explicitly unconfirmed result. Actual Supabase Auth/PostgREST/browser and deployment checks are separate integration gates.
