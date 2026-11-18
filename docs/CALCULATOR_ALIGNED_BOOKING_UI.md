# Calculator-aligned Booking owner workspace

Reference: CalculatorOPS canonical c63e4e57e85001d622a759ebac26162b3d2ea08e, `LuminSidebar`, `StudioDashboard`, `StudioAreaFrame` and scoped `studio.css`. The public Studio QA surface was inspected. Adopt its owner application language, not its unrelated customer estimator theme: 210px dark navigation, 56px tablet rail, cool canvas, white bordered panels, indigo active navigation, compact controls and a restrained two-column overview. No Calculator AI/publish controls are invented in Booking.

Changed presentation: shared PortalShell, connected dashboard and booking table, attention history surfaces, sign-in/session controls. Existing session generations, tenant membership, mutation callbacks, uncertainty behavior and independent attention/acknowledgment flags remain. Loaded counts explicitly describe the available subset, not all-time totals. Errors/loading never display stale counts or a fabricated zero. No provider activation, financial mutation or new refund controls.

## Local connected visual review

From `apps/portal`, start `npm run dev -- --host 127.0.0.1 --port 5384 --strictPort` with `VITE_PAYMENT_ATTENTION_VISIBILITY=true` and `VITE_PAYMENT_ATTENTION_ACKNOWLEDGMENT=true` only in that process. Open `/qa/connected.html`. Sign in using any synthetic fixture email/password, e.g. owner@fixture.test / synthetic. No actual credentials.

The separate QA entry requires DEV and loopback, imports the real ConnectedPortal/runtime-client, and refuses all unrecognized synthetic transport operations without network fallthrough. It is not imported by App/main and is not part of the production index build. No authentication bypass or demo fallback is added to production.

Variants: `?role=staff`, `?state=empty`, `?state=loading`, `?state=error`, `?attention=empty`, `?attention=loading`, `?attention=error`, `?route=/bookings`. Synthetic acknowledgment only returns an in-memory fixture response; it cannot write to a server. For default-off visual validation, start a second process on5385 without either flag and use the same QA URL.

Verify owner/staff actions, historical warnings, loading/empty/error states, sidebar keyboard navigation and 320/768/1024/1440 widths. Portal `typecheck`, `test`, `build` remain the regression commands. Browser screenshots and independent review are required before a visual PASS. No deployment is included.

Local validation: full portal suite 59 files / 1,144 tests passed, then the explicit mobile Close menu regression and overview cases passed (7 focused tests). Portal TypeScript and production build passed after that addition. Build output contains no synthetic fixture sentinel. Independent browser review is a separate gate; the local fixture itself is not a production route or hosted deployment.
