# PRODUCT PROFILE MAP — Lane D

**Question.** Does "one tenant → one activated business profile" exist, and does that profile drive the eight surfaces (navigation/terminology, service-schema, workflow, pricing, scheduling, resource-model, embed, onboarding)?

**Verdict: MISSING.** There is **no per-tenant, single-active business-profile / vertical concept anywhere** — not in the schema, not in contracts, not in the apps. Every vertical is exposed to every tenant as global catalog seed data. What the codebase *does* have — "installation profiles", "modes", and `@lumin/templates` — are, respectively, **embed deployment topology**, **hosted-vs-iframe distribution**, and **global service seed factories**. None of them is a tenant-scoped product identity.

---

## (i) Is there a per-tenant single-active-profile concept?

**No.** Evidence:

- **Tenant schema carries no vertical/profile.** `supabase/migrations/0002_tenants_and_identity.sql:11` — `tenants(id, name, slug, timezone, currency, status, …)`. `status` is only `active/inactive/suspended` (lifecycle). There is no `vertical`, `archetype`, `profile`, `business_type`, or `active_profile_id` column, and **no `business_profiles` table** in any of the 30 migrations.
- **Archetype lives on the *service*, not the tenant.** `0003_services.sql:17` — `archetype in ('simple','cart','configurable','rental')`. A tenant may hold many services of many archetypes simultaneously; nothing binds a tenant to one.
- **Verticals are global seed factories, available to all.** `packages/templates/src/registry.ts` builds one global `templateRegistry` from `allTemplates`; `getTemplate(key)` is unrestricted. The 8 templates (`junk-removal`, `car-detailing`, `housekeeping`, `vehicle-rental`, `equipment-rental`, `tent-event-rental`, `pressure-washing`, `landscaping`) are pure `TemplateBuildInput → Service` functions (`templates/src/types.ts`: *"the vertical **is** the data … no vertical branch anywhere"*). They stamp a tenant id onto catalog data; they do not select or lock a tenant's identity.
- **"Installation profiles" are deployment topology, not verticals.** `packages/contracts/src/installation.ts` `InstallationProfile = {profileVersion, rendererOrigin, apiOrigin, portalOrigin, loaderUrl}` and DB `lumin.installation_profiles` (`0029:30`) `{version, renderer_origin, api_origin, portal_origin, loader_sha256}`. `profileVersion` matches `^[a-z][a-z0-9-]{0,63}$` and names a *hosting profile* (which renderer/api/portal origins + loader hash), not a business vertical.
- **"Modes" are hosted-vs-iframe distribution.** `mode_flow_installations.mode ∈ {hosted, iframe}` (`0029:33`). The whole `mode_*` family (`0029/0030`) is the Embed Builder publish→install→apply→policy lifecycle keyed by `(tenant_id, flow_id)`. "Mode" ≠ product vertical.

Consequence: a tenant is a timezone + currency + a bag of services + flows. Any tenant can instantiate any/all templates. There is no activated single profile to switch on.

---

## (ii) Does the profile drive the eight axes?

Because no profile exists, "DRIVEN-BY-PROFILE" is impossible today; the honest reading per axis is what *currently* drives behavior and how far it is from profile-driven.

