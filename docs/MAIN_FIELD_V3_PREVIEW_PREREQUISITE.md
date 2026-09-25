# V3 field question preview prerequisite

This isolated Wave 3 review branch restores an owner-only, unmounted question preview as a local rehearsal of the V3 field contract. It consumes the main-based workflow parser and supports only the current text, textarea and dropdown field types. Answers stay in component memory. The preview has no submit or persistence path and grants no tenant, booking, payment, publication or customer-runtime authority.

Any future host must pass a new `resetKey` object when its account, tenant or customer context changes. The component resets when the parsed definition or `resetKey` identity changes; a host that reuses the same key with an unchanged definition would retain local rehearsal answers. Mounting requires an independent privacy review of that host contract.

Base: `160f98fd36341721edc9d8f04ea869b6c2de0151` (`codex/main-field-v3-client`). The component is deliberately not mounted in the Portal or customer checkout. Connecting an editor or runtime still requires the authenticated API/storage reconciliation, independent reviews and hosted acceptance described in the Wave 3 dependency map. No SQL migration, provider credential, live deployment or main change belongs to this candidate.

## Candidate gates

Builder: `/root/field_publication_export_builder` owns the preview component and its source-adjacent tests. Root `/root` owns the package export and this evidence note. The builder passed the focused 27/27 normal and adversarial tests and flow UI typecheck. Root passed the full workspace test suite under Node 20, full workspace typecheck, all production builds and the contamination check (with pre-existing generic template warnings).

Independent reviewer `/root/field_v3_reviewer` passed domain, security, adversarial, integration and scoped Runtime Guardian source review of the final five-path diff after requesting the explicit host `resetKey` requirement above. Exact-candidate CI and Release Governor remain pending until a draft PR and its required checks exist. These local passes do not complete Wave 3 or authorize a live mount.
