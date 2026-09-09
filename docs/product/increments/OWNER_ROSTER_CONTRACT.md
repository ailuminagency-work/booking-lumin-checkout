# Owner roster API/UI contract

Status: accepted bounded owner-roster contract after architecture, SQL and independent security review. Foundation PR38 passed exact CI; migration0023 is allocated to the snapshot. Shared contracts are reviewed; snapshot/API/UI implementation and integrated release gates remain in progress. This is not full W4 or hosted acceptance.

## RPC inventory and exposed scope

The foundation has exactly seven public service-only RPCs: roster_provision plus six mutations roster_worker_put, roster_access_put, roster_crew_put, roster_crew_member_set, roster_eligibility_put and roster_shift_put. Every result is bigint current/new roster version. The API exposes provisioning and the five non-access mutation functions only. Initial Owner Portal exposes workers, crews, membership and eligibility edits; shift mutation endpoints are retained solely for the explicit harness and a future friendly editor. Dated shifts are read-only in the initial UI. Worker login/access binding, invitations, jobs, assignment visibility and execution are not part of this surface. Operational workers need no login bridge.

One new snapshot RPC is proposed: `public.owner_roster_snapshot(p_actor uuid,p_tenant uuid) returns jsonb`. It uses the same trusted verified actor/current active owner checks. Missing roster state produces stable ROSTER_NOT_INITIALIZED; GET never provisions or writes. Successful snapshot takes roster FOR SHARE before reading children and keeps the fence through response validation/COMMIT. After locking, a single SQL statement uses materialized CTEs to count and aggregate all roster collections and the service palette consistently.

Service palette is labels-only and uses that statement's MVCC snapshot independently of the roster fence. It grants no active-policy/capacity/availability authority. Include inactive services so existing eligibility records retain their labels; no filter silently hides referenced services. Existing service FK NO ACTION protects references. Do not acquire a late services SHARE table lock after roster:0022 policy ordering makes that an inverse-lock risk. New eligibility selectors may offer active services only; SQL mutation still enforces tenant/FK integrity, and later allocation independently requires current active service/worker/policy.

## Exact complete snapshot

```text
{
 rosterVersion: positiveSafeInteger,
 workers:[{id,displayName,active}],
 crews:[{id,name,active,workerIds:[UUID]}],
 eligibility:[{serviceId,workerId,active}],
 shifts:[{id,workerId,kind:'available'|'blocked',startsAt,endsAt,sourceTimeZone,active}],
 services:[{id,name,active}]
}
```

All object schemas are strict; IDs UUID, flags Boolean, instants finite offset-bearing ISO strings, version1..9007199254740991. Worker/crew names use1..160 Unicode code points, matching PostgreSQL length(text), not UTF16 code units. JavaScript validation counts Array.from(value).length after rejecting unpaired surrogates/NUL. Nonblank follows PostgreSQL btrim default space removal (U+0020); do not silently broaden whitespace rejection beyond accepted storage semantics. Existing160-emoji names must remain readable. Service labels have no bounded legacy schema constraint and therefore need the explicit projection budget below. No worker_access, auth.users, user/login identifiers, credentials, emails, invitations, customer records or permission details are projected. Labels are approved business content, not a promise of semantic PII scrubbing.

Explicit first-slice maxima:100 workers,50 crews,500 total crew memberships,1000 eligibility rows,1000 dated shifts,100 services; all include inactive/retired entries. Serialized UTF8 snapshot maximum512KiB. Before constructing any jsonb_agg or projected object, evaluate complete counts and projected text bytes. First materialize service metadata (id,active,octet_length(name)) rather than unbounded raw names; after budgets pass, join approved IDs back to the same statement MVCC source for bounded labels. Roster collections use the same materialized source statement. For legacy services.name reject if any octet_length(name)>4096 or the sum of service-label octet lengths exceeds65536; do not truncate or normalize stored labels. Also reject if total projected textual UTF8 bytes across worker/crew labels, service labels and shift timezone labels exceeds131072. These conservative supported-size guards avoid constructing arbitrarily large service-label JSON; they are explicit limits rather than new storage constraints. After raw-byte checks, materialize bounded per-row DTOs and reject if their summed serialized UTF8 size already exceeds524288, before the collection jsonb_agg. Execute aggregation only in the successful budget branch (for example a short-circuit CASE with aggregate subqueries consuming the same materialized sources); a final outer filter after an eager aggregate is insufficient. Check final serialized UTF8 JSON size<=524288 after bounded aggregation to account for escaping, keys and fixed fields. Count complete scoped sets before aggregate/return; if any bound is exceeded, reject the entire response with stable ROSTER_TOO_LARGE/HTTP422. Never silently truncate members, blocked shifts or history and call it complete. Future pagination needs a separate versioned contract, not a limit silently added to this one.

