# Supported runtime prerequisite

CI and Netlify source configuration now select Node24 LTS. Root package and lock metadata declare >=24 <25; no resolved dependency, integrity hash or third-party engine metadata changes. Local Node24 tests do not establish Linux or Netlify runtime acceptance. Both CI jobs and the Netlify build command log actual Node/npm versions.

Official Node releases list24 as LTS and20 as EOL: https://nodejs.org/en/about/previous-releases . GitHub action references are pinned to official v7 commits: checkout3d3c42e5aac5ba805825da76410c181273ba90b1 and setup-node820762786026740c76f36085b0efc47a31fe5020. Current official docs https://github.com/actions/checkout and https://github.com/actions/setup-node describe their Node24 runtime and v7 ESM migration. Hosted ubuntu-latest runners must satisfy upstream runner requirements. No registry-url, npm credential, unsafe PR checkout option or alternate download mirror is configured.

Required job names, triggers, database image and all test commands remain intact. This source candidate is not a Netlify production change or hosted API activation. Exact Linux CI and independently verified branch build provenance remain required for their respective acceptance. Main protection, simulated providers, immutable migrations and current demo/live guards remain unchanged.
