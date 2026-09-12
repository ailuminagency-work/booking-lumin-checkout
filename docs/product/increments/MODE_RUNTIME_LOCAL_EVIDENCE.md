# T4 local verification record (pre-CI)

This record covers the dedicated installation loader/controller distribution increment on codex/product-mode-runtime, based on PR69 at5f41292a35a745b9607f2af7d1c943eebcc35195. The integrated implementation and verifier snapshot is3db988753aee79cfba439acc94da306ea635b62a. Documentation may follow that snapshot; the exact draft candidate must pass all four CI jobs before bounded Release acceptance.

This is not a functioning booking checkout, hosted acceptance, merge or deployment. Successful initialization continues to display that booking is unavailable and operational=false. The only customer-side API is the public installation-policy read. No session issuance, booking/payment mutation, live migration or real provider activation is introduced. W3/W4 remain building and W5-W8 incomplete.

## Actual ownership and independent review

| Scope | Builder identity | Independent source review |
| --- | --- | --- |
| Parent loader and controlled tests | Curie /root/allocator_harness_builder, author83445f2 | Maxwell /root/allocator_harness_review,08b5cc |
| Child/controller/document/shared policy transport | Chandrasekhar /root/allocator_source_review, author8ebbb41 | Curie,905931 after returned cleanup defects |
| Runtime browser specification | Curie, final author7aea0023c879f35a79c3418d3030adc12aea268b | Chandrasekhar,463bc2/final8389BACA source review |
| Six verifier/config/adversarial files | Maxwell, author154ed9ce2a5b834935e9d7f14939aecc09eb815d | Chandrasekhar,3339e9 and subsequent scoped reviews |
| Build/assets/CI/tooling/integration/evidence | Root | Curie build/assets29a1da; Chandrasekhar tooling923191 and subsequent scoped reviews |

Root performs Program/Integration and final release coordination. Source reviewers do not approve their own authored code. Maxwell owns the sole disposable PostgreSQL/browser execution slot; root borrowed it explicitly for the bounded privacy controls. Setup copies in isolated worktrees are excluded from the authored commits.

## Local tests and returned failures

All1,737 distinct unit tests passed across the regression/repair loop. The initial default-parallel run failed: an API test worker exited with580 of604 cases executed, and one unchanged document test timed out at5seconds (337 of338 flow-UI cases passed). All17 other workspace suites passed. The affected API and flow-UI packages then passed604/604 and338/338 with one worker and unchanged assertions/timeouts. The separate document suite also passed72/72. Curie independently reconciled the logs and closed the local return; the original parallel failure is retained. This is not a claim that one default-parallel run passed. Exact-candidate CI must still run its normal configuration.

Workspace type checks, the final runtime entry/fixture/spec type check, application build,22 asset controls and45 runtime build/runner/artifact controls passed. The final local preview build passed17 packaging/provenance controls with source47bcbfddc07116b8377d282f8042dd0d421280e4, sourceDirty=false, demo-in-memory, persistence=none and simulated providers. Subsequent changes only repair browser-test observation. The49 independent runtime adversarial controls passed on their exact final source.

Review returned and fixed product defects in stream-release delivery and diagnostic-startup cleanup. Browser verification also returned test-observation defects: arrival order was not frame order; a server-only counter did not observe browser refresh; inserted/remounted frames and parent ready messages needed explicit bounded observation. Corrections preserve real source/correlation attacks, capacity/entropy/SQL checks, no retries and original test/global limits. Failed and partial runs are retained and are not acceptance evidence.

## Actual native HTTP and browser evidence

Nine HTTP/TLS groups passed in both fresh disposable crypto layouts, with all30 reviewed migrations replayed locally. Public receipt1a5f25/40ae1b and extensions2603d1 cover exact fixtures48FF7E70/browserACF35DCD/integrationE0C66AA1. Controls include real separate method/body/query/Authorization/Cookie detector positives, exact SQL allowlist rejection, native no-referrer proof and independent-world asset lifetime. No live database was modified.

Public full browser run38fd6785-be05-4913-b20c-52b771d66902 passed all16 unique cases plus the exact six screenshots (590d21; root direct verification735d15). Final spec SHA256 is8389BACAF1D6EE4DBE1F1998724C46BCC9BF18915508DE5584047F22F366012A; canonical Git blobcdc8b27d7ef0802c4565178b4758f0ad29616f4f. The six other verifier files remain author154ed9. Root canonical/line-ending comparison confirms exact integrated source; Windows checkout CRLF differences are explicitly recorded, not silently normalized as arbitrary semantic equivalence.

Extensions full browser run ea303f1f-1e59-403b-8313-cb1adbcae8fd passed all 16 cases and six screenshots (6da1f0). Maxwell recorded all fourteen files and unchanged seven source hashes in mode-runtime-maxwell-final-local-manifest.json. The unchanged collector validated all fourteen files (Maxwell 1ed153, root e97971). Its initial zero count (57c051) correctly skipped absent local wrapper receipt files; the genuine captured run outputs were saved verbatim at the same paths CI populates by redirection. No success fields were fabricated and no browser rerun was substituted. Chandrasekhar independently verified all fourteen sizes/hashes, both complete summaries and the seven canonical source mappings (f47698), and found no remaining local Runtime issue. His final local Runtime report preserves Curie's independent child review and all earlier returned failures. This closes only the bounded local Runtime gate; exact-candidate CI and Release remain pending.

The verifier worktree correctly reports sourceDirty=true because of setup copies; it is not represented as a clean Git checkout. Root maps all reviewed source files to canonical commits/blobs and independently reproduced byte-identical emitted loader/controller bundles. CI must establish the exact clean candidate checkout and both layout receipts.

Four intentional privacy failures passed their negative-control verification (238e94):8 generated files including4 framework error contexts were scanned without retaining the ephemeral synthetic sentinel. Reporter SHA2565B027BB5AE66E103ABA1F8094C74CBD6F268F33A756BF49624C1C38FE0CB7AC5 was identical before and after execution. Uploads are limited to fixed public summaries/screenshots; no traces, videos, TLS material, credentials or arbitrary framework output.

## Deployment and remaining boundaries

Fresh read-only Netlify UI inspection confirms site0dffb4f0-a853-48c2-a90a-a30394b87e69, gregarious-longma-6158a8, linked to this repository. Production remains main; branch deployments are limited to codex/reviewed-preview and PR previews to deployed base branches. The runtime head and its PR69 base are outside that deployment allowlist. No settings or deployment were changed.

Protected main remains152bb909c06fa8602d99f8b37d2cfe9f90aa5ead with strict verify/database requirements, one review, stale-review dismissal/admin enforcement and no force-push/deletion. Main CI34298760622 and predecessor PR69's three jobs were freshly verified green. The new runtime job is additive; predecessor CI jobs and all30 migration files remain unchanged.

User-confirmed Render My Workspace contains only Leadgate services, no Booking Lumin API. Supabase live migration reconciliation and genuine hosted tenant/worker/admin identities remain unresolved; no live migrations are authorized in this run. The last reviewed Netlify preview is an explicitly in-memory demo. Local pinned Chromium/SPKI fixtures are not public-CA, CDN, hosted Auth or live database evidence.

Local Integration and Runtime evidence is reconciled. After the final documentation review, push the tested branch and open its stacked draft against codex/product-mode-policy-api. All four exact-candidate CI jobs and the actual checkout parent/tree identities must pass before bounded Release review. Do not merge or deploy this increment. Continue incomplete waves from the ledger; real-provider activation remains excluded.
