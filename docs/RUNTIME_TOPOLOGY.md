# Runtime Topology

## Intended topology

| Surface | Intended runtime | Current evidence |
|---|---|---|
| Customer checkout / Business Portal / Worker / Command Center | Netlify | Last verified preview is stale demo-in-memory; current authoritative synchronization is UNKNOWN. |
| Booking Lumin API, orchestration, workers, provider adapters | Render | `apps/api/render.yaml` exists; Render connector currently has no authorized Booking Lumin workspace inventory. |
| Postgres, Auth, Storage, Realtime, transactional authority | Supabase | Project `pplwyfbxrnodimhzlvdl` is ACTIVE_HEALTHY; schema is at 0001-0009. |

## Operational consequence

The intended topology is documented but not proven as one connected operational tree. Runtime reconciliation must establish branch provenance, API deployment identity, database migration parity, frontend build source, and health evidence before Phase B certification.

## Provider boundary

All payment, calendar, notification, map, and CRM connections remain mock/provider-neutral. Real credentials are a final separately authorized activation step.
