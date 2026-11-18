# Provider PaymentIntent response authority

Before recording a provider intent or returning its client capability, the Edge
handler validates the normalized adapter response at runtime. It requires:

- A non-array object with nonblank string intent ID and client token. No provider
  ID prefix, token length, or secret format is assumed.
- A money object with a safe positive integer amount equal to the server-computed
  charge, and currency exactly equal to that charge. The existing Stripe adapter
  normalizes currency to uppercase; this check consumes that normalized contract.
- A state within the existing PaymentIntentRef state contract.

Malformed/mismatched responses yield generic HTTP502 before any payment-row write
or client-capability disclosure. Existing rows are not rewritten, no refund is
initiated, and the hold is not released solely because provider outcome is unknown.

The guard validates the adapter reference, not every raw Stripe wire field. The
adapter may already throw while decoding malformed raw responses; the existing
catch continues to return a safe failure without payment persistence. Its existing
raw-status normalization remains unchanged. A valid provider-reference state is
still subject to the authoritative stored-state check before a capability returns.

Tests exercise the actual handler with mocked provider/DB boundaries. They include
mismatched amount/currency, numeric or missing fields, empty objects/arrays, unknown
states, and valid opaque IDs/tokens, plus existing valid replay and resolved-state
protection. These are not real-provider, hosted or database-concurrency evidence.
No production or provider configuration changes are included.
