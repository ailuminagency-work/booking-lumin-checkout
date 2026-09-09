# Wave 3 shared interface — APPROVED W3.1 contract

Base: verified W2 `7d3aa25`. Root approved implementation with the amendments below. W3.1 is a local increment; parent W3 staging/auth/browser acceptance remains open. Cell A SQL, Cell B HTTP/repository, Cell C browser must use this document rather than invent parallel formats.

## Bounded supported shape

Reuse ServiceQuestion kinds single_choice, multi_choice, quantity and Selection.answers semantics. DB `service_questions.question_key` maps to public question `id` (not the row UUID); choices use their stored opaque choice IDs. SQL tenant+service joins must check child tenant explicitly. W3 supports active simple services with zero base price, zero tax, no items/add-ons/rental configuration, no priced questions (unit_price0, choice priceDelta0/default and priceMultiplierBp10000/default). It promises a request only, never a free guaranteed booking.

Proposed first runnable config subset: WorkflowConfig `{key,steps}` where each step is `{key,questionKey,kind:'question',required:boolean}`. All selected service questions appear exactly once; required matches authoritative service question.required. Reordering is supported. Conditional DSL, info/warning steps, pricing effects and other fields reject with UNSUPPORTED_CONFIG for this first journey, even though the general publication contract supports more. This removes inconsistent SQL/JS conditional interpretation from the cut line. Root may approve wider support in a later increment.

Public ServiceRender: `{id,name,durationMinutes,questions:[{id,prompt,kind,required,choices:[{id,label}],minQty?,maxQty?}]}`. Duration5..1440 minutes;1..50 questions; IDs1..100 chars; prompts1..500; choices at most50 with unique IDs, required nonempty for choice fields; labels1..200; quantities integers0..10000 and min<=max. Default quantity limits0/10000 when DB null. Single choice accepts exactly one selected ID when answered; multi choice accepts distinct valid IDs; optional unanswered is omitted. Quantity answer has only quantity; choice answers only choiceIds. Reject unknown answer keys and prices. Service response includes no tenant, currency, pricing, customer or internal columns.

## HTTP DTOs

All success responses `{ok:true,data:T}`; errors `{ok:false,code}` from INVALID_REQUEST(400), UNAUTHENTICATED(401), FORBIDDEN(403), CONFLICT(409), NOT_AVAILABLE(404), UNSUPPORTED_CONFIG(422), INTERNAL_ERROR(500), RATE_LIMITED(429). Error messages contain no SQL/input strings. JSON max32KiB; strict object properties. Date input ISO8601 offset/Z converted UTC before repository call. Credentials only in Authorization Bearer headers; never query/URL/log.

Owner tenant selected by query `?tenantId=UUID` on all owner endpoints; this is an untrusted selector checked against authenticated current membership. Owner credential maps server-side to user UUID, never from request headers/body. Reads require member, saves/publish current owner. Synthetic LOCAL_HARNESS auth uses a fixed opaque credential→user map; real mode has no fallback.

| Endpoint | Body | data |
|---|---|---|
| GET /api/services?tenantId= | none | `{services:ServiceRender[]}` |
| GET /api/requests?tenantId= | none | `{requests:[{id,reference,state:"draft",slotStart,createdAt}]}` |
| GET /api/flows?tenantId= | none | `{flows:[{flowId,name,status,revision,serviceId,publishedVersionId}]}` |
| GET /api/flows/:flowId/draft?tenantId= | none | `{flowId,name,revision,serviceId,config,service:ServiceRender}` |
| POST /api/flows/:flowId/draft?tenantId= | `{expectedRevision,serviceId,name,config}` (revision0 creates) | `{flowId,revision}` |
| POST /api/flows/:flowId/publish?tenantId= | `{expectedRevision,allowedOrigins:[exactHttpsOrigin]}` | `{versionId,installationId,hostedPath:'/checkout/flow/:installationId'}` |
| POST /api/installations/:installationId/sessions | `{}` plus exact Origin header | `{sessionToken,expiresAt,render:{versionId,config,service:ServiceRender}}` |
| POST /api/flow-sessions/request | `{idempotencyKey,answers,customer:{name,email},requestedStart}`; session bearer+same exact Origin | `{reference,state:'draft',confirmed:false}` |

Owner list/detail use fixed projections with stable ordering and max100 rows; unbound legacy flows may list serviceId:null and are not customer-publishable. Draft GET for an unbound legacy flow returns NOT_AVAILABLE until service binding exists. Browser generates a UUID for new flow ID. Server generates publication/install IDs. Token is cryptographic32 random bytes base64url; store SHA256 hex only. Session expiry server-set15minutes. Customer name trimmed1..200/email trimmed valid bounded254; idempotency16..128. Customer body contains no tenant/service/version/price/state. Same token+key+normalized payload retry returns same reference; same key changed payload conflicts. Store request provenance even when there is only one submission per session; another key after submission conflicts.

## Exact proposed SQL RPC contract (public schema, all service_role-only)

Service-role transport is narrowly limited to these commands. Owner actor UUID comes only from verifier; SQL independently checks current member/owner and tenant active. No generic table HTTP API. Each RPC returns one jsonb object, not SETOF; numeric revisions remain JSON safe integers.

