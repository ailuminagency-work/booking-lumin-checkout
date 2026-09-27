# Netlify Canonical Map

**Status:** `UNKNOWN` / `UNVERIFIED`
**As of:** 2026-09-26
**Rule:** stale sites are retained as evidence; none is deleted or re-pointed during Phase A.

## Site inventory

| Site / URL observed | Intended purpose | Repository | Branch | Commit | API target | Status |
|---|---|---|---|---|---|---|
| `gregarious-longma-6158.netlify.app` | prior preview / demo candidate | unknown | unknown | unknown | unknown | `STALE / NOT LIVE-PROVEN` |
| `codex-reviewed-preview--gregarious-longma-6158.netlify.app` | prior reviewed preview | unknown | unknown | unknown | unknown | `STALE / NOT LIVE-PROVEN` |
| `sage-kangaroo` (name mentioned during investigation) | identity not verified | unknown | unknown | unknown | unknown | `DO NOT ASSUME CANONICAL` |

The current recovery pass has no authorized Netlify connector inventory and no verified site-to-repository mapping. The table intentionally does not guess which site is the customer checkout, business portal, or Lumin Command Center.

## Required canonical identification

For each of the three intended surfaces, record the Netlify site ID/name, repository, deploy branch, deployed commit, build command, publish directory, environment class, and API base URL. Verify the deployed commit against a GitHub ref and verify that the API target is the certified staging Render service before frontend synchronization.

Required surfaces:

- Customer checkout / embed runtime
- Business Portal
- Lumin Command Center

## Synchronization gate

No site may be labeled `STAGING_DEPLOYED` or `STAGING_VERIFIED` until the canonical map has a verified site identity, exact commit, environment target, and successful staging smoke test. Do not delete stale sites, change production traffic, or alter secrets as part of inventory work.
