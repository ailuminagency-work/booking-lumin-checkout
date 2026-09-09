# Embed Builder specification

**Status: Accepted target architecture, September 9, 2026.** Implementation proceeds through reviewed increments; current completion and hosted acceptance are recorded in `wave-ledger.json` and `EXECUTION_WORKFLOW.md`. The audit below describes its original inspected baseline, not current deployment. Real provider activation remains separately prohibited.

Evidence baseline: `ailuminagency-work/booking-lumin-checkout` at `fb98a7b9feaadb429ca7656430590d790d394a1a`, inspected September 9, 2026. All evidence paths are repository-relative. P-stream numbers refer to the requested master product organization, not the earlier W-stream labels.

## 1. Outcome and product position

The Embed Builder lets an authorized business user configure a booking/request experience once, preview that same runtime across device sizes, publish a reviewed immutable version, and install it on an allowed website or share a hosted URL. Industry differences are templates and rules over shared fields, resources, pricing and scheduling; they are not separate frontends or engines.

The editor belongs in Business Portal → Embed Builder. The public customer experience stays outside portal authentication and owner navigation. The business's Lumin subscription belongs to platform billing; customer payment configuration belongs to the merchant payment domain. Builder controls cannot create payment authority or make unsupported provider capabilities appear available.

## 2. Current foundation and actual gaps

| Evidence path | What can be reused | What is not built by that evidence |
|---|---|---|
| `apps/portal/src/pages/CheckoutConfig.tsx` | Branding controls, simple preview composition, workflow sample answer interaction | Full flow/field editor, persisted draft, publish lifecycle, functioning CDN embed; current snippet uses `cdn.bookinglumin.example`, static preview price/date and a disabled CTA |
| `apps/checkout/src/App.tsx`, `apps/checkout/src/components/WizardControls.tsx`, `apps/checkout/src/state/checkout.tsx` | Mock checkout step rendering, validation, back/continue, session idempotency, stale-slot invalidation/loading guard | Arbitrary authored/reordered steps or version-pinned published runtime; the mock wizard has a fixed step list |
| `apps/checkout/src/steps/Configurator.tsx`, `apps/checkout/src/steps/CustomerForm.tsx` | Choices, quantities, add-ons, customer/address inputs and mock photo attachment UX | Generic field registry/editor, real file upload, terms/signature capture |
| `apps/checkout/src/connected/ConnectedCheckout.tsx` | Real transport boundary for simple-service unconfirmed request submission | Full priced/held/paid configurable checkout; it explicitly does not reserve availability or take payment |
| `packages/contracts/src/service.ts` | Four archetypes: simple, cart, configurable, rental; service/item/add-on/question/rental structures; price-free customer Selection | Arbitrary text/date/address/file answers inside Selection; service questions currently support only single_choice, multi_choice and quantity |
| `packages/workflow/src/types.ts`, `engine.ts`, `conditions.ts` | Serializable condition DSL, ordered steps, visibility/required rules, warnings, recommendations, disqualification, structural checks | Persisted document/version model, editor commands, all requested field types, publish authorization, comprehensive dependency/resource validation |
| `packages/workflow/src/pricingEffects.ts`, `apps/checkout/src/lib/workflow.ts` | Flow effects map to core pricing inputs; shared effective-selection projection | Client-authoritative totals or a new pricing engine; neither is desired |
| `packages/templates/src/templates.ts`, `registry.ts`, `types.ts` | Generic template factories for junk removal, detailing, housekeeping, vehicle/equipment/tent rental, pressure washing and landscaping | Tenant template adoption/persistence, template version upgrades, a full editor; template build functions are code today, not tenant-authored executable code |
| `packages/media/src/types.ts`, `variants.ts`, `storage.ts`, `gallery.ts` | Tenant-owned media roles/attachments, derivative specifications, mock storage and gallery composition | Production transformation pipeline/CDN, malware scanning, private customer upload lifecycle |
| `packages/resources/src/types.ts`, `availability.ts` | Generic exclusive/pooled resources and overlap planning | Worker identity/login/assignment permissions; crew/technician resource labels are not a worker account model |
| `supabase/migrations/0010_capacity_holds.sql`, `0012_resources.sql`, `0014_capacity_serialization.sql` | Existing server-side hold/resource primitives and interval serialization | Proof that the connected request UI already commits holds or payments; it does not |

