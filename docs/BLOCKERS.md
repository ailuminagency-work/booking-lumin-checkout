# Active Recovery Blockers

1. **GitHub review access:** the GitHub connector can read the repository and branches but draft-PR creation returns `422 must be a collaborator`; the restacked W3 API branch has no PR or exact CI run.
2. **Database drift:** live Supabase is at migrations 0001-0009 while repository/main and review branches are newer. No staging replay has been certified.
3. **Render access/deployment:** the Render connector currently has no authorized Booking Lumin workspace inventory; Booking Lumin API deployment is unverified.
4. **Netlify synchronization:** current authoritative site/project linkage is unknown; the last verified preview is stale demo-in-memory and is not live operations.
5. **Hosted acceptance:** authenticated owner/worker/customer staging golden flows are not proven.
6. **Provider activation:** real credentials remain explicitly deferred.

## Active work

Phase A recovery artifacts are being reconciled first. Feature expansion cells are paused until the operational tree is proven coherent. The W3 API candidate remains review-only and must not be merged, deployed, migrated, or treated as live.
