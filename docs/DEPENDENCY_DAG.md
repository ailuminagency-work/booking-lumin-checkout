# Dependency DAG

Owner: Program Governor. Re-evaluated on every major evidence change.

```
Legacy Forensics (WS1) ─────────────┐  [BLOCKED: no repo/Supabase access]
Contamination Forensics (WS2) ──────┤  [policy active: migrate nothing]
                                    ▼
                     Clean Migration Engineering (WS3)   [moot while clean-room]

Contracts v1 (@lumin/contracts) ✅
        │
        ├──────────────┬──────────────────┬───────────────────┐
        ▼              ▼                  ▼                   ▼
  Core engines    DB schema + RLS   Mock adapters       App shells
  (WS6, WS7)      (WS4, WS5)        (WS8)               (WS9, WS10, WS11)
        │              │                  │                   │
        └──────┬───────┴───────┬──────────┘                   │
               ▼               ▼                              │
        Integration check   RLS attack tests                  │
               └───────────────┬──────────────────────────────┘
                               ▼
              Adversarial verification + generalization proofs (WS12)
                               ▼
                        Release candidate
```

Ready now (no blockers): core engines, DB schema, adapters, all three apps —
all compile against contracts and mocks. Blocked: WS1/WS2 forensics (external
access), real provider adapters (post-gate), deployment (needs remote repo +
new Supabase project).
