# Hosted OAuth compatibility for the Calculator-aligned portal

Baseline: hosted `fb7aefea9467317424c167816e5a2972ed8d26fe`; redesigned candidate `0827fda399f5295e39958063f28b1965efe952f7`. These histories diverged. Deploying the UI candidate alone would have removed Google sign-in.

This integration selectively restores the hosted Google authorization URL builder, PKCE code exchange, existing token-completion API, callback handling and Continue with Google control. It retains the redesigned shell, connected dashboard, payment-attention read/acknowledgment features and their default-off flags. No migration, provider settings, financial behavior, hosted configuration or deployment is changed.

Safety corrections over the hosted implementation:
- OAuth attempts invalidate previous authenticated state and pending reads through the existing sign-out boundary. Every identity completion is generation-bound; a stale callback cannot assign credentials or clear a newer session. Retained uncertain work is restored for the authenticated actor using the same rules as password sign-in.
- State/verifier are consumed before a bound exchange, including exchange failure; replay cannot exchange again. Unbound error callbacks do not cancel a pending flow. Provider error descriptions are not displayed.
- Callback consumption is deferred until the React effect survives StrictMode's initial cleanup probe. Component/session changes discard stale membership and tenant results.
- Authorization initiation is busy/generation-bound, uses independent cryptographic state and verifier plus SHA-256, and strips callback query/hash from the HTTPS return URL. Tokens remain in memory; only the pending state/verifier use session storage.

Tests include the hosted compatibility cases plus strict-mode success, missing binding, verified/unverified errors, replay, exchange failure, client replacement, stale exchange/user response resolve/reject and preservation of a replacement password session. All requests use synthetic transports. No real Google sign-in or hosted redirect configuration is verified by these tests.

Existing local `apps/portal/qa/connected.html` remains a DEV-only synthetic connected preview. A real Google redirect must not be followed from this fixture. Browser zoom/reduced-motion evidence from the earlier UI wave was builder-executed, not an independent rerun or full WCAG certification.