Current mock and connected paths must stay explicitly distinguished throughout this proposal. Reusing a renderer or schema is not evidence of working persistence or cross-app synchronization.

## 3. Navigation, screen layout and ownership

Canonical proposed root: `/portal/embed` (flow list/overview). App-relative router paths omit the `/portal` hosting prefix. Selected flow base: `/portal/embed/flows/:flowId`.

| Destination | Route suffix | Content | Lead |
|---|---|---|---|
| Overview | root or selected-flow root | Status, published version, draft differences, readiness and recent changes | P11 / P25 |
| Flows | `/portal/embed/flows` | Search, template/start blank, duplicate, archive, tenant-scoped flow selection | P11 / P9, P10 |
| Steps | `/steps` | Ordered customer stages, enabled/optional states, dependencies, edit commands | P11 / P10 |
| Fields | `/fields` | Field library and selected step's fields, answer types/validation/conditions | P11 / P10, P12 |
| Design | `/design` | Controlled theme/layout tokens and media | P11 / P13, P25 |
| Pricing | `/pricing` | References and explanations for authoritative price rules, preview scenarios | P14 / P11, P9 |
| Availability | `/availability` | Service/resource requirements, schedule inputs and policy references | P6 / P7, P8, P11 |
| Payment | `/payment` | Request/booking mode, allowed merchant capabilities, deposit semantics/readiness | P16 / P8, P14, P11 |
| Tracking | `/tracking` | Allowlisted events/consent configuration, no raw answer payloads or scripts | P22 / P27, P28 |
| Preview | `/preview` | Same-runtime device/scenario preview with safe fake providers | P12 / P11, P25 |
| Install | `/install` | Published flow ID, allowed origins, JS/iframe/hosted instructions, verification | P12 / P11, P28 |
| Publish lifecycle | `/publish` | Validation report, version diff, publish permission, history/rollback | P11 / P10, P12, P23, P28 |

Desktop editor: flow/section navigation, central stage/canvas, contextual properties panel. Top bar shows flow name, save state, draft revision, published version, Preview and Publish. Avoid a developer-oriented JSON screen as the default. A read-only diagnostics export may exist for support, with no secrets or customer answers.

Tablet: optional property drawer and dedicated preview mode. Phone: section navigation, step list, property editing and full-screen preview; do not require three simultaneous columns. Users can make essential edits without drag-and-drop or hover.

## 4. Proposed authoring document and lifecycle

Define separate entities rather than a single mutable blob presented as already published:

- **Flow:** stable opaque flow ID, tenant ownership, name, status and published-version pointer. Flow IDs are public identifiers, not credentials.
- **Draft revision:** editable configuration with revision number, actor, save time and expected revision for concurrency control. Keep service, resource, pricing, media and locale references typed.
- **Published version:** immutable schema version, renderer compatibility range, validated steps/fields/theme, resolved content references and publication audit. Published data contains only customer-safe configuration.
- **Installation:** flow reference, delivery mode, allowed embedding origins, presentation options and permitted success redirect policy. Publishing and installation are separate actions.
- **Runtime session:** server-issued session/version identity, answer state, authoritative quote/hold references and idempotency context. It is not a copy of a privileged editor session.

Lifecycle: New flow → Draft → Validate → Preview/test scenarios → Ready for publisher review → Published version N. Editing published N creates a new draft; it never mutates N in place. Failed validation leaves the current version active. A rejected publish leaves both the draft and current published pointer unchanged.

