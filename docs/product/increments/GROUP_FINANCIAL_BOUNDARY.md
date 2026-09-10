# Financial exclusion for managed planning groups

Before exposing a combined allocator, planning groups need a lifetime boundary against financial associations. Local reproduction atPR47 showed server-role payment/refund writes and booking payment links can coexist with privately constructed held or released groups. Browser roles and application group construction remain denied; this is not evidence of an unauthenticated charge or an executed provider path.

The new invariant covers every retained group head: no booking payment link, payment for that booking, refund for it, or refund referencing a payment for it. Released and expired history remain protected until a separately reviewed payment handoff exists. Referenced IDs govern the check even when a malformed tenant label disagrees.

The additive migration uses existing policy/head fences to serialize financial writes and first group creation. Statement guards obtain the shared fence before financial row effects; final row checks examine both old and new associations after other BEFORE triggers. First-head creation has early and final absence checks under the existing strong fence. Unsupported isolation and missing protocol fail closed. No allocator, new raw grant, helper API or payment exception is added.

Financial INSERT/UPDATE statements, booking INSERT and payment-column UPDATE require READ COMMITTED. Unrelated booking updates retain their existing behavior. DELETE/TRUNCATE retain native foreign-key actions and existing group-history protection; they are covered by regression tests. Deadlocks remain whole-transaction failures, not successful denials or proof of deadlock freedom.

Migration installation locks participating relations before preflight and rejects preexisting forbidden associations without cleanup. Catalog guards install atomically; injected failure must roll back the complete change. Historical migrations and function bodies remain unchanged.

Builder Ohm owns migration0027 and SQL tests. Ptolemy independently owns adversarial/preflight/race harnesses; Arendt independently reviews both SQL and harnesses. Root owns CI, documentation, integration and release coordination. This document records the reviewed contract, not a passing implementation receipt. The stacked draft PR must contain exact candidate review and CI evidence.

PR46 crypto compatibility at5f2972fe7d3a782114d01bfaaa4960d30f4e7986 passedCI34506321657. PR47 questionnaire preview at9ab44f78849b84dbaaf76d8a430cd48ec3e7bebe passedCI34507358537. Both remain drafts. W3/W4 and later hosted acceptance remain incomplete; no live migration or provider activation is authorized here.
