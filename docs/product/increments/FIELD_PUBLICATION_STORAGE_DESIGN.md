# Field publication storage design

Parent c21f3d404769bc921939d2711eb8ec5900c3dcb6. Branch codex/wave3-field-publication-storage-design. Design only; no SQL or application implementation in this increment. W3 publication remains BUILDING.

## Actual compatibility constraints

Independent architecture /root/editor_design_review_2043 (3a54ea/8c295e) and adversarial /root/next_leaf_review_1941 inspected existing storage. Migration0016 flow_versions uniquely identifies a publication by tenant, flow and parent source revision. Migration0035 lets a V3 sidecar change without changing its parent revision. Therefore that existing identity cannot represent successive field snapshots. Never overwrite or attach new field data to an already issued immutable version.

Existing configurable publication also creates installations and activates flows. Existing mode installations and sessions bind legacy published versions and support their current render schema families. Calling those publishers, inserting a field snapshot as a legacy render schema, widening readers or changing an active pointer would cross the authorized storage boundary. Preserve all existing migrations and contracts.

## Selected additive namespace

Proposed table field_publication_versions_v1 stores immutable FieldPublicationV1 envelopes. Use a globally unique artifact UUID plus composite tenant/flow/version uniqueness, FK tenant/flow to flows, and uniqueness on tenant/flow/source parent revision/source field draft revision. The artifact UUID is not an existing customer runtime version ID.

Require exact envelope keys/discriminators, matching row/envelope identities and revisions, positive safe-integer revision bounds, valid bounded V3 definition and unconfirmed_request mode. Reuse existing V3 SQL validator without modifying it; prove TypeScript/SQL parity. FORCE RLS; revoke direct privileges from public, anon, authenticated and service_role. Reject UPDATE/DELETE with immutable triggers; do not grant mutation or TRUNCATE. Security-definer routines use pg_catalog search_path and qualified objects. Privileged database-owner capabilities are outside the application-role guarantee.

Proposed owner-only RPC takes actor, tenant, flow, both expected revisions and a server-supplied new artifact UUID. It never accepts a definition or publication envelope from the caller. First lumin.flow_actor(actor,tenant,true), preserving tenant/member locks, then nonarchived flow FOR UPDATE, parent FOR SHARE (authoring version2), existing family3 check without claiming/converting, sidecar FOR SHARE. Require expected parent=current parent=saved parent and expected draft=current draft. Build snapshot only from locked authoritative rows, insert and return its exact finite contract in the same transaction.

First implementation deliberately rejects duplicate artifact UUIDs and duplicate source pairs with a finite conflict; it does not promise idempotent replay. A later retry journal requires its own reviewed namespace and authorization-before-replay. Reuse of an artifact with changed sources must never replace data. All denial/conflict/error paths roll back. No status, active pointer, installation, session, legacy publication or provider changes.

This is an owner-authenticated database boundary, not proof of HTTP identity. Actor UUID must ultimately come from a separately verified server authentication path. No browser-supplied actor or service-role credentials.

## Verification and dependency DAG

1. Re-read current migration inventory and allocate the next additive number under root integration ownership; 0035 is currently last. Do not preempt another cell or alter accepted migrations.
2. Builder owns new migration only; independent test cell owns a separate SQL attack fixture. Architecture reviewer has no edits. Root owns bounded disposable runner integration, source pins, strict receipts and evidence. No API or public consumer in this storage leaf.
3. SQL parity covers exact envelope identity, field/choice bounds and malformed input against the existing TypeScript contract. Deny foreign owner, staff, removed membership, suspended tenant, archived flow, missing parent/sidecar, wrong family and forged identity. Verify every denial leaves all affected rows unchanged.
4. Prove either stale token and saved-parent mismatch fail without rebasing. Same parent with a newly saved field revision can create a distinct artifact; duplicate pair and reused UUID reject under the explicit policy. UPDATE/DELETE and direct role access fail.
5. Independent connections prove races with parent edit, sidecar save, archive, family mutation and owner revocation. Honor tenant/member -> flow -> child lock ordering. Publication may succeed before a waiting revocation commits; after revocation commits first it must fail. Confirm exact final rows and no mixed revision snapshot.
6. Inject insertion/transaction failure and prove no artifact or legacy pointer/installation/session mutation remains. Assert unchanged existing customer runtime behavior and no V3 admission.
7. Run fresh disposable public and extensions database layouts, regression suites and independent actual-artifact/connection-closure review. Preserve existing deadlines; extend runner only through reviewed source pins/receipt counts. Native cleanup and custody proof are required, not inferred from process exit.
8. Builder -> unit/SQL -> domain -> independent -> adversarial -> integration -> Runtime -> exact-candidate CI -> Release. Failed gates return to builder. Review publication does not authorize deployment or live migration.

Later dependency: an explicitly new aggregate publication contract may bind a parent published version and this field artifact, followed by separately versioned installation/session/runtime consumers. Do not retrofit old installations or assume the field artifact alone includes parent workflow policy. HTTP, installation, renderer and hosted acceptance remain subsequent gates.

## Evidence and status

Heartbeat2026-09-20T04:50Z read workflow/ledger b59c95, clean parent; branch497d75. Main152bb909c06fa8602d99f8b37d2cfe9f90aa5ead protected flag; PR74 open/draftc53debbaa9e6fa2acc7bfe2aca96026e4450a194 unchanged. Parent c21f3d4 Actions0. Detailed branch-protection403 and collaborator422 draft-PR blocker remain unresolved; no bypass or invented review. Root inspected0035 locks/RPC grants5f4da9 and current V3 native supervisor/source pins e36cf3. Architecture and threat findings above are design evidence only, not SQL race tests or runtime acceptance.

Root is document builder/integration; /root/editor_design_review_2043 independent domain/architecture/Runtime-design reviewer; /root/next_leaf_review_1941 independent adversarial reviewer. No implementation builder dispatched. Final document review and ledger validation pending. W3-W8 incomplete; W9 excluded. Real providers, live migrations, deployments and merges remain untouched.
Implementation wire detail from independent reviewf9dd50: PostgreSQL UUID values serialize canonically in lowercase; TypeScript pure contracts preserve accepted spelling. SQL-produced snapshots should use canonical authoritative UUID output, with explicit parity tests for mixed-case supplied IDs. Do not promise database preservation of input spelling. Exact source/target identity comparison must remain consistent with the selected boundary.

Validation02a452: ledger8/8 and whitespace passed. Scope89e5d6 confirms document and ledger link only. Independent architecture/domain/Runtime-design f9dd50 accepted this design publication; no SQL/native/implementation approval. Fresh mainCI34298760622 and PR74CI34743351848 remain successful only for their older exact heads. Exact design-candidate CI and Release remain pending.
## Adversarial review correction

Independent reviewc7226f returned a missing explicit function-privilege requirement to root. Table revocations do not remove PostgreSQL default PUBLIC EXECUTE on functions. The migration must revoke EXECUTE on every new RPC and helper signature from PUBLIC, anon, authenticated and service_role, then grant only the intended owner RPC signature to service_role. Helpers remain unexposed. Tests must prove anon/authenticated cannot call the RPC even with a valid owner's UUID, unrelated helper execution is denied, and service_role direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE remains denied. This requirement supplements table RLS; it does not replace authenticated server actor derivation.
Corrected design accepted by independent adversarial reviewer60f6a5 and final architecture/Runtime-design68923f after actual rereads. The failed initial privilege-specification gate was returned to root and corrected before publication. These approvals cover the document only; all migration, SQL attacks, race tests and native qualification remain outstanding.