Workers/crews/shifts/services sort by UUID; each crew's workerIds sorted UUID and unique; eligibility sorts serviceId then workerId. Validate every referenced worker/service exists in this complete snapshot and every ID is unique. Source timezone must pass the accepted registry. The snapshot is current as of its read; it does not promise service labels cannot change after COMMIT. No service revision token is invented.

## Fixed HTTP and mutation bodies

Use existing local owner transport with verified actor and exactly one tenantId query selector. Reject client actor/role/table fields, unknown body keys and ambiguous repeated queries. Owner API must deny staff, worker and platform identities lacking current explicit ownership; no role escalation. Missing real verifier fails closed; synthetic local adapter remains explicitly local.

| Method/path | Strict body | Typed RPC mapping |
|---|---|---|
| GET /api/roster?tenantId | no body | owner_roster_snapshot(actor,tenant) |
| POST /api/roster/provision?tenantId | {} | roster_provision(actor,tenant) |
| POST /api/roster/workers?tenantId | {expectedRosterVersion,displayName,active} | roster_worker_put(actor,tenant,expected,mintedId,name,active,true) |
| POST /api/roster/workers/:id?tenantId | {expectedRosterVersion,displayName,active} | same with pathId,false |
| POST /api/roster/crews?tenantId | {expectedRosterVersion,name,active} | roster_crew_put(...mintedId,name,active,true) |
| POST /api/roster/crews/:id?tenantId | {expectedRosterVersion,name,active} | same pathId,false |
| POST /api/roster/crews/:id/members?tenantId | {expectedRosterVersion,workerId,present} | roster_crew_member_set(...pathCrew,worker,present) |
| POST /api/roster/eligibility?tenantId | {expectedRosterVersion,serviceId,workerId,active,create} | roster_eligibility_put(...service,worker,active,create) |
| POST /api/roster/shifts?tenantId | {expectedRosterVersion,workerId,kind,startsAt,endsAt,sourceTimeZone,active} | roster_shift_put(...mintedId,worker,kind,start,end,zone,active,true) |
| POST /api/roster/shifts/:id?tenantId | same shift body | same pathId,false; worker identity immutable |

Expected mutation version1..9007199254740990; maximum version can be read but cannot increment. No caller-generated new IDs, arbitrary updates, physical identity deletion or owner access-binding endpoint. Worker/crew/shift retirement uses active=false. Membership removal changes the relationship under the fence. Eligibility retirement uses active=false; create intent is explicit and cannot overwrite an existing pair.

Mutation receipt is `{rosterVersion,entityId}` for worker/crew/shift, `{rosterVersion,crewId,workerId,present}` for membership, `{rosterVersion,serviceId,workerId,active}` for eligibility. IDs/intent come only from the validated path/body/server-generated request context; SQL presently returns only bigint, so do not claim an ID echo was independently checked. Repository must validate returned bigint equals expectedRosterVersion+1 before COMMIT. Provision receipt `{rosterVersion}` is positive bounded bigint; it is idempotent initialization/current-version retrieval and does not claim expected+1 semantics. SQL typed route mapping, row checks and real persistence tests establish correct target mutation. Any future structured SQL receipt must bind its IDs and version to exact request parameters before COMMIT.

No durable idempotency receipt is introduced in this slice. A lost mutation response leaves outcome uncertain. If the original committed, retrying its old expected version must conflict; if it did not start or rolled back, the same expected version may legitimately succeed once. UI refreshes first and lets the owner reconcile the persisted result before another mutation. Do not auto-increment local version or retry a failed create with a fresh expected version. ExpectedRosterVersion is a roster CAS, not booking/allocation generation or worker permission version.

All database adapter calls remain fixed parameterized function signatures, BEGIN/scoped service role/result validation/COMMIT. Invalid result or error rolls back; stable errors contain no SQL/caller payload. Existing32KiB HTTP body cap suffices for one narrow mutation; snapshot response has separate512KiB cap. NUL/unpaired-surrogate input rejects stably before PostgreSQL transport; legitimate Unicode remains supported.

## Portal behavior and state

Add a bounded operational roster area in the approved Workers section: editable workers and crews with active/retired state, crew member controls and per-worker service eligibility. Show dated available/blocked shifts read-only, with clear human-readable dates/times and the named timezone. Use approved names in selectors; IDs are internal routing keys. No online status, job totals, allocation success or workforce availability is fabricated. An inactive entity remains visible and clearly labeled in this complete snapshot.