| Axis | Status | Evidence — what actually drives it |
|------|--------|-------------------------------------|
| Navigation / terminology | NOT-YET | Portal shell is a fixed section set (`apps/portal` Layout; PRODUCT_MAP: "ten-section mock navigation"). No vertical-driven labels/terminology; postal terms localized by country only (`i18n/address.ts`), not by profile. |
| Service-schema | PARTIAL | Driven by **per-service `archetype`** (`0003:17`) + template data (`templates.ts`), not by a tenant profile. Same 4 archetypes power all verticals; the schema differentiator is per-service, not per-tenant. |
| Workflow / questionnaire | PARTIAL | Driven by the **published configurable flow** per `flow_id` (`0016–0019`, `workflow/engine.ts`), which a template can seed. Not bound to a tenant-level vertical; a tenant may publish any flow shape. |
| Pricing | PARTIAL | `core/pricing.ts` consumes each service's items/add-ons/questions/rental config. Driven by service data (which a template stamps), not by a profile. |
| Scheduling | PARTIAL | `availability_rules` per `(tenant, service)` (`0004`); duration on the service. Profile does not select a scheduling model; rental-vs-appointment is a per-service archetype. |
| Resource-model | PARTIAL | `resources`/`service_resources`/`resource_reservations` (`0012`) are generic per-tenant. Exclusive-resource behavior is generic capacity math, not a profile-selected model (e.g., a rental fleet vs a cleaning crew look identical structurally). |
| Embed | PARTIAL | Driven by `mode_flow_installations` (`0029`) `mode` + deployment `profile_version` (origins/loader), i.e. *distribution* topology — not vertical branding/terminology. |
| Onboarding | NOT-YET | Only an owner *flow-authoring* journey (`mode-owner-journey.integration.ts`); no "pick your vertical → seed services/flow/terminology" onboarding. Templates are never presented as a tenant-scoped choice that then locks the experience. |

Net: every axis is driven by **per-service archetype data** and **per-flow published config**, never by a **tenant-level activated profile**. The pieces (archetypes, templates, flows, resources) are the raw materials a profile *would* compose, but the composing/locking layer does not exist.

---

## Concrete gaps to reach one-tenant-one-profile (shared core + profile config)

Target restated: **shared core + a `BusinessProfile` config object per tenant** that selects and constrains the raw materials. Do **not** fork apps per vertical. Gaps:

1. **No `BusinessProfile` contract.** Add `packages/contracts/src/profile.ts`: `BusinessProfile = { key: 'CLEANING'|'DETAILING'|'VEHICLE_RENTAL'|'EQUIPMENT_RENTAL'|'JUNK_REMOVAL'|'EVENT_RENTAL', terminology, navSet, defaultArchetype, serviceTemplates[], schedulingModel, resourceModel, embedDefaults, onboardingSteps }`. It is *config*, not code branches.
2. **No tenant→profile binding in the DB.** Add `tenants.profile_key` (or a `tenant_profiles` row) + an `activated_at`, with a single-active constraint. Migration is forward-only (0031+).
3. **No activation transition.** Onboarding must set the profile exactly once (or via a governed change), seeding the tenant's service templates and default flow from `templateRegistry` for the six verticals.
4. **Navigation/terminology not profile-aware.** Portal `Layout` must read `profile.navSet`/`profile.terminology` instead of a fixed section list; introduce a terminology dictionary keyed by profile (e.g. "job" vs "rental" vs "pickup").
5. **Service/flow seeding not profile-driven.** On activation, instantiate the profile's `serviceTemplates` (already exist as `@lumin/templates` — reuse as the seed source) and seed a default configurable flow; today templates are a global menu, not a per-tenant seed step.
6. **Resource/scheduling model not selected by profile.** VEHICLE_RENTAL / EQUIPMENT_RENTAL need the profile to mark the resource model **exclusive** and force **dates-before-catalog** (PRODUCT_MAP "Rental UX correction"); CLEANING/DETAILING/JUNK_REMOVAL/EVENT_RENTAL need capacity/crew models. The engines exist (`reserve_resource`, `reserve_capacity`); the profile must choose which and with what defaults.
7. **Embed defaults not profile-driven.** `mode`/branding/terminology defaults for the installed flow should come from the profile, not be authored blank each time.
8. **Six-vertical coverage exists as data but is not gated.** Templates cover CLEANING (`housekeeping`), DETAILING (`car-detailing`), VEHICLE_RENTAL (`vehicle-rental`), EQUIPMENT_RENTAL (`equipment-rental`), JUNK_REMOVAL (`junk-removal`), EVENT_RENTAL (`tent-event-rental`) — so the **raw catalog for all six already exists**; the missing work is the profile object + tenant binding + activation + surface wiring, not new per-vertical apps.

**Bottom line:** the shared-core building blocks for all six verticals are present as global data and generic engines; what is entirely absent is the tenant-scoped profile layer that would select, seed, lock, and project one vertical per tenant across the eight axes.
