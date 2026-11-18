# Dormant payment provenance compatibility phase

Based on reviewed phase1a / 1a8ed2b. Source-only; no deployment, provider call,
runtime wiring, public wrapper, ACK change, backfill, refund initiation or retry
policy. Global UNIQUE(provider,provider_intent_id) deliberately remains in force.

0114 adds paired nullable source_scope_id/attempt_id to payments, foreign keys to
the immutable source and intent association, and unique nonnull attempt. Existing
rows stay NULL: unknown legacy is not source evidence. Scoped insert requires
agreement with the immutable attempt, request, intent association, source and
version envelope, plus canonical booking identity. The trigger reads authority
but takes no explicit booking lock. Scoped identity and original money cannot be
rewritten, unscoped rows cannot be adopted, and scoped deletion is rejected,
including cascaded deletion. State updates still follow existing financial paths;
this migration does not grant financial transition authority.

The private service-only record_scoped_payment_observation accepts only attempt
identity and a validated observed state. All financial identity/money is derived
from stored authority. It inserts without updating conflicts, locks/rereads the
payment, rejects NULL legacy or foreign-source collisions, then locks canonical
booking FOR SHARE. Advanced observations persist and replay without regression.
Historical source survives current-connection revocation or terminal booking: an
observation is not authorization to create or repeat a charge. The public legacy
RPC now rejects either nonnull provenance field even if other identity matches.

As in phase1a, a new INSERT performs normal booking FK KEY SHARE checks. Explicit
payment-before-booking ordering is not a universal no-deadlock guarantee. Tests
observe actual gated success/failure/park transactions in both orders, a held
refund state, existing-payment lock waiting, new-insert FK waiting, and both
legacy/scoped insertion winner orders. No live money movement is tested.

The private STABLE resolve_quarantined_payment_receipt takes only a receipt ID.
One MVCC statement joins signed-observation source facts to immutable historical
source and a scoped payment, then revalidates attempt/request/association/envelope
and booking identity. There is no intent-only fallback, metadata inference or
current-connection lookup. Missing, legacy-only or foreign-source matches remain
quarantined; corrupt authority, money mismatch and committed sticky conflicts
remain quarantined. A matched_observation is only an internal observational result,
not permission to process, retry, return ACK200 or change any financial row. The
receipt remains quarantined. Uncommitted/later conflicts are outside its snapshot;
a future consumer needs a separate atomic decision/serialization contract.

No keys, client secrets, raw payloads or capabilities are returned. Clients lack
private schema usage and function execution. Hosted exposed-schema configuration
is not established here and remains an activation gate. Trusted service access is
not authentication of webhook source or proof of provider truth.

## Mandatory later cutover

Existing intent-only webhook lookup and old Edge writer must be retired before
any scoped production row. Global uniqueness intentionally prevents two sources
with the same intent text from coexisting; a collision fails closed, never picks
the first source or adopts a legacy row. This is tested, not claimed solved.
Dropping global uniqueness requires replacing both recording RPCs' ON CONFLICT
dependencies, every mock/direct writer and all intent-only readers first. No
partial-index shortcut, rollback to an old intent-only handler after activation,
or provenance backfill is authorized by this candidate.

0115 preserves prior bounded checks, updates the deliberately replaced legacy
RPC body hash, and attests new private RPC/guard definitions, execution/security,
trigger binding, payment columns/constraints/defaults and valid unique indexes.
It validates before atomically advancing the0113 witness. It is not complete
historical-chain, deployed-source or live-provider verification.

## Evidence

Fresh PostgreSQL16.16 C and en-US ICU chains, standalone attestation SQL and
separate disposable clones passed:35 provenance cases,30 legacy recording,
40 provider-processing cases,122 catalog mutation rejections by the actual
reader and migration guard, four witness negatives/predecessor rejection, and
existing mock payment integration. Handler/webhook/attestation tests total118;
API noEmit typecheck passed. No external provider or hosted service was called.
