# Public policy API and local document verification

This increment connects the accepted inert document handler to a real public-policy HTTP endpoint and guarded disposable PostgreSQL composition. It does not create a customer session, submit a booking, collect payment, or activate a provider. The existing RC-2 foundation and earlier PR stack remain protected.

## Authority and interfaces

`GET` and `HEAD /api/public/installation-policies/:installationId` return only the validated minimized public installation policy. Canonical raw request targets, Host, duplicate headers, body, credential headers, CORS and exact profile membership are checked before delivery. Unknown or unavailable installations return fixed errors. Browser Origin is a distribution constraint, never tenant authentication.

The new local composition accepts only explicitly flagged disposable `lumin_mode_document_*` databases and loopback PostgreSQL. It reuses the accepted repository through a restricted eight-command driver. Old repository constructors, migrations, owner operations and session operations are unchanged. The restricted transaction is application containment, not a production least-privilege certification.

The API retains unresolved backend work until actual settlement, enforces bounded concurrency and fixed rate limits, and samples the complete two-second response deadline after timer cleanup. Independent review reproduced the same final-cleanup deadline defect in the accepted portable document handler; this new candidate repairs it and tests the 1,999/2,000 ms boundary. The accepted predecessor branch is not rewritten.

## Independent local verification

The verifier uses fresh databases for both public and extensions pgcrypto layouts, all active migrations, native HTTPS requests, real Chromium and the actual SQL policy function. Nineteen HTTP scenario groups cover minimized policies, current committed configuration, unavailable records, raw request rejection, cache/HEAD parity, TLS negatives, lock/deadline cleanup, backend admission and partial startup cleanup.

Eight browser cases cover hosted and iframe framing, nested parent chains, committed configuration refresh, observable raw aliases, certificate rejection, no issuance/privacy and responsive layouts. Success requires every case and all six fixed screenshots. The artifact validator and collector never upload TLS keys, arbitrary framework output or whole directories.

TLS uses two short-lived local fixture keys. Node uses a scoped CA and hostname validation; Chromium uses a scoped public-key exception and six local resolver rules. This proves bounded local transport/origin behavior, not public certificate trust or hosted acceptance. Real credentials remain disconnected.

## Candidate gates and remaining work

Actual results and exact identities belong in the evidence file and continuation receipt. Implementation, static review or a passing local run does not establish exact-candidate CI or Release approval. The separate `document` CI job must pass alongside the existing verify and database jobs before this candidate can pass bounded draft Release review. Existing branch protection is unchanged.

W3 remains incomplete: the customer session/request bridge, complete builder/runtime capabilities and authorized hosted acceptance still follow. W4 and subsequent approved waves retain their original requirements. No deployment, merge, live migration or provider activation is authorized by this increment.
