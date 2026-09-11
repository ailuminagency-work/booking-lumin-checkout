# Pinned sessions and unconfirmed booking requests

This W3 candidate builds on reviewed PR56 at b908c3d178c32094a9d9d7b6db6c8ac8490266de. It is under construction; its eventual source, database, Runtime and exact CI receipts are required before acceptance.

Two additive immutable provenance tables keep each session bound to its tenant, installation, published version, service, distribution policy and original expiry. Installation target changes preserve a valid pinned session; a policy revision change or expiry prevents further use, including retries. The existing session tables and endpoints stay intact.

Three fixed service operations issue a pinned session, accept or repeat one canonical unconfirmed request, and provide a minimized owner history across both request sources. Submission creates a draft request through existing authoritative booking constraints. Its original acceptance stays distinct from the booking's current state. Reusing an existing customer preserves that customer's identity.

The proposed implementation enforces source-first locks, exact normalization and hash framing, one accepted booking per session, complete rollback and tenant-bound owner pagination. No raw token is persisted or returned by SQL. Server token generation, uncertain delivery and public HTTP composition require a later transport review.

Curie owns SQL and unit tests; Chandrasekhar independently owns the actual PostgreSQL race harness; Maxwell supplies independent source, adversarial and Runtime review. Root owns shared registration, integration and Release. The frozen contract and dispatch receipts retain exact identities and file ownership.

This increment adds no live migration, activated profile/provider, confirmation, price, payment, capacity hold, worker assignment or notification delivery. Full W3 and hosted synchronization remain incomplete.
