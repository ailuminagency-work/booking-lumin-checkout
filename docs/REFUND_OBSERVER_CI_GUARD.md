# Dormant refund observer CI boundary

CI run 44357760435 at d0ef2e3 failed because the historical guard treated every
`v1/refunds` reference as creation. The observer only injects GET requests to list
external refunds. No provider requests or runtime activation are introduced here.

The existing Bash entrypoint now delegates to a cross-platform Node guard after
`npm ci`. TypeScript is already lockfile-pinned; no dependency change is required.
The guard retains the original test exclusions and comment-only line handling,
adds TSX/MTS/CTS scanning and SDK `refunds.create` detection, and never exempts an
entire production file just because of its name.

The exact observer path is eligible only when its whole TypeScript printed AST
matches the reviewed d0ef2e3 SHA-256 and explicit AST checks still find one injected
transport call, one literal GET method and no imports/reexports. Any executable
change, including a new side effect, default network transport, export, changed
URL or method, fails closed. Whitespace/comments are not executable changes.
Updating the fingerprint requires reviewing the changed observer again; do not
regenerate it merely to make CI green. The pin covers its existing exported factory
and types, not permission for a runtime caller. Other scanned production sources
containing the observer module name are refused, including imports and reexports.

This is a deliberately narrow reviewed-code pin, not general JavaScript effect
analysis or a proof against arbitrary malicious obfuscation. Existing source
scan exclusions remain explicit. No financial authority, completeness, live
source authentication or provider compatibility is established by this check.

Run `node --test scripts/no-auto-refund-check.test.mjs` then
`node scripts/no-auto-refund-check.mjs` (or the existing Bash wrapper). CI executes
both. Mutation fixtures cover POST/PUT, default networking, SDK/legacy creation,
new calls/imports/exports, aliases, changed endpoint, moved/copied observer,
production consumers, parse errors and filesystem/exit-code behavior.