Render loading, empty, uninitialized, too-large, permission-denied and unavailable states explicitly. Uninitialized shows an owner-triggered setup action; GET does not create records. Retain unsaved edits when save fails. Conflict explains that the roster changed and offers refresh/review; do not overwrite with a stale response. Every successful mutation refreshes snapshot before enabling a new edit. A failed post-save refresh shows that the change was saved but the view could not refresh, and blocks further version-dependent edits until recovery.

Use one active mutation at a time per client snapshot. Invalidate requests on tenant/logout/credential/entity changes; check generation after awaited JSON body parsing before state writes. Success for an old context cannot replace current context or show a false save indicator. Do not persist owner credentials in localStorage. Shared router/client files require explicit ownership coordination before parallel work.

Initial UI has no shift edit controls, ISO textboxes or technical timestamp entry. A future friendly date/time and timezone editor must have tested DST gap/fold conversion before release; do not infer authoritative UTC from browser timezone. Strict offset-bearing shift API endpoints may remain for the explicitly local harness and future editor, but they are not evidence of editable scheduling UX. Existing read-only shifts are data, not proof that a booking can be allocated. Shift editing and full scheduling UX remain deferred.

## Gates and ownership proposal

SQL cell owns only new snapshot function/tests in a root-allocated future migration, never edits accepted0021. API cell owns action-api fixed schemas/repository/routes and real local PG HTTP tests. UI cell owns narrow flow-ui roster client and Portal roster components under agreed file ownership. Root owns manifests/lock/CI/shared composition. No builder starts until interface is reviewed and0021 exactCI is accepted.

Acceptance: real local HTTP provision/create/edit/reload, complete snapshot with inactive members/blocked shifts, size-bound fail-closed tests, no login fields, owner/tenant isolation, swapped IDs, immutable worker/shift identity, CAS conflict and result mismatch rollback beforeCOMMIT. Roster mutation versus snapshot lock must produce a coherent before/after state; service-label writes may change between snapshots but one materialized read remains coherent. UI tests late responses after logout/tenant switch, lost receipt conflict, post-save refresh failure and immutable create/update intent. Run existing protected owner/checkout tests, independent/adversarial review, Integration/Runtime/CI/Release gates. Local synthetic verification is not production Auth, hosted deployment or worker execution proof.



# Owner roster contract freeze

Root approves the amended wave4-roster-owner-contract.md after architecture/SQL/security design review and exactPR38CI34402679136 success. Builders use accepted basee255ae0.0023 is reserved for owner snapshot;0022 remains the separate policy boundary. Implementation evidence is still required.

Count and byte budgets are conservative supported-subset limits, not a promise to admit every payload smaller than512KiB. Oversized snapshots reject completely. Empty legacy service labels remain representable (the UI may show a plain unnamed-service fallback); no new service storage constraint is implied.

The snapshot emits UTC timestamps with six fractional digits and Z. Supported UTC year domain is0001–9999 inclusive; existing finite PostgreSQL dates outside that transport domain reject the complete snapshot with ROSTER_UNSUPPORTED_TIME. New HTTP shift input must preserve up to microsecond precision and explicit offset; do not round instants to milliseconds when checking interval order or silently normalize an invalid calendar date. PostgreSQL remains the final interval authority. API/shared-schema cell coordinates exact timestamp validation with SQL; initial shift UI is readonly.

Snapshot SQL errors:42501 FORBIDDEN→HTTP403; P0002 ROSTER_NOT_INITIALIZED→HTTP409;54000 ROSTER_TOO_LARGE→HTTP422;22008 ROSTER_UNSUPPORTED_TIME→HTTP422. Mutation40001 roster/entity/version conflict→HTTP409. Malformed HTTP bodies/queries return400 before SQL; database constraint/invalid-input failures map to a stable generic client error without SQL details. Unexpected/malformed repository results roll back and return a server error. These names are allowlisted, never passed through from arbitrary SQL messages.

PostgreSQL is the source timezone registry. Do not silently substitute Intl support as a restriction on reading existing valid PostgreSQL zone labels. A browser that cannot format a recorded zone uses a clearly labeled UTC display fallback. There are no raw ISO timestamp input boxes in the initial owner UI.

Ownership: baseline_context SQL0023/tests; architecture_audit shared contracts and action-api; security_audit flow-ui client and Portal components. API cell commits shared contract exports early for UI consumption. Root owns combined lockfile/CI/integration and review rotation. No shared dependency installation or root node_modules retargeting during parallel work.