Autosave is a proposal, not present behavior: indicate Saving / Saved / Could not save; retain unsaved edits; reject stale expected revisions with a comparison/reload flow. Do not silently last-write-win when two staff edit the same document. Draft duplication generates new flow/step/field identifiers and remaps internal references; it does not copy credentials or installation origins by default. Archive hides a flow from authoring lists; unpublish intentionally disables new public sessions and requires an explicit impact summary.

**Version pinning:** open customer sessions use their validated version, not whatever becomes latest mid-checkout. New sessions resolve the currently published pointer. Server quote/hold/payment checks still use current authoritative business constraints. If an in-flight version becomes unsafe or an offer cannot be honored, return a clear review/restart path; never silently change the amount or confirm a stale slot. Rollback repoints to an eligible immutable version after compatibility/security checks and records an audit event; it does not undo existing bookings, charges or records.

Proposed server storage and endpoints belong to P23/P28 design review. This document intentionally does not prescribe live SQL or deploy a Render service.

## 5. Step model and edit behavior

Step types should represent reusable capabilities: service/catalog selection, questions/options, resource/category selection, schedule/date range, customer/contact/address, summary, payment/request submission and outcome. An industry template composes them; runtime branching must use capability/field/rule data rather than `if vertical === rental` style frontend forks.

Supported authoring operations:

| Operation | Expected behavior |
|---|---|
| Add | Choose a supported step type; create stable ID; display compatible fields and required dependencies |
| Reorder | Drag or Move up/down/Move to; validate dependencies before accepting order; explain any rejected placement |
| Duplicate | New IDs and internal reference remapping; no duplicate payment authority or reused answer IDs |
| Remove | Show dependent fields/rules/references and explicit repair options; block invalid destructive removal |
| Enable/disable | Disabled content is absent from customer rendering; associated stale answers/effects cannot influence completion or pricing |
| Optional/required | Author can vary business questionnaire requirements, but cannot disable server-required customer/availability/payment/consent requirements for the selected capability |

Server-required controls must have a visible explanation such as “Required to take payment” or “Dates are required to check availability.” Reordering Payment before its authoritative quote/hold prerequisites must fail validation. An information step can be optional; a financial verification path cannot.

Changing an upstream answer invalidates dependent answers, selected models/resources, quote and capacity evidence as applicable. A retained answer may be available for customer convenience, but cannot contribute a hidden price effect until it becomes valid/visible again. Exact normalization and dependency traversal need P10/P14 approval and server parity tests.

Do not infer that existing `nextState` validation is sufficient for all this. Extend checks for unsupported field kinds, duplicate/reference IDs, unreachable required steps, cyclic dependencies, excessive nesting/size, impossible resource order, incompatible versions and hidden-required policy bypass.

## 6. Field coverage and data rules

Every authored field needs a stable key, localized label/help, typed answer schema, required/visibility rules, default policy, validation limits, sensitivity classification and allowed downstream uses. Field keys are not free-form API property names. Unknown types/properties reject; raw HTML, JavaScript and arbitrary CSS are not field content.

