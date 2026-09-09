# Flow UI: bounded local persisted-request slice

This package provides a fetch-only client, strict response projections, and the same controlled question renderer used by Portal preview and the hosted customer route. Supported questions are single choice, multiple choice, and integer quantity; the service's complete question set and required flags must match the ordered configuration. No conditional or pricing controls are offered.

Owner mode requires explicit VITE_FLOW_LOCAL_HARNESS=true, a loopback browser hostname and a loopback VITE_FLOW_API_URL. The owner enters a synthetic local credential and business selector; only the server authenticates and authorizes them. Browser token state is in memory only and cleared on signout. Invalid local setup never falls back to demo. Production authentication is not implemented here.

Hosted routes use /checkout/flow/:installationId (also respecting the app base). Only an HTTPS page may create a session. The server controls exact origin matching and session pinning. This client never invents an Origin header, bypasses certificates or stores a token in a URL/localStorage. Local HTTP customer rendering is explicitly unavailable; HTTPS browser verification remains a separate integration gate.

Saved forms use server revisions. A conflict retains unsaved input and asks the owner to reload. Publishing requires a persisted revision and exact HTTPS customer origin. A hosted session renders its pinned DTO. Submission has no tenant, service, version, price, paid status, or capacity claim; the server derives those bindings. After an ambiguous response the form locks and retries the same frozen body and idempotency key. A confirmed:false/draft receipt is required to show saved success. Refreshing the page loses the memory-only session; durable cross-reload recovery is not claimed.

The fetch client sends credentials only in Authorization, omits browser cookies, refuses redirects, suppresses referrers, uses no-store and rejects responses after invalidation even while JSON parsing was pending. Only allowlisted error codes receive friendly UI text. No provider or database code is imported.
