# Provider PaymentIntent response authority

Before recording an intent, the Edge handler validates the adapter's normalized
financial reference at runtime: a non-array object, nonblank opaque intent ID,
money with a safe positive integer amount equal to the server-computed charge,
currency exactly equal to that charge, and an existing PaymentIntentRef state.
The adapter normalizes currency to uppercase. No ID prefix or length is assumed.

Financial-reference validation is separate from frontend-capability validation.
Stripe client_secret may legitimately be null, which the adapter normalizes to an
empty token. A valid financial anchor must still be persisted/read so processing
and resolved payments can be reconciled even without a frontend token. Existing
anchors are never overwritten. Authoritative stored state gates further action:
processing/resolved/failed/refunded states return409, with or without a token.
Only a stored requires_payment row reaches capability validation; a missing,
non-string or blank token returns generic502 without disclosure, retaining its
financial anchor for recovery. Usable opaque tokens have no invented format rule.

Malformed/mismatched financial references yield generic502 before payment writes.
No error path in this change releases a hold solely because the provider outcome
is uncertain, and no refund is initiated. The guard validates the adapter ref,
not every raw Stripe wire field; raw decoding errors remain handled by the existing
catch. Raw-status normalization remains unchanged.

Actual-handler tests mock provider/DB boundaries. They cover bad financial fields,
valid opaque values, existing replay protection and new/existing state/token
matrices, including processing, succeeded, failed, refunded and partially_refunded
with undefined/null/empty tokens. Payable missing-token anchors are persisted but
no capability is returned. These are not live-provider, hosted or database-race
certification. Independent review and exact-head CI remain required.