| Requested type | Customer behavior and validation | Current reuse/gap |
|---|---|---|
| Text | Single line, length bounds, plain text; trim for validation without silently changing identifiers | Customer inputs exist; generic answer/editor extension needed |
| Textarea | Multi-line plain text, length bound, no executable markup | New generic field and typed persistence |
| Email | Email input, bounded length, accessible errors; do not treat UI validity as verified ownership | Customer form reuse; generic field support needed |
| Phone | Country-aware presentation and normalized value; accept international formats, no hidden country assumption | Customer draft exists; shared field/localization work required |
| Number | Integer/decimal rules, unit and min/max; finite values only; locale-aware display | New generic numeric answer; do not reuse monetary total as customer authority |
| Quantity | Integer stepper/input, min/max and unit | Existing question/item primitives reusable |
| Dropdown | Stable choice IDs, one permitted choice, empty prompt/required state | Reuse single-choice semantics; add renderer/editor |
| Radio cards | One choice with text/image/description, keyboard radio semantics | Existing choice renderer and media composition reusable |
| Checkbox | Boolean acknowledgement or multi-select as explicitly typed variants; no ambiguous mixed answer shape | Multi-choice semantics exist; standalone boolean field needs schema extension |
| Date | Calendar date with explicit business meaning/timezone; no accidental UTC day shift | Scheduling helper reuse; generic date-answer support needed |
| Time | Time selection with date/timezone dependency; distinguish requested time from available slot | Existing SlotPicker concepts reusable; typed field policy needed |
| Date range | Start/end, end-after-start, min/max period, timezone/DST and turnaround rules | Rental period count exists; actual range authoring/answer contract is a gap |
| Address | Structured country/region/city/postal/street fields; service area checks server-side | Customer Address contract/UI reusable; not a generic question answer today |
| Postal code | Country-aware string, preserve leading zero; no universal numeric-only assumption | Reuse address semantics; shared renderer/config needed |
| Image cards | Choice IDs plus tenant-approved image variants and alt text; text fallback | Media and choice primitives reusable; no image URL as authority |
| Resource selector | Eligible resource IDs from tenant/time-scoped availability; stale selection invalidates | Resource planner/model reusable; connected filtered selector and server validation needed |
| File/photo | Restricted type/size/count, upload progress/retry, tenant/session binding, scanning/private access policy | Current attachment is mock bytes, not a working upload pipeline |
| Acknowledgement | Explicit unticked boolean with recorded content/version and timestamp | New typed answer and retention policy; not blanket marketing consent |
| Terms | Versioned terms reference, explicit acceptance, accessible readable content/link | New model and server-required completion rule where applicable |
| Signature | Future field, disabled in initial authoring catalog | Defer collection/security/storage policy |
| Location picker | Future coordinate/place selection with accessible manual alternative | P20 future; defer provider activation and location collection policy |

The existing `Selection.answers` contains choice IDs and quantities. Do not cram text, files or dates into choice IDs to avoid a schema change. P10/P12/P28 must define a versioned answer envelope that maps supported commerce inputs to existing Selection and retains necessary non-pricing answers under separate access/retention rules.

Do not add automatic identity-document upload to rental driver information. Collect the minimum declared business requirement; any sensitive document collection is a separately reviewed capability. File uploads, driver/contact details and full addresses must not enter generic analytics or public published configuration.

## 7. Conditions, templates and cross-industry journeys

Reuse the serializable DSL from `packages/workflow/src/types.ts`: `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte`, `answered`, `includes`, composed with `and`, `or`, `not`. The editor offers readable “When… show/require/warn…” controls and compiles data; no scripts/eval. Add type compatibility and bounded expression complexity. All server-required conditions are checked again outside the browser.

| Template scenario | Proposed ordered experience | Shared configuration, not special frontend |
|---|---|---|
| Junk removal | Item/load quantities → access/stairs details → optional photos/add-ons → service address/schedule → customer → summary/payment or request | Cart/quantity, conditional questions, private photo field and generic scheduling/address modules |
| Housekeeping | Service/property → bedrooms/bathrooms → package/add-ons → one-time/recurring choice when supported → schedule/address → customer → summary/payment or request | Quantity fields, add-ons, recurring capability gate, schedule and address |
| Car detailing | Vehicle type → package → add-ons → mobile/shop → schedule → customer → summary/payment | Image/radio choices; mobile address shown conditionally; resource/location requirements derive from choices |
| Vehicle rental | Category → date/time range → available models → extras → driver/contact information → deposit/summary/payment | Category filters, range field, generic resource selector, extra items and deposit policy |
| Equipment rental | Category/equipment → dates → available units/quantity → delivery/pickup/add-ons → customer → deposit/payment | Same resource/range/quantity/address modules |
| Tent/event rental | Product/category → event range → available sizes/quantity → delivery/setup → address/customer → deposit/payment | Same primitives; capacity tied to units/pools rather than a tent-specific engine |

