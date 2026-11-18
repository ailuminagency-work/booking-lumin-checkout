# Retained staging portal build manifest

The existing portal `vite build` command now includes a build-only plugin. It emits
staging evidence only when the existing Railway service and environment IDs exactly
identify the reviewed staging portal. Generic local builds emit no staging manifest.
A partially matching destination, missing/malformed commit, dirty tracked checkout
or available Git HEAD mismatch fails closed. Without a Git checkout, the Railway
commit remains a trusted platform assertion, not independently proven source identity.

The plugin reads the same build's resolved Vite environment (including dotenv/mode
precedence), requiring attention visibility and acknowledgment to be absent, empty
or exactly `false`. Enabled or unrecognized values and import.meta.env define
overrides fail. No environment object, secret, key, URL, HTML or asset content is logged.

After Rollup finishes, emitted HTML/chunk/CSS hashes must equal the bounded files
on disk. Sorted assets include lazy chunks. Symlink/junction path components,
unknown assets/source maps, unexpected root files, stale chunks, oversized output
and more than 64 asset files fail. Root static installation-check files and redirects
are separately hashed as auxiliaryFiles; PR300 smoke does not yet fetch those
auxiliary files, so it cannot certify them. Limits align with PR300: 4MiB/file and
16MiB aggregate. Existing witness is removed before a new build is validated.

Successful builds write `dist/portal-release-manifest.json` and emit the same single
JSON object between `PORTAL_RELEASE_MANIFEST_BEGIN` / `PORTAL_RELEASE_MANIFEST_END`.
Retain the build log/artifact independently of the deployed website. That retained
object is compatible with PR300's smoke input. Never fetch the served manifest and
use it as its own expected evidence. Determinism means identical committed input
and finished artifact produce identical JSON, not that builds are reproducible or
cryptographically signed. Trusted build toolchain/output-directory exclusivity is
required; this is not protection from a malicious concurrent local writer.

The API SHA ce544cef714ee524d935ef1f8def78411bf9052e and migration0103 fields are
explicit reviewed release expectations, NOT observations or database attestation.
Manifest emission does not prove deployment, actual OAuth, disabled runtime flags
without trusting the build, financial readiness or provider availability.

This change does not deploy, alter hosted settings, activate providers or change
PR301. Local simulated Railway metadata tests are not a real Railway build.