- `flow_owner_services(p_actor_id uuid,p_tenant_id uuid) returns jsonb`: `{services:[...]}`.
- `flow_owner_requests(p_actor_id uuid,p_tenant_id uuid) returns jsonb`: `{requests:[...]}` fixed draft projection ordered created_at DESC,id DESC max100.
- `flow_owner_list(p_actor_id uuid,p_tenant_id uuid) returns jsonb`: `{flows:[...]}`.
- `flow_owner_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid) returns jsonb`: draft DTO above.
- `save_bound_flow_draft(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_service_id uuid,p_expected_revision bigint,p_name text,p_config jsonb) returns jsonb`: `{flowId,revision}`. Lock and CAS service binding/config/name together, validate exact supported config/service schema and current owner.
- `publish_bound_flow(p_actor_id uuid,p_tenant_id uuid,p_flow_id uuid,p_expected_revision bigint,p_version_id uuid,p_installation_id uuid,p_allowed_origins jsonb) returns jsonb`: `{versionId,installationId}`. Derive immutable safe service snapshot from authoritative service/questions, never caller JSON; lock/check current draft; publish atomically.
- `issue_flow_session(p_installation_id uuid,p_token_hash text,p_origin text) returns jsonb`: `{expiresAt,render:{versionId,config,service}}`. SQL chooses expiry, pins complete tuple and checks exact allowed origin plus live active service/tenant.
- `submit_flow_request(p_token_hash text,p_origin text,p_idempotency_key text,p_answers jsonb,p_customer jsonb,p_requested_start timestamptz) returns jsonb`: `{reference,state:'draft',confirmed:false}`. SQL derives canonical request hash, authoritative pinned duration/end, validates answers and customer/future start, locks session, enforces expiry/revocation/origin/active references and exactly one draft/provenance/outbox transaction. Exact same request retry must return stored receipt before future-time revalidation can invalidate a completed receipt; expiry/revocation/current active tenant+service/origin are rechecked on every retry and fail closed; only past requestedStart validation is skipped for an already committed same-payload receipt.

SQL error codes:42501→FORBIDDEN;40001/23505→CONFLICT;22023/23514→INVALID_REQUEST;P0002→NOT_AVAILABLE; use SQLSTATE0A000 for unsupported compatible-service/config shape. Unknown database errors→INTERNAL_ERROR. Do not expose SQL error text. Service lookups and schema construction must validate malformed/nonzero-price choices, not silently strip them into a supported service.

## Driver, composition and local authentication

Audit: no pg/postgres driver or tsx currently installed in repo node_modules. Proposed dependency request to root: `pg` runtime and `@types/pg` development in packages/action-api; root alone installs/updates lock. Existing TypeScript compiler can emit a dedicated server build; alternatively root can approve tsx local runner. No subprocess psql per web request in production.

A local Node HTTP server composition root within packages/action-api/server uses a parameterized pg adapter (fixed RPC allowlist, transaction-scoped SET LOCAL ROLE service_role; pool connection released/rollback on all paths). Disposable local bootstrap alone connects as postgres to synthetic DB. Serving query role is service_role with no generic SQL endpoint. Production database credential/verified-auth composition absent means startup fails closed. Local mode binds127.0.0.1 and requires explicit LOCAL_HARNESS/disposable DB allowlist; opaque synthetic owner token is test-only and not a Supabase credential.

Auth fixture uses existing auth.users and tenant_members with two synthetic tenants and owner/staff/platform IDs. Owner RPCs independently recheck membership. API must expose a local-harness badge/health metadata so UI cannot claim real authentication. Fixture login can be a fixed local test token entry owned by Cell C; no production password login is implemented. Portal's existing Supabase path remains intact.

## Browser/TLS evidence boundary

Do not bypass browser certificate interstitials or disable certificate verification. Use an already trusted local certificate if available and explicitly authorized. Otherwise perform owner UI over local HTTP, then automated loopback HTTP requests with exact synthetic HTTPS Origin to test origin comparison and SQL persistence. Those tests do not prove browser CORS/TLS or full customer-browser journey. Keep the latter pending until trusted TLS is available. Never loosen installation HTTPS/DNS policy to permit HTTP origins merely for a green demonstration.

## Cell handoff

A implements exactly these names/DTOs, SQL validation and fixtures/races; B implements HTTP validation/parameterized adapter/server/test bootstrap; C owns thin browser client and UI. New packages/action-api server/dependency edits await root approval. Root approves the narrowed unconditional questionnaire subset and dependency choice before implementation. Changes to this interface are announced to all cells before code divergence.

## Approved implementation amendments

Root approves pg runtime, @types/pg and tsx development dependencies in packages/action-api (root owns install/lock). Owner/member local request list is mandatory; it cannot use the unrelated existing Supabase list to prove local PG persistence. Two generic synthetic zero-priced service fixtures (quantity+single choice and multi choice+quantity) use the same engine/UI, no vertical source branches. HTTP/server package owns local bootstrap; UI credentials remain memory-only. Proposed UI flags VITE_FLOW_LOCAL_HARNESS=true and VITE_FLOW_API_URL select explicit local harness independently of existing Supabase path; production serving remains disabled until real auth composition. All role/tenant checks remain server-side. Root coordinates any preview environment validator changes, not this cell.