**Resolve the rental ordering conflict explicitly:** a customer may browse categories/model descriptions before dates, but those cards must say “Enter dates to check availability.” The default publishable flow collects dates before showing an authoritative “available models” list. A model-first layout is permitted only as non-authoritative browsing; after dates it must re-filter, clear unavailable choices and require reselection. Changing dates always invalidates model availability and any hold/quote. No “available” badge can come from a static image catalog.

Templates provide sensible starting field/rule/content data. Template upgrades create a proposed diff into a tenant draft; they cannot overwrite tenant edits or a published version automatically. Existing archetypes remain compatibility presets over one engine. If a template exposes a gap, generalize the shared capability rather than fork the app.

## 8. Design and responsive preview

Allow controlled theme settings: approved logo/media, primary/accent/text colors, font from an approved list, button style/size, card layout, radius, spacing, background, light/dark variants, image fit/focal point, layout density, progress presentation and bounded motion. Enforce contrast and usable minimum control sizes; destructive design values cannot hide required disclosures or controls.

Reuse media roles and variants for card/gallery/hero/mobile. Store asset references and crop/focal metadata, not arbitrary credential-bearing source URLs. Image dimensions reserve layout space; missing assets have accessible fallbacks. Real HD transformations, scanning and CDN execution remain P13 implementation work; current variants are plans.

Preview runs the same versioned renderer and rules as the published flow. Desktop/tablet/phone toggles change viewport, not the business logic. Include keyboard and reduced-motion scenarios, long translations, no images, empty availability, slow load, validation errors, price changes, declined fake payment, expired hold and network retry. Preview sessions use explicit fake providers/test data and cannot reserve live customer capacity or charge money. A builder-side visual approximation of the customer flow is not acceptance evidence.

## 9. Pricing, availability and payment controls

- Pricing settings reference P14's authoritative versioned rules: items, add-ons, choice deltas/multipliers, rental periods and deposits. Customer totals are recomputed server-side from trusted service/rule versions and submitted selections. No arbitrary client expression defines a payable amount.
- Show subtotal, taxes and deposit with precise semantics. A **captured prepayment/deposit** contributes to the verified charged/paid amount; this preserves the existing receipt correction for captured deposits. A **refundable security-deposit authorization hold** is shown separately as authorized, not paid, captured revenue or refundable captured cash. Capture/release/refund each require their distinct provider capability and verified event. Currency display does not perform conversion or change supported merchant capability.
- Availability settings reference P6 schedules/policy, P7 resource requirements and P8 holds. Unknown/unavailable evidence fails closed. Client preview can explain scenarios; only server commitment can reserve scarce capacity.
- Payment options are capability-driven: unconfirmed request, pay-now or approved deposit flow only when supported. Until payment certification and credentials are activated, the UI must remain request-only or explicitly simulated. A builder setting cannot unlock a disconnected provider.
- Platform BillingProvider and MerchantPaymentProvider remain separate. Merchant account, tenant, amount, quote, hold and idempotency references are bound server-side. Duplicate submissions/webhooks cannot confirm twice. Notification/calendar failure must not reverse a valid booking; show synchronization status separately.

## 10. Publish pipeline and security boundaries

Proposed publication sequence:

1. Authenticate publisher and derive tenant permissions server-side; verify expected draft revision.
2. Validate schema/field/condition structure, supported runtime version and complete references.
3. Resolve only tenant-owned service, pricing, media and resource references; reject foreign IDs or private media intended for public config.
4. Evaluate server-required customer, pricing, scheduling, payment, consent and capability rules. Disabled/hidden steps cannot bypass them.
5. Run deterministic scenario checks and configuration security checks; show actionable errors attached to the relevant step/field.
6. Present version diff and impact summary; authorized publisher commits a new immutable version and switches the pointer atomically.
7. Record actor/time/version/check results without customer answers or secrets; emit an allowlisted configuration-published event.
8. New public sessions load that version. Retain previous eligible versions and an audited rollback path.

