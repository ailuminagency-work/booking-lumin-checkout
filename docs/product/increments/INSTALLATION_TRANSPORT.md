# Local installation transaction boundary

This W3 increment connects the eight reviewed installation database operations to a dedicated local server repository. It builds on PR55 at37cc0f8bf74fc8b25978840851aaf6204835896a. Acceptance requires the eventual exact-candidate review and CI receipts; this description does not certify an implementation still under construction.

Publication, installation, version application and policy changes return a usable receipt only after validated output and acknowledged transaction commit. Reads likewise return data only after verified completion. A lost commit acknowledgement remains uncertain; it never triggers an automatic mutation retry. Explicit operation recovery checks current authorization and returns the original actor's historical receipt.

The repository uses fixed parameterized operations, bounded copied inputs and outputs, separate target and policy revision checks, original acquisition and caller deadlines, and owned connection cleanup. Cancellation or socket disposal does not prove that the database stopped immediately. Unknown mutation commit and uncertain read completion are distinct outcomes.

The factory is restricted to disposable loopback databases. An internally constructed callback supplies only a captured empty or known synthetic test password, preventing saved-password fallback. Native cancellation signals are trusted server capabilities; descriptor validation does not attest their provenance or untouched native internals. Future HTTP composition must establish that trust separately.

The trusted registry remains empty by default. Returned profile membership and renderer/API/loader fields can be checked, but responses do not prove the unreturned full database profile or Portal origin. Synthetic fixtures verify full alignment; actual profile reconciliation and activation remain later gates. No public route, browser export, new session, live migration or provider connection is introduced by this local repository.

Curie builds contracts, repository and controlled tests; Chandrasekhar independently builds actual PostgreSQL acceptance; Maxwell reviews source, adversarial evidence and Runtime. Root owns shared registration, integration and Release. Existing allocator and legacy booking/worker gates remain required. Full W3 and hosted operational synchronization remain incomplete.
