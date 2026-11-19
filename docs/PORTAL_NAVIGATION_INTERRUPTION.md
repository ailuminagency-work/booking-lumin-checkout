# Interrupted connected navigation regression

Source-only follow-up to cffcf24. The pending deployment candidate is unchanged.

Three deterministic new tests failed against the original Layout: an open mobile
drawer stayed open during Back navigation; a queued route-selection animation frame
stole focus from Menu after reopen/Escape; and an unmounted shell's global main-ID
callback focused a newly mounted shell. The latter is a presentation isolation bug,
not evidence of data or credential disclosure.

Fix: own navigation/main refs instead of global selectors, one cancellable focus
frame per shell, cleanup on unmount, and dismissal on router location or displayed
session context changes. Closed-drawer history navigation does not move focus.
No auth/runtime-client contracts, provider requests, business membership policy or
financial behavior changed. Existing OAuth and connected async-result regression
suites remain exercised; no speculative auth changes were made.

Seven interruption tests cover Back/Forward, repeated open/route/Escape, unmount,
business/sign-out context changes, closed-drawer history and pending-focus context
replacement. Alongside existing shell/ConnectedPortal/OAuth cases: 50 tests pass.
These are deterministic DOM/unit tests, not an actual hosted OAuth journey or a
new independent mobile-browser accessibility certification.