Threat boundaries: tenant isolation, optimistic concurrency, immutable published versions, public/private config projection, pricing authority, capacity authority and provider account binding are backend concerns. Embedding origin restrictions reduce misuse but are not authentication; browser-provided Origin/Referer or a flow ID must not authorize private data. Rate limits, request validation and abuse controls protect anonymous endpoints.

**Concrete runtime binding:** the server resolves `installId → flowId → published versionId → tenantId` and binds that chain to its runtime session. Quote, capacity/resource hold, customer upload, booking/request and merchant payment actions must carry or resolve the same validated chain. Reject a supplied version/flow/tenant/installation mismatch; never accept a caller's replacement tenant ID because the flow or installation ID is public. Server-owned quote/hold/upload/payment records retain that binding and cannot be reused across another flow/session/tenant. Hosted sessions use the same flow/version/tenant policy through a server-resolved hosted installation context. Public IDs and allowed origins remain distribution identifiers/controls, not credentials or authorization for private records.

P24 AI may propose a draft/configuration diff later. AI output must pass the same schema, permission and publication checks and cannot create new API powers or bypass publisher review. No autonomous AI publication is proposed here.

## 11. Installation modes and security

The Install page must show only a tested published flow. If no version exists, link to validation/publish instead of generating a nonfunctional snippet. Actual deployment origin and loader URL must come from approved environment configuration; do not ship the current `.example` placeholder as usable installation code.

| Mode | Proposed contract |
|---|---|
| JavaScript + div | Stable loader script initializes a designated container using a public flow ID; multiple instances do not collide; supported loader version and published version resolution are explicit |
| iframe fallback | Hosted flow URL in an iframe with required feature/sandbox policy; isolated styles; documented dynamic/fixed height behavior |
| Hosted URL | Shareable public route resolves the published flow without portal authentication or owner tokens |
| Modal | Future mode after keyboard focus, escape, scroll locking, return focus and mobile behavior are certified |

Installation configuration covers allowed origins/domain policy, width/height bounds and responsive sizing, approved language/currency options, tracking consent policy, and success redirect rules. Use exact normalized HTTPS origins; distinguish ports/subdomains and reject lookalike suffix matching. Local development exceptions must be explicitly nonproduction. Cross-frame messages validate origin, source window, instance ID and schema; never broadcast customer details or provider tokens. Provide a controlled resize protocol, not unbounded arbitrary parent-page execution.

Locale must be selected from the published supported locales. Currency is constrained to the service/merchant pricing capability; an embed attribute cannot silently convert amounts or choose a different merchant account. Success redirects are registered/allowlisted HTTPS destinations, reject unsafe schemes/open redirects, and carry only an opaque reference if needed—never customer email, raw answers, access tokens or secrets.

Tracking uses a fixed event catalog such as flow opened, step viewed, validation failed and request submitted, with permitted aggregate dimensions only. No arbitrary JavaScript/pixels pasted into the builder, no full answer payloads, and no price/payment success event before verified authority. Consent and data retention are explicit configuration/policy work owned by P22/P27/P28.

## 12. Component and contract ownership

