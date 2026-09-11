# Approved browser tooling for the local owner increment

Root accepted the following independently reviewed tooling at SHA2561992C89806E5A9BB588BC8B2D4FA2B8A552A58DD9EF6BDD2DD812B4D39968DD2. Dependency installation has begun on the isolated implementation branch. This is not a passing browser/runtime receipt. Existing dependencies remain unchanged; exactly three Playwright1.63.0 packages are added. Implementation must prevent external HTTP/WebSocket/redirect contact and cover reporter/startup/config/worker output in credential sentinel tests.

The historical proposed artifact follows unchanged. Root reviews the verifier-authored harness independently; its author cannot self-approve it.

---

# Local owner browser tooling addendum — proposed exact dependency

Author/reviewer `/root/allocator_source_review`. External design artifact only. No dependency, lockfile, browser binary, accepted repository file or CI configuration was installed or changed by this task. Root/independent approval and exclusive dispatch are required before implementation. Pair with owner contract5997CF7683750180BB8B99A198A78B2E8D309C68FB368FECBE24260FC1CE1EDC; current accepted predecessor metadata8059c151 has root-reported exactCI34550694346 PASS, separate from this tooling decision.

## Exact package and browser evidence

Read-only npm registry metadata independently confirms the dependency chain:

| Package | Exact version | Declared dependency | Registry SRI |
|---|---|---|---|
| @playwright/test | 1.63.0 | playwright=1.63.0 | sha512-oxMK4vllB9RK5NQ2l1pq1IfOf2AvnEuj/vYGDj0H2nMtmtZpKtCwt/l00GEO6xjGfpBNAvjovvYdCm50dRQkpQ== |
| playwright | 1.63.0 | playwright-core=1.63.0 | sha512-+7ziBLidS4NaNCdt57SUDT+wYmmd5fmiQejUic/kb+YsYSCPyOOE9sebzMjNmQrsnNpDJqd4WHvV/8lfKfUDUg== |
| playwright-core | 1.63.0 | — | sha512-rYCsBF/M5HjUch52bbtVONEFjv6Xu8sm8h72dNlR5bzIE1fvC/bxgspzkjSfU+MweEMmPM8KJebG6nnyxo5mCg== |

All three metadata records declare Node>=20; retain the repository's existing Node>=24<25 runtime, not an engine downgrade. Sources: [test metadata](https://registry.npmjs.org/@playwright%2Ftest/1.63.0), [runner metadata](https://registry.npmjs.org/playwright/1.63.0), [core metadata](https://registry.npmjs.org/playwright-core/1.63.0).

