# Operational Parity Matrix

| Capability / surface | Repository | Hosted data/runtime | Parity | Next proof |
|---|---|---|---|---|
| Tenant/auth/RLS foundation | Present through main RC-2 baseline | Supabase older migration generation | PARTIAL | Staging replay and RLS suite |
| Booking/payment/capacity authority | Contracts and tests present | Hosted deployment not proven | UNKNOWN | Render API identity plus staging golden flow |
| W3 adoption intent journal | SQL0034/API on draft branches | Not live; no PR CI for restacked candidate | BRANCH_ONLY | Accessible draft PR, exact CI, release review |
| Customer checkout | Multiple draft/preview implementations | Last verified build is demo-in-memory | STALE / UNKNOWN | Netlify source/build/runtime reconciliation |
| Business Portal | Draft stack and local journeys | Hosted owner acceptance unverified | PARTIAL | Trusted HTTPS authenticated staging journey |
| Worker/field operations | Draft contracts and local tests | Hosted runtime unverified | PARTIAL | Staging worker identity and assignment flow |
| Provider integrations | Mock/provider-neutral adapters | No real credentials | INTENTIONAL DEFER | Separate activation authorization |

No row is considered green until the exact candidate, environment, and independent evidence agree.
