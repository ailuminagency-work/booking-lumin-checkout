# Read-only connected payment attention history

This candidate closes a source-level visibility gap, not a deployed alert. No external notification, refund, resolve action, booking reopening or provider processing is added.

The connected dashboard (not the demo Dashboard) can display historical late-paid attention with booking reference/link, recorded time and subsequent-conflict warning. It deliberately does not describe an unresolved balance or imply funds are still outstanding. Refresh and older-page reads are the only controls. Empty history, unavailable configuration and failed reads have distinct states. Session/tenant changes immediately suppress prior snapshots and abort/discard stale requests.

Both switches remain default off: API `BOOKING_LUMIN_PAYMENT_ATTENTION_VISIBILITY` accepts exact `1`; portal `VITE_PAYMENT_ATTENTION_VISIBILITY` accepts exact `true`. This is independent of owner cancellation and provider/payment flags. No environment configuration is changed in this candidate.

GET `/api/payment-attention` uses existing bearer verification and allowed-origin protections. The selected tenant is not authority: the backend derives the actor's sole membership, verifies the selection matches, then calls the existing owner/staff membership guard in a bounded repeatable-read transaction. Inactive businesses, revoked memberships, foreign business selections and unauthenticated requests fail closed. Only the private service RPC can read the ledger; no direct table/column SELECT grants are added.

Pages are capped at 100 and use limit+1 detection plus the full six-digit UTC timestamp and receipt UUID as a composite cursor. No JavaScript Date conversion is used, so timestamp ties and sub-millisecond values do not skip rows. The strict response excludes payment capabilities, idempotency keys, client secrets, raw events, source account data and arbitrary notes. The actor is never accepted from a query parameter.

Local verification uses actual HTTP and PostgreSQL, composed through the real Supabase identity-verifier code with synthetic upstream identity responses. It is not live Supabase JWT/provider evidence. Production delivery still requires reviewed deployment, authenticated owner access and observation of the notice in the deployed connected portal; no such claim is made here.

Authorization is evaluated within the bounded transaction snapshot and membership locks. Committed membership revocation is enforced on subsequent requests; this does not promise instantaneous cancellation of a read already authorized in flight. Browser context isolation prevents a late response from being rendered after a local auth/tenant change, but does not undo an already completed server read.