Actual artifact verification, terminaldfdee3 exit0: downloaded the official [playwright-core1.63.0 tarball](https://registry.npmjs.org/playwright-core/-/playwright-core-1.63.0.tgz) into memory only, under20MB cap; computed SHA512 and matched the exact core SRI above. Read package/browsers.json through gzip/tar streams without extracting files or executing package code. Manifest specifies Chromium revision1243 / browserVersion153.0.8010.12 and chromium-headless-shell revision1243 / browserVersion153.0.8010.12. Supporting manifest entries are ffmpeg1011 and Windows winldd1007. This verifies the package's declared matching browser revision, not an installed browser binary or completed browser test. Firefox1543/WebKit2359 are out of this leaf's selected browser scope.

## Dependency and ownership decision

Root may add exactly `@playwright/test: "1.63.0"` as a root development dependency; no caret/tilde/floating latest, no unrelated upgrades. Root owns package.json/package-lock.json and package script/CI registration. Lockfile review must preserve the exact transitive playwright/playwright-core versions and SRI chain above; npm ci performs artifact integrity checking. Any version/revision change returns to this explicit tooling review.

Independent verifier owns prospective new paths `playwright.mode-owner.config.ts`, `tests/mode-owner/owner-journey.spec.ts`, `tests/mode-owner/fixtures.ts`, and `tests/mode-owner/safe-reporter.ts`. Root scans/reserves these paths before dispatch. Browser fixture code may start/stop the local accepted composition and built Portal with fixed trusted fixtures; no source monkeypatch substitutes for real HTTP/SQL outcomes. API and Portal builders retain their separate frozen source ownership. No browser framework is silently added to the existing Vitest/jsdom suites.

## Workspace-scoped browser runtime

Set PLAYWRIGHT_BROWSERS_PATH to an absolute resolved `.cache/mode-owner-playwright` directory under the specific implementation worktree/CI workspace for BOTH install and run. Verify containment; never default to a user-global browser cache or accept an arbitrary inherited path. No global package install, machine Chrome/Edge channel, global credential file or default profile is used. The current dependency node_modules junction does not authorize writing to its target; root must arrange isolated dependency installation when implementing the package change.

Use the pinned locally installed CLI (`node node_modules/@playwright/test/cli.js`), not an npx invocation that may download an unpinned missing package. Planned Linux CI install: `install --with-deps --only-shell chromium`. This selects the matching real Chromium Headless Shell1243/153.0.8010.12 without unrelated browser engines; project uses browserName chromium, headless true and no custom executablePath/channel override. Install browser/system dependencies only in the explicitly reviewed CI/isolated workspace task. Windows local install omits unsupported system-package work. No browser installation occurred during this audit.

At runtime record pinned runner/core versions, browser.version(), platform/architecture and candidate Git SHA. Require expected Chromium153.0.8010.12; missing/wrong browser or unavailable install fails explicitly, never skips or falls back to jsdom/system Chrome. If caching binaries later, use an exact OS+architecture+Playwright1.63.0+Chromium1243+lockfile-hash key and verify runtime version; never broad restore keys to a different browser revision. Initial CI may omit browser caching for simplicity.

Official implementation references: [browser installation](https://playwright.dev/docs/browsers), [CI setup](https://playwright.dev/docs/ci), [supported environments](https://playwright.dev/docs/intro). Those pages support CLI browser/system installation and single-worker reproducible CI; this addendum intentionally pins the independently observed version instead of copying floating installation examples.

## Bounded real-browser CI

- Dedicated local owner project; workers1, fullyParallel false, retries0, forbidOnly true, maxFailures1. No reuseExistingServer or remote target URL. Test only explicit loopback Portal/localOwnerApi/localDraftApi on distinct validated ports; disable service workers and use fresh browser contexts, no saved storageState.
- Keep existing Node24 and PostgreSQL service/migration harness. For each public/extensions layout, create a fresh absent disposable database under the approved owner prefix and apply all30 migrations. Prove all three composition pools reach that same DB/server/user. Never DROP/reuse an old DB to hide a failed run.
- Build the actual Portal. Start its local serving process and both reviewed API listeners, bounded60s readiness; fail if existing unrelated listeners occupy the intended ports. Any helper process window is hidden on Windows. No external deployment/profile URL is contacted.
- Browser test timeout60s, assertion timeout5s, action timeout10s, navigation timeout15s; HTTP client retains frozen16s total deadline. Whole per-layout browser run maximum10minutes, overall CI job maximum25minutes. Single total10s composition teardown is preserved; browser and serving-process teardown have their own bounded10s each within the outer job budget. Await/reap owned processes, consume late outcomes and fail unexpected exits. No arbitrary wait-to-green or retry policy.
- Real owner journey for V1 and V2: save via draft bridge, publish-only/reload, explicit hosted/iframe configuration, reload persisted history, dirty-draft/current-published CAS, current-state booking pages, HTTP response loss after observed COMMIT and explicit same-key check, no automatic mutation resend, owner/tenant/logout delayed-response isolation. Database observer confirms writes and no session/payment/hold/provider activation. Controlled network fault phases are labeled; repository results are not fabricated.
- Responsive screenshots320x740,768x1024,1440x900, keyboard/focus/status checks and overflow assertions. These are Chromium viewport tests, not physical-device/Safari/Firefox certification. Existing Vitest/jsdom unit tests remain required complementary coverage.

## Artifact and credential policy

Trace off, video off, HAR/network capture off. No storageState, cookie dumps, full DOM snapshots, request/response bodies, headers, query parameters, raw console/error serialization or browser profile archives. A custom safe reporter emits fixed test IDs, pass/fail status, timings and allowlisted phase/error categories; it must not forward arbitrary Playwright call logs, locator.fill values, exception messages, expected/actual object dumps or server stdout that may contain credentials. Test reporter secrecy with a unique synthetic credential sentinel in a deliberately failing request/fill; scan emitted artifacts/stdout to prove absence. This is a real acceptance test, not a presumed framework feature.

Only reviewed screenshots and a bounded credential-free JSON summary are uploaded, on failure and/or specified responsive checkpoint. Mask credential inputs and any diagnostic disclosures, use fixed sanitized filenames, maximum12 PNG files at5MiB each plus summary<=64KiB. Disable framework automatic screenshot attachments in favor of explicit safe screenshots. Artifact retention7days; no automatic public publishing. Synthetic fixture values do not authorize logging bearer tokens. If safe artifact capture fails, report that fixed failure without uploading unreviewed artifacts.

## Approval boundary

This addendum makes version/browser/ownership/cache/CI/artifact choices concrete for review. It does not install packages, download a browser, grant a live profile, amend accepted local factory guards, certify hosted UX or authorize direct main changes. Root must record exact addendum review/freeze and dispatch before implementation. Every candidate still requires independent review, real browser/PG receipts, Runtime, exact-candidate CI and Release.
