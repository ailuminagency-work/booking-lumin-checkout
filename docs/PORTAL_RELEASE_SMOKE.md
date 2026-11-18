# Credential-free portal release smoke

This complements, rather than replaces, `phase-a-staging-smoke.mjs` (API checks) and
`phase-a-hosted-readiness.mjs` (authenticated database attestation and Edge probes).
Neither existing harness pins portal artifact bytes or direct-route responses.

No live run is included in this change. Do not run while another operator's rollout
is awaiting approval. This harness never deploys, signs in, runs JavaScript, follows
redirects, calls Supabase/Stripe/Google, or supplies credentials. It GETs only the
explicit portal root/primary routes/assets/two known QA paths and API health/ready/version.

## Required trusted artifact evidence

Use the retained artifact from the **exact approved build**, not files downloaded
from the deployment being checked. Source commit alone is insufficient: Vite embeds
build configuration. Require the build's independent provenance/configuration record
to establish BOTH `VITE_PAYMENT_ATTENTION_VISIBILITY` and
`VITE_PAYMENT_ATTENTION_ACKNOWLEDGMENT` were absent or false. Do not infer disabled
flags by grepping a minified bundle. The manifest booleans below are assertions from
that trusted record, not independently measured by this HTTP tool. If that record or
artifact is unavailable, stop with a release-verification gap; do not mint evidence
from the deployed site. A locally rebuilt artifact may differ and is not a substitute.

For the currently reviewed rollout the portal source is
`cffcf2420c651f6f9a407d43bd6b7f4f7e8fc554`; the unchanged API baseline is
`ce544cef714ee524d935ef1f8def78411bf9052e` and public migration metadata is
`0103_payment_readiness_attestation`. Do NOT use the portal branch's later source
migration head as the hosted API expectation.

Generate a JSON manifest from that retained artifact (all asset files, including
lazy chunks, not just index references). Example, after verifying build provenance:

```js
// Run from the approved artifact root containing index.html and assets/.
const fs = require('node:fs'), crypto = require('node:crypto');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const assets = fs.readdirSync('assets').filter(f => /\.(js|css)$/.test(f));
console.log(JSON.stringify({
  portalCommit: 'cffcf2420c651f6f9a407d43bd6b7f4f7e8fc554',
  apiCommit: 'ce544cef714ee524d935ef1f8def78411bf9052e',
  migrationHead: '0103_payment_readiness_attestation',
  attentionVisibility: false, attentionAcknowledgment: false,
  htmlSha256: digest('index.html'),
  assets: assets.map(f => ({path: '/assets/' + f, sha256: digest('assets/' + f)}))
}, null, 2));
```

Then, only when the independent rollout owner releases the verification step:

```
node scripts/portal-release-smoke.mjs https://PORTAL_HOST https://API_HOST approved-manifest.json
```

The checker uses HTTPS roots, no URL credentials, no cookies, bounded responses
(4 MiB each /16 MiB total), 5-second per-request deadlines and a maximum 64 assets.
All errors are fixed codes without raw response bodies, URLs or transport errors.
Redirects fail closed. Known QA URLs may return 404/410 or exactly the ordinary SPA
shell; SPA fallback alone is not a leaked fixture. Known fixture sentinels fail.
This samples the two checked-in QA entrypoints, not every conceivable server file.

A passing result proves byte agreement with supplied trusted artifact evidence and
public API metadata/health at observation time. It does not prove authenticated
routing, actual Google OAuth, tenant isolation, runtime flag behavior without trusted
build evidence, database migration attestation, a complete server exposure audit,
provider readiness, or production readiness. Use existing authenticated attestation
only under its separate authorization; this checker intentionally never calls it.
