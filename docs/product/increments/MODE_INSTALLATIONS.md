# Explicit installation storage and owner operations

This W3 increment implements the database foundation for explicit hosted and iframe installations. It builds on reviewed PR54 at2660c8a36d0a8cfb8ac7c49104f0a2c0443ae701. Acceptance belongs to the eventual exact-candidate review and CI receipts; this document does not authorize deployment.

Publishing creates an immutable flow version. Installing explicitly selects one published version and one distribution mode. Applying a later version changes a stable installation target under revision checks; it does not silently republish every website integration. Policy changes have their own revision and history. Current owner authorization precedes actor-scoped retries and operation recovery, including an explicit nonarchived-flow check.

The additive storage foundation contains a trusted, initially empty deployment-profile registry, installation records, immutable owner-operation receipts and immutable installation history. Service-side functions handle publication-only, install/apply/policy changes, minimized single-installation policy lookup and authorized owner reads. Raw application roles cannot write these tables directly. Tenant and flow relationships remain bound by composite foreign keys.

The first SQL origin validator deliberately supports ordinary canonical ASCII DNS names only, excluding ACE/punycode labels and numeric-host aliases. The shared T1 parser retains its broader validated IP/punycode support. IP and internationalized-domain installation are unfinished capabilities requiring an independently reviewed authority strategy; this foundation does not complete international installation support.

This leaf creates no customer sessions or booking requests. The later session/request increment must preserve immutable version pinning, enforce current distribution policy transactionally and retain completed request visibility. No confirmation, payment, resource hold, browser controller, external provider or HTTP deployment follows from these owner operations.

Ownership: allocator_source_review builds the new migration and SQL units; allocator_harness_builder independently builds actual database and race acceptance; allocator_harness_review reviews source, isolation, test evidence and Runtime. Root owns integration, shared registration, documentation, ledger and Release. All nine gates remain mandatory, with failed work returned to its author.

Accepted migrations and legacy function bodies remain unchanged. Verification must cover both supported pgcrypto layouts, raw-role and tenant attacks, actual observed contention, rollback after late failures, exact retry/history behavior and retained legacy SQL/HTTP journeys. Synthetic local identities and SQL fixtures do not certify hosted authentication or operational Netlify/Render/Supabase synchronization. Real profile entries, live migrations and provider activation remain gated.
