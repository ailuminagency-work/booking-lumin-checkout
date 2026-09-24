# Field publication validator parity

Parent64e93ae6050c42d447fb524f4c099a629e8d65d9; branch codex/wave3-field-publication-parity. Bounded JSON-wire corpus and native SQL comparison; production parsers/candidate SQL remain unchanged and unregistered.

## Ownership and comparison boundary

/root/choice_editor_builder_2043 owns new corpus/native parity helper/unit tests in packages/action-api/server. /root/next_leaf_review_1941 owns independent supervisor inert tests and read-only corpus/native adversarial review. /root/editor_design_review_2043 independently reviews domain/source/tests/actual artifacts and scoped Runtime. Root owns new supervisor, evidence/ledger and serial checks.

Each named case has an independently declared outcome. Serialize once and give identical wire to JSON.parse then TypeScript parser and to PostgreSQL jsonb/helper. Accepted semantic cases preserve exact decoded content/order/whitespace. No dynamic filtering or computing expectations from the validator under test. Reflection/proxy/symbol/undefined/BigInt and noncanonical raw numeric lexemes are not ordinary JSON-value parity and remain outside this corpus.

Separate explicit categories: semantic agreement, intentional SQL storage limits, JSONB transport rejection. SQL V3 definition caps32768bytes and envelope65536bytes of PostgreSQL jsonb::text; pure TypeScript parser has structural limits only. Measure actual SQL bytes; never equate JSON.stringify length with jsonb rendering. Uppercase UUID is valid in both validators; canonical lowercase belongs to authoritative SQL row/RPC output. An overlapping oversized definition/envelope case cannot isolate the envelope cap.

Root read-only local probes9b7c10/f03053 corrected an initial overly broad transport assumption: NUL rejects22P05, lone high/low surrogate rejects22P02 before helper invocation. These are expected synthetic errors, not candidate defects. Native must assert exact per-case error; unrelated SQL errors fail. Local owner helper invocation is validation testing, not authorization proof.

## Resume and gates

Heartbeat2026-09-20T09:53Z workflow/ledger025577 cleanparent; main152bb909protected/PR74draftc53deb unchanged,parentActions0; branchacf4f7. Source comparisondd3b74/30e739 and independent adversarial design identify byte/transport distinctions. Corpus coverage review returned missing unknown/duplicate/key-bound cases to builder before freeze. W3/W4building,W3-W8incomplete,W9excluded. Known collaborator422/detailprotection403 blockers persist; no bypass/fabricatedPR.

Supervisor composes unchanged60steps then native61(100s/2048bytes) and zero62(15s/128bytes),970second cumulative cap/125artifacts with prior limits unchanged. Native90swatchdog and owned connection cleanup. Exact corpus counts must be frozen before execution; temporary supervisor zero counts are not qualified. Source review accepted by independent domain and adversarial reviewers. Builder targeted 5/5, strict TypeScript, independent inert supervisor 10/10, root full API 1180/1180 across 46 files, and ledger 8/8 pass. An initial native public attempt stopped at SQL step1 because the old disposable PostgreSQL at 127.0.0.1:55439 was unavailable; its restart returned Windows restricted-token error 87. A fresh isolated PostgreSQL cluster then enabled public and extensions native runs: each passed all 62 steps with source digest 99969c6ddb5e37a9f1a38d59be28ef1d629ae761a903df83f94b5cfedc986979. Independent reviewer /root/editor_design_review_2043 audited 125 artifacts per layout, all 397 current source pins, exact receipts, and zero sessions, and granted bounded local Runtime acceptance. Exact-candidate CI and Release remain pending. On 2026-09-22 main advanced to protected c5663c5 via merged PR76, which relocates the Action API server to apps/api/src; Integration must reconcile this leaf before publication. The seven-path candidate still needs integration reconciliation with current main, then exact-candidate CI/Release. No live SQL/providers/deployment/merge. RR extension, post-candidatefullregression/migrationregistration/harnesscompatibility/exactCI/Release/hostedacceptance remain separate gates.



## Integration with the current protected main

The parity leaf is based on 64e93ae in the existing Wave 3 review stack. Protected main c5663c5 merged PR76, which moved the server application to apps/api/src. This leaf validates its existing stack and does not target a direct merge into main. Before any integration to the new application line, move the three parity source files into apps/api/src, update supervisor source paths and package test commands, rerun both layouts and the full API checks against that exact integrated candidate, and obtain fresh independent Runtime and CI/Release reviews. Keep the old stack and accepted main unchanged while this port is prepared.
