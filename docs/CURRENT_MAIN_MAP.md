# Current Main Map

**As of:** 2026-09-26  
**Repository:** `ailuminagency-work/booking-lumin-checkout`  
**Protected main:** `c5663c59e134e71beb511f509b3287ab0046bdff`

## Authority

`main` is the only protected integration authority. Its required checks are `verify (typecheck, test, build, contamination)` and `database (migrations + RLS attack suite)`. No branch-only or local-only candidate is treated as merged, deployed, or live.

## Component disposition

| Component | Current disposition | Evidence / boundary |
|---|---|---|
| Portal shell and initial contracts | MERGED | PR75 and PR76 are merged; main is c5663c5. |
| Action API, outbox, flow storage | MERGED | Accepted RC-2/W2 baseline; no production deployment claim. |
| Persisted flow/request journey | BRANCH_ONLY / draft stack | PR34 and later W3 drafts; parent W3 remains building. |
| Publication / installation increments | BRANCH_ONLY / draft | PR55 and PR59; no hosted acceptance. |
| Service-adoption SQL intent journal | BRANCH_ONLY / draft | PR96 head 6013923; migration 0034 is not on main. |
| API adoption recovery candidate | BRANCH_ONLY / review hold | Restacked branch `codex/main-template-adoption-api-intent-recovery-v2`, commit `294aa0a35e77bdcca3b8f2209d01f37e885dfe2`; no PR because connector returns 422 collaborator error. |
| Supabase hosted schema | DEPLOYED OLDER GENERATION | Live project has migrations 0001-0009 only. |
| Render Booking Lumin API | NOT DEPLOYED / UNVERIFIED | Repository declares `apps/api/render.yaml`; no service deployment evidence. |
| Netlify customer/portal runtime | UNKNOWN / STALE DEMO EVIDENCE | Last verified preview was a demo-in-memory build; current synchronization is not proven. |
| Real provider credentials | DEFERRED | Explicitly prohibited until separate activation authorization. |

## Superseded / duplicate handling

Older Codex/Claude branches are not merged authority. They remain review inputs only. No blind cherry-pick or duplicate vertical application is authorized.

## Immediate disposition

Reconcile repository, database, Render, and Netlify before starting new feature work. The W3 API candidate remains review-only until it has an accessible draft PR, exact CI, and Release Governor approval.
