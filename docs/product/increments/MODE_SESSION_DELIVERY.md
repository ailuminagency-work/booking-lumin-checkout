# Internal session delivery coordinator

W3 remains BUILDING. This isolated increment starts at reviewed PR73 `79bead0cbcb43329274384709b6c89579386317e` and does not expose a customer route or complete the booking journey.

The coordinator retains prepared capabilities, captures returned issuance material independently of waiter presence, and distinguishes unknown issuance from known commitment. Explicit recovery uses the original attempt. Accepted redelivery calls only the existing-session validator, preserving the complete canonical receipt, original publication pin and expiry. Acknowledgement stops redelivery; it does not certify browser receipt, renew authority or expose submission credentials.

Preparation reserves at most16 entries; at most two lower operations run, with one attached waiter per entry. The37,900,288-byte logical UTF8 reservation is not a VM, driver or total memory guarantee. Original entry and owner reservations stay charged through pending continuations and trusted cleanup callbacks. An earlier credential expiry timer may shorten delivery eligibility; the separate original preparation cutoff still retires settled tombstones. Close latches all sibling terminal states before cleanup and is stop-only. The trusted composition still owns repository/facade shutdown.

## Actual ownership and controlled evidence

Curie (`/root/allocator_harness_builder`) built the coordinator and tests and built the native harness. Chandrasekhar (`/root/allocator_source_review`) supplied independent domain/source review. Maxwell (`/root/allocator_harness_review`) supplied independently authored adversarial tests and review. Root owns shared registration, documentation, integration and later Runtime/Release coordination. No reviewer approves their own authored source.

Frozen coordinator SHA25639B7D44F932693A091A02A47C7C0C1B7F9A9A49765D922C3BD6E008FEF99DC60 and test SHA2566076782935595F79131D9C36C1A031334A1BAB3C7314C260373DDC734EE065AB passed105 author controls, typecheck, and the full855-test Action API regression. Independent23 adversarial groups and two additional expiry groups passed with unchanged source/test hashes. Independent domain review closed its malformed-outcome regression.

Prior failed controls remain evidence: malformed lower envelopes incorrectly altered issuance certainty; global cleanup exposed partially stopped siblings; disallowed operations bypassed expiry checks; continuation scratch was released before final trusted callbacks. All were returned to the builder, corrected and independently rechecked. Additional author controls cover earlier expiry, synchronous timer/cleanup callbacks, full16-entry retirement and predispatch abort. These results establish only controlled internal behavior.

## Remaining gates

The six-group genuine PostgreSQL harness passed independent source/domain review and actual execution on both fresh crypto layouts: all31 migrations, six SQL suites and six native groups each on PostgreSQL18.6. Public completed in34.91 seconds and extensions in31.32 seconds including setup. Four frozen source hashes remained unchanged. Both layouts observed genuine COMMIT and ROLLBACK acknowledgement loss, all three late-result controls, and actual queued-acquisition rejection. No unobserved delivered-client branch is claimed. Independent final native Runtime review passed (Maxwell, report0960423F4CC6CAE707EAA205A94E9E413A8F67C3F938FE1C3AE52FC9873142C6). Exact-candidate CI and bounded Release remain pending. No new PR or pushed candidate is claimed by this document.

No accepted migration, provider connection, production factory, HTTP/controller route or deployment changes. Real providers remain disconnected. Full W3-W8 capabilities and hosted acceptance remain incomplete. Historical PR72/PR73 runtime01 failures remain unexplained risks even though corrected diagnostic candidates passed later CI.
