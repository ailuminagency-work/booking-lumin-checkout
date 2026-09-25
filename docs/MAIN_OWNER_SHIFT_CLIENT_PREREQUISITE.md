# Owner shift client prerequisite

This isolated Wave 4 review branch adds a typed owner roster shift transport method to the main-based flow UI package. The method has no Portal call site. It cannot grant worker authorization, publish availability, assign jobs or create confirmed bookings. The existing server remains the authority for tenant membership, roster versions, availability, capacity and write permissions.

Base: `0ef6f2cdd070691ed0fb94c82147221ddc8b4a9c` (`codex/main-field-v3-preview`). The change is limited to the existing roster client and its tests plus this evidence note. No API route, SQL migration, provider connection, payment behavior, deployment or protected-main change is included. A friendly shift editor remains dependent on a separately reviewed named-zone and DST conversion contract; this leaf does not introduce a timestamp form.

The inherited roster transport checks generation after fetch and body reads. `invalidate()` rejects a completed stale response but does not abort a stalled fetch or stream and has no client deadline. A future interactive editor needs a separate cancellation/deadline review and must not assume prompt cancellation from this method.

## Candidate gates

Builder `/root/field_publication_export_builder` owns the roster client and its tests. Root `/root` owns this note and integration. The builder passed focused roster tests 14/14 and flow UI typecheck. Independent reviewer `/root/field_v3_reviewer` passed domain, security, adversarial, integration and scoped Runtime Guardian source review after requesting the inherited transport limit above be disclosed.

Root's first full workspace test run hit an unrelated timing-sensitive `modeDocument.adversarial.test.ts` timeout under load. That file passed 72/72 in isolation, then the full workspace suite passed under Node 20 on rerun (flow UI 264/264). Workspace typecheck, production builds and the contamination check passed; the latter reported existing generic template warnings. Exact-candidate CI and Release Governor remain pending until a draft PR and required checks exist. These passes do not certify a live shift editor or complete Wave 4.
