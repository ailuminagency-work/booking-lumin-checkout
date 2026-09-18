# Windows local validation profile — Node24.19 candidate

Candidate application/test source: `2a41cf31f1644f046df267c94cee01d86649f56e`, isolated `codex/wave3-text-journey`. No application, test-pool, assertion, dependency, system PATH or installed runtime was changed for this comparison. RC-2 and main remain unchanged. This profile does not qualify hosted runtime, CI, deployment or a full product wave.

## Observed runtime identities

| Runtime | Existing executable | SHA-256 | Observation |
| --- | --- | --- | --- |
| Node24.15.0 x64 / libuv1.51.0 | `C:/Program Files/nodejs/node.exe` | `3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5` | Repeated native fork-worker exits; not qualified for this Windows local test profile |
| Node24.19.0 x64 / libuv1.52.1 | `C:/Users/fligh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe` | `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237` | Explicit candidate-local qualification below |

Root observed both identities4b3242; the24.19 executable hash matches [Node's published checksum](https://nodejs.org/download/release/v24.19.0/SHASUMS256.txt). The existing engine range `>=24 <25` is not evidence that every Windows patch passed this workload. Invoke the qualified executable explicitly; scoped runner PATH overrides affect only that command's subprocesses. Do not change the user's default Node installation or select a different worker pool to hide failures.

## Investigation and limits

Prior API runs produced worker code3221226505 (`0xC0000409`) with unfinished owner/policy HTTP tests; all failures remain in TEXT_JOURNEY.md. Thread-mode success was diagnostic only. Root and independent reviewer found a closely matching [upstream report](https://github.com/nodejs/node/issues/63620): Windows24.15 HTTP workloads terminated silently, while the reporter observed later-version success. It is reporter evidence, not proof of this application's crash stack. [Node24.16 release notes](https://nodejs.org/en/blog/release/v24.16.0) record dependency updates; no particular update is established here as the cause or repair.

A separate diagnostic branch `codex/wave3-text-runtime-diagnostic`, based on2a41cf3, contains a dependency-free synthetic HTTP probe and bounded parent supervisor. `/root/field_contract_builder` owns the probe; `/root` owns the supervisor/adversarial receipt tests; `/root/evidence_recovery_review` independently reviewed both. The first driver review returned insufficient child-receipt validation; exact finite schema, runtime identity, counts, cleanup, canonical JSON and exit compatibility were added and independently passed three inert tests31a4d4.

The one-workload-per-runtime matrix416638/08f733 (UUIDf62e087f-d5d2-43ed-a4ce-0bdde05a595a) completed with both child exits0:24.15 completed7744 requests,24.19 completed7424, zero errors and observed server/socket cleanup. Independent5ff7b0 verified four regular single-link bounded artifacts and empty stderr. **This bounded probe did not reproduce the crash.** It does not establish application-independent reproduction or a causal fix. No dumps, registry settings, real providers or external HTTP targets were used.

## Qualification evidence

`/root/text_draft_client` ran two repetitions fixed in advance on unchanged2a41cf3 source, explicit24.19 binary, default fork pool with two workers, no preload, NODE_OPTIONS, retries or skipped tests. Each execution had an external180-second limit. Both passed all921 tests in25files with zero unfinished tests and actual exit0 (04167557.25s; e1d63553.88s). Independent08c8f6 verified the two finite receipts and eight regular single-link artifacts. Runtime/source/command binding comes from execution record62a738/96267; the receipts alone do not encode that provenance.

Completed remaining qualification: API typecheck6f7e63 and Portal typecheck8cbd0c passed. Portal140/140 with zero unfinished and production build passedb6c46e under explicit24.19. An initial sandbox configuration-read failure869d78 occurred before tests; the authorized owner-context rerun completed without changing assertions or configuration.

Fresh public journeyfff762/87af2b (UUID0ca29c69-f93d-469f-8191-e8dc0256d842) and extensions2ed2ef/faaf1f (UUID4326939e-555a-4688-80b1-fc095693d448) each completed42steps with actual exit0 and unchanged sourceDigest8604eed8bd72b2fc998e94af3342512792ea888dc6c21d60fa44356a2d05cdbf. The command printed24.19 and used that binary for both native and browser orchestration. Post-run23c2f4 observed zero scoped browser processes and fixture4191 refused connections. Prior24.15 Runtime evidence remains historical; these are fresh same-profile reruns.

Independent Integration/Runtime review accepted this bounded24.19 profile: journey artifact reviewbfb270, portal artifact reviewa477da, CI source reviewaabd81 and inert supervisor tests3dd37f, in addition to the two API run receipts08c8f6. Root Integration approves tested draft-review publication only. CI now registers the three inert journey supervisor/receipt tests; actual Windows browser execution remains the explicit local harness, not an implied Linux CI step. Exact candidate CI and Release remain separate requirements; old24.15 failures stay unresolved and excluded from this qualified local profile. No global runtime change or production compatibility assertion follows from this selection.
