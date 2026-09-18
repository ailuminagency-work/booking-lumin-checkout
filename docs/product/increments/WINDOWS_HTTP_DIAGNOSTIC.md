# Bounded Windows HTTP runtime diagnostic

Base `2a41cf31f1644f046df267c94cee01d86649f56e`; isolated `codex/wave3-text-runtime-diagnostic`. This is an opt-in local diagnostic, never a production launcher, deployment or replacement for the API regression suite.

Ownership: `/root/field_contract_builder` built the dependency-free probe; `/root` built the parent supervisor and receipt tests; `/root/evidence_recovery_review` performed independent source/adversarial review. Root owns Integration and execution. The driver initially returned arbitrary parsed child JSON; independent review returned it, and root added exact finite schema/identity/count/cleanup/exit checks and canonical JSON rejection. Three adversarial inert tests passed independently31a4d4 before execution.

The workload is fixed to127.0.0.1 with an ephemeral owned server:32 concurrent requests, at most20000 admissions or15seconds, two-second request timeout,25-second child watchdog,30-second parent bound, capped private output. Owned sockets/agent/server are cleaned up and closure is observed. The supervisor verifies two exact existing executable hashes, strips inherited environment settings, checks identical probe source around both runs and preserves private process evidence. No dependencies, providers, external endpoints, database, dump collection, machine settings or runtime installations are involved.

Runtime matrix416638/08f733, UUID `f62e087f-d5d2-43ed-a4ce-0bdde05a595a`, ran once per binary:

| Runtime | Child exit | Completed | Errors | Observed server/socket cleanup |
| --- | --- | --- | --- | --- |
| Windows x64 Node24.15.0 | 0 | 7744 | 0 | true/true |
| Windows x64 Node24.19.0 | 0 | 7424 | 0 | true/true |

Independent5ff7b0 verified the two finite receipts, four regular single-link files, bounded output and empty stderr. Source SHA6917c50f670316480a56d7bc1bb65711f94a2fce1001b0269dc6d0ce5ed719d3; supervisor SHA4acb823f09a0e26b32ef204aff05ae500f367df48b9f8b7dc61365755a082a7f. Matrix exit0 means both observations were collected; it does not by itself indicate either child passed.

**The bounded probe did not reproduce the intermittent API worker crash.** It neither clears the earlier24.15 failures nor proves the responsible module or upstream fix. Do not rerun until lucky, change required worker pools or present this as product acceptance. Application qualification under an explicitly selected supported runtime is separate; retain exact source/runtime/command provenance and required CI/Release review.
