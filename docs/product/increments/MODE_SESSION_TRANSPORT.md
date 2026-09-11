# Pinned booking session transport

This W3 increment starts from reviewed PR57 at a6cce2b28f5734e82b28ea434f5231b5cd070d82. Implementation and verification are in progress. No acceptance is implied by this document or CI registration.

The server-only local repository will wrap the three accepted operations for session issuance, unconfirmed request submission and minimized owner history. It generates the booking token server side, delivers it only after acknowledged commit, and supports explicit recovery of the same attempt after uncertain delivery. Database transactions remain authoritative for tenant scope, expiry, policy, booking state and customer validation.

Recovery must distinguish a committed response that was lost from a transaction that actually rolled back. Late responses cannot overwrite a newer operation. Bounded opaque contexts, retained retry intent, clock failure handling and strict input/output validation are part of the frozen contract. These local contexts do not establish public HTTP authentication, restart recovery or a production session service.

Curie owns the repository, contracts and unit tests. Chandrasekhar owns independent PostgreSQL integration fixtures and tests. Maxwell performs independent source, adversarial and Runtime review. Root owns CI/package registration, integration and Release; that combined governor role is disclosed. Exclusive paths and exact identities are recorded in the dispatch evidence.

CI will create separate disposable databases for public and extensions pgcrypto layouts, apply all active migrations and execute the transport harness. Controlled unit tests and actual database observations will be recorded separately. Failures return to the responsible builder; exact-candidate CI and Release remain required after integration.

W3 and W4 remain incomplete, with W5-W8 still awaiting their dependencies and full acceptance. No live migration, provider activation, payment, confirmation, capacity hold or deployment is introduced by this increment. Hosted synchronization requires its own evidence.
