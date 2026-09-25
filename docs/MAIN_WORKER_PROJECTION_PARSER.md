# Worker job projection parser prerequisite

This isolated Wave 4 review branch adds a strict runtime parser for the existing minimized worker job projection. Parsing a received shape is not worker authentication, current assignment verification, authorization, a confirmed booking, or permission to execute a transition. The trusted server must fetch current actor, access, assignment and job records and recheck them on every read or action. The member Action API's worker denial remains unchanged.

Base: `2ec7d611b20cfcccb422568955538d5ff3b3d3ee` (`codex/main-shift-wall-contract`). The parser must accept the existing producer's supported instant and zone domain without silently extending or narrowing it. It must reject unknown and sensitive fields and return detached immutable data. Draft planning visibility must have a separately reviewed contract; an empty transition list does not turn this execution projection into one.

Free-text reference and service labels must already be approved for worker display by the trusted server. This parser enforces their shape and bounds, but cannot scrub sensitive content from a label or prove that the job is currently assigned.

No worker route, list endpoint, fetch client, UI screen, execution button, Action API change, persistence operation, SQL migration, provider connection, deployment or protected-main change belongs to this candidate. No hosted worker access or Wave 4 completion is claimed.

## Candidate gates

Builder `/root/field_publication_export_builder` owns the parser and tests. Root `/root` owns the package export and this evidence note. Builder passed focused parser tests 9/9 and contracts typecheck. Independent `/root/field_v3_reviewer` passed domain, security, adversarial, integration and scoped Runtime Guardian source review. Separate adversarial `/root/resource_composition_builder` found no blocking defect. Root's first full workspace test run hit an unrelated load-sensitive `modeDocument` timeout; that file passed 72/72 in isolation, and the full workspace suite then passed under Node 20. Repository-wide typecheck, production builds and contamination check passed; the latter retained existing generic template warnings. Exact-candidate CI and Release Governor remain pending until a draft PR and its required checks exist.
