# Shift wall-time selection contract

This isolated Wave 4 prerequisite defines a pure owner shift input and resolution-selection contract. It does not convert a named-zone wall time to UTC. A resolution envelope can be parsed and bound to input, but that parsing does not prove the candidate instants follow real timezone rules, authenticate a resolver, or grant permission to save a shift. A future reviewed resolver and timezone-data provenance must supply candidates before any friendly shift editor is connected.

Base: `ac4c43eb7216541145ef9234ae9243e9128acc19` (`codex/main-roster-liveness`). The proposed editor input is limited to Gregorian years 2020 through 2100 and minute precision. This limit applies only to future edited input; existing stored shifts with unsupported zones or subminute precision remain readable without silent rewriting. Zone syntax is not membership in IANA or PostgreSQL catalogs. Each date, time, zone or resolver/data-version change requires a new resolution and discards the old selection. Contract fixtures illustrate envelope shapes only; actual timezone-rule conversion, including gap/fold and non-hour offsets, needs a later resolver test suite.

No API, SQL, Portal editor, core allocator, provider connection, payment, live deployment or protected-main change belongs to this candidate. The accepted scheduling engine and server authorization remain authoritative.

## Candidate gates

Builder `/root/field_publication_export_builder` owns the pure contract and tests. Root `/root` owns the package export and this evidence note. The builder passed focused tests 8/8 and i18n typecheck after adding year-boundary, fractional-hour offset and nonexistent-time envelope cases requested by independent adversarial reviewer `/root/resource_composition_builder`. Independent `/root/field_v3_reviewer` passed domain, adversarial, integration and scoped Runtime Guardian source review after correcting the documentation's earlier unsupported fixture claim. Neither review treats the supplied candidates as verified timezone conversion.

Root's first full workspace test run hit an unrelated load-sensitive `modeDocument` timeout; that test passed 72/72 in isolation and the final full workspace suite passed under Node 20. Repository-wide typecheck, production builds and contamination check passed; the contamination check retained existing generic template warnings. Exact-candidate CI and Release Governor remain pending until a draft PR and required checks exist. This local contract does not complete Wave 4 or authorize a shift editor.
