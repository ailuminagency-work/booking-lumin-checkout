# V3 owner question preview candidate

Parent e6ae81cd03117402d08f830cf3da806fbc924caf; isolated successor codex/wave3-choice-preview-v3. Adds owner rehearsal for mixed text, textarea and dropdown definitions using strict V3 parsers. No exports, routes, activation, transport, persistence, publication, pricing, migrations or providers.

## Ownership and acceptance

/root/choice_preview_builder_1941 owns only new FieldQuestionPreviewV3.tsx and unit test. /root/next_leaf_review_1941 independently owns the adversarial test after architecture planning. /root/preview_security_review_1941 performs read-only security/domain and independent review. /root owns integration, serial validation, evidence and ledger. Existing V2 behavior stays intact.

Require exact choice IDs, duplicate-label safety, omission of unanswered dropdowns, required-answer enforcement through parseFieldAnswersV3, exact Unicode semantics, bounded local state, plain text rendering, accessible labels/errors, no enclosing-form submission or serialization/I/O, and definition/context resets before commit including selects. Invalid definitions remove controls without reading accessors.

## Current disposition

Locally validated for review-branch publication: unit/adversarial27, strict compilation, full flow-ui486, ledger8, contamination and independent bounded local Runtime review passed. CI/draft PR access remain blocked on predecessor: must be a collaborator; zero exact e6ae81c Actions runs. No W3, hosted or Release acceptance implied.

## Resume evidence

Heartbeat2026-09-19T19:41Z read workflow/ledger and clean parent. Main152bb909 remains protected with application and database/RLS required checks; PR74 open/draft atc53debbaa9e6fa2acc7bfe2aca96026e4450a194. Ledger5afb62 retains W3/W4 building and hosted/environment blockers. Architecture reviewer approved preview prerequisite before editor integration. Root created successor ceef22; previous branches preserved. Historical timing risks remain in CHOICE_CLIENT_NATIVE_V3.md.

Independent review b937f6 returned source to builder: legal choice ID empty collides with placeholder React key empty. Require an impossible-grammar sentinel and regression. Early targeted d187ff/966553 passed only adversarial11 (unit file not yet present), so not a complete gate and not final candidate proof. Rerun after builder freezes repaired component and both test files. Ledger8/8 and mainCI34298760622 pass unchanged.

Builder bf8355 froze repaired source0A2F5963711331AEBAF74E7AB1686FFF0E99CB6CCF965554558CEC29D3550D77, unit004AB664822DD93BFA9AC9EBE50200696987B1254BD3FC6A0340B6D6DAE7B951; adversarial5E5A75C057C08BA24BB69EF766F27A2D662FECBC87E97FA8A0E10D5C1969B47F. Fix namespaces choice keys with choice- prefix; no collision with placeholder. Independent f1201c accepts repaired source/domain/security and all27 test oracles. Targeted85ac27 passes27/27; strict89713a/47f11e exits0. Full flow-ui03bf74 running unchanged configuration; no acceptance yet.

Full regression03bf74/a40e77 passed486/486 across21files in16seconds with unchanged configuration. Contaminationf33476 clean (existing template warnings); final scope/hash7c48ad matches all three frozen files. Root Integration accepts five-path collection. No SQL/native replay needed for this standalone unexported preview; browser-native interaction and editor/hosted acceptance are explicitly unproven. Independent /root/preview_security_review_1941 final audit12d23e verifies five-path scope, unchanged hashes, whitespace and ledger building status; grants bounded local Runtime acceptance for review-branch publication. CI and Release still required.