| Work item | Owner | Integration dependency |
|---|---|---|
| Authoring routes/layout/commands | P11 Builder | P1 IA, P25 Portal UX |
| Field schema, dependency DSL and compiler/validator | P10 Workflow | P9 services, P12 renderer, P28 security |
| Public renderer/embed loader/session handling | P12 Runtime | P10/P11 version contract, P23 API |
| Service/template authoring and adoption | P9 Services | P10/P14; generic template registry |
| Media selection/transformation/upload | P13 Media | P11/P12; P28 private/public projection |
| Pricing effects and quote authority | P14 Pricing | P9/P10/P16; no client totals |
| Availability/resources/holds | P6/P7/P8 | P12/P23; authoritative revalidation |
| Customer payment capability | P16 Merchant payments | P8/P14/P28; separate P17 platform billing |
| Invoices and downstream booking records | P15/P3 | Stable flow version/quote references; not builder-owned ledgers |
| Calendar OAuth / notifications / maps | P18/P19/P20 | Capability references only; keys remain final activation |
| Locale and formatting | P21 | All fields/theme/price/time copy |
| Events/observability | P22/P27 | Allowlisted payloads; P28 review |
| Server persistence/publish endpoints | P23 Render API | P10/P11/P12/P28 contract and runtime gates |
| AI draft assistance | P24 | Same policy and review as manual edits |
| Platform oversight | P26 | Aggregate readiness/audit; no tenant editor bypass |

P4/P5 worker identity and mobile work remain outside the embed editor. Builder may reference resource or scheduling requirements, not expose worker private records or repurpose resource kinds as worker authorization.

## 13. Current / gap / reuse / move / build / defer plan

**Current:** generic service schema, pure workflow/rule engine, template factories, fixed mock checkout, minimal connected draft form, mock branding/preview/snippet page.

**Reuse:** service/question/price primitives, condition evaluation, deterministic tests, responsive media planning, resource overlap rules, checkout accessibility/retry concepts, public runtime-client's constrained transport approach.

**Move:** branding and useful sample flow preview from Checkout Config to builder Design/Preview; replace the placeholder installation area. Link service inventory at `/portal/services/resources` and allocations at `/portal/calendar/resources` instead of duplicating resource CRUD inside the editor.

**Build after approval:** typed richer answers/field registry; flow draft/version/public projection; authoring commands and conflict resolution; same-runtime preview; authoritative publish validation; server-approved published config fetch; working script/iframe/hosted installation; connected rich checkout capabilities through staged certification.

**Defer:** signatures, location picker/maps activation, modal embed, arbitrary custom code, real provider credentials, unreviewed AI publication, live deployment. Recurring scheduling or other template choices must be disabled/not offered until their shared capability exists; templates cannot promise unavailable behavior.

## 14. Proposed acceptance gates and review checkpoints

Before implementation: user reviews navigation, field coverage, rental date-before-availability rule, version/publish semantics and security boundaries. Then P10/P11/P12/P23/P28 approve a common contract before teams build competing formats.

Later acceptance must prove:

- Same published configuration renders equivalent behavior in builder preview, hosted URL and iframe/loader modes at desktop/tablet/phone sizes.
- All field kinds validate consistently client/server; unknown types, foreign references, malicious content and cyclic/oversized DSL reject.
- Reordering/removing/disabling steps cannot bypass required consent, valid customer data, authoritative pricing, availability or payment gates.
- Upstream answers/date changes invalidate stale model selections/effects/quotes/holds. Rental available-model filtering occurs only after dates.
- Concurrent editing reports conflicts; duplicate publish is idempotent; unauthorized publisher and cross-tenant flow/asset references reject.
- Editing a draft never changes the published version; sessions remain version-bound; rollback does not alter accepted bookings or financial records.
- Retry after network failure does not duplicate a draft/booking/payment; failed notifications remain separate from booking success.
- Public bundles/config/messages expose no secrets, internal operational data or raw customer answers; installation domain/redirect/message attacks are rejected.
- No screen says Saved, Published, Connected, Available or Paid merely because a local button was clicked.

Every implementation follows Builder → Unit Test → Domain Review → Independent Review → Adversarial Test → Integration Governor → Runtime Guardian → CI → Release Governor. Any failure returns to the responsible builder. This document requests review of the proposal only and does not launch those implementation workstreams.
